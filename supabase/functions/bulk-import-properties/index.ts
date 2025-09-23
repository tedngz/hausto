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

    const { properties } = await req.json();
    
    if (!Array.isArray(properties) || properties.length === 0) {
      throw new Error('Properties array is required and must not be empty');
    }

    console.log(`Processing ${properties.length} properties for bulk import`);

    const results: ProcessResult[] = [];
    let successful = 0;
    let failed = 0;

    // Process each property
    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];
      
      try {
        // Validate required fields
        if (!property.location || !property.price || !property.realtor_id || !Array.isArray(property.images) || property.images.length === 0) {
          throw new Error('Required fields missing: location, price, realtor_id, and images');
        }

        console.log(`Processing property ${i + 1}: ${property.location}`);

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
        let generatedTitle = property.title;
        let generatedDescription = property.description;
        let generatedVibe = property.vibe;
        let generatedHighlights = property.highlights || [];

        try {
          const { data: aiResult, error: aiError } = await supabase.functions.invoke('analyze-vibe', {
            body: {
              imageUrls: uploadedImages,
              generateContent: true,
              propertyInfo: {
                location: property.location,
                price: property.price,
                size: property.size
              }
            }
          });

          if (aiError) {
            console.warn('AI analysis failed:', aiError);
          } else if (aiResult) {
            aiContent = aiResult;
            
            // Use AI-generated content if not provided
            if (!generatedTitle && aiResult.generatedTitle) {
              generatedTitle = aiResult.generatedTitle;
            }
            if (!generatedDescription && aiResult.generatedDescription) {
              generatedDescription = aiResult.generatedDescription;
            }
            if (!generatedVibe && aiResult.overallVibe) {
              generatedVibe = aiResult.overallVibe;
            }
            if (generatedHighlights.length === 0 && aiResult.highlights) {
              generatedHighlights = aiResult.highlights;
            }
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
          images: uploadedImages,
          vibe_analysis: aiContent || {},
          realtor_id: property.realtor_id
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
        console.log(`Successfully processed property ${i + 1}: ${insertData.id}`);

      } catch (error) {
        console.error(`Error processing property ${i + 1}:`, error);
        results.push({
          index: i,
          status: 'failed',
          error: error.message
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
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});