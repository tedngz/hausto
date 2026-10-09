// Complex watches: "tell me when a place comes up at Empire City" (SPEC §11).
//
// The complex page used to offer only an email form that a person answered by
// hand, once. A watch keeps asking on the renter's behalf, and says so on
// WhatsApp when something turns up. Three decisions shape it:
//
//   * **The renter opts in by messaging us, not by typing a number.** The page
//     hands them a wa.me link carrying a code; sending it proves they own the
//     phone, opens the service window, and is the most explicit consent a
//     proactive message can have. A typed number would let anyone make Hausto
//     message a stranger, and the spam reports that follow cost the number its
//     quality rating.
//   * **It rides the weekly digest.** Same sweep, same `weekly_digest`
//     template ("{{2}} new places this week in {{3}}", with the complex name in
//     {{3}}), same one-message-per-renter-per-week key. A renter with a watch
//     and the digest gets one message, not two.
//   * **The reply is the detail.** A template cannot carry a list, so the
//     renter answers it, the window opens, and the places go free-form with
//     links. From there it is the one way to ask for a viewing (invariant 8):
//     open the listing, tap Request viewing.
//
// Pure. The I/O lives in alerts.ts, routing.ts and the sweep.

import { REF_ALPHABET, screenCandidates, type ShortlistCandidate } from './intake.ts';
import { formatVnd, hcmcDate } from './format.ts';
import { MAX_DIGEST_LISTINGS, placeSummary } from './digest.ts';
import type { AlertSource } from '../viewing-domain.ts';

export const SITE_URL = 'https://hausto.com';

/** A code nobody sent within a week is abandoned, and stops working. */
export const CONFIRM_TTL_DAYS = 7;

/** How long a watch runs when the renter gave no move-in date. */
export const DEFAULT_WATCH_DAYS = 60;

/** A move-in date keeps it running a fortnight past, capped here. */
export const MAX_WATCH_DAYS = 120;
export const MOVE_IN_GRACE_DAYS = 14;

/** How far ahead a move-in date may be. Beyond that it is not a search yet. */
export const MAX_MOVE_IN_DAYS = 180;

/** A reply this long after an alert is about something else. */
export const ALERT_REPLY_DAYS = 7;

/** `4` on a watch means four or more. */
export const MAX_BEDROOMS = 4;

/** Below this a budget is a typo in millions, above it a typo in zeros. */
export const MIN_BUDGET_VND = 3_000_000;
export const MAX_BUDGET_VND = 500_000_000;

const DAY_MS = 86_400_000;

// ── The code ────────────────────────────────────────────────────────────────

/** `HW-4KX9`. The viewing ref's alphabet, a different prefix. */
export function generateWatchCode(random: () => number = Math.random): string {
  let body = '';
  for (let i = 0; i < 4; i++) body += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  return `HW-${body}`;
}

/** Pull a watch code out of an inbound message, if it carries one. */
export function watchCodeFromMessage(body: string): string | null {
  const m = String(body ?? '').toUpperCase().match(new RegExp(`HW-[${REF_ALPHABET}]{4}`));
  return m ? m[0] : null;
}

/**
 * The link the page shows. Tapping it and pressing send is the opt-in, so the
 * text says plainly what the renter is agreeing to.
 */
export function buildWatchLink(businessPhoneE164: string, code: string, complexName: string): string {
  const number = businessPhoneE164.replace(/[^0-9]/g, '');
  const text = `Hi Hausto - alert me about new places at ${complexName} (${code})`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

// ── What the renter asked for ───────────────────────────────────────────────

export interface WatchCriteria {
  /** 1-4, where 4 means four or more. Null is any size. */
  bedrooms: number | null;
  /** Monthly ceiling in dong. Null is any price. */
  budgetMaxVnd: number | null;
  /** `YYYY-MM-DD`, Asia/Ho_Chi_Minh. Decides when the watch ends. */
  moveInBy: string | null;
}

export type WatchValidation = { ok: true; value: WatchCriteria } | { ok: false; error: string };

// deno-lint-ignore no-explicit-any
export function validateWatchInput(raw: any, now: Date): WatchValidation {
  const bedrooms = raw?.bedrooms ?? null;
  if (bedrooms !== null && !(Number.isInteger(bedrooms) && bedrooms >= 1 && bedrooms <= MAX_BEDROOMS)) {
    return { ok: false, error: 'Pick a number of bedrooms from 1 to 4+.' };
  }

  const budget = raw?.budgetMaxVnd ?? null;
  if (budget !== null && !(Number.isInteger(budget) && budget >= MIN_BUDGET_VND && budget <= MAX_BUDGET_VND)) {
    return { ok: false, error: `Budget must be between ${formatVnd(MIN_BUDGET_VND)} and ${formatVnd(MAX_BUDGET_VND)} a month.` };
  }

  const moveIn = raw?.moveInBy ?? null;
  if (moveIn !== null) {
    if (typeof moveIn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(moveIn) || Number.isNaN(Date.parse(moveIn))) {
      return { ok: false, error: 'Move-in date is not a date.' };
    }
    const today = hcmcDate(now);
    const latest = hcmcDate(new Date(now.getTime() + MAX_MOVE_IN_DAYS * DAY_MS));
    if (moveIn < today) return { ok: false, error: 'Move-in date is in the past.' };
    if (moveIn > latest) return { ok: false, error: 'Move-in date is more than six months away.' };
  }

  return { ok: true, value: { bedrooms, budgetMaxVnd: budget, moveInBy: moveIn } };
}

/**
 * When the watch stops. A fortnight past the move-in date - a renter who has
 * not found somewhere by then has either moved or stopped reading - and never
 * more than MAX_WATCH_DAYS, so nothing runs forever on a form filled in once.
 */
export function watchExpiry(now: Date, moveInBy: string | null): Date {
  const cap = new Date(now.getTime() + MAX_WATCH_DAYS * DAY_MS);
  if (!moveInBy) return new Date(now.getTime() + DEFAULT_WATCH_DAYS * DAY_MS);
  // End of the grace day in Ho Chi Minh City (UTC+7).
  const end = new Date(Date.parse(`${moveInBy}T23:59:59+07:00`) + MOVE_IN_GRACE_DAYS * DAY_MS);
  return end < cap ? end : cap;
}

/** Can a code created at `createdAt` still be confirmed? */
export function codeUsable(createdAt: string, expiresAt: string, now: Date): 'OK' | 'EXPIRED' {
  if (now.getTime() - Date.parse(createdAt) > CONFIRM_TTL_DAYS * DAY_MS) return 'EXPIRED';
  if (Date.parse(expiresAt) <= now.getTime()) return 'EXPIRED';
  return 'OK';
}

// ── Matching ────────────────────────────────────────────────────────────────

export interface ActiveWatch {
  id: string;
  /** Null for an area watch (Priority search), which follows districts instead. */
  complex_id: string | null;
  area_district_codes?: string[] | null;
  area_label?: string | null;
  bedrooms: number | null;
  budget_max_vnd: number | null;
  confirmed_at: string;
}

export type WatchListing = ShortlistCandidate & { created_at: string };

/**
 * Does this listing answer this watch?
 *
 * Only listings that could actually be requested: the same gate intake uses,
 * so an alert never points at a place the Request viewing button would then
 * refuse. And only listings that appeared after the renter confirmed - the
 * ones before were on the page they set the watch from.
 */
export function matchesWatch(watch: ActiveWatch, listing: WatchListing): boolean {
  if (screenCandidates([listing.id], [listing]).eligible.length === 0) return false;
  if (listing.created_at < watch.confirmed_at) return false;
  if (watch.bedrooms != null) {
    const beds = listing.bedrooms ?? 0;
    if (watch.bedrooms >= MAX_BEDROOMS ? beds < MAX_BEDROOMS : beds !== watch.bedrooms) return false;
  }
  if (watch.budget_max_vnd != null && (listing.price_vnd ?? Infinity) > watch.budget_max_vnd) return false;
  return true;
}

// ── One message ─────────────────────────────────────────────────────────────

export interface AlertCandidate {
  listingId: string;
  title: string | null;
  priceVnd: number | null;
  bedrooms: number | null;
  source: AlertSource;
  watchId: string | null;
  /** Where it is, for the template's {{3}}: a complex name, or a district. */
  label: string | null;
}

/**
 * What goes in this week's message, across every watch and the digest.
 *
 * Watches first: they are what the renter explicitly asked for, and the
 * digest is a guess from their history. Nothing already put in front of them
 * is put there again - a listing alerted last week and still live is not news.
 */
export function planAlert(candidates: AlertCandidate[], alreadyAlerted: Set<string>): AlertCandidate[] {
  const ordered = [
    ...candidates.filter(c => c.source === 'WATCH'),
    ...candidates.filter(c => c.source !== 'WATCH'),
  ];
  const seen = new Set<string>();
  const out: AlertCandidate[] = [];
  for (const c of ordered) {
    if (alreadyAlerted.has(c.listingId) || seen.has(c.listingId)) continue;
    seen.add(c.listingId);
    out.push(c);
    if (out.length >= MAX_DIGEST_LISTINGS) break;
  }
  return out;
}

/** `weekly_digest`'s three parameters, for a message that may mix sources. */
export function alertParams(renterName: string | null, items: AlertCandidate[]): string[] {
  return [
    renterName?.trim() || 'there',
    String(items.length),
    placeSummary(items.map(i => i.label)),
  ];
}

// ── The words ───────────────────────────────────────────────────────────────

function bedsText(n: number | null): string | null {
  if (n == null) return null;
  if (n >= MAX_BEDROOMS) return `${MAX_BEDROOMS}+ bedrooms`;
  return n === 1 ? '1 bedroom' : `${n} bedrooms`;
}

function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short' });
}

/** The answer to the code. The only message a watch sends inside a day. */
export function renderWatchConfirmed(opts: {
  complexName: string;
  bedrooms: number | null;
  budgetMaxVnd: number | null;
  expiresAt: string;
}): string {
  const criteria = [
    bedsText(opts.bedrooms),
    opts.budgetMaxVnd != null ? `up to ${formatVnd(opts.budgetMaxVnd)} a month` : null,
  ].filter(Boolean).join(', ');

  const fits = criteria
    ? `When a new place there fits - ${criteria} - we will message you here.`
    : 'When a new place comes up there, we will message you here.';

  return [
    `You're on the list for ${opts.complexName}. ${fits}`,
    `We check once a week, until ${dayMonth(opts.expiresAt)}. Reply STOP any time to end alerts.`,
  ].join('\n\n');
}

export type WatchProblem = 'UNKNOWN' | 'EXPIRED';

export function renderWatchProblem(problem: WatchProblem): string {
  // Codes come from availability requests and from alerts alike, so the words
  // name neither.
  const again = "Send your request again from the building's page on hausto.com, then the new message it gives you.";
  return problem === 'EXPIRED'
    ? `That code has expired - codes last a week. ${again}`
    : `We could not find that code. ${again}`;
}

export function listingUrl(listingId: string): string {
  return `${SITE_URL}/property/${listingId}`;
}

/**
 * The places themselves. Sent when the renter answers the template, or
 * straight away when their window is already open.
 *
 * Each has a link rather than a number to reply with: the listing page is
 * where Request viewing lives, and a second way to ask (invariant 8) would be
 * a second set of rules about credits and dates.
 */
export function renderAlertDetails(
  items: AlertCandidate[],
  opts: { intro?: string } = {},
): string {
  if (items.length === 0) {
    return 'Those have all gone since we messaged you - places move fast. ' +
      'We will keep watching and message you when the next one comes up.';
  }
  const lines = items.map((it, i) => {
    const facts = [
      bedsText(it.bedrooms),
      it.priceVnd != null ? `${formatVnd(it.priceVnd)} a month` : null,
      it.label,
    ].filter(Boolean).join(' · ');
    return `${i + 1}. ${it.title ?? 'A place'}\n${facts}\n${listingUrl(it.listingId)}`;
  });
  return [
    opts.intro ?? 'Here they are:',
    ...lines,
    'To see one in person, open it and tap Request viewing - we arrange it with the agent for you.',
  ].join('\n\n');
}

/** The free-form intro when the window is already open and no template is needed. */
export function alertIntro(items: AlertCandidate[], opts: { run?: 1 | 2 } = {}): string {
  const n = items.length;
  const places = placeSummary(items.map(i => i.label));
  // The Friday digest is the week's second: "this week" again would read as a
  // repeat, so it says what it is instead - the new_places template's words.
  return opts.run === 2
    ? `${n === 1 ? 'A new place' : `${n} new places`} in ${places} ${n === 1 ? 'fits' : 'fit'} what you are looking for:`
    : `${n === 1 ? 'A new place' : `${n} new places`} this week in ${places}:`;
}
