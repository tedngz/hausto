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
  frequencyMinutes: number;
  maxListingsPerRun: number;
}

const DEFAULT_CONFIG: CrawlConfig = {
  paused: false,
  frequencyMinutes: 240,
  maxListingsPerRun: 10,
};

// Redis helpers
async function redisGet(key: string): Promise<any> {
  try {
    const res = await fetch(`${UPSTASH_REDIS_REST_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(["GET", key]),
    });
    const data = await res.json();
    if (data.result === null || data.result === undefined) return null;
    try { return JSON.parse(data.result); } catch { return data.result; }
  } catch (e) {
    console.error('[Redis GET error]', key, e);
    return null;
  }
}

async function redisSet(key: string, value: any, exSeconds?: number): Promise<void> {
  try {
    const cmd = exSeconds
      ? ["SETEX", key, String(exSeconds), JSON.stringify(value)]
      : ["SET", key, JSON.stringify(value)];
    const res = await fetch(`${UPSTASH_REDIS_REST_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cmd),
    });
    const data = await res.json();
    if (data.error) {
      console.error('[Redis SET error]', key, data.error);
    }
  } catch (e) { console.error('[Redis SET error]', key, e); }
}

async function getConfig(): Promise<CrawlConfig> {
  const stored = await redisGet(CONFIG_KEY);
  return stored ? { ...DEFAULT_CONFIG, ...stored } : DEFAULT_CONFIG;
}

// Track last crawl time per location+marketplace in Redis
function crawlTrackKey(location: string, marketplace: string): string {
  const normalized = location.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `crawl:track:${normalized}:${marketplace}`;
}

async function getLastCrawlTime(location: string, marketplace: string): Promise<number | null> {
  const val = await redisGet(crawlTrackKey(location, marketplace));
  return val ? Number(val) : null;
}

async function setLastCrawlTime(location: string, marketplace: string): Promise<void> {
  const key = crawlTrackKey(location, marketplace);
  const timestamp = Date.now();
  console.log(`[scheduled-crawl] Setting crawl time: key=${key}, value=${timestamp}`);
  await redisSet(key, timestamp, 48 * 60 * 60);
  // Verify the write
  const readBack = await redisGet(key);
  console.log(`[scheduled-crawl] Verified crawl time: key=${key}, readBack=${readBack}`);
}

// All locations to crawl
const CRAWL_LOCATIONS: { city: string; location: string }[] = [
  // ===== Ho Chi Minh City =====
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
  { city: 'ho_chi_minh', location: 'Thủ Đức' },
  { city: 'ho_chi_minh', location: 'Nhà Bè' },
  { city: 'ho_chi_minh', location: 'Bình Chánh' },
  { city: 'ho_chi_minh', location: 'Hóc Môn' },
  { city: 'ho_chi_minh', location: 'Củ Chi' },
  { city: 'ho_chi_minh', location: 'Cần Giờ' },
  // ===== Hanoi =====
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
  // ===== Da Nang =====
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

const MIN_PRICE_VND = 2_000_000;
const MAX_PRICE_VND = 200_000_000;

function isSuspiciousListing(property: any): { suspicious: boolean; reason?: string } {
  if (!property.title || property.title.length < 5) {
    return { suspicious: true, reason: 'Title too short or missing' };
  }
  if (property.price && property.price > 0 && property.price < MIN_PRICE_VND) {
    return { suspicious: true, reason: `Price too low: ${property.price} VND` };
  }
  if (property.price && property.price > MAX_PRICE_VND) {
    return { suspicious: true, reason: `Price too high for rental: ${property.price} VND` };
  }
  if (!property.images || property.images.length === 0) {
    return { suspicious: true, reason: 'No images' };
  }
  const text = `${(property.title || '').toLowerCase()} ${(property.description || '').toLowerCase()}`;
  const saleKeywords = [
    'bán gấp', 'bán nhanh', 'cần bán', 'sang nhượng', 'for sale', 'mua bán',
    'bán căn', 'bán lô', 'bán đất', 'chuyển nhượng', 'bán chung cư', 'giá bán',
    'bán nhà', 'bán biệt thự', 'bán villa', 'mua ngay',
  ];
  for (const keyword of saleKeywords) {
    if (text.includes(keyword)) return { suspicious: true, reason: `Sale keyword: "${keyword}"` };
  }
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
    if (text.includes(keyword)) return { suspicious: true, reason: `Non-residential: "${keyword}"` };
  }
  return { suspicious: false };
}

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
  if (/(ho chi minh|hcm|saigon|sài gòn|thủ đức|thu duc|quận [0-9]|quan [0-9]|district [0-9]|d[0-9]|bình thạnh|binh thanh|phú nhuận|phu nhuan|tân bình|tan binh|gò vấp|go vap|tân phú|tan phu|bình tân|binh tan|bình chánh|binh chanh|nhà bè|nha be|hóc môn|hoc mon|củ chi|cu chi|cần giờ|can gio)/i.test(lower)) return 'ho_chi_minh';
  if (/(hà nội|ha noi|hanoi|ba đình|ba dinh|hoàn kiếm|hoan kiem|đống đa|dong da|cầu giấy|cau giay|hai bà trưng|hai ba trung|tây hồ|tay ho|long biên|long bien|thanh xuân|thanh xuan|hoàng mai|hoang mai|bắc từ liêm|nam từ liêm|hà đông|ha dong|gia lâm|gia lam|đông anh|dong anh|sóc sơn|soc son|thanh trì|thanh tri|hoài đức|hoai duc|mê linh|me linh|sơn tây|son tay)/i.test(lower)) return 'hanoi';
  if (/(đà nẵng|da nang|hải châu|hai chau|thanh khê|thanh khe|sơn trà|son tra|ngũ hành sơn|ngu hanh son|liên chiểu|lien chieu|cẩm lệ|cam le|hòa vang|hoa vang)/i.test(lower)) return 'da_nang';
  return 'other';
}

// Run vibe analysis for a property and update it
async function runVibeAnalysis(supabase: any, propertyId: string, propertyData: any): Promise<boolean> {
  if (!OPENAI_API_KEY || !propertyData.images || propertyData.images.length === 0) return false;

  try {
    const imagesToAnalyze = propertyData.images.slice(0, 5);
    console.log(`[scheduled-crawl] Running vibe analysis for "${propertyData.title}" (${imagesToAnalyze.length} images)`);

    const analyzeResponse = await fetch(`${SUPABASE_URL}/functions/v1/analyze-vibe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        imageUrls: imagesToAnalyze,
        generateContent: true,
        propertyInfo: {
          title: propertyData.title,
          location: propertyData.location,
          price: propertyData.price,
          size: propertyData.size,
          rooms: propertyData.rooms,
        },
      }),
    });

    if (!analyzeResponse.ok) {
      console.error(`[scheduled-crawl] analyze-vibe failed: ${analyzeResponse.status}`);
      await analyzeResponse.text(); // consume body
      return false;
    }

    const analyzeData = await analyzeResponse.json();
    // analyze-vibe returns { analysis: { image_analyses: [...], modern, cozy, ... } }
    const analysisResult = analyzeData.analysis;
    const imageAnalysesRaw = analysisResult?.image_analyses || [];
    if (!imageAnalysesRaw || imageAnalysesRaw.length === 0) {
      console.error('[scheduled-crawl] No image analyses returned from analyze-vibe');
      return false;
    }

    // Build image_analyses array with proper image_index for UI compatibility
    const imageAnalyses = imageAnalysesRaw.map((a: any, idx: number) => ({
      image_index: idx,
      image_highlight: a.image_highlight || '',
      detailed_analysis: a.detailed_analysis || '',
      amenities: a.amenities || [],
      suggested_activities: a.suggested_activities || [],
      suggested_amenities: a.suggested_amenities || [],
      vibe_scores: {
        modern: a.modern || 5, cozy: a.cozy || 5, luxurious: a.luxurious || 5,
        minimalist: a.minimalist || 5, spacious: a.spacious || 5,
        natural_light: a.natural_light || 5, urban: a.urban || 5, elegant: a.elegant || 5,
      },
    }));

    // Derive styles from aggregated vibe scores
    const vibeScoreMap: Record<string, number> = {
      'Modern': analysisResult.modern || 5,
      'Cozy': analysisResult.cozy || 5,
      'Luxurious': analysisResult.luxurious || 5,
      'Minimalist': analysisResult.minimalist || 5,
      'Spacious': analysisResult.spacious || 5,
      'Elegant': analysisResult.elegant || 5,
      'Urban': analysisResult.urban || 5,
      'Rustic': analysisResult.rustic || 5,
    };
    const derivedStyles = Object.entries(vibeScoreMap)
      .filter(([_, score]) => score >= 6)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([style]) => style);
    if (derivedStyles.length === 0) derivedStyles.push('Contemporary');

    // Derive colors from vibe scores
    const derivedColors: string[] = [];
    if ((analysisResult.cozy || 0) >= 6 || (analysisResult.rustic || 0) >= 6) derivedColors.push('Warm');
    if ((analysisResult.minimalist || 0) >= 6) derivedColors.push('Neutral');
    if ((analysisResult.modern || 0) >= 6) derivedColors.push('Cool');
    if ((analysisResult.colorful || 0) >= 6) derivedColors.push('Bold');
    if ((analysisResult.natural_light || 0) >= 7) derivedColors.push('Bright');
    if ((analysisResult.elegant || 0) >= 6) derivedColors.push('Refined');
    if (derivedColors.length === 0) derivedColors.push('Neutral', 'Warm');

    // Collect activities from all image analyses
    const allActivities = new Set<string>();
    for (const a of imageAnalysesRaw) {
      if (a.suggested_activities) {
        a.suggested_activities.forEach((act: string) => allActivities.add(act));
      }
    }
    const derivedActivities = Array.from(allActivities).slice(0, 5);
    if (derivedActivities.length === 0) derivedActivities.push('Relaxing', 'Living');

    const updatedVibeAnalysis = {
      ...(propertyData.vibe_analysis || {}),
      image_analyses: imageAnalyses,
      styles: derivedStyles,
      colors: derivedColors,
      activities: derivedActivities,
      // Store aggregated vibe scores at top level for scoring
      modern: analysisResult.modern || 5,
      cozy: analysisResult.cozy || 5,
      luxurious: analysisResult.luxurious || 5,
      minimalist: analysisResult.minimalist || 5,
      spacious: analysisResult.spacious || 5,
      natural_light: analysisResult.natural_light || 5,
      urban: analysisResult.urban || 5,
      elegant: analysisResult.elegant || 5,
      rustic: analysisResult.rustic || 5,
      colorful: analysisResult.colorful || 5,
    };

    // Build positional highlights: one per image, aligned by index
    const positionalHighlights: string[] = new Array(imagesToAnalyze.length).fill('');
    
    imageAnalysesRaw.forEach((a: any, idx: number) => {
      if (a.image_highlight && typeof a.image_highlight === 'string' && a.image_highlight.trim()) {
        positionalHighlights[idx] = a.image_highlight.trim();
      }
    });
    
    // Fill gaps with fallback
    for (let i = 0; i < positionalHighlights.length; i++) {
      if (!positionalHighlights[i]) {
        positionalHighlights[i] = 'Premium living space feature';
      }
    }

    const allAmenities = new Set<string>(propertyData.amenities || []);
    for (const a of imageAnalysesRaw) {
      if (a.amenities) a.amenities.forEach((am: string) => allAmenities.add(am));
      if (a.suggested_amenities) a.suggested_amenities.forEach((am: string) => allAmenities.add(am));
    }

    await supabase
      .from('external_properties')
      .update({
        vibe_analysis: updatedVibeAnalysis,
        highlights: positionalHighlights,
        amenities: Array.from(allAmenities),
      })
      .eq('id', propertyId);

    console.log(`[scheduled-crawl] Vibe analysis done: ${positionalHighlights.length} image highlights for "${propertyData.title}"`);
    return true;
  } catch (e) {
    console.error('[scheduled-crawl] Vibe analysis error:', e);
    return false;
  }
}

Deno.serve(async (req) => {
  console.log(`[scheduled-crawl] Request received: ${req.method} at ${new Date().toISOString()}`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    console.log(`[scheduled-crawl] Body:`, JSON.stringify(body));

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

    if (config.paused) {
      console.log('[scheduled-crawl] Crawling is paused. Skipping.');
      return new Response(JSON.stringify({ success: true, message: 'Crawling is paused', config }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[scheduled-crawl] Starting crawl (frequency: ${config.frequencyMinutes}min, max: ${config.maxListingsPerRun}/run)`);

    // Step 1: Find the best location to crawl using Redis-tracked crawl times
    let bestTarget: { city: string; location: string; marketplace: string; lastCrawl: number | null } | null = null;
    let oldestCrawlTime = Infinity;

    // Check all location+marketplace combos in parallel batches
    const checks: Promise<{ loc: typeof CRAWL_LOCATIONS[0]; mp: string; lastCrawl: number | null }>[] = [];
    for (const loc of CRAWL_LOCATIONS) {
      for (const mp of MARKETPLACES) {
        checks.push(
          getLastCrawlTime(loc.location, mp).then(lastCrawl => ({ loc, mp, lastCrawl }))
        );
      }
    }
    const results = await Promise.all(checks);

    for (const { loc, mp, lastCrawl } of results) {
      if (lastCrawl === null) {
        // Never crawled - highest priority
        if (bestTarget === null || bestTarget.lastCrawl !== null) {
          bestTarget = { city: loc.city, location: loc.location, marketplace: mp, lastCrawl: null };
          oldestCrawlTime = 0;
        }
      } else if (bestTarget === null || (bestTarget.lastCrawl !== null && lastCrawl < oldestCrawlTime)) {
        oldestCrawlTime = lastCrawl;
        bestTarget = { city: loc.city, location: loc.location, marketplace: mp, lastCrawl };
      }
    }

    if (!bestTarget) {
      console.log('[scheduled-crawl] No targets found');
      return new Response(JSON.stringify({ success: true, message: 'No targets to crawl' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Skip if last crawl was within the configured frequency
    if (bestTarget.lastCrawl !== null) {
      const minsSinceLastCrawl = (Date.now() - bestTarget.lastCrawl) / (1000 * 60);
      if (minsSinceLastCrawl < config.frequencyMinutes) {
        console.log(`[scheduled-crawl] All locations crawled within ${config.frequencyMinutes}min. Skipping.`);
        return new Response(JSON.stringify({
          success: true,
          message: `All locations recently crawled (within ${config.frequencyMinutes}min)`,
          nextTarget: { ...bestTarget, minutesSinceLastCrawl: Math.round(minsSinceLastCrawl) },
          config,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`[scheduled-crawl] Target: ${bestTarget.location} on ${bestTarget.marketplace} (last crawl: ${bestTarget.lastCrawl ? new Date(bestTarget.lastCrawl).toISOString() : 'never'})`);

    // Mark this location+marketplace as crawled NOW (even before scraping starts)
    await setLastCrawlTime(bestTarget.location, bestTarget.marketplace);

    // Step 2: Call scrape-marketplace (pages: 1 to stay within Edge Function timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

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
        includeVibeAnalysis: false,
        maxResults: config.maxListingsPerRun,
        pages: 1,
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

    // Step 3: Filter suspicious listings
    const validProperties: any[] = [];
    const filteredOut: { title: string; reason: string }[] = [];

    for (const property of scrapeData.properties) {
      const check = isSuspiciousListing(property);
      if (check.suspicious) {
        filteredOut.push({ title: property.title || 'Unknown', reason: check.reason! });
      } else {
        validProperties.push(property);
      }
    }

    console.log(`[scheduled-crawl] ${validProperties.length} valid / ${filteredOut.length} filtered from ${scrapeData.properties.length} total`);

    // Step 4: Store valid properties with deduplication + run vibe analysis
    let newListings = 0;
    let updatedListings = 0;
    let duplicatesSkipped = 0;
    let vibeAnalyzed = 0;
    const newlyInsertedIds: string[] = [];

    for (const property of validProperties) {
      try {
        const locationNormalized = normalizeLocation(property.location || bestTarget.location);
        const detectedCity = detectCity(property.location || bestTarget.location);
        const rawSourceUrl = property.sourceUrl || `https://${bestTarget.marketplace}.com.vn`;
        const normalizedUrl = normalizeSourceUrl(rawSourceUrl);
        const externalId = property.sourceUrl
          ? btoa(normalizedUrl).substring(0, 100)
          : `${bestTarget.marketplace}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        // Check for existing
        const { data: existingByUrl } = await supabase
          .from('external_properties')
          .select('id, vibe_analysis')
          .eq('source', bestTarget.marketplace)
          .eq('source_url', normalizedUrl)
          .maybeSingle();

        const { data: existingById } = !existingByUrl ? await supabase
          .from('external_properties')
          .select('id, vibe_analysis')
          .eq('source', bestTarget.marketplace)
          .eq('external_id', externalId)
          .maybeSingle() : { data: existingByUrl };

        const existing = existingByUrl || existingById;

        const now = new Date().toISOString();
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
          images: (property.images || []).slice(0, 5),
          contact_name: property.sourceProviderName || null,
          contact_phone: property.sourceProviderPhone || null,
          vibe: property.vibe || null,
          vibe_analysis: property.vibe_analysis || {},
          is_active: true,
        };

        if (existing) {
          // Update: refresh verification time and expiry, preserve original crawled_at
          await supabase
            .from('external_properties')
            .update({
              ...propertyData,
              last_verified_at: now,
              updated_at: now,
              expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq('id', existing.id);
          updatedListings++;

          // Skip inline vibe analysis during cron to avoid timeout
          // Use the "Backfill Image Highlights" admin tool instead
        } else {
          const { data: inserted, error: insertError } = await supabase
            .from('external_properties')
            .insert({
              ...propertyData,
              external_id: externalId,
              source: bestTarget.marketplace,
              source_url: normalizedUrl,
              crawled_at: now,
              expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .select('id')
            .maybeSingle();

          if (insertError) {
            if (insertError.code === '23505') {
              duplicatesSkipped++;
            } else {
              console.error('[scheduled-crawl] Insert error:', insertError);
            }
          } else if (inserted) {
            newListings++;
            newlyInsertedIds.push(inserted.id);
          }
        }
      } catch (storeError) {
        console.error('[scheduled-crawl] Store error:', storeError);
      }
    }

    // Step 5: Auto-trigger vibe analysis for newly inserted properties + backfill missing highlights
    if (OPENAI_API_KEY) {
      const remainingTime = 150000 - (Date.now() - startTime); // Edge Function 150s limit
      if (remainingTime > 30000) { // Only if >30s remaining
        // 5a: Analyze newly inserted properties first
        if (newlyInsertedIds.length > 0) {
          console.log(`[scheduled-crawl] Running vibe analysis for ${newlyInsertedIds.length} new properties (${Math.round(remainingTime/1000)}s remaining)`);
          for (const id of newlyInsertedIds) {
            const elapsed = Date.now() - startTime;
            if (elapsed > 120000) break;
            try {
              const { data: prop } = await supabase
                .from('external_properties')
                .select('id, title, location, price, size, rooms, images, amenities, vibe_analysis')
                .eq('id', id)
                .maybeSingle();
              if (prop) {
                const success = await runVibeAnalysis(supabase, prop.id, prop);
                if (success) vibeAnalyzed++;
              }
            } catch (e) {
              console.error(`[scheduled-crawl] Vibe analysis error for ${id}:`, e);
            }
          }
          console.log(`[scheduled-crawl] Vibe analysis complete: ${vibeAnalyzed}/${newlyInsertedIds.length} new analyzed`);
        }

        // 5b: Backfill image highlights for existing properties that lack them
        const backfillRemaining = 120000 - (Date.now() - startTime);
        if (backfillRemaining > 15000) {
          console.log(`[scheduled-crawl] Backfilling image highlights (${Math.round(backfillRemaining/1000)}s remaining)`);
          
          // Find active properties with missing or generic highlights
          const { data: needsBackfill } = await supabase
            .from('external_properties')
            .select('id, title, location, price, size, rooms, images, amenities, vibe_analysis, highlights')
            .eq('is_active', true)
            .not('images', 'eq', '{}')
            .order('created_at', { ascending: false })
            .limit(20);

          if (needsBackfill) {
            const toBackfill = needsBackfill.filter((p: any) => {
              // No highlights at all
              if (!p.highlights || p.highlights.length === 0) return true;
              // No image_analyses in vibe_analysis
              if (!p.vibe_analysis?.image_analyses || p.vibe_analysis.image_analyses.length === 0) return true;
              // All highlights are generic fallback
              const allGeneric = p.highlights.every((h: string) => 
                !h || h === 'Premium living space feature' || h === 'Quality living space'
              );
              if (allGeneric) return true;
              return false;
            });

            let backfilled = 0;
            for (const prop of toBackfill) {
              const elapsed = Date.now() - startTime;
              if (elapsed > 120000) {
                console.log(`[scheduled-crawl] Stopping backfill early - ${Math.round(elapsed/1000)}s elapsed`);
                break;
              }
              try {
                const success = await runVibeAnalysis(supabase, prop.id, prop);
                if (success) backfilled++;
                // Small delay to avoid rate limits
                await new Promise(r => setTimeout(r, 2000));
              } catch (e) {
                console.error(`[scheduled-crawl] Backfill error for ${prop.id}:`, e);
              }
            }
            console.log(`[scheduled-crawl] Backfilled ${backfilled}/${toBackfill.length} properties with image highlights`);
            vibeAnalyzed += backfilled;
          }
        }
      } else {
        console.log(`[scheduled-crawl] Skipping vibe analysis - only ${Math.round(remainingTime/1000)}s remaining`);
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
