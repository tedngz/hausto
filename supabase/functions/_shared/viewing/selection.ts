// "Reply with a number." - and what happens when they do.
//
// Both `renderNoSupply` and `renderSearchResults` end with that line, and
// until now nothing read the answer. The renter replied "2" and got silence,
// which is the same class of failure as the substitutes that were never
// produced: a promise in shipped copy with nothing behind it.
//
// PLAN-v3 calls this one-tap re-request, and the "one tap" is the constraint
// that shapes everything here. A renter on a phone types a digit, maybe two,
// occasionally a word. Anything that demands more than that has already lost
// to the web UI they came from.

/** Never act on more than a shortlist's worth from one reply. */
export const MAX_SELECTED = 5;

/**
 * Ordinals, tried first.
 *
 * They have to be, because "the second one" contains both `second` and `one`,
 * and the `one` there is a noun. Matching cardinals in the same pass turns a
 * pick of the second listing into a pick of the second AND the first.
 */
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  // Vietnamese ordinals: "thứ nhất/hai/ba/tư/năm", folded.
  nhat: 1, hai: 2, ba: 3, tu: 4, nam: 5,
};

/** Cardinals, tried only when no ordinal matched. */
const CARDINAL_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
};

/**
 * Which of the offered listings does this reply pick?
 *
 * Returns 1-based positions, deduplicated and in the order the renter named
 * them. Empty when the message is not a selection at all - which is most
 * messages, so being wrong in that direction has to be cheap.
 *
 * `fold` is applied by the caller (intent.ts) or here for standalone use; the
 * function tolerates either.
 */
export function parseSelection(raw: string, maxOffered = MAX_SELECTED): number[] {
  const text = String(raw ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .toLowerCase().trim();
  if (!text) return [];

  // A long message that happens to contain a digit is prose, not a pick. "I
  // viewed 3 places last week and none worked" must not order viewing three.
  if (text.length > 40) return [];

  const found: number[] = [];

  // Digits first, including "1 and 3", "2,3", "1 3".
  for (const m of text.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (n >= 1 && n <= maxOffered) found.push(n);
    // A number outside the offered range is a misunderstanding, not a pick -
    // acting on the ones that happen to be in range would order a viewing the
    // renter did not ask for.
    else return [];
  }

  // Words, ordinals before cardinals, and collected with their position in the
  // text so "third and first" comes back in the order the renter said it.
  if (found.length === 0) {
    for (const table of [ORDINAL_WORDS, CARDINAL_WORDS]) {
      const hits: { at: number; n: number }[] = [];
      for (const [word, n] of Object.entries(table)) {
        if (n > maxOffered) continue;
        // Whole words only: "one" inside "phone" is not a selection.
        const m = new RegExp(`\\b${word}\\b`).exec(text);
        if (m) hits.push({ at: m.index, n });
      }
      if (hits.length > 0) {
        hits.sort((a, b) => a.at - b.at);
        found.push(...hits.map(h => h.n));
        break;
      }
    }
  }

  const unique = [...new Set(found)];
  return unique.slice(0, MAX_SELECTED);
}

/**
 * Is this reply a selection, as opposed to a message that merely contains a
 * number?
 *
 * Deliberately conservative. A false positive books viewings nobody asked for;
 * a false negative routes to an operator, who reads one line. Those costs are
 * not close, so the bar is high: the message has to be short, and it has to be
 * mostly the selection.
 */
export function looksLikeSelection(raw: string, maxOffered = MAX_SELECTED): boolean {
  const picks = parseSelection(raw, maxOffered);
  if (picks.length === 0) return false;

  const text = String(raw ?? '').toLowerCase().trim();
  // Strip the parts that are the selection itself plus the usual politeness,
  // and see what is left. Anything substantial means the renter said something
  // that needs a person.
  const residue = text
    .replace(/\d+/g, '')
    .replace(/\b(and|or|please|pls|thanks|thank you|the|one|ones|number|no|nos|cho|em|minh|a|oi|nhe|xem|can)\b/g, '')
    .replace(/[^a-z]/g, '')
    .trim();
  return residue.length <= 8;
}

export interface Offer {
  /** Listing ids, in the order they were shown. Position 1 is index 0. */
  listingIds: string[];
  offeredAt: string;
}

/** How long an offer stays selectable. */
export const OFFER_TTL_HOURS = 72;

export type ResolveResult =
  | { ok: true; listingIds: string[] }
  | { ok: false; reason: 'NO_OFFER' | 'EXPIRED' | 'OUT_OF_RANGE' };

/**
 * Turn positions into listing ids against what was actually offered.
 *
 * The TTL matters more than it looks. Offers go stale - the listings sell -
 * and a renter replying "2" to a message from last month would otherwise get a
 * viewing arranged on something long gone, which is precisely the experience
 * this whole product exists to remove.
 */
export function resolveSelection(
  positions: number[],
  offer: Offer | null,
  now: Date,
): ResolveResult {
  if (!offer || offer.listingIds.length === 0) return { ok: false, reason: 'NO_OFFER' };

  const ageHours = (now.getTime() - Date.parse(offer.offeredAt)) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours > OFFER_TTL_HOURS) return { ok: false, reason: 'EXPIRED' };

  const ids: string[] = [];
  for (const p of positions) {
    const id = offer.listingIds[p - 1];
    // One bad position invalidates the whole reply rather than silently
    // ordering the subset that resolved. "1 and 4" against three offers means
    // the renter miscounted, and guessing which they meant is worse than asking.
    if (!id) return { ok: false, reason: 'OUT_OF_RANGE' };
    ids.push(id);
  }
  return { ok: true, listingIds: [...new Set(ids)] };
}

/** What we say when a selection cannot be honoured. Never a dead end. */
export function renderSelectionProblem(reason: 'NO_OFFER' | 'EXPIRED' | 'OUT_OF_RANGE'): string {
  switch (reason) {
    case 'EXPIRED':
      return [
        'That list is a few days old now and those places may have gone.',
        'Tell us what you are looking for and we will send fresh ones.',
      ].join('\n');
    case 'OUT_OF_RANGE':
      return 'That number is not on the list - reply with one of the numbers shown.';
    case 'NO_OFFER':
    default:
      return [
        'We do not have a list open for you at the moment.',
        'Tell us what you are looking for and we will find some.',
      ].join('\n');
  }
}

/** Confirmation that a re-request was made. One message, as always. */
export function renderReRequested(opts: { ref: string; titles: string[] }): string {
  const n = opts.titles.length;
  return [
    n === 1
      ? `Got it - we are contacting the agent for ${opts.titles[0]}.`
      : `Got it - we are contacting the agents for ${n} places:`,
    ...(n === 1 ? [] : opts.titles.map(t => `- ${t}`)),
    'We will come back with the times that are actually free, usually within a day.',
    `Ref ${opts.ref}`,
  ].join('\n');
}
