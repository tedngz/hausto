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

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('[Batch Generate] Starting batch embedding generation');

    // Fetch all active properties
    const { data: properties, error: fetchError } = await supabaseAdmin
      .from('properties')
      .select('id, title, description, location, price, vibe_analysis, amenities')
      .eq('is_active', true);

    if (fetchError) {
      throw fetchError;
    }

    if (!properties || properties.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No properties to process', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Batch Generate] Processing ${properties.length} properties`);

    let processed = 0;
    let errors = 0;

    // Process in batches of 10 to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < properties.length; i += batchSize) {
      const batch = properties.slice(i, i + batchSize);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (property) => {
        try {
          const { error } = await supabaseAdmin.functions.invoke('generate-property-embedding', {
            body: {
              propertyId: property.id,
              title: property.title,
              description: property.description,
              vibe_analysis: property.vibe_analysis,
              amenities: property.amenities,
              location: property.location,
              price: property.price,
            }
          });

          if (error) {
            console.error(`[Batch Generate] Error for property ${property.id}:`, error);
            errors++;
          } else {
            processed++;
            console.log(`[Batch Generate] Processed ${processed}/${properties.length}`);
          }
        } catch (err) {
          console.error(`[Batch Generate] Exception for property ${property.id}:`, err);
          errors++;
        }
      });

      await Promise.all(batchPromises);

      // Wait 1 second between batches to respect rate limits
      if (i + batchSize < properties.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`[Batch Generate] Complete: ${processed} processed, ${errors} errors`);

    return new Response(
      JSON.stringify({ 
        message: 'Batch processing complete',
        processed,
        errors,
        total: properties.length,
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
