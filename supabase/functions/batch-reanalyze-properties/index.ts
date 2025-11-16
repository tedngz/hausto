import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: capitalize first letter for nicer display
const capitalize = (s: string) => (s && typeof s === 'string' ? s.charAt(0).toUpperCase() + s.slice(1) : s);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Normalize and validate auth header
    const rawAuthHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    const authHeader = rawAuthHeader?.startsWith('Bearer') ? rawAuthHeader : (rawAuthHeader ? `Bearer ${rawAuthHeader}` : undefined);
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      console.error('[BATCH-REANALYZE] Invalid or missing JWT when verifying user', userError);
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
      .select('id, title, images, amenities, highlights')
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

        // Call analyze-vibe function directly with fetch to properly forward auth
        const analyzeVibeUrl = `${supabaseUrl}/functions/v1/analyze-vibe`;
        const analyzeVibeResponse = await fetch(analyzeVibeUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'apikey': supabaseAnon
          },
          body: JSON.stringify({
            imageUrls: property.images,
            generateContent: false
          })
        });

        if (!analyzeVibeResponse.ok) {
          const errorText = await analyzeVibeResponse.text();
          console.error(`[BATCH-REANALYZE] analyze-vibe returned ${analyzeVibeResponse.status}:`, errorText);
          results.push({
            id: property.id,
            title: property.title,
            success: false,
            error: `Analysis failed: ${analyzeVibeResponse.status} ${errorText}`
          });
          continue;
        }

        const analysisData = await analyzeVibeResponse.json();

        // Convert raw scores to selected tags (styles, colors, activities)
        const analysis = analysisData.analysis || analysisData;
        
        // Extract image highlights and suggested tags from individual image analyses
        const imageHighlights: string[] = [];
        const suggestedActivitiesFromImages: string[] = [];
        const suggestedAmenitiesFromImages: string[] = [];
        
        if (analysisData.image_analyses && Array.isArray(analysisData.image_analyses)) {
          analysisData.image_analyses.forEach((imgAnalysis: any) => {
            if (imgAnalysis.image_highlight) {
              imageHighlights.push(capitalize(String(imgAnalysis.image_highlight)));
            }
            if (imgAnalysis.suggested_activities && Array.isArray(imgAnalysis.suggested_activities)) {
              suggestedActivitiesFromImages.push(...imgAnalysis.suggested_activities);
            }
            if (imgAnalysis.suggested_amenities && Array.isArray(imgAnalysis.suggested_amenities)) {
              suggestedAmenitiesFromImages.push(...imgAnalysis.suggested_amenities);
            }
          });
        }
        console.log(`[BATCH-REANALYZE] Extracted ${imageHighlights.length} image highlights for property ${property.id}`);
        console.log(`[BATCH-REANALYZE] Suggested activities from images: ${suggestedActivitiesFromImages.length}`);
        console.log(`[BATCH-REANALYZE] Suggested amenities from images: ${suggestedAmenitiesFromImages.length}`);
        
        const aiStyles = [];
        const aiColors = [];
        const aiActivities = [];
        
        // Extract styles from AI analysis
        if (analysis.modern >= 5) aiStyles.push('Modern');
        if (analysis.cozy >= 5) aiStyles.push('Cozy');
        if (analysis.luxurious >= 6) aiStyles.push('Luxury');
        if (analysis.urban >= 5) aiStyles.push('Urban');
        if (analysis.minimalist >= 5) aiStyles.push('Minimalist');
        if (analysis.elegant >= 5) aiStyles.push('Contemporary');
        if (analysis.rustic >= 4) aiStyles.push('Rustic');
        if (analysis.colorful >= 5) aiStyles.push('Bohemian');
        
        // Extract colors from AI analysis (map from available properties)
        // Neutral colors from minimalist/modern
        if (analysis.minimalist >= 6 || (analysis.modern >= 6 && analysis.colorful < 5)) aiColors.push('Neutral');
        // Warm colors from cozy/rustic
        if (analysis.cozy >= 6 || analysis.rustic >= 5) aiColors.push('Warm');
        // Cool colors from modern/elegant
        if (analysis.modern >= 7 || analysis.elegant >= 6) aiColors.push('Cool');
        // Bright from natural light
        if (analysis.natural_light >= 7) aiColors.push('Bright');
        // Colorful
        if (analysis.colorful >= 6) aiColors.push('Colorful');
        // Natural from natural light + cozy
        if (analysis.natural_light >= 6 && analysis.cozy >= 5) aiColors.push('Natural');
        // White from minimalist
        if (analysis.minimalist >= 7) aiColors.push('White');
        // Earth from rustic/cozy
        if (analysis.rustic >= 6 || (analysis.cozy >= 6 && analysis.natural_light >= 5)) aiColors.push('Earth');
        // Bold from colorful/modern
        if (analysis.colorful >= 7 || (analysis.modern >= 7 && analysis.colorful >= 5)) aiColors.push('Bold');
        
        // Extract activities from AI analysis (map from available properties)
        // Start with image-suggested activities
        aiActivities.push(...suggestedActivitiesFromImages);
        
        // Working from modern/spacious
        if (analysis.modern >= 6 || analysis.spacious >= 7) aiActivities.push('Working');
        // Reading from cozy/natural_light
        if ((analysis.cozy >= 6 && analysis.natural_light >= 6) || analysis.natural_light >= 8) aiActivities.push('Reading');
        // Relaxing from cozy/elegant
        if (analysis.cozy >= 6 || analysis.elegant >= 6) aiActivities.push('Relaxing');
        // Entertaining from spacious/modern/elegant
        if (analysis.spacious >= 7 || (analysis.modern >= 6 && analysis.spacious >= 5) || analysis.luxurious >= 7) aiActivities.push('Entertaining');
        // Cooking - use spacious as proxy for kitchen
        if (analysis.spacious >= 6 && analysis.modern >= 5) aiActivities.push('Cooking');
        // Exercising from spacious
        if (analysis.spacious >= 8) aiActivities.push('Exercising');
        
        // Remove duplicates and limit selections
        const uniqueStyles = [...new Set(aiStyles)].slice(0, 3);
        const uniqueColors = [...new Set(aiColors)].slice(0, 3);
        const uniqueActivities = [...new Set(aiActivities)].slice(0, 3);
        const uniqueAmenities = [...new Set(suggestedAmenitiesFromImages)].slice(0, 5);
        
        // Fallbacks if AI didn't detect enough
        if (uniqueStyles.length === 0) uniqueStyles.push('Modern');
        if (uniqueColors.length === 0) uniqueColors.push('Neutral');
        if (uniqueActivities.length === 0) uniqueActivities.push('Relaxing');

        // Build properly formatted vibe_analysis
        const formattedVibeAnalysis = {
          ...analysis,
          styles: uniqueStyles,
          colors: uniqueColors,
          activities: uniqueActivities,
          image_highlights: imageHighlights,
          image_analyses: Array.isArray(analysisData.image_analyses)
            ? analysisData.image_analyses.map((ia: any, idx: number) => ({
                ...ia,
                image_index: ia?.image_index ?? idx + 1,
                image_highlight: ia?.image_highlight ? capitalize(String(ia.image_highlight)) : ia?.image_highlight,
              }))
            : undefined,
          amenities: [...new Set([...(analysis?.amenities || []), ...uniqueAmenities])]
        };

        // Compute merged amenities (from image suggestions + overall analysis)
        const mergedAmenities = Array.from(new Set([...(analysis?.amenities || []), ...uniqueAmenities]));

        // Update property with new vibe_analysis, highlights, AND amenities
        const { error: updateError } = await supabase
          .from('properties')
          .update({
            vibe_analysis: formattedVibeAnalysis,
            highlights: imageHighlights.length > 0 ? imageHighlights : [...uniqueStyles, ...uniqueColors, ...uniqueActivities],
            amenities: mergedAmenities.length > 0 ? mergedAmenities : property.amenities || [],
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
