import { Redis } from 'https://esm.sh/@upstash/redis@latest';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_TTL = 60 * 5; // 5 minutes for property listings

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

    const { action, cacheKey, properties, propertyId } = await req.json();

    console.log(`[Property Discovery Cache] Action: ${action}, Key: ${cacheKey || 'N/A'}`);

    if (action === 'get') {
      // Get cached property list
      const cachedProperties = await redis.get(cacheKey);
      
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
      // Cache property list
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(properties));
      console.log('[Property Discovery Cache] Cached properties');
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'invalidate') {
      // Invalidate all property caches
      // Use scan to find all keys matching the pattern
      const pattern = propertyId ? `properties:*:${propertyId}` : 'properties:*';
      let cursor = 0;
      let deletedCount = 0;

      do {
        const [newCursor, keys] = await redis.scan(cursor, {
          match: pattern,
          count: 100,
        });
        cursor = newCursor as number;

        if (keys && keys.length > 0) {
          await redis.del(...keys);
          deletedCount += keys.length;
        }
      } while (cursor !== 0);

      console.log(`[Property Discovery Cache] Invalidated ${deletedCount} cached property lists`);
      
      return new Response(JSON.stringify({ success: true, deletedCount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Property Discovery Cache] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
