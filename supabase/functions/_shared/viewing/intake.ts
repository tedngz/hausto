// Request intake: everything about turning a shortlist into a request that can
// be decided without touching the database (SPEC §1, §2).
//
// Pure on purpose. The edge function around it does I/O and nothing else, which
// is what lets the rules below be tested without a live Postgres - and what
// keeps "3 to 5 listings" from being re-decided slightly differently in the SPA,
// the function and the ops console.

import { toE164, toRenterE164 } from '../whatsapp/inbound.ts';

// toE164 for agents (Vietnamese only), toRenterE164 for what a renter types
// (any country, with its code) - the SPA and the function read the same rule.
export { toE164, toRenterE164 };

/** What to tell a renter whose number `toRenterE164` refused. */
export const RENTER_PHONE_HINT =
  'Enter your WhatsApp number: a Vietnamese one like 0901 234 567, or any other with its country code, like +44 7700 900123.';

/**
 * A renter shortlists this many.
 *
 * The ceiling is the real constraint: more than five cannot be viewed in one
 * day, and an itinerary is one day.
 *
 * The floor was three, on the reasoning that a single viewing is not worth an
 * operator's round. That reasoning is about our cost, not the renter's need -
 * and it met them as a refusal on the one action the whole product exists to
 * offer, before they had any reason to trust us with three. Someone who wants
 * one flat seen gets one flat seen; batching is an efficiency we can pursue by
 * suggesting more, not by withholding the first.
 */
export const MIN_ITEMS = 1;
export const MAX_ITEMS = 5;

/**
 * The human ref, e.g. `HV-4KX2`.
 *
 * Read aloud over a phone and typed back by an operator, so the alphabet drops
 * every character that survives that badly: I/1, O/0, S/5, Z/2, U/V. What is
 * left is 26 symbols, and four of them is ~457k refs - ample at ~25/day, and
 * short enough that nobody abbreviates it.
 */
export const REF_ALPHABET = '34679ACDEFGHJKLMNPQRTWXY';

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

/**
 * What each part means on the clock, in Ho Chi Minh City time: `[from, to)` in
 * whole hours, and the start time the console offers when an agent simply says
 * "morning is fine". One definition, because "is 16:30 inside the renter's
 * afternoon?" decides CONFIRMED against ALTERNATIVE_OFFERED, and the console
 * and the reply parser must not answer it differently.
 */
export const DAY_PART_HOURS: Record<DayPart, { from: number; to: number; suggested: number }> = {
  MORNING: { from: 8, to: 12, suggested: 9 },
  AFTERNOON: { from: 12, to: 17, suggested: 14 },
  EVENING: { from: 17, to: 21, suggested: 18 },
};

/** Does this UTC instant fall inside one of the renter's windows? */
export function withinWindows(startsAt: string, windows: { date: string; part: string }[]): boolean {
  const local = new Date(Date.parse(startsAt) + 7 * 60 * 60 * 1000);
  const date = local.toISOString().slice(0, 10);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  return windows.some(w => {
    const h = DAY_PART_HOURS[w.part as DayPart];
    return !!h && w.date === date && hour >= h.from && hour < h.to;
  });
}

export interface AvailabilityWindow {
  /** Local calendar date in Asia/Ho_Chi_Minh, `YYYY-MM-DD`. */
  date: string;
  part: DayPart;
}

/** How far ahead a renter may pick. Beyond this the listing data is stale. */
export const MAX_DAYS_AHEAD = 14;

/**
 * The buffer. Today and tomorrow are never bookable.
 *
 * An operator has to reach every realtor on the shortlist, on Zalo, and wait
 * for each to answer - and the realtor side is a human this quarter, not an
 * API. A request filed at 6pm for tomorrow morning is one nobody can fill, so
 * offering it sells a promise the system cannot keep and spends the renter's
 * evening waiting for it.
 *
 * Enforced here rather than in the date picker so the page and the function
 * cannot disagree: a client that offered tomorrow would have its request
 * rejected on submit, which is a worse experience than never showing it.
 */
export const MIN_LEAD_DAYS = 2;

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
  const earliest = addDays(today, MIN_LEAD_DAYS);

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
    if (date < earliest) {
      return {
        ok: false,
        error: `${date} is too soon - we need until ${earliest} to reach the agents.`,
      };
    }
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

/**
 * Times a renter adds while a place joins their open request (2026-10-08),
 * for a viewing at another time than the ones they first gave.
 *
 * Added, never replacing: every agent already asked was asked about the
 * request's times, and their answers stand. The joining place's agent is asked
 * about all of them, old and new, so the new place can land at a new time.
 * Replacing the times is the Viewings tab's "Change times", which asks every
 * agent again (AVAILABILITY_CHANGED).
 *
 * The added windows pass the same checks as intake's, and the request may hold
 * at most six still ahead.
 */
export function extendAvailability(
  current: AvailabilityWindow[],
  added: unknown,
  today: string,
): Validation<{ availability: AvailabilityWindow[]; added: AvailabilityWindow[] }> {
  const v = validateAvailability(added, today);
  if (!v.ok || !v.value) return { ok: false, error: v.error };
  const have = new Set(current.map(w => `${w.date}:${w.part}`));
  const fresh = v.value.filter(w => !have.has(`${w.date}:${w.part}`));
  if (fresh.length === 0) return { ok: false, error: 'Those times are already in your request.' };
  const ahead = current.filter(w => w.date >= today).length;
  if (ahead + fresh.length > 6) {
    const room = Math.max(0, 6 - ahead);
    return {
      ok: false,
      error: room === 0
        ? 'Your request already has 6 times, the most it can hold.'
        : `Your request can take ${room} more time${room === 1 ? '' : 's'}.`,
    };
  }
  const availability = [...current, ...fresh].sort((a, b) =>
    a.date === b.date ? DAY_PARTS.indexOf(a.part) - DAY_PARTS.indexOf(b.part) : a.date < b.date ? -1 : 1);
  return { ok: true, value: { availability, added: fresh } };
}

/** Date arithmetic on the calendar date string, so no timezone is involved. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export { hcmcDate } from './format.ts';

// ── Move-in ─────────────────────────────────────────────────────────────────

/** How far ahead a move-in date may be. Beyond that it is not a search yet. */
export const MAX_MOVE_IN_DAYS = 180;

/**
 * When the renter expects to move in, `YYYY-MM-DD`, or null.
 *
 * The modal asks for it on every new request: it is the first thing an agent
 * weighs - a unit free now is no use to someone moving in two months from now,
 * and one coming free next month may be exactly right. Null is still
 * accepted, so a request from a page loaded before the field existed is not
 * refused for lacking it.
 *
 * Today is allowed - someone viewing in two days may already be out of their
 * old place - and the past is not. `today` is passed in, as for availability.
 */
export function validateMoveIn(raw: unknown, today: string): Validation<string | null> {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    return { ok: false, error: 'Pick a move-in date.' };
  }
  if (raw < today) return { ok: false, error: 'Move-in date is in the past.' };
  if (raw > addDays(today, MAX_MOVE_IN_DAYS)) {
    return { ok: false, error: 'Move-in date is more than six months away.' };
  }
  return { ok: true, value: raw };
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
 * SPEC §0: a row missing a price, a bedroom count or a district is searchable
 * but cannot be requested, and `price_confidence = 'LOW'` is excluded
 * outright. The reason is shown to the renter, because "constraint violation"
 * is not something to show one.
 *
 * Floor area is not asked for (owner's decision, 2026-10-08). Arranging a
 * viewing never reads it - the agent knows their flat - and requiring it kept
 * one live listing in seven from being requested at all.
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
 * Every event a new request's intake produces, in one list.
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
  /** When the renter expects to move in (validateMoveIn). Absent from older requests. */
  moveInDate?: string | null;
  items: { itemId: string; listingId: string; priceVndAtRequest: number; realtorId: string | null }[];
}): NewEvent[] {
  return [
    {
      request_id: opts.requestId,
      item_id: null,
      type: 'REQUEST_SUBMITTED',
      payload: {
        availability: opts.availability,
        ...(opts.moveInDate ? { move_in_date: opts.moveInDate } : {}),
      },
      actor: 'RENTER',
    },
    ...itemEvents(opts),
  ];
}

/**
 * The events for places joining a request, whether it is new or already open.
 * One builder for both, so a place added later is indistinguishable in the
 * log from one that came with the request - which is what lets the planner,
 * the console and the itinerary treat it the same without knowing.
 */
export function itemEvents(opts: {
  requestId: string;
  items: { itemId: string; listingId: string; priceVndAtRequest: number; realtorId: string | null }[];
}): NewEvent[] {
  const events: NewEvent[] = [];
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

// ── Joining an open request ─────────────────────────────────────────────────
// The modal asks for one place, the one the renter is looking at. Someone who
// wants three flats seen taps "Request viewing" on three cards - and if each
// became its own request, they would get three itineraries, three WhatsApp
// messages (each billed from 2026-10-01, and the third refused by the send
// service), and no clash warning between viewings that were never in the same
// plan. So a place asked for while the renter has a request still being
// arranged joins that request instead.

/** An open request as the join rule sees it, reduced from its log. */
export interface JoinCandidate {
  requestId: string;
  ref: string;
  createdAt: string;
  availability: AvailabilityWindow[];
  listingIds: string[];
  /** Derived state (viewing-domain `RequestState`). */
  state: string;
  delivered: boolean;
  /** Where its plan stands (lock-in.ts `LockInStatus`), once it has one. */
  lockIn?: string;
}

/**
 * The request a new place should join, or null for a fresh one.
 *
 * Only while agents are still being asked (`SUBMITTED`, `CONTACTING`). Once the
 * itinerary is being assembled or has gone out, the renter has been told - or
 * is about to be told - what the plan is, and quietly growing it would mean a
 * second itinerary or a place that never makes it into one.
 *
 * Only while it has room (`MAX_ITEMS` - an itinerary is one day of viewings),
 * and only while at least one of its windows is still offerable under
 * `MIN_LEAD_DAYS`. The new agent is asked about the request's windows, not
 * fresh ones, so a request whose times are all tomorrow or earlier has nothing
 * left to offer the place joining it.
 *
 * The most recent wins if there is more than one.
 */
export function pickJoinable(candidates: JoinCandidate[], today: string): JoinCandidate | null {
  const earliest = addDays(today, MIN_LEAD_DAYS);
  const open = candidates
    .filter(c => (c.state === 'SUBMITTED' || c.state === 'CONTACTING') && !c.delivered)
    .filter(c => c.listingIds.length < MAX_ITEMS)
    .filter(c => c.availability.some(w => w.date >= earliest))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return open[0] ?? null;
}

// ── One request at a time ───────────────────────────────────────────────────
// Each request is real hours of an operator's day and a slot in agents'
// diaries (SPEC §1, §9; who may make one at all is requestGate). So every
// renter - Pass holders included, or $25 buys unlimited operator hours - has
// one request being worked at a time. A place asked for meanwhile joins it
// while its agents are still being asked (pickJoinable); otherwise it waits.

/**
 * Is this request still being worked - so a new one must wait?
 *
 * Before the plan: while its agents are being asked and one of its windows is
 * still ahead. A request whose windows have all gone is stuck, not worked, and
 * must not lock its renter out until a person notices. After the plan: while
 * it can still be locked in, or a payment for it is going through. A plan
 * with nothing to lock in (nothing confirmed) blocks nothing.
 */
export function blocksNewRequest(c: JoinCandidate, today: string): boolean {
  if (c.lockIn === 'OPEN' || c.lockIn === 'PAYING') return true;
  if (c.state === 'SUBMITTED' || c.state === 'CONTACTING' || (c.state === 'ASSEMBLING' && !c.delivered)) {
    return c.availability.some(w => w.date >= today);
  }
  return false;
}

/** What a renter is told when a new request has to wait behind `ref`. */
export function oneOpenRequestMessage(ref: string): string {
  return `We are still working on ${ref}. Once you lock its plan in, or it lapses, you can request more places.`;
}

/** The request a new one waits behind, or null. The newest, if several. */
export function pickBlocking(candidates: JoinCandidate[], today: string): JoinCandidate | null {
  return candidates
    .filter(c => blocksNewRequest(c, today))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

/**
 * Plans a renter without the Pass may let lapse before they need it to request
 * again. Each lapsed plan held agents' slots for nothing.
 */
export const MAX_LAPSED_WITHOUT_PASS = 2;

/**
 * Who may ask us to arrange viewings (owner's decision, 2026-10-07, SPEC §9).
 * Arranging them is what the Pass sells; calling the agent yourself is the
 * free way (SPEC §6). A renter without the Pass gets one taste: a request for
 * one place, on a WhatsApp number whose free viewing is unspent, which locks
 * in free as before. Anything past that - a second place, adding a place to
 * an open request, a spent free viewing, two lapsed plans - needs the Pass.
 *
 * `viewing-request-create` decides with this at submit, and
 * `viewing-request-open` with the same function before the renter picks
 * anything, so the modal never offers a request the server will refuse.
 * `freeViewingAvailable` is null where the number is not yet known - a renter
 * on their first request - and is then taken as unspent; submit, which has
 * the number, decides again.
 */
export type RequestGateRefusal = 'PASS_FOR_MORE_PLACES' | 'PASS_TO_ADD' | 'FREE_VIEWING_USED' | 'LAPSED_PLANS';

export function requestGate(input: {
  hasPass: boolean;
  placeCount: number;
  joining: boolean;
  freeViewingAvailable: boolean | null;
  lapsedPlans: number;
}): { ok: true; freeViewing: boolean } | { ok: false; reason: RequestGateRefusal } {
  if (input.hasPass) return { ok: true, freeViewing: false };
  if (input.joining) return { ok: false, reason: 'PASS_TO_ADD' };
  if (input.lapsedPlans >= MAX_LAPSED_WITHOUT_PASS) return { ok: false, reason: 'LAPSED_PLANS' };
  if (input.freeViewingAvailable === false) return { ok: false, reason: 'FREE_VIEWING_USED' };
  if (input.placeCount > 1) return { ok: false, reason: 'PASS_FOR_MORE_PLACES' };
  return { ok: true, freeViewing: true };
}

/** What each refusal tells the renter. One sentence, then the Pass. */
export function requestGateMessage(reason: RequestGateRefusal, priceUsd: number, days: number): string {
  const pass = `the Pass ($${priceUsd} for ${days} days)`;
  switch (reason) {
    case 'PASS_FOR_MORE_PLACES':
      return `Without the Pass we arrange one place for you, free. To have us arrange more, get ${pass}.`;
    case 'PASS_TO_ADD':
      return `Adding places to a request needs ${pass}.`;
    case 'FREE_VIEWING_USED':
      return `You have had your free viewing. To have us arrange more, get ${pass}.`;
    case 'LAPSED_PLANS':
      return `Two of your plans lapsed without being locked in, so the next request needs ${pass}.`;
  }
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

/**
 * The answer to that first message (2026-10-08): the request is in, which
 * places, what happens next and when. Before this the handshake was answered
 * with silence until the plan or a holding update, and a renter who had just
 * tapped "send" could not tell whether anyone had seen it.
 *
 * One message, sent at once; it does not count towards the three-in-a-row
 * rule (send.ts ACKNOWLEDGEMENT_PURPOSES). No "booking" (invariant 6): the
 * agents have not answered.
 */
export function renderRequestReceived(opts: { ref: string; titles: string[]; siteUrl: string }): string {
  const n = opts.titles.length;
  return [
    `Thanks - we have your request ${opts.ref}${n === 1 ? ` for ${opts.titles[0]}` : n > 1 ? ` for ${n} places:` : '.'}`,
    ...(n > 1 ? opts.titles.map((t, i) => `${i + 1}. ${t}`) : []),
    '',
    `We are asking the ${n === 1 ? 'agent' : 'agents'} now and will message you here with the times that are free, usually within 24 hours.`,
    `To change your times or places, open Viewings on ${opts.siteUrl.replace(/^https?:\/\//, '')}/hub.`,
  ].join('\n');
}

/** Pull a ref out of an inbound message body, for routing the first reply. */
export function refFromMessage(body: string): string | null {
  const m = String(body ?? '').toUpperCase().match(new RegExp(`HV-[${REF_ALPHABET}]{4}`));
  return m ? m[0] : null;
}

export { formatVnd } from './format.ts';
