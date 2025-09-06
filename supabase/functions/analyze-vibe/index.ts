
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
            ? `Analyze this rental property image for a real estate listing. You are analyzing image ${index + 1} of ${imageUrls.length} total images.

            CRITICAL RULES FOR HIGHLIGHTS:
            1. Each highlight must focus on BENEFITS, ACTIVITIES, or LIFESTYLE ADVANTAGES - NOT just feature descriptions
            2. Every highlight must be COMPLETELY DIFFERENT - no overlapping concepts or similar themes
            3. Tell renters what they can DO or HOW they'll benefit from each space/feature
            4. Focus on lifestyle, comfort, convenience, entertainment, work, relaxation benefits

            ${index > 0 ? `ALREADY COVERED BENEFITS TO AVOID: You are analyzing image ${index + 1}. Make sure this highlight covers a COMPLETELY DIFFERENT benefit/activity from previous images. Think: entertainment vs work vs relaxation vs storage vs cooking vs sleeping vs style, etc.` : ''}

            Focus on RENTER BENEFITS and ACTIVITIES they can enjoy:
            - Entertainment benefits: "Perfect for hosting", "Movie night ready", "Party entertaining"
            - Work/productivity: "Home office potential", "Study sanctuary", "Remote work haven"
            - Relaxation/wellness: "Spa-like retreat", "Meditation corner", "Stress-free living"
            - Convenience/lifestyle: "Easy maintenance", "Effortless organization", "Time-saving features"
            - Cooking/dining: "Gourmet cooking", "Family dinners", "Culinary adventures"
            - Style/ambiance: "Instagram-worthy", "Mood lighting", "Sophisticated living"
            - Comfort/luxury: "Hotel-like comfort", "Premium living", "Cozy relaxation"

            Return a JSON object with:
            1. Vibe characteristics (scale 1-10): modern, cozy, luxurious, minimalist, colorful, spacious, natural_light, urban, rustic, elegant
            2. "image_highlight": ONE specific 2-4 word phrase focusing on WHAT RENTERS CAN DO or HOW THEY BENEFIT
            3. "detailed_analysis": Brief description explaining the specific lifestyle benefit or activity this space enables
            
            Examples of BENEFIT-FOCUSED highlights:
            - "Perfect for hosting" (entertaining friends, dinner parties)
            - "Gourmet cooking space" (culinary creativity, meal prep ease)
            - "Effortless organization" (stress-free living, easy tidiness)
            - "Spa-like retreat" (daily relaxation, self-care rituals)
            - "Home office ready" (productive remote work, focus zone)
            - "Movie night haven" (entertainment, cozy evenings)
            - "Instagram-worthy style" (impressive aesthetics, social sharing)`
            : `Analyze this rental property image and return a JSON object with the following vibe characteristics (scale 1-10): modern, cozy, luxurious, minimalist, colorful, spacious, natural_light, urban, rustic, elegant, plus one specific highlight for this image that focuses on renter benefits.`;

        console.log(`Processing image ${index + 1}/${imageUrls.length}`);

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
                    image_url: { url: imageUrl }
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
            detailed_analysis: generateContent ? 'Analysis failed due to API error' : 'Analysis failed',
            image_index: index,
            raw_analysis: 'API Error'
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
    const aggregated = {
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
              content: `You are an expert real estate marketing specialist creating compelling rental listings. Based on detailed visual analysis of property images, you create unique, engaging content that highlights specific architectural features, design elements, and lifestyle benefits visible in the photos.

IMPORTANT RULES:
- Create titles that are catchy and unique, not generic
- Descriptions should mention specific visual features you can see in the images
- Highlight unique selling points and lifestyle benefits
- Make each listing feel distinct and memorable
- Use engaging, descriptive language that appeals to potential renters
- Focus on what makes THIS specific property special`
            },
            {
              role: 'user',
              content: `Create a compelling rental listing based on this visual analysis:

${propertyContext}

Image-Specific Highlights:
${analyses.map((a, i) => `Image ${i + 1}: ${a.image_highlight || 'Notable feature'}`).join('\n')}

Detailed Analysis:
${detailedAnalyses}

Visual Characteristics (1-10 scale):
- Modern: ${aggregated.modern}/10
- Cozy: ${aggregated.cozy}/10  
- Luxurious: ${aggregated.luxurious}/10
- Minimalist: ${aggregated.minimalist}/10
- Spacious: ${aggregated.spacious}/10
- Natural Light: ${aggregated.natural_light}/10
- Urban: ${aggregated.urban}/10
- Elegant: ${aggregated.elegant}/10

Based on the image-specific highlights and visual analysis, create:

1. A unique, catchy title (50-80 characters) that captures the property's distinctive features
2. An engaging description (150-250 words) that mentions the specific visual elements from each image

Return JSON format:
{
  "title": "your unique title",
  "description": "your detailed description mentioning specific visual features"
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
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
