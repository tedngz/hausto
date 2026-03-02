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
const POPULAR_LOCATIONS: Record<string, string[]> = {
  ho_chi_minh: ['D1', 'D2', 'D3', 'D4', 'D5', 'D7', 'D10', 'Binh Thanh', 'Phu Nhuan', 'Tan Binh', 'Go Vap', 'Thu Duc'],
  hanoi: ['Ba Dinh', 'Hoan Kiem', 'Dong Da', 'Cau Giay', 'Hai Ba Trung'],
  da_nang: ['Hai Chau', 'Thanh Khe', 'Son Tra', 'Ngu Hanh Son', 'Lien Chieu', 'Cam Le'],
};

interface CrawlRequest {
  locations?: string[];
  marketplaces?: ('batdongsan' | 'nhatot' | 'airbnb')[];
  city?: 'ho_chi_minh' | 'hanoi';
  forceRefresh?: boolean;
  storeInDatabase?: boolean;
  runVibeAnalysis?: boolean;
  maxListingsPerLocation?: number;
}

interface CrawlResult {
  location: string;
  marketplace: string;
  propertiesFound: number;
  propertiesStored: number;
  newListings: number;
  updatedListings: number;
  duplicatesSkipped: number;
  vibeAnalyzed: number;
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

// Normalize source URL for dedup: lowercase, strip trailing slash, remove tracking params
function normalizeSourceUrl(url: string): string {
  try {
    const u = new URL(url.toLowerCase().trim());
    // Remove common tracking parameters
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source'];
    paramsToRemove.forEach(p => u.searchParams.delete(p));
    // Sort remaining params for consistency
    u.searchParams.sort();
    // Remove trailing slash
    let normalized = u.toString().replace(/\/+$/, '');
    return normalized;
  } catch {
    // If URL parsing fails, do basic normalization
    return url.toLowerCase().trim().replace(/\/+$/, '');
  }
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
// Analyze property images using OpenAI Vision (same approach as analyze-vibe edge function)
async function analyzePropertyImagesVibe(images: string[]): Promise<{
  vibe: string;
  vibe_analysis: Record<string, any>;
  highlights: string[];
  amenities: string[];
} | null> {
  if (!OPENAI_API_KEY || !images || images.length === 0) return null;
  
  try {
    // Use up to 3 images to keep costs down
    const imagesToAnalyze = images.filter(img => img?.startsWith('http')).slice(0, 3);
    if (imagesToAnalyze.length === 0) return null;
    
    console.log(`[vibe-analysis] Analyzing ${imagesToAnalyze.length} images...`);
    
    // Build image content array for vision API
    const imageContent = [];
    for (const imageUrl of imagesToAnalyze) {
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) continue;
        
        const contentType = imgResponse.headers.get('content-type') || '';
        const imageBuffer = await imgResponse.arrayBuffer();
        const imageBytes = new Uint8Array(imageBuffer);
        
        // Skip very large images (>5MB)
        if (imageBytes.length > 5 * 1024 * 1024) continue;
        
        let base64String = '';
        const chunk = 8192;
        for (let i = 0; i < imageBytes.length; i += chunk) {
          const chunkBytes = imageBytes.subarray(i, Math.min(i + chunk, imageBytes.length));
          base64String += String.fromCharCode.apply(null, Array.from(chunkBytes));
        }
        const base64 = btoa(base64String);
        
        let mimeType = 'image/jpeg';
        if (contentType.includes('png')) mimeType = 'image/png';
        else if (contentType.includes('webp')) mimeType = 'image/webp';
        
        imageContent.push({
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' }
        });
      } catch (e) {
        console.error(`[vibe-analysis] Failed to fetch image:`, e);
      }
    }
    
    if (imageContent.length === 0) return null;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze these rental property images. Return a JSON object with:

1. Vibe scores (1-10): modern, cozy, luxurious, minimalist, spacious, natural_light, urban, elegant
2. style: One of [Modern, Cozy, Industrial, Bohemian, Scandinavian, Minimalist, Contemporary, Traditional, Rustic, Luxury, Urban, Vintage]
3. colors: Array from [Neutral, Warm, Cool, Bright, Dark, Colorful, Natural, White, Earth, Bold]
4. activities: Array from [Working, Reading, Relaxing, Entertaining, Cooking, Exercising]
5. highlights: Array of 4-5 lifestyle highlights IN ENGLISH (e.g., "Bright workspace with city views")
6. amenities: Array of ALL visible amenities IN ENGLISH (e.g., "Air Conditioning", "Washing Machine", "Balcony")

Return ONLY valid JSON:
{
  "vibe_scores": {"modern": 8, "cozy": 6, "luxurious": 5, "minimalist": 7, "spacious": 6, "natural_light": 8, "urban": 7, "elegant": 6},
  "style": "Modern",
  "colors": ["Neutral", "White"],
  "activities": ["Working", "Relaxing"],
  "highlights": ["highlight1", "highlight2", "highlight3", "highlight4"],
  "amenities": ["Air Conditioning", "WiFi", "Balcony"]
}`
            },
            ...imageContent,
          ]
        }],
        max_tokens: 800,
        temperature: 0.3,
      }),
    });
    
    if (!response.ok) {
      console.error('[vibe-analysis] OpenAI error:', await response.text());
      return null;
    }
    
    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const parsed = JSON.parse(jsonMatch[0]);
    const vibeScores = parsed.vibe_scores || {};
    
    // Determine primary vibe from highest scores
    const primaryVibe = Object.entries(vibeScores)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 2)
      .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1))
      .join(', ');
    
    return {
      vibe: primaryVibe || parsed.style || 'Modern',
      vibe_analysis: {
        style: parsed.style,
        colors: parsed.colors || [],
        activities: parsed.activities || [],
        amenities: parsed.amenities || [],
        vibe_scores: vibeScores,
      },
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      amenities: Array.isArray(parsed.amenities) ? parsed.amenities : [],
    };
  } catch (error) {
    console.error('[vibe-analysis] Error:', error);
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
      marketplaces = ['batdongsan', 'nhatot'],
      city = 'ho_chi_minh',
      forceRefresh = false,
      storeInDatabase = true,
      runVibeAnalysis = true,
      maxListingsPerLocation = 10,
    } = body;
    
    console.log(`[crawl-external-properties] Starting crawl:`, { locations, marketplaces, city, forceRefresh, storeInDatabase, maxListingsPerLocation });
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Use provided locations or default popular locations for the city
    const locationsToScrape = locations.length > 0 ? locations : POPULAR_LOCATIONS[city] || POPULAR_LOCATIONS.ho_chi_minh;
    
    // IMPORTANT: Only process the FIRST location + marketplace combo to stay within compute limits.
    // The client should call this function repeatedly for each location.
    const location = locationsToScrape[0];
    const remainingLocations = locationsToScrape.slice(1);
    
    console.log(`[crawl-external-properties] Processing location: ${location}, ${remainingLocations.length} remaining`);
    
    for (const marketplace of marketplaces) {
        const crawlResult: CrawlResult = {
          location,
          marketplace,
          propertiesFound: 0,
          propertiesStored: 0,
          newListings: 0,
          updatedListings: 0,
          duplicatesSkipped: 0,
          vibeAnalyzed: 0,
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
              query: 'căn hộ chung cư cho thuê',
              location,
              includeVibeAnalysis: true,
              maxResults: maxListingsPerLocation,
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
                const rawSourceUrl = property.sourceUrl || `https://${marketplace}.com.vn`;
                const normalizedUrl = normalizeSourceUrl(rawSourceUrl);
                
                // Create deterministic external_id from normalized URL
                const externalId = property.sourceUrl 
                  ? btoa(normalizedUrl).substring(0, 100)
                  : `${marketplace}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                
                // Check if this property already exists by normalized source_url
                const { data: existingByUrl } = await supabase
                  .from('external_properties')
                  .select('id, external_id, source_url')
                  .eq('source', marketplace)
                  .eq('source_url', normalizedUrl)
                  .maybeSingle();
                
                // Also check by external_id for backward compat
                const { data: existingById } = !existingByUrl ? await supabase
                  .from('external_properties')
                  .select('id, external_id, source_url')
                  .eq('source', marketplace)
                  .eq('external_id', externalId)
                  .maybeSingle() : { data: existingByUrl };
                
                const existingRecord = existingByUrl || existingById;
                
                if (existingRecord) {
                  // Property already exists — update it
                  const { error: updateError } = await supabase
                    .from('external_properties')
                    .update({
                      title: property.title || 'Rental Property',
                      location: property.location || location,
                      location_normalized: locationNormalized,
                      city: detectedCity,
                      price: property.price || 0,
                      price_display: property.priceDisplay || `${property.price?.toLocaleString()} VND`,
                      size: property.size || null,
                      rooms: property.rooms || null,
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
                    })
                    .eq('id', existingRecord.id);
                  
                  if (updateError) {
                    console.error(`[crawl-external-properties] Update error:`, updateError);
                  } else {
                    crawlResult.updatedListings++;
                    crawlResult.propertiesStored++;
                    console.log(`[crawl-external-properties] Updated existing: "${property.title}"`);
                  }
                  continue; // Skip vibe re-analysis for existing listings
                }
                
                // New listing — insert
                const propertyData = {
                  external_id: externalId,
                  source: marketplace,
                  source_url: normalizedUrl,
                  title: property.title || 'Rental Property',
                  location: property.location || location,
                  location_normalized: locationNormalized,
                  city: detectedCity,
                  price: property.price || 0,
                  price_display: property.priceDisplay || `${property.price?.toLocaleString()} VND`,
                  size: property.size || null,
                  rooms: property.rooms || null,
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
                
                const { error: insertError } = await supabase
                  .from('external_properties')
                  .insert(propertyData);
                
                if (insertError) {
                  // Could be a race condition duplicate
                  if (insertError.code === '23505') {
                    crawlResult.duplicatesSkipped++;
                    console.log(`[crawl-external-properties] Duplicate skipped: "${propertyData.title}"`);
                  } else {
                    console.error(`[crawl-external-properties] Insert error:`, insertError);
                  }
                } else {
                  crawlResult.newListings++;
                  crawlResult.propertiesStored++;
                  
                  // Run image-based vibe analysis only for NEW listings
                  if (runVibeAnalysis && propertyData.images && propertyData.images.length > 0) {
                    try {
                      console.log(`[crawl-external-properties] Running vibe analysis on ${propertyData.images.length} images for "${propertyData.title}"`);
                      const vibeResult = await analyzePropertyImagesVibe(propertyData.images);
                      
                      if (vibeResult) {
                        const { error: vibeUpdateError } = await supabase
                          .from('external_properties')
                          .update({
                            vibe: vibeResult.vibe,
                            vibe_analysis: vibeResult.vibe_analysis,
                            highlights: vibeResult.highlights.length > 0 ? vibeResult.highlights : propertyData.highlights,
                            amenities: vibeResult.amenities.length > 0 ? vibeResult.amenities : propertyData.amenities,
                          })
                          .eq('source', propertyData.source)
                          .eq('external_id', propertyData.external_id);
                        
                        if (vibeUpdateError) {
                          console.error(`[crawl-external-properties] Vibe update error:`, vibeUpdateError);
                        } else {
                          crawlResult.vibeAnalyzed++;
                          console.log(`[crawl-external-properties] Vibe analysis complete: "${vibeResult.vibe}" for "${propertyData.title}"`);
                        }
                      }
                    } catch (vibeError) {
                      console.error(`[crawl-external-properties] Vibe analysis failed for "${propertyData.title}":`, vibeError);
                    }
                    
                    await new Promise(r => setTimeout(r, 500));
                  }
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
        
        // Small delay between marketplace requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    
    const totalFound = results.reduce((sum, r) => sum + r.propertiesFound, 0);
    const totalStored = results.reduce((sum, r) => sum + r.propertiesStored, 0);
    const totalNew = results.reduce((sum, r) => sum + r.newListings, 0);
    const totalUpdated = results.reduce((sum, r) => sum + r.updatedListings, 0);
    const totalDuplicatesSkipped = results.reduce((sum, r) => sum + r.duplicatesSkipped, 0);
    const totalVibeAnalyzed = results.reduce((sum, r) => sum + r.vibeAnalyzed, 0);
    const totalSkipped = results.filter(r => r.skipped).length;
    const totalErrors = results.filter(r => r.error).length;
    
    const duration = Date.now() - startTime;
    
    console.log(`[crawl-external-properties] Completed in ${duration}ms:`, {
      totalFound, totalStored, totalNew, totalUpdated, totalDuplicatesSkipped, totalVibeAnalyzed, totalSkipped, totalErrors,
    });
    
    return new Response(JSON.stringify({
      success: true,
      summary: {
        duration: `${duration}ms`,
        locationProcessed: location,
        remainingLocations,
        marketplacesProcessed: marketplaces.length,
        totalFound,
        totalStored,
        totalNew,
        totalUpdated,
        totalDuplicatesSkipped,
        totalVibeAnalyzed,
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
