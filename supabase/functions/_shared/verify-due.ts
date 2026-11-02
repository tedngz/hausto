// Which listings verify-external-listings checks on a run (SPEC §0).
//
// `last_verified_at` says when a listing was last seen alive, by anyone: a
// verification, or a crawl that found it still in the source's feed
// (scrape-marketplace's pre-dedup refresh). For most sources that is all a
// check can establish, so it is what makes a listing due.
//
// Not for the sources a check re-reads - nhatot's ad payload and the agency
// feeds - where a verification also reads back the price and the lease terms.
// A crawl that sees the listing in the feed reads neither, yet its stamp kept
// pushing the check out: a unit still on the feed every day was never checked,
// so its price was never confirmed (and the 21-day decay delists on that), and
// its terms were never read. On 2026-10-27, 266 such listings had been stamped
// within 5 days but not read for longer. So for those sources, due is measured
// from the last read itself: `price_confirmed_at`, and `terms_read_at` for a
// listing never read for terms at all.
//
// Pure: the cadence and the filter string, so the rule is tested without a
// database.

export const RECENT_LISTING_DAYS = 42;      // the 6-week lease window = high churn risk
export const RECENT_REVERIFY_DAYS = 2;      // inside the lease window: check every 2 days
export const OLD_REVERIFY_DAYS = 5;         // past the window: every 5 days
export const SUSPECT_REVERIFY_HOURS = 6;    // already failed once: confirm or clear it fast

const DAY_MS = 86_400_000;

/**
 * The PostgREST `or` filter for "due a check". Never verified, a failure on
 * record past the suspect wait, or past the tier's cadence - counted from the
 * last sighting for most sources, from the last read for `rereadSources`.
 */
export function verificationDueFilter(now: number, rereadSources: readonly string[]): string {
  const iso = (ms: number) => new Date(ms).toISOString();
  const recentCrawl = iso(now - RECENT_LISTING_DAYS * DAY_MS);
  const recentReverify = iso(now - RECENT_REVERIFY_DAYS * DAY_MS);
  const oldReverify = iso(now - OLD_REVERIFY_DAYS * DAY_MS);
  const suspect = iso(now - SUSPECT_REVERIFY_HOURS * 3_600_000);
  const reread = `source.in.(${rereadSources.join(',')})`;
  return [
    'last_verified_at.is.null',
    `and(verification_failures.gte.1,last_verified_at.lte.${suspect})`,
    `and(crawled_at.gte.${recentCrawl},last_verified_at.lte.${recentReverify})`,
    `last_verified_at.lte.${oldReverify}`,
    // The sources a check re-reads, on their last read. A crawl's sighting
    // does not stand in for it. Never confirmed falls back to `crawled_at`,
    // when the price was first read, as the decay sweep does.
    `and(${reread},price_confirmed_at.is.null,crawled_at.lte.${recentReverify})`,
    `and(${reread},crawled_at.gte.${recentCrawl},price_confirmed_at.lte.${recentReverify})`,
    `and(${reread},price_confirmed_at.lte.${oldReverify})`,
    // Never read for lease terms: due now, whatever else says.
    `and(${reread},terms_read_at.is.null)`,
  ].join(',');
}
