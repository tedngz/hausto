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
import { dueActions, type DueAction } from '../_shared/viewing/reminders.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** One job per (request, kind, item) per pass. Re-enqueueing the same nudge
 *  every five minutes is how a broker gets forty messages. */
function jobKey(a: DueAction): string {
  return `${a.kind}:${a.requestId}:${a.itemId ?? '-'}`;
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
    .select('id, ref, created_at')
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
    .from('jobs').select('kind, payload').is('completed_at', null).in('kind', ['HOLDING_UPDATE', 'NUDGE_REALTOR', 'VIEWING_REMINDER']);
  const queued = new Set(
    (pending ?? []).map((j: { kind: string; payload: Record<string, unknown> }) =>
      `${j.kind}:${j.payload?.request_id ?? '-'}:${j.payload?.item_id ?? '-'}`),
  );

  const rows: Record<string, unknown>[] = [];
  for (const r of requests as { id: string; created_at: string }[]) {
    const events = byRequest.get(r.id) ?? [];
    const view = reduceRequest(r.id, events);

    // Confirmed slots, for the day-before reminder.
    const slots = Object.values(view.items)
      .filter(i => i.state === 'CONFIRMED')
      .flatMap(i => (i.slots as { starts_at?: string }[])
        .filter(s => typeof s?.starts_at === 'string')
        .map(s => ({ itemId: i.itemId, startsAt: s.starts_at! })));

    for (const action of dueActions({ view, events, createdAt: r.created_at, now, slots })) {
      if (queued.has(jobKey(action))) continue;
      queued.add(jobKey(action));
      rows.push({
        kind: action.kind,
        run_after: new Date(now).toISOString(),
        payload: { request_id: action.requestId, item_id: action.itemId ?? null, reason: action.reason },
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
  console.log(`[viewing-jobs-drain] scanned ${requests.length}, enqueued ${rows.length}`);
  return json({ success: true, scanned: requests.length, enqueued: rows.length });
});
