import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXCLUDE_NUMBERS = ['19001881', '1900', '19006263'];

// A Vietnamese mobile in local form: 10 digits, 0 then 3/5/7/8/9.
//
// The old acceptance test was `^0\d{9,10}$`, which takes 11-digit numbers and
// the 01x prefixes retired in 2018 - and, combined with the `'0' + digits`
// fallback below, turned any 9-to-10-digit field in a JSON payload into a phone
// number. `ad_id` on a chotot ad is 9 digits, so every nhatot listing would have
// been stamped with '0' + ad_id. See extractNhatotPhoneFromAd.
function isPlausibleVnMobile(local: string): boolean {
  return /^0(3|5|7|8|9)\d{8}$/.test(local);
}

function cleanPhoneNumber(raw: string): string | null {
  if (!raw) return null;
  if (raw.includes('*')) return null;
  let cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+84')) cleaned = '0' + cleaned.slice(3);
  if (cleaned.startsWith('84') && cleaned.length > 10) cleaned = '0' + cleaned.slice(2);
  // A bare 9-digit national number ("901234567") is a real form on some pages,
  // so it still gets its leading zero - but only the validator decides whether
  // the result is a phone.
  if (/^\d{9}$/.test(cleaned)) cleaned = '0' + cleaned;
  return isPlausibleVnMobile(cleaned) ? cleaned : null;
}

// Chotot masks the number but leaves its opening digits visible: "036666****".
// Those digits are real, which makes them a free validator - a candidate that
// does not start with them is not this seller's number, whatever else it looks
// like. Returns null when there is no usable mask, in which case nothing can be
// confirmed and nothing should be stored.
function maskPrefixOf(masked: unknown): string | null {
  if (typeof masked !== 'string') return null;
  const digits = masked.replace(/[^\d]/g, '');
  // Needs enough prefix to mean something. Six digits pins the carrier block
  // and most of the subscriber number.
  return digits.length >= 5 ? digits : null;
}

function detectMarketplace(url: string): string | null {
  if (url.includes('batdongsan.com.vn')) return 'batdongsan';
  if (url.includes('nhatot.com') || url.includes('chotot.com')) return 'nhatot';
  return null;
}

function getCookieString(marketplace: string): string {
  if (marketplace === 'batdongsan') return Deno.env.get('BATDONGSAN_COOKIES') || '';
  if (marketplace === 'nhatot') return Deno.env.get('NHATOT_COOKIES') || '';
  return '';
}

function buildExtractJS(): string {
  return `(async () => {
    const revealTexts = ['Hiện số', 'Xem SĐT', 'Xem số', 'Bấm để hiện', 'Hiện số điện thoại', 'Show phone'];
    const clickSelectors = [
      '.re__btn-short-info-phone',
      '.js__phone-btn',
      '.js__phone',
      '.re__contact-phone button',
      '.re__contact-phone a',
      '[data-aut-id="btnPhone"]',
      'button[class*="phone"]',
      'button[class*="Phone"]',
      '[class*="phone-button"]'
    ];
    const readSelectors = [
      'a[href^="tel:"]',
      '.re__contact-phone',
      '[class*="phone-number"]',
      '[class*="PhoneNumber"]',
      '[class*="phone__number"]',
      '[class*="ContactPhone"]',
      '[class*="phone"]',
      '[class*="Phone"]'
    ];

    const normalize = (value) => {
      if (!value || value.includes('*')) return null;
      let cleaned = value.replace(/[^\d+]/g, '');
      if (cleaned.startsWith('+84')) cleaned = '0' + cleaned.slice(3);
      if (cleaned.startsWith('84') && cleaned.length > 10) cleaned = '0' + cleaned.slice(2);
      if (/^0\d{9,10}$/.test(cleaned)) return cleaned;
      if (/^\d{9,10}$/.test(cleaned)) return '0' + cleaned;
      return null;
    };

    const readPhoneFromText = (value) => {
      if (!value) return null;
      const matches = value.match(/(?:\+84|84|0)[3-9]\d[\s.-]?\d{3}[\s.-]?\d{4}/g) || [];
      for (const match of matches) {
        const phone = normalize(match);
        if (phone) return phone;
      }
      return null;
    };

    const extractFromDom = () => {
      for (const selector of readSelectors) {
        const nodes = document.querySelectorAll(selector);
        for (const node of nodes) {
          const href = node.getAttribute?.('href') || '';
          const phone = normalize(href.replace('tel:', '')) || readPhoneFromText(node.textContent || '');
          if (phone) return phone;
        }
      }
      return readPhoneFromText(document.body?.innerText || '');
    };

    const initial = extractFromDom();
    if (initial) return JSON.stringify({ phone: initial, method: 'browserless_dom_initial' });

    const clickTargets = document.querySelectorAll('button, a, span, div, [role="button"]');
    for (const node of clickTargets) {
      const label = (node.textContent || '').trim();
      if (revealTexts.some((text) => label.includes(text))) {
        node.click?.();
      }
    }
    for (const selector of clickSelectors) {
      for (const node of document.querySelectorAll(selector)) {
        node.click?.();
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
    const afterClick = extractFromDom();
    return JSON.stringify({
      phone: afterClick,
      method: afterClick ? 'browserless_dom_after_click' : 'browserless_dom_miss',
    });
  })()`;
}

function parseCookieStringToArray(cookieStr: string, domain: string): Array<{name: string; value: string; domain: string; path: string}> {
  if (!cookieStr) return [];
  return cookieStr.split(';').map(pair => {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) return null;
    const name = pair.substring(0, eqIdx).trim();
    const value = pair.substring(eqIdx + 1).trim();
    if (!name) return null;
    return { name, value, domain, path: '/' };
  }).filter(Boolean) as Array<{name: string; value: string; domain: string; path: string}>;
}

function parsePhoneResult(resultStr: string | undefined | null): { phone: string | null; method: string; debug?: Record<string, unknown> } {
  if (!resultStr) return { phone: null, method: 'no_result' };
  try {
    const data = JSON.parse(resultStr);
    if (data.phone) {
      const phone = cleanPhoneNumber(data.phone);
      if (phone) return { phone, method: data.method };
    }
    return { phone: null, method: data.method || 'parse_no_phone', debug: data.debug || { title: data.title, bodyLen: data.bodyLen, url: data.url } };
  } catch {
    return { phone: null, method: 'parse_error' };
  }
}

// Layer 1 (Batdongsan): parse phone from HTML response (JSON-LD, __NUXT__, embedded scripts)
// — no Browserless cost. Returns null if nothing found in HTML.
async function tryBatdongsanHTMLParse(listingUrl: string): Promise<{ phone: string | null; method: string }> {
  try {
    const cookieStr = Deno.env.get('BATDONGSAN_COOKIES') || '';
    const resp = await fetch(listingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        ...(cookieStr ? { Cookie: cookieStr } : {}),
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return { phone: null, method: `bds_html_${resp.status}` };
    const html = await resp.text();

    // 1. tel: links
    const tel = html.match(/href=["']tel:([^"']+)["']/i);
    if (tel) {
      const cleaned = cleanPhoneNumber(tel[1]);
      if (cleaned && !EXCLUDE_NUMBERS.some(ex => cleaned.includes(ex))) {
        return { phone: cleaned, method: 'bds_html_tel' };
      }
    }

    // 2. JSON-LD blocks
    const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let ldMatch: RegExpExecArray | null;
    while ((ldMatch = ldRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(ldMatch[1].trim());
        const found = deepFindPhoneInObject(data);
        if (found) return { phone: found, method: 'bds_html_jsonld' };
      } catch { /* skip */ }
    }

    // 3. __NUXT__ / __NEXT_DATA__ / window.__INITIAL_STATE__ payloads
    const payloadRegex = /(?:window\.__NUXT__|window\.__NEXT_DATA__|window\.__INITIAL_STATE__)\s*=\s*({[\s\S]*?});?\s*<\/script>/g;
    let pm: RegExpExecArray | null;
    while ((pm = payloadRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(pm[1]);
        const found = deepFindPhoneInObject(data);
        if (found) return { phone: found, method: 'bds_html_payload' };
      } catch { /* skip */ }
    }

    // 4. Body text regex (sometimes phone is in description text, not masked)
    const bodyMatches = html.match(/0[3-9]\d[\s.-]?\d{3}[\s.-]?\d{4}/g);
    if (bodyMatches) {
      for (const m of bodyMatches) {
        if (m.includes('*')) continue;
        const cleaned = cleanPhoneNumber(m);
        if (cleaned && !EXCLUDE_NUMBERS.some(ex => cleaned.includes(ex))) {
          return { phone: cleaned, method: 'bds_html_body' };
        }
      }
    }

    return { phone: null, method: 'bds_html_not_found' };
  } catch (err) {
    console.error('[extract-phone] BDS HTML parse error:', err);
    return { phone: null, method: 'bds_html_error' };
  }
}

// Direct Chotot API fetch for Nhatot - no browser needed
async function tryNhatotDirectFetch(listingUrl: string): Promise<{ phone: string | null; method: string }> {
  try {
    // Extract listing ID from URL
    const listingIdMatch = listingUrl.match(/(\d+)\.htm/);
    if (!listingIdMatch) return { phone: null, method: 'nhatot_no_listing_id' };
    const listingId = listingIdMatch[1];

    // Try mobile-app gateway headers first — returns unmasked contact_phone for most listings
    const mobileHeaders = {
      'User-Agent': 'Chotot/4.94.0 (iPhone; iOS 17.4; Scale/3.00)',
      'Accept': 'application/json',
      'Accept-Language': 'vi-VN,vi;q=0.9',
      'x-app-version': '4.94.0',
      'x-device-platform': 'ios',
      'x-client-id': 'chotot-ios',
    };
    const mobileResp = await fetch(`https://gateway.chotot.com/v1/public/ad-listing/${listingId}`, {
      headers: mobileHeaders,
      signal: AbortSignal.timeout(12000),
    });
    if (mobileResp.ok) {
      const mobileData = await mobileResp.json();
      const ad = mobileData?.ad;
      if (ad) {
        const found = extractNhatotPhoneFromAd(ad);
        if (found) {
          console.log(`[extract-phone] Nhatot mobile API found phone matching its own mask: ${found}`);
          return { phone: found, method: 'nhatot_mobile_api' };
        }
      }
    } else {
      console.log(`[extract-phone] Nhatot mobile API ${mobileResp.status}, falling back to web headers`);
    }

    // Fallback to standard web request
    const apiResp = await fetch(`https://gateway.chotot.com/v1/public/ad-listing/${listingId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    
    if (!apiResp.ok) {
      console.log(`[extract-phone] Chotot API returned ${apiResp.status}`);
      return { phone: null, method: `nhatot_api_${apiResp.status}` };
    }
    
    const apiData = await apiResp.json();
    const ad = apiData?.ad;
    if (!ad) return { phone: null, method: 'nhatot_api_no_ad' };
    
    // The 'phone' field is always masked (e.g. "086293****"), skip it
    // Instead search the body/description text for full phone numbers
    const body = ad.body || '';
    const subject = ad.subject || '';
    const fullName = ad.full_name || ad.account_name || '';
    const searchText = `${body} ${subject} ${fullName}`;
    
    console.log(`[extract-phone] Chotot API: phone=${ad.phone}, body=${body.length} chars, account=${ad.account_name}`);
    
    // Search for unmasked phone numbers in body text
    const phoneMatches = searchText.match(/0[3-9]\d[\s.-]?\d{3}[\s.-]?\d{4}/g);
    if (phoneMatches) {
      for (const m of phoneMatches) {
        if (m.includes('*')) continue;
        const cleaned = cleanPhoneNumber(m);
        if (cleaned && !EXCLUDE_NUMBERS.some(ex => cleaned.includes(ex))) {
          console.log(`[extract-phone] Found full phone in Nhatot body: ${cleaned}`);
          return { phone: cleaned, method: 'nhatot_body_text' };
        }
      }
    }
    
    // Also try +84 format
    const intlMatches = searchText.match(/\+84\s?\d[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{3}/g);
    if (intlMatches) {
      for (const m of intlMatches) {
        if (m.includes('*')) continue;
        const cleaned = cleanPhoneNumber(m);
        if (cleaned && !EXCLUDE_NUMBERS.some(ex => cleaned.includes(ex))) {
          console.log(`[extract-phone] Found intl phone in Nhatot body: ${cleaned}`);
          return { phone: cleaned, method: 'nhatot_body_intl' };
        }
      }
    }
    
    // Store the masked phone as fallback info (better than nothing for debugging)
    const maskedPhone = ad.phone || '';
    console.log(`[extract-phone] Nhatot: only masked phone available: ${maskedPhone}`);
    return { phone: null, method: 'nhatot_masked_only' };
  } catch (err) {
    console.error(`[extract-phone] Nhatot direct fetch error:`, err);
    return { phone: null, method: 'nhatot_direct_error' };
  }
}

// Deep search an object for phone number values
// Pull a phone out of a chotot ad payload, and only accept it if it agrees with
// the mask the payload itself publishes.
//
// This replaces a blind deep scan for anything phone-shaped. Verified against
// live ads, that scan returned:
//
//   ad 122149828   mask 036666****   scan said 0164218476   (= '0' + ad_id)
//   ad 134590988   mask 098890****   scan said 0178660662
//   ad 130451019   mask 094286****   scan said 0173821946
//
// None match their own mask, and all begin 01x, a prefix Vietnam retired in
// 2018. It was reading `ad_id`. Nothing had noticed because the extractor has
// never completed a run - had it run, every nhatot listing would carry a
// confidently wrong number, and ops would have rung it.
function extractNhatotPhoneFromAd(ad: Record<string, unknown>): string | null {
  const prefix = maskPrefixOf(ad?.phone);
  const candidates: string[] = [];
  const walk = (v: unknown, depth = 0) => {
    if (!v || depth > 12 || candidates.length > 50) return;
    if (typeof v === 'string' || typeof v === 'number') {
      const c = cleanPhoneNumber(String(v));
      if (c) candidates.push(c);
      return;
    }
    if (Array.isArray(v)) { for (const i of v) walk(i, depth + 1); return; }
    if (typeof v === 'object') { for (const k of Object.keys(v as object)) walk((v as Record<string, unknown>)[k], depth + 1); }
  };
  walk(ad);

  if (!prefix) {
    // No mask to check against. An unvalidated guess is worse than no number:
    // a blank field gets resolved on demand, a wrong one gets dialled.
    console.log('[extract-phone] nhatot ad carries no usable phone mask - not guessing');
    return null;
  }
  const match = candidates.find(c => c.startsWith(prefix));
  if (!match) {
    console.log(`[extract-phone] nhatot: ${candidates.length} candidate(s), none matching mask ${prefix}****`);
    return null;
  }
  return match;
}

function deepFindPhoneInObject(obj: unknown, depth = 0): string | null {
  if (!obj || depth > 12) return null;
  if (typeof obj === 'string') {
    if (obj.includes('*')) return null; // Skip masked numbers
    const trimmed = obj.trim();
    if (/^\+?\d[\d\s.-]{8,14}$/.test(trimmed)) {
      const cleaned = cleanPhoneNumber(trimmed);
      if (cleaned && !EXCLUDE_NUMBERS.some(ex => cleaned.includes(ex))) return cleaned;
    }
    return null;
  }
  if (typeof obj === 'number') {
    const numStr = String(obj);
    if (/^\d{9,11}$/.test(numStr)) {
      const cleaned = cleanPhoneNumber(numStr);
      if (cleaned && !EXCLUDE_NUMBERS.some(ex => cleaned.includes(ex))) return cleaned;
    }
    return null;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = deepFindPhoneInObject(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === 'object' && obj !== null) {
    const record = obj as Record<string, unknown>;
    // Priority keys
    const phoneKeys = ['phone', 'phone_number', 'phoneNumber', 'mobile', 'contact_phone', 'seller_phone', 'account_phone', 'phone_hidden'];
    for (const pk of phoneKeys) {
      if (pk in record) {
        const r = deepFindPhoneInObject(record[pk], depth + 1);
        if (r) return r;
      }
    }
    for (const key of Object.keys(record)) {
      if (phoneKeys.includes(key)) continue;
      const r = deepFindPhoneInObject(record[key], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

async function extractPhoneForListing(listingUrl: string, marketplace: string): Promise<{ phone: string | null; method: string }> {
  // For Nhatot: try direct HTTP fetch first (no browser needed, faster & free)
  if (marketplace === 'nhatot') {
    const directResult = await tryNhatotDirectFetch(listingUrl);
    // For Nhatot, don't fall back to Browserless (Cloudflare blocks it too)
    return directResult;
  }

  // Batdongsan Layer 1: try HTML parse first (free, no Browserless)
  if (marketplace === 'batdongsan') {
    const htmlResult = await tryBatdongsanHTMLParse(listingUrl);
    if (htmlResult.phone) {
      console.log(`[extract-phone] BDS HTML parse hit (${htmlResult.method}): ${htmlResult.phone}`);
      return htmlResult;
    }
    console.log(`[extract-phone] BDS HTML parse miss (${htmlResult.method}), falling back to Browserless click`);
  }

  if (!BROWSERLESS_API_KEY) throw new Error('BROWSERLESS_API_KEY not configured');

  const cookieStr = getCookieString(marketplace);
  const domain = marketplace === 'batdongsan' ? '.batdongsan.com.vn' : '.nhatot.com';
  const cookies = parseCookieStringToArray(cookieStr, domain);
  const hasCookies = cookies.length > 0;

  const jsCode = buildExtractJS();

  try {
    console.log(`[extract-phone] Extracting from ${listingUrl} (cookies: ${hasCookies ? cookies.length : 'none'})`);

    // Use Browserless /function API which supports setting cookies via puppeteer-like interface
    // BQL approach: use two-step - first set cookies via a blank page, then navigate
    let query: string;
    const variables: Record<string, unknown> = { url: listingUrl, jsCode };

    if (hasCookies) {
      // Navigate to domain root first, inject cookies client-side, then go to listing
      // Use verify to handle Cloudflare "Are you human?" interstitials
      const domainUrl = marketplace === 'batdongsan' ? 'https://batdongsan.com.vn/' : 'https://www.nhatot.com/';
      const setCookieJS = `(async () => {
        var pairs = ${JSON.stringify(cookieStr)}.split('; ');
        for (var i = 0; i < pairs.length; i++) document.cookie = pairs[i] + '; path=/';
        return pairs.length;
      })()`;
      
      query = `mutation ExtractPhone($url: String!, $jsCode: String!) {
  domainPage: goto(url: "${domainUrl}", waitUntil: domContentLoaded) { status }
  verifyDomain: verify(type: cloudflare) { found solved }
  setCookies: evaluate(content: ${JSON.stringify(setCookieJS)}, timeout: 5000) { value }
  gotoListing: goto(url: $url, waitUntil: networkIdle) { status url }
  verifyListing: verify(type: cloudflare) { found solved }
  phoneData: evaluate(content: $jsCode, timeout: 45000) { value }
}`;
    } else {
      query = `mutation ExtractPhone($url: String!, $jsCode: String!) {
  goto(url: $url, waitUntil: networkIdle) { status url }
  verifyPage: verify(type: cloudflare) { found solved }
  reloadAfterVerify: goto(url: $url, waitUntil: networkIdle) { status url }
  phoneData: evaluate(content: $jsCode, timeout: 45000) { value }
}`;
    }

    const response = await fetch(`https://production-sfo.browserless.io/chromium/bql?token=${BROWSERLESS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(90000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[extract-phone] Browserless error [${response.status}]: ${errorText.substring(0, 300)}`);
      return { phone: null, method: `browserless_error_${response.status}` };
    }

    const result = await response.json();
    
    // Log full BQL response for debugging
    console.log(`[extract-phone] BQL response keys: ${JSON.stringify(Object.keys(result.data || {}))}`);
    if (result.data?.gotoListing) {
      console.log(`[extract-phone] Goto listing: status=${result.data.gotoListing.status}, url=${result.data.gotoListing.url}`);
    }
    if (result.data?.goto) {
      console.log(`[extract-phone] Goto: status=${result.data.goto.status}, url=${result.data.goto.url}`);
    }
    if (result.data?.verifyDomain) {
      console.log(`[extract-phone] Verify domain: found=${result.data.verifyDomain.found}, solved=${result.data.verifyDomain.solved}`);
    }
    if (result.data?.verifyListing) {
      console.log(`[extract-phone] Verify listing: found=${result.data.verifyListing.found}, solved=${result.data.verifyListing.solved}`);
    }
    if (result.data?.verifyPage) {
      console.log(`[extract-phone] Verify page: found=${result.data.verifyPage.found}, solved=${result.data.verifyPage.solved}`);
    }
    if (result.data?.reloadAfterVerify) {
      console.log(`[extract-phone] Reload after verify: status=${result.data.reloadAfterVerify.status}, url=${result.data.reloadAfterVerify.url}`);
    }
    
    if (result.errors) {
      console.error(`[extract-phone] BQL errors: ${JSON.stringify(result.errors).substring(0, 500)}`);
    }
    if (hasCookies && result.data?.setCookies?.value) {
      console.log(`[extract-phone] Cookie injection: ${result.data.setCookies.value}`);
    }
    
    const rawValue = result?.data?.phoneData?.value;
    console.log(`[extract-phone] Raw evaluate value: ${typeof rawValue === 'string' ? rawValue.substring(0, 500) : rawValue}`);
    
    const phoneResult = parsePhoneResult(rawValue);
    console.log(`[extract-phone] Result: ${JSON.stringify(phoneResult).substring(0, 500)}`);
    return phoneResult;
  } catch (error) {
    console.error(`[extract-phone] Error:`, error);
    return { phone: null, method: 'error' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    // pg_cron authenticates with the dedicated cron secret, the same way
    // scheduled-crawl does. The vault holds no service-role key, and the anon
    // key is published in the client bundle so it proves nothing.
    const cronSecret = req.headers.get('x-cron-secret') || '';
    let authorizedByCron = false;
    if (cronSecret) {
      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data, error } = await svc.rpc('verify_cron_secret', { _token: cronSecret });
      if (error) console.error('[extract-phone] cron secret check failed:', error.message);
      authorizedByCron = data === true;
      if (!authorizedByCron) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (!authorizedByCron && authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
      const isAnonKey = token === anonKey;
      if (!isServiceRole && !isAnonKey) {
        const supabaseAuth = createClient(SUPABASE_URL, anonKey!, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData, error: authError } = await supabaseAuth.auth.getUser(token);
        if (authError || !userData?.user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    if (!BROWSERLESS_API_KEY) {
      return new Response(JSON.stringify({ error: 'BROWSERLESS_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { listings, propertyId, sourceUrl, marketplace: explicitMarketplace } = body;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Helper: persist successful phone or increment attempts on failure
    const recordResult = async (id: string | undefined, phone: string | null) => {
      if (!id) return;
      if (phone) {
        await supabase.from('external_properties').update({
          contact_phone: phone,
          phone_extraction_attempts: 0,
          updated_at: new Date().toISOString(),
        }).eq('id', id);

        // A revealed number is the expensive half of realtor identity, so it
        // gets attached rather than left in a text column for someone to
        // rediscover. normalize_vn_phone is the same function the ingest path
        // and the S2 backfill use, so `realtors.phone_e164` cannot drift
        // between the three ways a number can arrive.
        const { data: e164 } = await supabase.rpc('normalize_vn_phone', { raw: phone });
        if (e164) {
          const { data: existing } = await supabase
            .from('realtors').select('id').eq('phone_e164', e164).maybeSingle();
          let realtorId = existing?.id as string | undefined;
          if (!realtorId) {
            const { data: created } = await supabase
              .from('realtors').insert({ phone_e164: e164 }).select('id').maybeSingle();
            realtorId = created?.id as string | undefined;
          }
          if (realtorId) {
            await supabase.from('external_properties')
              .update({ realtor_id: realtorId }).eq('id', id);
            // Tie it to the source's own id for this seller where we have one,
            // so the next listing from them resolves without another reveal.
            const { data: row } = await supabase.from('external_properties')
              .select('source, source_agent_id').eq('id', id).maybeSingle();
            if (row?.source_agent_id) {
              await supabase.from('realtor_identities').upsert(
                { realtor_id: realtorId, source: row.source, source_agent_id: row.source_agent_id },
                { onConflict: 'source,source_agent_id' },
              ).then(() => {}, (e: Error) => console.warn('[extract-phone] identity upsert failed:', e.message));
            }
          }
        }
      } else {
        const { data: cur } = await supabase
          .from('external_properties')
          .select('phone_extraction_attempts')
          .eq('id', id).maybeSingle();
        const next = (cur?.phone_extraction_attempts ?? 0) + 1;
        await supabase.from('external_properties').update({
          phone_extraction_attempts: next,
          updated_at: new Date().toISOString(),
        }).eq('id', id);
      }
    };

    // Mode 1: Single property
    if (propertyId && sourceUrl) {
      const marketplace = explicitMarketplace || detectMarketplace(sourceUrl);
      if (!marketplace) {
        return new Response(JSON.stringify({ error: 'Cannot detect marketplace from URL', sourceUrl }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { phone, method } = await extractPhoneForListing(sourceUrl, marketplace);
      await recordResult(propertyId, phone);
      if (phone) console.log(`[extract-phone] Updated ${propertyId} with ${phone}`);
      return new Response(JSON.stringify({ success: true, phone, method, propertyId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mode 2: Batch extraction
    if (Array.isArray(listings) && listings.length > 0) {
      const batch = listings.slice(0, 10);
      const results: Array<{ sourceUrl: string; phone: string | null; method: string; propertyId?: string }> = [];
      let extracted = 0;

      for (const listing of batch) {
        const url = listing.sourceUrl || listing.source_url;
        const id = listing.propertyId || listing.id;
        const mp = listing.marketplace || listing.source || detectMarketplace(url);
        if (!url || !mp) { results.push({ sourceUrl: url, phone: null, method: 'invalid_input' }); continue; }

        const { phone, method } = await extractPhoneForListing(url, mp);
        results.push({ sourceUrl: url, phone, method, propertyId: id });
        await recordResult(id, phone);
        if (phone && id) extracted++;
        if (batch.indexOf(listing) < batch.length - 1) await new Promise(r => setTimeout(r, 2000));
      }

      return new Response(JSON.stringify({ success: true, total: batch.length, extracted, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mode 3: Auto-fill (skip listings that have already failed 3+ times)
    if (body.autoFill) {
      const limit = Math.min(body.limit || 5, 10);
      // "Missing a phone" means missing a DIALABLE one. Selecting on
      // `contact_phone IS NULL` skipped the 404 rows holding a masked value -
      // which is every row that actually needed this function.
      const { data: missingPhone } = await supabase
        .from('external_properties').select('id, source_url, source, phone_extraction_attempts')
        .or('contact_phone.is.null,contact_phone.like.%*%')
        .eq('is_active', true)
        .lt('phone_extraction_attempts', 3)
        .order('created_at', { ascending: false }).limit(limit);

      if (!missingPhone || missingPhone.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No properties missing phone numbers (or all exhausted retry budget)', extracted: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const results: Array<{ id: string; phone: string | null; method: string }> = [];
      let extracted = 0;

      for (const prop of missingPhone) {
        const mp = prop.source || detectMarketplace(prop.source_url);
        if (!mp) { results.push({ id: prop.id, phone: null, method: 'unsupported' }); continue; }
        const { phone, method } = await extractPhoneForListing(prop.source_url, mp);
        results.push({ id: prop.id, phone, method });
        await recordResult(prop.id, phone);
        if (phone) extracted++;
        if (missingPhone.indexOf(prop) < missingPhone.length - 1) await new Promise(r => setTimeout(r, 2000));
      }

      return new Response(JSON.stringify({ success: true, total: missingPhone.length, extracted, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Provide either {propertyId, sourceUrl}, {listings: [...]}, or {autoFill: true}' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[extract-phone] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error', success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
