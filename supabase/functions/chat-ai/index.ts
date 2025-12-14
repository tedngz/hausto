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

// ========== LOCATION KNOWLEDGE BASE ==========
const LOCATION_DATA = {
  hcm: {
    name: 'Ho Chi Minh City',
    aliases: ['ho chi minh', 'hcm', 'saigon', 'sài gòn', 'sai gon', 'hồ chí minh', 'tp.hcm', 'tphcm'],
    districts: {
      center: {
        names: ['d1', 'district 1', 'quan 1', 'quận 1', 'q1', 'd3', 'district 3', 'quan 3', 'quận 3', 'q3'],
        description: 'Central business district with premium pricing, walkable, vibrant nightlife',
        avgPrice: { min: 15000000, max: 40000000 }
      },
      nearCenter: {
        names: ['d4', 'district 4', 'quan 4', 'quận 4', 'q4', 'd5', 'district 5', 'quan 5', 'quận 5', 'q5', 
                'binh thanh', 'bình thạnh', 'phu nhuan', 'phú nhuận', 'd10', 'district 10', 'quan 10', 'quận 10',
                'da kao', 'đa kao', 'dakao'],
        description: 'Close to center, good value, mix of local and expat communities',
        avgPrice: { min: 10000000, max: 25000000 }
      },
      suburban: {
        names: ['d7', 'district 7', 'quan 7', 'quận 7', 'q7', 'd2', 'district 2', 'quan 2', 'quận 2', 'q2',
                'thu duc', 'thủ đức', 'tan binh', 'tân bình', 'go vap', 'gò vấp', 'd9', 'district 9', 'quan 9', 'quận 9',
                'binh tan', 'bình tân', 'tan phu', 'tân phú', 'd12', 'district 12', 'quan 12', 'quận 12',
                'thao dien', 'thảo điền', 'an phu', 'an phú', 'thu thiem', 'thủ thiêm'],
        description: 'Modern developments, more space, family-friendly, requires transportation',
        avgPrice: { min: 7000000, max: 18000000 }
      }
    }
  },
  hanoi: {
    name: 'Hanoi',
    aliases: ['hanoi', 'ha noi', 'hà nội', 'hn'],
    districts: {
      center: {
        names: ['ba dinh', 'ba đình', 'hoan kiem', 'hoàn kiếm', 'dong da', 'đống đa'],
        description: 'Historic center, government area, traditional neighborhoods',
        avgPrice: { min: 12000000, max: 35000000 }
      },
      nearCenter: {
        names: ['hai ba trung', 'hai bà trưng', 'cau giay', 'cầu giấy', 'thanh xuan', 'thanh xuân',
                'hoang mai', 'hoàng mai'],
        description: 'Mixed residential/commercial, good connectivity',
        avgPrice: { min: 8000000, max: 20000000 }
      },
      suburban: {
        names: ['nam tu liem', 'nam từ liêm', 'bac tu liem', 'bắc từ liêm', 'tay ho', 'tây hồ', 
                'long bien', 'long biên', 'ha dong', 'hà đông', 'gia lam', 'gia lâm',
                'thanh tri', 'thanh trì', 'dong anh', 'đông anh', 'me linh', 'mê linh',
                'soc son', 'sóc sơn', 'hoai duc', 'hoài đức'],
        description: 'New developments, larger apartments, requires transportation',
        avgPrice: { min: 6000000, max: 15000000 }
      }
    }
  }
};

// ========== ENHANCED DETECTION FUNCTIONS ==========
function detectCity(text: string): 'hcm' | 'hanoi' | null {
  const lowerText = text.toLowerCase();
  
  // Check HCMC aliases and districts
  if (LOCATION_DATA.hcm.aliases.some(a => lowerText.includes(a))) return 'hcm';
  for (const tier of Object.values(LOCATION_DATA.hcm.districts)) {
    if (tier.names.some(d => lowerText.includes(d))) return 'hcm';
  }
  
  // Check Hanoi aliases and districts
  if (LOCATION_DATA.hanoi.aliases.some(a => lowerText.includes(a))) return 'hanoi';
  for (const tier of Object.values(LOCATION_DATA.hanoi.districts)) {
    if (tier.names.some(d => lowerText.includes(d))) return 'hanoi';
  }
  
  return null;
}

function getLocationTier(location: string, city: 'hcm' | 'hanoi'): 'center' | 'near-center' | 'suburban' | 'unknown' {
  const locLower = location.toLowerCase();
  const cityData = LOCATION_DATA[city];
  
  if (cityData.districts.center.names.some(d => locLower.includes(d))) return 'center';
  if (cityData.districts.nearCenter.names.some(d => locLower.includes(d))) return 'near-center';
  if (cityData.districts.suburban.names.some(d => locLower.includes(d))) return 'suburban';
  
  return 'unknown';
}

function isCenterRequest(text: string): boolean {
  const lowerText = text.toLowerCase();
  return /\b(center|central|trung tâm|trung tam|downtown|city center|nội thành|noi thanh)\b/.test(lowerText);
}

function parsePrice(text: string): number | null {
  const patterns = [
    /(?:under|below|less than|dưới|max|maximum|budget)\s*(\d+(?:\.\d+)?)\s*(mil|million|m|tr|triệu|trieu)/gi,
    /(\d+(?:\.\d+)?)\s*(mil|million|m|tr|triệu|trieu)\s*(?:or less|max|maximum|budget|vnd)/gi,
    /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:vnd|đồng|dong)/gi, // Direct VND amounts
  ];
  
  for (const pattern of patterns) {
    const matches = text.toLowerCase().matchAll(pattern);
    for (const match of matches) {
      let value = parseFloat(match[1].replace(/,/g, ''));
      
      // Convert to VND if in millions
      if (match[2] && /mil|million|m|tr|triệu|trieu/i.test(match[2])) {
        value = value * 1000000;
      }
      
      if (value > 0 && value < 100000000) { // Reasonable price range
        return value;
      }
    }
  }
  return null;
}

function extractAmenities(text: string): string[] {
  const lowerText = text.toLowerCase();
  const amenityMap: Record<string, string[]> = {
    'balcony': ['balcony', 'ban công', 'ban cong'],
    'pool': ['pool', 'swimming', 'hồ bơi', 'ho boi', 'bể bơi', 'be boi'],
    'gym': ['gym', 'fitness', 'phòng gym', 'phong gym', 'tập gym', 'tap gym'],
    'parking': ['parking', 'đỗ xe', 'do xe', 'bãi đỗ', 'bai do', 'garage'],
    'pet': ['pet', 'thú cưng', 'thu cung', 'dog', 'cat', 'chó', 'cho', 'mèo', 'meo'],
    'furnished': ['furnished', 'nội thất', 'noi that', 'đầy đủ', 'day du'],
    'wifi': ['wifi', 'internet', 'mạng', 'mang'],
    'elevator': ['elevator', 'thang máy', 'thang may', 'lift'],
    'security': ['security', 'bảo vệ', 'bao ve', 'an ninh'],
    'garden': ['garden', 'vườn', 'vuon', 'sân vườn', 'san vuon'],
    'sofa': ['sofa', 'ghế sofa', 'ghe sofa', 'couch'],
    'washing machine': ['washing machine', 'máy giặt', 'may giat', 'laundry'],
    'air conditioning': ['air conditioning', 'ac', 'điều hòa', 'dieu hoa', 'máy lạnh', 'may lanh'],
    'kitchen': ['kitchen', 'bếp', 'bep', 'nhà bếp', 'nha bep'],
  };
  
  const found: string[] = [];
  for (const [canonical, variations] of Object.entries(amenityMap)) {
    if (variations.some(v => lowerText.includes(v))) {
      found.push(canonical);
    }
  }
  return found;
}

function extractStyles(text: string): string[] {
  const lowerText = text.toLowerCase();
  const styles = ['luxury', 'modern', 'cozy', 'minimalist', 'industrial', 'bohemian', 
                  'scandinavian', 'contemporary', 'traditional', 'rustic', 'urban', 'vintage'];
  return styles.filter(s => lowerText.includes(s));
}

// ========== ACCUMULATED CONTEXT TYPE ==========
interface AccumulatedContext {
  city: 'hcm' | 'hanoi' | null;
  wantsCenter: boolean;
  locationTier: 'center' | 'near-center' | 'suburban' | null;
  maxPrice: number | null;
  minPrice: number | null;
  amenities: string[];
  styles: string[];
  specificDistricts: string[];
}

// Extract specific districts/areas mentioned by user
function extractSpecificDistricts(text: string): string[] {
  const lowerText = text.toLowerCase();
  const districts: string[] = [];
  
  // HCM specific areas
  const hcmAreas = [
    { names: ['d1', 'district 1', 'quan 1', 'quận 1', 'q1'], canonical: 'district 1' },
    { names: ['d2', 'district 2', 'quan 2', 'quận 2', 'q2'], canonical: 'district 2' },
    { names: ['d3', 'district 3', 'quan 3', 'quận 3', 'q3'], canonical: 'district 3' },
    { names: ['d4', 'district 4', 'quan 4', 'quận 4', 'q4'], canonical: 'district 4' },
    { names: ['d7', 'district 7', 'quan 7', 'quận 7', 'q7'], canonical: 'district 7' },
    { names: ['binh thanh', 'bình thạnh'], canonical: 'binh thanh' },
    { names: ['phu nhuan', 'phú nhuận'], canonical: 'phu nhuan' },
    { names: ['thao dien', 'thảo điền'], canonical: 'thao dien' },
    { names: ['da kao', 'đa kao', 'dakao'], canonical: 'da kao' },
    { names: ['an phu', 'an phú'], canonical: 'an phu' },
    { names: ['thu thiem', 'thủ thiêm'], canonical: 'thu thiem' },
    { names: ['thu duc', 'thủ đức'], canonical: 'thu duc' },
  ];
  
  for (const area of hcmAreas) {
    if (area.names.some(n => lowerText.includes(n))) {
      districts.push(area.canonical);
    }
  }
  
  return districts;
}

function buildAccumulatedContext(chatHistory: Array<{role: string, content: string}>, currentMessage: string): AccumulatedContext {
  const context: AccumulatedContext = {
    city: null,
    wantsCenter: false,
    locationTier: null,
    maxPrice: null,
    minPrice: null,
    amenities: [],
    styles: [],
    specificDistricts: []
  };
  
  // Parse ONLY USER messages for preferences (ignore AI responses to prevent contamination)
  const userMessages = chatHistory
    .filter(m => m.role === 'user')
    .map(m => m.content);
  
  // Add current message (which is always from user)
  const allUserTexts = [...userMessages, currentMessage];
  
  for (const text of allUserTexts) {
    // City detection - PRIORITY: current message overrides history, but only user input matters
    const detectedCity = detectCity(text);
    if (detectedCity) context.city = detectedCity;
    
    // Center preference
    if (isCenterRequest(text)) context.wantsCenter = true;
    
    // Price detection (take the most restrictive)
    const price = parsePrice(text);
    if (price && (!context.maxPrice || price < context.maxPrice)) {
      context.maxPrice = price;
    }
    
    // Amenities (accumulate)
    const amenities = extractAmenities(text);
    for (const a of amenities) {
      if (!context.amenities.includes(a)) context.amenities.push(a);
    }
    
    // Styles (accumulate)
    const styles = extractStyles(text);
    for (const s of styles) {
      if (!context.styles.includes(s)) context.styles.push(s);
    }
    
    // Extract specific districts (accumulate)
    const specificDistricts = extractSpecificDistricts(text);
    for (const d of specificDistricts) {
      if (!context.specificDistricts.includes(d)) context.specificDistricts.push(d);
    }
  }
  
  // Determine location tier based on center preference
  if (context.wantsCenter) {
    context.locationTier = 'center';
  }
  
  return context;
}

// ========== PROPERTY FILTERING & SCORING ==========
interface PropertyWithScore {
  id: string;
  title: string;
  location: string;
  price: number;
  description: string;
  highlights: string[];
  amenities: string[];
  styles: string[];
  images: string[];
  realtor_id: string;
  size: string;
  vibe: string;
  providerName?: string;
  providerPhone?: string;
  // Scoring
  matchScore: number;
  priceMatch: boolean;
  locationMatch: boolean;
  amenityMatchCount: number;
  styleMatchCount: number;
  locationTier: string;
  matchReasons: string[];
}

function filterAndScoreProperties(
  properties: any[], 
  context: AccumulatedContext
): PropertyWithScore[] {
  const scored: PropertyWithScore[] = [];
  
  for (const p of properties) {
    const locLower = p.location.toLowerCase();
    const amenities = p.vibe_analysis?.amenities || p.amenities || [];
    const styles = p.vibe_analysis?.styles || [];
    
    // ========== HARD FILTERS (Eliminate non-matching) ==========
    
    // 1. City filter (STRICT)
    if (context.city) {
      const otherCityData = context.city === 'hcm' ? LOCATION_DATA.hanoi : LOCATION_DATA.hcm;
      const isOtherCity = otherCityData.aliases.some(a => locLower.includes(a)) ||
        Object.values(otherCityData.districts).some(tier => 
          tier.names.some(d => locLower.includes(d))
        );
      if (isOtherCity) continue; // Skip properties from wrong city
    }
    
    // 2. Must have amenities
    if (amenities.length === 0) continue;
    
    // ========== SCORING ==========
    let score = 50; // Base score
    const matchReasons: string[] = [];
    
    // Price match
    const priceMatch = context.maxPrice ? p.price <= context.maxPrice : true;
    if (priceMatch && context.maxPrice) {
      score += 25;
      const savings = context.maxPrice - p.price;
      if (savings > 0) {
        matchReasons.push(`${(savings/1000000).toFixed(1)}M under budget`);
      }
    } else if (!priceMatch) {
      score -= 30; // Penalty for over budget
    }
    
    // Specific district match (HIGHEST PRIORITY when user mentions specific areas)
    let locationMatch = true;
    let matchedSpecificDistrict = false;
    
    if (context.specificDistricts.length > 0) {
      // Check if property location matches any of the user's requested districts
      const matchesRequestedDistrict = context.specificDistricts.some(district => {
        // Match variations: "district 2", "d2", "thao dien", etc.
        if (district === 'district 1' && (locLower.includes('district 1') || locLower.includes('d1') || locLower.includes('quan 1'))) return true;
        if (district === 'district 2' && (locLower.includes('district 2') || locLower.includes('d2') || locLower.includes('quan 2'))) return true;
        if (district === 'thao dien' && (locLower.includes('thao dien') || locLower.includes('thảo điền'))) return true;
        if (district === 'da kao' && (locLower.includes('da kao') || locLower.includes('đa kao') || locLower.includes('dakao'))) return true;
        if (district === 'an phu' && (locLower.includes('an phu') || locLower.includes('an phú'))) return true;
        if (district === 'binh thanh' && (locLower.includes('binh thanh') || locLower.includes('bình thạnh'))) return true;
        if (district === 'phu nhuan' && (locLower.includes('phu nhuan') || locLower.includes('phú nhuận'))) return true;
        return locLower.includes(district);
      });
      
      if (matchesRequestedDistrict) {
        score += 35; // Strong bonus for matching specific district
        matchedSpecificDistrict = true;
        matchReasons.push(`in requested area: ${p.location.split(',')[0]}`);
        console.log(`[Scoring] Property ${p.id} matches specific district request: ${p.location}`);
      } else {
        // Property is NOT in any of the user's requested districts
        // Still include but with lower score as alternative
        score -= 10;
        locationMatch = false;
      }
    }
    
    // Location tier match - only apply if no specific districts were requested
    const locationTier = context.city ? getLocationTier(p.location, context.city) : 'unknown';
    
    if (!matchedSpecificDistrict && context.wantsCenter) {
      if (locationTier === 'center') {
        score += 30;
        matchReasons.push('in city center');
        locationMatch = true;
      } else if (locationTier === 'near-center') {
        score += 15;
        matchReasons.push('near city center');
        locationMatch = false; // Partial match
      } else if (locationTier === 'suburban') {
        // Don't heavily penalize - just don't give bonus
        score += 0;
        matchReasons.push(`in ${p.location.split(',')[0]} area`);
        locationMatch = false;
      } else {
        // Unknown location in the target city - mild penalty
        score -= 5;
        locationMatch = false;
      }
    }
    
    // Amenity match
    const lowerAmenities = amenities.map((a: string) => a.toLowerCase());
    let amenityMatchCount = 0;
    for (const reqAmenity of context.amenities) {
      if (lowerAmenities.some((a: string) => a.includes(reqAmenity) || reqAmenity.includes(a))) {
        amenityMatchCount++;
        score += 10;
      }
    }
    if (context.amenities.length > 0 && amenityMatchCount === context.amenities.length) {
      matchReasons.push(`has ${context.amenities.join(', ')}`);
    } else if (amenityMatchCount > 0) {
      matchReasons.push(`has ${amenityMatchCount}/${context.amenities.length} requested amenities`);
    }
    
    // Style match
    const lowerStyles = styles.map((s: string) => s.toLowerCase());
    let styleMatchCount = 0;
    for (const reqStyle of context.styles) {
      if (lowerStyles.some((s: string) => s.includes(reqStyle))) {
        styleMatchCount++;
        score += 5;
      }
    }
    if (styleMatchCount > 0) {
      matchReasons.push(`${context.styles.filter(s => lowerStyles.some((ls: string) => ls.includes(s))).join(', ')} style`);
    }
    
    // Cap score at 100
    score = Math.min(100, Math.max(0, score));
    
    scored.push({
      id: p.id,
      title: p.title,
      location: p.location,
      price: p.price,
      description: p.description || '',
      highlights: p.highlights || [],
      amenities,
      styles,
      images: p.images || [],
      realtor_id: p.realtor_id,
      size: p.size || '',
      vibe: p.vibe || styles.join(', ') || 'Modern',
      providerName: p.property_source_provider_name,
      providerPhone: p.property_source_provider_phone,
      matchScore: score,
      priceMatch,
      locationMatch,
      amenityMatchCount,
      styleMatchCount,
      locationTier,
      matchReasons
    });
  }
  
  // Sort by score descending
  return scored.sort((a, b) => b.matchScore - a.matchScore);
}

// ========== POST-PROCESSING VALIDATION ==========
function validateAndFixAIResults(
  aiResults: any[], 
  validProperties: PropertyWithScore[],
  context: AccumulatedContext
): any[] {
  const validIds = new Set(validProperties.map(p => p.id));
  const validatedResults: any[] = [];
  
  for (const result of aiResults) {
    // Skip if property doesn't exist in our filtered set
    if (!validIds.has(result.id)) {
      console.log(`[Validation] Rejecting AI result ${result.id} - not in valid property set`);
      continue;
    }
    
    // Find the actual property data
    const actualProperty = validProperties.find(p => p.id === result.id);
    if (!actualProperty) continue;
    
    // Fix any incorrect data
    const fixed = {
      ...result,
      price: actualProperty.price, // Use actual price
      location: actualProperty.location, // Use actual location
      images: actualProperty.images, // Use actual images
      realtor_id: actualProperty.realtor_id,
      matchScore: actualProperty.matchScore, // Use our calculated score
    };
    
    // Verify price constraint
    if (context.maxPrice && actualProperty.price > context.maxPrice) {
      console.log(`[Validation] Property ${result.id} is over budget (${actualProperty.price} > ${context.maxPrice}), flagging`);
      fixed.matchReason = `⚠️ Over budget: ${(actualProperty.price/1000000).toFixed(1)}M VND/month (your budget: ${(context.maxPrice/1000000).toFixed(0)}M). ${result.matchReason || ''}`;
      fixed.matchScore = Math.max(10, fixed.matchScore - 30);
    }
    
    validatedResults.push(fixed);
  }
  
  return validatedResults;
}

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
      const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
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

    // Rate limiting for anonymous users
    if (isAnonymous) {
      const xForwardedFor = req.headers.get('x-forwarded-for');
      const xRealIp = req.headers.get('x-real-ip');
      const cfConnectingIp = req.headers.get('cf-connecting-ip');
      const clientIP = (xForwardedFor?.split(',')[0].trim() || xRealIp || cfConnectingIp || 'unknown');

      if (clientIP !== 'unknown') {
        try {
          const today = new Date().toISOString().split('T')[0];
          const rateLimitKey = `anon_rate:${clientIP}:${today}`;
          const attempts = await redis.get(rateLimitKey) as number | null;
          const currentAttempts = attempts || 0;
          
          console.log(`[Redis] Anonymous user search count: ${currentAttempts}/2 for IP: ${clientIP}`);
          
          if (currentAttempts >= 2) {
            return new Response(
              JSON.stringify({ 
                response: 'You\'ve used your 2 free searches today! To get unlimited AI-powered property searches, please sign in or create a free account.',
                requiresAuth: true
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            );
          }
          
          await redis.incr(rateLimitKey);
          await redis.expire(rateLimitKey, 86400);
        } catch (redisError) {
          console.error('[Redis] Error checking rate limit:', redisError);
        }
      }
    }
    
    const requestBody = await req.text();
    if (!requestBody) {
      return new Response(
        JSON.stringify({ error: 'Empty request body' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(requestBody);
    } catch (parseError) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const { message, conversationId, userType, userPreferences, propertyImages } = parsedBody;
    
    console.log('Request data:', { 
      messageLength: message?.length, 
      conversationId, 
      userType, 
      hasPreferences: !!userPreferences,
      hasPropertyImages: !!propertyImages,
      isAnonymous
    });

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Fetch active properties
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
    console.log(`Found ${properties.length} active properties`);

    // Helper functions
    const isValidUUID = (v: string | null | undefined) =>
      typeof v === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
    const canPersist = !isAnonymous && isValidUUID(conversationId);
    let chatHistory: Array<{role: string, content: string}> = [];
    
    // Get conversation history for authenticated users
    if (canPersist) {
      const { data: conversation, error: convError } = await supabase
        .from('chat_conversations')
        .select('user_id')
        .eq('id', conversationId)
        .eq('user_id', user?.id)
        .single();
      
      if (convError || !conversation) {
        return new Response(
          JSON.stringify({ error: 'Conversation not found or access denied' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }

      const { data: history } = await supabase
        .from('chat_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(15); // Increased history limit for better context

      chatHistory = history || [];
    }

    const maxResults = isAnonymous ? 3 : 5;

    // ========== REALTOR MODE ==========
    if (userType === 'realtor') {
      const systemPrompt = `You are Hausto AI, a helpful assistant for real estate professionals. You help realtors create compelling property descriptions, titles, and marketing content.

STANDARD PROPERTY HIGHLIGHTS:
Style Tags: Modern, Cozy, Industrial, Bohemian, Scandinavian, Minimalist, Contemporary, Traditional, Rustic, Luxury, Urban, Vintage
Amenity Tags: Pet Friendly, Gym Access, Pool, Parking, Balcony, Garden, Elevator, Security, WiFi, Furnished, Air Conditioning, Washing Machine
Location Tags: City Center, Quiet Neighborhood, Near Metro, Shopping Nearby, School District, Business District
Feature Tags: High Ceilings, Natural Light, Open Plan, Walk-in Closet, En-suite Bathroom, Kitchen Island, Hardwood Floors

When analyzing property images, ONLY use tags from the standard list above.`;

      const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
      if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
          ],
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Lovable AI error:', response.status, errorText);
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.choices[0].message.content;

      if (canPersist) {
        await supabase.from('chat_messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: aiResponse
        });
      }

      return new Response(JSON.stringify({ response: aiResponse }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // ========== RENTER MODE - Enhanced AI Search ==========
    
    // Build accumulated context from conversation history
    const accContext = buildAccumulatedContext(chatHistory, message);
    console.log('[Context] Accumulated preferences:', JSON.stringify(accContext));

    // Filter and score properties based on accumulated context
    const scoredProperties = filterAndScoreProperties(properties, accContext);
    console.log(`[Filtering] ${scoredProperties.length} properties after filtering (from ${properties.length})`);

    // Separate into matching and non-matching
    const perfectMatches = scoredProperties.filter(p => p.matchScore >= 70);
    const partialMatches = scoredProperties.filter(p => p.matchScore >= 40 && p.matchScore < 70);
    const topProperties = [...perfectMatches, ...partialMatches].slice(0, maxResults + 2);

    console.log(`[Scoring] Perfect matches: ${perfectMatches.length}, Partial: ${partialMatches.length}`);

    // Build context-aware system prompt
    const constraintsSummary = [];
    if (accContext.city) constraintsSummary.push(`City: ${accContext.city === 'hcm' ? 'Ho Chi Minh City' : 'Hanoi'}`);
    if (accContext.maxPrice) constraintsSummary.push(`Budget: under ${(accContext.maxPrice/1000000).toFixed(0)}M VND/month`);
    if (accContext.wantsCenter) constraintsSummary.push(`Location: City center`);
    if (accContext.amenities.length > 0) constraintsSummary.push(`Required amenities: ${accContext.amenities.join(', ')}`);
    if (accContext.styles.length > 0) constraintsSummary.push(`Style preferences: ${accContext.styles.join(', ')}`);

    // Check if we have center matches when user wants center
    const hasCenterMatches = accContext.wantsCenter && topProperties.some(p => p.locationTier === 'center');
    const hasNearCenterMatches = accContext.wantsCenter && topProperties.some(p => p.locationTier === 'near-center');
    
    let locationNote = '';
    if (accContext.wantsCenter && !hasCenterMatches) {
      if (hasNearCenterMatches) {
        locationNote = `\n\n⚠️ NOTE: No properties found in the city CENTER matching the budget. The results below are from NEAR-CENTER areas which offer good connectivity to the center.`;
      } else if (topProperties.length > 0) {
        locationNote = `\n\n⚠️ NOTE: No properties found in the city CENTER or NEAR-CENTER matching the budget. The results below are from SUBURBAN areas of ${accContext.city === 'hcm' ? 'Ho Chi Minh City' : 'Hanoi'}. These areas offer modern apartments at better prices but require transportation to the center.`;
      }
    }

    const systemPrompt = `You are Hausto AI, a friendly and intelligent rental property assistant in Vietnam. You help renters find their perfect home.

🎯 USER'S ACCUMULATED REQUIREMENTS (from this conversation):
${constraintsSummary.length > 0 ? constraintsSummary.map(c => `• ${c}`).join('\n') : '• No specific requirements yet - ask what they\'re looking for!'}
${locationNote}

📊 AVAILABLE PROPERTIES (${topProperties.length} matches from ${properties.length} total in database):
${topProperties.length > 0 ? topProperties.map((p, i) => `
[${i+1}] ${p.title}
   ID: ${p.id}
   Location: ${p.location} (${p.locationTier})
   Price: ${(p.price/1000000).toFixed(1)}M VND/month ${p.priceMatch ? '✓ within budget' : '⚠️ over budget'}
   Match Score: ${p.matchScore}/100
   Match Reasons: ${p.matchReasons.join(', ') || 'General match'}
   Amenities: ${p.amenities.slice(0, 10).join(', ')}${p.amenities.length > 10 ? '...' : ''}
   Styles: ${p.styles.join(', ') || 'Not specified'}
   Images: ${JSON.stringify(p.images)}
   Realtor ID: ${p.realtor_id}
   ${p.providerName ? `Provider: ${p.providerName} (${p.providerPhone})` : ''}
`).join('\n') : 'No properties currently match these criteria in our database.'}

🧠 CRITICAL INSTRUCTIONS:

1. **ALWAYS SHOW AVAILABLE PROPERTIES**: If there are properties listed above, you MUST include them in your response JSON. Never say "I found properties" without showing them.

2. **HANDLE "SHOW ME" REQUESTS**: When user says "show me" or similar, immediately return the properties in JSON format. Don't ask more questions.

3. **BE TRANSPARENT ABOUT LOCATION**:
   - If user wanted CENTER but only SUBURBAN available, explain: "I couldn't find center apartments under your budget, but here are great options in [area] which is a modern suburb with good value..."
   - Never pretend suburban is center

4. **RESPECT PRICE CONSTRAINTS**: Never suggest over-budget properties as matches. If including one, clearly mark it as "slightly over budget".

5. **NATURAL MATCH REASONS**: Write conversationally.
   - GOOD: "This cozy 13M/month apartment in Nam Tu Liem has the balcony you wanted. While not in the center, it's in a modern development area with good facilities."
   - BAD: "Property matches criteria."

6. **JSON RESPONSE FORMAT** (REQUIRED for any property search):
{
  "results": [
    {
      "id": "exact-property-id-from-above",
      "title": "Property title",
      "location": "Exact location",
      "price": 12000000,
      "size": "45m²",
      "vibe": "Modern, Cozy",
      "description": "Brief description",
      "highlights": ["Modern", "Balcony"],
      "images": ["copy-exact-urls-from-property-data"],
      "matchScore": 85,
      "matchReason": "Natural reason explaining why this matches, mentioning location honestly",
      "realtor_id": "exact-realtor-id-from-above",
      "isExternal": false,
      "source": null,
      "sourceUrl": null
    }
  ],
  "summary": "I found X properties in [area]. [Explain if not exact match to their request]",
  "totalMatches": 3
}

7. **FOR CONVERSATIONAL QUERIES**: Only respond without JSON if user is NOT searching for properties (asking about neighborhoods, prices, advice, etc.)

8. **LOCATION KNOWLEDGE**:
   - HCMC Center: District 1, 3 (premium, walkable, expensive ~15-40M)
   - HCMC Near-Center: District 4, 5, Binh Thanh, Phu Nhuan (~10-25M)
   - HCMC Suburban: District 7, 2, Thu Duc (~7-18M, modern, spacious)
   - Hanoi Center: Ba Dinh, Hoan Kiem, Dong Da (historic ~12-35M)
   - Hanoi Near-Center: Hai Ba Trung, Cau Giay, Thanh Xuan, Hoang Mai (~8-20M)
   - Hanoi Suburban: Nam Tu Liem, Bac Tu Liem, Tay Ho, Long Bien, Gia Lam (~6-15M)

Maximum ${maxResults} properties in results.`;

    // Call Lovable AI Gateway with the enhanced prompt
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    // Build messages with history
    const messagesWithHistory = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-10).map(msg => ({ role: msg.role, content: msg.content })),
      { role: 'user', content: message }
    ];

    console.log('[AI] Calling Lovable AI Gateway with google/gemini-2.5-flash');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: messagesWithHistory,
        max_tokens: 2500,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[AI] Lovable AI error:', aiResponse.status, errorText);
      
      // Handle rate limits
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI service credits exhausted. Please contact support.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 402 }
        );
      }
      
      throw new Error(`AI service error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let responseContent = aiData.choices[0].message.content || '';
    
    console.log('[AI] Raw response length:', responseContent.length);
    
    // Normalize response (remove markdown code fences)
    responseContent = normalizeAiResponse(responseContent);
    
    // Try to extract JSON from the response if it contains JSON-like content
    let extractedJson = null;
    
    // First try direct parse
    try {
      extractedJson = JSON.parse(responseContent);
    } catch {
      // Try to find JSON within the text
      const jsonMatch = responseContent.match(/\{[\s\S]*"results"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
      if (jsonMatch) {
        try {
          extractedJson = JSON.parse(jsonMatch[0]);
          console.log('[AI] Extracted JSON from mixed content');
        } catch {
          console.log('[AI] Failed to extract JSON from mixed content');
        }
      }
    }

    // ========== POST-PROCESSING VALIDATION ==========
    let searchData = null;
    let usedFallback = false;
    
    if (extractedJson && extractedJson.results && Array.isArray(extractedJson.results)) {
      console.log(`[Validation] AI returned ${extractedJson.results.length} results, validating...`);
      
      // Validate and fix AI results
      const validatedResults = validateAndFixAIResults(extractedJson.results, scoredProperties, accContext);
      
      console.log(`[Validation] ${validatedResults.length} results passed validation`);
      
      // Update the response with validated results
      extractedJson.results = validatedResults;
      extractedJson.totalMatches = validatedResults.length;
      
      // If AI returned results that all got filtered out, provide fallback
      if (validatedResults.length === 0 && topProperties.length > 0) {
        console.log('[Validation] All AI results rejected, using fallback from pre-scored properties');
        usedFallback = true;
      } else {
        searchData = extractedJson;
        responseContent = JSON.stringify(extractedJson);
      }
    }
    
    // FALLBACK: If AI didn't return valid JSON or all results were rejected, use pre-scored properties
    if (!searchData && topProperties.length > 0) {
      console.log('[Fallback] Generating results from pre-scored properties');
      usedFallback = true;
      
      const fallbackResults = topProperties.slice(0, maxResults).map(p => ({
        id: p.id,
        title: p.title,
        location: p.location,
        price: p.price,
        size: p.size,
        vibe: p.vibe,
        description: p.description,
        highlights: p.highlights,
        images: p.images,
        matchScore: p.matchScore,
        matchReason: p.matchReasons.length > 0 
          ? p.matchReasons.join('. ') 
          : `Great ${p.styles[0] || 'modern'} apartment in ${p.location.split(',')[0]} at ${(p.price/1000000).toFixed(1)}M VND/month`,
        realtor_id: p.realtor_id,
        isExternal: false,
        source: null,
        sourceUrl: null
      }));
      
      // Generate a summary based on context
      let summary = `I found ${fallbackResults.length} properties`;
      if (accContext.city) {
        summary += ` in ${accContext.city === 'hcm' ? 'Ho Chi Minh City' : 'Hanoi'}`;
      }
      if (accContext.maxPrice) {
        summary += ` under ${(accContext.maxPrice/1000000).toFixed(0)}M VND/month`;
      }
      if (accContext.wantsCenter && !topProperties.some(p => p.locationTier === 'center')) {
        summary += `. Note: No center properties matched your criteria, showing nearby alternatives`;
      }
      summary += '.';
      
      searchData = {
        results: fallbackResults,
        summary: summary,
        totalMatches: fallbackResults.length
      };
      responseContent = JSON.stringify(searchData);
      console.log(`[Fallback] Generated ${fallbackResults.length} property results`);
    }
    
    // If still no search data and no properties, keep the AI's conversational response
    if (!searchData) {
      console.log('[Response] No properties to show, using conversational response');
    }

    // Save response to database
    if (canPersist) {
      await supabase.from('chat_messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: responseContent
      });
    }

    // Save search results for authenticated users
    if (searchData && user?.id && canPersist) {
      try {
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

        if (!searchError && searchRecord && searchData.results.length > 0) {
          const searchResults = searchData.results.map((result: any) => ({
            search_id: searchRecord.id,
            property_id: result.id,
            match_score: result.matchScore,
            match_reason: result.matchReason
          }));

          await supabase.from('ai_search_results').insert(searchResults);
          console.log(`Saved ${searchResults.length} search results`);
        }
      } catch (searchSaveError) {
        console.error('Error saving search results:', searchSaveError);
      }
    }

    // Track AI usage
    if (user?.id && !isAnonymous) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const { data: currentUsage } = await supabase
          .from('daily_usage')
          .select('ai_requests, properties_viewed, properties_matched, quiz_retakes')
          .eq('user_id', user.id)
          .eq('usage_date', today)
          .maybeSingle();

        await supabase.from('daily_usage').upsert({
          user_id: user.id,
          usage_date: today,
          ai_requests: (currentUsage?.ai_requests || 0) + 1,
          properties_viewed: currentUsage?.properties_viewed || 0,
          properties_matched: currentUsage?.properties_matched || 0,
          quiz_retakes: currentUsage?.quiz_retakes || 0,
        }, { onConflict: 'user_id,usage_date' });
      } catch (usageError) {
        console.error('Error tracking usage:', usageError);
      }
    }

    return new Response(JSON.stringify({ response: responseContent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in chat-ai function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Helper to clean AI responses
function normalizeAiResponse(content: string): string {
  if (!content) return '';
  let cleaned = content.trim();

  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    if (firstNewline !== -1) {
      cleaned = cleaned.slice(firstNewline + 1);
    }
  }

  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }

  return cleaned.trim();
}
