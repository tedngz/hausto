// A hard daily ceiling on Firecrawl credits (owner's decision, 2026-10-08:
// never more than 50 a day).
//
// Every call to Firecrawl - the crawler's search pages and detail pages
// (scrape-marketplace) and the admin recrawl button (recrawl-external-listing)
// - spends one here first, and none is made once the day's 50 are gone. Each
// scrape is counted as one credit: Firecrawl bills a scrape at the regular
// rate whichever proxy it picks.
//
// Fails closed. A counter that cannot be read cannot promise the ceiling, so a
// Redis outage stops Firecrawl rather than letting it run unmetered - the
// crawler skips a run, which costs a few listings, not money.
//
// The crawler also plans each run against what is left (planRun), so it never
// buys a search page whose listings it then cannot afford to open.

export const FIRECRAWL_DAILY_CREDITS = 50;

/** The day's counter. UTC, as the crawler's own daily counts are kept. */
export function firecrawlBudgetKey(now: Date = new Date()): string {
  return `firecrawl:credits:${now.toISOString().slice(0, 10)}`;
}

export class FirecrawlBudgetError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FirecrawlBudgetError'; }
}

/** The three Redis commands the ceiling needs. */
export interface Counter {
  get(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** Upstash's REST API, which every function here already holds keys for. */
export function upstashCounter(url: string | undefined, token: string | undefined): Counter {
  const call = async (...parts: (string | number)[]): Promise<unknown> => {
    if (!url || !token) throw new Error('Upstash is not configured');
    const res = await fetch(`${url}/${parts.map((p) => encodeURIComponent(String(p))).join('/')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || (body as { error?: string }).error) {
      throw new Error(`Upstash ${parts[0]} failed: ${res.status} ${(body as { error?: string }).error ?? ''}`);
    }
    return (body as { result?: unknown }).result;
  };
  return {
    get: async (key) => Number((await call('get', key)) ?? 0) || 0,
    incr: async (key) => Number(await call('incr', key)),
    decr: async (key) => Number(await call('decr', key)),
    expire: (key, seconds) => call('expire', key, seconds),
  };
}

/**
 * Spend one credit, or throw FirecrawlBudgetError and spend nothing. Call it
 * immediately before each Firecrawl request.
 */
export async function spendFirecrawlCredit(counter: Counter, now: Date = new Date()): Promise<number> {
  const key = firecrawlBudgetKey(now);
  let spent: number;
  try {
    spent = await counter.incr(key);
    // Two days, so a counter read just after midnight UTC is still there.
    await counter.expire(key, 60 * 60 * 48);
  } catch (e) {
    throw new FirecrawlBudgetError(`Firecrawl budget unreadable, not spending: ${(e as Error).message}`);
  }
  if (spent > FIRECRAWL_DAILY_CREDITS) {
    await counter.decr(key).catch(() => {});
    throw new FirecrawlBudgetError(`Firecrawl's ${FIRECRAWL_DAILY_CREDITS} credits for today are spent`);
  }
  return spent;
}

/** Credits left today, or 0 when the counter cannot be read. */
export async function firecrawlCreditsLeft(counter: Counter, now: Date = new Date()): Promise<number> {
  try {
    return Math.max(0, FIRECRAWL_DAILY_CREDITS - await counter.get(firecrawlBudgetKey(now)));
  } catch {
    return 0;
  }
}

/** Sources whose listings are opened with Firecrawl, one credit each. nhatot's
 *  come from the chotot ad payload instead and cost nothing. */
const DETAIL_COSTS_A_CREDIT = new Set(['batdongsan', 'housingsgn']);

/**
 * How many new listings a run may open, given the credits left today: one for
 * the search page (counted even where a direct fetch usually works, since it
 * may fall back), then one per detail page on the sources that need one. A run
 * that could afford only the search page for a source that needs detail pages
 * is not worth starting.
 */
export function planRun(source: string, creditsLeft: number, wanted: number): { run: boolean; maxResults: number } {
  if (creditsLeft < 1 || wanted < 1) return { run: false, maxResults: 0 };
  if (!DETAIL_COSTS_A_CREDIT.has(source)) return { run: true, maxResults: wanted };
  const affordable = Math.min(wanted, creditsLeft - 1);
  return affordable >= 1 ? { run: true, maxResults: affordable } : { run: false, maxResults: 0 };
}
