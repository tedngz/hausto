// The free tier's AI credits: 10 chat messages a day for a signed-in renter
// without the Pass, unlimited with it (SubscriptionModal sells it that way).
//
// Held in two places on purpose. The renter app checks its own counter before
// sending, which is what shows the friendly wall; chat-ai keeps one too,
// because a check that lives only in the browser binds nobody who calls the
// function directly. Both read FREE_DAILY_AI_CREDITS, so they cannot disagree
// about the number.

export const FREE_DAILY_AI_CREDITS = 10;

/**
 * chat-ai's own counter for one renter and day. The day is UTC, as the renter
 * app's counter has it, so both start again at 07:00 in Ho Chi Minh City.
 */
export function aiCreditKey(userId: string, now: Date = new Date()): string {
  return `chat-ai:credits:${userId}:${now.toISOString().slice(0, 10)}`;
}

/**
 * Whether a message may go ahead, given the credits spent today counting this
 * one. `covered` is asked only past the allowance - it costs a database call,
 * and nine messages in ten never need it.
 */
export function creditAllows(spent: number, covered: () => Promise<boolean>): Promise<boolean> {
  return spent <= FREE_DAILY_AI_CREDITS ? Promise.resolve(true) : covered();
}

/** What a renter reads, in their thread, when today's credits are gone. */
export const CREDITS_USED_REPLY =
  `You've used today's ${FREE_DAILY_AI_CREDITS} free AI credits. They come back tomorrow, ` +
  `or the Pass makes them unlimited.`;
