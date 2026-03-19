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
const QSTASH_TOKEN = Deno.env.get('QSTASH_TOKEN');
const QSTASH_CURRENT_SIGNING_KEY = Deno.env.get('QSTASH_CURRENT_SIGNING_KEY');
const QSTASH_NEXT_SIGNING_KEY = Deno.env.get('QSTASH_NEXT_SIGNING_KEY');

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/scheduled-crawl`;

const CONFIG_KEY = 'crawl:config';

// ===== QStash signature verification =====
async function verifyQStashSignature(signature: string, body: string): Promise<boolean> {
  // QStash signs with a JWT in the upstash-signature header
  // We verify the JWT signature using HMAC-SHA256 with the signing keys
  for (const key of [QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY]) {
    if (!key) continue;
    try {
      const parts = signature.split('.');
      if (parts.length !== 3) continue;
      
      const encoder = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      );
      
      const signatureBytes = Uint8Array.from(
        atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
        c => c.charCodeAt(0)
      );
      
      const dataToVerify = encoder.encode(`${parts[0]}.${parts[1]}`);
      const valid = await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, dataToVerify);
      
      if (valid) {
        // Also check expiry from JWT payload
        try {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            console.log('[scheduled-crawl] QStash JWT expired');
            continue;
          }
          // Verify body hash if present
          if (payload.body) {
            const bodyHash = await crypto.subtle.digest('SHA-256', encoder.encode(body));
            const bodyHashB64 = btoa(String.fromCharCode(...new Uint8Array(bodyHash)));
            if (payload.body !== bodyHashB64) {
              console.log('[scheduled-crawl] QStash body hash mismatch');
              continue;
            }
          }
        } catch { /* payload parse error, still accept if signature valid */ }
        return true;
      }
    } catch (e) {
      console.error('[scheduled-crawl] QStash verify error:', e);
    }
  }
  return false;
}

// ===== QStash self-chaining: publish a follow-up message =====
async function qstashPublish(payload: Record<string, unknown>, delaySec = 5): Promise<boolean> {
  if (!QSTASH_TOKEN) {
    console.log('[scheduled-crawl] QSTASH_TOKEN not set, cannot self-chain');
    return false;
  }
  try {
    const res = await fetch(`https://qstash.upstash.io/v2/publish/${FUNCTION_URL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
        'Upstash-Delay': `${delaySec}s`,
        'Upstash-Retries': '2',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`[scheduled-crawl] QStash self-chain published: messageId=${data.messageId}`);
      return true;
    } else {
      console.error('[scheduled-crawl] QStash publish failed:', data);
      return false;
    }
  } catch (e) {
    console.error('[scheduled-crawl] QStash publish error:', e);
    return false;
  }
}

interface CrawlConfig {
  paused: boolean;
  frequencyMinutes: number;
  maxListingsPerRun: number;
}

const DEFAULT_CONFIG: CrawlConfig = {
  paused: false,
  frequencyMinutes: 2880,
  maxListingsPerRun: 5,
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

// High-value center districts only (20 districts to optimize Firecrawl credits)
const CRAWL_LOCATIONS: { city: string; location: string }[] = [
  // ===== Ho Chi Minh City (10) =====
  { city: 'ho_chi_minh', location: 'Quận 1' },
  { city: 'ho_chi_minh', location: 'Quận 3' },
  { city: 'ho_chi_minh', location: 'Quận 4' },
  { city: 'ho_chi_minh', location: 'Quận 7' },
  { city: 'ho_chi_minh', location: 'Quận 10' },
  { city: 'ho_chi_minh', location: 'Bình Thạnh' },
  { city: 'ho_chi_minh', location: 'Phú Nhuận' },
  { city: 'ho_chi_minh', location: 'Tân Bình' },
  { city: 'ho_chi_minh', location: 'Gò Vấp' },
  { city: 'ho_chi_minh', location: 'Thủ Đức' },
  // ===== Hanoi (7) =====
  { city: 'hanoi', location: 'Ba Đình' },
  { city: 'hanoi', location: 'Hoàn Kiếm' },
  { city: 'hanoi', location: 'Đống Đa' },
  { city: 'hanoi', location: 'Cầu Giấy' },
  { city: 'hanoi', location: 'Hai Bà Trưng' },
  { city: 'hanoi', location: 'Tây Hồ' },
  { city: 'hanoi', location: 'Long Biên' },
  // ===== Da Nang (3) =====
  { city: 'da_nang', location: 'Hải Châu' },
  { city: 'da_nang', location: 'Sơn Trà' },
  { city: 'da_nang', location: 'Ngũ Hành Sơn' },
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

  // Read body once for both QStash verification and action parsing
  const rawBody = await req.text();
  let body: Record<string, any> = {};
  try { body = JSON.parse(rawBody); } catch { /* empty body */ }

  // ===== Authorization: QStash signature OR service role key =====
  const qstashSignature = req.headers.get('upstash-signature');
  const authHeader = req.headers.get('authorization') || '';
  let isAuthorized = false;

  if (qstashSignature) {
    // Verify QStash signature
    isAuthorized = await verifyQStashSignature(qstashSignature, rawBody);
    if (isAuthorized) {
      console.log('[scheduled-crawl] Authorized via QStash signature');
    } else {
      console.log('[scheduled-crawl] QStash signature verification failed');
      return new Response(JSON.stringify({ error: 'Invalid QStash signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } else if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
    // Service role key (pg_cron, admin tools, manual triggers)
    isAuthorized = true;
    console.log('[scheduled-crawl] Authorized via service role key');
  } else {
    // Allow anon key calls too (pg_cron uses anon key in some setups)
    isAuthorized = true;
    console.log('[scheduled-crawl] Accepting request (open access for pg_cron compatibility)');
  }

  try {
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
        frequencyMinutes: body.frequencyMinutes !== undefined ? Math.max(30, Math.min(4320, body.frequencyMinutes)) : currentConfig.frequencyMinutes,
        maxListingsPerRun: body.maxListingsPerRun !== undefined ? Math.max(1, Math.min(10, body.maxListingsPerRun)) : currentConfig.maxListingsPerRun,
      };
      await redisSet(CONFIG_KEY, newConfig);
      console.log('[scheduled-crawl] Config updated:', JSON.stringify(newConfig));
      return new Response(JSON.stringify({ success: true, config: newConfig }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle bulk vibe backfill action
    if (body.action === 'backfill-vibe') {
      console.log('[scheduled-crawl] Starting bulk vibe backfill for external properties');
      
      // Fetch more properties to check — we filter client-side anyway
      const { data: needsVibe } = await supabase
        .from('external_properties')
        .select('id, title, location, price, size, rooms, images, amenities, vibe_analysis, highlights')
        .eq('is_active', true)
        .not('images', 'eq', '{}')
        .order('created_at', { ascending: false })
        .limit(200);

      if (!needsVibe || needsVibe.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No properties to backfill', analyzed: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const isGenericHighlight = (h: string) => !h || h === 'Premium living space feature' || h === 'Quality living space';

      const toBackfill = needsVibe.filter((p: any) => {
        if (!p.vibe_analysis?.styles || p.vibe_analysis.styles.length === 0) return true;
        if (!p.vibe_analysis?.colors || p.vibe_analysis.colors.length === 0) return true;
        if (!p.vibe_analysis?.activities || p.vibe_analysis.activities.length === 0) return true;
        if (!p.vibe_analysis?.image_analyses || p.vibe_analysis.image_analyses.length === 0) return true;
        if (!p.highlights || p.highlights.length === 0) return true;
        if (p.highlights.every((h: string) => isGenericHighlight(h))) return true;
        return false;
      });

      console.log(`[scheduled-crawl] Found ${toBackfill.length}/${needsVibe.length} properties needing vibe backfill`);

      if (toBackfill.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'All properties already have vibe data', analyzed: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let analyzed = 0;
      let failed = 0;
      const results: any[] = [];
      let stoppedEarly = false;
      for (const prop of toBackfill) {
        const elapsed = Date.now() - startTime;
        if (elapsed > 120000) {
          console.log(`[scheduled-crawl] Stopping backfill - ${Math.round(elapsed/1000)}s elapsed`);
          stoppedEarly = true;
          break;
        }
        try {
          const success = await runVibeAnalysis(supabase, prop.id, prop);
          if (success) analyzed++;
          else failed++;
          results.push({ id: prop.id, title: prop.title, success });
          await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
          console.error(`[scheduled-crawl] Backfill error for ${prop.id}:`, e);
          results.push({ id: prop.id, title: prop.title, success: false, error: String(e) });
          failed++;
        }
      }

      // Self-chain via QStash if we stopped early OR if there are more properties than we processed
      // This ensures all properties eventually get processed across multiple runs
      let chained = false;
      const remainingCount = toBackfill.length - analyzed - failed;
      if (stoppedEarly && remainingCount > 0) {
        console.log(`[scheduled-crawl] Self-chaining backfill: ${analyzed} done, ~${remainingCount} remaining`);
        chained = await qstashPublish({ action: 'backfill-vibe', continuation: true }, 5);
      }

      // Invalidate property discovery cache so fresh data with highlights is served
      if (analyzed > 0) {
        try {
          await supabase.functions.invoke('property-discovery-cache', {
            body: { action: 'invalidate' },
          });
          console.log('[scheduled-crawl] Property discovery cache invalidated after backfill');
        } catch (e) {
          console.error('[scheduled-crawl] Failed to invalidate cache:', e);
        }
      }

      console.log(`[scheduled-crawl] Vibe backfill complete: ${analyzed} success, ${failed} failed out of ${toBackfill.length}${chained ? ' (continuation queued)' : ''}`);
      return new Response(JSON.stringify({ success: true, total: toBackfill.length, analyzed, failed, results, chained, duration: `${Date.now() - startTime}ms` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }


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

    // Step 2: Call scrape-marketplace with directSave mode
    // scrape-marketplace saves properties directly to DB, so even if this call times out,
    // properties already saved are not lost.
    let scrapeResult: any = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 140000);

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
          crawlLocation: bestTarget.location,
          includeVibeAnalysis: false,
          maxResults: config.maxListingsPerRun,
          pages: 1,
          directSave: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (scrapeResponse.ok) {
        scrapeResult = await scrapeResponse.json();
        console.log(`[scheduled-crawl] Scrape+save completed:`, JSON.stringify(scrapeResult));
      } else {
        const errorText = await scrapeResponse.text();
        console.error(`[scheduled-crawl] Scrape failed: ${scrapeResponse.status}`, errorText);
      }
    } catch (abortErr) {
      // Even on timeout, scrape-marketplace may have already saved some properties via directSave
      console.warn(`[scheduled-crawl] Scrape call timed out for ${bestTarget.location}/${bestTarget.marketplace}, but directSave may have persisted partial results`);
    }

    const newListings = scrapeResult?.newListings || 0;
    const updatedListings = scrapeResult?.updatedListings || 0;
    const duplicatesSkipped = scrapeResult?.duplicatesSkipped || 0;
    const filtered = scrapeResult?.filtered || 0;
    let vibeAnalyzed = 0;

    // Step 3: Always chain vibe backfill via QStash after each crawl
    // This ensures any properties with missing/generic highlights get processed
    console.log(`[scheduled-crawl] Chaining vibe backfill (new: ${newListings}, updated: ${updatedListings})`);
    const backfillChained = await qstashPublish({ action: 'backfill-vibe', continuation: true, source: 'post-crawl' }, 10);
    if (!backfillChained) {
      console.warn('[scheduled-crawl] Failed to chain vibe backfill via QStash — will attempt inline analysis');
    }

    // Step 4: If we have time remaining, do inline vibe analysis
    if (OPENAI_API_KEY && scrapeResult?.success) {
      const remainingTime = 150000 - (Date.now() - startTime);
      if (remainingTime > 30000) {
        // Find recently inserted properties needing vibe analysis
        const { data: needsVibe } = await supabase
          .from('external_properties')
          .select('id, title, location, price, size, rooms, images, amenities, vibe_analysis, highlights')
          .eq('is_active', true)
          .not('images', 'eq', '{}')
          .order('created_at', { ascending: false })
          .limit(5);

        if (needsVibe) {
          const toAnalyze = needsVibe.filter((p: any) => {
            if (!p.vibe_analysis?.styles || p.vibe_analysis.styles.length === 0) return true;
            if (!p.vibe_analysis?.image_analyses || p.vibe_analysis.image_analyses.length === 0) return true;
            if (!p.highlights || p.highlights.length === 0) return true;
            const allGeneric = p.highlights.every((h: string) => !h || h === 'Premium living space feature' || h === 'Quality living space');
            return allGeneric;
          });

          for (const prop of toAnalyze) {
            if (Date.now() - startTime > 120000) break;
            try {
              const success = await runVibeAnalysis(supabase, prop.id, prop);
              if (success) vibeAnalyzed++;
              await new Promise(r => setTimeout(r, 2000));
            } catch (e) {
              console.error(`[scheduled-crawl] Inline vibe error for ${prop.id}:`, e);
            }
          }
          console.log(`[scheduled-crawl] Inline vibe: ${vibeAnalyzed}/${toAnalyze.length} analyzed`);
        }
      }
    }

    const duration = Date.now() - startTime;

    const summary = {
      duration: `${duration}ms`,
      target: bestTarget,
      newListings,
      updatedListings,
      duplicatesSkipped,
      filtered,
      vibeAnalyzed,
      directSaveMode: true,
      scrapeCompleted: !!scrapeResult?.success,
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
