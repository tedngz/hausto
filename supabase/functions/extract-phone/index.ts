import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXCLUDE_NUMBERS = ['19001881', '1900', '19006263'];

function cleanPhoneNumber(raw: string): string | null {
  if (!raw) return null;
  if (raw.includes('*')) return null;
  let cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+84')) cleaned = '0' + cleaned.slice(3);
  if (cleaned.startsWith('84') && cleaned.length > 10) cleaned = '0' + cleaned.slice(2);
  if (/^0\d{9,10}$/.test(cleaned)) return cleaned;
  if (/^\d{9,10}$/.test(cleaned)) return '0' + cleaned;
  return null;
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
    await new Promise(r => setTimeout(r, 2000));
    
    var exclude = ${JSON.stringify(EXCLUDE_NUMBERS)};
    function isExcluded(p) {
      var digits = p.replace(/[^0-9]/g, '');
      for (var i = 0; i < exclude.length; i++) { if (digits.indexOf(exclude[i]) >= 0) return true; }
      return false;
    }
    function isMasked(p) { return p.indexOf('*') >= 0; }
    function isValidPhone(p) {
      return p && !isMasked(p) && p.replace(/[^0-9]/g, '').length >= 9 && !isExcluded(p);
    }
    function findPhoneInText(text) {
      var m = text.match(/0[3-9]\\d[\\s.-]?\\d{3}[\\s.-]?\\d{4}/g);
      if (m) { for (var i = 0; i < m.length; i++) { if (!isMasked(m[i]) && !isExcluded(m[i])) return m[i]; } }
      return null;
    }
    
    // Step 1: Check existing tel: links
    var telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (var i = 0; i < telLinks.length; i++) {
      var phone = telLinks[i].getAttribute('href').replace('tel:', '').trim();
      if (isValidPhone(phone)) return JSON.stringify({phone: phone, method: 'tel_link'});
    }
    
    var isBDS = window.location.hostname.indexOf('batdongsan') >= 0;
    var isNhatot = window.location.hostname.indexOf('nhatot') >= 0 || window.location.hostname.indexOf('chotot') >= 0;
    
    // For Nhatot - deep parse __NEXT_DATA__ for phone fields
    if (isNhatot) {
      try {
        var nextData = document.getElementById('__NEXT_DATA__');
        if (nextData) {
          var ndStr = nextData.textContent || '';
          
          // Deep search JSON for phone-like keys
          function deepFindPhone(obj, depth) {
            if (!obj || depth > 10) return null;
            if (typeof obj === 'string') {
              if (/^\\+?\\d[\\d\\s.-]{8,14}$/.test(obj.trim())) {
                var cleaned = obj.replace(/[^0-9+]/g, '');
                if (cleaned.startsWith('+84')) cleaned = '0' + cleaned.slice(3);
                if (cleaned.startsWith('84') && cleaned.length > 10) cleaned = '0' + cleaned.slice(2);
                if (/^0[3-9]\\d{8,9}$/.test(cleaned) && !isExcluded(cleaned)) return cleaned;
              }
              return null;
            }
            if (Array.isArray(obj)) {
              for (var ai = 0; ai < obj.length; ai++) {
                var r = deepFindPhone(obj[ai], depth + 1);
                if (r) return r;
              }
              return null;
            }
            if (typeof obj === 'object') {
              // Prioritize phone-related keys
              var phoneKeys = ['phone', 'phone_number', 'phoneNumber', 'mobile', 'contact_phone', 'seller_phone', 'account_phone'];
              for (var pk = 0; pk < phoneKeys.length; pk++) {
                if (obj[phoneKeys[pk]]) {
                  var pv = deepFindPhone(obj[phoneKeys[pk]], depth + 1);
                  if (pv) return pv;
                }
              }
              // Then check all other keys
              var keys = Object.keys(obj);
              for (var ki = 0; ki < keys.length; ki++) {
                if (phoneKeys.indexOf(keys[ki]) >= 0) continue;
                var kv = deepFindPhone(obj[keys[ki]], depth + 1);
                if (kv) return kv;
              }
            }
            return null;
          }
          
          try {
            var parsed = JSON.parse(ndStr);
            var deepPhone = deepFindPhone(parsed, 0);
            if (deepPhone) return JSON.stringify({phone: deepPhone, method: 'nhatot_next_data_deep'});
          } catch(pe) {}
          
          // Fallback: regex on raw text
          var phoneMatch = findPhoneInText(ndStr);
          if (phoneMatch) return JSON.stringify({phone: phoneMatch, method: 'nhatot_next_data_regex'});
        }
      } catch(ex) {}
      
      // Also check Nhatot API responses embedded in page (window.__NEXT_DATA__.props.pageProps)
      try {
        var scripts = document.querySelectorAll('script[type="application/json"]');
        for (var si = 0; si < scripts.length; si++) {
          var sText = scripts[si].textContent || '';
          if (sText.indexOf('phone') >= 0 || sText.indexOf('Phone') >= 0) {
            try {
              var sData = JSON.parse(sText);
              var sPhone = deepFindPhone(sData, 0);
              if (sPhone) return JSON.stringify({phone: sPhone, method: 'nhatot_script_json'});
            } catch(se) {}
          }
        }
      } catch(ex2) {}
    }
    
    // Step 2: Set up XHR/fetch interception BEFORE clicking
    var interceptedPhones = [];
    var origFetch = window.fetch;
    window.fetch = function() {
      var args = arguments;
      return origFetch.apply(this, args).then(function(resp) {
        try {
          var url = '';
          if (typeof args[0] === 'string') url = args[0];
          else if (args[0] && args[0].url) url = args[0].url;
          if (url.indexOf('Phone') >= 0 || url.indexOf('phone') >= 0 || url.indexOf('ecrypt') >= 0 || url.indexOf('contact') >= 0) {
            resp.clone().text().then(function(t) {
              try {
                var d = JSON.parse(t);
                var vals = Object.values(d);
                for (var vi = 0; vi < vals.length; vi++) {
                  if (typeof vals[vi] === 'string' && /0[3-9]\\d{8,9}/.test(vals[vi].replace(/[^0-9]/g, ''))) {
                    interceptedPhones.push(vals[vi]);
                  }
                }
              } catch(e) {
                var fm = t.match(/0[3-9]\\d{8}/);
                if (fm) interceptedPhones.push(fm[0]);
              }
            });
          }
        } catch(e) {}
        return resp;
      });
    };
    var origXHROpen = XMLHttpRequest.prototype.open;
    var origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(m, u) { this._url = u; return origXHROpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function() {
      var xhr = this;
      xhr.addEventListener('load', function() {
        var u = xhr._url || '';
        if (u.indexOf('Phone') >= 0 || u.indexOf('phone') >= 0 || u.indexOf('ecrypt') >= 0 || u.indexOf('contact') >= 0) {
          try {
            var d = JSON.parse(xhr.responseText);
            var vals = Object.values(d);
            for (var vi = 0; vi < vals.length; vi++) {
              if (typeof vals[vi] === 'string' && /0[3-9]\\d{8,9}/.test(vals[vi].replace(/[^0-9]/g, ''))) {
                interceptedPhones.push(vals[vi]);
              }
            }
          } catch(e) {
            var fm = (xhr.responseText || '').match(/0[3-9]\\d{8}/);
            if (fm) interceptedPhones.push(fm[0]);
          }
        }
      });
      return origXHRSend.apply(this, arguments);
    };
    
    // Step 3: Click ALL reveal buttons - try multiple rounds
    var clickedAny = false;
    
    // Round 1: Click by text content
    var revealTexts = ['Hiện số', 'Xem SĐT', 'Xem số', 'Bấm để hiện', 'Hiện số điện thoại', 'Show phone'];
    var clickableEls = document.querySelectorAll('button, a, span, div, [role="button"]');
    for (var j = 0; j < clickableEls.length; j++) {
      var txt = (clickableEls[j].textContent || '').trim();
      for (var rt = 0; rt < revealTexts.length; rt++) {
        if (txt.indexOf(revealTexts[rt]) >= 0) {
          clickableEls[j].click();
          clickedAny = true;
        }
      }
    }
    
    // Round 2: Click by CSS selectors common on BDS/Nhatot
    var revealSels = [
      '.re__btn-short-info-phone', '.js__phone-btn', '.js__phone',
      '[class*="phone"] button', '[class*="Phone"] button',
      '.re__contact-phone button', '.re__contact-phone a',
      '[class*="ContactPhone"] button', '[data-aut-id="btnPhone"]',
      'button[class*="phone"]', 'button[class*="Phone"]',
      '.phone-show-btn', '[class*="reveal"]',
      '.re__btn-icon-phone', '[class*="phone-button"]'
    ];
    for (var rsi = 0; rsi < revealSels.length; rsi++) {
      try {
        var els = document.querySelectorAll(revealSels[rsi]);
        for (var e = 0; e < els.length; e++) { els[e].click(); clickedAny = true; }
      } catch(ex) {}
    }
    
    // Wait for AJAX response after clicks
    if (clickedAny) {
      // Wait up to 8 seconds, checking every 500ms
      for (var wait = 0; wait < 16; wait++) {
        await new Promise(r => setTimeout(r, 500));
        
        // Check intercepted phones
        for (var ip = 0; ip < interceptedPhones.length; ip++) {
          if (isValidPhone(interceptedPhones[ip])) {
            return JSON.stringify({phone: interceptedPhones[ip], method: 'xhr_intercept_after_click'});
          }
        }
        
        // Check if new tel: links appeared
        var newTels = document.querySelectorAll('a[href^="tel:"]');
        for (var nt = 0; nt < newTels.length; nt++) {
          var tp = newTels[nt].getAttribute('href').replace('tel:', '').trim();
          if (isValidPhone(tp)) return JSON.stringify({phone: tp, method: 'tel_link_after_click'});
        }
        
        // Check if phone number appeared in phone-related elements
        var phoneSels2 = ['[class*="phone-number"]', '[class*="PhoneNumber"]', '[class*="phone__number"]', '.re__contact-phone', '[class*="ContactPhone"]'];
        for (var ps2 = 0; ps2 < phoneSels2.length; ps2++) {
          try {
            var pels2 = document.querySelectorAll(phoneSels2[ps2]);
            for (var pe2 = 0; pe2 < pels2.length; pe2++) {
              var ptxt2 = pels2[pe2].textContent.trim();
              var found2 = findPhoneInText(ptxt2);
              if (found2) return JSON.stringify({phone: found2, method: 'phone_element_after_click'});
            }
          } catch(ex) {}
        }
      }
      
      // One more click attempt - sometimes the first click just opens a dropdown
      for (var j2 = 0; j2 < clickableEls.length; j2++) {
        var txt2 = (clickableEls[j2].textContent || '').trim();
        for (var rt2 = 0; rt2 < revealTexts.length; rt2++) {
          if (txt2.indexOf(revealTexts[rt2]) >= 0) {
            clickableEls[j2].click();
          }
        }
      }
      await new Promise(r => setTimeout(r, 3000));
      
      // Final check after second click round
      for (var ip2 = 0; ip2 < interceptedPhones.length; ip2++) {
        if (isValidPhone(interceptedPhones[ip2])) {
          return JSON.stringify({phone: interceptedPhones[ip2], method: 'xhr_intercept_retry'});
        }
      }
      var finalTels = document.querySelectorAll('a[href^="tel:"]');
      for (var ft = 0; ft < finalTels.length; ft++) {
        var fp = finalTels[ft].getAttribute('href').replace('tel:', '').trim();
        if (isValidPhone(fp)) return JSON.stringify({phone: fp, method: 'tel_link_retry'});
      }
    }
    
    // Step 4: Body text regex scan (catches phones in description text)
    var bodyText = document.body.innerText;
    var bodyPhone = findPhoneInText(bodyText);
    if (bodyPhone) return JSON.stringify({phone: bodyPhone, method: 'body_regex'});
    
    // Debug info
    var maskedFound = /0[3-9]\\d+\\*{2,}/.test(bodyText);
    var debugInfo = {
      url: window.location.href,
      title: (document.title || '').substring(0, 100),
      bodyLen: bodyText.length,
      isBDS: isBDS,
      isNhatot: isNhatot,
      clickedAny: clickedAny,
      interceptedCount: interceptedPhones.length,
      interceptedRaw: interceptedPhones.slice(0, 3)
    };
    if (isBDS) {
      var phoneEls = document.querySelectorAll('[class*="phone"], [class*="Phone"]');
      debugInfo.phoneElCount = phoneEls.length;
      if (phoneEls.length > 0) debugInfo.phoneElSample = (phoneEls[0].outerHTML || '').substring(0, 300);
      var rawEls = document.querySelectorAll('[raw]');
      debugInfo.rawElCount = rawEls.length;
    }
    return JSON.stringify({
      phone: null,
      method: maskedFound ? 'masked_only' : 'not_found',
      debug: debugInfo
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
        const found = deepFindPhoneInObject(ad);
        if (found) {
          console.log(`[extract-phone] Nhatot mobile API found phone: ${found}`);
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
    if (authHeader?.startsWith('Bearer ')) {
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

    // Mode 1: Single property
    if (propertyId && sourceUrl) {
      const marketplace = explicitMarketplace || detectMarketplace(sourceUrl);
      if (!marketplace) {
        return new Response(JSON.stringify({ error: 'Cannot detect marketplace from URL', sourceUrl }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { phone, method } = await extractPhoneForListing(sourceUrl, marketplace);
      if (phone) {
        await supabase.from('external_properties').update({ contact_phone: phone, updated_at: new Date().toISOString() }).eq('id', propertyId);
        console.log(`[extract-phone] Updated ${propertyId} with ${phone}`);
      }
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
        if (phone && id) {
          await supabase.from('external_properties').update({ contact_phone: phone, updated_at: new Date().toISOString() }).eq('id', id);
          extracted++;
        }
        if (batch.indexOf(listing) < batch.length - 1) await new Promise(r => setTimeout(r, 2000));
      }

      return new Response(JSON.stringify({ success: true, total: batch.length, extracted, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mode 3: Auto-fill
    if (body.autoFill) {
      const limit = Math.min(body.limit || 5, 10);
      const { data: missingPhone } = await supabase
        .from('external_properties').select('id, source_url, source')
        .is('contact_phone', null).eq('is_active', true)
        .order('created_at', { ascending: false }).limit(limit);

      if (!missingPhone || missingPhone.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No properties missing phone numbers', extracted: 0 }), {
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
        if (phone) {
          await supabase.from('external_properties').update({ contact_phone: phone, updated_at: new Date().toISOString() }).eq('id', prop.id);
          extracted++;
        }
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
