import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL')!;
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!;

const CONFIG_KEY = 'crawl:config';

interface CrawlConfig {
  paused: boolean;
  frequencyMinutes: number; // cooldown between crawls for the same location
  maxListingsPerRun: number;
}

const DEFAULT_CONFIG: CrawlConfig = {
  paused: false,
  frequencyMinutes: 240, // 4 hours between re-crawling same location
  maxListingsPerRun: 10,
};

// Redis helpers
async function redisGet(key: string): Promise<any> {
  try {
    const res = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function redisSet(key: string, value: any): Promise<void> {
  try {
    await fetch(`${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
    });
  } catch (e) { console.error('Redis set error:', e); }
}

async function getConfig(): Promise<CrawlConfig> {
  const stored = await redisGet(CONFIG_KEY);
  return stored ? { ...DEFAULT_CONFIG, ...stored } : DEFAULT_CONFIG;
}

// All locations to crawl, organized by city
const CRAWL_LOCATIONS: { city: string; location: string }[] = [
  // ===== Ho Chi Minh City - All 22 districts =====
  // Urban districts (Quận)
  { city: 'ho_chi_minh', location: 'Quận 1' },
  { city: 'ho_chi_minh', location: 'Quận 3' },
  { city: 'ho_chi_minh', location: 'Quận 4' },
  { city: 'ho_chi_minh', location: 'Quận 5' },
  { city: 'ho_chi_minh', location: 'Quận 6' },
  { city: 'ho_chi_minh', location: 'Quận 7' },
  { city: 'ho_chi_minh', location: 'Quận 8' },
  { city: 'ho_chi_minh', location: 'Quận 10' },
  { city: 'ho_chi_minh', location: 'Quận 11' },
  { city: 'ho_chi_minh', location: 'Quận 12' },
  { city: 'ho_chi_minh', location: 'Bình Thạnh' },
  { city: 'ho_chi_minh', location: 'Phú Nhuận' },
  { city: 'ho_chi_minh', location: 'Tân Bình' },
  { city: 'ho_chi_minh', location: 'Tân Phú' },
  { city: 'ho_chi_minh', location: 'Gò Vấp' },
  { city: 'ho_chi_minh', location: 'Bình Tân' },
  { city: 'ho_chi_minh', location: 'Thủ Đức' }, // TP Thủ Đức (merged D2, D9, Thủ Đức)
  // Suburban districts (Huyện)
  { city: 'ho_chi_minh', location: 'Nhà Bè' },
  { city: 'ho_chi_minh', location: 'Bình Chánh' },
  { city: 'ho_chi_minh', location: 'Hóc Môn' },
  { city: 'ho_chi_minh', location: 'Củ Chi' },
  { city: 'ho_chi_minh', location: 'Cần Giờ' },

  // ===== Hanoi - All 30 districts =====
  // Urban districts (Quận)
  { city: 'hanoi', location: 'Ba Đình' },
  { city: 'hanoi', location: 'Hoàn Kiếm' },
  { city: 'hanoi', location: 'Đống Đa' },
  { city: 'hanoi', location: 'Cầu Giấy' },
  { city: 'hanoi', location: 'Hai Bà Trưng' },
  { city: 'hanoi', location: 'Tây Hồ' },
  { city: 'hanoi', location: 'Long Biên' },
  { city: 'hanoi', location: 'Thanh Xuân' },
  { city: 'hanoi', location: 'Hoàng Mai' },
  { city: 'hanoi', location: 'Bắc Từ Liêm' },
  { city: 'hanoi', location: 'Nam Từ Liêm' },
  { city: 'hanoi', location: 'Hà Đông' },
  // Suburban districts/towns (Huyện/Thị xã)
  { city: 'hanoi', location: 'Gia Lâm' },
  { city: 'hanoi', location: 'Đông Anh' },
  { city: 'hanoi', location: 'Sóc Sơn' },
  { city: 'hanoi', location: 'Thanh Trì' },
  { city: 'hanoi', location: 'Hoài Đức' },
  { city: 'hanoi', location: 'Thanh Oai' },
  { city: 'hanoi', location: 'Thường Tín' },
  { city: 'hanoi', location: 'Mê Linh' },
  { city: 'hanoi', location: 'Chương Mỹ' },
  { city: 'hanoi', location: 'Đan Phượng' },
  { city: 'hanoi', location: 'Phúc Thọ' },
  { city: 'hanoi', location: 'Quốc Oai' },
  { city: 'hanoi', location: 'Thạch Thất' },
  { city: 'hanoi', location: 'Ba Vì' },
  { city: 'hanoi', location: 'Sơn Tây' },
  { city: 'hanoi', location: 'Phú Xuyên' },
  { city: 'hanoi', location: 'Ứng Hòa' },
  { city: 'hanoi', location: 'Mỹ Đức' },

  // ===== Da Nang - All 8 districts =====
  { city: 'da_nang', location: 'Hải Châu' },
  { city: 'da_nang', location: 'Thanh Khê' },
  { city: 'da_nang', location: 'Sơn Trà' },
  { city: 'da_nang', location: 'Ngũ Hành Sơn' },
  { city: 'da_nang', location: 'Liên Chiểu' },
  { city: 'da_nang', location: 'Cẩm Lệ' },
  { city: 'da_nang', location: 'Hòa Vang' },
  { city: 'da_nang', location: 'Hoàng Sa' },
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
  
  // Combine title + description for keyword checks
  const text = `${(property.title || '').toLowerCase()} ${(property.description || '').toLowerCase()}`;

  // Sale keywords - filter out buy/sell listings
  const saleKeywords = [
    'bán gấp', 'bán nhanh', 'cần bán', 'sang nhượng', 'for sale', 'mua bán',
    'bán căn', 'bán lô', 'bán đất', 'chuyển nhượng', 'bán chung cư', 'giá bán',
    'bán nhà', 'bán biệt thự', 'bán villa', 'mua ngay',
  ];
  for (const keyword of saleKeywords) {
    if (text.includes(keyword)) {
      return { suspicious: true, reason: `Contains sale keyword: "${keyword}"` };
    }
  }

  // Non-residential / industrial / commercial keywords
  // Note: Only use multi-word or specific terms to avoid false positives (e.g. "shop" alone matches "shopping")
  const nonResidentialKeywords = [
    'văn phòng cho thuê', 'office for rent', 'mặt bằng kinh doanh', 'mặt bằng cho thuê',
    'cửa hàng cho thuê', 'shop for rent', 'cho thuê shop',
    'kho xưởng', 'nhà xưởng', 'xưởng sản xuất', 'kho bãi', 'warehouse',
    'factory', 'industrial', 'công nghiệp', 'thương mại', 'commercial property',
    'kinh doanh mặt bằng', 'showroom', 'coworking', 'co-working',
    'đất nền', 'đất thổ cư', 'đất nông nghiệp', 'farmland', 'land for sale',
    'khách sạn', 'hotel for', 'resort for', 'motel', 'nhà nghỉ cho thuê',
    'căn hộ dịch vụ bán', 'penthouse bán',
  ];
  for (const keyword of nonResidentialKeywords) {
    if (text.includes(keyword)) {
      return { suspicious: true, reason: `Non-residential listing: "${keyword}"` };
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
  // HCM - include all district names with diacritics
  if (/(ho chi minh|hcm|saigon|sài gòn|thủ đức|thu duc|quận [0-9]|quan [0-9]|district [0-9]|d[0-9]|bình thạnh|binh thanh|phú nhuận|phu nhuan|tân bình|tan binh|gò vấp|go vap|tân phú|tan phu|bình tân|binh tan|bình chánh|binh chanh|nhà bè|nha be|hóc môn|hoc mon|củ chi|cu chi|cần giờ|can gio)/i.test(lower)) return 'ho_chi_minh';
  // Hanoi - include all district names with diacritics
  if (/(hà nội|ha noi|hanoi|ba đình|ba dinh|hoàn kiếm|hoan kiem|đống đa|dong da|cầu giấy|cau giay|hai bà trưng|hai ba trung|tây hồ|tay ho|long biên|long bien|thanh xuân|thanh xuan|hoàng mai|hoang mai|bắc từ liêm|nam từ liêm|hà đông|ha dong|gia lâm|gia lam|đông anh|dong anh|sóc sơn|soc son|thanh trì|thanh tri|hoài đức|hoai duc|mê linh|me linh|sơn tây|son tay)/i.test(lower)) return 'hanoi';
  // Da Nang - include all district names
  if (/(đà nẵng|da nang|hải châu|hai chau|thanh khê|thanh khe|sơn trà|son tra|ngũ hành sơn|ngu hanh son|liên chiểu|lien chieu|cẩm lệ|cam le|hòa vang|hoa vang)/i.test(lower)) return 'da_nang';
  return 'other';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));

    // Handle config management actions
    if (body.action === 'get-config') {
      const config = await getConfig();
      return new Response(JSON.stringify({ success: true, config }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'set-config') {
      const currentConfig = await getConfig();
      const newConfig: CrawlConfig = {
        paused: body.paused !== undefined ? body.paused : currentConfig.paused,
        frequencyMinutes: body.frequencyMinutes !== undefined ? Math.max(30, Math.min(1440, body.frequencyMinutes)) : currentConfig.frequencyMinutes,
        maxListingsPerRun: body.maxListingsPerRun !== undefined ? Math.max(1, Math.min(20, body.maxListingsPerRun)) : currentConfig.maxListingsPerRun,
      };
      await redisSet(CONFIG_KEY, newConfig);
      console.log('[scheduled-crawl] Config updated:', JSON.stringify(newConfig));
      return new Response(JSON.stringify({ success: true, config: newConfig }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normal crawl execution
    const config = await getConfig();

    // Check if paused
    if (config.paused) {
      console.log('[scheduled-crawl] Crawling is paused. Skipping.');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Crawling is paused',
        config,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[scheduled-crawl] Starting crawl (frequency: ${config.frequencyMinutes}min, max: ${config.maxListingsPerRun}/run)`);

    // Step 1: Find the location that was crawled least recently
    const { data: recentCrawls } = await supabase
      .from('external_properties')
      .select('city, location_normalized, source, crawled_at')
      .order('crawled_at', { ascending: false });

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

    // Skip if last crawl was within the configured frequency
    if (bestTarget.lastCrawl) {
      const minsSinceLastCrawl = (Date.now() - new Date(bestTarget.lastCrawl).getTime()) / (1000 * 60);
      if (minsSinceLastCrawl < config.frequencyMinutes) {
        console.log(`[scheduled-crawl] All locations crawled within ${config.frequencyMinutes}min. Skipping.`);
        return new Response(JSON.stringify({ 
          success: true, 
          message: `All locations recently crawled (within ${config.frequencyMinutes}min)`,
          nextTarget: bestTarget,
          minutesSinceLastCrawl: Math.round(minsSinceLastCrawl),
          config,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`[scheduled-crawl] Target: ${bestTarget.location} on ${bestTarget.marketplace} (last crawl: ${bestTarget.lastCrawl || 'never'})`);

    // Step 2: Call scrape-marketplace to get listings
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 150000); // 150s timeout - scraping takes ~2 min

    const scrapeResponse = await fetch(`${SUPABASE_URL}/functions/v1/scrape-marketplace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        marketplace: bestTarget.marketplace,
        query: 'cho thuê căn hộ chung cư nhà ở',
        location: bestTarget.location,
        includeVibeAnalysis: true,
        maxResults: config.maxListingsPerRun,
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
