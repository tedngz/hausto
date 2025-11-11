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
    // Initialize Supabase env and clients early
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check for authentication (optional for anonymous users)
    const authHeader = req.headers.get('authorization');
    let user = null;
    let isAnonymous = false;

    if (authHeader && !authHeader.includes(supabaseAnonKey)) {
      // Verify user token (ignore anon key)
      const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      
      const token = authHeader.replace('Bearer ', '');
      const { data: userData, error: authError } = await userSupabase.auth.getUser(token);
      
      if (!authError && userData.user) {
        user = userData.user;
        console.log('Authenticated user:', user.id);
      } else {
        console.log('Invalid token, treating as anonymous user');
        isAnonymous = true;
      }
    } else {
      console.log('No auth header, treating as anonymous user');
      isAnonymous = true;
    }

    console.log('Chat AI function called');

    // Rate limiting for anonymous users - 2 free searches per day
    if (isAnonymous) {
      // Get the client IP address with multiple fallbacks
      const xForwardedFor = req.headers.get('x-forwarded-for');
      const xRealIp = req.headers.get('x-real-ip');
      const cfConnectingIp = req.headers.get('cf-connecting-ip'); // Cloudflare
      
      const clientIP = (xForwardedFor?.split(',')[0].trim() || xRealIp || cfConnectingIp || 'unknown');

      console.log('Anonymous user IP detection:', { 
        xForwardedFor, 
        xRealIp, 
        cfConnectingIp, 
        finalIP: clientIP 
      });

      if (clientIP !== 'unknown') {
        // Check if this IP has exceeded their daily limit
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: existingAttempt, error: attemptError } = await supabase
          .from('anonymous_chat_attempts')
          .select('*')
          .eq('ip_address', clientIP)
          .gte('last_attempt_at', today.toISOString())
          .single();

        if (attemptError && attemptError.code !== 'PGRST116') {
          // PGRST116 is "no rows returned", which is fine
          console.error('Error checking rate limit:', attemptError);
        }

        if (existingAttempt && existingAttempt.attempt_count >= 2) {
          console.log(`Anonymous user has used ${existingAttempt.attempt_count}/2 free searches today`);
          return new Response(
            JSON.stringify({ 
              response: 'You\'ve used your 2 free searches today! To get unlimited AI-powered property searches and personalized recommendations, please sign in or create a free account.',
              requiresAuth: true
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            }
          );
        }

        console.log(`Anonymous user search count: ${existingAttempt?.attempt_count || 0}/2`);
      }
    }
    
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
      propertyImagesLength: Array.isArray(propertyImages) ? propertyImages.length : 'not-array',
      isAnonymous
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

    // For authenticated users, conversationId is optional. If missing or invalid, we'll proceed without persistence.
    if (!isAnonymous && !conversationId) {
      console.log('No conversationId provided for authenticated user - proceeding without persistence');
    }

    // Supabase client already initialized above (const supabase)

    // Fetch active properties from database (for all users)
    // Only include properties that are active and within the 10-day active window
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    
    const { data: propertiesData, error: propertiesError } = await supabase
      .from('properties')
      .select('*')
      .eq('is_active', true)
      .gte('last_activated_at', tenDaysAgo.toISOString());

    if (propertiesError) {
      console.error('Error fetching properties:', propertiesError);
      throw propertiesError;
    }
    
    const properties = propertiesData || [];
    console.log(`Found ${properties.length} properties in database${isAnonymous ? ' for anonymous user' : ''}`);
    
    // For anonymous users, we'll limit results in the system prompt
    const maxResults = isAnonymous ? 3 : 5;

    // Helper to validate UUIDs and decide if we can persist/history
    const isValidUUID = (v: string | null | undefined) =>
      typeof v === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
    const canPersist = !isAnonymous && isValidUUID(conversationId);
    let chatHistory: Array<{role: string, content: string}> = [];
    
    // For authenticated users with a valid conversationId, verify and get history
    if (canPersist) {
      const { data: conversation, error: convError } = await supabase
        .from('chat_conversations')
        .select('user_id')
        .eq('id', conversationId)
        .eq('user_id', user?.id)
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
      const { data: history, error: historyError } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(10);

      if (historyError) {
        console.error('Error fetching chat history:', historyError);
        throw historyError;
      }
      
      chatHistory = history || [];
    } else if (!isAnonymous && conversationId) {
      console.log('Ephemeral or invalid conversationId provided; skipping persistence and history');
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

IMPORTANT: When users ask about property source providers or property owner contacts:
- If a property has property_source_provider_name and property_source_provider_phone, you can provide this contact information when requested
- Explain that these are partner properties listed on behalf of the named provider
- The contact details are shared through the Hausto messaging system after initial contact

Provide creative, engaging, and professional content that stands out in the rental market.`;

      if (Array.isArray(propertyImages) && propertyImages.length > 0) {
        context += `\nProperty images provided: ${propertyImages.length} images to analyze for creating descriptions.`;
      }
    } else {
      // Renter context - help with property search and recommendations
      systemPrompt = `You are Hausto AI, a friendly rental property assistant. For property searches, you MUST return valid JSON responses only.

🏠 AVAILABLE PROPERTIES DATABASE (${properties.length} total properties):
${properties.map((p, index) => {
  // Get amenities from vibe_analysis (where they're actually stored in PropertyCard) or fallback to amenities field
  const amenities = p.vibe_analysis?.amenities || p.amenities || [];
  const imageUrls = Array.isArray(p.images) ? p.images : [];
  const providerName = p.property_source_provider_name;
  const providerPhone = p.property_source_provider_phone;
  return `
Property ${index + 1}:
Title: ${p.title}
Location: ${p.location}
Price: ${p.price?.toLocaleString()} VND/month
Description: ${(p.description || 'Modern living space').substring(0, 200)}
Highlights: ${Array.isArray(p.highlights) ? p.highlights.join(', ') : 'Modern features'}
**AMENITIES (ONLY USE THESE - DO NOT ADD OTHERS)**: ${amenities.length > 0 ? amenities.join(', ') : 'None listed'}
Property ID (for matching): ${p.id}
Realtor ID: ${p.realtor_id}
**ACTUAL IMAGE URLS (MUST COPY EXACTLY)**: ${JSON.stringify(imageUrls)}
${providerName ? `Property Source Provider: ${providerName}` : ''}
${providerPhone ? `Provider Contact: ${providerPhone}` : ''}
`;
}).join('\n')}

⚠️ CRITICAL AMENITY RULES:
- ANALYZE THE PROPERTY IMAGES provided to verify and identify amenities visually
- Cross-reference visual amenities with the listed amenities in "**AMENITIES**" section
- If you see amenities in images that aren't listed, you CAN mention them but note they were "observed in photos"
- If amenities are listed but not visible in photos, still mention them as "listed amenities"
- Be specific about what you see: pool, gym equipment, balcony, parking, kitchen appliances, etc.
- When describing properties, combine both listed amenities AND what you observe in the images

🎯 RESPONSE FORMAT - Return ONLY valid JSON:
{
  "results": [
    {
      "id": "copy-exact-property-id-from-above",
      "title": "Copy exact title",
      "location": "Copy exact location", 
      "price": 12000000,
      "size": "50m²",
      "vibe": "Modern, Cozy",
      "description": "Brief description",
      "highlights": ["Modern", "Cozy", "Pet Friendly"],
      "images": ["COPY-EXACT-IMAGE-URLS-FROM-PROPERTY-DATA"],
      "matchScore": 85,
      "matchReason": "Perfect match because...",
      "realtor_id": "copy-exact-realtor-id-from-above"
    }
  ],
  "summary": "Found X properties matching your preferences...",
  "totalMatches": 3
}

⚠️ CRITICAL IMAGE RULES:
- For "images" field: COPY the EXACT image URL array from "**ACTUAL IMAGE URLS**" in property data
- Do NOT create fake image URLs or placeholder URLs
- Do NOT use generic descriptions like "image-url-1"
- MUST copy the complete array exactly as shown in property data
- Example: If property shows "**ACTUAL IMAGE URLS**: ["https://...", "https://..."]", copy that EXACT array

OTHER RULES:
- ALWAYS return valid JSON format above
- Maximum ${maxResults} properties in results array ${isAnonymous ? '(limited for guest users)' : ''}
- Copy exact property ID and realtor ID from property data
- Match preferences when provided
- Include realistic match scores (60-95%)
- NO markdown, NO text, ONLY JSON

🔍 PROPERTY OWNER INFORMATION:
- When users ask about property owners or contacts, check if the property has "Property Source Provider" information
- If available, tell them the property is managed by that provider
- Explain that contact details will be shared through the Hausto messaging system after they express interest
- If they explicitly request contact info and it's available, you can mention that the provider's contact will be shared when they send a message`;

      if (!isAnonymous) {
        // Add user preferences context for authenticated renters
        if (userPreferences) {
          const matchingProperties = properties.filter(p => {
            const locationMatch = userPreferences.location?.some((loc: any) => 
              p.location.toLowerCase().includes(loc.toLowerCase().split(',')[0])
            );
            const budgetMatch = userPreferences.priceRange ? 
              p.price <= userPreferences.priceRange[1] * 1.2 : true;
            return locationMatch && budgetMatch;
          });

          console.log(`Found ${matchingProperties.length} properties matching user preferences`);

          if (matchingProperties.length > 0) {
            systemPrompt += `\n\nUSER'S TOP MATCHES (prioritize these):
${matchingProperties.slice(0, 5).map(p => `
ID: ${p.id} | ${p.title} | ${p.location} | ${p.price?.toLocaleString()} VND
`).join('')}`;
          }
        }
      }

      if (Array.isArray(propertyImages) && propertyImages.length > 0) {
        systemPrompt += `\n\n📸 UPLOADED REFERENCE IMAGES:
The user has uploaded ${propertyImages.length} reference image(s). When they ask to "find similar apartments" or mention the uploaded images:
1. Analyze the visual style, color scheme, layout, and design elements from their description
2. Look for properties that match those aesthetic preferences
3. Focus on properties with similar vibes (Modern, Cozy, Minimalist, etc.)
4. Consider architectural features, interior design, lighting, and overall ambiance
5. Prioritize properties that would appeal to someone who likes the reference style

The images have been processed and included in this search request.`;
        
        context += `\n\nUser uploaded ${propertyImages.length} reference image(s) for style matching and similarity search.`;
      }
    }

    const fullContext = `${systemPrompt}

${context}

Conversation History:
${chatHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Current user message: ${message}`;

    // Call Lovable AI Gateway
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      console.error('LOVABLE_API_KEY not found');
      return new Response(
        JSON.stringify({ 
          response: "I'm having trouble connecting to the AI service right now. But I'd be happy to help you find properties! Could you tell me more about what you're looking for - location preferences, budget, or lifestyle needs?"
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    console.log('Calling Lovable AI Gateway...');
    
    // Collect property images for visual amenity analysis (max 8 images to avoid token limits)
    const propertyImagesForAnalysis = properties
      .slice(0, 4) // First 4 properties
      .flatMap(p => {
        const images = Array.isArray(p.images) ? p.images : [];
        return images.slice(0, 2); // Max 2 images per property
      })
      .filter(Boolean);
    
    // Combine uploaded reference images with property images
    const allImagesToAnalyze = [
      ...(Array.isArray(propertyImages) ? propertyImages : []),
      ...propertyImagesForAnalysis
    ];
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: allImagesToAnalyze.length > 0 ? [
          { role: 'system', content: fullContext },
          { 
            role: 'user', 
            content: [
              { type: 'text', text: message },
              ...allImagesToAnalyze.map((image: any) => ({
                type: 'image_url',
                image_url: { url: image }
              }))
            ]
          }
        ] : [
          { role: 'system', content: fullContext },
          { role: 'user', content: message }
        ],
        max_tokens: 2000,
      }),
    });

    console.log('AI Gateway response status:', aiResponse.status);
    
    if (!aiResponse.ok) {
      console.error('AI Gateway error:', aiResponse.status, aiResponse.statusText);
      const errorText = await aiResponse.text();
      console.error('AI Gateway error response:', errorText);
      
      // Provide fallback response
      const fallbackResponse = userType === 'realtor' 
        ? "I'm having trouble connecting to the AI service right now. Please try again in a moment, or feel free to ask me about property marketing strategies!"
        : "I'm having trouble connecting to the AI service right now. But I'd be happy to help you find properties! Could you tell me more about what you're looking for - location preferences, budget, or lifestyle needs?";
      
      // Save fallback response to database when persistence is allowed
      if (canPersist) {
        await supabase
          .from('chat_messages')
          .insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: fallbackResponse
          });
      }

      return new Response(
        JSON.stringify({ response: fallbackResponse }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    const aiData = await aiResponse.json();
    console.log('AI Gateway response received, choices length:', aiData.choices?.length);
    
    if (!aiData.choices || !aiData.choices[0] || !aiData.choices[0].message) {
      console.error('Invalid AI Gateway response structure:', aiData);
      throw new Error('Invalid response from AI Gateway');
    }
    
    // Parse the AI's response
    const aiMessageContent = aiData.choices[0].message.content || 'Sorry, I could not process your request.';

    // Check if the response contains search results
    let searchData = null;
    try {
      const parsed = JSON.parse(aiMessageContent);
      if (parsed.results && Array.isArray(parsed.results)) {
        searchData = parsed;
      }
    } catch (e) {
      // Not JSON, treat as regular text
    }

    // Save AI response to database (only for authenticated users)
    if (canPersist) {
      const { error: aiMessageError } = await supabase
        .from('chat_messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: aiMessageContent
        });

      if (aiMessageError) {
        console.error('Error saving AI message:', aiMessageError);
        throw aiMessageError;
      }
    }

    // If this is a search result, save it to the ai_searches and ai_search_results tables (only for authenticated users)
    if (searchData && user?.id && canPersist) {
      try {
        // Create AI search record
        const { data: searchRecord, error: searchError } = await supabase
          .from('ai_searches')
          .insert({
            conversation_id: conversationId,
            user_id: user.id,
            query: message,
            summary: searchData.summary || '',
            total_matches: searchData.results.length
          })
          .select()
          .single();

        if (searchError) {
          console.error('Error saving search record:', searchError);
        } else if (searchRecord && searchData.results.length > 0) {
          // Save individual search results
          const searchResults = searchData.results.map((result: any) => ({
            search_id: searchRecord.id,
            property_id: result.id,
            match_score: result.matchScore,
            match_reason: result.matchReason
          }));

          const { error: resultsError } = await supabase
            .from('ai_search_results')
            .insert(searchResults);

          if (resultsError) {
            console.error('Error saving search results:', resultsError);
          } else {
            console.log(`Saved ${searchResults.length} search results for search ${searchRecord.id}`);
          }
        }
      } catch (searchSaveError) {
        console.error('Error processing search results:', searchSaveError);
        // Don't fail the whole request if search saving fails
      }
    }

    // Track AI search usage for authenticated users
    if (user?.id && !isAnonymous) {
      try {
        const today = new Date().toISOString().split('T')[0];
        
        // Get current usage for today
        const { data: currentUsage } = await supabase
          .from('daily_usage')
          .select('ai_requests, properties_viewed, properties_matched, quiz_retakes')
          .eq('user_id', user.id)
          .eq('usage_date', today)
          .maybeSingle();

        const newAiRequests = (currentUsage?.ai_requests || 0) + 1;

        // Upsert usage record
        const { error: usageError } = await supabase
          .from('daily_usage')
          .upsert({
            user_id: user.id,
            usage_date: today,
            ai_requests: newAiRequests,
            properties_viewed: currentUsage?.properties_viewed || 0,
            properties_matched: currentUsage?.properties_matched || 0,
            quiz_retakes: currentUsage?.quiz_retakes || 0,
          }, {
            onConflict: 'user_id,usage_date',
            ignoreDuplicates: false
          });

        if (usageError) {
          console.error('Error tracking AI search usage:', usageError);
        } else {
          console.log(`Successfully tracked AI search usage for user ${user.id}, total today: ${newAiRequests}`);
        }
      } catch (usageTrackError) {
        console.error('Error in usage tracking:', usageTrackError);
        // Don't fail the whole request if usage tracking fails
      }
    }

    // Record successful anonymous search attempt
    if (isAnonymous) {
      const xForwardedFor = req.headers.get('x-forwarded-for');
      const xRealIp = req.headers.get('x-real-ip');
      const cfConnectingIp = req.headers.get('cf-connecting-ip');
      const clientIP = (xForwardedFor?.split(',')[0].trim() || xRealIp || cfConnectingIp || 'unknown');

      if (clientIP !== 'unknown') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check existing attempts for today
        const { data: existingAttempt } = await supabase
          .from('anonymous_chat_attempts')
          .select('*')
          .eq('ip_address', clientIP)
          .gte('last_attempt_at', today.toISOString())
          .single();

        if (existingAttempt) {
          // Update existing attempt count
          const { error: updateError } = await supabase
            .from('anonymous_chat_attempts')
            .update({
              attempt_count: existingAttempt.attempt_count + 1,
              last_attempt_at: new Date().toISOString()
            })
            .eq('id', existingAttempt.id);

          if (updateError) {
            console.error('Error updating chat attempt:', updateError);
          } else {
            console.log(`Updated anonymous search count to ${existingAttempt.attempt_count + 1}/2 for IP:`, clientIP);
          }
        } else {
          // Create new attempt record
          const { error: insertError } = await supabase
            .from('anonymous_chat_attempts')
            .insert({
              ip_address: clientIP,
              attempt_count: 1,
              last_attempt_at: new Date().toISOString()
            });

          if (insertError) {
            console.error('Error recording chat attempt:', insertError);
          } else {
            console.log('Successfully recorded first anonymous search (1/2) for IP:', clientIP);
          }
        }
      }
    }

    return new Response(JSON.stringify({ response: aiMessageContent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in chat-ai function:', error);
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