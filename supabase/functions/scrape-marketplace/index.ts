import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

// Cache TTL: 2 hours for scraped results
const CACHE_TTL = 60 * 60 * 2;

// Simple Redis helper using REST API
async function redisGet(key: string): Promise<any> {
  try {
    const response = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
    });
    const data = await response.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function redisSet(key: string, value: any, ttl: number): Promise<void> {
  try {
    await fetch(`${UPSTASH_REDIS_REST_URL}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(JSON.stringify(value))}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
    });
  } catch (e) { console.error('Redis set error:', e); }
}

interface ExternalProperty {
  id: string;
  title: string;
  location: string;
  price: number;
  priceDisplay: string;
  size: string;
  images: string[];
  description: string;
  highlights: string[];
  amenities: string[];
  source: 'batdongsan' | 'nhatot' | 'airbnb';
  sourceUrl: string;
  sourceProviderName?: string;
  sourceProviderPhone?: string;
  vibe?: string;
  vibe_analysis?: {
    style?: string;
    colors?: string[];
    activities?: string[];
    amenities?: string[];
    vibe_scores?: Record<string, number>;
  };
}

interface SearchParams {
  marketplace: 'batdongsan' | 'nhatot' | 'airbnb';
  query: string;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
  propertyType?: string;
  includeVibeAnalysis?: boolean;
}

// Build search URL for each marketplace
function buildSearchUrl(params: SearchParams): string {
  const { marketplace, query, location } = params;
  
  // Normalize location for URL
  const normalizedLocation = location?.toLowerCase()
    .replace(/district\s*/i, 'quan-')
    .replace(/d(\d+)/i, 'quan-$1')
    .replace(/\s+/g, '-')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    || '';
  
  // Detect city for URL building
  const isHanoi = /(ha noi|hanoi|ba dinh|hoan kiem|dong da|cau giay|hai ba trung)/i.test(location || '');
  const citySlug = isHanoi ? 'ha-noi' : 'tp-hcm';
  const nhatotCity = isHanoi ? 'ha-noi' : 'ho-chi-minh';
  const airbnbCity = isHanoi ? 'Hanoi--Vietnam' : 'Ho-Chi-Minh-City--Vietnam';
  
  switch (marketplace) {
    case 'batdongsan':
      // batdongsan.com.vn search URL pattern
      if (normalizedLocation.includes('quan-')) {
        return `https://batdongsan.com.vn/cho-thue-phong-tro-${normalizedLocation}-${citySlug}`;
      }
      if (normalizedLocation) {
        return `https://batdongsan.com.vn/cho-thue-phong-tro-${citySlug}?keyword=${encodeURIComponent(location || query)}`;
      }
      return `https://batdongsan.com.vn/cho-thue-phong-tro-${citySlug}`;
      
    case 'nhatot':
      // nhatot.com search URL pattern - supports apartments and rooms
      const nhatotDistrict = normalizedLocation
        .replace(/quan-/g, '')
        .replace(/-/g, ' ')
        .trim();
      if (nhatotDistrict) {
        return `https://www.nhatot.com/thue-phong-tro-${nhatotCity}?q=${encodeURIComponent(nhatotDistrict)}`;
      }
      return `https://www.nhatot.com/thue-phong-tro-${nhatotCity}`;
      
    case 'airbnb':
      // Airbnb search - monthly stays for apartment rentals
      const checkIn = new Date();
      const checkOut = new Date();
      checkOut.setMonth(checkOut.getMonth() + 1);
      const checkinStr = checkIn.toISOString().split('T')[0];
      const checkoutStr = checkOut.toISOString().split('T')[0];
      return `https://www.airbnb.com/s/${airbnbCity}/homes?tab_id=home_tab&refinement_paths%5B%5D=%2Fhomes&flexible_trip_lengths%5B%5D=one_month&monthly_start_date=${checkinStr}&monthly_length=1&price_filter_input_type=0&channel=EXPLORE&query=${encodeURIComponent(query || 'apartment')}&place_id=ChIJLZVVBKcvdTERvHHOyEbEN1Q&date_picker_type=monthly_stay`;
      
    default:
      return '';
  }
}

// Use AI to extract structured property data from scraped content with vibe analysis
async function extractPropertiesWithAI(
  scrapedContent: string, 
  marketplace: string,
  searchQuery: string,
  includeVibeAnalysis: boolean = true,
  extractedLinks: string[] = [],
  extractedImages: string[] = []
): Promise<ExternalProperty[]> {
  console.log(`Extracting properties from ${marketplace} using AI (vibe analysis: ${includeVibeAnalysis})...`);
  console.log(`Available links: ${extractedLinks.length}, Available images: ${extractedImages.length}`);
  
  const vibeAnalysisInstructions = includeVibeAnalysis ? `
VIBE ANALYSIS (for each property):
Analyze the description and amenities to determine:
- style: One of [Modern, Cozy, Industrial, Bohemian, Scandinavian, Minimalist, Contemporary, Traditional, Rustic, Luxury, Urban, Vintage]
- colors: Array of dominant colors based on description [Neutral, Warm, Cool, Bright, Dark, Colorful, Natural, White, Earth, Bold]
- activities: Array of suitable activities [Working, Reading, Relaxing, Entertaining, Cooking, Exercising]
- vibe_scores: Object with scores 1-10 for: modern, cozy, luxurious, minimalist, spacious, natural_light, urban, elegant
` : '';

  // Filter images to only include property-related ones
  const propertyImages = extractedImages.filter(img => 
    img.includes('cdn') || 
    img.includes('upload') || 
    img.includes('image') || 
    img.includes('photo') ||
    img.includes('property') ||
    img.includes('room') ||
    img.includes('apartment') ||
    (img.match(/\.(jpg|jpeg|png|webp)/i) && !img.includes('logo') && !img.includes('icon') && !img.includes('avatar'))
  ).slice(0, 30); // Limit to 30 images for context

  const extractionPrompt = `You are a property data extraction expert. Extract rental property listings from this ${marketplace} Vietnamese website content.

SCRAPED CONTENT:
${scrapedContent.substring(0, 12000)} 

AVAILABLE IMAGE URLs FROM PAGE (assign 4-6 relevant images to each property based on context):
${propertyImages.slice(0, 25).join('\n')}

SEARCH CONTEXT: User searched for "${searchQuery}"

CRITICAL INSTRUCTIONS:
1. ALL text output (title, description, highlights) MUST be in ENGLISH - translate any Vietnamese content
2. Extract up to 5 property listings
3. For each property, find and assign 4-6 image URLs from the available images above
4. Create engaging English titles (e.g., "Modern Studio with City Views in District 1" not "Phòng trọ quận 1")
5. Write highlights as lifestyle benefits in English (e.g., "Bright workspace by the window", "Cozy reading corner with natural light")

For EACH property found, return:
- title: Property title IN ENGLISH (translated, descriptive)
- location: Location/address (keep Vietnamese area names but add context in English)
- price: Numeric price in VND (convert if needed, e.g., "5 triệu" = 5000000)
- priceDisplay: Original price text (e.g., "5 triệu/tháng")
- size: Area in m² if available
- images: Array of 4-6 image URLs from the available images that match this property
- description: Brief description IN ENGLISH (100-200 words, translated)
- highlights: Array of 4-5 lifestyle highlights IN ENGLISH (e.g., "Spacious living area with abundant sunlight", "Modern kitchen setup")
- amenities: Array of specific amenities IN ENGLISH (e.g., "Air Conditioning", "WiFi", "Washing Machine", "Balcony")
- sourceUrl: The listing URL if found in content
- contactName: Landlord/agent name if available
- contactPhone: Phone number if available
${vibeAnalysisInstructions}

RESPOND WITH VALID JSON ONLY:
{
  "properties": [
    {
      "title": "Modern Studio Apartment with Balcony in District 1",
      "location": "District 1, Ho Chi Minh City",
      "price": 5000000,
      "priceDisplay": "5 triệu/tháng",
      "size": "25m²",
      "images": ["https://cdn.example.com/image1.jpg", "https://cdn.example.com/image2.jpg", "https://cdn.example.com/image3.jpg", "https://cdn.example.com/image4.jpg"],
      "description": "A beautifully designed modern studio apartment featuring floor-to-ceiling windows...",
      "highlights": ["Bright living space with city views", "Modern fully-equipped kitchen", "Private balcony for relaxation", "Quiet neighborhood near cafes"],
      "amenities": ["Air Conditioning", "WiFi", "Washing Machine", "Balcony", "Furnished"],
      "sourceUrl": "https://...",
      "contactName": "...",
      "contactPhone": "...",
      ${includeVibeAnalysis ? `"vibe_analysis": {
        "style": "Modern",
        "colors": ["Neutral", "White"],
        "activities": ["Working", "Relaxing"],
        "vibe_scores": {"modern": 8, "cozy": 6, "luxurious": 5, "minimalist": 7, "spacious": 6, "natural_light": 8, "urban": 7, "elegant": 6}
      }` : ''}
    }
  ]
}

If no properties found, return: {"properties": []}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You extract structured property data from scraped Vietnamese website content. ALWAYS output English text for titles, descriptions, and highlights. Always respond with valid JSON.' },
          { role: 'user', content: extractionPrompt }
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      console.error('OpenAI extraction error:', await response.text());
      return [];
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '{"properties": []}';
    
    // Clean up response
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const parsed = JSON.parse(content);
    const properties: ExternalProperty[] = (parsed.properties || []).map((p: any, index: number) => {
      // Build vibe analysis structure matching internal properties
      const vibeAnalysis = p.vibe_analysis || {
        style: 'Modern',
        colors: ['Neutral'],
        activities: ['Relaxing'],
        vibe_scores: { modern: 5, cozy: 5, luxurious: 5, minimalist: 5, spacious: 5, natural_light: 5, urban: 5, elegant: 5 }
      };
      
      // Determine primary vibe from scores
      const vibeScores = vibeAnalysis.vibe_scores || {};
      const primaryVibe = Object.entries(vibeScores)
        .sort(([,a], [,b]) => (b as number) - (a as number))
        .slice(0, 2)
        .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1))
        .join(', ');

      // Get images from AI extraction or fallback to extracted images
      const propertyImageUrls = Array.isArray(p.images) && p.images.length > 0 
        ? p.images.filter((img: string) => img && img.startsWith('http')).slice(0, 6)
        : propertyImages.slice(index * 4, index * 4 + 4);

      return {
        id: `external-${marketplace}-${Date.now()}-${index}`,
        title: p.title || 'Modern Rental Property',
        location: p.location || 'Ho Chi Minh City',
        price: typeof p.price === 'number' ? p.price : parseInt(String(p.price).replace(/\D/g, '')) || 0,
        priceDisplay: p.priceDisplay || `${p.price?.toLocaleString()} VND`,
        size: p.size || 'N/A',
        images: propertyImageUrls,
        description: p.description || '',
        highlights: Array.isArray(p.highlights) ? p.highlights : [],
        amenities: Array.isArray(p.amenities) ? p.amenities : [],
        source: marketplace as 'batdongsan' | 'nhatot' | 'airbnb',
        sourceUrl: p.sourceUrl || buildSearchUrl({ marketplace: marketplace as any, query: searchQuery }),
        sourceProviderName: p.contactName,
        sourceProviderPhone: p.contactPhone,
        // Add vibe analysis fields for consistency with internal properties
        vibe: primaryVibe || vibeAnalysis.style || 'Modern',
        vibe_analysis: {
          style: vibeAnalysis.style,
          colors: vibeAnalysis.colors,
          activities: vibeAnalysis.activities,
          amenities: Array.isArray(p.amenities) ? p.amenities : [],
          vibe_scores: vibeAnalysis.vibe_scores,
        },
      };
    });

    console.log(`Extracted ${properties.length} properties with vibe analysis from ${marketplace}`);
    properties.forEach((p, i) => {
      console.log(`Property ${i + 1}: "${p.title}" - ${p.images.length} images`);
    });
    return properties;
  } catch (error) {
    console.error('AI extraction error:', error);
    return [];
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as SearchParams;
    const { marketplace, query, location, minPrice, maxPrice, includeVibeAnalysis = true } = body;
    
    console.log(`[scrape-marketplace] Request received:`, JSON.stringify({ marketplace, query, location, minPrice, maxPrice, includeVibeAnalysis }));

    if (!FIRECRAWL_API_KEY) {
      console.error('[scrape-marketplace] FIRECRAWL_API_KEY not configured');
      throw new Error('FIRECRAWL_API_KEY not configured');
    }

    if (!OPENAI_API_KEY) {
      console.error('[scrape-marketplace] OPENAI_API_KEY not configured');
      throw new Error('OPENAI_API_KEY not configured');
    }

    // Check cache first
    const cacheKey = `marketplace:${marketplace}:${query}:${location || 'all'}`;
    console.log(`[scrape-marketplace] Checking cache for key: ${cacheKey}`);
    const cached = await redisGet(cacheKey);
    
    if (cached) {
      console.log('Returning cached results for:', cacheKey);
      return new Response(JSON.stringify({ 
        success: true, 
        properties: cached,
        cached: true 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build search URL
    const searchUrl = buildSearchUrl({ marketplace, query, location });
    console.log(`[scrape-marketplace] Built search URL: ${searchUrl}`);

    // Use Firecrawl to scrape the marketplace with images
    console.log(`[scrape-marketplace] Calling Firecrawl API with image extraction...`);
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ['markdown', 'links', 'html'],
        onlyMainContent: false, // Get full page to extract images
        waitFor: 4000, // Wait for dynamic content and images to load
      }),
    });

    if (!firecrawlResponse.ok) {
      const errorText = await firecrawlResponse.text();
      console.error(`[scrape-marketplace] Firecrawl error: ${firecrawlResponse.status}`, errorText);
      
      // Return empty results instead of error for graceful degradation
      return new Response(JSON.stringify({ 
        success: false, 
        properties: [],
        error: `Marketplace temporarily unavailable: ${marketplace} (Firecrawl error: ${firecrawlResponse.status})`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const scrapedData = await firecrawlResponse.json();
    console.log(`[scrape-marketplace] Firecrawl response: success=${scrapedData.success}, hasMarkdown=${!!scrapedData.data?.markdown}, markdownLength=${scrapedData.data?.markdown?.length || 0}`);

    if (!scrapedData.success || !scrapedData.data?.markdown) {
      console.log(`[scrape-marketplace] No content scraped from ${marketplace}`);
      return new Response(JSON.stringify({ 
        success: true, 
        properties: [],
        message: 'No listings found on marketplace'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract image URLs from HTML content
    const htmlContent = scrapedData.data.html || '';
    const imageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const srcsetRegex = /srcset=["']([^"']+)["']/gi;
    const backgroundRegex = /background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi;
    
    const extractedImages: string[] = [];
    let match;
    
    // Extract from img src
    while ((match = imageRegex.exec(htmlContent)) !== null) {
      if (match[1] && match[1].startsWith('http')) {
        extractedImages.push(match[1]);
      }
    }
    
    // Extract from srcset (get highest res)
    while ((match = srcsetRegex.exec(htmlContent)) !== null) {
      const srcsetParts = match[1].split(',');
      srcsetParts.forEach(part => {
        const url = part.trim().split(' ')[0];
        if (url && url.startsWith('http')) {
          extractedImages.push(url);
        }
      });
    }
    
    // Extract from background images
    while ((match = backgroundRegex.exec(htmlContent)) !== null) {
      if (match[1] && match[1].startsWith('http')) {
        extractedImages.push(match[1]);
      }
    }

    // Also check markdown for image links
    const mdImageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
    while ((match = mdImageRegex.exec(scrapedData.data.markdown)) !== null) {
      if (match[1] && match[1].startsWith('http')) {
        extractedImages.push(match[1]);
      }
    }

    // Deduplicate and filter images
    const uniqueImages = [...new Set(extractedImages)].filter(img => 
      !img.includes('logo') && 
      !img.includes('icon') && 
      !img.includes('sprite') &&
      !img.includes('avatar') &&
      !img.includes('placeholder') &&
      img.match(/\.(jpg|jpeg|png|webp|gif)/i)
    );
    
    console.log(`[scrape-marketplace] Extracted ${uniqueImages.length} unique images from page`);

    // Extract properties using AI with vibe analysis and images
    console.log(`[scrape-marketplace] Calling AI extraction for ${marketplace}...`);
    const properties = await extractPropertiesWithAI(
      scrapedData.data.markdown,
      marketplace,
      query,
      includeVibeAnalysis,
      scrapedData.data.links || [],
      uniqueImages
    );
    
    console.log(`[scrape-marketplace] AI extracted ${properties.length} properties from ${marketplace}`);

    // Filter by price if specified
    let filteredProperties = properties;
    if (minPrice || maxPrice) {
      console.log(`[scrape-marketplace] Filtering by price: min=${minPrice}, max=${maxPrice}`);
      filteredProperties = properties.filter(p => {
        if (minPrice && p.price < minPrice) return false;
        if (maxPrice && p.price > maxPrice) return false;
        return true;
      });
      console.log(`[scrape-marketplace] After price filter: ${filteredProperties.length} properties`);
    }

    // Cache results
    if (filteredProperties.length > 0) {
      console.log(`[scrape-marketplace] Caching ${filteredProperties.length} properties with key: ${cacheKey}`);
      await redisSet(cacheKey, filteredProperties, CACHE_TTL);
    }

    console.log(`[scrape-marketplace] SUCCESS: Returning ${filteredProperties.length} properties from ${marketplace}`);

    return new Response(JSON.stringify({ 
      success: true, 
      properties: filteredProperties,
      source: marketplace,
      searchUrl 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Scrape marketplace error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      properties: []
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
