// One WhatsApp search, from the renter's message to the one reply.
//
// Out of viewing-agent-search so the rehearsal can drive it against FakeDb and
// MockAdapter - the model, the search endpoint, chat-ai's credit counter and
// the clock come in as `SearchDeps`, and everything else is the real path.
//
// The order is the point:
//
//   1. Wait for the renter to stop typing, and gather the burst (settleBurst).
//   2. Claim the burst - `renter_searches.answers_message_id` is unique, so two
//      dispatches that settle on the same messages answer them once.
//   3. Ask whether it may run (searchAllowance). Before the model, so a
//      refusal costs nothing but, at most, one message a day.
//   4. Model, endpoint, prices, one message.
//
// A failure after the claim un-counts the search: the renter got nothing, and
// should not pay for it.

import type { WhatsAppAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { sendFreeForm, ServiceWindowClosedError, ConsecutiveMessageError, OptedOutError } from '../whatsapp/send.ts';
import {
  extractionMessages,
  hasAnyFilter,
  renderNeedMore,
  renderSearchRefused,
  renderSearchResults,
  validateFilters,
  MAX_RESULTS,
  type SearchFilters,
  type SearchResult,
} from './search.ts';
import {
  BURST_LOOKBACK_MINUTES,
  dayStartUtc,
  MAX_SETTLE_MS,
  PREFERENCES_TTL_DAYS,
  QUIET_MS,
  searchAllowance,
  settleBurst,
  type SearchRefusal,
  type Settled,
  type ThreadMessage,
} from './search-limits.ts';
import { hasPassCover } from './lock-in-run.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export type ChatMessage = { role: 'system' | 'user'; content: string };

export interface SearchDeps {
  /** The model: messages in, its JSON out, unvalidated. Throws on failure, or when the budget is spent. */
  extract(messages: ChatMessage[]): Promise<unknown>;
  /** `public-property-search`. Throws on failure. */
  search(filters: SearchFilters): Promise<SearchResult[]>;
  /**
   * chat-ai's credit counter for an account (ai-credits.ts). `spend` returns
   * today's count including this one, or null when it cannot be read.
   */
  credits: {
    spend(userId: string): Promise<number | null>;
    refund(userId: string): Promise<void>;
  };
  sleep(ms: number): Promise<void>;
  now(): Date;
  siteUrl: string;
}

export type SearchRunResult =
  | { status: 'SENT'; searchId: string; messageId: string; matched: number; preview: string }
  /** Someone else answers this burst, or something already has. */
  | { status: 'STOOD_DOWN'; reason: 'GONE' | 'CLAIMED' }
  | { status: 'REFUSED'; searchId: string; reason: SearchRefusal; messageId?: string }
  | { status: 'FAILED'; error: string; preview?: string };

/**
 * Model, endpoint, prices: a sentence in, a reply out, nothing written.
 *
 * Shared by the run below and the ops console's preview (viewing-agent-search
 * with `send: false`), so what an operator previews is what a renter gets.
 */
export async function searchOnce(
  db: Supa,
  query: string,
  previous: Partial<SearchFilters> | null,
  deps: Pick<SearchDeps, 'extract' | 'search' | 'siteUrl'>,
  ref?: string,
): Promise<{ filters: SearchFilters; results: SearchResult[]; text: string; dropped: string[] }> {
  const validation = validateFilters(await deps.extract(extractionMessages(query, previous)));
  if (!validation.ok) throw new Error(`unparseable_filters: ${validation.error}`);
  const filters = validation.filters!;
  if (validation.dropped.length > 0) {
    // Not an error - a dropped filter is a broader search. Logged because a
    // field dropped on every call means the prompt and the contract disagree.
    console.log(`[search] dropped: ${validation.dropped.join(', ')}`);
  }
  if (!hasAnyFilter(filters)) return { filters, results: [], text: renderNeedMore(), dropped: validation.dropped };

  const results = await correctPrices(db, (await deps.search(filters)).slice(0, MAX_RESULTS));
  return { filters, results, text: renderSearchResults({ results, siteUrl: deps.siteUrl, ref }), dropped: validation.dropped };
}

/**
 * Read the canonical columns before quoting anything.
 *
 * The search endpoint used to return `price_vnd: Number(p.price)` - the raw
 * column, which holds USD for housingsgn rows (SPEC §0: a live row reads
 * price = 730, price_display = '$730 / month'), so a renter would have been
 * told a $730 flat costs 730 dong. It now emits the canonical column, but the
 * read stays: it supplies district_code, which the response does not carry at
 * all, and it drops the price of a listing that went inactive between the
 * search and now.
 */
async function correctPrices(db: Supa, results: SearchResult[]): Promise<SearchResult[]> {
  if (results.length === 0) return results;
  const { data: canonical } = await db
    .from('external_properties')
    .select('id, price_vnd, price_display, district_code')
    .in('id', results.map(r => r.id));
  const byId = new Map(((canonical ?? []) as Record<string, unknown>[]).map(c => [c.id, c]));
  return results.map(r => {
    const c = byId.get(r.id);
    return c
      ? {
        ...r,
        price_vnd: (c.price_vnd as number) ?? null,
        price_display: (c.price_display as string) ?? r.price_display ?? null,
        district_code: (c.district_code as string) ?? null,
      }
      // No canonical row means the listing went inactive between the search
      // and now. Dropping the price beats quoting an uncorrected one.
      : { ...r, price_vnd: null };
  });
}

/** The renter's thread around now, oldest first. */
async function readThread(db: Supa, phone: string, now: Date): Promise<ThreadMessage[]> {
  const since = new Date(now.getTime() - (BURST_LOOKBACK_MINUTES * 60_000 + MAX_SETTLE_MS)).toISOString();
  const { data } = await db
    .from('messages')
    .select('id, direction, body, created_at, idempotency_key')
    .eq('to_phone', phone)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30);
  return ((data ?? []) as ThreadMessage[]).reverse();
}

/** Counted searches since `since` - one renter's, or everyone's. */
async function countSearches(db: Supa, since: string, renterId?: string): Promise<number> {
  let q = db.from('renter_searches').select('id').eq('counted', true).gte('created_at', since);
  if (renterId) q = q.eq('renter_id', renterId);
  const { data, error } = await q;
  if (error) throw new Error(`search count failed: ${error.message ?? error}`);
  return (data ?? []).length;
}

/** The filters of the renter's last answered search, if recent enough to carry. */
async function previousFilters(db: Supa, renterId: string, now: Date): Promise<Partial<SearchFilters> | null> {
  const since = new Date(now.getTime() - PREFERENCES_TTL_DAYS * 86_400_000).toISOString();
  const { data } = await db
    .from('renter_searches')
    .select('filters, created_at')
    .eq('renter_id', renterId)
    .not('filters', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.filters as Partial<SearchFilters>) ?? null;
}

function sendError(e: unknown): string {
  if (e instanceof ServiceWindowClosedError) return 'service_window_closed';
  if (e instanceof ConsecutiveMessageError) return 'too_many_consecutive';
  if (e instanceof OptedOutError) return 'opted_out';
  return (e as Error).message;
}

/**
 * Answer the burst `triggerMessageId` belongs to, once the renter has paused.
 *
 * Called for every inbound the agent reads as a search. Most calls in a burst
 * stand down: the burst is claimed by whichever settles on it first.
 */
export async function runSearch(
  db: Supa,
  adapter: WhatsAppAdapter,
  input: { renterId: string; triggerMessageId: string; requestId?: string },
  deps: SearchDeps,
): Promise<SearchRunResult> {
  const { data: renter } = await db
    .from('renters').select('id, phone_e164, user_id, opted_out_at').eq('id', input.renterId).maybeSingle();
  if (!renter) return { status: 'FAILED', error: 'unknown_renter' };
  if (renter.opted_out_at) return { status: 'FAILED', error: 'opted_out' };

  // ── 1. Wait for a pause ───────────────────────────────────────────────────
  const started = deps.now().getTime();
  let settled: Settled;
  for (;;) {
    await deps.sleep(QUIET_MS);
    const now = deps.now();
    settled = settleBurst(
      await readThread(db, renter.phone_e164, now),
      input.triggerMessageId,
      now,
      now.getTime() - started >= MAX_SETTLE_MS,
    );
    if (settled.kind !== 'WAIT') break;
  }
  if (settled.kind === 'GONE') return { status: 'STOOD_DOWN', reason: 'GONE' };

  // ── 2. Claim it ───────────────────────────────────────────────────────────
  const { data: claim, error: claimErr } = await db
    .from('renter_searches')
    .insert({ renter_id: renter.id, answers_message_id: settled.answersMessageId, query: settled.query, counted: false })
    .select('id')
    .single();
  if (claimErr?.code === '23505') return { status: 'STOOD_DOWN', reason: 'CLAIMED' };
  if (claimErr || !claim) return { status: 'FAILED', error: claimErr?.message ?? 'claim_failed' };
  const searchId = String(claim.id);
  const searches = () => db.from('renter_searches');

  // ── 3. May it run? ────────────────────────────────────────────────────────
  const now = deps.now();
  const since = dayStartUtc(now);
  const userId: string | null = renter.user_id ?? null;
  let numberToday: number;
  let globalToday: number;
  let hasPass: boolean;
  try {
    [numberToday, globalToday, hasPass] = await Promise.all([
      countSearches(db, since, renter.id),
      countSearches(db, since),
      hasPassCover(db, userId),
    ]);
  } catch (e) {
    await searches().update({ refused: 'LOOKUP_FAILED' }).eq('id', searchId);
    return { status: 'FAILED', error: (e as Error).message };
  }
  const base = { linked: !!userId, hasPass, numberToday, globalToday };
  let verdict = searchAllowance({ ...base, accountSpent: null });
  let spentCredit = false;
  if (verdict.ok && userId && !hasPass) {
    // The web chat's allowance, spent here as there - one pool, two doors.
    const spent = await deps.credits.spend(userId);
    spentCredit = spent != null;
    verdict = searchAllowance({ ...base, accountSpent: spent });
  }
  const refund = async () => {
    if (spentCredit && userId) await deps.credits.refund(userId).catch(() => {});
    spentCredit = false;
  };

  if (!verdict.ok) {
    await refund();
    await searches().update({ refused: verdict.reason }).eq('id', searchId);
    const text = renderSearchRefused(verdict.reason, deps.siteUrl);
    if (!text) {
      console.warn(`[search] ${verdict.reason}: ${globalToday} searches today, renter ${renter.id} not answered`);
      return { status: 'REFUSED', searchId, reason: verdict.reason };
    }
    try {
      const result = await sendFreeForm(new SupabaseMessageStore(db), adapter, {
        renterId: renter.id,
        // Keyed on the day, not the message: one refusal a day however often
        // they ask, so saying no never costs more than saying yes would.
        purpose: `AGENT_SEARCH_LIMIT:${since.slice(0, 10)}`,
        body: text,
        now,
      });
      return { status: 'REFUSED', searchId, reason: verdict.reason, messageId: result.message.id };
    } catch (e) {
      console.warn(`[search] refusal not sent: ${sendError(e)}`);
      return { status: 'REFUSED', searchId, reason: verdict.reason };
    }
  }

  await searches().update({ counted: true }).eq('id', searchId);
  const uncount = async (why: string) => {
    await refund();
    await searches().update({ counted: false, refused: why.slice(0, 200) }).eq('id', searchId);
  };

  // ── 4. Search and answer ──────────────────────────────────────────────────
  let ref: string | undefined;
  if (input.requestId) {
    const { data } = await db.from('viewing_requests').select('ref').eq('id', input.requestId).maybeSingle();
    ref = data?.ref ?? undefined;
  }

  let found: Awaited<ReturnType<typeof searchOnce>>;
  try {
    found = await searchOnce(db, settled.query, await previousFilters(db, renter.id, now), deps, ref);
  } catch (e) {
    await uncount('SEARCH_FAILED');
    console.error('[search] failed:', (e as Error).message);
    return { status: 'FAILED', error: (e as Error).message };
  }

  try {
    const result = await sendFreeForm(new SupabaseMessageStore(db), adapter, {
      renterId: renter.id,
      requestId: input.requestId,
      // Keyed on the burst: a redelivery, or a second dispatch that slipped
      // past the claim, cannot send it twice.
      purpose: `AGENT_SEARCH:${settled.answersMessageId}`,
      body: found.text,
      now,
    });
    await searches().update({
      filters: hasAnyFilter(found.filters) ? found.filters : null,
      listing_ids: found.results.map(r => r.id),
      message_id: result.message.id,
    }).eq('id', searchId);
    return { status: 'SENT', searchId, messageId: result.message.id, matched: found.results.length, preview: found.text };
  } catch (e) {
    await uncount(sendError(e));
    return { status: 'FAILED', error: sendError(e), preview: found.text };
  }
}
