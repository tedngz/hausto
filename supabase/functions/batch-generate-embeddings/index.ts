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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
    const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

    if (!OPENAI_API_KEY || !UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('Required environment variables not configured');
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('[Batch Generate] Starting batch embedding generation');

    // Fetch ALL internal properties (including inactive)
    const { data: internalProps, error: intError } = await supabaseAdmin
      .from('properties')
      .select('id, title, description, location, price, vibe_analysis, amenities');

    if (intError) throw intError;

    // Fetch ALL external properties (including inactive/expired)
    const { data: externalProps, error: extError } = await supabaseAdmin
      .from('external_properties')
      .select('id, title, description, location, price, vibe_analysis, amenities');

    if (extError) throw extError;

    // Normalize both into a unified list
    const allProperties = [
      ...(internalProps || []).map(p => ({ ...p, source: 'internal' })),
      ...(externalProps || []).map(p => ({ ...p, source: 'external' })),
    ];

    if (allProperties.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No properties to process', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Batch Generate] Processing ${allProperties.length} properties (${internalProps?.length || 0} internal, ${externalProps?.length || 0} external)`);

    let processed = 0;
    let errors = 0;

    // Process embeddings directly instead of calling another edge function
    const batchSize = 20;
    for (let i = 0; i < allProperties.length; i += batchSize) {
      const batch = allProperties.slice(i, i + batchSize);

      // Build text inputs for the batch
      const texts = batch.map(property => {
        const va = property.vibe_analysis as any;
        const styles = Array.isArray(va?.styles) ? va.styles.join(', ') : '';
        const colors = Array.isArray(va?.colors) ? va.colors.join(', ') : '';
        const activities = Array.isArray(va?.activities) ? va.activities.join(', ') : '';
        const amenitiesList = Array.isArray(property.amenities) ? property.amenities.join(', ') : '';

        return `Property: ${property.title || 'Untitled'}
Location: ${property.location || 'Unknown'}
Price: $${property.price || 0}
Styles: ${styles}
Colors: ${colors}
Activities: ${activities}
Amenities: ${amenitiesList}
Description: ${property.description || 'No description'}`;
      });

      try {
        // Generate embeddings in batch via OpenAI
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: texts,
            dimensions: 1536,
          }),
        });

        if (!embeddingResponse.ok) {
          const errText = await embeddingResponse.text();
          console.error(`[Batch Generate] OpenAI error for batch ${i}:`, errText);
          errors += batch.length;
          continue;
        }

        const embeddingData = await embeddingResponse.json();
        logOpenAIUsage({ fn: 'batch-generate-embeddings', model: 'text-embedding-3-small', usage: embeddingData?.usage });
        const embeddings = embeddingData.data;

        // Store all embeddings in Redis via pipeline
        const commands: any[] = [];
        for (let j = 0; j < batch.length; j++) {
          const property = batch[j];
          const embedding = embeddings[j].embedding;
          const propertyId = property.source === 'external' ? `ext-${property.id}` : property.id;
          const redisKey = `property:${propertyId}:embedding`;
          const va = property.vibe_analysis as any;

          const redisValue = {
            id: propertyId,
            title: property.title || 'Untitled',
            price: property.price || 0,
            location: property.location || 'Unknown',
            styles: va?.styles || [],
            colors: va?.colors || [],
            activities: va?.activities || [],
            vector: embedding,
            updated_at: new Date().toISOString(),
          };

          commands.push(['SET', redisKey, JSON.stringify(redisValue), 'EX', '2592000']);
        }

        const redisResponse = await fetch(`${UPSTASH_REDIS_REST_URL}/pipeline`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(commands),
        });

        if (!redisResponse.ok) {
          const errText = await redisResponse.text();
          console.error(`[Batch Generate] Redis error for batch ${i}:`, errText);
          errors += batch.length;
        } else {
          processed += batch.length;
          console.log(`[Batch Generate] Processed ${processed}/${allProperties.length}`);
        }
      } catch (err) {
        console.error(`[Batch Generate] Exception for batch ${i}:`, err);
        errors += batch.length;
      }

      // Wait between batches to respect rate limits
      if (i + batchSize < allProperties.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`[Batch Generate] Complete: ${processed} processed, ${errors} errors`);

    return new Response(
      JSON.stringify({ 
        message: 'Batch processing complete',
        processed,
        errors,
        total: allProperties.length,
        internal: internalProps?.length || 0,
        external: externalProps?.length || 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Batch Generate] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
