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
  
  switch (marketplace) {
    case 'batdongsan':
      // batdongsan.com.vn search URL pattern
      if (normalizedLocation.includes('quan-')) {
        return `https://batdongsan.com.vn/cho-thue-phong-tro-${normalizedLocation}-tp-hcm`;
      }
      return `https://batdongsan.com.vn/cho-thue-phong-tro-tp-hcm?keyword=${encodeURIComponent(query)}`;
      
    case 'nhatot':
      // nhatot.com search URL pattern  
      return `https://www.nhatot.com/thue-phong-tro-ho-chi-minh?q=${encodeURIComponent(query)}`;
      
    case 'airbnb':
      // Airbnb search - may be blocked
      return `https://www.airbnb.com/s/Ho-Chi-Minh-City--Vietnam/homes?query=${encodeURIComponent(query)}`;
      
    default:
      return '';
  }
}

// Use AI to extract structured property data from scraped content with vibe analysis
async function extractPropertiesWithAI(
  scrapedContent: string, 
  marketplace: string,
  searchQuery: string,
  includeVibeAnalysis: boolean = true
): Promise<ExternalProperty[]> {
  console.log(`Extracting properties from ${marketplace} using AI (vibe analysis: ${includeVibeAnalysis})...`);
  
  const vibeAnalysisInstructions = includeVibeAnalysis ? `
VIBE ANALYSIS (for each property):
Analyze the description and amenities to determine:
- style: One of [Modern, Cozy, Industrial, Bohemian, Scandinavian, Minimalist, Contemporary, Traditional, Rustic, Luxury, Urban, Vintage]
- colors: Array of dominant colors based on description [Neutral, Warm, Cool, Bright, Dark, Colorful, Natural, White, Earth, Bold]
- activities: Array of suitable activities [Working, Reading, Relaxing, Entertaining, Cooking, Exercising]
- vibe_scores: Object with scores 1-10 for: modern, cozy, luxurious, minimalist, spacious, natural_light, urban, elegant
` : '';

  const extractionPrompt = `You are a property data extraction expert. Extract rental property listings from this ${marketplace} website content.

SCRAPED CONTENT:
${scrapedContent.substring(0, 15000)} 

SEARCH CONTEXT: User searched for "${searchQuery}"

Extract up to 5 property listings. For EACH property found, return:
- title: Property title/name
- location: Full address or area
- price: Numeric price in VND (convert if needed, e.g., "5 triệu" = 5000000)
- priceDisplay: Original price text (e.g., "5 triệu/tháng")
- size: Area in m² if available
- description: Brief description (100-200 words)
- highlights: Array of 3-5 key features as lifestyle benefits (e.g., "Natural light workspace", "Cozy reading nook")
- amenities: Array of specific amenities mentioned (e.g., "Air Conditioning", "WiFi", "Washing Machine", "Balcony")
- sourceUrl: The listing URL if found in content
- contactName: Landlord/agent name if available
- contactPhone: Phone number if available
${vibeAnalysisInstructions}

RESPOND WITH VALID JSON ONLY:
{
  "properties": [
    {
      "title": "...",
      "location": "...",
      "price": 5000000,
      "priceDisplay": "5 triệu/tháng",
      "size": "25m²",
      "description": "Detailed description...",
      "highlights": ["Natural light living space", "Modern kitchen setup", "Quiet neighborhood retreat"],
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
          { role: 'system', content: 'You extract structured property data from scraped website content with vibe analysis. Always respond with valid JSON.' },
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

      return {
        id: `external-${marketplace}-${Date.now()}-${index}`,
        title: p.title || 'Untitled Property',
        location: p.location || 'Ho Chi Minh City',
        price: typeof p.price === 'number' ? p.price : parseInt(String(p.price).replace(/\D/g, '')) || 0,
        priceDisplay: p.priceDisplay || `${p.price?.toLocaleString()} VND`,
        size: p.size || 'N/A',
        images: [], // Firecrawl doesn't always get images reliably
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

    // Use Firecrawl to scrape the marketplace
    console.log(`[scrape-marketplace] Calling Firecrawl API...`);
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ['markdown', 'links'],
        onlyMainContent: true,
        waitFor: 3000, // Wait for dynamic content
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

    // Extract properties using AI with vibe analysis
    console.log(`[scrape-marketplace] Calling AI extraction for ${marketplace}...`);
    const properties = await extractPropertiesWithAI(
      scrapedData.data.markdown,
      marketplace,
      query,
      includeVibeAnalysis
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
