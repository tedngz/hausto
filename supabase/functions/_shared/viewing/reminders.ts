// Nobody waits a day in silence.
//
// S6's acceptance criterion is that no request can go more than 24 hours
// without the renter hearing something, asserted as a property test. This
// module is the thing that property is asserted about: a pure function from
// (the log, the clock) to the messages that are now due.
//
// Pure, and the clock is a parameter. A scheduler that reads `Date.now()`
// internally cannot be tested against the one case that matters - the moment
// just after the deadline - without waiting for it.

import type { RequestView, RealtorDecision } from '../viewing-domain.ts';
import { summarise } from '../viewing-domain.ts';
import type { DomainEvent } from '../viewing-domain.ts';
import { hcmcLong } from './format.ts';

export const HOUR_MS = 60 * 60 * 1000;

/** The promise. Anything longer than this and we have broken it. */
export const MAX_SILENCE_MS = 24 * HOUR_MS;

/**
 * Act before the deadline, not on it. A job that fires exactly at hour 24 has
 * already lost - the send has to happen, be delivered, and be read, and the
 * first of those can fail and need a retry.
 */
export const SILENCE_ACTION_MS = 20 * HOUR_MS;

/** How long to leave a broker before chasing. */
export const NUDGE_AFTER_MS = 6 * HOUR_MS;

/** The day-before nudge for a viewing the renter has agreed to. */
export const VIEWING_REMINDER_LEAD_MS = 24 * HOUR_MS;

export type ActionKind =
  | 'HOLDING_UPDATE'     // the renter has heard nothing and the clock is running out
  | 'NUDGE_REALTOR'      // a broker has been contacted and has not replied
  | 'VIEWING_REMINDER'   // a confirmed viewing is tomorrow
  | 'CONFIRM_REALTOR'    // the renter kept this viewing; the broker has not been told
  | 'RELEASE_REALTOR';   // the broker is holding time nobody will use

export interface DueAction {
  kind: ActionKind;
  requestId: string;
  itemId?: string;
  /** Why it fired. Goes in the job payload, read when one misbehaves. */
  reason: string;
}

/** Terminal request states. Nothing is due for a request that is over. */
const CLOSED = new Set(['CONFIRMED', 'CANCELLED', 'FAILED_NO_SUPPLY']);

/**
 * When the renter last heard from us.
 *
 * Intake counts: the confirmation page told them we were on it, and the clock
 * starts from that promise rather than from zero. Anything we have since sent
 * them moves it forward.
 */
export function lastHeardFromUs(events: DomainEvent[], createdAt: string): number {
  let last = Date.parse(createdAt);
  for (const e of events) {
    // REPLY_SENT counts: an operator answering their question is the renter
    // hearing from us, and a holding update on top of it would be the second
    // of two messages saying less than the first.
    if (e.type === 'ITINERARY_DELIVERED' || e.type === 'HOLDING_UPDATE_SENT' || e.type === 'REPLY_SENT') {
      last = Math.max(last, Date.parse(e.occurred_at));
    }
  }
  return last;
}

export interface ScheduleInput {
  view: RequestView;
  events: DomainEvent[];
  createdAt: string;
  now: number;
  /** Confirmed slots, so a viewing tomorrow can be reminded about. */
  slots?: { itemId: string; startsAt: string }[];
}

/**
 * Everything owed to this request right now.
 *
 * Returns a list rather than the single most urgent thing, because the caller
 * batches: one renter-facing message may be due at the same moment as three
 * broker nudges, and those are different channels with different rules.
 */
export function dueActions(input: ScheduleInput): DueAction[] {
  const { view, events, createdAt, now } = input;
  const actions: DueAction[] = [];
  const requestId = view.requestId;

  // A confirmed request still owes its viewing reminders - it is closed for
  // coordination, not for the renter. Everything else about a closed request
  // is finished.
  const closed = CLOSED.has(view.state);

  if (!closed) {
    const silentFor = now - lastHeardFromUs(events, createdAt);
    if (silentFor >= SILENCE_ACTION_MS) {
      actions.push({
        kind: 'HOLDING_UPDATE',
        requestId,
        reason: `renter has heard nothing for ${Math.floor(silentFor / HOUR_MS)}h`,
      });
    }

    // Brokers contacted and silent. One nudge per pass; the two-nudge floor on
    // NO_RESPONSE (SPEC §4) is what these feed.
    for (const item of Object.values(view.items)) {
      if (item.state !== 'CONTACTED') continue;
      const contactedAt = lastEventTime(events, item.itemId, ['REALTOR_CONTACTED', 'ITEM_NUDGED']);
      if (contactedAt != null && now - contactedAt >= NUDGE_AFTER_MS) {
        actions.push({
          kind: 'NUDGE_REALTOR',
          requestId,
          itemId: item.itemId,
          reason: `no reply for ${Math.floor((now - contactedAt) / HOUR_MS)}h`,
        });
      }
    }
  }

  for (const owed of realtorDecisionsOwed(view)) {
    actions.push({
      kind: owed.decision === 'CONFIRM' ? 'CONFIRM_REALTOR' : 'RELEASE_REALTOR',
      requestId,
      itemId: owed.itemId,
      reason: `request ${view.state.toLowerCase()}`,
    });
  }

  if (view.state === 'CONFIRMED') {
    for (const slot of input.slots ?? []) {
      const startsAt = Date.parse(slot.startsAt);
      const until = startsAt - now;
      if (until > 0 && until <= VIEWING_REMINDER_LEAD_MS) {
        actions.push({
          kind: 'VIEWING_REMINDER',
          requestId,
          itemId: slot.itemId,
          reason: `viewing in ${Math.floor(until / HOUR_MS)}h`,
        });
      }
    }
  }

  return actions;
}

/**
 * Brokers still waiting to hear what the renter decided.
 *
 * Nothing is owed while the request is open - the renter has not decided. Once
 * it closes, every broker holding time for us is owed an answer: CONFIRM for a
 * viewing the renter kept, RELEASE for one they did not, for a slot offered
 * and never taken, and for a broker still working on a request that ended
 * under them. A broker who said no (rented, unavailable, a new price) is
 * holding nothing and is owed nothing, and neither is one we never reached.
 *
 * Without this the renter's "yes" stopped at us: the broker who offered
 * Saturday at ten was never told to expect anyone, or to stop expecting them.
 */
export function realtorDecisionsOwed(view: RequestView): { itemId: string; decision: RealtorDecision }[] {
  if (!CLOSED.has(view.state)) return [];
  const kept = new Set(view.state === 'CONFIRMED' ? view.confirmedItemIds : []);
  const owed: { itemId: string; decision: RealtorDecision }[] = [];
  for (const item of Object.values(view.items)) {
    if (item.notified) continue;
    // Kept and actually holding a confirmed slot. A kept id on an item that
    // never reached CONFIRMED has no time to name, and telling a broker to
    // hold nothing in particular is a message they cannot act on.
    if (kept.has(item.itemId) && item.state === 'CONFIRMED') {
      owed.push({ itemId: item.itemId, decision: 'CONFIRM' });
    } else if (HOLDING_TIME.has(item.state)) {
      owed.push({ itemId: item.itemId, decision: 'RELEASE' });
    }
  }
  return owed;
}

/** Item states in which a broker is holding a slot, or still looking for one. */
const HOLDING_TIME = new Set(['CONFIRMED', 'ALTERNATIVE_OFFERED', 'CONTACTED']);

function lastEventTime(events: DomainEvent[], itemId: string, types: string[]): number | null {
  let last: number | null = null;
  for (const e of events) {
    if (e.item_id !== itemId || !types.includes(e.type)) continue;
    const t = Date.parse(e.occurred_at);
    if (last == null || t > last) last = t;
  }
  return last;
}

/**
 * The holding update: what we say when there is nothing to report yet.
 *
 * Deliberately not an apology and not a status dump. The renter wants to know
 * they have not been forgotten and roughly when to expect an answer, and any
 * message inside the window is billed - so this one says exactly that and
 * stops.
 */
export function renderHoldingUpdate(opts: { ref: string; view: RequestView }): string {
  const s = summarise(opts.view);
  const heard = s.total - s.unresolved;
  return [
    heard > 0
      ? `Still working on your viewings - we have heard back about ${heard} of ${s.total} so far.`
      : `Still working on your viewings - we are waiting on ${s.total} ${s.total === 1 ? 'agent' : 'agents'}.`,
    'We will send the full plan as soon as we have it, and by tomorrow at the latest.',
    `Ref ${opts.ref}`,
  ].join('\n');
}

/**
 * The day-before reminder for one confirmed viewing.
 *
 * One viewing per message, unlike the itinerary, because this is a nudge about
 * a thing happening tomorrow and a renter re-reading their whole plan the
 * night before is not what it is for. It carries no realtor contact: if plans
 * change the renter tells us, not the broker (§6).
 */
export function renderViewingReminder(opts: {
  ref: string;
  listingTitle: string;
  startsAt: string;
  districtCode: string | null;
}): string {
  return [
    `Reminder: you are viewing ${opts.listingTitle} at ${hcmcLong(opts.startsAt)}` +
      (opts.districtCode ? ` (${opts.districtCode}).` : '.'),
    'Reply here if you need to move it and we will sort it out.',
    `Ref ${opts.ref}`,
  ].join('\n');
}
