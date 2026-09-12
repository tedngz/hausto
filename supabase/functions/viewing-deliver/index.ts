// Assemble the itinerary and send it. One message, once.
//
// Called by an operator from the console, and by the job drain for the holding
// update. Both paths land here so there is one place that knows how to turn a
// request into something a renter reads.
//
// The two events it writes are the record: ITINERARY_ASSEMBLED carries the
// order and the warnings ops was shown, ITINERARY_DELIVERED carries the message
// id. Neither is written unless the send succeeded - a DELIVERED event for a
// message that never left would stop the silence watch from ever firing again,
// which is the one failure that breaks the S6 promise quietly.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import {
  sendFreeForm,
  ServiceWindowClosedError,
  ConsecutiveMessageError,
} from '../_shared/whatsapp/send.ts';
import { reduceRequest, type DomainEvent } from '../_shared/viewing-domain.ts';
import { assembleItinerary, renderItinerary, renderNoSupply, type StopListing } from '../_shared/viewing/itinerary.ts';
import { renderHoldingUpdate } from '../_shared/viewing/reminders.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // An operator, the cron secret, or the service role. Delivery costs money and
  // burns the renter's attention; it is not an open endpoint.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let actor = 'SYSTEM';
  if (token !== SERVICE_ROLE) {
    const cronSecret = req.headers.get('x-cron-secret') || '';
    let authorized = false;
    if (cronSecret) {
      const { data } = await db.rpc('verify_cron_secret', { _token: cronSecret });
      authorized = data === true;
    }
    if (!authorized) {
      const { data: userData } = await db.auth.getUser(token);
      const userId = userData?.user?.id;
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const { data: role } = await db
        .from('user_roles').select('role').eq('user_id', userId).eq('role', 'ops').maybeSingle();
      if (!role) return json({ error: 'Forbidden' }, 403);
      actor = `OPS:${userId}`;
    }
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const requestId = String(body.requestId ?? '');
  const purpose = String(body.purpose ?? 'ITINERARY');
  if (!requestId) return json({ error: 'requestId is required' }, 400);

  const { data: request } = await db
    .from('viewing_requests').select('id, ref, renter_id, created_at').eq('id', requestId).maybeSingle();
  if (!request) return json({ error: 'Unknown request' }, 404);

  const [{ data: events }, { data: items }] = await Promise.all([
    db.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
      .eq('request_id', requestId).order('occurred_at', { ascending: true }),
    db.from('ops_request_items_view').select('id, listing_title, district_code, price_vnd_at_request')
      .eq('request_id', requestId),
  ]);

  const view = reduceRequest(requestId, (events ?? []) as DomainEvent[]);
  const listings: StopListing[] = (items ?? []).map((i: Record<string, unknown>) => ({
    itemId: String(i.id),
    listingTitle: String(i.listing_title ?? 'A place'),
    districtCode: (i.district_code as string) ?? null,
    priceVndAtRequest: Number(i.price_vnd_at_request ?? 0),
  }));

  // ── What are we sending? ──────────────────────────────────────────────────
  let text: string;
  let assembled: ReturnType<typeof assembleItinerary> | null = null;

  if (purpose === 'HOLDING_UPDATE') {
    text = renderHoldingUpdate({ ref: request.ref, view });
  } else {
    const order = Array.isArray(body.order) ? body.order.map(String) : view.itineraryOrder;
    assembled = assembleItinerary(view, listings, order);

    if (assembled.stops.length === 0) {
      // Zero confirmed. FAILED_NO_SUPPLY ships with substitutes or it is a dead
      // end, and a dead end is not something we make a renter read.
      const substitutes = Array.isArray(body.substitutes)
        ? (body.substitutes as { title: string; priceVnd: number; districtCode: string | null }[])
        : [];
      text = renderNoSupply({ ref: request.ref, requestedCount: listings.length, substitutes });
    } else {
      text = renderItinerary({ ref: request.ref, stops: assembled.stops, requestedCount: listings.length });
    }
  }

  // ── Send, then record ─────────────────────────────────────────────────────
  const store = new SupabaseMessageStore(db);
  let adapter;
  try { adapter = adapterFromEnv(Deno.env.toObject()); }
  catch (e) { return json({ error: (e as Error).message }, 500); }

  let messageId: string;
  try {
    const result = await sendFreeForm(store, adapter, {
      renterId: request.renter_id,
      requestId,
      purpose,
      body: text,
      attempt: Number(body.attempt ?? 1),
    });
    messageId = result.message.id;
    if (result.deduplicated) {
      // The idempotency key already had a message. Nothing was sent twice and
      // nothing more should be written to the log.
      return json({ success: true, deduplicated: true, messageId, preview: text });
    }
  } catch (e) {
    if (e instanceof ServiceWindowClosedError) {
      // This is the human-blocked dependency surfacing, not a bug. Re-opening a
      // window needs an approved template and none of the four are approved
      // yet, so there is nothing to fall back to and pretending otherwise
      // would write a SENT row for a message nobody receives.
      return json({
        error: 'service_window_closed',
        message:
          'The renter has not messaged us in 24h, so a free-form send is illegal. ' +
          'Re-opening needs an approved template - see templates.ts; none are approved yet.',
        preview: text,
      }, 409);
    }
    if (e instanceof ConsecutiveMessageError) {
      return json({ error: 'too_many_consecutive', message: (e as Error).message, preview: text }, 429);
    }
    console.error('[viewing-deliver]', e);
    return json({ error: 'send_failed', message: (e as Error).message }, 500);
  }

  // Only now. See the note at the top of this file.
  const toWrite: Record<string, unknown>[] = [];
  if (assembled) {
    toWrite.push({
      request_id: requestId,
      type: 'ITINERARY_ASSEMBLED',
      payload: {
        ordered_item_ids: assembled.stops.map(s => s.itemId),
        warnings: assembled.warnings,
      },
      actor,
    });
  }
  toWrite.push({
    request_id: requestId,
    // A holding update is something the renter heard, which is what the
    // silence watch measures - but it is not the itinerary, and typing it as
    // one would make the queue think the request was finished.
    type: purpose === 'HOLDING_UPDATE' ? 'HOLDING_UPDATE_SENT' : 'ITINERARY_DELIVERED',
    payload: { message_id: messageId },
    actor,
  });

  const { error: evErr } = await db.from('events').insert(toWrite);
  if (evErr) console.error('[viewing-deliver] event insert failed after send:', evErr);

  return json({
    success: true,
    messageId,
    stops: assembled?.stops.length ?? 0,
    warnings: assembled?.warnings ?? [],
    preview: text,
  });
});
