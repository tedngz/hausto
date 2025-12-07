import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { Redis } from "https://esm.sh/@upstash/redis@latest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Upstash Redis client
const redis = new Redis({
  url: Deno.env.get('UPSTASH_REDIS_REST_URL')!,
  token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!,
});

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

    // Rate limiting for anonymous users - 2 free searches per day using Redis
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
        try {
          // Redis key format: anon_rate:IP:YYYY-MM-DD
          const today = new Date().toISOString().split('T')[0];
          const rateLimitKey = `anon_rate:${clientIP}:${today}`;
          
          // Get current attempt count from Redis
          const attempts = await redis.get(rateLimitKey) as number | null;
          const currentAttempts = attempts || 0;
          
          console.log(`[Redis] Anonymous user search count: ${currentAttempts}/2 for IP: ${clientIP}`);
          
          if (currentAttempts >= 2) {
            console.log(`[Redis] Anonymous user rate limited (${currentAttempts}/2)`);
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
          
          // Increment counter and set expiry to end of day (86400 seconds = 24 hours)
          await redis.incr(rateLimitKey);
          await redis.expire(rateLimitKey, 86400);
          
          console.log(`[Redis] Incremented attempts to ${currentAttempts + 1}/2`);
        } catch (redisError) {
          console.error('[Redis] Error checking rate limit:', redisError);
          // Continue with request if Redis fails - graceful degradation
        }
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
    
    // Filter to ONLY include properties with amenities
    const propertiesWithAmenities = properties.filter(p => {
      const amenities = p.vibe_analysis?.amenities || p.amenities || [];
      return amenities.length > 0;
    });
    
    console.log(`Found ${properties.length} total properties, ${propertiesWithAmenities.length} with amenities${isAnonymous ? ' for anonymous user' : ''}`);
    
    // Use filtered properties for AI context
    const filteredProperties = propertiesWithAmenities;
    
    // For anonymous users, we'll limit results in the system prompt
    const maxResults = isAnonymous ? 3 : 5;
    
    // ========== HYBRID EXTERNAL MARKETPLACE SEARCH WITH DATABASE CACHING ==========
    // Detect property search intent (automatic - doesn't require explicit marketplace mention)
    const propertySearchPatterns = [
      /\b(find|search|look for|looking for|show me|get|want|need)\b.*\b(apartment|room|studio|house|flat|condo|property|place|home|rental|rent)\b/i,
      /\b(apartment|room|studio|house|flat|condo|property|place|home|rental)\b.*\b(in|at|near|around)\b/i,
      /\b(tìm|kiếm|muốn|cần)\b.*\b(phòng|căn hộ|nhà|chung cư)\b/i,
      /\b(d[1-9]|d1[0-2]|district\s*\d+|quận\s*\d+)\b/i, // Location mentions suggest property search
      /\b(budget|price|cheap|affordable|under|below|around)\b.*\b(million|triệu|vnd|đồng)\b/i,
    ];
    
    const isPropertySearch = propertySearchPatterns.some(pattern => pattern.test(message));
    
    // Detect if user explicitly mentions a marketplace (for prioritization)
    const detectMarketplace = (msg: string): 'batdongsan' | 'nhatot' | 'airbnb' | null => {
      const lower = msg.toLowerCase();
      if (lower.includes('batdongsan') || lower.includes('bds') || lower.includes('bat dong san')) return 'batdongsan';
      if (lower.includes('nhatot') || lower.includes('nha tot') || lower.includes('nhà tốt')) return 'nhatot';
      if (lower.includes('airbnb')) return 'airbnb';
      return null;
    };
    
    const detectedMarketplace = detectMarketplace(message);
    let externalProperties: any[] = [];
    
    // Automatic external search when doing property searches (for both authenticated and anonymous users)
    const shouldSearchExternal = isPropertySearch;
    
    console.log(`[External Search] Detection: isPropertySearch=${isPropertySearch}, detectedMarketplace=${detectedMarketplace}, shouldSearch=${shouldSearchExternal}`);
    
    if (shouldSearchExternal) {
      console.log(`[External Search] Property search detected, using hybrid caching approach`);
      
      try {
        // Extract location from message or use preferences
        const locationPatterns = [
          /\b(d[1-9]|d1[0-2]|district\s*\d+|quận\s*\d+)\b/i,
          /\b(binh thanh|bình thạnh|phu nhuan|phú nhuận|tan binh|tân bình|go vap|gò vấp)\b/i,
          /\b(ho chi minh|hcm|saigon|sài gòn|hanoi|hà nội|da nang|đà nẵng)\b/i,
        ];
        
        let searchLocation = '';
        for (const pattern of locationPatterns) {
          const match = message.match(pattern);
          if (match) {
            searchLocation = match[0];
            break;
          }
        }
        
        // Fallback to user preferences location
        if (!searchLocation && userPreferences?.location?.[0]) {
          searchLocation = userPreferences.location[0];
        }
        
        console.log(`[External Search] Extracted location: "${searchLocation}"`);
        
        // Normalize location for database lookup
        const normalizedLocation = searchLocation.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        // ========== STEP 1: CHECK DATABASE CACHE FIRST ==========
        console.log(`[External Search] Step 1: Checking database cache for location: ${normalizedLocation}`);
        
        const { data: cachedExternal, error: cacheError } = await supabase
          .from('external_properties')
          .select('*')
          .eq('is_active', true)
          .gt('expires_at', new Date().toISOString());
        
        // Apply location filter if we have a location
        let filteredCached = cachedExternal || [];
        if (normalizedLocation && filteredCached.length > 0) {
          filteredCached = filteredCached.filter((p: any) => 
            (p.location_normalized && p.location_normalized.includes(normalizedLocation)) ||
            (p.location && p.location.toLowerCase().includes(normalizedLocation))
          );
        }
        
        // Apply price filter if user has preferences
        if (userPreferences?.priceRange && filteredCached.length > 0) {
          const [minPrice, maxPrice] = userPreferences.priceRange;
          filteredCached = filteredCached.filter((p: any) => {
            if (minPrice && p.price < minPrice * 0.8) return false; // 20% flexibility
            if (maxPrice && p.price > maxPrice * 1.2) return false;
            return true;
          });
        }
        
        // Limit results
        filteredCached = filteredCached.slice(0, 5);
        
        console.log(`[External Search] Database cache: ${filteredCached.length} properties found (from ${cachedExternal?.length || 0} total)`);
        
        if (filteredCached.length > 0) {
          // Check cache freshness
          const oldestCrawl = filteredCached.reduce((oldest: Date, p: any) => {
            const crawledAt = new Date(p.crawled_at);
            return crawledAt < oldest ? crawledAt : oldest;
          }, new Date());
          
          const cacheAgeHours = (Date.now() - oldestCrawl.getTime()) / (1000 * 60 * 60);
          console.log(`[External Search] Cache age: ${cacheAgeHours.toFixed(1)} hours`);
          
          // Convert cached properties to external property format
          externalProperties = filteredCached.map((p: any) => ({
            id: p.id,
            title: p.title,
            location: p.location,
            price: p.price,
            priceDisplay: p.price_display,
            size: p.size,
            images: p.images || [],
            description: p.description,
            highlights: p.highlights || [],
            amenities: p.amenities || [],
            source: p.source,
            sourceUrl: p.source_url,
            sourceProviderName: p.contact_name,
            sourceProviderPhone: p.contact_phone,
            vibe: p.vibe,
            vibe_analysis: p.vibe_analysis,
            isExternal: true,
            cached: true,
            crawledAt: p.crawled_at,
          }));
          
          console.log(`[External Search] Returning ${externalProperties.length} cached properties`);
          
          // ========== STEP 2: STALE-WHILE-REVALIDATE ==========
          // If cache is stale (> 6 hours), trigger background refresh
          if (cacheAgeHours > 6) {
            console.log(`[External Search] Cache stale (${cacheAgeHours.toFixed(1)}h), triggering background refresh`);
            
            // Use EdgeRuntime.waitUntil for background task (fire and forget)
            const backgroundRefresh = async () => {
              try {
                const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/crawl-external-properties`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                  },
                  body: JSON.stringify({
                    locations: searchLocation ? [searchLocation] : ['D1', 'D2', 'D7', 'Binh Thanh'],
                    marketplaces: detectedMarketplace ? [detectedMarketplace] : ['batdongsan', 'nhatot'],
                    forceRefresh: true,
                    storeInDatabase: true,
                  }),
                });
                
                if (refreshResponse.ok) {
                  const refreshData = await refreshResponse.json();
                  console.log(`[Background Refresh] Completed:`, refreshData.summary);
                } else {
                  console.error(`[Background Refresh] Failed:`, await refreshResponse.text());
                }
              } catch (err) {
                console.error('[Background Refresh] Error:', err);
              }
            };
            
            // Fire and forget - don't await
            backgroundRefresh().catch(err => console.error('[Background Refresh] Uncaught:', err));
          }
          
        } else {
          // ========== STEP 3: ON-DEMAND CRAWL ==========
          // No cached data, perform real-time scrape
          console.log(`[External Search] No cache, performing on-demand crawl for: ${searchLocation || 'default locations'}`);
          
          // Build search query from message
          const searchQuery = message
            .replace(/find|search|look for|looking for|show me|get|want|need/gi, '')
            .replace(/apartment|room|studio|house|flat|condo|property|place|home|rental|rent/gi, 'apartment')
            .replace(/in|at|near|around/gi, '')
            .trim() || 'apartment';
          
          // Use detected marketplace or default to batdongsan + nhatot
          const marketplaces = detectedMarketplace 
            ? [detectedMarketplace] 
            : ['batdongsan', 'nhatot'] as const;
          
          // Search marketplaces with timeout
          const scrapePromises = marketplaces.map(async (marketplace) => {
            console.log(`[External Search] On-demand scrape: marketplace=${marketplace}, location=${searchLocation}`);
            
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
              
              const scrapeResponse = await fetch(`${supabaseUrl}/functions/v1/scrape-marketplace`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({
                  marketplace,
                  query: searchQuery,
                  location: searchLocation,
                  minPrice: userPreferences?.priceRange?.[0],
                  maxPrice: userPreferences?.priceRange?.[1],
                  includeVibeAnalysis: true,
                }),
                signal: controller.signal,
              });
              
              clearTimeout(timeoutId);
              
              console.log(`[External Search] On-demand response from ${marketplace}: ${scrapeResponse.status}`);
              
              if (scrapeResponse.ok) {
                const scrapeData = await scrapeResponse.json();
                console.log(`[External Search] On-demand data from ${marketplace}:`, {
                  success: scrapeData.success,
                  propertiesCount: scrapeData.properties?.length || 0,
                });
                
                if (scrapeData.success && scrapeData.properties?.length > 0) {
                  console.log(`[External Search] On-demand found ${scrapeData.properties.length} properties from ${marketplace}`);
                  
                  // Store in database for future cache (background)
                  const storeInDb = async () => {
                    try {
                      for (const property of scrapeData.properties) {
                        const externalId = property.sourceUrl 
                          ? btoa(property.sourceUrl).substring(0, 100)
                          : `${marketplace}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                        
                        const locationNormalized = (property.location || searchLocation || '').toLowerCase()
                          .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
                        
                        const detectCity = (loc: string) => {
                          const lower = loc.toLowerCase();
                          if (/(ho chi minh|hcm|saigon|d[0-9]|binh thanh|phu nhuan)/i.test(lower)) return 'ho_chi_minh';
                          if (/(ha noi|hanoi|ba dinh|hoan kiem)/i.test(lower)) return 'hanoi';
                          return 'other';
                        };
                        
                        await supabase.from('external_properties').upsert({
                          external_id: externalId,
                          source: marketplace,
                          source_url: property.sourceUrl || `https://${marketplace}.com.vn`,
                          title: property.title || 'Rental Property',
                          location: property.location || searchLocation,
                          location_normalized: locationNormalized,
                          city: detectCity(property.location || searchLocation),
                          price: property.price || 0,
                          price_display: property.priceDisplay,
                          size: property.size,
                          description: property.description,
                          highlights: property.highlights || [],
                          amenities: property.amenities || [],
                          images: property.images || [],
                          contact_name: property.sourceProviderName,
                          contact_phone: property.sourceProviderPhone,
                          vibe: property.vibe,
                          vibe_analysis: property.vibe_analysis || {},
                          crawled_at: new Date().toISOString(),
                          expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
                          is_active: true,
                        }, { onConflict: 'source,external_id' });
                      }
                      console.log(`[External Search] Stored ${scrapeData.properties.length} properties in database`);
                    } catch (storeErr) {
                      console.error('[External Search] Error storing properties:', storeErr);
                    }
                  };
                  
                  // Fire and forget storage
                  storeInDb().catch(err => console.error('[External Search] Store error:', err));
                  
                  return scrapeData.properties.map((p: any) => ({
                    ...p,
                    source: marketplace,
                    isExternal: true,
                    cached: false,
                  }));
                }
              } else {
                const errorText = await scrapeResponse.text();
                console.error(`[External Search] On-demand error from ${marketplace}: ${errorText}`);
              }
            } catch (fetchError) {
              console.error(`[External Search] On-demand fetch error for ${marketplace}:`, fetchError);
            }
            return [];
          });
          
          const results = await Promise.all(scrapePromises);
          externalProperties = results.flat().slice(0, 5);
          console.log(`[External Search] On-demand total properties: ${externalProperties.length}`);
        }
        
        if (externalProperties.length > 0) {
          console.log(`[External Search] Final external properties:`, externalProperties.slice(0, 2).map((p: any) => ({
            id: p.id,
            title: p.title,
            source: p.source,
            price: p.price,
            cached: p.cached,
          })));
        }
        
      } catch (externalError) {
        console.error('[External Search] Error:', externalError);
        // Continue with internal search only
      }
    }
    // ========== END AUTOMATIC EXTERNAL MARKETPLACE SEARCH INTEGRATION ==========

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

📝 CONVERSATION CONTEXT & MEMORY:
${chatHistory.length > 0 ? `You have access to the conversation history. USE IT to maintain context across requests:
- Remember locations mentioned in previous messages (e.g., if user asked about D2 before, stay in Ho Chi Minh City)
- Remember preferences stated earlier (e.g., budget, size, amenities)
- Build upon previous searches - don't reset context
- If user asks for "rooms with sofa" after searching "rooms in D2", search for sofas WITHIN the previously mentioned location (D2/HCM)
- NEVER jump between cities unless explicitly requested
- When no specific location mentioned, default to the last mentioned city/area from conversation history` : 'This is the first message in the conversation.'}

🏠 AVAILABLE PROPERTIES DATABASE (${filteredProperties.length} total properties WITH AMENITIES):
${filteredProperties.map((p, index) => {
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

${externalProperties.length > 0 ? `
🌐 EXTERNAL MARKETPLACE RESULTS (from ${detectedMarketplace || 'external source'}):
These properties were found on external marketplaces. Include them in results with "isExternal: true".

${externalProperties.map((p, index) => `
External Property ${index + 1}:
Title: ${p.title}
Location: ${p.location}
Price: ${p.price?.toLocaleString()} VND/month (${p.priceDisplay || 'N/A'})
Size: ${p.size || 'N/A'}
Description: ${(p.description || '').substring(0, 200)}
Highlights: ${Array.isArray(p.highlights) ? p.highlights.join(', ') : 'N/A'}
Amenities: ${Array.isArray(p.amenities) ? p.amenities.join(', ') : 'N/A'}
Property ID (for matching): ${p.id}
Source: ${p.source}
Source URL: ${p.sourceUrl}
${p.sourceProviderName ? `Contact Name: ${p.sourceProviderName}` : ''}
${p.sourceProviderPhone ? `Contact Phone: ${p.sourceProviderPhone}` : ''}
`).join('\n')}
` : ''}

🚨 CRITICAL LOCATION & PRICE MATCHING RULES (HIGHEST PRIORITY):
1. LOCATION MATCHING:
   - ALWAYS prioritize exact location matches FIRST
   - Same district = perfect match (highest priority)
   - Adjacent districts in SAME CITY = acceptable alternative (e.g., D1 → D2, D4, D3)
   - Different city = NEVER suggest (e.g., NEVER suggest Hanoi if user searches in Ho Chi Minh City districts like D1, D2, Binh Thanh)
   - Vietnam geography context:
     * Ho Chi Minh City districts: D1, D2, D3, D4, D5, D7, D10, Binh Thanh, Phu Nhuan, Go Vap, Tan Binh, etc.
     * Hanoi districts: Ba Dinh, Hoan Kiem, Dong Da, Hai Ba Trung, etc.
     * NEVER cross city boundaries in suggestions

2. PRICE MATCHING:
   - Within user's stated budget = highest priority
   - Slightly outside budget (±10%) = acceptable ONLY if location is perfect and user explicitly asks for flexibility
   - Properties significantly outside budget = only suggest if NO other matches and explicitly explain the price difference
   - Always show prices clearly in match reasons

3. IF NO EXACT MATCHES:
   - First try: nearby districts in SAME CITY only
   - Clearly state "I found these in nearby [District Name], which is close to your preferred [District Name]"
   - If still no matches: suggest relaxing price range or being flexible with location (within same city)
   - NEVER suggest a different city as an alternative

⚠️ CRITICAL AMENITY RULES:
- 🚨 ONLY suggest properties that have amenities listed (NEVER suggest properties with "None listed" amenities)
- ONLY use properties from the database that have actual amenities in the "**AMENITIES**" section
- ANALYZE THE PROPERTY IMAGES provided to verify and identify amenities visually
- Cross-reference visual amenities with the listed amenities in "**AMENITIES**" section
- If you see amenities in images that aren't listed, you CAN mention them but note they were "observed in photos"
- If amenities are listed but not visible in photos, still mention them as "listed amenities"
- Be specific about what you see: pool, gym equipment, balcony, parking, kitchen appliances, etc.
- When describing properties, combine both listed amenities AND what you observe in the images
- Properties without amenities should NEVER be included in search results

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
      "matchReason": "This cozy apartment in [location] features [key features] that match your search",
      "realtor_id": "copy-exact-realtor-id-from-above",
      "isExternal": false,
      "source": null,
      "sourceUrl": null
    },
    {
      "id": "external-batdongsan-xxx (for external properties)",
      "title": "External property title",
      "location": "District 1, Ho Chi Minh City",
      "price": 8000000,
      "size": "30m²",
      "vibe": "Modern",
      "description": "Property from external marketplace",
      "highlights": ["Modern", "Furnished"],
      "images": [],
      "matchScore": 75,
      "matchReason": "Found on batdongsan.com.vn - this studio in D1 matches your budget",
      "realtor_id": null,
      "isExternal": true,
      "source": "batdongsan",
      "sourceUrl": "https://batdongsan.com.vn/...",
      "sourceProviderName": "Contact name if available",
      "sourceProviderPhone": "Phone if available"
    }
  ],
  "summary": "Found X properties matching your preferences (Y from external marketplaces)...",
  "totalMatches": 3
}

⚠️ MATCH REASON WRITING STYLE:
- Write naturally and conversationally, not formulaic
- ALWAYS mention location and price if relevant to user's search
- Start with describing what the property offers, not "Perfect match because..."
- Examples of GOOD match reasons:
  • "This cozy 2-bedroom apartment in District 1 is priced at 12M VND/month with a comfortable sofa in the living room"
  • "Located in your preferred District 2 at 15M VND/month with modern furnishings and city views"
  • "In nearby District 4 (close to D1) at 11M VND/month - features a spacious balcony and natural lighting throughout"
  • "Found in Binh Thanh (adjacent to your search area) at 13M VND/month with fully furnished kitchen"
- Examples of BAD match reasons to AVOID:
  • "Perfect match because it includes a sofa and is located in Binh Thanh"
  • "This property matches because it has..."
  • "Great match due to..."
- When showing properties outside exact criteria:
  • Clearly state if in nearby district: "in nearby District X (close to your preferred District Y)"
  • Clearly state if price is outside budget: "at 18M VND/month (slightly above your 15M budget)"

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
    
    // Check Redis cache for AI responses (only for simple queries without images)
    let aiResponse = null;
    let cacheHit = false;
    
    // Create cache key from normalized query + user preferences
    const normalizedQuery = message.toLowerCase().trim();
    const hasImages = Array.isArray(propertyImages) && propertyImages.length > 0;
    
    if (!hasImages && !isAnonymous) {
      try {
        const cacheKey = `ai_search:${user?.id}:${Buffer.from(normalizedQuery).toString('base64').substring(0, 50)}`;
        const cachedResponse = await redis.get(cacheKey) as string | null;
        
        if (cachedResponse) {
          aiResponse = cachedResponse;
          cacheHit = true;
          console.log('[Redis] Cache HIT - returning cached AI response');
        } else {
          console.log('[Redis] Cache MISS - will call OpenAI API');
        }
      } catch (cacheError) {
        console.error('[Redis] Cache check error:', cacheError);
        // Continue to API call if cache fails
      }
    }
    
    // Only call OpenAI if we don't have a cached response
    if (!cacheHit) {
      // Only use uploaded reference images to avoid OpenAI timeout issues
      // when downloading property images from Supabase storage
      const allImagesToAnalyze = Array.isArray(propertyImages) ? propertyImages : [];
      
      // Build messages array with conversation history for context continuity
      const messagesWithHistory = [
        { role: 'system', content: fullContext },
        ...chatHistory.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
      ];
      
      // Add the new user message (with or without images)
      if (allImagesToAnalyze.length > 0) {
        messagesWithHistory.push({
          role: 'user',
          content: [
            { type: 'text', text: message },
            ...allImagesToAnalyze.map((image: any) => ({
              type: 'image_url',
              image_url: { url: image }
            }))
          ]
        });
      } else {
        messagesWithHistory.push({
          role: 'user',
          content: message
        });
      }
      
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: messagesWithHistory,
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

      const openaiData = await openaiResponse.json();
      console.log('OpenAI response received, choices length:', openaiData.choices?.length);
      
      if (!openaiData.choices || !openaiData.choices[0] || !openaiData.choices[0].message) {
        console.error('Invalid OpenAI response structure:', openaiData);
        throw new Error('Invalid response from OpenAI');
      }
      
      // Parse the AI's response and normalize it (strip markdown/code fences)
      const rawContent = openaiData.choices[0].message.content || 'Sorry, I could not process your request.';
      aiResponse = normalizeAiResponse(rawContent);
      
      // Cache the response in Redis (1 hour TTL) for authenticated users without images
      if (!hasImages && !isAnonymous && user?.id) {
        try {
          const cacheKey = `ai_search:${user.id}:${Buffer.from(normalizedQuery).toString('base64').substring(0, 50)}`;
          await redis.setex(cacheKey, 3600, aiResponse); // 1 hour = 3600 seconds
          console.log('[Redis] Cached AI response for future requests');
        } catch (cacheError) {
          console.error('[Redis] Error caching response:', cacheError);
          // Continue even if caching fails
        }
      }
    }

    // Check if the response contains search results
    let searchData = null;
    try {
      const parsed = JSON.parse(aiResponse);
      if (parsed.results && Array.isArray(parsed.results)) {
        searchData = parsed;
        console.log(`[Response] Parsed ${searchData.results.length} results from AI response`);
        
        // Check if AI included external properties
        const externalInAI = searchData.results.filter((r: any) => r.isExternal);
        console.log(`[Response] AI included ${externalInAI.length} external properties`);
        
        // If we have external properties but AI didn't include them, manually inject
        if (externalProperties.length > 0 && externalInAI.length === 0) {
          console.log(`[Response] AI omitted external properties, manually injecting ${externalProperties.length}`);
          
          // Format external properties to match the expected structure
          const formattedExternal = externalProperties.map((p: any) => ({
            id: p.id,
            title: p.title || 'External Property',
            location: p.location || 'Ho Chi Minh City',
            price: p.price || 0,
            size: p.size || 'N/A',
            vibe: p.vibe || p.vibe_analysis?.style || 'Modern',
            description: p.description || '',
            highlights: p.highlights || [],
            images: p.images || [],
            matchScore: 70, // Default match score for external
            matchReason: `Found on ${p.source || 'external marketplace'} - ${p.priceDisplay || `${p.price?.toLocaleString()} VND/month`}`,
            realtor_id: null,
            isExternal: true,
            source: p.source,
            sourceUrl: p.sourceUrl,
            sourceProviderName: p.sourceProviderName,
            sourceProviderPhone: p.sourceProviderPhone,
            vibe_analysis: p.vibe_analysis,
            amenities: p.amenities || p.vibe_analysis?.amenities || [],
          }));
          
          // Append external properties to results
          searchData.results = [...searchData.results, ...formattedExternal];
          searchData.totalMatches = searchData.results.length;
          
          // Update summary to mention external results
          if (searchData.summary && !searchData.summary.includes('external')) {
            searchData.summary += ` Also found ${formattedExternal.length} properties from external marketplaces.`;
          }
          
          // Update the aiResponse with injected properties
          aiResponse = JSON.stringify(searchData);
          console.log(`[Response] Final response includes ${searchData.results.length} total properties`);
        }
      }
    } catch (e) {
      // Not JSON, treat as regular text
      console.log('[Response] AI response is not JSON, treating as text');
    }

    // Save AI response to database (only for authenticated users)
    if (canPersist) {
      const { error: aiMessageError } = await supabase
        .from('chat_messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: aiResponse
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

    // Anonymous search tracking is now handled by Redis rate limiting above
    // No need for separate database tracking

    return new Response(JSON.stringify({ response: normalizeAiResponse(aiResponse) }), {
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

// Helper to clean AI responses that might be wrapped in Markdown code fences
function normalizeAiResponse(content: string): string {
  if (!content) return '';
  let cleaned = content.trim();

  // Remove leading triple backtick block (``` or ```json)
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    if (firstNewline !== -1) {
      cleaned = cleaned.slice(firstNewline + 1);
    }
  }

  // Remove trailing triple backticks if present
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }

  return cleaned.trim();
}
