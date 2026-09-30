// The timer. Runs on pg_cron, finds what each open request is owed, and does
// it (SPEC §1 `jobs`, PLAN-v3 S6).
//
// No Inngest, no Trigger.dev, no BullMQ, no Redis - a table and a cron entry,
// because ~25 requests a day does not need a queue. CLAUDE.md is explicit.
//
// The scheduler itself is pure and lives in `_shared/viewing/reminders.ts`,
// which is what the 24-hour property test is asserted against. This function
// is the I/O around it: read the open requests, ask what is due, and write a
// job row per action. Keeping the decision out of here is what makes the
// promise testable without a database and a clock.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { reduceRequest, type DomainEvent } from '../_shared/viewing-domain.ts';
import { dueActions, holdingUpdateOnHold, RENTER_BOUND_REFUSALS } from '../_shared/viewing/reminders.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** One job per (request, kind, item, date) per pass. Re-enqueueing the same
 *  nudge every five minutes is how a broker gets forty messages. */
function jobKey(a: { kind: string; requestId: string; itemId?: string | null; date?: string | null }): string {
  return `${a.kind}:${a.requestId}:${a.itemId ?? '-'}:${a.date ?? '-'}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = req.headers.get('x-cron-secret') || '';
  let authorized = token === SERVICE_ROLE;
  if (!authorized && cronSecret) {
    const { data } = await db.rpc('verify_cron_secret', { _token: cronSecret });
    authorized = data === true;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  const now = Date.now();

  // Only requests young enough to still be live. A request nobody touched in a
  // fortnight is not one a nudge helps, and scanning the whole table forever
  // is how this becomes the slowest thing on the cron.
  const horizon = new Date(now - 21 * 24 * 60 * 60 * 1000).toISOString();
  const { data: requests, error: reqErr } = await db
    .from('viewing_requests')
    .select('id, ref, created_at, renter_id')
    .gte('created_at', horizon)
    .order('created_at', { ascending: true })
    .limit(500);
  if (reqErr) return json({ error: reqErr.message }, 500);
  if (!requests?.length) return json({ success: true, scanned: 0, enqueued: 0 });

  const ids = requests.map((r: { id: string }) => r.id);
  const { data: allEvents } = await db
    .from('events')
    .select('id, request_id, item_id, type, payload, actor, occurred_at')
    .in('request_id', ids)
    .order('occurred_at', { ascending: true });

  const byRequest = new Map<string, DomainEvent[]>();
  for (const e of (allEvents ?? []) as DomainEvent[]) {
    const list = byRequest.get(e.request_id) ?? [];
    list.push(e);
    byRequest.set(e.request_id, list);
  }

  // What is already queued, so a second pass does not double it.
  const { data: pending } = await db
    .from('jobs').select('kind, payload').is('completed_at', null)
    .in('kind', ['HOLDING_UPDATE', 'NUDGE_REALTOR', 'VIEWING_DAY', 'CONFIRM_REALTOR', 'RELEASE_REALTOR']);
  // A viewing-day job that finished without sending (a refusal no retry
  // fixes) counts as queued for the rest of the day. Otherwise every pass
  // would queue the same refusal again until the last viewing started.
  const { data: dayJobs } = await db
    .from('jobs').select('kind, payload').eq('kind', 'VIEWING_DAY')
    .gte('created_at', new Date(now - 20 * 60 * 60 * 1000).toISOString());
  const queued = new Set(
    [...(pending ?? []), ...(dayJobs ?? [])].map((j: { kind: string; payload: Record<string, unknown> }) => jobKey({
      kind: j.kind,
      requestId: String(j.payload?.request_id ?? '-'),
      itemId: (j.payload?.item_id as string | null) ?? null,
      date: (j.payload?.date as string | null) ?? null,
    })),
  );

  // Holding updates refused for a reason only the renter can lift, and when -
  // with each renter's window, whose start is when they last wrote.
  const { data: refused } = await db
    .from('jobs').select('payload, completed_at').eq('kind', 'HOLDING_UPDATE')
    .in('last_error', [...RENTER_BOUND_REFUSALS]).gte('completed_at', horizon);
  const refusedAt = new Map<string, string>();
  for (const j of (refused ?? []) as { payload: Record<string, unknown>; completed_at: string }[]) {
    const id = String(j.payload?.request_id ?? '');
    if (id && (!refusedAt.has(id) || j.completed_at > refusedAt.get(id)!)) refusedAt.set(id, j.completed_at);
  }
  const renterIds = [...new Set((requests as { renter_id: string | null }[]).map(r => r.renter_id).filter(Boolean))];
  const { data: renters } = renterIds.length
    ? await db.from('renters').select('id, service_window_expires_at').in('id', renterIds)
    : { data: [] };
  const windowOf = new Map(((renters ?? []) as { id: string; service_window_expires_at: string | null }[])
    .map(r => [r.id, r.service_window_expires_at]));

  const rows: Record<string, unknown>[] = [];
  let held = 0;
  for (const r of requests as { id: string; created_at: string; renter_id: string | null }[]) {
    const events = byRequest.get(r.id) ?? [];
    const view = reduceRequest(r.id, events);

    for (const action of dueActions({ view, events, createdAt: r.created_at, now })) {
      if (queued.has(jobKey(action))) continue;
      // Refused last time for a reason a retry cannot fix, and the renter has
      // not written since: queueing it again is queueing the same refusal.
      if (action.kind === 'HOLDING_UPDATE' && holdingUpdateOnHold({
        refusedAt: refusedAt.get(r.id) ?? null,
        windowExpiresAt: r.renter_id ? windowOf.get(r.renter_id) ?? null : null,
      })) {
        held++;
        continue;
      }
      queued.add(jobKey(action));
      rows.push({
        kind: action.kind,
        run_after: new Date(now).toISOString(),
        payload: {
          request_id: action.requestId, item_id: action.itemId ?? null, reason: action.reason,
          ...(action.date ? { date: action.date } : {}),
        },
      });
    }
  }

  if (rows.length > 0) {
    const { error: insErr } = await db.from('jobs').insert(rows);
    if (insErr) {
      console.error('[viewing-jobs-drain] enqueue failed:', insErr);
      return json({ error: insErr.message }, 500);
    }
  }

  // Enqueue only. Executing the jobs is a separate pass so a slow send cannot
  // stall the scan, and so a job that fails is retried from its row rather
  // than lost with the request that produced it.
  console.log(`[viewing-jobs-drain] scanned ${requests.length}, enqueued ${rows.length}, held ${held}`);
  return json({ success: true, scanned: requests.length, enqueued: rows.length, held });
});
