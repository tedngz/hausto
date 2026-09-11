// Request intake: everything about turning a shortlist into a request that can
// be decided without touching the database (SPEC §1, §2).
//
// Pure on purpose. The edge function around it does I/O and nothing else, which
// is what lets the rules below be tested without a live Postgres - and what
// keeps "3 to 5 listings" from being re-decided slightly differently in the SPA,
// the function and the ops console.

import { toE164 } from '../whatsapp/inbound.ts';

export { toE164 };

/** A renter shortlists this many. Fewer is not worth an operator's round; more
 *  cannot be viewed in one day, which is what an itinerary is. */
export const MIN_ITEMS = 3;
export const MAX_ITEMS = 5;

/**
 * The human ref, e.g. `HV-4KX2`.
 *
 * Read aloud over a phone and typed back by an operator, so the alphabet drops
 * every character that survives that badly: I/1, O/0, S/5, Z/2, U/V. What is
 * left is 26 symbols, and four of them is ~457k refs - ample at ~25/day, and
 * short enough that nobody abbreviates it.
 */
const REF_ALPHABET = '34679ACDEFGHJKLMNPQRTWXY';

export function generateRef(random: () => number = Math.random): string {
  let body = '';
  for (let i = 0; i < 4; i++) {
    body += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  }
  return `HV-${body}`;
}

export function isValidRef(ref: string): boolean {
  return new RegExp(`^HV-[${REF_ALPHABET}]{4}$`).test(ref);
}

// ── Availability ────────────────────────────────────────────────────────────
// Chips, not a datetime picker. The renter says "Tuesday afternoon"; what time
// on Tuesday is the broker's to answer, and pretending otherwise at intake is
// how you promise a slot you cannot honour (CLAUDE.md invariant 6).

export const DAY_PARTS = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export type DayPart = typeof DAY_PARTS[number];

export interface AvailabilityWindow {
  /** Local calendar date in Asia/Ho_Chi_Minh, `YYYY-MM-DD`. */
  date: string;
  part: DayPart;
}

/** How far ahead a renter may pick. Beyond this the listing data is stale. */
export const MAX_DAYS_AHEAD = 14;

export interface Validation<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

/**
 * `today` is passed in rather than read from a clock: the boundary is a
 * *local* calendar date in Asia/Ho_Chi_Minh, and a function that reads `new
 * Date()` would reject tomorrow-in-Saigon for seven hours every evening UTC.
 */
export function validateAvailability(
  raw: unknown,
  today: string,
): Validation<AvailabilityWindow[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Pick at least one availability window.' };
  }
  if (raw.length > 6) {
    return { ok: false, error: 'Pick at most 6 availability windows.' };
  }

  const seen = new Set<string>();
  const out: AvailabilityWindow[] = [];
  const limit = addDays(today, MAX_DAYS_AHEAD);

  for (const w of raw) {
    const date = String((w as AvailabilityWindow)?.date ?? '');
    const part = String((w as AvailabilityWindow)?.part ?? '') as DayPart;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: `Not a date: ${date || '(missing)'}` };
    }
    if (!DAY_PARTS.includes(part)) {
      return { ok: false, error: `Not a time of day: ${part || '(missing)'}` };
    }
    if (date < today) return { ok: false, error: `${date} is in the past.` };
    if (date > limit) return { ok: false, error: `${date} is more than ${MAX_DAYS_AHEAD} days ahead.` };

    const key = `${date}:${part}`;
    if (seen.has(key)) continue; // A duplicate chip is a double tap, not an error.
    seen.add(key);
    out.push({ date, part });
  }

  out.sort((a, b) =>
    a.date === b.date ? DAY_PARTS.indexOf(a.part) - DAY_PARTS.indexOf(b.part) : a.date < b.date ? -1 : 1);
  return { ok: true, value: out };
}

/** Date arithmetic on the calendar date string, so no timezone is involved. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The local calendar date in Asia/Ho_Chi_Minh for an instant. UTC+7, no DST. */
export function hcmcDate(now: Date): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ── Shortlist ───────────────────────────────────────────────────────────────

export function validateShortlist(raw: unknown): Validation<string[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'listingIds must be an array.' };
  const ids = [...new Set(raw.map(String).map(s => s.trim()).filter(Boolean))];
  if (ids.length < MIN_ITEMS) {
    return { ok: false, error: `Shortlist at least ${MIN_ITEMS} listings (you have ${ids.length}).` };
  }
  if (ids.length > MAX_ITEMS) {
    return { ok: false, error: `Shortlist at most ${MAX_ITEMS} listings (you have ${ids.length}).` };
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const bad = ids.find(id => !uuid.test(id));
  if (bad) return { ok: false, error: `Not a listing id: ${bad}` };
  return { ok: true, value: ids };
}

/**
 * A listing as the shortlist gate sees it. Only the columns the gate reads -
 * the caller selects these and nothing else, so a future column cannot quietly
 * become load-bearing here.
 */
export interface ShortlistCandidate {
  id: string;
  is_active: boolean | null;
  price_vnd: number | null;
  price_confidence: string | null;
  bedrooms: number | null;
  area_sqm: number | null;
  district_code: string | null;
  realtor_id: string | null;
  title: string | null;
}

export interface RejectedListing {
  listingId: string;
  reason: string;
}

/**
 * SPEC §0: a row missing any canonical column is searchable but not
 * shortlistable, and `price_confidence = 'LOW'` is excluded outright. The
 * partial index in the database is the enforcement; this is the explanation,
 * because "constraint violation" is not something to show a renter.
 */
export function screenCandidates(
  requested: string[],
  found: ShortlistCandidate[],
): { eligible: ShortlistCandidate[]; rejected: RejectedListing[] } {
  const byId = new Map(found.map(c => [c.id, c]));
  const eligible: ShortlistCandidate[] = [];
  const rejected: RejectedListing[] = [];

  for (const id of requested) {
    const c = byId.get(id);
    if (!c) { rejected.push({ listingId: id, reason: 'This listing no longer exists.' }); continue; }
    if (!c.is_active) { rejected.push({ listingId: id, reason: 'This listing is no longer live.' }); continue; }
    if (c.price_vnd == null) { rejected.push({ listingId: id, reason: 'We do not have a confirmed price for this one.' }); continue; }
    if (c.price_confidence === 'LOW') { rejected.push({ listingId: id, reason: 'The advertised price for this one does not add up, so we cannot request it.' }); continue; }
    if (c.bedrooms == null) { rejected.push({ listingId: id, reason: 'We do not have a bedroom count for this one.' }); continue; }
    if (c.area_sqm == null) { rejected.push({ listingId: id, reason: 'We do not have a floor area for this one.' }); continue; }
    if (!c.district_code) { rejected.push({ listingId: id, reason: 'We cannot place this one in a district.' }); continue; }
    eligible.push(c);
  }
  return { eligible, rejected };
}

// ── The events an intake writes (SPEC §3) ───────────────────────────────────

export interface NewEvent {
  request_id: string;
  item_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  actor: string;
}

/**
 * Every event an intake produces, in one list.
 *
 * The whole point of invariant 1 is that this is the only way a request comes
 * into existence: rows in `viewing_requests`/`request_items` are the skeleton,
 * and the state they are in is whatever these events reduce to. Built as data
 * so the caller inserts them in a single statement - a partial write here would
 * leave a request whose log does not explain it.
 */
export function intakeEvents(opts: {
  requestId: string;
  availability: AvailabilityWindow[];
  items: { itemId: string; listingId: string; priceVndAtRequest: number; realtorId: string | null }[];
}): NewEvent[] {
  const events: NewEvent[] = [
    {
      request_id: opts.requestId,
      item_id: null,
      type: 'REQUEST_SUBMITTED',
      payload: { availability: opts.availability },
      actor: 'RENTER',
    },
  ];

  for (const item of opts.items) {
    events.push({
      request_id: opts.requestId,
      item_id: item.itemId,
      type: 'ITEM_ADDED',
      payload: { listing_id: item.listingId, price_vnd_at_request: item.priceVndAtRequest },
      actor: 'RENTER',
    });
    // Resolution at ingest is agent identity → phone → NULL (SPEC §1). When the
    // listing already carries a realtor, the request starts knowing who to ring
    // and the event says so; when it does not, NULL is normal and ops resolves
    // it on demand, so there is deliberately no event rather than a null one.
    if (item.realtorId) {
      events.push({
        request_id: opts.requestId,
        item_id: item.itemId,
        type: 'REALTOR_RESOLVED',
        payload: { realtor_id: item.realtorId, method: 'AGENT_ID' },
        actor: 'SYSTEM',
      });
    }
  }
  return events;
}

// ── The handshake ───────────────────────────────────────────────────────────

/**
 * The `wa.me` deep link the confirmation page shows.
 *
 * The renter taps it and sends us the first message - which is what opens the
 * 24-hour service window. Until they do, everything we can send them is a
 * template, and none are approved yet. So this link is not a nicety: on mock
 * and on cloud alike it is the only thing that makes the rest of the flow
 * sendable.
 */
export function buildDeepLink(businessPhoneE164: string, ref: string): string {
  const number = businessPhoneE164.replace(/[^0-9]/g, '');
  const text = `Hi Hausto - my viewing request is ${ref}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** Pull a ref out of an inbound message body, for routing the first reply. */
export function refFromMessage(body: string): string | null {
  const m = String(body ?? '').toUpperCase().match(new RegExp(`HV-[${REF_ALPHABET}]{4}`));
  return m ? m[0] : null;
}

/** `15.000.000 ₫` (SPEC §7). Dong is an integer; never format a float. */
export function formatVnd(dong: number): string {
  return `${Math.round(dong).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}
