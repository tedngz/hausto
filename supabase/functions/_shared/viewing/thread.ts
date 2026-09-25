// Which renter replies are waiting on a person.
//
// Before this, a reschedule, a question or a decline was classified, logged as
// RENTER_REPLIED, and then seen by nobody: the console could not read
// `messages`, and nothing in the queue counted what had arrived. Every reply
// that is not a yes or a stop routes to an operator (intent.ts
// `needsOperator`), so a route that ends nowhere is a renter talking to a wall.
//
// Pure, over the event log, so the queue, the request screen and (later) the
// AI operator all agree on what is outstanding without a second query.

import { sortEvents, type DomainEvent, type RequestState } from '../viewing-domain.ts';
import { needsOperator, type Intent } from './intent.ts';
import { containsPhoneNumber } from './privacy.ts';

export interface WaitingReply {
  messageId: string | null;
  intent: string;
  at: string;
}

/**
 * Intents the agent answers on its own when VIEWING_AGENT_ENABLED is on. A
 * SUGGESTIONS_OFFERED after one of these is its answer; after anything else it
 * is not, since three flats is no reply to "can we do Saturday?".
 */
const AGENT_ANSWERS = new Set(['SEARCH', 'SELECTION']);

/**
 * Replies since the last time a person (or the agent, for what it handles)
 * answered.
 *
 * Cleared by REPLY_SENT (an operator wrote back) or REPLIES_ACKNOWLEDGED (an
 * operator read them and decided nothing was owed). The handshake - the wa.me
 * message that opens the window, flagged by routing.ts - is not a reply to
 * anything and never waits.
 */
export function waitingReplies(events: DomainEvent[]): WaitingReply[] {
  let waiting: WaitingReply[] = [];
  for (const e of sortEvents(events)) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case 'RENTER_REPLIED': {
        if (p.handshake === true) break;
        const intent = String(p.intent ?? 'UNKNOWN');
        if (!needsOperator(intent as Intent)) break;
        waiting.push({
          messageId: typeof p.message_id === 'string' ? p.message_id : null,
          intent,
          at: e.occurred_at,
        });
        break;
      }
      case 'REPLY_SENT':
      case 'REPLIES_ACKNOWLEDGED':
        waiting = [];
        break;
      case 'SUGGESTIONS_OFFERED':
        waiting = waiting.filter(w => !AGENT_ANSWERS.has(w.intent));
        break;
    }
  }
  return waiting;
}

/** Longer than this is not a reply, it is a second itinerary written by hand. */
export const MAX_REPLY_CHARS = 1000;

export type ReplyCheck = { ok: true; body: string } | { ok: false; error: string };

/**
 * What an operator may say to a renter in free text.
 *
 * The console greys the button out for the same reasons, but this runs on the
 * server and is the one that decides. Three rules come from CLAUDE.md rather
 * than taste:
 *
 *  - No phone numbers (invariant 4). The operator has the broker's number on
 *    the same screen, and the renter never gets it - they come back to us.
 *  - No booking vocabulary before CONFIRMED (invariant 6). Until the renter
 *    has said yes to a plan, nothing is booked.
 *  - A hyphen, not an em dash, in anything a user reads. Rewritten rather
 *    than refused, since it is a keyboard habit and not a mistake worth a
 *    round trip.
 */
export function checkOperatorReply(raw: string, state: RequestState): ReplyCheck {
  const body = String(raw ?? '').replace(/[\u2014\u2013]/g, '-').trim();
  if (!body) return { ok: false, error: 'The reply is empty.' };
  if (body.length > MAX_REPLY_CHARS) {
    return { ok: false, error: `Keep it under ${MAX_REPLY_CHARS} characters - this is ${body.length}.` };
  }
  if (containsPhoneNumber(body)) {
    return { ok: false, error: 'No phone numbers to the renter - they reach the agent through us.' };
  }
  if (state !== 'CONFIRMED' && /\bbook(ed|ing|ings)?\b/i.test(body)) {
    return { ok: false, error: 'Nothing is booked until the renter confirms - say "request" or "viewing".' };
  }
  return { ok: true, body };
}
