import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

const CACHE_TTL = 60 * 60 * 2; // 2 hours
const MAX_DETAIL_PAGES = 10; // Max individual listings to scrape
const DETAIL_SCRAPE_TIMEOUT = 15000; // 15s per detail page

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

function buildSearchUrl(params: SearchParams, page: number = 1): string {
  const { marketplace, query, location } = params;
  
  const normalizedLocation = location?.toLowerCase()
    .replace(/district\s*/i, 'quan-')
    .replace(/d(\d+)/i, 'quan-$1')
    .replace(/\s+/g, '-')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    || '';
  
  const isHanoi = /(ha noi|hanoi|ba dinh|hoan kiem|dong da|cau giay|hai ba trung)/i.test(location || '');
  const isDaNang = /(da nang|đà nẵng|hai chau|thanh khe|son tra|ngu hanh son|lien chieu|cam le)/i.test(location || '');
  const citySlug = isHanoi ? 'ha-noi' : isDaNang ? 'da-nang' : 'tp-hcm';
  const nhatotCity = isHanoi ? 'ha-noi' : isDaNang ? 'da-nang' : 'tp-ho-chi-minh';
  const airbnbCity = isHanoi ? 'Hanoi--Vietnam' : isDaNang ? 'Da-Nang--Vietnam' : 'Ho-Chi-Minh-City--Vietnam';
  
  switch (marketplace) {
    case 'batdongsan': {
      let baseUrl: string;
      if (normalizedLocation.includes('quan-')) {
        baseUrl = `https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-${normalizedLocation}-${citySlug}`;
      } else if (normalizedLocation) {
        baseUrl = `https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-${citySlug}?keyword=${encodeURIComponent(location || query)}`;
      } else {
        baseUrl = `https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-${citySlug}`;
      }
      // batdongsan uses /p{page} suffix for pagination
      if (page > 1) {
        const separator = baseUrl.includes('?') ? '&' : '';
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
        'binh thanh': 'quan-binh-thanh', 'binhthanh': 'quan-binh-thanh', 'quan binh thanh': 'quan-binh-thanh',
        'phu nhuan': 'quan-phu-nhuan', 'phunhuan': 'quan-phu-nhuan', 'quan phu nhuan': 'quan-phu-nhuan',
        'tan binh': 'quan-tan-binh', 'tanbinh': 'quan-tan-binh', 'quan tan binh': 'quan-tan-binh',
        'go vap': 'quan-go-vap', 'govap': 'quan-go-vap', 'quan go vap': 'quan-go-vap',
        'thu duc': 'thanh-pho-thu-duc', 'thuduc': 'thanh-pho-thu-duc',
        'ba dinh': 'quan-ba-dinh', 'badinh': 'quan-ba-dinh',
        'hoan kiem': 'quan-hoan-kiem', 'hoankiem': 'quan-hoan-kiem',
        'dong da': 'quan-dong-da', 'dongda': 'quan-dong-da',
        'cau giay': 'quan-cau-giay', 'caugiay': 'quan-cau-giay',
        'hai ba trung': 'quan-hai-ba-trung', 'haibatrung': 'quan-hai-ba-trung',
        // Da Nang districts
        'hai chau': 'quan-hai-chau', 'haichau': 'quan-hai-chau',
        'thanh khe': 'quan-thanh-khe', 'thanhkhe': 'quan-thanh-khe',
        'son tra': 'quan-son-tra', 'sontra': 'quan-son-tra',
        'ngu hanh son': 'quan-ngu-hanh-son', 'nguhanhson': 'quan-ngu-hanh-son',
        'lien chieu': 'quan-lien-chieu', 'lienchieu': 'quan-lien-chieu',
        'cam le': 'quan-cam-le', 'camle': 'quan-cam-le',
      };
      
      const locationLower = (location || '').toLowerCase().trim();
      let nhatotDistrictSlug = districtMappings[locationLower];
      if (!nhatotDistrictSlug) nhatotDistrictSlug = districtMappings[locationLower.replace(/\s+/g, '')];
      if (!nhatotDistrictSlug) {
        const districtMatch = locationLower.match(/\b(d\d+|district\s*\d+|quan\s*\d+|quan-\d+)\b/i);
        if (districtMatch) {
          const m = districtMatch[1].toLowerCase().replace(/\s+/g, '');
          nhatotDistrictSlug = districtMappings[m] || districtMappings[m.replace('district', 'd')];
        }
      }
      if (!nhatotDistrictSlug) {
        for (const [key, slug] of Object.entries(districtMappings)) {
          if (locationLower.includes(key)) { nhatotDistrictSlug = slug; break; }
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
      // Airbnb uses items_offset for pagination (18 items per page)
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
  if (unique.length < 3 && OPENAI_API_KEY) {
    console.log(`[Phase 1] Using AI fallback to find listing URLs...`);
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
            { role: 'system', content: 'Extract individual property listing URLs from search page content. Return JSON only.' },
            { role: 'user', content: `Extract all individual property listing detail page URLs from this ${marketplace} search results page. Only include URLs that lead to INDIVIDUAL property detail pages, not search/filter pages.\n\nAVAILABLE LINKS:\n${links.slice(0, 100).join('\n')}\n\nPAGE CONTENT (first 4000 chars):\n${markdown.substring(0, 4000)}\n\nReturn JSON: {"listings": [{"url": "...", "title": "...", "price": "..."}]}` }
          ],
          max_tokens: 2000,
          temperature: 0.1,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        let content = data.choices?.[0]?.message?.content || '{"listings":[]}';
        content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(content);
        
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

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
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
async function scrapeDetailPage(url: string): Promise<{
  markdown: string;
  images: string[];
  links: string[];
} | null> {
  try {
    const html = await directFetch(url);
    
    const images = extractImagesFromHtml(html);
    const links = extractLinksFromHtml(html, url);
    const markdown = htmlToBasicMarkdown(html);
    
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
${detailMarkdown.substring(0, 10000)}

IMAGES FOUND ON THIS PAGE (assign ALL relevant property images):
${detailImages.slice(0, 30).join('\n')}

SOURCE URL: ${sourceUrl}

CRITICAL INSTRUCTIONS:
1. ALL text output MUST be in ENGLISH - translate Vietnamese content
2. This is a SINGLE property detail page - extract ONE property with complete details
3. Include ALL property images from the list above (filter out non-property images)
4. Write a detailed, engaging English description (150-300 words)
5. Extract 5-7 lifestyle highlights in English
6. Extract ALL amenities mentioned
7. Extract contact info (name, phone) if available
8. Extract exact address/location
9. Determine the apartment type - MUST be one of: "Studio", "1 Bedroom", "2 Bedrooms", "3 Bedrooms", "4+ Bedrooms", "Penthouse", "Shared Room"

VIBE ANALYSIS:
- style: One of [Modern, Cozy, Industrial, Bohemian, Scandinavian, Minimalist, Contemporary, Traditional, Rustic, Luxury, Urban, Vintage]
- colors: Array from [Neutral, Warm, Cool, Bright, Dark, Colorful, Natural, White, Earth, Bold]
- activities: Array from [Working, Reading, Relaxing, Entertaining, Cooking, Exercising]
- vibe_scores: Scores 1-10 for: modern, cozy, luxurious, minimalist, spacious, natural_light, urban, elegant

RESPOND WITH VALID JSON ONLY:
{
  "title": "Descriptive English title",
  "location": "Full address/location",
  "price": 5000000,
  "priceDisplay": "5 triệu/tháng",
  "size": "25m²",
  "rooms": "Studio",
  "images": ["url1", "url2", ...],
  "description": "Detailed English description...",
  "highlights": ["highlight1", "highlight2", ...],
  "amenities": ["Air Conditioning", "WiFi", ...],
  "contactName": "...",
  "contactPhone": "...",
  "vibe_analysis": {
    "style": "Modern",
    "colors": ["Neutral", "White"],
    "activities": ["Working", "Relaxing"],
    "vibe_scores": {"modern": 8, "cozy": 6, "luxurious": 5, "minimalist": 7, "spacious": 6, "natural_light": 8, "urban": 7, "elegant": 6}
  }
}`;

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
          { role: 'system', content: 'Extract structured property data from a single Vietnamese property listing detail page. Output English. Respond with valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      console.error(`[Phase 3] OpenAI error for ${sourceUrl}:`, await response.text());
      return null;
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const p = JSON.parse(content);
    const vibeAnalysis = p.vibe_analysis || { style: 'Modern', colors: ['Neutral'], activities: ['Relaxing'], vibe_scores: {} };
    const vibeScores = vibeAnalysis.vibe_scores || {};
    const primaryVibe = Object.entries(vibeScores)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 2)
      .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1))
      .join(', ');
    
    // Filter images to only valid URLs
    const validImages = (Array.isArray(p.images) ? p.images : detailImages)
      .filter((img: string) => img?.startsWith('http'))
      .slice(0, 10);

    return {
      id: `external-${marketplace}-${Date.now()}-${index}`,
      title: p.title || 'Rental Property',
      location: p.location || 'Ho Chi Minh City',
      price: typeof p.price === 'number' ? p.price : parseInt(String(p.price).replace(/\D/g, '')) || 0,
      priceDisplay: p.priceDisplay || `${p.price?.toLocaleString()} VND`,
      size: p.size || 'N/A',
      rooms: p.rooms || '',
      images: validImages,
      description: p.description || '',
      highlights: Array.isArray(p.highlights) ? p.highlights : [],
      amenities: Array.isArray(p.amenities) ? p.amenities : [],
      source: marketplace as 'batdongsan' | 'nhatot' | 'airbnb',
      sourceUrl,
      sourceProviderName: p.contactName,
      sourceProviderPhone: p.contactPhone,
      vibe: primaryVibe || vibeAnalysis.style || 'Modern',
      vibe_analysis: {
        style: vibeAnalysis.style,
        colors: vibeAnalysis.colors,
        activities: vibeAnalysis.activities,
        amenities: Array.isArray(p.amenities) ? p.amenities : [],
        vibe_scores: vibeScores,
      },
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
- location: Location (keep Vietnamese area names)
- price: Numeric VND
- priceDisplay: Original price text
- size: m² if available
- rooms: Apartment type, one of: "Studio", "1 Bedroom", "2 Bedrooms", "3 Bedrooms", "4+ Bedrooms", "Penthouse", "Shared Room"
- images: 3-5 image URLs from above
- description: 100-200 word English description
- highlights: 4-5 English lifestyle highlights
- amenities: English amenity names
- sourceUrl: Listing URL
- contactName, contactPhone: If available
- vibe_analysis: { style, colors, activities, vibe_scores: {modern,cozy,luxurious,minimalist,spacious,natural_light,urban,elegant} (1-10) }

RESPOND WITH VALID JSON: {"properties": [...]}`;

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
          { role: 'system', content: 'Extract structured property data from Vietnamese website content. Output English. Valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) return [];
    
    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '{"properties":[]}';
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const parsed = JSON.parse(content);
    return (parsed.properties || []).map((p: any, i: number) => {
      const va = p.vibe_analysis || { style: 'Modern', colors: ['Neutral'], activities: ['Relaxing'], vibe_scores: {} };
      const vs = va.vibe_scores || {};
      const pv = Object.entries(vs).sort(([,a],[,b]) => (b as number) - (a as number)).slice(0,2).map(([k]) => k.charAt(0).toUpperCase() + k.slice(1)).join(', ');
      const imgs = (Array.isArray(p.images) ? p.images : []).filter((img: string) => img?.startsWith('http')).slice(0, 6);
      
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
        highlights: Array.isArray(p.highlights) ? p.highlights : [],
        amenities: Array.isArray(p.amenities) ? p.amenities : [],
        source: marketplace as 'batdongsan' | 'nhatot' | 'airbnb',
        sourceUrl: p.sourceUrl || '',
        sourceProviderName: p.contactName,
        sourceProviderPhone: p.contactPhone,
        vibe: pv || va.style || 'Modern',
        vibe_analysis: { style: va.style, colors: va.colors, activities: va.activities, amenities: Array.isArray(p.amenities) ? p.amenities : [], vibe_scores: vs },
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

    const body = await req.json() as SearchParams & { pages?: number };
    const { marketplace, query, location, minPrice, maxPrice, includeVibeAnalysis = true, maxResults, pages: explicitPages } = body;
    
    // Use maxResults param or default
    const effectiveMaxResults = Math.min(Math.max(maxResults || MAX_DETAIL_PAGES, 1), 30);
    const effectivePagesToScrape = explicitPages ? Math.min(Math.max(explicitPages, 1), PAGES_TO_SCRAPE) : (effectiveMaxResults <= 5 ? 1 : effectiveMaxResults <= 10 ? 2 : PAGES_TO_SCRAPE);
    
    console.log(`[scrape-marketplace] Request:`, JSON.stringify({ marketplace, query, location, maxResults: effectiveMaxResults, pages: effectivePagesToScrape }));

    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

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
        // Use Firecrawl for anti-bot bypass, fall back to directFetch
        let html = '';
        let pageLinks: string[] = [];
        let pageMarkdown = '';
        
        if (FIRECRAWL_API_KEY) {
          const result = await firecrawlFetch(searchUrl);
          html = result.html;
          pageLinks = result.links;
          pageMarkdown = result.markdown;
        } else {
          html = await directFetch(searchUrl);
          pageLinks = extractLinksFromHtml(html, searchUrl);
          pageMarkdown = htmlToBasicMarkdown(html);
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
      console.log(`[Phase 2] Scraping ${listingLinks.length} detail pages in parallel (batches of 3)...`);
      
      // Scrape detail pages in batches of 3 to avoid rate limits
      const batchSize = 3;
      const detailResults: (ExternalProperty | null)[] = [];
      
      for (let i = 0; i < listingLinks.length; i += batchSize) {
        const batch = listingLinks.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (listing, batchIdx) => {
          const globalIdx = i + batchIdx;
          console.log(`[Phase 2] Scraping detail page ${globalIdx + 1}/${listingLinks.length}: ${listing.url}`);
          
          const detail = await scrapeDetailPage(listing.url);
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
        
        // Small delay between batches
        if (i + batchSize < listingLinks.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      properties = detailResults.filter((p): p is ExternalProperty => p !== null);
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
