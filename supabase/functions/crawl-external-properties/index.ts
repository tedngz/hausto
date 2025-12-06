import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

// Popular locations to crawl periodically
const POPULAR_LOCATIONS = {
  ho_chi_minh: ['D1', 'D2', 'D3', 'D4', 'D5', 'D7', 'D10', 'Binh Thanh', 'Phu Nhuan', 'Tan Binh', 'Go Vap', 'Thu Duc'],
  hanoi: ['Ba Dinh', 'Hoan Kiem', 'Dong Da', 'Cau Giay', 'Hai Ba Trung'],
};

interface CrawlRequest {
  locations?: string[];
  marketplaces?: ('batdongsan' | 'nhatot')[];
  city?: 'ho_chi_minh' | 'hanoi';
  forceRefresh?: boolean;
  storeInDatabase?: boolean;
}

interface CrawlResult {
  location: string;
  marketplace: string;
  propertiesFound: number;
  propertiesStored: number;
  skipped: boolean;
  error?: string;
}

// Normalize location for database indexing
function normalizeLocation(location: string): string {
  return location.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Detect city from location string
function detectCity(location: string): string {
  const lower = location.toLowerCase();
  if (/(ho chi minh|hcm|saigon|sài gòn|quan [0-9]|district [0-9]|d[0-9]|binh thanh|phu nhuan|tan binh|go vap|thu duc)/i.test(lower)) {
    return 'ho_chi_minh';
  }
  if (/(ha noi|hanoi|hà nội|ba dinh|hoan kiem|dong da|cau giay|hai ba trung)/i.test(lower)) {
    return 'hanoi';
  }
  if (/(da nang|đà nẵng)/i.test(lower)) {
    return 'da_nang';
  }
  return 'other';
}

// Generate embedding for property (for future vector search)
async function generatePropertyEmbedding(property: any): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null;
  
  try {
    const textToEmbed = `${property.title}. ${property.description}. Location: ${property.location}. Style: ${property.vibe || ''}. Amenities: ${(property.amenities || []).join(', ')}. Highlights: ${(property.highlights || []).join(', ')}`;
    
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: textToEmbed.substring(0, 8000),
      }),
    });
    
    if (!response.ok) {
      console.error('Embedding generation error:', await response.text());
      return null;
    }
    
    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const results: CrawlResult[] = [];
  
  try {
    const body: CrawlRequest = await req.json();
    const { 
      locations = [], 
      marketplaces = ['batdongsan'], 
      city = 'ho_chi_minh',
      forceRefresh = false,
      storeInDatabase = true 
    } = body;
    
    console.log(`[crawl-external-properties] Starting crawl:`, { locations, marketplaces, city, forceRefresh, storeInDatabase });
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Use provided locations or default popular locations for the city
    const locationsToScrape = locations.length > 0 ? locations : POPULAR_LOCATIONS[city] || POPULAR_LOCATIONS.ho_chi_minh;
    
    console.log(`[crawl-external-properties] Will crawl ${locationsToScrape.length} locations for ${marketplaces.length} marketplaces`);
    
    // Process each location x marketplace combination
    for (const location of locationsToScrape) {
      for (const marketplace of marketplaces) {
        const crawlResult: CrawlResult = {
          location,
          marketplace,
          propertiesFound: 0,
          propertiesStored: 0,
          skipped: false,
        };
        
        try {
          // Check if we have fresh data (less than 6 hours old)
          if (!forceRefresh) {
            const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
            const normalizedLoc = normalizeLocation(location);
            
            const { data: existingData, error: checkError } = await supabase
              .from('external_properties')
              .select('id, crawled_at')
              .eq('source', marketplace)
              .ilike('location_normalized', `%${normalizedLoc}%`)
              .gte('crawled_at', sixHoursAgo)
              .limit(1);
            
            if (!checkError && existingData && existingData.length > 0) {
              console.log(`[crawl-external-properties] Fresh data exists for ${location} on ${marketplace}, skipping`);
              crawlResult.skipped = true;
              results.push(crawlResult);
              continue;
            }
          }
          
          // Call scrape-marketplace edge function
          console.log(`[crawl-external-properties] Scraping ${marketplace} for ${location}...`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
          
          const scrapeResponse = await fetch(`${SUPABASE_URL}/functions/v1/scrape-marketplace`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              marketplace,
              query: 'apartment',
              location,
              includeVibeAnalysis: true,
            }),
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          if (!scrapeResponse.ok) {
            const errorText = await scrapeResponse.text();
            console.error(`[crawl-external-properties] Scrape error for ${location}/${marketplace}:`, errorText);
            crawlResult.error = `Scrape failed: ${scrapeResponse.status}`;
            results.push(crawlResult);
            continue;
          }
          
          const scrapeData = await scrapeResponse.json();
          
          if (!scrapeData.success || !scrapeData.properties?.length) {
            console.log(`[crawl-external-properties] No properties found for ${location}/${marketplace}`);
            results.push(crawlResult);
            continue;
          }
          
          crawlResult.propertiesFound = scrapeData.properties.length;
          console.log(`[crawl-external-properties] Found ${scrapeData.properties.length} properties for ${location}/${marketplace}`);
          
          // Store in database if requested
          if (storeInDatabase) {
            for (const property of scrapeData.properties) {
              try {
                const locationNormalized = normalizeLocation(property.location || location);
                const detectedCity = detectCity(property.location || location);
                
                // Create unique external_id from source URL or generate one
                const externalId = property.sourceUrl 
                  ? Buffer.from(property.sourceUrl).toString('base64').substring(0, 100)
                  : `${marketplace}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                
                const propertyData = {
                  external_id: externalId,
                  source: marketplace,
                  source_url: property.sourceUrl || `https://${marketplace}.com.vn`,
                  title: property.title || 'Rental Property',
                  location: property.location || location,
                  location_normalized: locationNormalized,
                  city: detectedCity,
                  price: property.price || 0,
                  price_display: property.priceDisplay || `${property.price?.toLocaleString()} VND`,
                  size: property.size || null,
                  description: property.description || null,
                  highlights: property.highlights || [],
                  amenities: property.amenities || [],
                  images: property.images || [],
                  contact_name: property.sourceProviderName || null,
                  contact_phone: property.sourceProviderPhone || null,
                  vibe: property.vibe || null,
                  vibe_analysis: property.vibe_analysis || {},
                  crawled_at: new Date().toISOString(),
                  expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
                  is_active: true,
                };
                
                // Upsert to handle duplicates
                const { error: upsertError } = await supabase
                  .from('external_properties')
                  .upsert(propertyData, {
                    onConflict: 'source,external_id',
                    ignoreDuplicates: false,
                  });
                
                if (upsertError) {
                  console.error(`[crawl-external-properties] Upsert error:`, upsertError);
                } else {
                  crawlResult.propertiesStored++;
                }
              } catch (storeError) {
                console.error(`[crawl-external-properties] Error storing property:`, storeError);
              }
            }
          }
          
          results.push(crawlResult);
          
        } catch (locationError) {
          console.error(`[crawl-external-properties] Error processing ${location}/${marketplace}:`, locationError);
          crawlResult.error = locationError instanceof Error ? locationError.message : 'Unknown error';
          results.push(crawlResult);
        }
        
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const totalFound = results.reduce((sum, r) => sum + r.propertiesFound, 0);
    const totalStored = results.reduce((sum, r) => sum + r.propertiesStored, 0);
    const totalSkipped = results.filter(r => r.skipped).length;
    const totalErrors = results.filter(r => r.error).length;
    
    const duration = Date.now() - startTime;
    
    console.log(`[crawl-external-properties] Completed in ${duration}ms:`, {
      totalFound,
      totalStored,
      totalSkipped,
      totalErrors,
    });
    
    return new Response(JSON.stringify({
      success: true,
      summary: {
        duration: `${duration}ms`,
        locationsProcessed: locationsToScrape.length,
        marketplacesProcessed: marketplaces.length,
        totalFound,
        totalStored,
        totalSkipped,
        totalErrors,
      },
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[crawl-external-properties] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      results,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
