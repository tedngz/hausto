import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.50.4";
import { type ExternalLight, imageHighlightsOf, type InternalLight, orderResults, type ResultEntry } from "./order.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple in-memory rate limiter (per-isolate, resets on cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // requests per window
const RATE_WINDOW_MS = 60_000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

const VND_TO_USD = 24500;

interface Filters {
  city: string | null;
  district: string | null;
  minBudget: number | null;
  maxBudget: number | null;
  rooms: string | null;
  style: string | null;
}

/** `properties` matching the filters, with the columns asked for. */
function internalQuery(supabase: SupabaseClient, columns: string, f: Filters & { tenDaysAgo: string }) {
  let q = supabase
    .from('properties')
    .select(columns)
    .eq('is_active', true)
    .gte('last_activated_at', f.tenDaysAgo);

  if (f.city) {
    // Match the city name where it appears after a comma (city-level context),
    // so a street named after a city does not count. The values are quoted:
    // unquoted, the comma inside "%, Saigon%" split the or() and PostgREST
    // rejected every city-filtered query with a 400.
    const cityEndPatterns: Record<string, string[]> = {
      'hcmc': ['Ho Chi Minh City', 'HCM City', 'HCMC', 'Saigon'],
      'hanoi': ['Hanoi', 'Ha Noi', 'Hà Nội'],
      'danang': ['Da Nang', 'Đà Nẵng'],
    };
    const patterns = cityEndPatterns[f.city] || [f.city];
    const cityFilter = patterns
      .map((p) => `location.ilike."%, ${p.replace(/["\\]/g, '')}%"`)
      .join(',');
    q = q.or(cityFilter);
  }
  if (f.district) q = q.ilike('location', `%${f.district}%`);
  if (f.minBudget !== null) q = q.gte('price', f.minBudget * VND_TO_USD);
  if (f.maxBudget !== null) q = q.lte('price', f.maxBudget * VND_TO_USD);
  if (f.rooms) q = q.ilike('rooms', `%${f.rooms}%`);
  if (f.style) {
    // The text of the styles array (`["Modern", "Cozy"]`), matched the way
    // the old `vibe` filter was: case-insensitive substring. `vibe` was set
    // on a quarter of rows; every analysed row carries styles.
    q = q.ilike('vibe_analysis->>styles', `%${f.style}%`);
  }
  return q;
}

/** `external_properties` matching the filters, with the columns asked for. */
function externalQuery(supabase: SupabaseClient, columns: string, f: Filters) {
  let q = supabase
    .from('external_properties')
    .select(columns)
    .eq('is_active', true)
    // Raw-harvested rows bypassed the ingest quality gates - never browse them
    .eq('raw_only', false);

  if (f.city) {
    // External properties have a dedicated 'city' column (set by detect_city
    // during crawl) - exact match; unknown values match after a comma.
    const cityDbValues: Record<string, string[]> = {
      'hcmc': ['ho_chi_minh'],
      'hanoi': ['hanoi'],
      'danang': ['da_nang'],
    };
    const dbCities = cityDbValues[f.city];
    q = dbCities ? q.in('city', dbCities) : q.ilike('location', `%, ${f.city}%`);
  }
  if (f.district) q = q.ilike('location', `%${f.district}%`);
  // `price` holds USD for housingsgn rows, so budgets and the emitted price
  // both read the canonical `price_vnd` (SPEC §0). A $730 flat filtered on
  // `price` looked like 730 dong and fell out of every budget.
  if (f.minBudget !== null) q = q.gte('price_vnd', f.minBudget * VND_TO_USD);
  if (f.maxBudget !== null) q = q.lte('price_vnd', f.maxBudget * VND_TO_USD);
  if (f.rooms) q = q.ilike('rooms', `%${f.rooms}%`);
  if (f.style) q = q.ilike('vibe_analysis->>styles', `%${f.style}%`);
  return q;
}

// `image_highlights` is a computed field (migration 20261120100000): the
// highlight strings alone, ~0.4 KB a listing where `image_analyses` is ~7 KB.
const INTERNAL_COLUMNS = 'id, title, location, price, size, rooms, images, highlights, amenities, description, created_at, style_tags:vibe_analysis->styles';
const EXTERNAL_COLUMNS = 'id, title, location, price_vnd, size, rooms, images, highlights, amenities, description, source, created_at, last_verified_at, crawled_at, style_tags:vibe_analysis->styles';
const HIGHLIGHTS = 'image_highlights';
const HIGHLIGHTS_FALLBACK = 'image_analyses:vibe_analysis->image_analyses';

/** Full rows for one page's ids, by id. */
// deno-lint-ignore no-explicit-any
async function fetchRows(supabase: SupabaseClient, table: string, columns: string, ids: string[]): Promise<Map<string, any>> {
  // deno-lint-ignore no-explicit-any
  const byId = new Map<string, any>();
  if (ids.length === 0) return byId;
  const read = (extra: string) =>
    supabase.from(table).select(`${columns}, ${extra}`).in('id', ids).eq('is_active', true);
  let { data, error } = await read(HIGHLIGHTS);
  if (error) {
    // The computed field is missing until its migration runs; the full
    // analyses still give the same strings.
    console.warn(`[Public Property Search] ${table}.${HIGHLIGHTS} unavailable, falling back:`, error.message);
    ({ data } = await read(HIGHLIGHTS_FALLBACK));
  }
  // deno-lint-ignore no-explicit-any
  for (const row of (data || []) as any[]) byId.set(row.id, row);
  return byId;
}

// Per-isolate caches, held as long as the Cache-Control this function sends.
// Best effort: a cold isolate starts empty and just reads again.
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_KEYS = 100;
const orderCache = new Map<string, { at: number; entries: ResultEntry[] }>();

function cachedEntries(key: string): ResultEntry[] | null {
  const hit = orderCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    orderCache.delete(key);
    return null;
  }
  return hit.entries;
}

function cacheEntries(key: string, entries: ResultEntry[]) {
  if (orderCache.size >= CACHE_MAX_KEYS) orderCache.clear();
  orderCache.set(key, { at: Date.now(), entries });
}

interface Stats {
  verified7d: number;
  externalActive: number;
  internalActive: number;
  duplicateExcess: number;
}
let statsCache: { at: number; stats: Stats } | null = null;

/** Freshness stats over the whole active inventory, filter-independent. */
async function loadStats(supabase: SupabaseClient, tenDaysAgo: string): Promise<Stats> {
  if (statsCache && Date.now() - statsCache.at <= CACHE_TTL_MS) return statsCache.stats;
  // Head-only count queries, cheap. Consumed by the landing preview.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const reads = await Promise.all([
    supabase
      .from('external_properties')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('raw_only', false)
      .gte('last_verified_at', sevenDaysAgo),
    supabase
      .from('external_properties')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('raw_only', false),
    supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .gte('last_activated_at', tenDaysAgo),
    // Duplicate-unit groups collapse to one row in results, so the public
    // total counts each group once (matches what the browse table shows).
    supabase.from('listing_groups').select('member_count'),
  ]);
  const [{ count: verified7d }, { count: externalActive }, { count: internalActive }, { data: groupRows }] = reads;
  const stats: Stats = {
    verified7d: verified7d ?? 0,
    externalActive: externalActive ?? 0,
    internalActive: internalActive ?? 0,
    duplicateExcess: (groupRows || []).reduce((s, g) => s + Math.max(0, (g.member_count || 1) - 1), 0),
  };
  if (!reads.some((r) => r.error)) statsCache = { at: Date.now(), stats };
  return stats;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only GET allowed
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use GET.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Max 60 requests per minute.' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams;

    // Parse query parameters
    const city = params.get('city')?.toLowerCase() || null;
    const district = params.get('district')?.toLowerCase() || null;
    const minBudget = params.get('min_budget') ? Number(params.get('min_budget')) : null;
    const maxBudget = params.get('max_budget') ? Number(params.get('max_budget')) : null;
    const rooms = params.get('rooms') || null;
    const style = params.get('style')?.toLowerCase() || null;
    const limit = Math.min(Math.max(Number(params.get('limit') || '20'), 1), 50);
    const offset = Math.max(Number(params.get('offset') || '0'), 0);
    const source = params.get('source')?.toLowerCase() || null; // 'internal', 'external', or null for both

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const BASE_URL = 'https://www.hausto.com';
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    // Phase 1: the order, from light columns only, cached per filter set so a
    // client paging through the catalogue reads it once (see order.ts).
    const cacheKey = JSON.stringify([city, district, minBudget, maxBudget, rooms, style, source]);
    let entries = cachedEntries(cacheKey);
    if (!entries) {
      const [internalLight, externalLight] = await Promise.all([
        source !== 'external'
          ? internalQuery(supabase, 'id', { city, district, minBudget, maxBudget, rooms, style, tenDaysAgo })
              .order('created_at', { ascending: false })
              .range(0, 999)
          : Promise.resolve({ data: [] as InternalLight[], error: null }),
        source !== 'internal'
          ? externalQuery(supabase, 'id, canonical_group_id, image_location_conflict', { city, district, minBudget, maxBudget, rooms, style })
              .order('created_at', { ascending: false })
              .range(0, 999)
          : Promise.resolve({ data: [] as ExternalLight[], error: null }),
      ]);
      entries = orderResults(
        (internalLight.data || []) as InternalLight[],
        (externalLight.data || []) as ExternalLight[],
      );
      // A failed read serves what it got, as before, but is not remembered.
      if (!internalLight.error && !externalLight.error) cacheEntries(cacheKey, entries);
    }

    // Apply pagination
    const total = entries.length;
    const page = entries.slice(offset, offset + limit);

    // Phase 2: the full rows, for this page only. Still active, so a listing
    // retired since the order was cached drops out rather than being served.
    const internalIds = page.filter((e) => e.table === 'internal').map((e) => e.id);
    const externalIds = page.filter((e) => e.table === 'external').map((e) => e.id);
    const [internalRows, externalRows] = await Promise.all([
      fetchRows(supabase, 'properties', INTERNAL_COLUMNS, internalIds),
      fetchRows(supabase, 'external_properties', EXTERNAL_COLUMNS, externalIds),
    ]);

    // deno-lint-ignore no-explicit-any
    const paginatedResults: any[] = [];
    for (const e of page) {
      if (e.table === 'internal') {
        const p = internalRows.get(e.id);
        if (!p) continue;
        paginatedResults.push({
          id: p.id,
          title: p.title,
          url: `${BASE_URL}/property/${p.id}`,
          location: p.location,
          price_vnd: Number(p.price),
          price_usd: Math.round(Number(p.price) / VND_TO_USD),
          rooms: p.rooms || null,
          size: p.size || null,
          style_tags: Array.isArray(p.style_tags) ? p.style_tags : [],
          // Slim per-image highlight strings (indexed to images) so cards can
          // show the detailed AI highlight per photo, not just the vibe word.
          image_highlights: imageHighlightsOf(p),
          images: (p.images || []).slice(0, 10),
          highlights: p.highlights || [],
          amenities: p.amenities || [],
          description: p.description ? p.description.substring(0, 300) : null,
          source: 'hausto',
          listed_at: p.created_at,
        });
      } else {
        const p = externalRows.get(e.id);
        if (!p) continue;
        paginatedResults.push({
          id: p.id,
          title: p.title,
          url: `${BASE_URL}/property/${p.id}`,
          // Kept in the contract, always null: the source ad carries the
          // agent's number, and `url` already sends people to us (the
          // pricing rework, decided 2026-10-06). Not even selected above.
          source_url: null,
          location: p.location,
          price_vnd: p.price_vnd ?? null,
          price_usd: p.price_vnd ? Math.round(p.price_vnd / VND_TO_USD) : null,
          rooms: p.rooms || null,
          size: p.size || null,
          style_tags: Array.isArray(p.style_tags) ? p.style_tags : [],
          image_highlights: imageHighlightsOf(p),
          images: (p.images || []).slice(0, 10),
          highlights: p.highlights || [],
          amenities: p.amenities || [],
          description: p.description ? p.description.substring(0, 300) : null,
          source: p.source || 'external',
          listed_at: p.created_at,
          crawled_at: p.crawled_at || null,
          last_verified_at: p.last_verified_at || null,
          // >1 means this unit is posted by multiple agents (deduplicated here)
          posting_count: e.posting_count,
        });
      }
    }

    const { verified7d, externalActive, internalActive, duplicateExcess } = await loadStats(supabase, tenDaysAgo);

    const response = {
      results: paginatedResults,
      total,
      limit,
      offset,
      query: { city, district, min_budget: minBudget, max_budget: maxBudget, rooms, style, source },
      stats: {
        verified_last_7_days: verified7d,
        total_active_listings: externalActive + internalActive - duplicateExcess,
      },
      _links: {
        self: `${supabaseUrl}/functions/v1/public-property-search${url.search}`,
        docs: `${BASE_URL}/llms.txt`,
        openapi: `${BASE_URL}/openapi.json`,
      },
    };

    return new Response(JSON.stringify(response), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('[Public Property Search] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
