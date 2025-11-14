import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[BATCH-REANALYZE] Starting batch re-analysis for realtor: ${user.id}`);

    // Parse request body for optional property IDs
    const { propertyIds } = await req.json().catch(() => ({ propertyIds: null }));

    // Get properties for this realtor
    let query = supabase
      .from('properties')
      .select('id, title, images')
      .eq('realtor_id', user.id);

    // If specific property IDs provided, filter by them
    if (propertyIds && Array.isArray(propertyIds) && propertyIds.length > 0) {
      query = query.in('id', propertyIds);
      console.log(`[BATCH-REANALYZE] Filtering to ${propertyIds.length} specific properties`);
    }

    const { data: properties, error: propertiesError } = await query;

    if (propertiesError) {
      console.error('[BATCH-REANALYZE] Error fetching properties:', propertiesError);
      throw propertiesError;
    }

    if (!properties || properties.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No properties to analyze',
        results: [] 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[BATCH-REANALYZE] Found ${properties.length} properties to analyze`);

    const results = [];

    // Process each property
    for (const property of properties) {
      try {
        console.log(`[BATCH-REANALYZE] Analyzing property: ${property.id} - ${property.title}`);

        if (!property.images || property.images.length === 0) {
          results.push({
            id: property.id,
            title: property.title,
            success: false,
            error: 'No images to analyze'
          });
          continue;
        }

        // Call analyze-vibe function
        const { data: analysisData, error: analysisError } = await supabase.functions.invoke(
          'analyze-vibe',
          {
            body: {
              imageUrls: property.images,
              generateContent: false
            },
            headers: {
              Authorization: authHeader
            }
          }
        );

        if (analysisError) {
          console.error(`[BATCH-REANALYZE] Error analyzing property ${property.id}:`, analysisError);
          results.push({
            id: property.id,
            title: property.title,
            success: false,
            error: analysisError.message || 'Analysis failed'
          });
          continue;
        }

        // Update property with new vibe_analysis
        const { error: updateError } = await supabase
          .from('properties')
          .update({
            vibe_analysis: analysisData,
            updated_at: new Date().toISOString()
          })
          .eq('id', property.id);

        if (updateError) {
          console.error(`[BATCH-REANALYZE] Error updating property ${property.id}:`, updateError);
          results.push({
            id: property.id,
            title: property.title,
            success: false,
            error: updateError.message || 'Update failed'
          });
          continue;
        }

        console.log(`[BATCH-REANALYZE] Successfully updated property: ${property.id}`);
        results.push({
          id: property.id,
          title: property.title,
          success: true
        });

      } catch (error) {
        console.error(`[BATCH-REANALYZE] Unexpected error for property ${property.id}:`, error);
        results.push({
          id: property.id,
          title: property.title,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`[BATCH-REANALYZE] Completed: ${successCount} succeeded, ${failureCount} failed`);

    return new Response(JSON.stringify({
      success: true,
      total: properties.length,
      successCount,
      failureCount,
      results
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[BATCH-REANALYZE] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
