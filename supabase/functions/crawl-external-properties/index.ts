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
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

// Popular locations to crawl periodically
const POPULAR_LOCATIONS: Record<string, string[]> = {
  ho_chi_minh: ['D1', 'D2', 'D3', 'D4', 'D5', 'D7', 'D10', 'Binh Thanh', 'Phu Nhuan', 'Tan Binh', 'Go Vap', 'Thu Duc'],
  hanoi: ['Ba Dinh', 'Hoan Kiem', 'Dong Da', 'Cau Giay', 'Hai Ba Trung'],
  da_nang: ['Hai Chau', 'Thanh Khe', 'Son Tra', 'Ngu Hanh Son', 'Lien Chieu', 'Cam Le'],
};

interface ProjectTarget {
  name: string;
  district?: string;
  aliases?: string[];
}

interface CrawlRequest {
  locations?: string[];
  // Optional: project-targeted crawl. When provided, the function loops over
  // projects (one per call) and uses the project name as the marketplace
  // search keyword, with district as the URL location.
  projects?: ProjectTarget[];
  marketplaces?: ('batdongsan' | 'nhatot' | 'airbnb')[];
  city?: 'ho_chi_minh' | 'hanoi';
  forceRefresh?: boolean;
  storeInDatabase?: boolean;
  runVibeAnalysis?: boolean;
  maxListingsPerLocation?: number;
  // VND/month floor. Applied as scrape-marketplace `minPrice` and as a
  // post-scrape safety filter (keep listings >= minPriceVnd).
  minPriceVnd?: number;
}

// Strip Vietnamese diacritics for case+accent-insensitive matching
function stripDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
}

// Generic / common words we strip when generating loose token-based fallbacks,
// so a project like "The Botanica" still matches "Botanica Premier" listings.
const PROJECT_STOPWORDS = new Set([
  'the', 'city', 'park', 'garden', 'residence', 'residences', 'tower', 'towers',
  'apartment', 'apartments', 'home', 'homes', 'plaza', 'pearl', 'house',
  'view', 'sky', 'place', 'point', 'hill', 'gate', 'valley', 'heights',
  'premium', 'premier', 'thu', 'duc', 'thao', 'dien', 'an', 'phu', 'phú',
  'saigon', 'sai', 'gon', 'hcm', 'hochiminh', 'tphcm', 'q1', 'q2', 'q7',
]);

function projectMatchesProperty(project: ProjectTarget, prop: any): boolean {
  const haystack = stripDiacritics(
    `${prop.title || ''} ${prop.description || ''} ${prop.location || ''}`
  ).toLowerCase();
  const needles = [project.name, ...(project.aliases || [])]
    .map(n => stripDiacritics(n).toLowerCase().trim())
    .filter(Boolean);

  // 1) Strict: full name/alias substring match.
  if (needles.some(n => haystack.includes(n))) return true;

  // 2) Loose fallback: at least one *distinctive* token from the project name
  //    (3+ chars, not a stopword) appears in the haystack. Catches partial
  //    mentions like "Vinhomes Central" or "Masteri" without name suffix.
  const distinctiveTokens = new Set<string>();
  for (const n of needles) {
    for (const tok of n.split(/[\s\-_/.,]+/)) {
      if (tok.length >= 4 && !PROJECT_STOPWORDS.has(tok)) {
        distinctiveTokens.add(tok);
      }
    }
  }
  // Need at least one distinctive token to even attempt loose match —
  // otherwise we'd over-match generic names.
  if (distinctiveTokens.size === 0) return false;
  return Array.from(distinctiveTokens).some(t => haystack.includes(t));
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

// Inline geocoding for crawled properties using Nominatim
async function geocodeLocation(location: string): Promise<{ lat: number; lon: number } | null> {
  let cleaned = location;
  cleaned = cleaned.replace(/\bHo Chi Minh City\b/gi, 'Hồ Chí Minh');
  cleaned = cleaned.replace(/\bHo Chi Minh\b/gi, 'Hồ Chí Minh');
  cleaned = cleaned.replace(/\bDa Nang City\b/gi, 'Đà Nẵng');
  cleaned = cleaned.replace(/\bDa Nang\b/gi, 'Đà Nẵng');
  cleaned = cleaned.replace(/\bHanoi\b/gi, 'Hà Nội');
  cleaned = cleaned.replace(/\bDistrict\s*(\d+)/gi, 'Quận $1');
  cleaned = cleaned.replace(/\bWard\b/gi, 'Phường');
  cleaned = cleaned.replace(/\bStreet\b/gi, '');

  const queries = cleaned !== location ? [cleaned, location] : [location];

  for (const q of queries) {
    try {
      const encoded = encodeURIComponent(q);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=vn&limit=3&addressdetails=1`,
        { headers: { "User-Agent": "Hausto-App/1.0" } }
      );
      const data = await res.json();
      if (data && data.length > 0) {
        const best = data.find((r: any) =>
          r.class === 'boundary' || (r.class === 'place' && r.type === 'suburb')
        ) || data.find((r: any) =>
          r.addresstype === 'suburb' || r.addresstype === 'city_district'
        ) || data[0];
        return { lat: parseFloat(best.lat), lon: parseFloat(best.lon) };
      }
    } catch {
      continue;
    }
  }
  return null;
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

// ─── Image URL Filtering (reject videos, unrelated content) ──────
function isValidPropertyImageUrl(url: string): boolean {
  if (!url || !url.startsWith('http')) return false;
  const lower = url.toLowerCase();
  if (/\.(mp4|avi|mov|wmv|flv|mkv|webm|m3u8|ts)(\?|$)/i.test(lower)) return false;
  if (lower.includes('/video/') || lower.includes('/videos/')) return false;
  if (/\b(logo|icon|avatar|sprite|placeholder|banner|ads?|advert|tracking|pixel|badge|button)\b/i.test(lower)) return false;
  if (/\b(facebook|twitter|zalo|share|social|og-image)\b/i.test(lower)) return false;
  if (/\/\d{1,2}x\d{1,2}\//i.test(lower)) return false;
  if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(lower) && !lower.includes('batdongsan.com.vn') && !lower.includes('nhatot.com')) return false;
  return true;
}

// Analyze property images using OpenAI Vision (prefer OpenAI, fallback Gemini)
async function analyzePropertyImagesVibe(images: string[]): Promise<{
  vibe: string;
  vibe_analysis: Record<string, any>;
  highlights: string[];
  amenities: string[];
} | null> {
  if (!OPENAI_API_KEY && !LOVABLE_API_KEY) {
    if (!images || images.length === 0) return null;
    console.warn('[vibe-analysis] No AI API key configured');
    return null;
  }
  if (!images || images.length === 0) return null;
  
  try {
    // Use up to 5 images, filter invalid URLs
    const imagesToAnalyze = images.filter(img => isValidPropertyImageUrl(img)).slice(0, 5);
    if (imagesToAnalyze.length === 0) return null;
    
    console.log(`[vibe-analysis] Analyzing ${imagesToAnalyze.length} images with per-image highlights...`);
    
    // Build image content array for vision API
    const imageContent = [];
    const validImageIndexes: number[] = [];
    for (let imgIdx = 0; imgIdx < imagesToAnalyze.length; imgIdx++) {
      const imageUrl = imagesToAnalyze[imgIdx];
      try {
        const imgResponse = await fetch(imageUrl);
        if (!imgResponse.ok) continue;
        
        const contentType = imgResponse.headers.get('content-type') || '';
        // Skip non-image content types
        if (!contentType.includes('image/')) {
          console.log(`[vibe-analysis] Skipping non-image content-type: ${contentType} for ${imageUrl}`);
          continue;
        }
        
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
        validImageIndexes.push(imgIdx);
      } catch (e) {
        console.error(`[vibe-analysis] Failed to fetch image:`, e);
      }
    }
    
    if (imageContent.length === 0) return null;
    
    // Prefer OpenAI, fallback to Lovable Gateway
    const apiUrl = OPENAI_API_KEY ? 'https://api.openai.com/v1/chat/completions' : AI_GATEWAY_URL;
    const apiKey = OPENAI_API_KEY || LOVABLE_API_KEY;
    const model = OPENAI_API_KEY ? 'gpt-4o-mini' : 'google/gemini-2.5-flash';
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze these ${imageContent.length} rental property images. For EACH image, provide a unique lifestyle highlight.

Return a JSON object with:

1. vibe_scores (1-10): modern, cozy, luxurious, minimalist, spacious, natural_light, urban, elegant
2. style: One of [Modern, Cozy, Industrial, Bohemian, Scandinavian, Minimalist, Contemporary, Traditional, Rustic, Luxury, Urban, Vintage]
3. colors: Array from [Neutral, Warm, Cool, Bright, Dark, Colorful, Natural, White, Earth, Bold]
4. activities: Array from [Working, Reading, Relaxing, Entertaining, Cooking, Exercising]
5. image_analyses: Array with one entry PER IMAGE (in order), each containing:
   - image_index: the 0-based index of the image
   - image_highlight: A short lifestyle highlight specific to THIS image (e.g., "Sun-drenched living room with panoramic city views", "Sleek modern kitchen with marble countertops")
   - suggested_amenities: Array of amenities visible in THIS specific image
6. amenities: Array of ALL visible PHYSICAL amenities/features across all images IN ENGLISH. Only include tangible items (appliances, fixtures, furniture, facilities). Do NOT include: deposit info, rental terms, apartment type, room count, price, floor number, or any non-physical attribute

Return ONLY valid JSON:
{
  "vibe_scores": {"modern": 8, "cozy": 6, "luxurious": 5, "minimalist": 7, "spacious": 6, "natural_light": 8, "urban": 7, "elegant": 6},
  "style": "Modern",
  "colors": ["Neutral", "White"],
  "activities": ["Working", "Relaxing"],
  "image_analyses": [
    {"image_index": 0, "image_highlight": "Bright open-plan living area with floor-to-ceiling windows", "suggested_amenities": ["Air Conditioning", "Balcony"]},
    {"image_index": 1, "image_highlight": "Fully equipped modern kitchen with breakfast bar", "suggested_amenities": ["Dishwasher", "Microwave"]}
  ],
  "amenities": ["Air Conditioning", "WiFi", "Balcony"]
}`
            },
            ...imageContent,
          ]
        }],
        max_tokens: 1200,
        temperature: 0.3,
      }),
    });
    
    if (!response.ok) {
      console.error('[vibe-analysis] AI error:', await response.text());
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
    
    // Map image_analyses indexes back to original image array indexes
    const imageAnalyses = Array.isArray(parsed.image_analyses) 
      ? parsed.image_analyses.map((ia: any, idx: number) => ({
          ...ia,
          image_index: validImageIndexes[idx] ?? idx,
        }))
      : [];
    
    // Build positional highlights array: one highlight per image (up to 5)
    const totalImages = imagesToAnalyze.length;
    const perImageHighlights: string[] = new Array(totalImages).fill('');
    
    for (const ia of imageAnalyses) {
      const idx = ia.image_index;
      if (idx >= 0 && idx < totalImages && ia.image_highlight && typeof ia.image_highlight === 'string') {
        perImageHighlights[idx] = ia.image_highlight;
      }
    }
    
    // Fill any gaps with a generic highlight based on vibe
    const fallbackLabel = primaryVibe || parsed.style || 'Modern';
    for (let i = 0; i < perImageHighlights.length; i++) {
      if (!perImageHighlights[i]) {
        perImageHighlights[i] = `${fallbackLabel} living space feature`;
      }
    }
    
    return {
      vibe: fallbackLabel,
      vibe_analysis: {
        style: parsed.style,
        colors: parsed.colors || [],
        activities: parsed.activities || [],
        amenities: parsed.amenities || [],
        vibe_scores: vibeScores,
        image_analyses: imageAnalyses,
      },
      highlights: perImageHighlights,
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
  const newlyInsertedIds: string[] = []; // Track IDs for deterministic backfill
  try {
  // Authenticate the caller
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  console.log(`[crawl-external-properties] Authenticated user: ${claimsData.claims.sub}`);

  const body: CrawlRequest = await req.json();
    const { 
      locations = [], 
      projects = [],
      marketplaces = ['batdongsan', 'nhatot'],
      city = 'ho_chi_minh',
      forceRefresh = false,
      storeInDatabase = true,
      runVibeAnalysis = true,
      maxListingsPerLocation = 10,
      minPriceVnd,
    } = body;
    
    const isProjectMode = Array.isArray(projects) && projects.length > 0;

    console.log(`[crawl-external-properties] Starting crawl:`, { mode: isProjectMode ? 'project' : 'location', locations, projectsCount: projects.length, marketplaces, city, forceRefresh, storeInDatabase, maxListingsPerLocation, minPriceVnd });
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // PROJECT MODE: process one project per call (client drains via remainingProjects).
    // LOCATION MODE: process one location per call (existing behavior).
    let activeProject: ProjectTarget | null = null;
    let location: string;
    let remainingLocations: string[] = [];
    let remainingProjects: ProjectTarget[] = [];

    if (isProjectMode) {
      activeProject = projects[0];
      remainingProjects = projects.slice(1);
      // Use the project's district as the URL location (so marketplace URL builders
      // resolve cleanly); project name is sent as the search keyword below.
      location = activeProject.district || '';
    } else {
      const locationsToScrape = locations.length > 0 ? locations : POPULAR_LOCATIONS[city] || POPULAR_LOCATIONS.ho_chi_minh;
      location = locationsToScrape[0];
      remainingLocations = locationsToScrape.slice(1);
    }
    
    console.log(`[crawl-external-properties] Processing ${isProjectMode ? `project="${activeProject?.name}" district="${location}"` : `location="${location}"`}, ${isProjectMode ? remainingProjects.length : remainingLocations.length} remaining`);
    
    for (const marketplace of marketplaces) {
        const crawlResult: CrawlResult = {
          location: isProjectMode && activeProject
            ? `${activeProject.name} · ${activeProject.district}`
            : location,
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
              query: isProjectMode ? activeProject!.name : 'căn hộ chung cư cho thuê',
              location,
              includeVibeAnalysis: true,
              maxResults: maxListingsPerLocation,
              ...(minPriceVnd ? { minPrice: minPriceVnd } : {}),
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

          // Project-mode post-filter: keep only listings whose text contains
          // the project name or any alias. Also enforce max price as a safety net.
          let filteredProperties = scrapeData.properties as any[];
          if (isProjectMode && activeProject) {
            const before = filteredProperties.length;
            filteredProperties = filteredProperties.filter((p: any) => projectMatchesProperty(activeProject!, p));
            console.log(`[crawl-external-properties] Project filter "${activeProject.name}": ${filteredProperties.length}/${before} kept`);
          }
          if (minPriceVnd) {
            const before = filteredProperties.length;
            filteredProperties = filteredProperties.filter((p: any) => !p.price || Number(p.price) >= minPriceVnd);
            if (before !== filteredProperties.length) {
              console.log(`[crawl-external-properties] Price filter >= ${minPriceVnd}: ${filteredProperties.length}/${before} kept`);
            }
          }
          
          crawlResult.propertiesFound = filteredProperties.length;
          console.log(`[crawl-external-properties] Found ${filteredProperties.length} properties for ${location}/${marketplace}`);
          
          // Store in database if requested
          if (storeInDatabase) {
            for (const property of filteredProperties) {
              try {
                const locationNormalized = normalizeLocation(property.location || location);
                const detectedCity = detectCity(property.location || location);
                const rawSourceUrl = property.sourceUrl || `https://${marketplace}.com.vn`;
                const normalizedUrl = normalizeSourceUrl(rawSourceUrl);

                // Geocode the property location (with rate limiting)
                let geoLat: number | null = null;
                let geoLon: number | null = null;
                try {
                  await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit
                  const coords = await geocodeLocation(property.location || location);
                  if (coords) {
                    geoLat = coords.lat;
                    geoLon = coords.lon;
                  }
                } catch (geoErr) {
                  console.error(`[crawl-external-properties] Geocoding failed for "${property.location}":`, geoErr);
                }
                
                // Create deterministic external_id from normalized URL
                const externalId = property.sourceUrl 
                  ? btoa(normalizedUrl).substring(0, 100)
                  : `${marketplace}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                
                // Check if this property already exists by normalized source_url
                const { data: existingByUrl } = await supabase
                  .from('external_properties')
                  .select('id, external_id, source_url, vibe_analysis, images')
                  .eq('source', marketplace)
                  .eq('source_url', normalizedUrl)
                  .maybeSingle();
                
                // Also check by external_id for backward compat
                const { data: existingById } = !existingByUrl ? await supabase
                  .from('external_properties')
                  .select('id, external_id, source_url, vibe_analysis, images')
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
                      amenities: property.amenities || [],
                      images: (property.images || []).filter((img: string) => isValidPropertyImageUrl(img)).slice(0, 5),
                      contact_name: property.sourceProviderName || null,
                      contact_phone: property.sourceProviderPhone || null,
                      crawled_at: new Date().toISOString(),
                      expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
                      is_active: true,
                      ...(geoLat !== null && geoLon !== null ? { latitude: geoLat, longitude: geoLon } : {}),
                    })
                    .eq('id', existingRecord.id);
                  
                  if (updateError) {
                    console.error(`[crawl-external-properties] Update error:`, updateError);
                  } else {
                    crawlResult.updatedListings++;
                    crawlResult.propertiesStored++;
                    console.log(`[crawl-external-properties] Updated existing: "${property.title}"`);
                  }

                  // Run vibe analysis for existing listings that lack image-based analysis
                  const existingVibe = existingRecord.vibe_analysis as Record<string, any> | null;
                  const hasImageAnalysis = Array.isArray(existingVibe?.image_analyses) && existingVibe.image_analyses.length > 0;
                  const existingImages = existingRecord.images as string[] | null;
                  
                  if (runVibeAnalysis && !hasImageAnalysis && existingImages && existingImages.length > 0) {
                    try {
                      console.log(`[crawl-external-properties] Existing listing missing image-based vibe, running analysis for "${property.title}"`);
                      const vibeResult = await analyzePropertyImagesVibe(existingImages);
                      if (vibeResult) {
                        await supabase
                          .from('external_properties')
                          .update({
                            vibe: vibeResult.vibe,
                            vibe_analysis: vibeResult.vibe_analysis,
                            highlights: vibeResult.highlights.length > 0 ? vibeResult.highlights : undefined,
                            amenities: vibeResult.amenities.length > 0 ? vibeResult.amenities : undefined,
                          })
                          .eq('id', existingRecord.id);
                        crawlResult.vibeAnalyzed++;
                        console.log(`[crawl-external-properties] Backfilled vibe for existing: "${property.title}"`);
                      }
                    } catch (vibeErr) {
                      console.error(`[crawl-external-properties] Vibe backfill error:`, vibeErr);
                    }
                    await new Promise(r => setTimeout(r, 500));
                  }

                  continue;
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
                  images: (property.images || []).filter((img: string) => isValidPropertyImageUrl(img)).slice(0, 5),
                  contact_name: property.sourceProviderName || null,
                  contact_phone: property.sourceProviderPhone || null,
                  vibe: property.vibe || null,
                  vibe_analysis: property.vibe_analysis || {},
                  crawled_at: new Date().toISOString(),
                  expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
                  is_active: true,
                  ...(geoLat !== null && geoLon !== null ? { latitude: geoLat, longitude: geoLon } : {}),
                };
                
                const { data: insertedRows, error: insertError } = await supabase
                  .from('external_properties')
                  .insert(propertyData)
                  .select('id');
                
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
                  if (insertedRows?.[0]?.id) {
                    newlyInsertedIds.push(insertedRows[0].id);
                  }
                  
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

    // ── Deterministic backfill: check which new listings still lack image highlights ──
    let backfillTriggered = 0;
    if (newlyInsertedIds.length > 0) {
      // Check which newly inserted properties are missing image_analyses
      const { data: needsHighlights } = await supabase
        .from('external_properties')
        .select('id, vibe_analysis')
        .in('id', newlyInsertedIds);

      const missingIds = (needsHighlights || [])
        .filter((p: any) => {
          const analyses = p.vibe_analysis?.image_analyses;
          return !analyses || !Array.isArray(analyses) || analyses.length === 0;
        })
        .map((p: any) => p.id);

      if (missingIds.length > 0) {
        console.log(`[crawl-external-properties] ${missingIds.length}/${newlyInsertedIds.length} new listings still need image highlights, firing backfill...`);
        try {
          // Fire-and-forget call to backfill-image-highlights with specific IDs
          fetch(`${SUPABASE_URL}/functions/v1/backfill-image-highlights`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ property_ids: missingIds }),
          }).catch(err => console.error('[crawl-external-properties] Backfill call failed:', err));
          backfillTriggered = missingIds.length;
        } catch (e) {
          console.error('[crawl-external-properties] Failed to trigger backfill:', e);
        }
      } else {
        console.log(`[crawl-external-properties] All ${newlyInsertedIds.length} new listings already have image highlights`);
      }
    }
    
    const duration = Date.now() - startTime;
    
    console.log(`[crawl-external-properties] Completed in ${duration}ms:`, {
      totalFound, totalStored, totalNew, totalUpdated, totalDuplicatesSkipped, totalVibeAnalyzed, totalSkipped, totalErrors, backfillTriggered,
    });
    
    return new Response(JSON.stringify({
      success: true,
      summary: {
        duration: `${duration}ms`,
        mode: isProjectMode ? 'project' : 'location',
        locationProcessed: isProjectMode ? `${activeProject?.name} (${location})` : location,
        projectProcessed: isProjectMode ? activeProject?.name : undefined,
        remainingLocations,
        remainingProjects,
        marketplacesProcessed: marketplaces.length,
        totalFound,
        totalStored,
        totalNew,
        totalUpdated,
        totalDuplicatesSkipped,
        totalVibeAnalyzed,
        totalSkipped,
        totalErrors,
        backfillTriggered,
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
