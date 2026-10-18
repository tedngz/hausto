import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.4";

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
    const VND_TO_USD = 24500;
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    const results: any[] = [];

    // --- Fetch internal properties ---
    if (source !== 'external') {
      let internalQuery = supabase
        .from('properties')
        .select('id, title, location, price, size, rooms, images, highlights, amenities, description, created_at, style_tags:vibe_analysis->styles, image_analyses:vibe_analysis->image_analyses')
        .eq('is_active', true)
        .gte('last_activated_at', tenDaysAgo)
        .order('created_at', { ascending: false });

      if (city) {
        // Use detect_city() DB function for precise matching instead of substring on location
        const cityMap: Record<string, string> = {
          'hcmc': 'ho_chi_minh',
          'hanoi': 'hanoi',
          'danang': 'da_nang',
        };
        const detectedCity = cityMap[city] || city;
        // Filter using the detect_city SQL function via RPC, then filter by IDs
        // For internal properties, use location patterns that avoid street name false positives
        // Match city name at word boundary: after comma, at end, or in parentheses
        const cityEndPatterns: Record<string, string[]> = {
          'hcmc': ['Ho Chi Minh City', 'HCM City', 'HCMC', 'Saigon'],
          'hanoi': ['Hanoi', 'Ha Noi', 'Hà Nội'],
          'danang': ['Da Nang', 'Đà Nẵng'],
        };
        const patterns = cityEndPatterns[city] || [city];
        // Match patterns that appear after a comma (city-level context) or at the very end
        const cityFilter = patterns.map(p => `location.ilike.%, ${p}%`).join(',');
        internalQuery = internalQuery.or(cityFilter);
      }

      if (district) {
        internalQuery = internalQuery.ilike('location', `%${district}%`);
      }

      if (minBudget !== null) {
        internalQuery = internalQuery.gte('price', minBudget * VND_TO_USD);
      }
      if (maxBudget !== null) {
        internalQuery = internalQuery.lte('price', maxBudget * VND_TO_USD);
      }
      if (rooms) {
        internalQuery = internalQuery.ilike('rooms', `%${rooms}%`);
      }
      if (style) {
        // The text of the styles array (`["Modern", "Cozy"]`), matched the way
        // the old `vibe` filter was: case-insensitive substring. `vibe` was set
        // on a quarter of rows; every analysed row carries styles.
        internalQuery = internalQuery.ilike('vibe_analysis->>styles', `%${style}%`);
      }

      const { data: internalProps } = await internalQuery.range(0, 999);

      if (internalProps) {
        for (const p of internalProps) {
          results.push({
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
            image_highlights: Array.isArray(p.image_analyses)
              ? p.image_analyses.map((a: any) => String(a?.image_highlight || a?.highlight || ''))
              : [],
            images: (p.images || []).slice(0, 10),
            highlights: p.highlights || [],
            amenities: p.amenities || [],
            description: p.description ? p.description.substring(0, 300) : null,
            source: 'hausto',
            listed_at: p.created_at,
          });
        }
      }
    }

    // --- Fetch external properties ---
    if (source !== 'internal') {
      let externalQuery = supabase
        .from('external_properties')
        .select('id, title, location, price_vnd, size, rooms, images, highlights, amenities, description, source, created_at, last_verified_at, crawled_at, canonical_group_id, image_location_conflict, style_tags:vibe_analysis->styles, image_analyses:vibe_analysis->image_analyses')
        .eq('is_active', true)
        // Raw-harvested rows bypassed the ingest quality gates - never browse them
        .eq('raw_only', false)
        .order('created_at', { ascending: false });

      if (city) {
        // External properties have a dedicated 'city' column — use it for precise filtering
        const cityDbValues: Record<string, string[]> = {
          'hcmc': ['ho_chi_minh'],
          'hanoi': ['hanoi'],
          'danang': ['da_nang'],
        };
        const dbCities = cityDbValues[city];
        if (dbCities) {
          // Use the city column for exact match (set by detect_city during crawl)
          externalQuery = externalQuery.in('city', dbCities);
        } else {
          // Fallback: match after comma for unknown city values
          externalQuery = externalQuery.ilike('location', `%, ${city}%`);
        }
      }

      if (district) {
        externalQuery = externalQuery.ilike('location', `%${district}%`);
      }

      // `price` holds USD for housingsgn rows, so budgets and the emitted price
      // both read the canonical `price_vnd` (SPEC §0). A $730 flat filtered on
      // `price` looked like 730 dong and fell out of every budget.
      if (minBudget !== null) {
        externalQuery = externalQuery.gte('price_vnd', minBudget * VND_TO_USD);
      }
      if (maxBudget !== null) {
        externalQuery = externalQuery.lte('price_vnd', maxBudget * VND_TO_USD);
      }
      if (rooms) {
        externalQuery = externalQuery.ilike('rooms', `%${rooms}%`);
      }
      if (style) {
        externalQuery = externalQuery.ilike('vibe_analysis->>styles', `%${style}%`);
      }

      const { data: externalProps } = await externalQuery.range(0, 999);

      if (externalProps) {
        // Collapse duplicate-unit groups: the same apartment posted by several
        // agents shows once, annotated with how many postings it has.
        const groupCounts = new Map<string, number>();
        for (const p of externalProps) {
          if (p.canonical_group_id) {
            groupCounts.set(p.canonical_group_id, (groupCounts.get(p.canonical_group_id) || 0) + 1);
          }
        }
        const seenGroups = new Set<string>();
        // Suspected bait (same photos, conflicting location) quietly sinks to
        // the end of results rather than being exposed or hidden outright.
        const flaggedResults: any[] = [];
        for (const p of externalProps) {
          if (p.canonical_group_id) {
            if (seenGroups.has(p.canonical_group_id)) continue;
            seenGroups.add(p.canonical_group_id);
          }
          (p.image_location_conflict ? flaggedResults : results).push({
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
            image_highlights: Array.isArray(p.image_analyses)
              ? p.image_analyses.map((a: any) => String(a?.image_highlight || a?.highlight || ''))
              : [],
            images: (p.images || []).slice(0, 10),
            highlights: p.highlights || [],
            amenities: p.amenities || [],
            description: p.description ? p.description.substring(0, 300) : null,
            source: p.source || 'external',
            listed_at: p.created_at,
            crawled_at: p.crawled_at || null,
            last_verified_at: p.last_verified_at || null,
            // >1 means this unit is posted by multiple agents (deduplicated here)
            posting_count: p.canonical_group_id ? (groupCounts.get(p.canonical_group_id) || 1) : 1,
          });
        }
        results.push(...flaggedResults);
      }
    }

    // Apply pagination
    const total = results.length;
    const paginatedResults = results.slice(offset, offset + limit);

    // Freshness stats over the whole active external inventory (head-only
    // count queries, cheap). Consumed by the landing preview.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [{ count: verified7d }, { count: externalActive }, { count: internalActive }] = await Promise.all([
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
    ]);
    // Duplicate-unit groups collapse to one row in results, so the public
    // total counts each group once (matches what the browse table shows).
    const { data: groupRows } = await supabase.from('listing_groups').select('member_count');
    const duplicateExcess = (groupRows || []).reduce((s, g) => s + Math.max(0, (g.member_count || 1) - 1), 0);

    const response = {
      results: paginatedResults,
      total,
      limit,
      offset,
      query: { city, district, min_budget: minBudget, max_budget: maxBudget, rooms, style, source },
      stats: {
        verified_last_7_days: verified7d ?? 0,
        total_active_listings: (externalActive ?? 0) + (internalActive ?? 0) - duplicateExcess,
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
