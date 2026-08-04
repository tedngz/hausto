import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.4";

// Public, unauthenticated listings for a complex profile page. Runs with the
// service role so anonymous visitors can browse inventory, but NEVER returns
// contact details (provider name/phone, agent email/phone) — those stay behind
// sign-in via the authenticated messaging flow.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Per-isolate IP rate limiter (resets on cold start).
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
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

// Neutralise PostgREST or-filter metacharacters (mirrors the client helper).
const escForOr = (s: string) => s.replace(/[%,()]/g, ' ').trim();

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawTerms: string[] = Array.isArray(body?.terms) ? body.terms : [];
    const terms = Array.from(new Set(rawTerms.map((t) => String(t).trim()).filter((t) => t.length >= 3)));

    if (terms.length === 0) {
      return new Response(JSON.stringify({ listings: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const orInternal = terms
      .flatMap((t) => {
        const e = escForOr(t);
        return [`title.ilike.%${e}%`, `location.ilike.%${e}%`, `description.ilike.%${e}%`];
      })
      .join(',');
    const orExternal = terms
      .flatMap((t) => {
        const e = escForOr(t);
        return [`title.ilike.%${e}%`, `location.ilike.%${e}%`];
      })
      .join(',');

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    // Explicit column lists — contact columns are intentionally excluded.
    const [internalRes, externalRes] = await Promise.all([
      supabase
        .from('properties')
        .select('id, title, location, price, size, vibe, description, images, highlights, amenities, vibe_analysis, latitude, longitude, rooms, last_activated_at, created_at')
        .eq('is_active', true)
        .gte('last_activated_at', tenDaysAgo)
        .or(orInternal)
        .order('last_activated_at', { ascending: false })
        .limit(12),
      supabase
        .from('external_properties')
        .select('id, title, location, price, size, vibe, description, images, highlights, amenities, vibe_analysis, latitude, longitude, rooms, crawled_at, created_at')
        .eq('is_active', true)
        .or(orExternal)
        .order('crawled_at', { ascending: false })
        .limit(12),
    ]);

    if (internalRes.error) throw internalRes.error;
    if (externalRes.error) throw externalRes.error;

    const toApartment = (p: any, activatedAt: string | null) => ({
      id: p.id,
      title: p.title,
      location: p.location,
      price: Number(p.price) || 0,
      size: p.size ?? '',
      vibe: p.vibe ?? '',
      description: p.description ?? '',
      images: p.images ?? [],
      highlights: p.highlights ?? [],
      amenities: p.amenities ?? [],
      vibe_analysis: p.vibe_analysis,
      latitude: p.latitude,
      longitude: p.longitude,
      rooms: p.rooms,
      last_activated_at: activatedAt,
      created_at: p.created_at,
      // No contact details for public viewers.
      realtor: { id: '', name: 'Hausto', phone: '', email: '' },
    });

    const internal = (internalRes.data ?? []).map((p: any) => toApartment(p, p.last_activated_at));
    const external = (externalRes.data ?? []).map((e: any) => toApartment(e, e.crawled_at));

    const seen = new Set<string>();
    const listings = [...internal, ...external]
      .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
      .sort((a, b) => (b.last_activated_at ?? '').localeCompare(a.last_activated_at ?? ''))
      .slice(0, 12);

    return new Response(JSON.stringify({ listings }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' },
    });
  } catch (error) {
    console.error('[get-complex-listings] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', listings: [] }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
