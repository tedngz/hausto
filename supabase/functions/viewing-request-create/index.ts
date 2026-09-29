// Request intake. The renter surface's one write into the viewing domain.
//
// Signed in, as of the Fast-Track retirement. It was public - a renter had no
// Supabase session and there was no cookie before the first request - but a
// request now spends viewing credits, and credits belong to an account. An
// anonymous caller cannot be charged, and an endpoint that writes coordinator
// work without charging anyone is one curl away from being expensive.
//
// Still rate-limited by IP on top of that, still accepts only ids and chips,
// and still reads every price from the database rather than from the caller -
// the body says which listings, never what they cost.
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
  itemEvents,
  buildDeepLink,
  hcmcDate,
  toRenterE164,
  RENTER_PHONE_HINT,
  MIN_ITEMS,
  MAX_ITEMS,
  type ShortlistCandidate,
} from '../_shared/viewing/intake.ts';
import { renderIntakeAlert, sendIntakeAlert, type IntakeAlert } from '../_shared/viewing/ops-alert.ts';
import { findJoinableRequest } from '../_shared/viewing/open-request.ts';
import { linkViewingToInquiry } from '../_shared/viewing/concierge.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Used only to verify the caller's JWT. Never to write - every write below goes
// through the service-role client.
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
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

// deno-lint-ignore no-explicit-any
type Supa = any;

const creditsMessage = (n: number) =>
  `This request covers ${n} place${n === 1 ? '' : 's'} and needs ${n} viewing credit${n === 1 ? '' : 's'}.`;

/**
 * Tell the operators, after the charge and without waiting on it: the renter
 * gets their answer now, and an email that fails must not unmake a request
 * they have paid for. waitUntil keeps the isolate alive for the send.
 */
function alertOps(db: Supa, alert: IntakeAlert) {
  const sent = sendIntakeAlert(db, alert, Deno.env.get('RESEND_API_KEY')).then(r => {
    if (r.skipped) console.warn(`[viewing-request-create] ops alert skipped: ${r.skipped}`);
  });
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(sent);
}

/**
 * Add places to the renter's open request rather than opening another
 * (intake.ts `pickJoinable` says why).
 *
 * Decided here again rather than trusted from the modal: the request may have
 * moved on to assembly since the modal asked `viewing-request-open`. If it has,
 * the answer is a 409 the modal turns into "pick your times", not a quiet new
 * request - the renter was shown "adding to HV-4KX2" and should not be handed
 * a different ref without being asked for the times that go with it.
 *
 * Same write order as a new request, for the same reasons: rows, then the log,
 * then the charge last; undo on failure. Undo here is deleting the new items,
 * which takes their events with them (ON DELETE CASCADE) and leaves the rest of
 * the request exactly as it was.
 */
async function joinOpenRequest(
  db: Supa,
  userId: string,
  joinRef: string,
  listingIds: string[],
  inquiryId: string | null = null,
): Promise<Response> {
  const open = await findJoinableRequest(db, userId, hcmcDate(new Date())).catch((e: unknown) => {
    console.error('[viewing-request-create] open request lookup failed:', e);
    return undefined;
  });
  if (open === undefined) return json({ error: 'lookup_failed' }, 500);
  if (!open || open.ref !== joinRef) {
    return json({
      error: 'join_closed',
      message: `We are already putting ${joinRef} together, so this place needs its own request. Pick your times below.`,
    }, 409);
  }

  const fresh = listingIds.filter(id => !open.listingIds.includes(id));
  if (fresh.length === 0) {
    return json({
      error: 'already_requested',
      message: `This place is already in your request ${open.ref}.`,
      ref: open.ref,
    }, 409);
  }
  if (open.listingIds.length + fresh.length > MAX_ITEMS) {
    return json({
      error: 'request_full',
      message: `${open.ref} already has ${open.listingIds.length} places, and one day of viewings holds ${MAX_ITEMS}.`,
    }, 409);
  }

  const { data: found, error: findErr } = await db
    .from('external_properties')
    .select(CANDIDATE_COLUMNS)
    .in('id', fresh);
  if (findErr) {
    console.error('[viewing-request-create] listing lookup failed:', findErr);
    return json({ error: 'lookup_failed' }, 500);
  }
  const { eligible, rejected } = screenCandidates(fresh, (found ?? []) as ShortlistCandidate[]);
  if (eligible.length === 0) {
    return json({
      error: 'shortlist_too_short',
      message: rejected[0]?.reason ?? 'This place can no longer be requested.',
      rejected,
    }, 422);
  }

  const { data: affordable, error: quotaErr } = await db.rpc('can_create_fast_track_request', {
    _user_id: userId,
    _needed: eligible.length,
  });
  if (quotaErr) {
    console.error('[viewing-request-create] quota check failed:', quotaErr);
    return json({ error: 'quota_check_failed' }, 500);
  }
  if (!affordable) {
    return json({ error: 'insufficient_credits', message: creditsMessage(eligible.length), needed: eligible.length }, 402);
  }

  const { data: items, error: itemsErr } = await db
    .from('request_items')
    .insert(eligible.map((c, i) => ({
      request_id: open.requestId,
      listing_id: c.id,
      realtor_id: c.realtor_id,
      price_vnd_at_request: c.price_vnd,
      sort_order: open.listingIds.length + i,
    })))
    .select('id, listing_id, realtor_id, price_vnd_at_request');
  if (itemsErr || !items) {
    console.error('[viewing-request-create] join item insert failed:', itemsErr);
    return json({ error: 'items_failed' }, 500);
  }
  const undo = () => db.from('request_items').delete().in('id', items.map((i: { id: string }) => i.id));

  const { error: eventsErr } = await db.from('events').insert(itemEvents({
    requestId: open.requestId,
    items: items.map((i: { id: string; listing_id: string; price_vnd_at_request: number; realtor_id: string | null }) => ({
      itemId: i.id,
      listingId: i.listing_id,
      priceVndAtRequest: i.price_vnd_at_request,
      realtorId: i.realtor_id,
    })),
  }));
  if (eventsErr) {
    console.error('[viewing-request-create] join event insert failed:', eventsErr);
    await undo();
    return json({ error: 'events_failed' }, 500);
  }

  const { error: chargeErr } = await db.rpc('consume_viewing_credits', {
    _user_id: userId,
    _needed: items.length,
    _request_id: open.requestId,
  });
  if (chargeErr) {
    console.error('[viewing-request-create] join charge failed:', chargeErr);
    await undo();
    return json({ error: 'insufficient_credits', message: creditsMessage(items.length), needed: items.length }, 402);
  }

  const placeCount = open.listingIds.length + items.length;
  if (inquiryId) await linkViewingToInquiry(db, { inquiryId, requestId: open.requestId, now: new Date() });
  alertOps(db, renderIntakeAlert({
    ref: open.ref,
    placeCount,
    added: items.length,
    availability: open.availability,
    createdAt: new Date(),
  }));

  return json({
    success: true,
    joined: true,
    ref: open.ref,
    requestId: open.requestId,
    waLink: buildDeepLink(BUSINESS_PHONE, open.ref),
    placeCount,
    accepted: items.map((i: { listing_id: string }) => i.listing_id),
    rejected,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const ip = clientIp(req);
  if (await isRateLimited(`viewing-intake:${ip}`, 10, 3600)) {
    return json({ error: 'rate_limited', message: 'Too many requests. Try again in an hour.' }, 429);
  }

  // ── Who is asking ─────────────────────────────────────────────────────────
  // verify_jwt stays false in config.toml so this can answer with a reason the
  // modal can show, rather than the platform's bare 401 before our code runs.
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    return json({ error: 'sign_in_required', message: 'Sign in to request viewings.' }, 401);
  }
  const { data: authData, error: authErr } = await createClient(SUPABASE_URL, ANON_KEY)
    .auth.getUser(jwt);
  const user = authData?.user;
  if (authErr || !user) {
    return json({ error: 'sign_in_required', message: 'Sign in to request viewings.' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // ── Joining an open request ───────────────────────────────────────────────
  // The modal sends `joinRef` when it showed the renter "adding to HV-4KX2".
  // It asks for neither a number nor times then: both are the request's own.
  if (typeof body.joinRef === 'string' && body.joinRef.trim()) {
    const places = validateShortlist(body.listingIds);
    if (!places.ok) return json({ error: 'invalid_shortlist', message: places.error }, 400);
    return await joinOpenRequest(
      createClient(SUPABASE_URL, SERVICE_ROLE), user.id, body.joinRef.trim(), places.value!,
      typeof body.inquiryId === 'string' ? body.inquiryId : null,
    );
  }

  const phone = toRenterE164(String(body.phone ?? ''));
  if (!phone) {
    return json({ error: 'invalid_phone', message: RENTER_PHONE_HINT }, 400);
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
      // One place - the modal's only shape now - is better told why.
      message: shortlist.value!.length === 1 && rejected[0]
        ? rejected[0].reason
        : `Only ${eligible.length} of your ${shortlist.value!.length} listings can still be requested. Pick at least ${MIN_ITEMS}.`,
      rejected,
    }, 422);
  }

  // ── Can they afford it? ───────────────────────────────────────────────────
  // One credit per listing: four places in one request costs the same as four
  // separate requests, because it is the same four hours of a coordinator's
  // day. Asked before anything is written, so the common refusal costs no rows.
  const { data: affordable, error: quotaErr } = await db.rpc('can_create_fast_track_request', {
    _user_id: user.id,
    _needed: eligible.length,
  });
  if (quotaErr) {
    console.error('[viewing-request-create] quota check failed:', quotaErr);
    return json({ error: 'quota_check_failed' }, 500);
  }
  if (!affordable) {
    return json({
      error: 'insufficient_credits',
      message: creditsMessage(eligible.length),
      needed: eligible.length,
    }, 402);
  }

  // ── The renter ────────────────────────────────────────────────────────────
  // user_id links the phone-keyed renter row to the account being charged. It
  // is how the hub answers "my requests" and how the ledger attributes items.
  const { data: renter, error: renterErr } = await db
    .from('renters')
    .upsert(
      {
        phone_e164: phone,
        user_id: user.id,
        ...(displayName ? { display_name: displayName } : {}),
      },
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

  // ── The charge ────────────────────────────────────────────────────────────
  // Last, and only once the request is whole. One credit per item.
  //
  // Charged after the write rather than before it because the windowed
  // allowance is derived by counting request_items - it has to see them to
  // answer. The affordability check above is what keeps the common refusal
  // cheap; this is what makes it true.
  //
  // If it raises, the request is removed. A request nobody paid for is worse
  // than no request: it queues real work for an operator against an account
  // with nothing left to spend. Nothing has been sent at this point - intake
  // writes no message - so there is no half-told renter to worry about.
  const { error: chargeErr } = await db.rpc('consume_viewing_credits', {
    _user_id: user.id,
    _needed: items.length,
    _request_id: request.id,
  });
  if (chargeErr) {
    console.error('[viewing-request-create] charge failed:', chargeErr);
    await db.from('viewing_requests').delete().eq('id', request.id);
    return json({
      error: 'insufficient_credits',
      message: creditsMessage(items.length),
      needed: items.length,
    }, 402);
  }

  alertOps(db, renderIntakeAlert({
    ref: request.ref,
    placeCount: items.length,
    availability: availability.value ?? [],
    createdAt: new Date(),
  }));

  // Made from an availability request's offer link (PLAN-v3 S7.1c).
  if (typeof body.inquiryId === 'string') {
    await linkViewingToInquiry(db, { inquiryId: body.inquiryId, requestId: request.id, now: new Date() });
  }

  // No message is sent to the renter here, and that is deliberate. There is no
  // service window until the renter messages us first. The deep link is the
  // handshake; the confirmation page shows it.
  return json({
    success: true,
    ref: request.ref,
    requestId: request.id,
    waLink: buildDeepLink(BUSINESS_PHONE, request.ref),
    accepted: items.map(i => i.listing_id),
    rejected,
  });
});
