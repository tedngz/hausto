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
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
    const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('Redis not configured');
    }

    const { 
      propertyId, 
      title, 
      description, 
      vibe_analysis, 
      amenities, 
      location, 
      price 
    } = await req.json();

    if (!propertyId) {
      throw new Error('propertyId is required');
    }

    console.log(`[Generate Embedding] Processing property ${propertyId}`);

    // Build rich text representation
    const styles = vibe_analysis?.styles?.join(', ') || '';
    const colors = vibe_analysis?.colors?.join(', ') || '';
    const activities = vibe_analysis?.activities?.join(', ') || '';
    const amenitiesList = Array.isArray(amenities) ? amenities.join(', ') : '';

    const propertyText = `Property: ${title || 'Untitled'}
Location: ${location || 'Unknown'}
Price: $${price || 0}
Styles: ${styles}
Colors: ${colors}
Activities: ${activities}
Amenities: ${amenitiesList}
Description: ${description || 'No description'}`;

    console.log(`[Generate Embedding] Property text length: ${propertyText.length} chars`);

    // Generate embedding using OpenAI
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: propertyText,
        dimensions: 1536,
      }),
    });

    if (!embeddingResponse.ok) {
      const error = await embeddingResponse.text();
      console.error('[Generate Embedding] OpenAI error:', error);
      throw new Error(`OpenAI API error: ${error}`);
    }

    const embeddingData = await embeddingResponse.json();
    logOpenAIUsage({ fn: 'generate-property-embedding', model: 'text-embedding-3-small', usage: embeddingData?.usage });
    const embedding = embeddingData.data[0].embedding;

    console.log(`[Generate Embedding] Generated embedding with ${embedding.length} dimensions`);

    // Store in Redis with metadata
    const redisKey = `property:${propertyId}:embedding`;
    const redisValue = {
      id: propertyId,
      title: title || 'Untitled',
      price: price || 0,
      location: location || 'Unknown',
      styles: vibe_analysis?.styles || [],
      colors: vibe_analysis?.colors || [],
      activities: vibe_analysis?.activities || [],
      vector: embedding,
      updated_at: new Date().toISOString(),
    };

    // Store in Redis with 30-day TTL (2592000 seconds)
    const commands = [
      ['SET', redisKey, JSON.stringify(redisValue), 'EX', '2592000'],
    ];

    const redisResponse = await fetch(`${UPSTASH_REDIS_REST_URL}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });

    if (!redisResponse.ok) {
      const error = await redisResponse.text();
      console.error('[Generate Embedding] Redis error:', error);
      throw new Error(`Redis error: ${error}`);
    }

    console.log(`[Generate Embedding] Stored embedding for property ${propertyId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        propertyId,
        embeddingDimensions: embedding.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Generate Embedding] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
