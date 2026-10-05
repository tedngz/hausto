// Locking in a plan: the one paid step (the pricing rework, SPEC §9).
//
// Requests are free. Agents confirm times before anyone pays, and the plan -
// each stop's place, day and time, never an agent - is the pitch. The renter
// then locks it in: with the Pass, which covers every stop, or with the free
// viewing, which covers one stop, once per WhatsApp number. Nothing confirmed,
// nothing owed.
//
// Agents hold a slot until then, so a plan has a deadline. At it, a plan that
// is not locked in is cancelled by rule (CANCEL_REASONS `NOT_LOCKED_IN`), and
// its agents are owed a release through the existing RELEASE_REALTOR job.
//
// Pure: no clock, no I/O. Callers pass `now`, and the decision about who may
// lock what in lives here once, for the page, the payment and the "yes" on
// WhatsApp alike (lock-in-run.ts does the reading and writing).

import type { Cover, RequestView } from '../viewing-domain.ts';
import { hcmcDate, hcmcLong } from './format.ts';

const HOUR_MS = 60 * 60 * 1000;

/** A plan may wait this long after it reaches the renter... */
export const LOCK_IN_WINDOW_MS = 24 * HOUR_MS;
/** ...but no later than this hour, Ho Chi Minh City time, the day before the first stop... */
export const LOCK_IN_CUTOFF_HOUR = 18;
/** ...and never less than this, counted from when the plan itself was delivered. */
export const LOCK_IN_MIN_WINDOW_MS = 3 * HOUR_MS;

/** What the Pass costs, said wherever a request is made or a plan is locked in. */
export const PASS_PRICE_USD = 25;
export const PASS_DAYS = 30;

/** Where a renter locks a plan in. */
export const lockInPath = (ref: string) => `/lock-in/${ref}`;

/**
 * The stops a lock-in can keep: items an agent confirmed, with a time, earliest
 * first. Partial success is the happy path (invariant 5) - three of five is a
 * plan like any other.
 */
export function lockableStops(view: RequestView): { itemId: string; startsAt: string }[] {
  const stops: { itemId: string; startsAt: string }[] = [];
  for (const item of Object.values(view.items)) {
    if (item.state !== 'CONFIRMED') continue;
    const startsAt = (item.slots[0] as { starts_at?: unknown } | undefined)?.starts_at;
    if (typeof startsAt === 'string') stops.push({ itemId: item.itemId, startsAt });
  }
  return stops.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
}

/** 18:00 in Ho Chi Minh City on the day before `startsAt`, as a UTC instant. */
function cutoffBefore(startsAt: string): number {
  const day = hcmcDate(new Date(startsAt));
  const before = new Date(`${day}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  // UTC+7, no DST: 18:00 local is 11:00 UTC on the same date.
  return before.getTime() + (LOCK_IN_CUTOFF_HOUR - 7) * HOUR_MS;
}

/**
 * When the plan stops waiting, or null for a request with no plan to lock in.
 *
 * The earlier of 24 hours after the plan arrived and 18:00 the day before the
 * first stop - viewings are at least two days out, so there is usually room -
 * but never less than three hours with the plan in hand: a plan that arrives
 * at 17:00 the day before still gets until 20:00.
 *
 * "Arrived" is the first time the renter heard it was ready, held behind a
 * template or in full: agents have been holding slots since then. The three
 * hours run from the last full delivery, since only that carries the link.
 */
export function lockInDeadline(view: RequestView): string | null {
  if (!view.planArrivedAt) return null;
  const stops = lockableStops(view);
  if (stops.length === 0) return null;
  const arrived = Date.parse(view.planArrivedAt);
  const base = Math.min(arrived + LOCK_IN_WINDOW_MS, cutoffBefore(stops[0].startsAt));
  const shown = view.lastDeliveredAt ? Math.max(arrived, Date.parse(view.lastDeliveredAt)) : arrived;
  // Up to the quarter hour, so the plan says "by 14:45" rather than "by
  // 14:37" - never earlier than the rules above, so the renter only gains.
  const at = Math.max(base, shown + LOCK_IN_MIN_WINDOW_MS);
  return new Date(Math.ceil(at / QUARTER_HOUR_MS) * QUARTER_HOUR_MS).toISOString();
}

const QUARTER_HOUR_MS = 15 * 60 * 1000;

export type LockInStatus =
  /** Nothing to lock in yet: agents still being asked, or nothing confirmed. */
  | 'NOT_READY'
  /** A plan is waiting, inside its deadline. */
  | 'OPEN'
  /** Past the deadline, but a checkout opened in time is still open. */
  | 'PAYING'
  /** Past the deadline with nothing in flight: cancelled on the next pass. */
  | 'LAPSED'
  | 'LOCKED_IN'
  /** Cancelled, or nothing could be confirmed. */
  | 'CLOSED';

/** Is a plan in front of the renter - delivered, or held behind a template? */
function planWaiting(view: RequestView): boolean {
  return view.state === 'DELIVERED' || (view.state === 'ASSEMBLING' && !!view.heldItinerary);
}

/**
 * A checkout opened before the deadline, still open at `now`. Honoured even if
 * it completes after the deadline, so the deadline waits for it rather than
 * cancel a plan under a renter who is paying.
 */
function checkoutInFlight(view: RequestView, deadline: string, now: number): boolean {
  return view.checkouts.some(c => c.openedAt < deadline && Date.parse(c.expiresAt) > now);
}

export function lockInStatus(view: RequestView, now: number): LockInStatus {
  if (view.state === 'CONFIRMED') return 'LOCKED_IN';
  if (view.state === 'CANCELLED' || view.state === 'FAILED_NO_SUPPLY') return 'CLOSED';
  const deadline = lockInDeadline(view);
  if (!planWaiting(view) || !deadline) return 'NOT_READY';
  if (now < Date.parse(deadline)) return 'OPEN';
  return checkoutInFlight(view, deadline, now) ? 'PAYING' : 'LAPSED';
}

/**
 * May this checkout's payment lock the plan in? Only one opened before the
 * deadline, on a plan still waiting. A checkout that completes after the plan
 * was cancelled buys a Pass and keeps nothing - a person refunds or extends it
 * (Before launch: the refund policy).
 */
export function checkoutHonoured(view: RequestView, checkoutId: string): boolean {
  if (!planWaiting(view)) return false;
  const deadline = lockInDeadline(view);
  const c = view.checkouts.find(x => x.checkoutId === checkoutId);
  return !!deadline && !!c && c.openedAt < deadline;
}

export type LockInChoice =
  | { cover: 'PASS' }
  | { cover: 'FREE_VIEWING'; itemId?: string | null };

export type LockInRefusal =
  | 'NOTHING_TO_LOCK'     // no confirmed stop
  | 'NEEDS_PASS'          // asked to lock in with a Pass they do not hold
  | 'FREE_VIEWING_USED'   // this WhatsApp number has had its free viewing
  | 'PICK_A_PLACE'        // the free viewing covers one stop, and none was named
  | 'NOT_IN_PLAN';        // the stop named is not one of the plan's

export type LockInDecision =
  | { ok: true; cover: Cover; confirmedItemIds: string[] }
  | { ok: false; reason: LockInRefusal };

/**
 * One function decides cover at lock-in, so the page, the payment and a "yes"
 * on WhatsApp cannot disagree about what a renter is owed.
 *
 * A Pass holder is always covered for every stop, whatever they asked for -
 * they never spend the free viewing. Without one, the free viewing covers the
 * stop they pick (or the only one).
 */
export function decideLockIn(input: {
  stopItemIds: string[];
  hasPass: boolean;
  freeViewingAvailable: boolean;
  choice: LockInChoice;
}): LockInDecision {
  const { stopItemIds, hasPass, freeViewingAvailable, choice } = input;
  if (stopItemIds.length === 0) return { ok: false, reason: 'NOTHING_TO_LOCK' };
  if (hasPass) return { ok: true, cover: 'PASS', confirmedItemIds: [...stopItemIds] };
  if (choice.cover === 'PASS') return { ok: false, reason: 'NEEDS_PASS' };
  if (!freeViewingAvailable) return { ok: false, reason: 'FREE_VIEWING_USED' };
  const itemId = choice.itemId ?? (stopItemIds.length === 1 ? stopItemIds[0] : null);
  if (!itemId) return { ok: false, reason: 'PICK_A_PLACE' };
  if (!stopItemIds.includes(itemId)) return { ok: false, reason: 'NOT_IN_PLAN' };
  return { ok: true, cover: 'FREE_VIEWING', confirmedItemIds: [itemId] };
}

/** What a refusal means to the renter, on the lock-in page. */
export const LOCK_IN_REFUSAL_COPY: Record<LockInRefusal, string> = {
  NOTHING_TO_LOCK: 'There is nothing confirmed in this plan to lock in.',
  NEEDS_PASS: `Locking in every place needs the Pass ($${PASS_PRICE_USD} for ${PASS_DAYS} days).`,
  FREE_VIEWING_USED: 'The free viewing on this WhatsApp number has been used.',
  PICK_A_PLACE: 'Pick the place your free viewing is for.',
  NOT_IN_PLAN: 'That place is not in this plan.',
};

/**
 * The line that replaces "Reply YES to lock these in" for a renter without the
 * Pass: where to lock in, by when, and what it costs. Free-form only - a pay
 * link never goes in a template (Meta reclasses a sales pitch as marketing).
 */
export function renderLockInLine(opts: {
  siteUrl: string;
  ref: string;
  deadline: string;
  freeViewingAvailable: boolean;
}): string {
  const url = `${opts.siteUrl}${lockInPath(opts.ref)}`;
  const by = hcmcLong(opts.deadline);
  return opts.freeViewingAvailable
    ? `Lock these in by ${by}: ${url}\nYour first viewing is on us, and the Pass ($${PASS_PRICE_USD} for ${PASS_DAYS} days) covers them all.`
    : `Lock these in with the Pass ($${PASS_PRICE_USD} for ${PASS_DAYS} days) by ${by}: ${url}`;
}

/**
 * The one reply to a "yes" from a renter without the Pass: it cannot lock the
 * plan in on its own, so it says where to.
 */
export function renderLockInReply(opts: {
  siteUrl: string;
  ref: string;
  deadline: string;
  freeViewingAvailable: boolean;
}): string {
  return [
    renderLockInLine(opts),
    `Ref ${opts.ref}`,
  ].join('\n');
}
