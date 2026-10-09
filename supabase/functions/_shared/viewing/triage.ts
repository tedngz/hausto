// What the operator works next, and when a request has waited too long.
//
// Lives here rather than in the console because it is a rule about the domain,
// not about a screen: S6 asserts as a property test that no request goes more
// than 24 hours without the renter hearing something, and the reminder job that
// enforces that needs the same answer this queue sorts by. One definition, two
// readers.

import { summarise, type RequestView, type ItemView } from '../viewing-domain.ts';
import { realtorDecisionsOwed } from './reminders.ts';

export const HOUR_MS = 60 * 60 * 1000;

/**
 * The promise: nobody waits a day in silence. The queue turns amber well
 * before that, because a request that first becomes visible at hour 23 is one
 * the operator has already broken.
 */
export const SLA_BREACH_HOURS = 24;
export const SLA_WARN_HOURS = 12;

export type Urgency = 'OK' | 'WARN' | 'LATE';

export function urgency(ageSeconds: number, heardFromUsAt: number | null, now: number): Urgency {
  // The clock runs from the last thing the renter heard, not from intake. A
  // request we answered at hour 20 is not late at hour 25.
  const elapsedMs = heardFromUsAt != null ? now - heardFromUsAt : ageSeconds * 1000;
  if (elapsedMs >= SLA_BREACH_HOURS * HOUR_MS) return 'LATE';
  if (elapsedMs >= SLA_WARN_HOURS * HOUR_MS) return 'WARN';
  return 'OK';
}

/**
 * Items an operator can still act on. Partial success is the happy path
 * (invariant 5), so this is never "how many are left to fix" - three confirmed
 * of five with two dead ends is a finished request, not a 60% one.
 */
export function openItems(view: RequestView): ItemView[] {
  return Object.values(view.items).filter(i => i.state === 'PENDING' || i.state === 'CONTACTED');
}

export interface Triage {
  urgency: Urgency;
  /** Lower sorts first. */
  rank: number;
  /** One line saying what this request is waiting on. */
  waitingOn: string;
  actionable: boolean;
}

/**
 * Rank a request for the queue.
 *
 * The ordering is deliberately not "oldest first". An operator's scarce act is
 * contacting a broker, so requests with brokers still to contact outrank
 * requests that are merely waiting for a reply, and a request in a terminal
 * state drops out of the working set entirely however old it is.
 */
export function triage(
  view: RequestView,
  ageSeconds: number,
  heardFromUsAt: number | null,
  now: number,
  /** Renter replies nobody has answered - see thread.ts. */
  waitingReplies = 0,
): Triage {
  const u = urgency(ageSeconds, heardFromUsAt, now);
  const urgencyRank = u === 'LATE' ? 0 : u === 'WARN' ? 1 : 2;
  const open = openItems(view);
  const s = summarise(view);

  // A renter waiting on an answer outranks everything else at the same
  // urgency, closed requests included: "what is the address?" after a
  // confirmation is still a person talking to us, and every reply that is not
  // a yes or a stop routes here and nowhere else.
  if (waitingReplies > 0) {
    return {
      urgency: u,
      rank: urgencyRank * 10,
      waitingOn: `Renter replied - ${waitingReplies} waiting on us`,
      actionable: true,
    };
  }

  if (view.state === 'CONFIRMED' || view.state === 'CANCELLED' || view.state === 'FAILED_NO_SUPPLY') {
    // Closed for the renter, not yet for the brokers holding time for them.
    // Hiding it now would hide the one job left on it.
    const owed = realtorDecisionsOwed(view).length;
    if (owed > 0) {
      return {
        urgency: 'OK',
        rank: 30,
        waitingOn: `${view.state} - tell ${owed} agent${owed === 1 ? '' : 's'}`,
        actionable: true,
      };
    }
    return { urgency: 'OK', rank: 900, waitingOn: `Closed - ${view.state}`, actionable: false };
  }

  const uncontacted = open.filter(i => i.state === 'PENDING').length;
  if (uncontacted > 0) {
    return {
      urgency: u,
      rank: urgencyRank * 10,
      waitingOn: `${uncontacted} broker${uncontacted === 1 ? '' : 's'} to contact`,
      actionable: true,
    };
  }

  const awaiting = open.filter(i => i.state === 'CONTACTED').length;
  if (awaiting > 0) {
    return {
      urgency: u,
      rank: urgencyRank * 10 + 1,
      waitingOn: `${awaiting} repl${awaiting === 1 ? 'y' : 'ies'} outstanding`,
      actionable: true,
    };
  }

  // Sent as far as it can go: a template told them the plan is ready, and
  // their reply releases it (deliver.ts). Nothing for an operator to do.
  if (view.heldItinerary && !view.deliveredMessageId) {
    return { urgency: 'OK', rank: 50, waitingOn: 'Plan held - goes when the renter replies', actionable: false };
  }

  // Asked for other days: theirs to answer, in the Viewings tab, and new times
  // put the agents back above. A day or two of silence is a to-do of its own
  // (CHASE_RENTER), not this row turning red.
  if (view.otherDaysAsked && s.confirmed === 0) {
    return {
      urgency: 'OK',
      rank: 50,
      waitingOn: view.otherDaysAsked.held
        ? 'Asking for other days - goes when the renter replies'
        : 'Asked the renter for other days',
      actionable: false,
    };
  }

  // Every item has landed. Whether that is an itinerary or a dead end, it is
  // the operator's move either way - and a zero-confirmed request ships with
  // substitutes rather than on its own (invariant 5).
  return {
    urgency: u,
    rank: urgencyRank * 10 + 2,
    waitingOn: s.confirmed > 0
      ? `Ready to assemble - ${s.confirmed} of ${s.total} confirmed`
      : 'Nothing confirmed - tell the renter',
    actionable: true,
  };
}

// Display helpers live in format.ts. Re-exported here because the console
// imports them alongside triage, and a second import line is not worth the
// churn of changing every call site.
export { formatVnd, hcmc, humanAge } from './format.ts';
