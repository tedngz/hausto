// Follow-up search: a renter's sentence, turned into a search and three
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
// Scope discipline from PLAN-v3, worth restating because it is easy to drift:
// this is the FOLLOW-UP search, for a renter who has already made a request.
// First-time discovery is explicitly out - the style layer is visual and
// WhatsApp cannot render a filterable grid.

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
    const facts = [r.rooms, r.size, r.district_code].filter(Boolean).join(' - ');
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${price}/month${facts ? ` - ${facts}` : ''}`);
    lines.push(`   ${r.url || `${opts.siteUrl}/property/${r.id}`}`);
  });

  lines.push('');
  lines.push('Reply with a number to request a viewing.');
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
