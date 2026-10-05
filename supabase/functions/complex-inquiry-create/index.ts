// Create a concierge availability request (SPEC §11). The complex page's
// "Request availability" form posts here, and so does Search for me.
//
// Writes the request and a PENDING watch with the same criteria, and hands
// back a wa.me link carrying the watch's code. Nothing is sent, and the
// concierge is not told, until the renter sends that code from their own
// phone - so there is no phone number in this request at all, and a caller
// cannot point our messages at somebody else.
//
// WhatsApp only. Email requests are retired; the old ones keep their threads.
//
// Two kinds:
//   * **A building** (`complexId`). Signed-in is optional, as it always was,
//     and it is free for everyone: it feeds the agent roster and the
//     operator's volume.
//   * **An area** (`areaDistrictCodes`) - Search for me, the Pass's headline
//     (the pricing rework, step 5). A person searches agents' circles for it,
//     which costs real hours, so it needs a signed-in Pass holder, one open
//     search at a time, and promises 48 hours rather than 24.
//
// Neither spends anything: viewings of what is found are requested, and
// locked in, the one way there is.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { clientIp, identifyCaller, isRateLimited } from '../_shared/rate-limit.ts';
import { CONFIRM_TTL_DAYS, generateWatchCode, watchExpiry } from '../_shared/viewing/watch.ts';
import { buildInquiryLink, buildSearchLink, validateInquiryInput } from '../_shared/viewing/inquiry.ts';
import { REPLY_WITHIN_HOURS, areaLabel } from '../_shared/viewing/place.ts';
import { hasPassCover } from '../_shared/viewing/lock-in-run.ts';
import { PASS_DAYS, PASS_PRICE_USD } from '../_shared/viewing/lock-in.ts';
import { reduceInquiry, type InquiryEvent } from '../_shared/viewing-domain.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// Same fallback as viewing-request-create: the flow stays demoable on mock
// without a provisioned number.
const BUSINESS_PHONE = Deno.env.get('WHATSAPP_BUSINESS_PHONE') || '+84000000000';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// deno-lint-ignore no-explicit-any
type Supa = any;

/**
 * This account's search still being worked, if any: confirmed and not
 * closed, or sent so recently its code can still arrive.
 */
async function openSearch(db: Supa, userId: string, now: Date): Promise<{ id: string; label: string } | null> {
  const { data: rows } = await db
    .from('complex_inquiries')
    .select('id, area_label, created_at')
    .eq('user_id', userId)
    .is('complex_id', null)
    .order('created_at', { ascending: false })
    .limit(10);
  for (const r of (rows ?? []) as { id: string; area_label: string; created_at: string }[]) {
    const { data: events } = await db.from('inquiry_events')
      .select('id, inquiry_id, type, payload, actor, occurred_at').eq('inquiry_id', r.id);
    const view = reduceInquiry(r.id, (events ?? []) as InquiryEvent[]);
    if (view.state === 'CLOSED') continue;
    const fresh = now.getTime() - Date.parse(r.created_at) <= CONFIRM_TTL_DAYS * 86_400_000;
    if (view.state === 'AWAITING_CODE' && !fresh) continue;
    return { id: r.id, label: r.area_label };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  if (await isRateLimited(`complex-inquiry:${clientIp(req)}`, 10, 3600)) {
    return json({ error: 'rate_limited', message: 'Too many requests from here. Try again in an hour.' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const now = new Date();
  const input = validateInquiryInput(body, now);
  if (!input.ok) return json({ error: 'invalid_request', message: input.error }, 400);
  const v = input.value;

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const caller = await identifyCaller(req, createClient(SUPABASE_URL, ANON_KEY));

  // ── Where ─────────────────────────────────────────────────────────────────
  let place: { complexId: string | null; codes: string[] | null; name: string };
  if (v.areaDistrictCodes) {
    // Search for me is the Pass's: a person's hours, not a form's.
    if (!caller.userId) {
      return json({ error: 'sign_in_required', message: 'Sign in to ask us to search for you.' }, 401);
    }
    if (!(await hasPassCover(db, caller.userId))) {
      return json({
        error: 'pass_required',
        message: `Search for me comes with the Pass ($${PASS_PRICE_USD} for ${PASS_DAYS} days).`,
      }, 402);
    }
    const open = await openSearch(db, caller.userId, now);
    if (open) {
      return json({
        error: 'one_open_search',
        message: `We are still searching ${open.label} for you. One search at a time - reply on that thread to change it.`,
      }, 409);
    }
    place = { complexId: null, codes: v.areaDistrictCodes, name: areaLabel(v.areaDistrictCodes) };
  } else {
    const { data: complex } = await db
      .from('complexes').select('id, name, is_published').eq('id', v.complexId).maybeSingle();
    if (!complex || complex.is_published === false) return json({ error: 'invalid_complex', message: 'Unknown building.' }, 404);
    place = { complexId: complex.id, codes: null, name: complex.name };
  }
  const area = place.codes ? { area_district_codes: place.codes, area_label: place.name } : {};

  // ── The handshake ─────────────────────────────────────────────────────────
  const expiresAt = watchExpiry(now, v.moveInDate).toISOString();
  let watch: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !watch; attempt++) {
    const code = generateWatchCode();
    const { data, error } = await db.from('complex_watches').insert({
      complex_id: place.complexId,
      ...area,
      code,
      user_id: caller.userId,
      bedrooms: v.bedrooms,
      budget_max_vnd: v.budgetMaxVnd,
      move_in_by: v.moveInDate,
      expires_at: expiresAt,
    }).select('id').single();
    if (!error && data) { watch = { id: data.id, code }; break; }
    if (error?.code !== '23505') {
      console.error('[complex-inquiry-create] watch insert failed:', error);
      return json({ error: 'create_failed' }, 500);
    }
  }
  if (!watch) return json({ error: 'code_collision' }, 500);

  // ── The request ───────────────────────────────────────────────────────────
  const { data: inquiry, error: inqErr } = await db.from('complex_inquiries').insert({
    complex_id: place.complexId,
    ...area,
    user_id: caller.userId,
    full_name: v.name,
    target_move_in_date: v.moveInDate,
    lease_duration_months: v.leaseMonths,
    bedrooms_needed: v.bedrooms,
    budget_max_vnd: v.budgetMaxVnd,
    has_pets: v.hasPets,
    additional_notes: v.notes,
    channel: 'WHATSAPP',
    watch_id: watch.id,
  }).select('id').single();
  if (inqErr || !inquiry) {
    console.error('[complex-inquiry-create] inquiry insert failed:', inqErr);
    await db.from('complex_watches').delete().eq('id', watch.id);
    return json({ error: 'create_failed' }, 500);
  }

  // The request's log starts here (PLAN-v3 S7.1). It carries the promise, so
  // the reducer - and the console's deadline - know an area has 48 hours.
  const { error: evErr } = await db.from('inquiry_events').insert({
    inquiry_id: inquiry.id, type: 'SUBMITTED', actor: caller.userId ? `USER:${caller.userId}` : 'RENTER',
    payload: {
      bedrooms: v.bedrooms, budget_max_vnd: v.budgetMaxVnd, move_in: v.moveInDate,
      ...(place.codes
        ? { area_district_codes: place.codes, reply_within_hours: REPLY_WITHIN_HOURS.AREA }
        : {}),
    },
    occurred_at: now.toISOString(),
  });
  if (evErr) console.error('[complex-inquiry-create] SUBMITTED failed:', evErr);

  return json({
    success: true,
    inquiryId: inquiry.id,
    complexName: place.name,
    kind: place.codes ? 'AREA' : 'BUILDING',
    code: watch.code,
    waLink: place.codes
      ? buildSearchLink(BUSINESS_PHONE, watch.code, place.name)
      : buildInquiryLink(BUSINESS_PHONE, watch.code, place.name),
    alertsUntil: expiresAt,
  });
});
