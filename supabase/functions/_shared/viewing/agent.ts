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

import { looksLikeRefinement, type Intent } from './intent.ts';
import type { LockInPrompt, RequestReceived, WatchOutcome } from './routing.ts';
import type { WatchProblem } from './watch.ts';
import type { ConfirmedInquiry } from './concierge.ts';
import type { LinkOutcome } from './account-link.ts';

export type AgentAction =
  /** Nothing to do - an operator handles it, or there is nothing to handle. */
  | { kind: 'NONE'; reason: string }
  /** They picked from a list we sent. Create the request and confirm. */
  | { kind: 'RE_REQUEST'; listingIds: string[] }
  /** They picked, but it cannot be honoured. Say why - silence is worse. */
  | { kind: 'SELECTION_PROBLEM'; problem: 'NO_OFFER' | 'EXPIRED' | 'OUT_OF_RANGE' }
  /** They described what they are looking for. Search and answer. */
  | { kind: 'SEARCH'; query: string }
  /** They picked from search results. Send the pages, where viewings are asked for. */
  | { kind: 'SEARCH_PICK'; listingIds: string[] }
  /** A new number's first message, and not a search. Say what to send. */
  | { kind: 'WELCOME' }
  /** They sent a complex-watch code and it is now on. Say so (SPEC §11). */
  | {
    kind: 'WATCH_CONFIRMED';
    watchId: string;
    complexName: string;
    bedrooms: number | null;
    budgetMaxVnd: number | null;
    expiresAt: string;
    /** The availability request the code came from, if any - it changes the words. */
    inquiry?: ConfirmedInquiry;
  }
  /** They sent a code that is unknown or expired. Say what to do instead. */
  | { kind: 'WATCH_PROBLEM'; problem: WatchProblem }
  /** They answered an alert. Send the places it was about. */
  | { kind: 'ALERT_DETAILS'; alertMessageId: string }
  /** They said yes to a plan without the Pass. Say where to lock it in (SPEC §9). */
  | { kind: 'LOCK_IN_LINK'; lockIn: LockInPrompt }
  /** They sent an account link code. Say whether it worked (account-link.ts). */
  | { kind: 'ACCOUNT_LINKED'; link: LinkOutcome }
  /** Their first message on a request still being worked. Say it is in hand. */
  | { kind: 'REQUEST_RECEIVED'; received: RequestReceived };

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
  /** The availability request this answers - a person replies to those. */
  inquiryId?: string;
  /** Set when a "yes" cannot lock the plan in by itself (routing.ts). */
  lockIn?: LockInPrompt;
  /** Set when the message carried an account link code. */
  link?: LinkOutcome;
  /** Set on the handshake of a request still being worked (routing.ts). */
  received?: RequestReceived;
  /**
   * A pick from search results, resolved (routing.ts) - set instead of
   * `selection` when the newest list the renter was shown was a search.
   */
  searchPick?: {
    listingIds?: string[];
    problem?: 'NO_OFFER' | 'EXPIRED' | 'OUT_OF_RANGE';
  };
  /** Search results went to them within SEARCH_SESSION_MINUTES (search-limits.ts). */
  searching?: boolean;
  /** Nothing has passed between us before this message, and they have no request. */
  firstContact?: boolean;
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
  // A link code: the success page told them to send it, so it is answered
  // like a watch code, agent on or off.
  if (!stopping && input.link) return { kind: 'ACCOUNT_LINKED', link: input.link };
  if (!stopping && input.watch) {
    return input.watch.kind === 'CONFIRMED'
      ? {
        kind: 'WATCH_CONFIRMED',
        watchId: input.watch.watchId,
        complexName: input.watch.complexName,
        bedrooms: input.watch.bedrooms,
        budgetMaxVnd: input.watch.budgetMaxVnd,
        expiresAt: input.watch.expiresAt,
        ...(input.watch.inquiry ? { inquiry: input.watch.inquiry } : {}),
      }
      : { kind: 'WATCH_PROBLEM', problem: input.watch.problem };
  }
  // A message on an availability request's thread is for the concierge, who
  // promised the renter a person. Nothing automated answers it, agent on or off.
  if (input.inquiryId) return { kind: 'NONE', reason: 'availability request - the concierge replies' };
  // Any answer to an alert asks for its places, except a no. That includes
  // what the classifier calls a SEARCH: "show me" is the most natural answer to
  // "reply here if you would like to see them", and it trips the seeking-verb
  // rule. Answering what we last asked is right even for a real search - the
  // places go first, and their next message is searched as usual.
  if (!stopping && input.alertMessageId && input.intent !== 'DECLINE') {
    return { kind: 'ALERT_DETAILS', alertMessageId: input.alertMessageId };
  }
  // A "yes" to "lock these in" from a renter without the Pass. Not the
  // agent's judgement either: the plan asked a question, the renter answered
  // it, and a reply cannot lock it in - so the answer is where to, agent on or
  // off. Silence here would leave a renter believing they had said yes.
  if (!stopping && input.lockIn) {
    return { kind: 'LOCK_IN_LINK', lockIn: input.lockIn };
  }
  // The renter's first message, which the confirmation page told them to
  // send: answered with the receipt, agent on or off (owner's decision,
  // 2026-10-08) - they should know a person has the request.
  if (!stopping && input.received) {
    return { kind: 'REQUEST_RECEIVED', received: input.received };
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

  if (input.intent === 'SELECTION' && input.searchPick) {
    // Picked from search results. Not a request from here: the page is where
    // one is made, signed in, with times (invariant 8).
    if (input.searchPick.listingIds?.length) return { kind: 'SEARCH_PICK', listingIds: input.searchPick.listingIds };
    if (input.searchPick.problem) return { kind: 'SELECTION_PROBLEM', problem: input.searchPick.problem };
    return { kind: 'NONE', reason: 'search pick resolved to nothing' };
  }

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

  // Right after results, "what about district 7?" changes the search - it is
  // what an operator would do with it anyway. Only what the classifier could
  // not place, and only within the session: on its own it is a question for a
  // person, as before.
  if (
    input.searching && (input.intent === 'QUESTION' || input.intent === 'UNKNOWN') && looksLikeRefinement(input.text)
  ) {
    return { kind: 'SEARCH', query: input.text };
  }

  // A new number that opened with "hi". Silence is the worst answer to a
  // first message, and one line on what to send is the cheapest good one.
  if (input.firstContact && input.intent !== 'DECLINE') return { kind: 'WELCOME' };

  // CONFIRM, DECLINE, RESCHEDULE, QUESTION, UNKNOWN. Every one of these is a
  // person's job. QUESTION especially: "what floor is it on" is not a search,
  // and answering it with three unrelated flats is worse than not answering.
  return { kind: 'NONE', reason: `intent ${input.intent} routes to an operator` };
}

/** Does this action spend money? Used for the log line, and for deciding. */
export function costsASend(action: AgentAction): boolean {
  return action.kind !== 'NONE';
}
