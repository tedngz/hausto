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
    // Verify authentication first
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ 
        error: 'Missing authorization header',
        results: [],
        summary: 'Authentication required',
        totalMatches: 0
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { query } = await req.json();
    
    if (!query) {
      throw new Error('Query is required');
    }

    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    // Initialize Supabase client and verify user
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user authentication
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Authentication failed:', authError);
      return new Response(JSON.stringify({ 
        error: 'Invalid or expired token',
        results: [],
        summary: 'Authentication failed',
        totalMatches: 0
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Authenticated user requesting property search:', user.id);

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
        model: 'gpt-5-2025-08-07',
        max_completion_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: `You are an AI property matching assistant for Hausto, a rental platform. Analyze the user's query describing their ideal home and match it with available properties.

AVAILABLE PROPERTIES:
${JSON.stringify(propertiesContext, null, 2)}

Your task:
1. Understand what the user is looking for in their ideal home
2. Analyze the available properties to find the best matches
3. Return the top 3 most suitable properties based on their preferences
4. Provide a brief explanation for each match

Response format (JSON):
{
  "matches": [
    {
      "propertyId": "property_id_here",
      "matchScore": 95,
      "reason": "Brief explanation why this property matches their needs"
    }
  ],
  "summary": "Brief summary of what you understood from their query and general matching approach"
}`
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
    const aiResponse = openAIData.choices[0].message.content;

    let analysisResult;
    try {
      analysisResult = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      throw new Error('Failed to parse AI analysis');
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

    return new Response(JSON.stringify({
      results,
      summary: analysisResult.summary,
      totalMatches: results.length
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