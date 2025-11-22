import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
    const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

    if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('Redis not configured');
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('[Verify Embeddings] Starting verification');

    // Get all active properties from database
    const { data: properties, error: fetchError } = await supabaseAdmin
      .from('properties')
      .select('id, title')
      .eq('is_active', true);

    if (fetchError) {
      throw fetchError;
    }

    const totalProperties = properties?.length || 0;
    console.log(`[Verify Embeddings] Found ${totalProperties} active properties`);

    // Check Redis for embeddings
    let embeddingsFound = 0;
    const missingEmbeddings: string[] = [];
    const sampleEmbeddings: any[] = [];

    for (const property of properties || []) {
      const redisKey = `property:${property.id}:embedding`;
      
      const response = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${redisKey}`, {
        headers: {
          'Authorization': `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        },
      });

      const data = await response.json();
      
      if (data.result) {
        embeddingsFound++;
        
        // Store first 3 embeddings as samples
        if (sampleEmbeddings.length < 3) {
          const embeddingData = JSON.parse(data.result);
          sampleEmbeddings.push({
            propertyId: property.id,
            title: property.title,
            dimensions: embeddingData.vector?.length || 0,
            hasMetadata: !!embeddingData.metadata,
            metadataKeys: embeddingData.metadata ? Object.keys(embeddingData.metadata) : [],
          });
        }
      } else {
        missingEmbeddings.push(property.id);
      }
    }

    const coveragePercent = totalProperties > 0 ? (embeddingsFound / totalProperties * 100).toFixed(1) : 0;

    console.log(`[Verify Embeddings] Found ${embeddingsFound}/${totalProperties} embeddings (${coveragePercent}%)`);

    return new Response(
      JSON.stringify({ 
        success: true,
        totalProperties,
        embeddingsFound,
        coveragePercent: parseFloat(coveragePercent as string),
        missingEmbeddings: missingEmbeddings.slice(0, 10), // Return first 10 missing
        totalMissing: missingEmbeddings.length,
        sampleEmbeddings,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Verify Embeddings] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
