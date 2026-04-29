import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CrawledProperty {
  location: string;
  price: number;
  size?: string;
  images: string[]; // URLs to images
  realtor_id: string;
  // Optional fields that will be auto-generated if not provided
  title?: string;
  description?: string;
  vibe?: string;
  highlights?: string[];
  property_source_link?: string;
}

interface ProcessResult {
  index: number;
  status: 'success' | 'failed';
  id?: string;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Verify user authentication
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Enforce realtor role - prevents any authenticated user from creating properties
    const { data: isRealtor } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'realtor' });
    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isRealtor && !isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: realtor role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { properties, startIndex = 0 } = await req.json();
    
    if (!Array.isArray(properties) || properties.length === 0) {
      throw new Error('Properties array is required and must not be empty');
    }

    // Limit batch size to prevent timeouts
    if (properties.length > 5) {
      throw new Error('Batch size too large. Maximum 5 properties per batch.');
    }

    console.log(`Processing ${properties.length} properties for bulk import`);

    const results: ProcessResult[] = [];
    let successful = 0;
    let failed = 0;

    // Process each property
    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];
      
      try {
        // Validate required fields (realtor_id is always pinned to authenticated user, never trusted from client)
        if (!property.location || !property.price || !Array.isArray(property.images) || property.images.length === 0) {
          throw new Error('Required fields missing: location, price, and images');
        }

        console.log(`Processing property ${startIndex + i + 1}: ${property.location}`);

        // Step 1: Upload images to Supabase Storage
        const uploadedImages: string[] = [];
        
        for (const imageUrl of property.images) {
          try {
            // Download image from URL
            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
              console.warn(`Failed to download image: ${imageUrl}`);
              continue;
            }

            const imageBlob = await imageResponse.blob();
            const fileName = `property-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
            
            // Upload to Supabase Storage
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('property-images')
              .upload(fileName, imageBlob, {
                contentType: 'image/jpeg',
                upsert: true
              });

            if (uploadError) {
              console.warn(`Failed to upload image: ${uploadError.message}`);
              continue;
            }

            // Get public URL
            const { data: urlData } = supabase.storage
              .from('property-images')
              .getPublicUrl(fileName);

            uploadedImages.push(urlData.publicUrl);
          } catch (error) {
            console.warn(`Error processing image ${imageUrl}:`, error);
          }
        }

        if (uploadedImages.length === 0) {
          throw new Error('No images could be uploaded');
        }

        // Step 2: Generate AI content using analyze-vibe function
        let aiContent = null;
        let aiResult: any = null;
        let generatedTitle = property.title;
        let generatedDescription = property.description;
        let generatedVibe = property.vibe;
        let generatedHighlights = property.highlights || [];

        try {
          const { data: aiData, error: aiError } = await supabase.functions.invoke('analyze-vibe', {
            body: {
              imageUrls: uploadedImages,
              generateContent: true,
              propertyInfo: {
                location: property.location,
                price: property.price,
                size: property.size
              }
            },
            headers: {
              Authorization: `Bearer ${token}`
            }
          });

          if (aiError) {
            console.warn('AI analysis failed:', aiError);
          } else if (aiData?.analysis) {
            aiResult = aiData;
            aiContent = aiData.analysis;
            
            // Extract title and description from generated_content
            if (!generatedTitle && aiData.analysis.generated_content?.title) {
              generatedTitle = aiData.analysis.generated_content.title;
            }
            if (!generatedDescription && aiData.analysis.generated_content?.description) {
              generatedDescription = aiData.analysis.generated_content.description;
            }
            
            // Extract highlights from individual image analyses
            if (generatedHighlights.length === 0 && aiData.analysis.image_analyses?.length > 0) {
              const imageHighlights = aiData.analysis.image_analyses
                .map((img: any) => img.image_highlight)
                .filter((highlight: string) => highlight && highlight.trim() !== '');
              
              if (imageHighlights.length > 0) {
                generatedHighlights = imageHighlights;
              } else if (aiData.analysis.generated_content?.highlights) {
                generatedHighlights = aiData.analysis.generated_content.highlights;
              }
            }
            
            // Determine overall vibe from the analysis
            if (!generatedVibe) {
              // Find the highest scoring vibe characteristic
              const vibeScores = aiData.analysis;
              const vibeTypes = ['modern', 'cozy', 'luxurious', 'minimalist', 'elegant', 'spacious', 'rustic'];
              let highestVibe = 'modern';
              let highestScore = 0;
              
              vibeTypes.forEach(vibe => {
                if (vibeScores[vibe] && vibeScores[vibe] > highestScore) {
                  highestScore = vibeScores[vibe];
                  highestVibe = vibe;
                }
              });
              
              generatedVibe = highestVibe;
            }
            
            // Extract AI-selected categories (Style, Color, Activity) from vibe analysis
            const analysis = aiData.analysis;
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
            if (analysis.industrial >= 4) aiStyles.push('Industrial');
            if (analysis.scandinavian >= 5) aiStyles.push('Scandinavian');
            if (analysis.traditional >= 5) aiStyles.push('Traditional');
            if (analysis.vintage >= 5) aiStyles.push('Vintage');
            
            // Extract colors from AI analysis
            if (analysis.neutral >= 5) aiColors.push('Neutral');
            if (analysis.warm >= 5) aiColors.push('Warm');
            if (analysis.cool >= 5) aiColors.push('Cool');
            if (analysis.bright >= 5 || analysis.natural_light >= 7) aiColors.push('Bright');
            if (analysis.dark >= 5) aiColors.push('Dark');
            if (analysis.colorful >= 6) aiColors.push('Colorful');
            if (analysis.natural_light >= 6) aiColors.push('Natural');
            if (analysis.minimalist >= 6) aiColors.push('White');
            if (analysis.rustic >= 5 || analysis.cozy >= 5) aiColors.push('Earth');
            if (analysis.colorful >= 7 || analysis.modern >= 6) aiColors.push('Bold');
            
            // Extract activities from AI analysis
            if (analysis.modern >= 5 || analysis.spacious >= 6) aiActivities.push('Working');
            if (analysis.cozy >= 6 || analysis.natural_light >= 6) aiActivities.push('Reading');
            if (analysis.cozy >= 5 || analysis.elegant >= 5) aiActivities.push('Relaxing');
            if (analysis.spacious >= 6 || analysis.modern >= 6) aiActivities.push('Entertaining');
            if (analysis.kitchen_quality >= 5) aiActivities.push('Cooking');
            if (analysis.spacious >= 5) aiActivities.push('Exercising');
            
            // Remove duplicates and limit selections
            const uniqueStyles = [...new Set(aiStyles)].slice(0, 3);
            const uniqueColors = [...new Set(aiColors)].slice(0, 3);
            const uniqueActivities = [...new Set(aiActivities)].slice(0, 3);
            
            // Fallbacks if AI didn't detect enough
            if (uniqueStyles.length === 0) uniqueStyles.push('Modern');
            if (uniqueColors.length === 0) uniqueColors.push('Neutral');
            if (uniqueActivities.length === 0) uniqueActivities.push('Relaxing');
            
            // Store the categories in the vibe_analysis
            aiContent.styles = uniqueStyles;
            aiContent.colors = uniqueColors;
            aiContent.activities = uniqueActivities;
          }
        } catch (error) {
          console.warn('AI content generation failed:', error);
        }

        // Step 3: Insert property into database
        const propertyData = {
          title: generatedTitle || `Property at ${property.location}`,
          description: generatedDescription || `Beautiful property located at ${property.location}`,
          location: property.location,
          price: property.price,
          size: property.size || null,
          vibe: generatedVibe || 'modern',
          highlights: generatedHighlights,
          amenities: property.amenities || aiResult?.amenities || [],
          images: uploadedImages,
          vibe_analysis: aiContent || {},
          realtor_id: user.id, // SECURITY: pin to authenticated user, never trust client value
          property_source_link: property.property_source_link || null,
          property_source_provider_name: property.property_source_provider_name || null,
          property_source_provider_phone: property.property_source_provider_phone || null
        };

        const { data: insertData, error: insertError } = await supabase
          .from('properties')
          .insert(propertyData)
          .select('id')
          .single();

        if (insertError) {
          throw new Error(`Database insert failed: ${insertError.message}`);
        }

        results.push({
          index: i,
          status: 'success',
          id: insertData.id
        });
        
        successful++;
        console.log(`Successfully processed property ${startIndex + i + 1}: ${insertData.id}`);

      } catch (error) {
        console.error(`Error processing property ${startIndex + i + 1}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        results.push({
          index: i,
          status: 'failed',
          error: errorMessage
        });
        failed++;
      }
    }

    const response = {
      success: true,
      processed: properties.length,
      successful,
      failed,
      details: results
    };

    console.log('Bulk import completed:', response);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Bulk import error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        success: false 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});