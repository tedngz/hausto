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
}

interface SearchParams {
  marketplace: 'batdongsan' | 'nhatot' | 'airbnb';
  query: string;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
  propertyType?: string;
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

// Use AI to extract structured property data from scraped content
async function extractPropertiesWithAI(
  scrapedContent: string, 
  marketplace: string,
  searchQuery: string
): Promise<ExternalProperty[]> {
  console.log(`Extracting properties from ${marketplace} using AI...`);
  
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
- description: Brief description
- highlights: Array of 3-5 key features
- amenities: Array of amenities mentioned
- sourceUrl: The listing URL if found in content
- contactName: Landlord/agent name if available
- contactPhone: Phone number if available

RESPOND WITH VALID JSON ONLY:
{
  "properties": [
    {
      "title": "...",
      "location": "...",
      "price": 5000000,
      "priceDisplay": "5 triệu/tháng",
      "size": "25m²",
      "description": "...",
      "highlights": ["..."],
      "amenities": ["..."],
      "sourceUrl": "https://...",
      "contactName": "...",
      "contactPhone": "..."
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
          { role: 'system', content: 'You extract structured property data from scraped website content. Always respond with valid JSON.' },
          { role: 'user', content: extractionPrompt }
        ],
        max_tokens: 3000,
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
    const properties: ExternalProperty[] = (parsed.properties || []).map((p: any, index: number) => ({
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
    }));

    console.log(`Extracted ${properties.length} properties from ${marketplace}`);
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
    const { marketplace, query, location, minPrice, maxPrice } = await req.json() as SearchParams;
    
    console.log(`Scraping ${marketplace} for: ${query}, location: ${location}`);

    if (!FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY not configured');
    }

    // Check cache first
    const cacheKey = `marketplace:${marketplace}:${query}:${location || 'all'}`;
    const cached = await redis.get(cacheKey);
    
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
    console.log('Scraping URL:', searchUrl);

    // Use Firecrawl to scrape the marketplace
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
      console.error('Firecrawl error:', firecrawlResponse.status, errorText);
      
      // Return empty results instead of error for graceful degradation
      return new Response(JSON.stringify({ 
        success: true, 
        properties: [],
        error: `Marketplace temporarily unavailable: ${marketplace}`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const scrapedData = await firecrawlResponse.json();
    console.log('Firecrawl response success:', scrapedData.success);

    if (!scrapedData.success || !scrapedData.data?.markdown) {
      console.log('No content scraped from marketplace');
      return new Response(JSON.stringify({ 
        success: true, 
        properties: [],
        message: 'No listings found on marketplace'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract properties using AI
    const properties = await extractPropertiesWithAI(
      scrapedData.data.markdown,
      marketplace,
      query
    );

    // Filter by price if specified
    let filteredProperties = properties;
    if (minPrice || maxPrice) {
      filteredProperties = properties.filter(p => {
        if (minPrice && p.price < minPrice) return false;
        if (maxPrice && p.price > maxPrice) return false;
        return true;
      });
    }

    // Cache results
    if (filteredProperties.length > 0) {
      await redis.set(cacheKey, JSON.stringify(filteredProperties), { ex: CACHE_TTL });
    }

    console.log(`Returning ${filteredProperties.length} properties from ${marketplace}`);

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
