// What a WhatsApp search may cost, who may spend it, and which messages it
// answers (2026-10-13: search from a cold DM, PLAN-v3 "The WhatsApp agent").
//
// The model call is the cheap part - a fraction of a cent. What these limits
// protect is the reply (billed inside the window from 2026-10-01), the number's
// quality rating, and the listings, which a script could otherwise read out
// three at a time. So every limit counts searches, not tokens.
//
// Pure, like the rest of the agent's decisions. The counts come from
// `renter_searches` (search-run.ts), and a signed-in account's credits from
// chat-ai's own counter, so the web chat and WhatsApp spend one allowance.

import { FREE_DAILY_AI_CREDITS } from '../ai-credits.ts';

/** A number with no account behind it. Smaller than an account's: a number is free to come by. */
export const FREE_NUMBER_DAILY_SEARCHES = 3;

/**
 * Any one number, Pass or not. Unlimited is what the Pass sells; this is the
 * line past which it is a script rather than a renter.
 */
export const NUMBER_DAILY_SEARCH_CAP = 30;

/**
 * Every number together. Per-number limits do nothing against fifty numbers,
 * and this is the one that does. Past it the agent goes quiet rather than
 * answer each new number with an apology - which would be the same cost.
 */
export const GLOBAL_DAILY_SEARCH_CAP = 200;

/**
 * How long a renter has to stop typing before we search. People write "hi",
 * "looking for 2br", "thao dien", "under 20tr" as four messages, and four
 * searches over a quarter of the brief each is four replies and no good one.
 */
export const QUIET_MS = 8_000;
/** And how long we wait for that, at most, before searching what we have. */
export const MAX_SETTLE_MS = 30_000;

/** A burst older than this is not one burst. */
export const BURST_LOOKBACK_MINUTES = 10;
export const BURST_MAX_MESSAGES = 6;
export const BURST_MAX_CHARS = 600;

/**
 * After results, how long a message like "what about district 7" is read as
 * changing the search rather than as a question for an operator.
 */
export const SEARCH_SESSION_MINUTES = 60;

/** How long a renter's last filters are carried into their next search. */
export const PREFERENCES_TTL_DAYS = 7;

export const SEARCH_REFUSALS = ['NUMBER_LIMIT', 'ACCOUNT_CREDITS', 'DAILY_LIMIT', 'GLOBAL_CAP'] as const;
export type SearchRefusal = typeof SEARCH_REFUSALS[number];

/**
 * May this search run?
 *
 * `accountSpent` is the account's credits spent today counting this one, as
 * chat-ai counts them; null when it has not been read, or could not be. Null
 * passes - chat-ai fails open on a Redis outage too, and the number's own cap
 * still holds.
 */
export function searchAllowance(input: {
  /** The number is linked to a signed-in account (`renters.user_id`). */
  linked: boolean;
  hasPass: boolean;
  /** Counted searches by this number since UTC midnight, not counting this one. */
  numberToday: number;
  /** Counted searches by every number since UTC midnight, not counting this one. */
  globalToday: number;
  accountSpent: number | null;
}): { ok: true } | { ok: false; reason: SearchRefusal } {
  if (input.globalToday >= GLOBAL_DAILY_SEARCH_CAP) return { ok: false, reason: 'GLOBAL_CAP' };
  if (input.numberToday >= NUMBER_DAILY_SEARCH_CAP) return { ok: false, reason: 'DAILY_LIMIT' };
  if (!input.linked) {
    return input.numberToday >= FREE_NUMBER_DAILY_SEARCHES ? { ok: false, reason: 'NUMBER_LIMIT' } : { ok: true };
  }
  if (!input.hasPass && input.accountSpent != null && input.accountSpent > FREE_DAILY_AI_CREDITS) {
    return { ok: false, reason: 'ACCOUNT_CREDITS' };
  }
  return { ok: true };
}

/**
 * Midnight UTC, as an ISO string. The day the counts run over - UTC, as
 * chat-ai's credits count it, so "they come back tomorrow" means one thing.
 */
export function dayStartUtc(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** A row of the renter's thread, oldest first. */
export interface ThreadMessage {
  id: string;
  direction: string;
  body: string | null;
  created_at: string;
  idempotency_key?: string | null;
}

/** The greeting a new number gets (agent.ts WELCOME). One send ever, keyed on the renter. */
export const WELCOME_PURPOSE = 'WELCOME';

/**
 * Ours, but not an answer to what the renter is asking for - so a burst runs
 * across it. The greeting goes out the moment "hi" lands, and "looking for a
 * 2br" a second behind it can be stored before or after it.
 */
function passesThrough(m: ThreadMessage): boolean {
  return String(m.idempotency_key ?? '').split(':')[1] === WELCOME_PURPOSE;
}

export type Settled =
  /** The renter is still typing. */
  | { kind: 'WAIT' }
  /**
   * Nothing to answer: the message is not in the thread, or something of
   * ours has gone out since it, which answered it.
   */
  | { kind: 'GONE' }
  | {
    kind: 'READY';
    /** The newest inbound message of the burst - what the search answers, and claims. */
    answersMessageId: string;
    /** The burst's messages, oldest first, joined into one brief. */
    query: string;
  };

/**
 * The burst a message belongs to, once the renter has stopped typing.
 *
 * A burst is the renter's messages since the last thing we sent them (the
 * greeting aside), inside `BURST_LOOKBACK_MINUTES` of the newest. `force` searches whatever is there,
 * typing or not - the caller sets it when `MAX_SETTLE_MS` has gone by.
 */
export function settleBurst(
  thread: ThreadMessage[],
  triggerId: string,
  now: Date,
  force = false,
): Settled {
  const newest = [...thread].reverse().find(m => m.direction === 'IN');
  if (!newest) return { kind: 'GONE' };
  if (!force && Date.parse(newest.created_at) > now.getTime() - QUIET_MS) return { kind: 'WAIT' };

  const floor = Date.parse(newest.created_at) - BURST_LOOKBACK_MINUTES * 60_000;
  const burst: ThreadMessage[] = [];
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i];
    if (m.direction !== 'IN') {
      if (passesThrough(m)) continue;
      break;
    }
    if (Date.parse(m.created_at) < floor || burst.length >= BURST_MAX_MESSAGES) break;
    burst.unshift(m);
  }
  if (!burst.some(m => m.id === triggerId)) return { kind: 'GONE' };

  const text = burst.map(m => String(m.body ?? '').trim()).filter(Boolean).join('\n');
  // The end, if anything has to go: the newest message is the one most
  // likely to say what they want now.
  const query = text.length > BURST_MAX_CHARS ? text.slice(-BURST_MAX_CHARS) : text;
  return { kind: 'READY', answersMessageId: burst[burst.length - 1].id, query };
}
