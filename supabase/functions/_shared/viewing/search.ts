// WhatsApp search: a renter's sentence, turned into a search and three
// answers (PLAN-v3, the agent's scope).
//
// The agent gets `public-property-search` as a tool - the same contract that
// already serves ChatGPT and Perplexity via llms.txt. One endpoint, three
// consumers, so nothing here may extend or bend it.
//
// **The model's output never reaches that endpoint unvalidated.** An LLM asked
// for JSON will eventually produce a budget of "15 million", a district that
// does not exist, or a limit of 500, and the endpoint would either mis-serve it
// or serve far more than a WhatsApp message can carry. Everything crosses
// through `validateFilters`, which is pure and closed.
//
// Scope: this began as the FOLLOW-UP search, for a renter who had already made
// a request. Since 2026-10-13 (owner's decision) it also answers a cold DM -
// someone who messages the number with what they want and has never made a
// request. Still three results and links, not a grid: the style layer stays on
// the site, and the results send them there. What a search costs, and who may
// spend one, is search-limits.ts.

import { districtLabel } from './place.ts';
import { CREDITS_USED_REPLY } from '../ai-credits.ts';
import { FREE_NUMBER_DAILY_SEARCHES, type SearchRefusal } from './search-limits.ts';

/** Exactly the parameters `public-property-search` accepts. Nothing else. */
export interface SearchFilters {
  city?: string;
  district?: string;
  min_budget?: number;
  max_budget?: number;
  rooms?: string;
  style?: string;
  limit: number;
  source: 'external';
}

/**
 * Three, and not negotiable by the model.
 *
 * PLAN-v3 caps the agent at 3 suggestions per reply. From 2026-10-01 every
 * message inside the window is billed, and a renter scrolling ten flats on a
 * phone is not being helped anyway.
 */
export const MAX_RESULTS = 3;

/** Sane VND bounds. Below the first is a typo; above the second is not our market. */
export const MIN_PLAUSIBLE_VND = 1_000_000;
export const MAX_PLAUSIBLE_VND = 500_000_000;

/** The cities the index actually covers (PLAN-v3 keeps all three). */
const CITIES = ['ho chi minh', 'hanoi', 'da nang'];

/** `rooms` is free text upstream; these are the values that mean anything. */
const ROOMS = ['studio', '1', '2', '3', '4'];

export interface Validation {
  ok: boolean;
  filters?: SearchFilters;
  /** What was dropped and why. Logged, never shown to the renter. */
  dropped: string[];
  error?: string;
}

function asVnd(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // "15" and "15.5" mean millions to anyone typing about Saigon rent; a model
  // repeating the renter's shorthand should not become a 15-dong filter.
  const scaled = n < 1000 ? n * 1_000_000 : n;
  if (scaled < MIN_PLAUSIBLE_VND || scaled > MAX_PLAUSIBLE_VND) return undefined;
  return Math.round(scaled);
}

/**
 * Turn whatever the model emitted into filters the endpoint will accept.
 *
 * Permissive about what it drops, strict about what it passes: an unusable
 * field becomes a missing filter (a broader search), never a rejected request.
 * A renter asking a slightly odd question should get slightly broad results,
 * not an error.
 */
export function validateFilters(raw: unknown): Validation {
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, dropped, error: 'not an object' };
  }
  const r = raw as Record<string, unknown>;

  const filters: SearchFilters = {
    limit: MAX_RESULTS,
    // Crawled listings only. Internal `properties` are a different ledger with
    // a different booking path, and a renter cannot request viewings on one
    // through this flow.
    source: 'external',
  };

  if (typeof r.city === 'string') {
    const city = r.city.toLowerCase().trim();
    if (CITIES.some(c => city.includes(c) || c.includes(city))) filters.city = city;
    else dropped.push(`city:${city}`);
  }

  if (typeof r.district === 'string' && r.district.trim()) {
    // Not enumerated here - `vn_district_code` is the authority and the codes
    // drift (SPEC §0). The endpoint matches loosely; a wrong one returns
    // nothing, which the caller already handles.
    filters.district = r.district.toLowerCase().trim().slice(0, 60);
  }

  const min = asVnd(r.min_budget);
  const max = asVnd(r.max_budget);
  if (r.min_budget != null && min === undefined) dropped.push(`min_budget:${r.min_budget}`);
  if (r.max_budget != null && max === undefined) dropped.push(`max_budget:${r.max_budget}`);
  if (min !== undefined) filters.min_budget = min;
  if (max !== undefined) filters.max_budget = max;

  // A model that swaps them would otherwise produce a search that can never
  // match anything, and an empty result the renter reads as "nothing exists".
  if (filters.min_budget && filters.max_budget && filters.min_budget > filters.max_budget) {
    [filters.min_budget, filters.max_budget] = [filters.max_budget, filters.min_budget];
    dropped.push('budget:swapped');
  }

  if (r.rooms != null) {
    const rooms = String(r.rooms).toLowerCase().trim();
    if (ROOMS.includes(rooms)) filters.rooms = rooms;
    else dropped.push(`rooms:${rooms}`);
  }

  if (typeof r.style === 'string' && r.style.trim()) {
    filters.style = r.style.toLowerCase().trim().slice(0, 40);
  }

  return { ok: true, filters, dropped };
}

/** The query string for `public-property-search`. Limit and source are ours. */
export function toQueryString(f: SearchFilters): string {
  const p = new URLSearchParams();
  if (f.city) p.set('city', f.city);
  if (f.district) p.set('district', f.district);
  if (f.min_budget != null) p.set('min_budget', String(f.min_budget));
  if (f.max_budget != null) p.set('max_budget', String(f.max_budget));
  if (f.rooms) p.set('rooms', f.rooms);
  if (f.style) p.set('style', f.style);
  p.set('limit', String(f.limit));
  p.set('source', f.source);
  return p.toString();
}

// ── Rendering ───────────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  title: string;
  /**
   * The CANONICAL price, read from `external_properties.price_vnd`.
   *
   * The search endpoint emits the same column now, but it used to emit the
   * raw `price`, which holds USD for housingsgn rows (SPEC §0) - quoting that
   * to a renter printed "730 ₫" for a $730 flat. The caller still re-reads
   * the table before rendering, and nulls the price when the row is gone; see
   * viewing-agent-search.
   */
  price_vnd?: number | null;
  price_display?: string | null;
  district_code?: string | null;
  rooms?: string | null;
  size?: string | null;
  /** The endpoint supplies this; prefer it over building one. */
  url?: string | null;
}

function vnd(dong: number): string {
  return `${Math.round(dong).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
}

/**
 * One message carrying all three results.
 *
 * PLAN-v3 describes "one photo and two lines each", and the photo is the part
 * that cannot be done: a photo is a separate WhatsApp message, so three photos
 * is three messages to the same renter - which `sendFreeForm` refuses outright
 * at the third, and rightly. The link previews an image on the renter's device
 * anyway, so the picture arrives without the message count.
 */
export function renderSearchResults(opts: {
  results: SearchResult[];
  siteUrl: string;
  ref?: string;
}): string {
  const lines: string[] = [];
  const shown = opts.results.slice(0, MAX_RESULTS);

  if (shown.length === 0) {
    return [
      'Nothing live matches that right now.',
      'Reply with a wider budget or another district and we will look again.',
      ...(opts.ref ? [`Ref ${opts.ref}`] : []),
    ].join('\n');
  }

  lines.push(shown.length === 1 ? 'One place matches:' : `${shown.length} places match:`);
  lines.push('');

  shown.forEach((r, i) => {
    const price = r.price_vnd != null ? vnd(r.price_vnd) : (r.price_display ?? 'price on request');
    const facts = [r.rooms, r.size, r.district_code && districtLabel(r.district_code)].filter(Boolean).join(' - ');
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${price}/month${facts ? ` - ${facts}` : ''}`);
    lines.push(`   ${r.url || `${opts.siteUrl}/property/${r.id}`}`);
  });

  lines.push('');
  // Not "reply with a number": a viewing is asked for on the site, signed in,
  // with times picked there (invariant 8), and that is where these go. A
  // number sent anyway is answered with its link (agent.ts SEARCH_PICK).
  lines.push(`Open ${shown.length === 1 ? 'it' : 'one'} and tap Request viewing to have us arrange it.`);
  lines.push('Or tell us what to change - area, budget, bedrooms - and we will look again.');
  if (opts.ref) lines.push(`Ref ${opts.ref}`);

  return lines.join('\n');
}

/**
 * The instruction the model gets. Kept here rather than in the function so the
 * contract and the prompt describing it cannot drift apart.
 */
export const EXTRACTION_PROMPT = `You turn a renter's message into search filters for rental listings in Vietnam.

Return ONLY a JSON object with any of these keys, omitting any you are unsure about:
- city: one of "ho chi minh", "hanoi", "da nang"
- district: the district name as written, e.g. "thao dien", "district 1", "binh thanh"
- min_budget, max_budget: monthly rent in VND. If the renter writes "15 triệu" or "15m" or "15", that means 15000000.
- rooms: one of "studio", "1", "2", "3", "4"
- style: a single word for the feel they describe, e.g. "modern", "quiet", "luxury"

Omit a key rather than guessing. An omitted filter broadens the search, which is recoverable; a wrong one returns nothing, which is not.
Return no prose, no markdown fence - just the JSON object.`;

/** What the model may carry from one search into the next: the filters, not the plumbing. */
function preferencesOf(previous: Partial<SearchFilters> | null): Record<string, unknown> | null {
  if (!previous) return null;
  const { city, district, min_budget, max_budget, rooms, style } = previous;
  const kept = Object.fromEntries(
    Object.entries({ city, district, min_budget, max_budget, rooms, style }).filter(([, v]) => v != null),
  );
  return Object.keys(kept).length > 0 ? kept : null;
}

/**
 * The model's messages for one search. With the renter's last filters, it is
 * asked for the whole set again rather than a difference, so "what about
 * district 7" keeps their budget and bedrooms, and "any area" drops the
 * district. Its answer crosses `validateFilters` like any other.
 */
export function extractionMessages(
  query: string,
  previous: Partial<SearchFilters> | null,
): { role: 'system' | 'user'; content: string }[] {
  const kept = preferencesOf(previous);
  const system = kept
    ? `${EXTRACTION_PROMPT}

The renter searched before with these filters: ${JSON.stringify(kept)}
Return the complete filters for their new message: keep each earlier one unless the message changes it or asks to drop it.`
    : EXTRACTION_PROMPT;
  return [
    { role: 'system', content: system },
    { role: 'user', content: query },
  ];
}

/**
 * A new number's first message, when it is not already a search (agent.ts
 * WELCOME). Once per number. Says what to send, with an example, because
 * "hi" is what most people open with and silence is the worst answer to it.
 */
export function renderWelcome(): string {
  return [
    'Hi, this is Hausto. Tell us what you are looking for - area, bedrooms and budget - and we will send you the best matches we have.',
    '',
    'For example: 2 bedrooms in Thao Dien under 20 million.',
  ].join('\n');
}

/**
 * Why a search was not run, or null when the answer is to say nothing.
 *
 * Once a day per number at most - the caller keys the send on the day - so a
 * renter who keeps asking hears it once rather than once a message, and the
 * refusal never costs more than the search would have.
 */
export function renderSearchRefused(reason: SearchRefusal, siteUrl: string): string | null {
  const browse = `${siteUrl.replace(/^https?:\/\//, '')}/browse`;
  switch (reason) {
    case 'NUMBER_LIMIT':
      return `That is today's ${FREE_NUMBER_DAILY_SEARCHES} free searches on this number. ` +
        `They come back tomorrow - and every listing is on ${browse} in the meantime.`;
    case 'ACCOUNT_CREDITS':
      // The web chat's words: it is the same allowance.
      return `${CREDITS_USED_REPLY} Every listing is on ${browse} in the meantime.`;
    case 'DAILY_LIMIT':
      return 'That is as many searches as we run for one number in a day. ' +
        `We will pick this up again tomorrow - every listing is on ${browse} in the meantime.`;
    case 'GLOBAL_CAP':
      // Everyone's searches for the day are gone, which means something is
      // hammering the number. An apology to each new one is the same bill.
      return null;
  }
}

/** Did the model find anything to search on? A search on nothing returns three arbitrary places. */
export function hasAnyFilter(f: SearchFilters): boolean {
  return [f.city, f.district, f.min_budget, f.max_budget, f.rooms, f.style].some(v => v != null && v !== '');
}

/** The answer to a message that names nothing to search on - "any apartments?". */
export function renderNeedMore(): string {
  return [
    'Happy to look - tell us a little more: the area, how many bedrooms, and your budget.',
    'For example: 2 bedrooms in Thao Dien under 20 million.',
  ].join('\n');
}
