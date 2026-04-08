import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CACHE_TTL = 60 * 60 * 2; // 2 hours
const MAX_DETAIL_PAGES = 10; // Max individual listings to scrape
const DETAIL_SCRAPE_TIMEOUT = 15000; // 15s per detail page

// ─── Data Safety Helpers ─────────────────────────────────────────
function toSafeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (typeof value === 'string' && value.trim()) return value.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function sanitizeVibeAnalysis(va: Record<string, unknown>): Record<string, unknown> {
  return {
    ...va,
    styles: toSafeArray(va.styles ?? va.style),
    colors: toSafeArray(va.colors),
    activities: toSafeArray(va.activities),
  };
}

// ─── Direct Save Helpers (for scheduled crawl mode) ─────────────
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

// Extract canonical listing ID from marketplace URLs
// batdongsan: "...-pr12345678" → "pr12345678"
// nhatot: ".../123456.htm" → "nt123456"
function extractListingId(url: string, marketplace: string): string | null {
  try {
    if (marketplace === 'batdongsan') {
      const match = url.match(/-pr(\d+)/i);
      if (match) return `pr${match[1]}`;
    }
    if (marketplace === 'nhatot') {
      const match = url.match(/\/(\d{5,})\.htm/i);
      if (match) return `nt${match[1]}`;
    }
    if (marketplace === 'airbnb') {
      const match = url.match(/\/rooms\/(\d+)/i);
      if (match) return `ab${match[1]}`;
    }
  } catch { /* ignore */ }
  return null;
}

function normalizeLocationText(location: string): string {
  return location.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ─── AI Call Helper (prefer OpenAI, fallback Gemini via Gateway) ──
async function callAI(messages: { role: string; content: any }[], maxTokens: number = 2000, temperature: number = 0.2): Promise<string | null> {
  // Prefer OpenAI
  if (OPENAI_API_KEY) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          max_tokens: maxTokens,
          temperature,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content || null;
      }
      console.warn('[callAI] OpenAI error:', response.status, await response.text());
    } catch (e) {
      console.warn('[callAI] OpenAI failed:', e);
    }
  }
  
  // Fallback to Lovable Gateway with Gemini 2.5 Flash
  if (LOVABLE_API_KEY) {
    try {
      const response = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages,
          max_tokens: maxTokens,
          temperature,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content || null;
      }
      console.warn('[callAI] Gateway error:', response.status);
    } catch (e) {
      console.warn('[callAI] Gateway failed:', e);
    }
  }
  
  return null;
}

// ─── Image URL Filtering (reject videos, unrelated content) ──────
function isValidPropertyImageUrl(url: string): boolean {
  if (!url || !url.startsWith('http')) return false;
  const lower = url.toLowerCase();
  // Reject video formats
  if (/\.(mp4|avi|mov|wmv|flv|mkv|webm|m3u8|ts)(\?|$)/i.test(lower)) return false;
  // Reject non-image content
  if (lower.includes('/video/') || lower.includes('/videos/')) return false;
  // Reject logos, icons, avatars, sprites, placeholders
  if (/\b(logo|icon|avatar|sprite|placeholder|banner|ads?|advert|tracking|pixel|badge|button)\b/i.test(lower)) return false;
  // Reject social media / sharing images
  if (/\b(facebook|twitter|zalo|share|social|og-image)\b/i.test(lower)) return false;
  // Reject very small images (likely icons/thumbnails)
  if (/\/\d{1,2}x\d{1,2}\//i.test(lower)) return false;
  // Must have an image extension or be from known image CDN
  if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(lower) && !lower.includes('batdongsan.com.vn') && !lower.includes('nhatot.com')) return false;
  return true;
}

// ─── Batdongsan Image URL Normalization ──────────────────────────
// Convert thumbnail/crop URLs to full-size and extract gallery images
function normalizeBatdongsanImageUrl(url: string): string {
  // Convert crop/WxH/ to resize/1275x717/ for full-size images
  return url
    .replace(/\/crop\/\d+x\d+\//i, '/resize/1275x717/')
    .replace(/\/resize\/\d+x\d+\//i, '/resize/1275x717/');
}

function extractBatdongsanGalleryImages(html: string): string[] {
  const images: string[] = [];
  
  // Pattern 1: Extract from image gallery data attributes and src
  const galleryPatterns = [
    // Full-size images in data attributes
    /data-(?:src|original|lazy-src)=["'](https:\/\/file\d+\.batdongsan\.com\.vn\/[^"']+)["']/gi,
    // Standard img src
    /src=["'](https:\/\/file\d+\.batdongsan\.com\.vn\/(?:resize|crop)\/[^"']+)["']/gi,
    // Background images
    /url\(["']?(https:\/\/file\d+\.batdongsan\.com\.vn\/[^"')]+)["']?\)/gi,
  ];
  
  for (const regex of galleryPatterns) {
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (match[1]) images.push(match[1]);
    }
  }
  
  // Deduplicate by base filename (ignore resize/crop differences)
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const img of images) {
    const base = img.replace(/\/(resize|crop)\/\d+x\d+\//i, '/NORM/');
    if (!seen.has(base)) {
      seen.add(base);
      unique.push(normalizeBatdongsanImageUrl(img));
    }
  }
  
  // Filter out logos, icons, avatars
  return unique.filter(img =>
    !img.includes('logo') && !img.includes('icon') && !img.includes('avatar') &&
    !img.includes('sprite') && !img.includes('placeholder') &&
    img.match(/\.(jpg|jpeg|png|webp)/i)
  );
}

function detectCity(location: string): string {
  const lower = location.toLowerCase();
  if (/(ho chi minh|hcm|saigon|sài gòn|thủ đức|thu duc|quận [0-9]|quan [0-9]|district [0-9]|d[0-9]|bình thạnh|binh thanh|phú nhuận|phu nhuan|tân bình|tan binh|gò vấp|go vap|tân phú|tan phu|bình tân|binh tan|bình chánh|binh chanh|nhà bè|nha be|hóc môn|hoc mon|củ chi|cu chi|cần giờ|can gio)/i.test(lower)) return 'ho_chi_minh';
  if (/(hà nội|ha noi|hanoi|ba đình|ba dinh|hoàn kiếm|hoan kiem|đống đa|dong da|cầu giấy|cau giay|hai bà trưng|hai ba trung|tây hồ|tay ho|long biên|long bien|thanh xuân|thanh xuan|hoàng mai|hoang mai|bắc từ liêm|nam từ liêm|hà đông|ha dong|gia lâm|gia lam|đông anh|dong anh|sóc sơn|soc son|thanh trì|thanh tri|hoài đức|hoai duc|mê linh|me linh|sơn tây|son tay)/i.test(lower)) return 'hanoi';
  if (/(đà nẵng|da nang|hải châu|hai chau|thanh khê|thanh khe|sơn trà|son tra|ngũ hành sơn|ngu hanh son|liên chiểu|lien chieu|cẩm lệ|cam le|hòa vang|hoa vang)/i.test(lower)) return 'da_nang';
  return 'other';
}

async function savePropertiesToDB(
  properties: ExternalProperty[],
  marketplace: string,
  fallbackLocation: string,
): Promise<{ newListings: number; updatedListings: number; duplicatesSkipped: number; filtered: number }> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let newListings = 0, updatedListings = 0, duplicatesSkipped = 0, filtered = 0;

  for (const property of properties) {
    try {
      const check = isSuspiciousListing(property);
      if (check.suspicious) {
        filtered++;
        console.log(`[directSave] Filtered: ${property.title?.substring(0, 40)} - ${check.reason}`);
        continue;
      }

      const locationNormalized = normalizeLocationText(property.location || fallbackLocation);
      const detectedCity = detectCity(property.location || fallbackLocation);
      const rawSourceUrl = property.sourceUrl || `https://${marketplace}.com.vn`;
      const normalizedUrl = normalizeSourceUrl(rawSourceUrl);
      const canonicalId = extractListingId(rawSourceUrl, marketplace);
      const externalId = canonicalId
        || (property.sourceUrl
          ? btoa(normalizedUrl).substring(0, 100)
          : `${marketplace}-${Date.now()}-${Math.random().toString(36).substring(7)}`);

      // Check for existing
      const { data: existingByUrl } = await supabase
        .from('external_properties')
        .select('id, vibe_analysis')
        .eq('source', marketplace)
        .eq('source_url', normalizedUrl)
        .maybeSingle();

      const { data: existingById } = !existingByUrl ? await supabase
        .from('external_properties')
        .select('id, vibe_analysis')
        .eq('source', marketplace)
        .eq('external_id', externalId)
        .maybeSingle() : { data: existingByUrl };

      const existing = existingByUrl || existingById;
      const now = new Date().toISOString();

      const propertyData = {
        title: property.title || 'Rental Property',
        location: property.location || fallbackLocation,
        location_normalized: locationNormalized,
        city: detectedCity,
        price: property.price || 0,
        price_display: property.priceDisplay || `${property.price?.toLocaleString()} VND`,
        size: property.size || null,
        rooms: property.rooms || null,
        description: property.description || null,
        highlights: property.highlights || [],
        amenities: property.amenities || [],
        images: (property.images || []).filter(isValidPropertyImageUrl).slice(0, 5),
        contact_name: property.sourceProviderName || null,
        contact_phone: property.sourceProviderPhone || null,
        vibe: property.vibe || null,
        vibe_analysis: sanitizeVibeAnalysis(property.vibe_analysis || {}),
        is_active: true,
      };

      if (existing) {
        // Preserve existing vibe_analysis and highlights if they have image-based data
        const existingVibe = existing.vibe_analysis as Record<string, any> | null;
        const hasExistingImageAnalysis = Array.isArray(existingVibe?.image_analyses) && existingVibe.image_analyses.length > 0;
        
        const updateData: Record<string, any> = {
          ...propertyData,
          last_verified_at: now,
          updated_at: now,
          expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        };
        
        // Don't overwrite good vibe data with empty scrape data
        if (hasExistingImageAnalysis) {
          delete updateData.vibe_analysis;
          delete updateData.highlights;
          delete updateData.vibe;
        }
        
        await supabase
          .from('external_properties')
          .update(updateData)
          .eq('id', existing.id);
        updatedListings++;
      } else {
        const { error: insertError } = await supabase
          .from('external_properties')
          .insert({
            ...propertyData,
            external_id: externalId,
            source: marketplace,
            source_url: normalizedUrl,
            crawled_at: now,
            expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          });

        if (insertError) {
          if (insertError.code === '23505') {
            duplicatesSkipped++;
          } else {
            console.error('[directSave] Insert error:', insertError);
          }
        } else {
          newListings++;
          console.log(`[directSave] New listing saved: ${property.title?.substring(0, 50)}`);
        }
      }
    } catch (e) {
      console.error('[directSave] Error:', e);
    }
  }

  return { newListings, updatedListings, duplicatesSkipped, filtered };
}

// ─── Redis Helpers ───────────────────────────────────────────────
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

// ─── Types ───────────────────────────────────────────────────────
interface ExternalProperty {
  id: string;
  title: string;
  location: string;
  price: number;
  priceDisplay: string;
  size: string;
  rooms: string;
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
  maxResults?: number;
}

interface ListingLink {
  url: string;
  title?: string;
  price?: string;
}

// ─── URL Building ────────────────────────────────────────────────
const PAGES_TO_SCRAPE = 3; // Scrape pages 1-3 of search results

function stripDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
}

function buildSearchUrl(params: SearchParams, page: number = 1): string {
  const { marketplace, query, location } = params;
  
  // Strip diacritics early so all lookups work with ASCII keys
  const locationAscii = location ? stripDiacritics(location).toLowerCase().trim() : '';
  
  const normalizedLocation = locationAscii
    .replace(/district\s*/i, 'quan-')
    .replace(/d(\d+)/i, 'quan-$1')
    .replace(/\s+/g, '-');
  
  const isHanoi = /(ha noi|hanoi|ba dinh|hoan kiem|dong da|cau giay|hai ba trung)/i.test(locationAscii);
  const isDaNang = /(da nang|hai chau|thanh khe|son tra|ngu hanh son|lien chieu|cam le)/i.test(locationAscii);
  const citySlug = isHanoi ? 'ha-noi' : isDaNang ? 'da-nang' : 'tp-hcm';
  const nhatotCity = isHanoi ? 'ha-noi' : isDaNang ? 'da-nang' : 'tp-ho-chi-minh';
  const airbnbCity = isHanoi ? 'Hanoi--Vietnam' : isDaNang ? 'Da-Nang--Vietnam' : 'Ho-Chi-Minh-City--Vietnam';
  
  switch (marketplace) {
    case 'batdongsan': {
      // Batdongsan district slug mappings (ASCII keys → URL slugs)
      const bdsDistrictMappings: Record<string, string> = {
        'quan 1': 'quan-1', 'quan 3': 'quan-3', 'quan 4': 'quan-4',
        'quan 5': 'quan-5', 'quan 6': 'quan-6', 'quan 7': 'quan-7',
        'quan 8': 'quan-8', 'quan 10': 'quan-10', 'quan 11': 'quan-11',
        'quan 12': 'quan-12',
        'binh thanh': 'quan-binh-thanh', 'phu nhuan': 'quan-phu-nhuan',
        'tan binh': 'quan-tan-binh', 'tan phu': 'quan-tan-phu',
        'go vap': 'quan-go-vap', 'binh tan': 'quan-binh-tan',
        'thu duc': 'thanh-pho-thu-duc', 'nha be': 'huyen-nha-be',
        'binh chanh': 'huyen-binh-chanh', 'hoc mon': 'huyen-hoc-mon',
        'cu chi': 'huyen-cu-chi', 'can gio': 'huyen-can-gio',
        // Hanoi
        'ba dinh': 'quan-ba-dinh', 'hoan kiem': 'quan-hoan-kiem',
        'dong da': 'quan-dong-da', 'cau giay': 'quan-cau-giay',
        'hai ba trung': 'quan-hai-ba-trung', 'tay ho': 'quan-tay-ho',
        'long bien': 'quan-long-bien', 'thanh xuan': 'quan-thanh-xuan',
        'hoang mai': 'quan-hoang-mai', 'bac tu liem': 'quan-bac-tu-liem',
        'nam tu liem': 'quan-nam-tu-liem', 'ha dong': 'quan-ha-dong',
        'gia lam': 'huyen-gia-lam', 'dong anh': 'huyen-dong-anh',
        'soc son': 'huyen-soc-son', 'thanh tri': 'huyen-thanh-tri',
        'hoai duc': 'huyen-hoai-duc', 'thanh oai': 'huyen-thanh-oai',
        'thuong tin': 'huyen-thuong-tin', 'me linh': 'huyen-me-linh',
        'chuong my': 'huyen-chuong-my', 'dan phuong': 'huyen-dan-phuong',
        'phuc tho': 'huyen-phuc-tho', 'quoc oai': 'huyen-quoc-oai',
        'thach that': 'huyen-thach-that', 'ba vi': 'huyen-ba-vi',
        'son tay': 'thi-xa-son-tay', 'phu xuyen': 'huyen-phu-xuyen',
        'ung hoa': 'huyen-ung-hoa', 'my duc': 'huyen-my-duc',
        // Da Nang
        'hai chau': 'quan-hai-chau', 'thanh khe': 'quan-thanh-khe',
        'son tra': 'quan-son-tra', 'ngu hanh son': 'quan-ngu-hanh-son',
        'lien chieu': 'quan-lien-chieu', 'cam le': 'quan-cam-le',
        'hoa vang': 'huyen-hoa-vang', 'hoang sa': 'huyen-hoang-sa',
      };

      let districtSlug = bdsDistrictMappings[locationAscii];
      if (!districtSlug && normalizedLocation.includes('quan-')) {
        districtSlug = normalizedLocation;
      }

      let baseUrl: string;
      if (districtSlug) {
        baseUrl = `https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-${districtSlug}-${citySlug}`;
      } else if (locationAscii) {
        baseUrl = `https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-${citySlug}?keyword=${encodeURIComponent(location || query)}`;
      } else {
        baseUrl = `https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-${citySlug}`;
      }
      if (page > 1) {
        return baseUrl.includes('?')
          ? `${baseUrl}&page=${page}`
          : `${baseUrl}/p${page}`;
      }
      return baseUrl;
    }
      
    case 'nhatot': {
      const districtMappings: Record<string, string> = {
        'd1': 'quan-1', 'district 1': 'quan-1', 'quan 1': 'quan-1', 'quan-1': 'quan-1',
        'd2': 'quan-2', 'district 2': 'quan-2', 'quan 2': 'quan-2', 'quan-2': 'quan-2',
        'd3': 'quan-3', 'district 3': 'quan-3', 'quan 3': 'quan-3', 'quan-3': 'quan-3',
        'd4': 'quan-4', 'district 4': 'quan-4', 'quan 4': 'quan-4', 'quan-4': 'quan-4',
        'd5': 'quan-5', 'district 5': 'quan-5', 'quan 5': 'quan-5', 'quan-5': 'quan-5',
        'd6': 'quan-6', 'district 6': 'quan-6', 'quan 6': 'quan-6', 'quan-6': 'quan-6',
        'd7': 'quan-7', 'district 7': 'quan-7', 'quan 7': 'quan-7', 'quan-7': 'quan-7',
        'd8': 'quan-8', 'district 8': 'quan-8', 'quan 8': 'quan-8', 'quan-8': 'quan-8',
        'd9': 'quan-9', 'district 9': 'quan-9', 'quan 9': 'quan-9', 'quan-9': 'quan-9',
        'd10': 'quan-10', 'district 10': 'quan-10', 'quan 10': 'quan-10', 'quan-10': 'quan-10',
        'd11': 'quan-11', 'district 11': 'quan-11', 'quan 11': 'quan-11', 'quan-11': 'quan-11',
        'd12': 'quan-12', 'district 12': 'quan-12', 'quan 12': 'quan-12', 'quan-12': 'quan-12',
        'binh thanh': 'quan-binh-thanh', 'quan binh thanh': 'quan-binh-thanh',
        'phu nhuan': 'quan-phu-nhuan', 'quan phu nhuan': 'quan-phu-nhuan',
        'tan binh': 'quan-tan-binh', 'quan tan binh': 'quan-tan-binh',
        'tan phu': 'quan-tan-phu', 'quan tan phu': 'quan-tan-phu',
        'go vap': 'quan-go-vap', 'quan go vap': 'quan-go-vap',
        'binh tan': 'quan-binh-tan', 'quan binh tan': 'quan-binh-tan',
        'thu duc': 'thanh-pho-thu-duc',
        'nha be': 'huyen-nha-be', 'binh chanh': 'huyen-binh-chanh',
        'hoc mon': 'huyen-hoc-mon', 'cu chi': 'huyen-cu-chi', 'can gio': 'huyen-can-gio',
        // Hanoi
        'ba dinh': 'quan-ba-dinh', 'hoan kiem': 'quan-hoan-kiem',
        'dong da': 'quan-dong-da', 'cau giay': 'quan-cau-giay',
        'hai ba trung': 'quan-hai-ba-trung', 'tay ho': 'quan-tay-ho',
        'long bien': 'quan-long-bien', 'thanh xuan': 'quan-thanh-xuan',
        'hoang mai': 'quan-hoang-mai', 'bac tu liem': 'quan-bac-tu-liem',
        'nam tu liem': 'quan-nam-tu-liem', 'ha dong': 'quan-ha-dong',
        'gia lam': 'huyen-gia-lam', 'dong anh': 'huyen-dong-anh',
        'soc son': 'huyen-soc-son', 'thanh tri': 'huyen-thanh-tri',
        'hoai duc': 'huyen-hoai-duc', 'me linh': 'huyen-me-linh',
        'son tay': 'thi-xa-son-tay',
        // Da Nang
        'hai chau': 'quan-hai-chau', 'thanh khe': 'quan-thanh-khe',
        'son tra': 'quan-son-tra', 'ngu hanh son': 'quan-ngu-hanh-son',
        'lien chieu': 'quan-lien-chieu', 'cam le': 'quan-cam-le',
        'hoa vang': 'huyen-hoa-vang',
      };
      
      // Use ASCII-normalized location for lookups
      let nhatotDistrictSlug = districtMappings[locationAscii];
      if (!nhatotDistrictSlug) nhatotDistrictSlug = districtMappings[locationAscii.replace(/\s+/g, '')];
      if (!nhatotDistrictSlug) {
        const districtMatch = locationAscii.match(/\b(d\d+|district\s*\d+|quan\s*\d+|quan-\d+)\b/i);
        if (districtMatch) {
          const m = districtMatch[1].toLowerCase().replace(/\s+/g, '');
          nhatotDistrictSlug = districtMappings[m] || districtMappings[m.replace('district', 'd')];
        }
      }
      if (!nhatotDistrictSlug) {
        for (const [key, slug] of Object.entries(districtMappings)) {
          if (locationAscii.includes(key)) { nhatotDistrictSlug = slug; break; }
        }
      }
      
      if (nhatotDistrictSlug) {
        const base = `https://www.nhatot.com/thue-can-ho-chung-cu-${nhatotDistrictSlug}-${nhatotCity}`;
        return page > 1 ? `${base}?page=${page}` : base;
      }
      if (location) {
        const base = `https://www.nhatot.com/thue-can-ho-chung-cu-${nhatotCity}?q=${encodeURIComponent(location)}`;
        return page > 1 ? `${base}&page=${page}` : base;
      }
      const base = `https://www.nhatot.com/thue-can-ho-chung-cu-${nhatotCity}`;
      return page > 1 ? `${base}?page=${page}` : base;
    }
      
    case 'airbnb': {
      const checkIn = new Date();
      const checkOut = new Date();
      checkOut.setMonth(checkOut.getMonth() + 1);
      const baseAirbnb = `https://www.airbnb.com/s/${airbnbCity}/homes?tab_id=home_tab&refinement_paths%5B%5D=%2Fhomes&flexible_trip_lengths%5B%5D=one_month&monthly_start_date=${checkIn.toISOString().split('T')[0]}&monthly_length=1&query=${encodeURIComponent(query || 'apartment')}`;
      return page > 1 ? `${baseAirbnb}&items_offset=${(page - 1) * 18}` : baseAirbnb;
    }
      
    default:
      return '';
  }
}

// ─── Phase 1: Extract listing URLs from search page ──────────────
async function extractListingUrls(
  markdown: string,
  links: string[],
  marketplace: string,
  maxResultsCap: number = MAX_DETAIL_PAGES
): Promise<ListingLink[]> {
  console.log(`[Phase 1] Extracting listing URLs from ${marketplace} search page (${links.length} links found)`);
  
  // Filter links to property detail pages based on marketplace URL patterns
  const listingPatterns: Record<string, RegExp> = {
    batdongsan: /batdongsan\.com\.vn\/cho-thue-(can-ho|chung-cu|can-ho-chung-cu)[^?#]*-pr\d+/i,
    nhatot: /nhatot\.com\/.*\/\d{6,}\.htm/i,
    airbnb: /airbnb\.com\/rooms\/\d+/i,
  };
  
  const pattern = listingPatterns[marketplace];
  if (!pattern) return [];
  
  const listingUrls = links
    .filter(link => pattern.test(link))
    .map(url => ({ url }));
  
  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = listingUrls.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
  
  console.log(`[Phase 1] Found ${unique.length} unique listing URLs from link extraction`);
  
  // If regex didn't find enough, use AI to extract URLs from markdown
  if (unique.length < 3 && (LOVABLE_API_KEY || OPENAI_API_KEY)) {
    console.log(`[Phase 1] Using AI fallback to find listing URLs...`);
    try {
      const content = await callAI(
        [
          { role: 'system', content: 'Extract individual property listing URLs from search page content. Return JSON only.' },
          { role: 'user', content: `Extract all individual property listing detail page URLs from this ${marketplace} search results page. Only include URLs that lead to INDIVIDUAL property detail pages, not search/filter pages.\n\nAVAILABLE LINKS:\n${links.slice(0, 100).join('\n')}\n\nPAGE CONTENT (first 4000 chars):\n${markdown.substring(0, 4000)}\n\nReturn JSON: {"listings": [{"url": "...", "title": "...", "price": "..."}]}` }
        ],
        2000,
        0.1
      );
      
      if (content) {
        const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        
        for (const listing of (parsed.listings || [])) {
          if (listing.url && !seen.has(listing.url)) {
            seen.add(listing.url);
            unique.push({ url: listing.url, title: listing.title, price: listing.price });
          }
        }
        console.log(`[Phase 1] AI found ${unique.length} total listing URLs`);
      }
    } catch (e) {
      console.error('[Phase 1] AI URL extraction failed:', e);
    }
  }
  
  return unique.slice(0, maxResultsCap);
}

// ─── Firecrawl-based Fetch (bypasses anti-bot protection) ───────
const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

async function firecrawlFetch(url: string): Promise<{ html: string; markdown: string; links: string[] }> {
  if (!FIRECRAWL_API_KEY) {
    throw new Error('FIRECRAWL_API_KEY not configured');
  }
  
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['html', 'markdown', 'links'],
      waitFor: 3000,
      location: { country: 'VN', languages: ['vi'] },
    }),
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`Firecrawl error ${response.status}: ${data?.error || 'Unknown error'} for ${url}`);
  }
  
  const html = data?.data?.html || data?.html || '';
  const markdown = data?.data?.markdown || data?.markdown || '';
  const links = data?.data?.links || data?.links || [];
  
  return { html, markdown, links };
}

// Legacy directFetch as fallback (may get 403)
async function directFetch(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    signal: controller.signal,
    redirect: 'follow',
  });
  
  clearTimeout(timeoutId);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  
  return await response.text();
}

// Strip promoted/sponsored/VIP sections from batdongsan HTML before link extraction
function stripSponsoredSections(html: string, marketplace: string): string {
  if (marketplace !== 'batdongsan') return html;
  
  // Remove promoted/featured/VIP listing cards — these are cross-district ads
  // Batdongsan uses classes like: js__card--featured, js__card--vip, re__card-featured,
  // re__card-vip, js__product-featured, pr-container--featured
  const sponsoredPatterns = [
    // Featured/VIP card containers (greedy within each card)
    /<div[^>]*class="[^"]*(?:js__card--(?:featured|vip)|re__card-(?:featured|vip)|pr-container--(?:featured|vip)|js__product-(?:featured|vip))[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?:<\/div>)*/gi,
    // Sponsored listing sections with header
    /<(?:div|section)[^>]*class="[^"]*(?:featured-listing|vip-listing|sponsored-listing|re__srp-featured|js__section-featured)[^"]*"[^>]*>[\s\S]*?<\/(?:div|section)>/gi,
    // "Tin nổi bật" / "Tin VIP" section headers and their following content blocks
    /<(?:h[2-4]|div|span)[^>]*>[^<]*(?:Tin nổi bật|Tin VIP|Featured|Nổi bật|Được tài trợ|Sponsored)[^<]*<\/(?:h[2-4]|div|span)>/gi,
  ];
  
  let cleaned = html;
  for (const pattern of sponsoredPatterns) {
    const before = cleaned.length;
    cleaned = cleaned.replace(pattern, '');
    if (cleaned.length < before) {
      console.log(`[stripSponsored] Removed ${before - cleaned.length} chars of sponsored content`);
    }
  }
  return cleaned;
}

function extractLinksFromHtml(html: string, baseUrl: string, marketplace?: string): string[] {
  // Strip sponsored sections before extracting links
  const cleanHtml = marketplace ? stripSponsoredSections(html, marketplace) : html;
  
  const links: string[] = [];
  const regex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(cleanHtml)) !== null) {
    let href = match[1];
    if (href.startsWith('/')) {
      try {
        const base = new URL(baseUrl);
        href = `${base.protocol}//${base.host}${href}`;
      } catch { continue; }
    }
    if (href.startsWith('http')) {
      links.push(href);
    }
  }
  return [...new Set(links)];
}

function htmlToBasicMarkdown(html: string): string {
  let text = html;
  // Remove script/style blocks
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Convert headers
  text = text.replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, level, content) => `${'#'.repeat(parseInt(level))} ${content}\n`);
  // Convert links
  text = text.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  // Convert line breaks and paragraphs
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '- ');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// ─── Phase 2: Scrape individual listing detail pages ─────────────
async function scrapeDetailPage(url: string, marketplace: string): Promise<{
  markdown: string;
  images: string[];
  links: string[];
} | null> {
  try {
    let html = '';
    let images: string[] = [];
    let links: string[] = [];
    let markdown = '';
    
    if (FIRECRAWL_API_KEY) {
      const result = await firecrawlFetch(url);
      html = result.html;
      links = result.links;
      markdown = result.markdown;
    } else {
      html = await directFetch(url);
      links = extractLinksFromHtml(html, url);
      markdown = htmlToBasicMarkdown(html);
    }
    
    // Use marketplace-specific image extraction for better quality
    if (marketplace === 'batdongsan') {
      images = extractBatdongsanGalleryImages(html);
    }
    
    // Fallback to generic extraction
    if (images.length === 0) {
      images = extractImagesFromHtml(html);
    }
    
    if (!markdown || markdown.length < 100) return null;
    
    return { markdown, images, links };
  } catch (e) {
    console.error(`[Phase 2] Error scraping ${url}:`, e);
    return null;
  }
}

function extractImagesFromHtml(html: string): string[] {
  const images: string[] = [];
  const patterns = [
    /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,
    /srcset=["']([^"']+)["']/gi,
    /background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi,
  ];
  
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (regex === patterns[1]) {
        // srcset: extract all URLs, prefer highest res
        match[1].split(',').forEach(part => {
          const url = part.trim().split(' ')[0];
          if (url?.startsWith('http')) images.push(url);
        });
      } else if (match[1]?.startsWith('http')) {
        images.push(match[1]);
      }
    }
  }
  
  // Deduplicate and filter non-property images
  return [...new Set(images)].filter(img =>
    !img.includes('logo') && !img.includes('icon') && !img.includes('sprite') &&
    !img.includes('avatar') && !img.includes('placeholder') &&
    img.match(/\.(jpg|jpeg|png|webp|gif)/i)
  );
}

// ─── Phase 3: AI extraction from detail pages ────────────────────
async function extractPropertyFromDetailPage(
  detailMarkdown: string,
  detailImages: string[],
  sourceUrl: string,
  marketplace: string,
  index: number
): Promise<ExternalProperty | null> {
  const prompt = `You are a property data extraction expert. Extract the SINGLE rental property listing from this ${marketplace} individual listing detail page.

DETAIL PAGE CONTENT:
${detailMarkdown.substring(0, 12000)}

IMAGES FOUND ON THIS PAGE (assign ALL relevant property images):
${detailImages.slice(0, 30).join('\n')}

SOURCE URL: ${sourceUrl}

CRITICAL INSTRUCTIONS:
1. ALL text output MUST be in ENGLISH - translate Vietnamese content
2. This is a SINGLE property detail page - extract ONE property with complete details
3. Include ALL property images from the list above (filter out non-property images like logos/icons)
4. Write a detailed, engaging English description (150-300 words)
5. Extract ALL amenities mentioned in the listing
6. Extract contact info (name, phone) if visible - note that phone numbers may be partially masked with ***
7. **LOCATION IS CRITICAL**: Extract the COMPLETE, FULL address exactly as shown on the page. Include street name, ward/phường, district/quận, and city. For example: "Đường Hoàng Hoa Thám, Phường Ngọc Hà, Quận Ba Đình, Hà Nội" — do NOT simplify to just the city name. Keep the Vietnamese location names as-is (do NOT translate location names).
8. Determine the apartment type - MUST be one of: "Studio", "1 Bedroom", "2 Bedrooms", "3 Bedrooms", "4+ Bedrooms", "Penthouse", "Shared Room"

RESPOND WITH VALID JSON ONLY:
{
  "title": "Descriptive English title",
  "location": "FULL address: Street, Ward, District, City (keep Vietnamese names)",
  "price": 5000000,
  "priceDisplay": "5 triệu/tháng",
  "size": "25m²",
  "rooms": "Studio",
  "images": ["url1", "url2", ...],
  "description": "Detailed English description...",
  "amenities": ["Air Conditioning", "WiFi", ...],
  "contactName": "...",
  "contactPhone": "..."
}`;

  try {
    const content = await callAI(
      [
        { role: 'system', content: 'Extract structured property data from a single Vietnamese property listing detail page. Output English. Keep location names in Vietnamese. Respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      2500,
      0.2
    );

    if (!content) {
      console.error(`[Phase 3] AI call failed for ${sourceUrl}`);
      return null;
    }

    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const p = JSON.parse(cleaned);
    
    // Use AI-extracted images if available, otherwise use scraped images
    // Normalize batdongsan image URLs to full-size
    let finalImages = (Array.isArray(p.images) && p.images.length > 0 ? p.images : detailImages)
      .filter((img: string) => isValidPropertyImageUrl(img))
      .slice(0, 5);
    
    if (marketplace === 'batdongsan') {
      finalImages = finalImages.map(normalizeBatdongsanImageUrl);
    }

    return {
      id: `external-${marketplace}-${Date.now()}-${index}`,
      title: p.title || 'Rental Property',
      location: p.location || 'Ho Chi Minh City',
      price: typeof p.price === 'number' ? p.price : parseInt(String(p.price).replace(/\D/g, '')) || 0,
      priceDisplay: p.priceDisplay || `${p.price?.toLocaleString()} VND`,
      size: p.size || 'N/A',
      rooms: p.rooms || '',
      images: finalImages,
      description: p.description || '',
      highlights: [],
      amenities: Array.isArray(p.amenities) ? p.amenities : [],
      source: marketplace as 'batdongsan' | 'nhatot' | 'airbnb',
      sourceUrl,
      sourceProviderName: p.contactName,
      sourceProviderPhone: p.contactPhone,
      vibe: undefined,
      vibe_analysis: undefined,
    };
  } catch (error) {
    console.error(`[Phase 3] AI extraction error for ${sourceUrl}:`, error);
    return null;
  }
}

// ─── Fallback: extract from search page only (original approach) ─
async function extractPropertiesFromSearchPage(
  markdown: string,
  marketplace: string,
  searchQuery: string,
  extractedImages: string[]
): Promise<ExternalProperty[]> {
  console.log(`[Fallback] Extracting properties from search page for ${marketplace}...`);
  
  const prompt = `You are a property data extraction expert. Extract rental property listings from this ${marketplace} Vietnamese website search results page.

SCRAPED CONTENT:
${markdown.substring(0, 12000)}

AVAILABLE IMAGES:
${extractedImages.slice(0, 25).join('\n')}

SEARCH CONTEXT: "${searchQuery}"

CRITICAL: ALL text MUST be in ENGLISH. Extract up to 5 properties.

For EACH property:
- title: English descriptive title
- location: FULL address with street, ward, district, city (keep Vietnamese place names as-is)
- price: Numeric VND
- priceDisplay: Original price text
- size: m² if available
- rooms: Apartment type, one of: "Studio", "1 Bedroom", "2 Bedrooms", "3 Bedrooms", "4+ Bedrooms", "Penthouse", "Shared Room"
- images: 3-5 image URLs from above
- description: 100-200 word English description
- amenities: English amenity names
- sourceUrl: Listing URL
- contactName, contactPhone: If available

RESPOND WITH VALID JSON: {"properties": [...]}`;

  try {
    const content = await callAI(
      [
        { role: 'system', content: 'Extract structured property data from Vietnamese website content. Output English. Keep location/address names in Vietnamese. Valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      4000,
      0.3
    );

    if (!content) return [];
    
    let cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const parsed = JSON.parse(cleaned);
    return (parsed.properties || []).map((p: any, i: number) => {
      const imgs = (Array.isArray(p.images) ? p.images : []).filter((img: string) => isValidPropertyImageUrl(img)).slice(0, 5);
      
      return {
        id: `external-${marketplace}-${Date.now()}-${i}`,
        title: p.title || 'Rental Property',
        location: p.location || 'Ho Chi Minh City',
        price: typeof p.price === 'number' ? p.price : parseInt(String(p.price).replace(/\D/g, '')) || 0,
        priceDisplay: p.priceDisplay || '',
        size: p.size || 'N/A',
        rooms: p.rooms || '',
        images: imgs.length > 0 ? imgs : extractedImages.slice(i * 4, i * 4 + 4),
        description: p.description || '',
        highlights: [],
        amenities: Array.isArray(p.amenities) ? p.amenities : [],
        source: marketplace as 'batdongsan' | 'nhatot' | 'airbnb',
        sourceUrl: p.sourceUrl || '',
        sourceProviderName: p.contactName,
        sourceProviderPhone: p.contactPhone,
        vibe: undefined,
        vibe_analysis: undefined,
      } as ExternalProperty;
    });
  } catch (error) {
    console.error('[Fallback] AI extraction error:', error);
    return [];
  }
}

// ─── Main Handler ────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');
    
    // Allow service role key for internal scheduled calls
    const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
    
    if (!isServiceRole) {
      const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: authError } = await supabaseAuth.auth.getUser(token);
      if (authError || !userData?.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log(`[scrape-marketplace] Authenticated user: ${userData.user.id}`);
    } else {
      console.log(`[scrape-marketplace] Authenticated via service role (scheduled crawl)`);
    }

    const body = await req.json() as SearchParams & { pages?: number; directSave?: boolean; crawlLocation?: string };
    const { marketplace, query, location, minPrice, maxPrice, includeVibeAnalysis = true, maxResults, pages: explicitPages, directSave, crawlLocation } = body;
    
    // Use maxResults param or default
    const effectiveMaxResults = Math.min(Math.max(maxResults || MAX_DETAIL_PAGES, 1), 30);
    const effectivePagesToScrape = explicitPages ? Math.min(Math.max(explicitPages, 1), PAGES_TO_SCRAPE) : (effectiveMaxResults <= 5 ? 1 : effectiveMaxResults <= 10 ? 2 : PAGES_TO_SCRAPE);
    
    console.log(`[scrape-marketplace] Request:`, JSON.stringify({ marketplace, query, location, maxResults: effectiveMaxResults, pages: effectivePagesToScrape }));

    if (!LOVABLE_API_KEY && !OPENAI_API_KEY) throw new Error('No AI API key configured (LOVABLE_API_KEY or OPENAI_API_KEY)');

    // Check cache
    const cacheKey = `marketplace:v2:${marketplace}:${query}:${location || 'all'}`;
    const cached = await redisGet(cacheKey);
    if (cached) {
      console.log('Returning cached results for:', cacheKey);
      return new Response(JSON.stringify({ success: true, properties: cached, cached: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Phase 1: Scrape search results pages (pages 1-3) ──
    const allLinks: string[] = [];
    let allMarkdown = '';
    let allHtml = '';
    let firstPageSuccess = false;

    for (let page = 1; page <= effectivePagesToScrape; page++) {
      const searchUrl = buildSearchUrl({ marketplace, query, location }, page);
      console.log(`[Phase 1] Scraping search page ${page}/${effectivePagesToScrape}: ${searchUrl}`);

      try {
        // Try directFetch first for search pages (saves 1 Firecrawl credit per crawl)
        // Only fall back to Firecrawl if directFetch gets 403/blocked
        let html = '';
        let pageLinks: string[] = [];
        let pageMarkdown = '';
        
        let useFirecrawl = false;
        try {
          html = await directFetch(searchUrl);
          pageLinks = extractLinksFromHtml(html, searchUrl, marketplace);
          pageMarkdown = htmlToBasicMarkdown(html);
          // Check if we got a meaningful page (not a captcha/block page)
          if (pageMarkdown.length < 200 || pageLinks.length < 3) {
            console.log(`[Phase 1] directFetch returned thin content (${pageMarkdown.length} chars, ${pageLinks.length} links), falling back to Firecrawl`);
            useFirecrawl = true;
          }
        } catch (directErr) {
          console.log(`[Phase 1] directFetch failed: ${directErr}, falling back to Firecrawl`);
          useFirecrawl = true;
        }
        
        if (useFirecrawl && FIRECRAWL_API_KEY) {
          const result = await firecrawlFetch(searchUrl);
          html = result.html;
          pageLinks = result.links;
          pageMarkdown = result.markdown;
        } else if (useFirecrawl) {
          console.log(`[Phase 1] No Firecrawl API key, cannot retry`);
        }
        
        if (!pageMarkdown || pageMarkdown.length < 100) {
          if (page === 1) {
            return new Response(JSON.stringify({ success: true, properties: [], message: 'No listings found' }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          console.log(`[Phase 1] Page ${page} returned no content, stopping pagination`);
          break;
        }

        firstPageSuccess = true;
        allLinks.push(...pageLinks);
        allMarkdown += `\n--- PAGE ${page} ---\n` + pageMarkdown;
        if (page === 1) allHtml = html;

        console.log(`[Phase 1] Page ${page}: ${pageMarkdown.length} chars, ${pageLinks.length} links`);

        // Small delay between page scrapes
        if (page < effectivePagesToScrape) {
          await new Promise(r => setTimeout(r, 800));
        }
      } catch (e) {
        console.error(`[Phase 1] Error scraping page ${page}:`, e);
        if (page === 1) {
          return new Response(JSON.stringify({ success: false, properties: [], error: `Marketplace unavailable: ${marketplace}` }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        break;
      }
    }

    console.log(`[Phase 1] Total from all pages: ${allLinks.length} links`);

    // ── Phase 2: Extract listing URLs and scrape detail pages ──
    const listingLinks = await extractListingUrls(
      allMarkdown,
      allLinks,
      marketplace,
      effectiveMaxResults
    );

    let properties: ExternalProperty[] = [];

    if (listingLinks.length > 0) {
      // ── Pre-scrape dedup: check which listings already exist in DB ──
      const supabaseDedup = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const canonicalIds = listingLinks.map(l => extractListingId(l.url, marketplace)).filter(Boolean) as string[];
      const normalizedUrls = listingLinks.map(l => normalizeSourceUrl(l.url));

      let existingIds = new Set<string>();
      let existingUrls = new Set<string>();

      if (canonicalIds.length > 0) {
        const { data: byId } = await supabaseDedup
          .from('external_properties')
          .select('external_id')
          .eq('source', marketplace)
          .in('external_id', canonicalIds);
        if (byId) existingIds = new Set(byId.map(r => r.external_id));
      }
      if (normalizedUrls.length > 0) {
        const { data: byUrl } = await supabaseDedup
          .from('external_properties')
          .select('source_url')
          .eq('source', marketplace)
          .in('source_url', normalizedUrls);
        if (byUrl) existingUrls = new Set(byUrl.map(r => r.source_url));
      }

      // Split into new vs existing
      const newLinks: ListingLink[] = [];
      const existingLinks: ListingLink[] = [];
      for (const link of listingLinks) {
        const cid = extractListingId(link.url, marketplace);
        const nurl = normalizeSourceUrl(link.url);
        if ((cid && existingIds.has(cid)) || existingUrls.has(nurl)) {
          existingLinks.push(link);
        } else {
          newLinks.push(link);
        }
      }

      console.log(`[Pre-dedup] ${listingLinks.length} listings: ${newLinks.length} new, ${existingLinks.length} already in DB`);

      // Refresh last_verified_at for existing listings (no Firecrawl credits spent)
      if (existingLinks.length > 0) {
        const now = new Date().toISOString();
        const refreshUrls = existingLinks.map(l => normalizeSourceUrl(l.url));
        const refreshIds = existingLinks.map(l => extractListingId(l.url, marketplace)).filter(Boolean) as string[];
        
        if (refreshIds.length > 0) {
          await supabaseDedup
            .from('external_properties')
            .update({ last_verified_at: now, updated_at: now, expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString() })
            .eq('source', marketplace)
            .in('external_id', refreshIds);
        }
        if (refreshUrls.length > 0) {
          await supabaseDedup
            .from('external_properties')
            .update({ last_verified_at: now, updated_at: now, expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString() })
            .eq('source', marketplace)
            .in('source_url', refreshUrls);
        }
        console.log(`[Pre-dedup] Refreshed ${existingLinks.length} existing listings`);
      }

      // Only scrape detail pages for NEW listings
      console.log(`[Phase 2] Scraping ${newLinks.length} NEW detail pages (skipped ${existingLinks.length} existing)...`);
      
      const batchSize = 3;
      const detailResults: (ExternalProperty | null)[] = [];
      
      for (let i = 0; i < newLinks.length; i += batchSize) {
        const batch = newLinks.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (listing, batchIdx) => {
          const globalIdx = i + batchIdx;
          console.log(`[Phase 2] Scraping detail page ${globalIdx + 1}/${newLinks.length}: ${listing.url}`);
          
          const detail = await scrapeDetailPage(listing.url, marketplace);
          if (!detail) {
            console.log(`[Phase 2] Failed to scrape detail page: ${listing.url}`);
            return null;
          }
          
          console.log(`[Phase 3] Extracting property data from detail page ${globalIdx + 1}: ${detail.markdown.length} chars, ${detail.images.length} images`);
          
          return extractPropertyFromDetailPage(
            detail.markdown,
            detail.images,
            listing.url,
            marketplace,
            globalIdx
          );
        });
        
        const batchResults = await Promise.all(batchPromises);
        detailResults.push(...batchResults);
        
        if (i + batchSize < newLinks.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      const rawProperties = detailResults.filter((p): p is ExternalProperty => p !== null);

      // ── Cross-city filtering: reject listings from wrong city ──
      const targetCity = detectCity(crawlLocation || location || query);
      if (targetCity !== 'other') {
        for (const prop of rawProperties) {
          const propCity = detectCity(prop.location);
          if (propCity !== 'other' && propCity !== targetCity) {
            console.log(`[Cross-city] Rejected "${prop.title?.substring(0, 40)}" (${propCity}) - target: ${targetCity}`);
          } else {
            properties.push(prop);
          }
        }
        console.log(`[Cross-city] Kept ${properties.length}/${rawProperties.length} properties matching target city ${targetCity}`);
      } else {
        properties = rawProperties;
      }

      console.log(`[Phase 3] Successfully extracted ${properties.length} properties from detail pages`);
    }
    
    // ── Fallback: extract from search page if detail scraping yielded few results ──
    if (properties.length < 2) {
      console.log(`[Fallback] Only ${properties.length} from detail pages, falling back to search page extraction`);
      
      const searchImages = extractImagesFromHtml(allHtml);
      const fallbackProperties = await extractPropertiesFromSearchPage(
        allMarkdown,
        marketplace,
        query,
        searchImages
      );
      
      // Merge: prefer detail-scraped properties, add fallback ones that aren't duplicates
      const existingUrls = new Set(properties.map(p => p.sourceUrl));
      for (const fp of fallbackProperties) {
        if (!existingUrls.has(fp.sourceUrl) && properties.length < effectiveMaxResults) {
          properties.push(fp);
        }
      }
      
      console.log(`[Fallback] Total properties after merge: ${properties.length}`);
    }

    // Filter by price
    let filteredProperties = properties;
    if (minPrice || maxPrice) {
      filteredProperties = properties.filter(p => {
        if (minPrice && p.price < minPrice) return false;
        if (maxPrice && p.price > maxPrice) return false;
        return true;
      });
    }

    // Direct save mode: save properties to DB immediately (used by scheduled-crawl)
    if (directSave && isServiceRole) {
      console.log(`[scrape-marketplace] DirectSave mode: saving ${filteredProperties.length} properties to DB`);
      const saveResult = await savePropertiesToDB(filteredProperties, marketplace, crawlLocation || location || '');
      console.log(`[scrape-marketplace] DirectSave result:`, JSON.stringify(saveResult));

      // Trigger phone extraction for newly saved properties missing phone numbers
      let phoneExtracted = 0;
      if (saveResult.newListings > 0) {
        try {
          const extractPhoneUrl = `${SUPABASE_URL}/functions/v1/extract-phone`;
          // Build listings array from the properties that were just saved (new ones without phone)
          const listingsToExtract = filteredProperties
            .filter(p => !p.sourceProviderPhone && p.sourceUrl)
            .slice(0, 5) // Limit to 5 per crawl to manage Browserless credits
            .map(p => ({
              source_url: normalizeSourceUrl(p.sourceUrl),
              source: marketplace,
            }));

          if (listingsToExtract.length > 0) {
            // Fetch their DB IDs
            const supabasePhone = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
            const sourceUrls = listingsToExtract.map(l => l.source_url);
            const { data: savedProps } = await supabasePhone
              .from('external_properties')
              .select('id, source_url, source')
              .in('source_url', sourceUrls)
              .is('contact_phone', null);

            if (savedProps && savedProps.length > 0) {
              console.log(`[scrape-marketplace] Triggering phone extraction for ${savedProps.length} new listings`);
              
              // Fire-and-forget: don't wait for completion to avoid timeout
              fetch(extractPhoneUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  listings: savedProps.map(p => ({
                    id: p.id,
                    sourceUrl: p.source_url,
                    source: p.source,
                  })),
                }),
              }).then(async (res) => {
                if (res.ok) {
                  const data = await res.json();
                  console.log(`[scrape-marketplace] Phone extraction result: ${data.extracted}/${data.total} extracted`);
                } else {
                  console.warn(`[scrape-marketplace] Phone extraction failed: ${res.status}`);
                }
              }).catch(err => {
                console.warn(`[scrape-marketplace] Phone extraction error:`, err);
              });
            }
          }
        } catch (phoneErr) {
          console.warn(`[scrape-marketplace] Phone extraction trigger error:`, phoneErr);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        directSave: true,
        ...saveResult,
        phoneExtractionTriggered: saveResult.newListings > 0,
        totalScraped: filteredProperties.length,
        source: marketplace,
        crawlMethod: 'detail-page-paginated-directsave',
        pagesScraped: effectivePagesToScrape,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cache results
    if (filteredProperties.length > 0) {
      await redisSet(cacheKey, filteredProperties, CACHE_TTL);
    }

    console.log(`[scrape-marketplace] SUCCESS: ${filteredProperties.length} properties from ${marketplace} (detail-page crawling)`);

    return new Response(JSON.stringify({ 
      success: true, 
      properties: filteredProperties,
      source: marketplace,
      searchUrl: buildSearchUrl({ marketplace, query, location }, 1),
      crawlMethod: 'detail-page-paginated',
      pagesScraped: effectivePagesToScrape,
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
