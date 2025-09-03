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

    console.log('Chat AI function called by authenticated user');
    
    const requestBody = await req.text();
    console.log('Raw request body length:', requestBody.length);
    
    if (!requestBody) {
      console.error('Empty request body');
      return new Response(
        JSON.stringify({ error: 'Empty request body' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(requestBody);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    const { message, conversationId, userType, userPreferences, propertyImages } = parsedBody;
    
    console.log('Request data:', { 
      messageLength: message?.length, 
      conversationId, 
      userType, 
      hasPreferences: !!userPreferences,
      hasPropertyImages: !!propertyImages,
      propertyImagesType: typeof propertyImages,
      propertyImagesLength: Array.isArray(propertyImages) ? propertyImages.length : 'not-array'
    });

    if (!message) {
      console.error('Missing message in request');
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    if (!conversationId) {
      console.error('Missing conversationId in request');
      return new Response(
        JSON.stringify({ error: 'Conversation ID is required' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    // Create Supabase client and verify user
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user authentication using service role key
    const token = authHeader.replace('Bearer ', '');
    
    // Create a client with the user's token for verification
    const userSupabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    const { data: { user }, error: authError } = await userSupabase.auth.getUser(token);
    
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

    console.log('Authenticated user:', user.id);

    // Fetch properties from database
    const { data: properties, error: propertiesError } = await supabase
      .from('properties')
      .select('*');

    if (propertiesError) {
      console.error('Error fetching properties:', propertiesError);
      throw propertiesError;
    }

    console.log(`Found ${properties?.length || 0} properties in database`);

    // Verify conversation belongs to user and get history
    const { data: conversation, error: convError } = await supabase
      .from('chat_conversations')
      .select('user_id')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single();
    
    if (convError || !conversation) {
      console.error('Conversation access denied:', convError);
      return new Response(
        JSON.stringify({ error: 'Conversation not found or access denied' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        }
      );
    }

    // Get conversation history
    const { data: chatHistory, error: historyError } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(10);

    if (historyError) {
      console.error('Error fetching chat history:', historyError);
      throw historyError;
    }

    let context = '';
    let systemPrompt = '';

    if (userType === 'realtor') {
      // Realtor context - help with property descriptions and marketing
      systemPrompt = `You are Hausto AI, a helpful assistant for real estate professionals. You help realtors create compelling property descriptions, titles, and marketing content that highlights unique features and appeals to potential renters.

STANDARD PROPERTY HIGHLIGHTS (use these tags only):
Style Tags: Modern, Cozy, Industrial, Bohemian, Scandinavian, Minimalist, Contemporary, Traditional, Rustic, Luxury, Urban, Vintage
Amenity Tags: Pet Friendly, Gym Access, Pool, Parking, Balcony, Garden, Elevator, Security, WiFi, Furnished, Air Conditioning, Washing Machine
Location Tags: City Center, Quiet Neighborhood, Near Metro, Shopping Nearby, School District, Business District, Riverside, Mountain View, Beach Access
Feature Tags: High Ceilings, Natural Light, Open Plan, Walk-in Closet, En-suite Bathroom, Kitchen Island, Hardwood Floors, Marble Counters, Smart Home

When analyzing property images, ONLY use tags from the standard list above. Match the visual style and features you see to these predefined categories. Do not create new tags.

Provide creative, engaging, and professional content that stands out in the rental market.`;

      if (Array.isArray(propertyImages) && propertyImages.length > 0) {
        context += `\nProperty images provided: ${propertyImages.length} images to analyze for creating descriptions.`;
      }
    } else {
      // Helper function for lifestyle tips
      function getLifestyleTips(location, vibe, highlights) {
        const tips = [];
        
        if (location?.includes('District 1')) {
          tips.push('Urban professionals who love being in the heart of the action');
        } else if (location?.includes('District 2')) {
          tips.push('Those who appreciate modern development with international community');
        } else if (location?.includes('Ba Dinh')) {
          tips.push('Culture enthusiasts near government district and historic sites');
        }
        
        if (vibe?.includes('Modern')) {
          tips.push('Tech-savvy individuals who appreciate contemporary design');
        } else if (vibe?.includes('Cozy')) {
          tips.push('Those seeking a warm, homely atmosphere');
        }
        
        if (highlights?.includes('Family Friendly')) {
          tips.push('Families with children or those planning to start one');
        }
        
        return tips.length ? tips.join(' • ') : 'Various lifestyles and preferences';
      }

      // Renter context - help with property search and recommendations
      systemPrompt = `You are Hausto AI, a friendly and knowledgeable rental property assistant. You specialize in helping renters find their perfect home by understanding their lifestyle, preferences, and needs.

🏠 AVAILABLE PROPERTIES DATABASE (${properties.length} total properties):
${properties.map((p, index) => `
Property ID: ${p.id}
Title: ${p.title}
Location: ${p.location}
Price: ${p.price?.toLocaleString()} VND/month
Description: ${(p.description || 'Modern living space').substring(0, 100)}${p.description?.length > 100 ? '...' : ''}
Vibe Score: ${p.vibe_analysis ? Math.round((p.vibe_analysis.modern + p.vibe_analysis.cozy + p.vibe_analysis.luxurious + p.vibe_analysis.spacious) / 4) : 7}/10
Primary Image: ${p.images?.[0] || 'No image available'}
`).join('\n')}

🎯 YOUR MISSION:
- ALWAYS suggest MAXIMUM 5 properties from the database above
- For each property, provide ONLY:
  * Property title (short version)
  * Brief description (1-2 sentences max)
  * Overall vibe score
  * One property image
  * Clickable link format: "🔗 [View Details](/property/PROPERTY_ID)" (replace PROPERTY_ID with actual ID)
- Keep responses concise and focused
- Format each property as a clean, compact card

📋 RESPONSE FORMAT:
For each recommended property, use this exact format:
---
🏡 **[Property Title]**
📝 [Brief 1-2 sentence description]
🌟 Vibe Score: [X]/10
🖼️ [First property image URL]
🔗 [View Details](/property/[property-id])
---

💬 COMMUNICATION STYLE:
- Be concise and helpful
- Maximum 5 property recommendations
- Keep each property description under 50 words
- Always include the clickable link for details
- Focus on key selling points only`;

      // Add user preferences context for renters
      if (userPreferences) {
        const matchingProperties = properties.filter(p => {
          const locationMatch = userPreferences.location?.some(loc => 
            p.location.toLowerCase().includes(loc.toLowerCase().split(',')[0])
          );
          const budgetMatch = userPreferences.priceRange ? 
            p.price <= userPreferences.priceRange[1] * 1.2 : true;
          return locationMatch && budgetMatch;
        });

        console.log(`Found ${matchingProperties.length} properties matching user preferences`);

        if (matchingProperties.length > 0) {
          systemPrompt += `\n\nBASED ON USER'S PREFERENCES, THESE PROPERTIES ARE MOST RELEVANT:
${matchingProperties.slice(0, 5).map(p => `
✅ ${p.title} in ${p.location} - ${p.price?.toLocaleString()} VND/month
   Perfect because: ${p.vibe || 'Great location match'} and within budget
`).join('')}`;
        }

        context += `\n🎯 USER'S SPECIFIC PREFERENCES & REQUIREMENTS:
💫 Preferred Styles: ${userPreferences.styles?.join(', ') || 'Not specified'}
🎨 Preferred Colors: ${userPreferences.colors?.join(', ') || 'Not specified'}
🏃‍♀️ Activities/Lifestyle: ${userPreferences.activities?.join(', ') || 'Not specified'}
💰 Budget Range: ${userPreferences.priceRange?.[0]?.toLocaleString() || 0} - ${userPreferences.priceRange?.[1]?.toLocaleString() || 'unlimited'} VND/month
📐 Preferred Size: ${userPreferences.size || 'Not specified'}
📍 Preferred Locations: ${userPreferences.location?.join(', ') || 'Not specified'}
📅 Move-in Date: ${userPreferences.moveInDate || 'Flexible'}

🔍 MATCHING STRATEGY:
- Prioritize properties in preferred locations
- Stay within or slightly above budget range (max 20% over)
- Match style preferences with property vibes and descriptions
- Consider lifestyle activities when recommending neighborhoods`;
      }

      if (Array.isArray(propertyImages) && propertyImages.length > 0) {
        context += `\nProperty images provided: ${propertyImages.length} images to analyze for creating descriptions.`;
      }
    }

    const fullContext = `${systemPrompt}

${context}

Conversation History:
${chatHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Current user message: ${message}`;

    // Call OpenAI API
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      console.error('OpenAI API key not found');
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      );
    }

    console.log('Calling OpenAI API...');
    
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: fullContext },
          { role: 'user', content: message }
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
    });

    console.log('OpenAI response status:', openaiResponse.status);
    
    if (!openaiResponse.ok) {
      console.error('OpenAI API error:', openaiResponse.status, openaiResponse.statusText);
      const errorText = await openaiResponse.text();
      console.error('OpenAI error response:', errorText);
      
      // Provide fallback response
      const fallbackResponse = userType === 'realtor' 
        ? "I'm having trouble connecting to the AI service right now. Please try again in a moment, or feel free to ask me about property marketing strategies!"
        : "I'm having trouble connecting to the AI service right now. But I'd be happy to help you find properties! Could you tell me more about what you're looking for - location preferences, budget, or lifestyle needs?";
      
      // Save fallback response to database
      await supabase
        .from('chat_messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: fallbackResponse
        });

      return new Response(
        JSON.stringify({ response: fallbackResponse }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    const openaiData = await openaiResponse.json();
    console.log('OpenAI response received, choices length:', openaiData.choices?.length);
    
    if (!openaiData.choices || !openaiData.choices[0] || !openaiData.choices[0].message) {
      console.error('Invalid OpenAI response structure:', openaiData);
      throw new Error('Invalid response from OpenAI');
    }
    
    const aiResponse = openaiData.choices[0].message.content || 'Sorry, I could not process your request.';
    console.log('AI response length:', aiResponse.length);

    // Save AI response to database
    console.log('Saving AI response to database...');
    const { error: saveError } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: aiResponse
      });

    if (saveError) {
      console.error('Error saving AI response:', saveError);
      throw saveError;
    }

    console.log('Chat AI function completed successfully');
    return new Response(
      JSON.stringify({ response: aiResponse }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in chat-ai function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});