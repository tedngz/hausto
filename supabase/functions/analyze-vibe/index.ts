
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
    const { imageUrls, generateContent = false, propertyInfo } = await req.json();

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
          ? `Analyze this rental property image using our AI-powered evaluation framework focused on three core factors:

1. INTERIOR DESIGN (Rate 1-5): Evaluate style coherence, aesthetic appeal, and material quality. Consider furniture arrangement, design consistency, and overall visual appeal.
2. COLOR PALETTE (Rate 1-5): Assess color harmony, mood evoked, and suitability to the space. Analyze color choices, contrast, and emotional impact.
3. FUNCTIONALITY (Rate 1-5): Examine practical layout, space utilization, flow, and ergonomic features. Consider usability and efficiency.

Return a JSON object with:
- "interior_design": score 1-5
- "color_palette": score 1-5  
- "functionality": score 1-5
- "image_summary": one concise sentence highlighting how all three factors contribute to this room's vibe
- "detailed_analysis": detailed observations about architectural features, design elements, and special amenities`
          : `Analyze this rental property image using our three-factor evaluation framework:

1. INTERIOR DESIGN (1-5): Style coherence, aesthetic appeal, material quality
2. COLOR PALETTE (1-5): Harmony, mood, suitability to space
3. FUNCTIONALITY (1-5): Layout, space utilization, flow, ergonomics

Return JSON with:
- "interior_design": score 1-5
- "color_palette": score 1-5
- "functionality": score 1-5
- "image_summary": one sentence about how these factors create the room's vibe`;

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
            max_tokens: generateContent ? 600 : 400,
          }),
        });

        console.log(`OpenAI response status for image ${index + 1}: ${response.status}`);
        
        if (!response.ok) {
          console.error(`OpenAI API error for image ${index + 1}: ${response.status} - ${response.statusText}`);
          const errorText = await response.text();
          console.error('Error response:', errorText);
          
          // Use fallback for this image instead of failing completely
          analyses.push({
            interior_design: 3,
            color_palette: 3,
            functionality: 3,
            image_summary: 'Unable to analyze this image due to API error',
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
            interior_design: 3,
            color_palette: 3,
            functionality: 3,
            image_summary: 'Unable to analyze this image',
            detailed_analysis: generateContent ? 'No analysis returned' : 'Analysis failed',
            image_index: index,
            raw_analysis: 'No Response'
          });
          continue;
        }

        if (!data.choices[0] || !data.choices[0].message) {
          console.error(`No message in OpenAI choice for image ${index + 1}:`, data.choices[0]);
          analyses.push({
            interior_design: 3,
            color_palette: 3,
            functionality: 3,
            image_summary: 'Unable to analyze this image',
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
            interior_design: 3,
            color_palette: 3,
            functionality: 3,
            image_summary: 'Unable to analyze this image',
            detailed_analysis: generateContent ? content : 'Analysis failed',
            image_index: index,
            raw_analysis: content
          });
        }
      } catch (imageError) {
        console.error(`Error processing image ${index + 1}:`, imageError);
        analyses.push({
          interior_design: 3,
          color_palette: 3,
          functionality: 3,
          image_summary: 'Unable to analyze this image',
          detailed_analysis: generateContent ? 'Processing error' : 'Analysis failed',
          image_index: index,
          raw_analysis: 'Processing Error'
        });
      }
    }

    // Calculate aggregated scores and overall vibe
    const avgInteriorDesign = analyses.reduce((sum, a) => sum + (a.interior_design || 3), 0) / analyses.length;
    const avgColorPalette = analyses.reduce((sum, a) => sum + (a.color_palette || 3), 0) / analyses.length;
    const avgFunctionality = analyses.reduce((sum, a) => sum + (a.functionality || 3), 0) / analyses.length;
    
    // Calculate overall vibe score (equal weight to all factors)
    const overallScore = (avgInteriorDesign + avgColorPalette + avgFunctionality) / 3;
    
    // Determine vibe level
    let vibeLevel = 'casual';
    if (overallScore >= 4.0) vibeLevel = 'perfect';
    else if (overallScore >= 3.25) vibeLevel = 'strong';
    else if (overallScore >= 2.5) vibeLevel = 'good';

    const aggregated = {
      interior_design: Math.round(avgInteriorDesign * 10) / 10,
      color_palette: Math.round(avgColorPalette * 10) / 10,
      functionality: Math.round(avgFunctionality * 10) / 10,
      overall_score: Math.round(overallScore * 10) / 10,
      vibe_level: vibeLevel,
      image_analyses: analyses
    };

    // Generate content if requested
    if (generateContent) {
      const imageSummaries = analyses.map(a => a.image_summary).filter(s => s && !s.includes('Unable')).join(' ');
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
              content: `You are an expert real estate marketing specialist. Based on our AI-powered vibe evaluation framework that analyzes properties across Interior Design, Color Palette, and Functionality, create compelling rental listings that highlight specific strengths and address any weaknesses.

EVALUATION FRAMEWORK:
- Interior Design: Style coherence, aesthetic appeal, material quality (1-5 scale)
- Color Palette: Harmony, mood evoked, suitability to space (1-5 scale) 
- Functionality: Layout, space utilization, flow, ergonomics (1-5 scale)

RULES:
- Create unique, memorable titles that reflect the property's vibe level
- Write descriptions that mention specific visual strengths from the analysis
- Address lifestyle benefits based on the functionality scores
- Highlight color and design elements that create the right mood
- For lower scores, focus on potential and unique character rather than flaws`
            },
            {
              role: 'user',
              content: `Create a compelling rental listing based on our AI vibe analysis:

${propertyContext}

AI VIBE ANALYSIS RESULTS:
- Interior Design Score: ${aggregated.interior_design}/5 (style coherence, aesthetic appeal, material quality)
- Color Palette Score: ${aggregated.color_palette}/5 (harmony, mood, suitability)  
- Functionality Score: ${aggregated.functionality}/5 (layout, space utilization, flow)
- Overall Vibe Level: ${aggregated.vibe_level.toUpperCase()} (${aggregated.overall_score}/5)

Per-Image Insights: ${imageSummaries}

Detailed Analysis: ${detailedAnalyses}

Based on these specific scores and insights, create:

1. A catchy title (50-80 characters) that reflects the ${aggregated.vibe_level} vibe level
2. A compelling description (150-250 words) that:
   - Emphasizes the strongest scoring factors
   - Mentions specific design and color elements from the analysis  
   - Highlights functional benefits for lifestyle needs
   - Addresses the overall ${aggregated.vibe_level} vibe in an appealing way
3. 4-6 highlights that showcase the property's best features based on the scores

Return JSON format:
{
  "title": "your unique title reflecting the vibe level",
  "description": "your detailed description emphasizing strong factors and lifestyle benefits",
  "highlights": ["highlight1", "highlight2", "highlight3", "highlight4"]
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
          highlights: ["Prime location", "Modern design", "Natural lighting", "Contemporary finishes"]
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
          highlights: ["Prime location", "Modern design", "Great amenities", "Perfect for living"]
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
