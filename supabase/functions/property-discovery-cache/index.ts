import { Redis } from 'https://esm.sh/@upstash/redis@1.28.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_TTL = 60 * 5; // 5 minutes for property listings
// The only key this function touches. It needs no login, and the Redis behind
// it also holds the AI usage counters, chat-ai's anonymous limits and
// scrape-marketplace's cache - a caller-chosen key could read or rewrite those.
const CACHE_KEY = 'properties:all';

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Redis client
    const redis = new Redis({
      url: Deno.env.get('UPSTASH_REDIS_REST_URL')!,
      token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!,
    });

    const { action, cacheKey, properties } = await req.json();
    if (cacheKey !== undefined && cacheKey !== CACHE_KEY) {
      return new Response(JSON.stringify({ error: `Only ${CACHE_KEY} is cached here` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const key = CACHE_KEY;

    console.log(`[Property Discovery Cache] Action: ${action}, Key: ${key}`);

    if (action === 'get') {
      // Get cached property list
      const cachedProperties = await redis.get(key);
      
      if (cachedProperties) {
        console.log('[Property Discovery Cache] Cache hit');
        return new Response(JSON.stringify({ properties: cachedProperties }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('[Property Discovery Cache] Cache miss');
      return new Response(JSON.stringify({ properties: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'set') {
      // What is cached here is served to everyone who reads it, so only the
      // service role may write it. Browsers used to fill it, which let anyone
      // replace the list other people see.
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
        return new Response(JSON.stringify({ error: 'Only the service role can write this cache' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Cache property list - limit size to prevent CPU issues
      const propsToCache = Array.isArray(properties) ? properties.slice(0, 200) : properties;
      await redis.setex(key, CACHE_TTL, JSON.stringify(propsToCache));
      console.log('[Property Discovery Cache] Cached properties');
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'invalidate') {
      // Simple invalidation - just delete the main cache key
      // Avoid expensive SCAN operations that cause CPU timeouts
      await redis.del(CACHE_KEY);
      console.log('[Property Discovery Cache] Invalidated main cache');
      
      return new Response(JSON.stringify({ success: true, deletedCount: 1 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Property Discovery Cache] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
