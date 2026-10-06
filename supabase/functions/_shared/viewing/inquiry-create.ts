// Creating an availability request (SPEC §11): the work behind
// complex-inquiry-create, here so the tests drive the same code the form does.
//
// Writes the request and a PENDING watch with the same criteria, and hands
// back a wa.me link carrying the watch's code. Nothing is sent, and the
// concierge is not told, until the renter sends that code from their own
// phone - so there is no phone number in this request at all, and a caller
// cannot point our messages at somebody else.
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

import { CONFIRM_TTL_DAYS, generateWatchCode, watchExpiry } from './watch.ts';
import { buildInquiryLink, buildSearchLink, validateInquiryInput } from './inquiry.ts';
import { REPLY_WITHIN_HOURS, areaLabel } from './place.ts';
import { hasPassCover } from './lock-in-run.ts';
import { PASS_DAYS, PASS_PRICE_USD } from './lock-in.ts';
import { reduceInquiry, type InquiryEvent } from '../viewing-domain.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface CreateInquiryResult {
  status: number;
  body: Record<string, unknown>;
}

const refuse = (status: number, error: string, message?: string): CreateInquiryResult =>
  ({ status, body: { error, ...(message ? { message } : {}) } });

/**
 * This account's search still being worked, if any: confirmed and not
 * closed, or sent so recently its code can still arrive.
 */
export async function openSearch(db: Supa, userId: string, now: Date): Promise<{ id: string; label: string } | null> {
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

/** The request, its watch and its first event, from the form's body. */
export async function createInquiry(
  db: Supa,
  raw: unknown,
  opts: { userId: string | null; now: Date; businessPhone: string },
): Promise<CreateInquiryResult> {
  const { now, userId } = opts;
  const input = validateInquiryInput(raw, now);
  if (!input.ok) return refuse(400, 'invalid_request', input.error);
  const v = input.value;

  // ── Where ─────────────────────────────────────────────────────────────────
  let place: { complexId: string | null; codes: string[] | null; name: string };
  if (v.areaDistrictCodes) {
    // Search for me is the Pass's: a person's hours, not a form's.
    if (!userId) return refuse(401, 'sign_in_required', 'Sign in to ask us to search for you.');
    if (!(await hasPassCover(db, userId))) {
      return refuse(402, 'pass_required', `Priority search comes with the Pass ($${PASS_PRICE_USD} for ${PASS_DAYS} days).`);
    }
    const open = await openSearch(db, userId, now);
    if (open) {
      return refuse(409, 'one_open_search',
        `We are still searching ${open.label} for you. One search at a time - reply on that thread to change it.`);
    }
    place = { complexId: null, codes: v.areaDistrictCodes, name: areaLabel(v.areaDistrictCodes) };
  } else {
    const { data: complex } = await db
      .from('complexes').select('id, name, is_published').eq('id', v.complexId).maybeSingle();
    if (!complex || complex.is_published === false) return refuse(404, 'invalid_complex', 'Unknown building.');
    place = { complexId: complex.id, codes: null, name: complex.name };
  }
  const area = place.codes ? { area_district_codes: place.codes, area_label: place.name } : {};

  // ── The handshake ─────────────────────────────────────────────────────────
  const expiresAt = watchExpiry(now, v.moveInDate).toISOString();
  let watch: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !watch; attempt++) {
    const code = generateWatchCode();
    const { data, error } = await db.from('complex_watches').insert({
      id: crypto.randomUUID(),
      complex_id: place.complexId,
      ...area,
      code,
      user_id: userId,
      bedrooms: v.bedrooms,
      budget_max_vnd: v.budgetMaxVnd,
      move_in_by: v.moveInDate,
      expires_at: expiresAt,
      status: 'PENDING',
    }).select('id').single();
    if (!error && data) { watch = { id: data.id, code }; break; }
    if (error?.code !== '23505') {
      console.error('[inquiry-create] watch insert failed:', error);
      return refuse(500, 'create_failed');
    }
  }
  if (!watch) return refuse(500, 'code_collision');

  // ── The request ───────────────────────────────────────────────────────────
  const { data: inquiry, error: inqErr } = await db.from('complex_inquiries').insert({
    id: crypto.randomUUID(),
    complex_id: place.complexId,
    ...area,
    user_id: userId,
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
    console.error('[inquiry-create] inquiry insert failed:', inqErr);
    await db.from('complex_watches').delete().eq('id', watch.id);
    return refuse(500, 'create_failed');
  }

  // The request's log starts here (PLAN-v3 S7.1). It carries the promise, so
  // the reducer - and the console's deadline - know an area has 48 hours.
  const { error: evErr } = await db.from('inquiry_events').insert({
    inquiry_id: inquiry.id, type: 'SUBMITTED', actor: userId ? `USER:${userId}` : 'RENTER',
    payload: {
      bedrooms: v.bedrooms, budget_max_vnd: v.budgetMaxVnd, move_in: v.moveInDate,
      ...(place.codes
        ? { area_district_codes: place.codes, reply_within_hours: REPLY_WITHIN_HOURS.AREA }
        : {}),
    },
    occurred_at: now.toISOString(),
  });
  if (evErr) console.error('[inquiry-create] SUBMITTED failed:', evErr);

  return {
    status: 200,
    body: {
      success: true,
      inquiryId: inquiry.id,
      complexName: place.name,
      kind: place.codes ? 'AREA' : 'BUILDING',
      code: watch.code,
      waLink: place.codes
        ? buildSearchLink(opts.businessPhone, watch.code, place.name)
        : buildInquiryLink(opts.businessPhone, watch.code, place.name),
      alertsUntil: expiresAt,
    },
  };
}
