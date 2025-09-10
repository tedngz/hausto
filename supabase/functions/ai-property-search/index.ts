import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, conversationId, images } = await req.json();
    
    if (!query) {
      throw new Error('Query is required');
    }

    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error('Supabase configuration missing');
    }

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user is authenticated
    let user = null;
    const authHeader = req.headers.get('authorization');
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      
      // Only try to authenticate if it's not the anon key
      if (token !== supabaseAnonKey) {
        try {
          const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
          if (!authError && authUser) {
            user = authUser;
            console.log('Authenticated user requesting property search:', user.id);
          } else {
            console.log('Anonymous user requesting property search');
          }
        } catch (authError) {
          console.log('Authentication failed, proceeding as anonymous user:', authError);
        }
      } else {
        console.log('Anonymous user with anon key requesting property search');
      }
    } else {
      console.log('No auth header, proceeding as anonymous user');
    }

    // Fetch all properties from the database
    const { data: properties, error: propertiesError } = await supabase
      .from('properties')
      .select('*');

    if (propertiesError) {
      console.error('Error fetching properties:', propertiesError);
      throw new Error('Failed to fetch properties');
    }

    // Prepare context for AI analysis
    const propertiesContext = properties.map(property => ({
      id: property.id,
      title: property.title,
      location: property.location,
      price: property.price,
      size: property.size,
      vibe: property.vibe,
      description: property.description,
      highlights: property.highlights
    }));

    // Call OpenAI to analyze the query and match properties
    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `You are a property matching assistant. Analyze the user's search query and find the best matching properties from the available listings.

AVAILABLE PROPERTIES:
${JSON.stringify(propertiesContext, null, 2)}

IMPORTANT: You MUST respond with valid JSON in this exact format:
{
  "matches": [
    {
      "propertyId": "property_id_here",
      "matchScore": 85,
      "reason": "Brief explanation why this matches"
    }
  ],
  "summary": "Brief summary of search results"
}

Rules:
- Return top 3 best matches only
- Match based on location, price, size, vibe, description, highlights
- Use actual property IDs from the data
- Keep reasons concise (max 20 words)
- Always return valid JSON, no markdown formatting`
          },
          {
            role: 'user',
            content: query
          }
        ],
      }),
    });

    if (!openAIResponse.ok) {
      const error = await openAIResponse.text();
      console.error('OpenAI API error:', error);
      throw new Error('Failed to analyze query with AI');
    }

    const openAIData = await openAIResponse.json();
    console.log('OpenAI response received:', JSON.stringify(openAIData, null, 2));
    
    const aiResponse = openAIData.choices?.[0]?.message?.content;
    
    if (!aiResponse) {
      console.error('No content in OpenAI response:', openAIData);
      throw new Error('OpenAI returned empty response');
    }
    
    console.log('AI response content:', aiResponse);

    let analysisResult;
    try {
      // First try direct JSON parse
      analysisResult = JSON.parse(aiResponse.trim());
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', aiResponse);
      
      // Try to extract JSON from markdown code blocks
      const jsonMatch = aiResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || 
                        aiResponse.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        try {
          const cleanJson = jsonMatch[1] || jsonMatch[0];
          analysisResult = JSON.parse(cleanJson.trim());
          console.log('Successfully parsed JSON from markdown:', analysisResult);
        } catch (secondParseError) {
          console.error('Failed to parse extracted JSON:', jsonMatch[0]);
          // Fallback: create a simple response
          analysisResult = {
            matches: [],
            summary: `Found properties related to: ${query}. Please try refining your search.`
          };
        }
      } else {
        console.error('No JSON found in response, creating fallback');
        // Create fallback response
        analysisResult = {
          matches: properties.slice(0, 3).map((prop, idx) => ({
            propertyId: prop.id,
            matchScore: 70 - (idx * 5),
            reason: `General match for your search criteria`
          })),
          summary: `Here are some available properties that might interest you.`
        };
      }
    }

    // Ensure we have valid structure
    if (!analysisResult.matches || !Array.isArray(analysisResult.matches)) {
      analysisResult = {
        matches: [],
        summary: analysisResult.summary || 'No suitable matches found for your search criteria.'
      };
    }

    // Get the full property details for matched properties
    const matchedPropertyIds = analysisResult.matches.map((match: any) => match.propertyId);
    const matchedProperties = properties.filter(property => 
      matchedPropertyIds.includes(property.id)
    );

    // Combine properties with match information
    const results = analysisResult.matches.map((match: any) => {
      const property = matchedProperties.find(p => p.id === match.propertyId);
      return {
        ...property,
        matchScore: match.matchScore,
        matchReason: match.reason,
        // Ensure realtor_id is properly included
        realtor_id: property?.realtor_id
      };
    }).slice(0, 3); // Ensure max 3 results

    // Save conversation if user is authenticated and conversationId provided
    let finalConversationId = conversationId;
    if (user && conversationId) {
      try {
        // Save user query as message
        await supabase
          .from('chat_messages')
          .insert({
            conversation_id: conversationId,
            role: 'user',
            content: query
          });

        // Create formatted AI response for saving
        const formattedResponse = `I found ${results.length} properties that match your criteria:\n\n${analysisResult.summary}\n\nProperty matches:\n${results.map((result: any, index: number) => 
          `${index + 1}. ${result.title} - ${result.matchReason}`).join('\n')}`;

        // Save AI response as message
        await supabase
          .from('chat_messages')
          .insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: formattedResponse,
            metadata: { searchResults: results, totalMatches: results.length }
          });

        // Update conversation timestamp
        await supabase
          .from('chat_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', conversationId);

      } catch (saveError) {
        console.error('Error saving conversation:', saveError);
        // Don't fail the request if conversation saving fails
      }
    } else if (!user && conversationId) {
      console.log('Skipping conversation save for anonymous user');
    }

    return new Response(JSON.stringify({
      results,
      summary: analysisResult.summary,
      totalMatches: results.length,
      conversationId: finalConversationId
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ai-property-search function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
      results: [],
      summary: 'Unable to process your search at this time. Please try again.',
      totalMatches: 0
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});