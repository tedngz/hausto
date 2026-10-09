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
import { dueActions, holdingUpdateOnHold, HELD_REFUSALS } from '../_shared/viewing/reminders.ts';
import { placeOf } from '../_shared/viewing/place.ts';
import {
  OPS_DIGEST_JOB, digestDue, escalationUpdate, inquiryMessageUpdate, inquiryUpdates, renderDigest, viewingUpdates,
  type Update,
} from '../_shared/viewing/ops-digest.ts';
import type { InquiryEvent } from '../_shared/viewing-domain.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

/**
 * What changed since the last operators' digest, across viewing requests,
 * buildings and priority searches (ops-digest.ts). The window starts where the
 * last digest job ended, so news held back by the gap is carried, not lost,
 * and ends a minute ago, so an event written mid-pass is in the next window
 * rather than in neither.
 */
async function digestUpdates(db: Supa, from: string, until: string): Promise<Update[]> {
  const updates: Update[] = [];

  const [{ data: events }, { data: escalations }] = await Promise.all([
    db.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
      .in('type', ['RENTER_REPLIED', 'OUTCOME_RECORDED', 'ITINERARY_DELIVERED', 'ITINERARY_HELD',
        'REQUEST_CONFIRMED', 'REQUEST_FAILED', 'REQUEST_CANCELLED'])
      .gt('occurred_at', from).lte('occurred_at', until),
    db.from('operator_proposals').select('request_id, rationale, created_at')
      .eq('action', 'ESCALATE').gt('created_at', from).lte('created_at', until),
  ]);
  const requestIds = [...new Set([
    ...((events ?? []) as DomainEvent[]).map(e => e.request_id),
    ...((escalations ?? []) as { request_id: string }[]).map(p => p.request_id),
  ])];
  const { data: refs } = requestIds.length
    ? await db.from('viewing_requests').select('id, ref').in('id', requestIds)
    : { data: [] };
  const refOf = new Map(((refs ?? []) as { id: string; ref: string }[]).map(r => [r.id, r.ref]));
  for (const id of requestIds) {
    updates.push(...viewingUpdates(refOf.get(id) ?? 'a request', ((events ?? []) as DomainEvent[]).filter(e => e.request_id === id), id));
  }
  for (const p of (escalations ?? []) as { request_id: string; rationale: string; created_at: string }[]) {
    updates.push(escalationUpdate(refOf.get(p.request_id) ?? 'a request', p.rationale, p.created_at, p.request_id));
  }

  const [{ data: inqEvents }, { data: inbound }] = await Promise.all([
    db.from('inquiry_events').select('id, inquiry_id, type, payload, actor, occurred_at')
      .in('type', ['CONFIRMED', 'BRIEF_CHANGED', 'UNITS_OFFERED', 'CLOSED', 'REOPENED'])
      .gt('occurred_at', from).lte('occurred_at', until),
    db.from('complex_inquiry_messages').select('inquiry_id, created_at')
      .eq('direction', 'inbound').gt('created_at', from).lte('created_at', until),
  ]);
  const inquiryIds = [...new Set([
    ...((inqEvents ?? []) as InquiryEvent[]).map(e => e.inquiry_id),
    ...((inbound ?? []) as { inquiry_id: string }[]).map(m => m.inquiry_id),
  ])];
  if (inquiryIds.length) {
    const { data: inquiries } = await db.from('complex_inquiries')
      .select('id, complex_id, area_label, area_district_codes').in('id', inquiryIds);
    for (const q of (inquiries ?? []) as { id: string; complex_id: string | null; area_label: string | null; area_district_codes: string[] | null }[]) {
      const place = await placeOf(db, q).catch(() => null);
      const kind = q.complex_id ? 'BUILDING' : 'SEARCH';
      const name = place?.name ?? (kind === 'SEARCH' ? 'an area search' : 'a building');
      updates.push(...inquiryUpdates(kind, name, ((inqEvents ?? []) as InquiryEvent[]).filter(e => e.inquiry_id === q.id), q.id));
      // One line per thread per pass, however many messages the renter sent.
      const last = ((inbound ?? []) as { inquiry_id: string; created_at: string }[])
        .filter(m => m.inquiry_id === q.id).map(m => m.created_at).sort().pop();
      if (last) updates.push(inquiryMessageUpdate(kind, name, last, q.id));
    }
  }
  return updates;
}


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
    .in('kind', ['HOLDING_UPDATE', 'NUDGE_REALTOR', 'VIEWING_DAY', 'CONFIRM_REALTOR', 'RELEASE_REALTOR', 'CHASE_RENTER', 'LOCK_IN_DEADLINE']);
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
    .from('jobs').select('payload, completed_at, last_error').eq('kind', 'HOLDING_UPDATE')
    .in('last_error', HELD_REFUSALS).gte('completed_at', horizon);
  const lastRefusal = new Map<string, { at: string; reason: string }>();
  for (const j of (refused ?? []) as { payload: Record<string, unknown>; completed_at: string; last_error: string }[]) {
    const id = String(j.payload?.request_id ?? '');
    if (id && (!lastRefusal.has(id) || j.completed_at > lastRefusal.get(id)!.at)) {
      lastRefusal.set(id, { at: j.completed_at, reason: j.last_error });
    }
  }
  const renterIds = [...new Set((requests as { renter_id: string | null }[]).map(r => r.renter_id).filter(Boolean))];
  const { data: renters } = renterIds.length
    ? await db.from('renters').select('id, service_window_expires_at').in('id', renterIds)
    : { data: [] };
  const windowOf = new Map(((renters ?? []) as { id: string; service_window_expires_at: string | null }[])
    .map(r => [r.id, r.service_window_expires_at]));

  const rows: Record<string, unknown>[] = [];
  let held = 0;
  // Requests whose "chase the renter" to-do is still owed this pass.
  const stillChasing = new Set<string>();
  for (const r of requests as { id: string; created_at: string; renter_id: string | null }[]) {
    const events = byRequest.get(r.id) ?? [];
    const view = reduceRequest(r.id, events);

    for (const action of dueActions({ view, events, createdAt: r.created_at, now })) {
      if (action.kind === 'CHASE_RENTER') stillChasing.add(r.id);
      if (queued.has(jobKey(action))) continue;
      // Refused last time for a reason a retry cannot fix, and the renter has
      // not written since: queueing it again is queueing the same refusal.
      if (action.kind === 'HOLDING_UPDATE' && holdingUpdateOnHold({
        refusedAt: lastRefusal.get(r.id)?.at ?? null,
        reason: lastRefusal.get(r.id)?.reason ?? null,
        now,
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

  // A chase nobody needs any more - they answered, or an operator wrote to
  // them, or the request closed - comes off the console by itself.
  const scanned = new Set((requests as { id: string }[]).map(r => r.id));
  for (const j of (pending ?? []) as { kind: string; payload: Record<string, unknown> }[]) {
    const id = String(j.payload?.request_id ?? '');
    if (j.kind !== 'CHASE_RENTER' || !scanned.has(id) || stillChasing.has(id)) continue;
    await db.from('jobs').update({ completed_at: new Date(now).toISOString(), last_error: 'no longer owed' })
      .eq('kind', 'CHASE_RENTER').is('completed_at', null).eq('payload->>request_id', id);
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
  const digest = await queueDigest(db, now).catch((e: Error) => {
    console.error('[viewing-jobs-drain] digest failed:', e.message);
    return 'failed';
  });

  console.log(`[viewing-jobs-drain] scanned ${requests.length}, enqueued ${rows.length}, held ${held}, digest ${digest}`);
  return json({ success: true, scanned: requests.length, enqueued: rows.length, held, digest });
});

/**
 * The operators' digest, if one is due: one job carrying the rendered email,
 * which viewing-jobs-run sends. Its `until` is the next window's start.
 */
async function queueDigest(db: Supa, now: number): Promise<string> {
  const { data: last } = await db
    .from('jobs').select('created_at, payload').eq('kind', OPS_DIGEST_JOB)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const from = typeof last?.payload?.until === 'string' ? last.payload.until : new Date(now - 15 * 60_000).toISOString();
  const until = new Date(now - 60_000).toISOString();
  if (from >= until) return 'none';
  const updates = await digestUpdates(db, from, until);
  if (!digestDue(updates, last ? Date.parse(last.created_at) : null, now)) return updates.length ? 'held' : 'none';
  const alert = renderDigest(updates);
  if (!alert) return 'none';
  const { error } = await db.from('jobs').insert({
    kind: OPS_DIGEST_JOB,
    run_after: new Date(now).toISOString(),
    payload: { request_id: null, from, until, subject: alert.subject, text: alert.text, updates: updates.length },
  });
  if (error) throw new Error(error.message);
  return `queued ${updates.length}`;
}
