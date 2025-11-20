import { Redis } from 'https://esm.sh/@upstash/redis@latest';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

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

    const { action, cacheKey, score, propertyId } = await req.json();

    console.log(`[Vibe Score Cache] Action: ${action}, Key: ${cacheKey}`);

    if (action === 'get') {
      // Get cached vibe score
      const cachedScore = await redis.get(cacheKey);
      
      if (cachedScore) {
        console.log('[Vibe Score Cache] Cache hit');
        return new Response(JSON.stringify({ score: cachedScore }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('[Vibe Score Cache] Cache miss');
      return new Response(JSON.stringify({ score: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'set') {
      // Cache vibe score
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(score));
      console.log('[Vibe Score Cache] Cached score');
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'invalidate') {
      // Invalidate all cached scores for a property
      // Use scan to find all keys matching the pattern
      const pattern = `vibe_score:${propertyId}:*`;
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

      console.log(`[Vibe Score Cache] Invalidated ${deletedCount} cached scores for property ${propertyId}`);
      
      return new Response(JSON.stringify({ success: true, deletedCount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Vibe Score Cache] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
