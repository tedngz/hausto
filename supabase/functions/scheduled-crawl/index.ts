import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

// All locations to crawl, organized by city
const CRAWL_LOCATIONS: { city: string; location: string }[] = [
  // Ho Chi Minh City - major districts
  { city: 'ho_chi_minh', location: 'D1' },
  { city: 'ho_chi_minh', location: 'D2' },
  { city: 'ho_chi_minh', location: 'D3' },
  { city: 'ho_chi_minh', location: 'D7' },
  { city: 'ho_chi_minh', location: 'Binh Thanh' },
  { city: 'ho_chi_minh', location: 'Phu Nhuan' },
  { city: 'ho_chi_minh', location: 'Tan Binh' },
  { city: 'ho_chi_minh', location: 'Thu Duc' },
  // Hanoi
  { city: 'hanoi', location: 'Ba Dinh' },
  { city: 'hanoi', location: 'Hoan Kiem' },
  { city: 'hanoi', location: 'Dong Da' },
  { city: 'hanoi', location: 'Cau Giay' },
  { city: 'hanoi', location: 'Hai Ba Trung' },
  // Da Nang
  { city: 'da_nang', location: 'Hai Chau' },
  { city: 'da_nang', location: 'Son Tra' },
  { city: 'da_nang', location: 'Ngu Hanh Son' },
];

const MARKETPLACES = ['batdongsan', 'nhatot'] as const;

// Minimum price thresholds to filter fake/spam listings (in VND)
const MIN_PRICE_VND = 2_000_000; // 2M VND - anything below is likely fake
const MAX_PRICE_VND = 200_000_000; // 200M VND - anything above for rent is suspicious

// Fake listing detection heuristics
function isSuspiciousListing(property: any): { suspicious: boolean; reason?: string } {
  // No title or very short title
  if (!property.title || property.title.length < 5) {
    return { suspicious: true, reason: 'Title too short or missing' };
  }
  
  // Price too low (likely bait)
  if (property.price && property.price > 0 && property.price < MIN_PRICE_VND) {
    return { suspicious: true, reason: `Price too low: ${property.price} VND` };
  }
  
  // Price unreasonably high for rental
  if (property.price && property.price > MAX_PRICE_VND) {
    return { suspicious: true, reason: `Price too high for rental: ${property.price} VND` };
  }
  
  // No images at all
  if (!property.images || property.images.length === 0) {
    return { suspicious: true, reason: 'No images' };
  }
  
  // Spam keywords in title/description
  const spamKeywords = ['bán gấp', 'bán nhanh', 'cần bán', 'sang nhượng', 'for sale', 'mua bán'];
  const text = `${property.title || ''} ${property.description || ''}`.toLowerCase();
  for (const keyword of spamKeywords) {
    if (text.includes(keyword)) {
      return { suspicious: true, reason: `Contains sale keyword: "${keyword}"` };
    }
  }
  
  // Duplicate phone number patterns (common in spam)
  if (property.sourceProviderPhone) {
    const phone = property.sourceProviderPhone.replace(/\D/g, '');
    if (phone.length < 9) {
      return { suspicious: true, reason: 'Invalid phone number' };
    }
  }
  
  return { suspicious: false };
}

// Normalize source URL for dedup
function normalizeSourceUrl(url: string): string {
  try {
    const u = new URL(url.toLowerCase().trim());
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source'];
    paramsToRemove.forEach(p => u.searchParams.delete(p));
    u.searchParams.sort();
    return u.toString().replace(/\/+$/, '');
  } catch {
    return url.toLowerCase().trim().replace(/\/+$/, '');
  }
}

function normalizeLocation(location: string): string {
  return location.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function detectCity(location: string): string {
  const lower = location.toLowerCase();
  if (/(ho chi minh|hcm|saigon|sài gòn|quan [0-9]|district [0-9]|d[0-9]|binh thanh|phu nhuan|tan binh|go vap|thu duc)/i.test(lower)) return 'ho_chi_minh';
  if (/(ha noi|hanoi|hà nội|ba dinh|hoan kiem|dong da|cau giay|hai ba trung)/i.test(lower)) return 'hanoi';
  if (/(da nang|đà nẵng)/i.test(lower)) return 'da_nang';
  return 'other';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log('[scheduled-crawl] Starting automated crawl cycle');

    // Step 1: Find the location that was crawled least recently
    // Query the most recent crawl timestamp for each location+marketplace combo
    const { data: recentCrawls } = await supabase
      .from('external_properties')
      .select('city, location_normalized, source, crawled_at')
      .order('crawled_at', { ascending: false });

    // Build a map of last crawl time per location+marketplace
    const lastCrawlMap = new Map<string, string>();
    if (recentCrawls) {
      for (const row of recentCrawls) {
        const key = `${row.location_normalized}|${row.source}`;
        if (!lastCrawlMap.has(key)) {
          lastCrawlMap.set(key, row.crawled_at);
        }
      }
    }

    // Find the location+marketplace combo that needs crawling most
    // Prioritize: never crawled > oldest crawled > recently crawled
    let bestTarget: { city: string; location: string; marketplace: string; lastCrawl: string | null } | null = null;
    let oldestCrawl: number = Infinity;

    for (const loc of CRAWL_LOCATIONS) {
      for (const mp of MARKETPLACES) {
        const key = `${normalizeLocation(loc.location)}|${mp}`;
        const lastCrawl = lastCrawlMap.get(key);
        
        if (!lastCrawl) {
          // Never crawled - highest priority
          bestTarget = { city: loc.city, location: loc.location, marketplace: mp, lastCrawl: null };
          oldestCrawl = 0;
          break;
        }
        
        const crawlTime = new Date(lastCrawl).getTime();
        if (crawlTime < oldestCrawl) {
          oldestCrawl = crawlTime;
          bestTarget = { city: loc.city, location: loc.location, marketplace: mp, lastCrawl };
        }
      }
      if (bestTarget && !bestTarget.lastCrawl) break; // Found never-crawled, stop
    }

    if (!bestTarget) {
      console.log('[scheduled-crawl] No targets found');
      return new Response(JSON.stringify({ success: true, message: 'No targets to crawl' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Skip if last crawl was less than 4 hours ago
    if (bestTarget.lastCrawl) {
      const hoursSinceLastCrawl = (Date.now() - new Date(bestTarget.lastCrawl).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastCrawl < 4) {
        console.log(`[scheduled-crawl] All locations crawled within 4 hours. Skipping.`);
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'All locations recently crawled',
          nextTarget: bestTarget,
          hoursSinceLastCrawl: Math.round(hoursSinceLastCrawl * 10) / 10,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`[scheduled-crawl] Target: ${bestTarget.location} on ${bestTarget.marketplace} (last crawl: ${bestTarget.lastCrawl || 'never'})`);

    // Step 2: Call scrape-marketplace to get listings
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout

    const scrapeResponse = await fetch(`${SUPABASE_URL}/functions/v1/scrape-marketplace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        marketplace: bestTarget.marketplace,
        query: 'căn hộ chung cư cho thuê',
        location: bestTarget.location,
        includeVibeAnalysis: true,
        maxResults: 10,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!scrapeResponse.ok) {
      const errorText = await scrapeResponse.text();
      console.error(`[scheduled-crawl] Scrape failed:`, errorText);
      return new Response(JSON.stringify({ 
        success: false, 
        error: `Scrape failed: ${scrapeResponse.status}`,
        target: bestTarget,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const scrapeData = await scrapeResponse.json();

    if (!scrapeData.success || !scrapeData.properties?.length) {
      console.log(`[scheduled-crawl] No properties found for ${bestTarget.location}/${bestTarget.marketplace}`);
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No properties found',
        target: bestTarget,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: Filter out suspicious/fake listings
    const validProperties: any[] = [];
    const filteredOut: { title: string; reason: string }[] = [];

    for (const property of scrapeData.properties) {
      const check = isSuspiciousListing(property);
      if (check.suspicious) {
        filteredOut.push({ title: property.title || 'Unknown', reason: check.reason! });
        console.log(`[scheduled-crawl] Filtered suspicious: "${property.title}" - ${check.reason}`);
      } else {
        validProperties.push(property);
      }
    }

    console.log(`[scheduled-crawl] ${validProperties.length} valid / ${filteredOut.length} filtered from ${scrapeData.properties.length} total`);

    // Step 4: Store valid properties with deduplication
    let newListings = 0;
    let updatedListings = 0;
    let duplicatesSkipped = 0;
    let vibeAnalyzed = 0;

    for (const property of validProperties) {
      try {
        const locationNormalized = normalizeLocation(property.location || bestTarget.location);
        const detectedCity = detectCity(property.location || bestTarget.location);
        const rawSourceUrl = property.sourceUrl || `https://${bestTarget.marketplace}.com.vn`;
        const normalizedUrl = normalizeSourceUrl(rawSourceUrl);
        const externalId = property.sourceUrl
          ? btoa(normalizedUrl).substring(0, 100)
          : `${bestTarget.marketplace}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        // Check for existing by normalized URL
        const { data: existingByUrl } = await supabase
          .from('external_properties')
          .select('id')
          .eq('source', bestTarget.marketplace)
          .eq('source_url', normalizedUrl)
          .maybeSingle();

        const { data: existingById } = !existingByUrl ? await supabase
          .from('external_properties')
          .select('id')
          .eq('source', bestTarget.marketplace)
          .eq('external_id', externalId)
          .maybeSingle() : { data: existingByUrl };

        const existing = existingByUrl || existingById;

        const propertyData = {
          title: property.title || 'Rental Property',
          location: property.location || bestTarget.location,
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
          expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          is_active: true,
        };

        if (existing) {
          await supabase
            .from('external_properties')
            .update(propertyData)
            .eq('id', existing.id);
          updatedListings++;
        } else {
          const { error: insertError } = await supabase
            .from('external_properties')
            .insert({ ...propertyData, external_id: externalId, source: bestTarget.marketplace, source_url: normalizedUrl });

          if (insertError) {
            if (insertError.code === '23505') {
              duplicatesSkipped++;
            } else {
              console.error('[scheduled-crawl] Insert error:', insertError);
            }
          } else {
            newListings++;

            // Run vibe analysis for new listings with images
            if (OPENAI_API_KEY && propertyData.images && propertyData.images.length > 0) {
              try {
                // Lightweight vibe scoring via the scrape data (already included from scrape-marketplace)
                if (property.vibe_analysis && Object.keys(property.vibe_analysis).length > 0) {
                  vibeAnalyzed++;
                }
              } catch (e) {
                console.error('[scheduled-crawl] Vibe update error:', e);
              }
            }
          }
        }
      } catch (storeError) {
        console.error('[scheduled-crawl] Store error:', storeError);
      }
    }

    const duration = Date.now() - startTime;

    const summary = {
      duration: `${duration}ms`,
      target: bestTarget,
      totalScraped: scrapeData.properties.length,
      validAfterFilter: validProperties.length,
      filteredOut: filteredOut.length,
      newListings,
      updatedListings,
      duplicatesSkipped,
      vibeAnalyzed,
      filteredReasons: filteredOut,
    };

    console.log('[scheduled-crawl] Completed:', JSON.stringify(summary));

    // Step 5: Log the crawl run for monitoring
    // We reuse external_properties timestamps for tracking, no separate table needed

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[scheduled-crawl] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: `${Date.now() - startTime}ms`,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
