// The switch: what the agent does with an inbound message, if anything.
//
// One place decides, and it is pure. The webhook and the mock phone both ask
// this and then obey, so "what would the agent do here" is answerable without a
// database, a model, or a live WhatsApp number.
//
// Three rules shape it, and all three are about restraint rather than
// capability:
//
//   1. **One reply per inbound.** PLAN-v3 says so and the billing makes it
//      matter: from 2026-10-01 every message inside the window is a line item.
//      This returns at most one action, never a list.
//   2. **Only act on what the renter unambiguously asked for.** A wrong
//      automated reply costs money and trust; a missed one costs an operator
//      reading a line. Those are not close, so everything uncertain routes to
//      a person.
//   3. **Off by default.** The caller passes `enabled`, read from
//      VIEWING_AGENT_ENABLED. Nothing here turns itself on. The one carve-out
//      is the complex-watch replies, which are not the agent's to switch off -
//      see the top of `decideAction`.

import type { Intent } from './intent.ts';
import type { WatchOutcome } from './routing.ts';
import type { WatchProblem } from './watch.ts';

export type AgentAction =
  /** Nothing to do - an operator handles it, or there is nothing to handle. */
  | { kind: 'NONE'; reason: string }
  /** They picked from a list we sent. Create the request and confirm. */
  | { kind: 'RE_REQUEST'; listingIds: string[] }
  /** They picked, but it cannot be honoured. Say why - silence is worse. */
  | { kind: 'SELECTION_PROBLEM'; problem: 'NO_OFFER' | 'EXPIRED' | 'OUT_OF_RANGE' }
  /** They described what they are looking for. Search and answer. */
  | { kind: 'SEARCH'; query: string }
  /** They sent a complex-watch code and it is now on. Say so (SPEC §11). */
  | {
    kind: 'WATCH_CONFIRMED';
    watchId: string;
    complexName: string;
    bedrooms: number | null;
    budgetMaxVnd: number | null;
    expiresAt: string;
  }
  /** They sent a code that is unknown or expired. Say what to do instead. */
  | { kind: 'WATCH_PROBLEM'; problem: WatchProblem }
  /** They answered an alert. Send the places it was about. */
  | { kind: 'ALERT_DETAILS'; alertMessageId: string };

export interface AgentInput {
  enabled: boolean;
  intent: Intent | string;
  text: string;
  requestId?: string;
  optedOut: boolean;
  /** True when this reply already closed the request - it gets its own answer. */
  confirmed: boolean;
  selection?: {
    listingIds?: string[];
    problem?: 'NO_OFFER' | 'EXPIRED' | 'OUT_OF_RANGE';
  };
  /** The complex-watch code this message carried, resolved (routing.ts). */
  watch?: WatchOutcome;
  /** The alert this answers, when the last thing we sent was one. */
  alertMessageId?: string;
}

/**
 * What, if anything, the agent should send in response.
 *
 * Every `NONE` carries a reason, because "the agent did nothing" and "the agent
 * is switched off" and "the agent decided not to" are three different facts and
 * only one of them is a bug.
 */
export function decideAction(input: AgentInput): AgentAction {
  // Complex watches (SPEC §11) answer before the switch, and they are the only
  // thing that does. Neither is the agent's judgement: the renter set the
  // watch up on the site, which told them to send us this message, and an
  // alert ends "reply here if you would like to see them". With the agent off
  // both would get silence, on a thread where we promised a reply. Still one
  // reply per inbound, and an opt-out still outranks them.
  const stopping = input.optedOut || input.intent === 'OPT_OUT';
  if (!stopping && input.watch) {
    return input.watch.kind === 'CONFIRMED'
      ? {
        kind: 'WATCH_CONFIRMED',
        watchId: input.watch.watchId,
        complexName: input.watch.complexName,
        bedrooms: input.watch.bedrooms,
        budgetMaxVnd: input.watch.budgetMaxVnd,
        expiresAt: input.watch.expiresAt,
      }
      : { kind: 'WATCH_PROBLEM', problem: input.watch.problem };
  }
  // Any answer to an alert asks for its places, except a no and a new search.
  // "No thanks" wants nothing sent; "anything in D2 under 15tr" is its own
  // question, and the search (when the agent is on) is the better answer.
  if (!stopping && input.alertMessageId && input.intent !== 'DECLINE' && input.intent !== 'SEARCH') {
    return { kind: 'ALERT_DETAILS', alertMessageId: input.alertMessageId };
  }

  if (!input.enabled) return { kind: 'NONE', reason: 'agent disabled' };

  // An opt-out is the one instruction that outranks everything, including a
  // selection in the same message. Replying to it at all would be the wrong
  // answer to "stop messaging me".
  if (input.optedOut || input.intent === 'OPT_OUT') {
    return { kind: 'NONE', reason: 'opted out' };
  }

  // A confirmation that closed a request is answered by the confirmation path,
  // not here. Two replies to one message is exactly what rule 1 forbids.
  if (input.confirmed) return { kind: 'NONE', reason: 'confirmation handled elsewhere' };

  if (input.intent === 'SELECTION') {
    if (input.selection?.listingIds?.length) {
      return { kind: 'RE_REQUEST', listingIds: input.selection.listingIds };
    }
    if (input.selection?.problem) {
      // They picked and we cannot honour it. Saying why beats silence, and it
      // is the cheapest message we send.
      return { kind: 'SELECTION_PROBLEM', problem: input.selection.problem };
    }
    return { kind: 'NONE', reason: 'selection resolved to nothing' };
  }

  if (input.intent === 'SEARCH') {
    return { kind: 'SEARCH', query: input.text };
  }

  // CONFIRM, DECLINE, RESCHEDULE, QUESTION, UNKNOWN. Every one of these is a
  // person's job. QUESTION especially: "what floor is it on" is not a search,
  // and answering it with three unrelated flats is worse than not answering.
  return { kind: 'NONE', reason: `intent ${input.intent} routes to an operator` };
}

/** Does this action spend money? Used for the log line, and for deciding. */
export function costsASend(action: AgentAction): boolean {
  return action.kind !== 'NONE';
}
