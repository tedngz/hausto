import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.4";
import { logOpenAIUsage } from "../_shared/openai-usage.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SECURITY: require authenticated user to prevent OpenAI credit drain
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );
    const { data: { user }, error: authErr } = await supabaseAuth.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
    const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

    if (!OPENAI_API_KEY || !UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('Required environment variables not configured');
    }

    const { query, preferences, topK = 50, filters } = await req.json();

    console.log(`[Vector Search] Query: ${query || 'preferences'}, TopK: ${topK}`);

    // Build query text from preferences or natural language query
    let queryText = '';
    if (query) {
      queryText = query;
    } else if (preferences) {
      const styles = preferences.styles?.join(', ') || '';
      const colors = preferences.colors?.join(', ') || '';
      const activities = preferences.activities?.join(', ') || '';
      const location = Array.isArray(preferences.location) 
        ? preferences.location.join(', ') 
        : preferences.location || '';
      const priceMin = preferences.priceRange?.[0] || 0;
      const priceMax = preferences.priceRange?.[1] || 999999;

      queryText = `Looking for apartment with styles: ${styles}, colors: ${colors}, activities: ${activities}, location: ${location}, price: $${priceMin}-${priceMax}`;
    } else {
      throw new Error('Either query or preferences must be provided');
    }

    // Check cache first
    const cacheKey = `vector_search:${JSON.stringify({ queryText, filters, topK })}`;
    const cacheKeyHash = await crypto.subtle.digest(
      'SHA-256', 
      new TextEncoder().encode(cacheKey)
    );
    const cacheKeyHex = Array.from(new Uint8Array(cacheKeyHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const cachedResultKey = `cache:${cacheKeyHex}`;

    // Try to get from cache
    const cacheResponse = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${cachedResultKey}`, {
      headers: { 'Authorization': `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
    });

    if (cacheResponse.ok) {
      const cacheData = await cacheResponse.json();
      if (cacheData.result) {
        console.log('[Vector Search] Cache hit');
        const cached = JSON.parse(cacheData.result);
        return new Response(
          JSON.stringify(cached),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log('[Vector Search] Cache miss, generating embedding');

    // Generate query embedding
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: queryText,
        dimensions: 1536,
      }),
    });

    if (!embeddingResponse.ok) {
      const error = await embeddingResponse.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const embeddingData = await embeddingResponse.json();
    logOpenAIUsage({ fn: 'vector-property-search', model: 'text-embedding-3-small', usage: embeddingData?.usage });
    const queryEmbedding = embeddingData.data[0].embedding;

    console.log('[Vector Search] Generated query embedding, searching properties');

    // Get all property embeddings from Redis
    const keysResponse = await fetch(`${UPSTASH_REDIS_REST_URL}/keys/property:*:embedding`, {
      headers: { 'Authorization': `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
    });

    if (!keysResponse.ok) {
      throw new Error('Failed to fetch property keys from Redis');
    }

    const keysData = await keysResponse.json();
    const propertyKeys = keysData.result || [];

    if (propertyKeys.length === 0) {
      console.log('[Vector Search] No property embeddings found');
      return new Response(
        JSON.stringify({ results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Vector Search] Found ${propertyKeys.length} property embeddings`);

    // Fetch all property embeddings in batch
    const getCommands = propertyKeys.map((key: string) => ['GET', key]);
    const batchResponse = await fetch(`${UPSTASH_REDIS_REST_URL}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(getCommands),
    });

    if (!batchResponse.ok) {
      throw new Error('Failed to fetch property embeddings from Redis');
    }

    const batchData = await batchResponse.json();
    
    // Calculate cosine similarity for each property
    const results = [];
    for (let i = 0; i < batchData.length; i++) {
      const item = batchData[i];
      if (item.result) {
        const property = JSON.parse(item.result);
        
        // Apply filters if provided
        if (filters) {
          if (filters.priceMin && property.price < filters.priceMin) continue;
          if (filters.priceMax && property.price > filters.priceMax) continue;
          if (filters.location?.length && !filters.location.some((loc: string) => 
            property.location?.toLowerCase().includes(loc.toLowerCase())
          )) continue;
          if (filters.styles?.length && !filters.styles.some((style: string) =>
            property.styles?.includes(style)
          )) continue;
        }

        // Calculate cosine similarity
        const similarity = cosineSimilarity(queryEmbedding, property.vector);
        
        results.push({
          id: property.id,
          title: property.title,
          price: property.price,
          location: property.location,
          similarity: similarity,
        });
      }
    }

    // Sort by similarity and take top K
    results.sort((a, b) => b.similarity - a.similarity);
    const topResults = results.slice(0, topK);

    console.log(`[Vector Search] Returning ${topResults.length} results`);

    // Cache results for 5 minutes (300 seconds)
    const resultData = { results: topResults };
    await fetch(`${UPSTASH_REDIS_REST_URL}/set/${cachedResultKey}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['EX', '300', JSON.stringify(resultData)]),
    });

    return new Response(
      JSON.stringify(resultData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Vector Search] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
