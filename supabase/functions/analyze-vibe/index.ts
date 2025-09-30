
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

    const { imageUrls, generateContent = false, propertyInfo } = await req.json();
    console.log('Authenticated user requesting vibe analysis:', user.id);

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

    console.log('Starting image analysis:', { 
      imageCount: imageUrls?.length, 
      generateContent, 
      hasPropertyInfo: !!propertyInfo 
    });

    // Validate input
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      console.error('Invalid or missing imageUrls');
      return new Response(
        JSON.stringify({ error: 'No images provided for analysis' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    // Analyze each image for vibe characteristics and optionally generate content
    const analyses = [];
    
    for (let index = 0; index < imageUrls.length; index++) {
      const imageUrl = imageUrls[index];
      
      try {
          const basePrompt = generateContent 
            ? `You are a luxury rental marketing specialist analyzing property images to create HIGH-CONVERTING listing content. This is image ${index + 1} of ${imageUrls.length} total images.

            CORE MISSION: Discover the UNIQUE LIFESTYLE TRANSFORMATION this specific space offers renters.

            AMENITY DETECTION: Identify all visible amenities from this list:
            - TV, Smart TV, Large Screen TV
            - WiFi Router, Internet Equipment
            - Air Conditioning, AC Unit, Climate Control
            - Washing Machine, Dryer, Laundry
            - Dishwasher, Kitchen Appliances
            - Microwave, Oven, Stove, Refrigerator
            - Gym Equipment, Fitness Area
            - Pool, Swimming Pool
            - Balcony, Terrace, Outdoor Space
            - Parking, Garage, Car Space
            - Security System, Cameras, Safe
            - Workspace, Desk, Office Setup
            - Pet Amenities, Pet Bed, Pet Bowls
            - Garden, Plants, Green Space
            - Fireplace, Heating
            - Bathtub, Jacuzzi, Spa
            - Walk-in Closet, Storage
            - Kitchen Island, Breakfast Bar
            - Hardwood Floors, Marble, Premium Finishes
            - Smart Home Devices, Automation
            - Elevator Access
            - High Ceilings
            - Natural Light, Large Windows

            ANALYSIS FRAMEWORK:
            1. ESSENCE: What's the ONE thing that makes this space irreplaceable?
            2. EMOTIONAL TRIGGER: What feeling does this space instantly evoke?
            3. LIFESTYLE UPGRADE: How does this space solve a specific daily life problem?
            4. COMPETITIVE ADVANTAGE: What can't they get in 90% of other properties?
            5. RENTER VALUE: What will they gain that they didn't have before?

            ${index > 0 ? `DIFFERENTIATION RULE: This is image ${index + 1}. Your highlight must offer a COMPLETELY DIFFERENT lifestyle benefit from previous images. Previous benefits covered - avoid overlap! Think: 
            - WORK: Productivity, focus, professional success
            - SOCIAL: Entertaining, hosting, impression-making  
            - WELLNESS: Relaxation, health, mental clarity
            - CULINARY: Cooking, dining, food experiences
            - COMFORT: Rest, privacy, personal sanctuary
            - STYLE: Aesthetics, sophistication, status
            - CONVENIENCE: Organization, efficiency, time-saving` : ''}

             PREMIUM LIFESTYLE TRANSFORMATION CATEGORIES:
             💼 CAREER SUCCESS: "Executive command center", "Zoom-ready backdrop", "Productivity sanctuary"
             🎭 SOCIAL MASTERY: "Entertainment showcase", "Dinner party stage", "Impression maker"
             🧘 WELLNESS UPGRADE: "Stress-relief retreat", "Morning meditation space", "Zen sanctuary"
             👑 LUXURY LIVING: "Hotel-suite experience", "Premium lifestyle", "Elevated daily life"
             🍳 CULINARY EXCELLENCE: "Chef's creative lab", "Gourmet experience", "Culinary playground"
             ✨ AESTHETIC IMPACT: "Instagram paradise", "Design statement", "Visual masterpiece"
             🏠 LIFESTYLE CONVENIENCE: "Effortless living", "Time-saving design", "Life simplifier"

             ANALYSIS REQUIREMENTS:
             1. DETAILED_ANALYSIS: Write a comprehensive 60-100 word description analyzing EVERYTHING you see in the image:
                - Physical elements (furniture, fixtures, colors, layout, lighting, materials)
                - Design style and aesthetic appeal
                - Functionality and practical uses
                - Atmosphere and mood created
                - Unique features that stand out
                - How the space flows and feels
             
             2. IMAGE_HIGHLIGHT: Create a descriptive sentence or phrase (at least 7 words) that captures the key lifestyle benefit or feature from your detailed analysis
             
             Return JSON with EXACT format:
             {
               "modern": [1-10],
               "cozy": [1-10],
               "luxurious": [1-10],
               "minimalist": [1-10],
               "colorful": [1-10],
               "spacious": [1-10],
               "natural_light": [1-10],
               "urban": [1-10],
               "rustic": [1-10],
               "elegant": [1-10],
               "amenities": ["list of amenities you can clearly identify in the image"],
               "image_highlight": "descriptive sentence or phrase (at least 7 words) capturing key lifestyle benefit from detailed analysis",
               "detailed_analysis": "60-100 word comprehensive description of everything visible and the atmosphere/lifestyle it creates",
               "raw_analysis": "Brief one-sentence summary of what you see",
               "image_index": ${index}
             }
             
             CRITICAL: Focus on TRANSFORMATION over FEATURES:
             ❌ "Large windows" → ✅ "Natural energy boost"
             ❌ "Nice kitchen" → ✅ "Culinary creativity hub"
             ❌ "Spacious bedroom" → ✅ "Resort-style retreat"
             ❌ "Updated kitchen" → ✅ "Culinary creativity hub"
             ❌ "Spacious bedroom" → ✅ "Restorative sleep sanctuary"
             ❌ "Nice bathroom" → ✅ "Daily spa ritual"`
            : `Analyze this rental property image and return a JSON object with the following vibe characteristics (scale 1-10): modern, cozy, luxurious, minimalist, colorful, spacious, natural_light, urban, rustic, elegant, plus one specific highlight for this image that focuses on unique renter benefits.`;

        console.log(`Processing image ${index + 1}/${imageUrls.length}`);

        // Convert image to base64 if it's a Supabase storage URL to ensure compatibility
        let processedImageUrl = imageUrl;
        
        // Check if it's a Supabase storage URL and convert to base64
        if (imageUrl.includes('supabase') || imageUrl.includes('gbgrwjdmytaksrztcyzs')) {
          try {
            const imageResponse = await fetch(imageUrl);
            if (imageResponse.ok) {
              const imageBlob = await imageResponse.blob();
              
              // Ensure we have a supported image format and normalize
              let mimeType = imageBlob.type?.toLowerCase();
              // Normalize common non-standard types to supported ones
              if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
              if (mimeType === 'application/octet-stream' || !mimeType) mimeType = 'image/jpeg';
              const allowed = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
              if (!allowed.has(mimeType)) {
                // Force to jpeg for OpenAI compatibility
                mimeType = 'image/jpeg';
              }
              
              // Convert to base64 with proper chunking for large images
              const buffer = await imageBlob.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              const chunkSize = 8192;
              
              for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, i + chunkSize);
                binary += String.fromCharCode.apply(null, Array.from(chunk));
              }
              
              const base64 = btoa(binary);
              processedImageUrl = `data:${mimeType};base64,${base64}`;
              console.log(`Converted image ${index + 1} to base64 format (${mimeType}, ${Math.round(base64.length/1024)}KB)`);
            }
          } catch (conversionError) {
            console.error(`Failed to convert image ${index + 1} to base64:`, conversionError);
            // Continue with original URL as fallback
          }
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: basePrompt
                  },
                  {
                    type: 'image_url',
                    image_url: { 
                      url: processedImageUrl,
                      detail: "auto"
                    }
                  }
                ]
              }
            ],
            max_tokens: generateContent ? 500 : 300,
          }),
        });

        console.log(`OpenAI response status for image ${index + 1}: ${response.status}`);
        
        if (!response.ok) {
          console.error(`OpenAI API error for image ${index + 1}: ${response.status} - ${response.statusText}`);
          const errorText = await response.text();
          console.error('Error response:', errorText);
          
          // Use fallback for this image instead of failing completely
          analyses.push({
            modern: 5,
            cozy: 5,
            luxurious: 5,
            minimalist: 5,
            colorful: 5,
            spacious: 5,
            natural_light: 5,
            urban: 5,
            rustic: 5,
            elegant: 5,
            description: 'Unable to analyze image',
            detailed_analysis: generateContent ? `Analysis failed due to API error: ${errorText}` : 'Analysis failed',
            image_index: index,
            raw_analysis: errorText || 'API Error'
          });
          continue;
        }

        const data = await response.json();
        console.log(`OpenAI response for image ${index + 1} received`);
        
        if (!data || !data.choices || data.choices.length === 0) {
          console.error(`No choices in OpenAI response for image ${index + 1}:`, data);
          analyses.push({
            modern: 5,
            cozy: 5,
            luxurious: 5,
            minimalist: 5,
            colorful: 5,
            spacious: 5,
            natural_light: 5,
            urban: 5,
            rustic: 5,
            elegant: 5,
            description: 'Unable to analyze image',
            detailed_analysis: generateContent ? 'No analysis returned' : 'Analysis failed',
            image_index: index,
            raw_analysis: 'No Response'
          });
          continue;
        }

        if (!data.choices[0] || !data.choices[0].message) {
          console.error(`No message in OpenAI choice for image ${index + 1}:`, data.choices[0]);
          analyses.push({
            modern: 5,
            cozy: 5,
            luxurious: 5,
            minimalist: 5,
            colorful: 5,
            spacious: 5,
            natural_light: 5,
            urban: 5,
            rustic: 5,
            elegant: 5,
            description: 'Unable to analyze image',
            detailed_analysis: generateContent ? 'Invalid response format' : 'Analysis failed',
            image_index: index,
            raw_analysis: 'Invalid Format'
          });
          continue;
        }
        
        const content = data.choices[0].message.content || '{}';
        console.log(`Content length for image ${index + 1}: ${content.length} characters`);
        
        try {
          // Try to extract JSON from the response
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          const jsonStr = jsonMatch ? jsonMatch[0] : content;
          const parsed = JSON.parse(jsonStr);
          
          analyses.push({
            ...parsed,
            image_index: index,
            raw_analysis: content
          });
          
          console.log(`Successfully parsed analysis for image ${index + 1}`);
        } catch (parseError) {
          console.error(`JSON parsing failed for image ${index + 1}:`, parseError);
          console.error('Content that failed to parse:', content.substring(0, 200));
          
          // Fallback if JSON parsing fails
          analyses.push({
            modern: 5,
            cozy: 5,
            luxurious: 5,
            minimalist: 5,
            colorful: 5,
            spacious: 5,
            natural_light: 5,
            urban: 5,
            rustic: 5,
            elegant: 5,
            description: 'Unable to analyze image',
            detailed_analysis: generateContent ? content : 'Analysis failed',
            image_index: index,
            raw_analysis: content
          });
        }
      } catch (imageError) {
        console.error(`Error processing image ${index + 1}:`, imageError);
        analyses.push({
          modern: 5,
          cozy: 5,
          luxurious: 5,
          minimalist: 5,
          colorful: 5,
          spacious: 5,
          natural_light: 5,
          urban: 5,
          rustic: 5,
          elegant: 5,
          description: 'Unable to analyze image',
          detailed_analysis: generateContent ? 'Processing error' : 'Analysis failed',
          image_index: index,
          raw_analysis: 'Processing Error'
        });
      }
    }

    // Aggregate the analyses and generate content if requested
    // Collect all unique amenities from all images
    const allAmenities = new Set<string>();
    analyses.forEach(a => {
      if (Array.isArray(a.amenities)) {
        a.amenities.forEach((amenity: string) => allAmenities.add(amenity));
      }
    });

    const aggregated: any = {
      modern: Math.round(analyses.reduce((sum, a) => sum + (a.modern || 5), 0) / analyses.length),
      cozy: Math.round(analyses.reduce((sum, a) => sum + (a.cozy || 5), 0) / analyses.length),
      luxurious: Math.round(analyses.reduce((sum, a) => sum + (a.luxurious || 5), 0) / analyses.length),
      minimalist: Math.round(analyses.reduce((sum, a) => sum + (a.minimalist || 5), 0) / analyses.length),
      colorful: Math.round(analyses.reduce((sum, a) => sum + (a.colorful || 5), 0) / analyses.length),
      spacious: Math.round(analyses.reduce((sum, a) => sum + (a.spacious || 5), 0) / analyses.length),
      natural_light: Math.round(analyses.reduce((sum, a) => sum + (a.natural_light || 5), 0) / analyses.length),
      urban: Math.round(analyses.reduce((sum, a) => sum + (a.urban || 5), 0) / analyses.length),
      rustic: Math.round(analyses.reduce((sum, a) => sum + (a.rustic || 5), 0) / analyses.length),
      elegant: Math.round(analyses.reduce((sum, a) => sum + (a.elegant || 5), 0) / analyses.length),
      amenities: Array.from(allAmenities),
      image_analyses: analyses
    };

    // Generate unique title and description if requested
    if (generateContent) {
      const detailedAnalyses = analyses.map(a => a.detailed_analysis || a.raw_analysis).join('\n\n');
      console.log('Generating content with analysis:', detailedAnalyses.length, 'characters of analysis');
      
      try {
      const propertyContext = propertyInfo ? `
Property Details:
- Location: ${propertyInfo.location}
- Size: ${propertyInfo.size}m²
- Monthly Rent: ${propertyInfo.currency === 'VND' ? `${propertyInfo.price.toLocaleString()} VND` : `$${propertyInfo.price}`}
- Currency: ${propertyInfo.currency}
- Target Market: ${propertyInfo.price > 20000000 ? 'Luxury' : propertyInfo.price > 10000000 ? 'Mid-range' : 'Affordable'}
` : '';

      const contentResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an elite luxury real estate copywriter who creates VIRAL rental listings that make properties rent within 24 hours. Your listings are so compelling that renters apply sight unseen.

MASTER COPYWRITING PHILOSOPHY:
- Every property is a LIFESTYLE TRANSFORMATION, not just a place to sleep
- Create URGENT DESIRE: Make them fear missing out on their dream life
- Build EMOTIONAL ADDICTION: They can't stop thinking about living there
- Establish UNIQUENESS: This is the ONE property that changes everything
- Promise ASPIRATION: The person they'll become living here

TITLE MASTERY (45-65 characters for maximum impact):
- Start with their BIGGEST PAIN POINT SOLUTION or DREAM FULFILLMENT
- Use POWER WORDS: "Sanctuary," "Haven," "Oasis," "Paradise," "Retreat," "Escape," "Dream"
- Include SPECIFIC DIFFERENTIATORS visible in the images
- Create URGENCY without being pushy
- Examples: "Sun-Soaked Chef's Paradise" not "Bright Apartment with Kitchen"

DESCRIPTION MASTERY (80-120 words, 3-5 sentences):
- HOOK (20-25 words): The most jaw-dropping transformation promise
- LIFESTYLE STORY (40-60 words): Paint their daily life using specific visual details from images
- VALUE PROPOSITION (20-35 words): Key benefits that solve their problems or fulfill desires

SENSORY LANGUAGE RULES:
- Morning: "golden sunrise," "coffee ritual," "peaceful awakening"
- Evening: "unwind in luxury," "candlelit dinners," "skyline views"
- Social: "dinner parties that impress," "Instagram-worthy moments"
- Work: "productivity flows," "Zoom backgrounds that wow," "focus sanctuary"`
            },
            {
              role: 'user',
              content: `Create a VIRAL rental listing that creates instant obsession and FOMO. Analysis of this unique property:

LOCATION CONTEXT: ${propertyContext}

VISUAL LIFESTYLE TRANSFORMATION MAP:
${analyses.map((a, i) => `• Space ${i + 1}: ${a.image_highlight || 'Premium feature'} → ${a.detailed_analysis || 'Lifestyle enhancement'}`).join('\n')}

DETAILED VISUAL STORYTELLING:
${detailedAnalyses}

PROPERTY PERSONALITY DNA (Lifestyle Amplifiers):
${aggregated.modern >= 7 ? '🔥 ULTRA-MODERN: Cutting-edge contemporary living that puts you ahead of trends' : aggregated.modern >= 4 ? '✨ CONTEMPORARY: Perfect blend of modern style and timeless appeal' : '🏛️ CLASSIC: Timeless elegance that never goes out of style'}
${aggregated.luxurious >= 7 ? '💎 LUXURY TIER: Premium finishes that deliver 5-star hotel living daily' : aggregated.luxurious >= 4 ? '👑 ELEVATED: Quality details that make everyday feel special' : '🌟 REFINED: Thoughtful touches that enhance daily comfort'}
${aggregated.spacious >= 7 ? '🏰 SPACIOUS GRANDEUR: Generous proportions that eliminate cramped living forever' : aggregated.spacious >= 4 ? '📐 PERFECT PROPORTIONS: Intelligently designed space optimization' : '🎯 EFFICIENT BRILLIANCE: Every square foot maximized for purpose'}
${aggregated.natural_light >= 7 ? '☀️ LIGHT SANCTUARY: Sun-flooded spaces that boost mood and energy naturally' : aggregated.natural_light >= 4 ? '🌤️ BRIGHT LIVING: Well-lit spaces that feel alive throughout the day' : '🕯️ INTIMATE AMBIANCE: Cozy, cocoon-like atmosphere'}
${aggregated.cozy >= 7 ? '🤗 WARMTH HAVEN: Instant comfort that melts stress away' : aggregated.cozy >= 4 ? '🏠 HOMEY COMFORT: Welcoming atmosphere that feels like a hug' : '🌊 AIRY OPENNESS: Spacious flow that breathes freedom'}
${aggregated.elegant >= 7 ? '👑 SOPHISTICATED PRESTIGE: Impressive style that elevates your social status' : aggregated.elegant >= 4 ? '✨ REFINED TASTE: Polished aesthetic that reflects your success' : '😌 RELAXED CHARM: Laid-back style that prioritizes comfort'}

URGENT MISSION: Create listing copy that makes them desperately want to live this lifestyle.

TITLE FORMULA (45-65 characters):
[BIGGEST LIFESTYLE BENEFIT] + [UNIQUE VISUAL FEATURE] + [EMOTIONAL TRIGGER]
Examples from images:
- If chef's kitchen: "Culinary Paradise with Granite Command Center"
- If natural light: "Sun-Drenched Sanctuary with Sky-High Views"  
- If spacious: "Expansive Haven with Entertaining Excellence"
Must make them think: "This is exactly what I've been searching for!"

DESCRIPTION FORMULA (80-120 words, 3-5 sentences max):
1. HOOK (20-25 words): Start with their biggest desire fulfilled
2. LIFESTYLE STORY (40-60 words): Paint their daily experience using specific visual details from images
3. VALUE CLOSE (20-35 words): Key transformation they'll experience living here

EMOTIONAL TRIGGERS TO WEAVE IN:
- Morning transformation: golden light rituals, peaceful awakening
- Social elevation: dinner parties that impress, Instagram-worthy moments
- Daily escape: stress melts away, personal sanctuary
- Success symbol: Zoom backgrounds that wow, sophisticated living

CRITICAL: Use specific visual details from the analysis to create vivid mental movies of their life here.

Return EXACT JSON format:
{
  "title": "compelling title that creates instant desire (45-65 chars)",
  "description": "concise narrative that makes them visualize their dream life with specific visual details (80-120 words, 3-5 sentences max)"
}`
            }
          ],
          max_tokens: 800,
          temperature: 0.8,
        }),
      });

      console.log('Making content generation request to OpenAI');
      
      if (!contentResponse.ok) {
        console.error(`Content generation API error: ${contentResponse.status} - ${contentResponse.statusText}`);
        const errorText = await contentResponse.text();
        console.error('Content generation error response:', errorText);
        throw new Error(`Content generation API error: ${contentResponse.status}`);
      }

      const contentData = await contentResponse.json();
      console.log('Content generation response:', JSON.stringify(contentData, null, 2));
      
      if (!contentData || !contentData.choices || contentData.choices.length === 0) {
        console.error('No choices in content generation response:', contentData);
        throw new Error('No choices in content generation response');
      }

      if (!contentData.choices[0] || !contentData.choices[0].message) {
        console.error('No message in content generation choice:', contentData.choices[0]);
        throw new Error('No message in content generation response');
      }
      
      const contentText = contentData.choices[0].message.content || '{}';
      console.log('Generated content text:', contentText);
      
      try {
        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : contentText;
        console.log('Extracted content JSON string:', jsonStr);
        const generatedContent = JSON.parse(jsonStr);
        aggregated.generated_content = generatedContent;
      } catch (error) {
        console.error('Error parsing generated content:', error);
        console.error('Content that failed to parse:', contentText);
        // Improved fallback with property context
        const locationName = propertyInfo?.location?.split(',')[0] || 'Prime Location';
        const sizeText = propertyInfo?.size ? `${propertyInfo.size}m²` : 'Spacious';
        
        aggregated.generated_content = {
          title: `Stunning ${sizeText} Property in ${locationName}`,
          description: `Discover this beautiful ${sizeText} property offering modern living in ${locationName}. Features contemporary design elements and excellent natural lighting, perfect for comfortable urban living.`,
          highlights: ["Contemporary design", "Natural lighting", "Modern fixtures", "Quality finishes", "Urban location", "Well-maintained"]
        };
      }
      } catch (contentError) {
        console.error('Error in content generation:', contentError);
        // Fallback content generation
        const locationName = propertyInfo?.location?.split(',')[0] || 'Prime Location';
        const sizeText = propertyInfo?.size ? `${propertyInfo.size}m²` : 'Spacious';
        
        aggregated.generated_content = {
          title: `Beautiful ${sizeText} Property in ${locationName}`,
          description: `Discover this amazing ${sizeText} property in ${locationName}. Perfect for modern living with great features and amenities.`,
          highlights: ["Spacious layout", "Modern amenities", "Premium location", "Quality construction", "Natural light", "Updated features"]
        };
      }
    }

    return new Response(
      JSON.stringify({ analysis: aggregated }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in analyze-vibe function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
