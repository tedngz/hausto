// Request intake. The renter surface's one write into the viewing domain.
//
// Public by necessity: a renter has no Supabase session (CLAUDE.md scopes renter
// auth to a phone-keyed cookie, and there is no cookie before the first
// request). So this is rate-limited by IP, it accepts only ids and chips, and it
// reads every price from the database rather than from the caller - the body
// says which listings, never what they cost.
//
// It writes rows and it writes events, and the events are the state. There is no
// status column to set here, which is invariant 1 holding by construction.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { clientIp, isRateLimited } from '../_shared/rate-limit.ts';
import {
  generateRef,
  validateAvailability,
  validateShortlist,
  screenCandidates,
  intakeEvents,
  buildDeepLink,
  hcmcDate,
  toE164,
  MIN_ITEMS,
  type ShortlistCandidate,
} from '../_shared/viewing/intake.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// The number the renter messages to open the service window. Falls back to a
// documented placeholder rather than throwing: provisioning is human-blocked,
// and the whole flow has to stay demoable on mock without it (CLAUDE.md).
const BUSINESS_PHONE = Deno.env.get('WHATSAPP_BUSINESS_PHONE') || '+84000000000';

// The columns the shortlist gate reads, and only those. Selecting `*` here
// would put every future column one typo away from leaking to an unauthenticated
// caller.
const CANDIDATE_COLUMNS =
  'id, is_active, price_vnd, price_confidence, bedrooms, area_sqm, district_code, realtor_id, title';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const ip = clientIp(req);
  if (await isRateLimited(`viewing-intake:${ip}`, 10, 3600)) {
    return json({ error: 'rate_limited', message: 'Too many requests. Try again in an hour.' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const phone = toE164(String(body.phone ?? ''));
  if (!phone) {
    return json({ error: 'invalid_phone', message: 'Enter a Vietnamese mobile number, e.g. 0901 234 567.' }, 400);
  }

  const shortlist = validateShortlist(body.listingIds);
  if (!shortlist.ok) return json({ error: 'invalid_shortlist', message: shortlist.error }, 400);

  const availability = validateAvailability(body.availability, hcmcDate(new Date()));
  if (!availability.ok) return json({ error: 'invalid_availability', message: availability.error }, 400);

  const displayName = String(body.displayName ?? '').trim().slice(0, 80) || null;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── Screen the shortlist against what is actually live ────────────────────
  // The renter chose these minutes or days ago. Re-reading is not paranoia:
  // verification runs every 20 minutes and can deactivate a row between the
  // shortlist page rendering and this call.
  const { data: found, error: findErr } = await db
    .from('external_properties')
    .select(CANDIDATE_COLUMNS)
    .in('id', shortlist.value!);
  if (findErr) {
    console.error('[viewing-request-create] listing lookup failed:', findErr);
    return json({ error: 'lookup_failed' }, 500);
  }

  const { eligible, rejected } = screenCandidates(shortlist.value!, (found ?? []) as ShortlistCandidate[]);
  if (eligible.length < MIN_ITEMS) {
    // Not a server error and not silent: the renter is told which ones fell
    // through, so they can swap them rather than guess.
    return json({
      error: 'shortlist_too_short',
      message: `Only ${eligible.length} of your ${shortlist.value!.length} listings can still be requested. Pick at least ${MIN_ITEMS}.`,
      rejected,
    }, 422);
  }

  // ── The renter ────────────────────────────────────────────────────────────
  const { data: renter, error: renterErr } = await db
    .from('renters')
    .upsert(
      { phone_e164: phone, ...(displayName ? { display_name: displayName } : {}) },
      { onConflict: 'phone_e164' },
    )
    .select('id, opted_out_at')
    .single();
  if (renterErr || !renter) {
    console.error('[viewing-request-create] renter upsert failed:', renterErr);
    return json({ error: 'renter_failed' }, 500);
  }
  if (renter.opted_out_at) {
    // Opting back in is a deliberate act on the renter's side, not something a
    // form submission does on their behalf.
    return json({
      error: 'opted_out',
      message: 'This number has opted out of messages from us. Reply START on WhatsApp to opt back in.',
    }, 403);
  }

  // ── The request ───────────────────────────────────────────────────────────
  // The ref is random and unique, so a collision is a retry rather than a
  // failure. Five attempts against ~457k refs and ~25 requests a day is far
  // past comfortable.
  let request: { id: string; ref: string } | null = null;
  for (let attempt = 0; attempt < 5 && !request; attempt++) {
    const { data, error } = await db
      .from('viewing_requests')
      .insert({ ref: generateRef(), renter_id: renter.id, availability: availability.value })
      .select('id, ref')
      .single();
    if (!error) { request = data; break; }
    if (error.code !== '23505') {
      console.error('[viewing-request-create] request insert failed:', error);
      return json({ error: 'request_failed' }, 500);
    }
  }
  if (!request) return json({ error: 'ref_collision' }, 503);

  // ── The items ─────────────────────────────────────────────────────────────
  // `price_vnd_at_request` is the price we are showing the renter right now,
  // read from the row rather than taken from the caller. That is what makes
  // "the broker quoted a different price" a comparison instead of an argument.
  const { data: items, error: itemsErr } = await db
    .from('request_items')
    .insert(eligible.map((c, i) => ({
      request_id: request!.id,
      listing_id: c.id,
      realtor_id: c.realtor_id,
      price_vnd_at_request: c.price_vnd,
      sort_order: i,
    })))
    .select('id, listing_id, realtor_id, price_vnd_at_request');

  if (itemsErr || !items) {
    console.error('[viewing-request-create] item insert failed:', itemsErr);
    await db.from('viewing_requests').delete().eq('id', request.id);
    return json({ error: 'items_failed' }, 500);
  }

  // ── The log ───────────────────────────────────────────────────────────────
  // One statement. A request whose rows exist but whose log does not is a
  // request with no state at all, since state is derived - so on failure the
  // whole thing goes rather than leaving that behind.
  const { error: eventsErr } = await db.from('events').insert(intakeEvents({
    requestId: request.id,
    availability: availability.value!,
    items: items.map(i => ({
      itemId: i.id,
      listingId: i.listing_id,
      priceVndAtRequest: i.price_vnd_at_request,
      realtorId: i.realtor_id,
    })),
  }));

  if (eventsErr) {
    console.error('[viewing-request-create] event insert failed:', eventsErr);
    await db.from('viewing_requests').delete().eq('id', request.id);
    return json({ error: 'events_failed' }, 500);
  }

  // No message is sent here, and that is deliberate. There is no service window
  // until the renter messages us first, and no approved template to open one
  // with. The deep link is the handshake; the confirmation page shows it.
  return json({
    success: true,
    ref: request.ref,
    requestId: request.id,
    waLink: buildDeepLink(BUSINESS_PHONE, request.ref),
    accepted: items.map(i => i.listing_id),
    rejected,
  });
});
