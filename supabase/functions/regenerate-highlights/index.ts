import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify authentication first
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }

    // Create Supabase client and verify user
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user authentication
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Authentication failed:', authError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }

    console.log('Starting highlight regeneration for all properties');

    // Get OpenAI API key
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      console.error('OpenAI API key not found in environment');
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    // Fetch all properties from the database
    const { data: properties, error: fetchError } = await supabase
      .from('properties')
      .select('id, images, location, price, size, title, description, vibe_analysis');

    if (fetchError) {
      console.error('Error fetching properties:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch properties' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    console.log(`Found ${properties?.length || 0} properties to update`);

    let successful = 0;
    let failed = 0;
    const results = [];

    // Process each property
    for (const property of properties || []) {
      try {
        console.log(`Processing property ${property.id}...`);

        if (!property.images || !Array.isArray(property.images) || property.images.length === 0) {
          console.log(`Skipping property ${property.id} - no images`);
          failed++;
          results.push({ id: property.id, status: 'skipped', reason: 'no images' });
          continue;
        }

        // Call the analyze-vibe function to regenerate content
        const { data: analysisData, error: analysisError } = await supabase.functions.invoke('analyze-vibe', {
          body: {
            imageUrls: property.images,
            generateContent: true,
            propertyInfo: {
              location: property.location,
              price: property.price,
              size: property.size?.replace('m²', '') || '50',
              currency: 'VND'
            }
          }
        });

        if (analysisError) {
          console.error(`Analysis error for property ${property.id}:`, analysisError);
          failed++;
          results.push({ id: property.id, status: 'failed', reason: 'analysis failed', error: analysisError.message });
          continue;
        }

        const analysis = analysisData?.analysis;
        if (!analysis?.generated_content?.highlights) {
          console.error(`No highlights generated for property ${property.id}`);
          failed++;
          results.push({ id: property.id, status: 'failed', reason: 'no highlights generated' });
          continue;
        }

        // Update the property with new highlights and vibe analysis
        const { error: updateError } = await supabase
          .from('properties')
          .update({
            highlights: analysis.generated_content.highlights,
            vibe_analysis: analysis,
            updated_at: new Date().toISOString()
          })
          .eq('id', property.id);

        if (updateError) {
          console.error(`Update error for property ${property.id}:`, updateError);
          failed++;
          results.push({ id: property.id, status: 'failed', reason: 'update failed', error: updateError.message });
          continue;
        }

        console.log(`Successfully updated property ${property.id}`);
        successful++;
        results.push({ 
          id: property.id, 
          status: 'success', 
          highlights: analysis.generated_content.highlights 
        });

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error processing property ${property.id}:`, error);
        failed++;
        results.push({ id: property.id, status: 'failed', reason: 'processing error', error: error.message });
      }
    }

    console.log(`Highlight regeneration completed. Successful: ${successful}, Failed: ${failed}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        summary: {
          total: properties?.length || 0,
          successful,
          failed
        },
        results
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in regenerate-highlights function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});