// The ops console's only write path (SPEC §4).
//
// Every state change an operator makes arrives here, is checked against the
// seven outcomes, and becomes exactly one typed event. The console has SELECT
// and nothing else - see 20260911190000_ops_console_access.sql - so this is not
// a convenience wrapper the browser could route around. It is where invariant 2
// is actually enforced.
//
// Three actions, because they are the operator's loop: they message the broker
// (CONTACTED), they chase (NUDGED), and they record what came back (OUTCOME).
// All three write typed events; none of them writes a status.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  validateOutcome,
  outcomePayload,
  opsActor,
  jobsForOutcome,
} from '../_shared/viewing/outcomes.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── Who is this, and are they ops? ────────────────────────────────────────
  // An operator, never the service role. Every event here carries OPS:<uuid>,
  // and an action nobody is attributable for is one the corpus cannot be
  // audited against later.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const { data: userData } = await db.auth.getUser(token);
  const actorId = userData?.user?.id ?? null;
  if (!actorId) return json({ error: 'Unauthorized' }, 401);

  const { data: role } = await db
    .from('user_roles').select('role').eq('user_id', actorId).eq('role', 'ops').maybeSingle();
  if (!role) return json({ error: 'Forbidden' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const action = String(body.action ?? 'OUTCOME');
  const itemId = String(body.itemId ?? '');
  if (!itemId) return json({ error: 'itemId is required' }, 400);

  // The item names its own request; taking the request id from the caller would
  // let a mistyped body file an event against someone else's request.
  const { data: item } = await db
    .from('request_items')
    .select('id, request_id, listing_id, realtor_id')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return json({ error: 'Unknown item' }, 404);

  const actor = opsActor(actorId);

  if (action === 'CONTACTED') {
    await db.from('events').insert({
      request_id: item.request_id,
      item_id: item.id,
      type: 'REALTOR_CONTACTED',
      payload: { channel: String(body.channel ?? 'ZALO'), draft_id: body.draftId ?? null },
      actor,
    });
    return json({ success: true, recorded: 'REALTOR_CONTACTED' });
  }

  if (action === 'NUDGE') {
    const { count } = await db
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', item.id)
      .eq('type', 'ITEM_NUDGED');
    await db.from('events').insert({
      request_id: item.request_id,
      item_id: item.id,
      type: 'ITEM_NUDGED',
      payload: { attempt: (count ?? 0) + 1 },
      actor,
    });
    return json({ success: true, recorded: 'ITEM_NUDGED', attempt: (count ?? 0) + 1 });
  }

  if (action !== 'OUTCOME') return json({ error: `Unknown action: ${action}` }, 400);

  // ── The outcome ───────────────────────────────────────────────────────────
  // The nudge count is a fact about the log, read here and passed into a pure
  // check rather than trusted from the caller: NO_RESPONSE is the one outcome
  // whose legitimacy depends on what already happened.
  const { count: priorNudges } = await db
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', item.id)
    .eq('type', 'ITEM_NUDGED');

  const validated = validateOutcome(
    {
      outcome: String(body.outcome ?? ''),
      slots: body.slots,
      actualPriceVnd: body.actualPriceVnd,
      note: body.note,
    },
    { priorNudges: priorNudges ?? 0 },
  );
  if (!validated.ok) return json({ error: 'invalid_outcome', message: validated.error }, 400);

  const { error: eventErr } = await db.from('events').insert({
    request_id: item.request_id,
    item_id: item.id,
    type: 'OUTCOME_RECORDED',
    payload: outcomePayload(validated.value),
    actor,
  });
  if (eventErr) {
    console.error('[ops-record-outcome] event insert failed:', eventErr);
    return json({ error: 'event_failed' }, 500);
  }

  // Follow-on work, after the event rather than instead of it. A failure here
  // must not lose the outcome - the operator's call happened either way, and a
  // missing re-resolution job is recoverable where a missing event is not.
  const jobs = jobsForOutcome(validated.value, { itemId: item.id, listingId: item.listing_id });
  if (jobs.length > 0) {
    const { error: jobErr } = await db.from('jobs').insert(jobs);
    if (jobErr) console.error('[ops-record-outcome] job enqueue failed:', jobErr);
  }

  return json({ success: true, recorded: 'OUTCOME_RECORDED', outcome: validated.value.outcome });
});
