// Re-scrapes a single external_properties row from its source_url and updates
// its title, description, location, price, size, rooms, images, amenities,
// and contact info. Marks vibe_status='pending' so the vibe queue re-analyzes
// the new images. Admin-only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logOpenAIUsage } from '../_shared/openai-usage.ts';
import { isVideoOrAnimatedUrl, isMapOrDiagramUrl } from '../_shared/vibe-policy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

// ─── HTTP helpers ───────────────────────────────────────────────
async function directFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; HaustoBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`directFetch ${res.status}`);
  return await res.text();
}

async function firecrawlFetch(url: string): Promise<{ html: string; markdown: string }> {
  if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY missing');
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FIRECRAWL_API_KEY}` },
    body: JSON.stringify({ url, formats: ['html', 'markdown'], onlyMainContent: false }),
    signal: AbortSignal.timeout(45_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(`Firecrawl ${res.status}: ${data?.error || 'unknown'}`);
  return { html: data.data?.html || '', markdown: data.data?.markdown || '' };
}

function htmlToBasicMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractImages(html: string, marketplace: string): string[] {
  const images = new Set<string>();
  const patterns = [
    /<img[^>]+src=["']([^"']+)["']/gi,
    /<img[^>]+data-src=["']([^"']+)["']/gi,
    /srcset=["']([^"']+)["']/gi,
    /background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (re === patterns[2]) {
        m[1].split(',').forEach(p => {
          const u = p.trim().split(' ')[0];
          if (u?.startsWith('http')) images.add(u);
        });
      } else if (m[1]?.startsWith('http')) {
        images.add(m[1]);
      }
    }
  }
  let out = [...images].filter(u =>
    !/logo|icon|sprite|avatar|placeholder|banner|favicon/i.test(u)
    && /\.(jpe?g|png|webp|avif)/i.test(u)
    && !isVideoOrAnimatedUrl(u)
    && !isMapOrDiagramUrl(u)
  );
  if (marketplace === 'batdongsan') {
    out = out.map(u => u.replace(/\/std\//, '/lg/').replace(/_thumb\./, '.').replace(/_md\./, '_lg.'));
  }
  return out;
}

// ─── Housingsgn (WordPress) helpers ─────────────────────────────
// Property code (e.g. KHH0219) is embedded in the URL slug and in every gallery
// image filename, so we match on it to avoid mixing in "Similar Properties".
const USD_TO_VND = 25000;

function extractHousingsgnPropertyCode(url: string): string | null {
  const m = url.match(/\/properties\/([^\/?#]+)/i);
  if (!m) return null;
  // Codes look like "khh0219", "sag0002" or numeric "030324", and are not
  // always the first token ("apartment-for-rent-030221-...").
  const token = m[1].toLowerCase().split('-').find(t => /^([a-z]{2,5}\d{3,6}|\d{6})$/.test(t));
  return token ?? null;
}

function normalizeHousingsgnImageUrl(url: string): string {
  return url.replace(/-\d{2,4}x\d{2,4}(\.(?:jpg|jpeg|png|webp|gif))(\?|$)/i, '$1$2');
}

function extractUsdAmount(text: string): number | null {
  if (!text) return null;
  const m = text.match(/(?:US\$|USD|\$)\s*([\d.,]{2,})/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  return isFinite(num) && num > 0 ? num : null;
}

// Keep only full-size images belonging to THIS housingsgn listing (by code), deduped.
function filterHousingsgnImages(images: string[], sourceUrl: string): string[] {
  const code = extractHousingsgnPropertyCode(sourceUrl);
  // Without a code there is nothing to bind images to - the page is an archive
  // of many units, not one listing. Take none rather than take everyone's.
  if (!code) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of images) {
    if (!/wp-content\/uploads/i.test(raw)) continue;
    const full = normalizeHousingsgnImageUrl(raw);
    if (!(full.split('/').pop() || '').toLowerCase().startsWith(code)) continue;
    const key = full.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(full);
  }
  out.sort((a, b) => {
    const na = parseInt(a.match(/-(\d+)\.(?:jpe?g|png|webp)(?:\?|$)/i)?.[1] || '9999', 10);
    const nb = parseInt(b.match(/-(\d+)\.(?:jpe?g|png|webp)(?:\?|$)/i)?.[1] || '9999', 10);
    return na - nb;
  });
  return out;
}

function detectMarketplace(source: string, url: string): string {
  const s = (source + ' ' + url).toLowerCase();
  if (s.includes('nhatot')) return 'nhatot';
  if (s.includes('batdongsan')) return 'batdongsan';
  if (s.includes('airbnb')) return 'airbnb';
  if (s.includes('housingsgn')) return 'housingsgn';
  return source || 'unknown';
}

async function callAI(messages: any[], maxTokens = 2500): Promise<string | null> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_completion_tokens: maxTokens, temperature: 0.2 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    console.error('[recrawl] AI call failed:', res.status, await res.text().catch(() => ''));
    return null;
  }
  const data = await res.json();
  logOpenAIUsage({ fn: 'recrawl-external-listing', model: 'gpt-4o-mini', usage: data?.usage });
  return data?.choices?.[0]?.message?.content || null;
}

async function extractFromDetailPage(markdown: string, images: string[], sourceUrl: string, marketplace: string) {
  const prompt = `Extract the SINGLE rental property from this ${marketplace} detail page.

DETAIL PAGE:
${markdown.substring(0, 12000)}

IMAGES FOUND:
${images.slice(0, 30).join('\n')}

SOURCE URL: ${sourceUrl}

INSTRUCTIONS:
1. ALL text in ENGLISH (translate Vietnamese), but keep LOCATION names in Vietnamese.
2. TITLE: vibe-focused, evocative (e.g. "Sun-Drenched Minimalist Loft with City Views"). Avoid generic titles.
3. DESCRIPTION: 150-300 words, lifestyle/atmosphere-focused.
4. AMENITIES: only physical features (Air Conditioning, WiFi, Balcony, Pool, Gym, Parking, Elevator). Exclude prices/terms/room counts/floor.
5. LOCATION: full address (street, ward, district, city) in Vietnamese.
6. ROOMS: must be one of "Studio", "1 Bedroom", "2 Bedrooms", "3 Bedrooms", "4+ Bedrooms", "Penthouse", "Shared Room".
7. IMAGES: include only listing photos from the IMAGES list (not logos/icons).

Respond with VALID JSON only:
{
  "title": "...",
  "location": "...",
  "price": 5000000,
  "priceDisplay": "5 triệu/tháng",
  "size": "25m²",
  "rooms": "Studio",
  "images": ["url", ...],
  "description": "...",
  "amenities": ["...", ...],
  "contactName": "...",
  "contactPhone": "..."
}`;
  const content = await callAI([
    { role: 'system', content: 'Extract structured property data. Output English. Keep location names Vietnamese. Respond with valid JSON only.' },
    { role: 'user', content: prompt },
  ]);
  if (!content) return null;
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'No authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: row, error: rowErr } = await admin
      .from('external_properties')
      .select('id, source, source_url, raw_data, images')
      .eq('id', id)
      .maybeSingle();
    if (rowErr || !row) return new Response(JSON.stringify({ error: 'Listing not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!row.source_url) return new Response(JSON.stringify({ error: 'Listing has no source_url' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const marketplace = detectMarketplace(row.source || '', row.source_url);
    console.log(`[recrawl-external-listing] Recrawling ${id} (${marketplace}) ${row.source_url}`);

    // Fetch HTML — prefer Firecrawl for protected sites
    let html = '', markdown = '';
    const needsFirecrawl = marketplace === 'nhatot' || marketplace === 'batdongsan' || marketplace === 'housingsgn';
    try {
      if (needsFirecrawl && FIRECRAWL_API_KEY) {
        const r = await firecrawlFetch(row.source_url);
        html = r.html; markdown = r.markdown || htmlToBasicMarkdown(html);
      } else {
        html = await directFetch(row.source_url);
        markdown = htmlToBasicMarkdown(html);
      }
    } catch (e) {
      console.warn('[recrawl-external-listing] Primary fetch failed, falling back:', String(e).substring(0, 200));
      try {
        if (FIRECRAWL_API_KEY) {
          const r = await firecrawlFetch(row.source_url);
          html = r.html; markdown = r.markdown || htmlToBasicMarkdown(html);
        } else {
          html = await directFetch(row.source_url);
          markdown = htmlToBasicMarkdown(html);
        }
      } catch (e2) {
        return new Response(JSON.stringify({ error: `Source fetch failed: ${String(e2).substring(0, 200)}` }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (!markdown || markdown.length < 200) {
      return new Response(JSON.stringify({ error: 'Source page returned empty/blocked content' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let scrapedImages = extractImages(html, marketplace);
    // For housingsgn, deterministically keep only THIS listing's gallery images
    // (matched by property code) so we never mix in "Similar Properties" photos.
    if (marketplace === 'housingsgn') {
      const matched = filterHousingsgnImages(scrapedImages, row.source_url);
      if (matched.length > 0) scrapedImages = matched;
    }
    const extracted = await extractFromDetailPage(markdown, scrapedImages, row.source_url, marketplace);
    if (!extracted) {
      return new Response(JSON.stringify({ error: 'AI extraction failed' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Prefer the deterministic, code-matched gallery for housingsgn; trust AI
    // image selection only for other marketplaces.
    let candidateImages: string[] = Array.isArray(extracted.images) && extracted.images.length > 0
      ? extracted.images
      : scrapedImages;
    if (marketplace === 'housingsgn') {
      const matched = filterHousingsgnImages(candidateImages, row.source_url);
      candidateImages = matched.length > 0 ? matched : scrapedImages;
    }
    const finalImages: string[] = candidateImages
      .filter((u: any) => typeof u === 'string' && u.startsWith('http'))
      .slice(0, 5);

    let priceNum = typeof extracted.price === 'number'
      ? extracted.price
      : parseInt(String(extracted.price || '').replace(/\D/g, '')) || null;
    let priceDisplay: string | undefined = extracted.priceDisplay || undefined;
    // housingsgn quotes USD — convert deterministically from the page text.
    if (marketplace === 'housingsgn') {
      const usd = extractUsdAmount(extracted.priceDisplay || '') ?? extractUsdAmount(markdown);
      if (usd) {
        priceNum = Math.round(usd * USD_TO_VND);
        priceDisplay = `$${usd.toLocaleString('en-US')}/month`;
      } else if (priceNum && priceNum > 0 && priceNum < 100_000) {
        priceNum = priceNum * USD_TO_VND;
      }
    }

    // Preserve recovery anchor for future repair runs
    const newRaw = {
      ...(row.raw_data || {}),
      original_image_urls: finalImages,
      recrawled_at: new Date().toISOString(),
    };

    const update: Record<string, unknown> = {
      title: extracted.title || undefined,
      location: extracted.location || undefined,
      price: priceNum ?? undefined,
      price_display: priceDisplay,
      size: extracted.size || undefined,
      rooms: extracted.rooms || undefined,
      description: extracted.description || undefined,
      amenities: Array.isArray(extracted.amenities) ? extracted.amenities : undefined,
      images: finalImages.length > 0 ? finalImages : undefined,
      contact_name: extracted.contactName || undefined,
      contact_phone: extracted.contactPhone || undefined,
      raw_data: newRaw,
      // Re-queue vibe analysis on the fresh images
      vibe_status: 'pending',
      vibe_analysis: {},
      highlights: [],
      last_verified_at: new Date().toISOString(),
      last_verification_status: 'alive',
      last_verification_reason: null,
      verification_failures: 0,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);

    const { error: upErr } = await admin.from('external_properties').update(update).eq('id', id);
    if (upErr) throw upErr;

    return new Response(JSON.stringify({
      success: true,
      id,
      marketplace,
      images_found: scrapedImages.length,
      images_saved: finalImages.length,
      updated_fields: Object.keys(update),
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[recrawl-external-listing] fatal:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
