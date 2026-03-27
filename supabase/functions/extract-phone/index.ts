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
    await new Promise(r => setTimeout(r, 3000));
    
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
    
    // Step 1: Check existing tel: links (already revealed)
    var telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (var i = 0; i < telLinks.length; i++) {
      var phone = telLinks[i].getAttribute('href').replace('tel:', '').trim();
      if (isValidPhone(phone)) return JSON.stringify({phone: phone, method: 'tel_link'});
    }
    
    // Step 2: For Batdongsan - find encrypted phone 'raw' attribute and call DecryptPhone API
    var isBDS = window.location.hostname.indexOf('batdongsan') >= 0;
    if (isBDS) {
      // Look for elements with 'raw' attribute containing encrypted phone data
      var rawSels = [
        '[raw]', '[data-raw]', '[data-phone-raw]',
        '.re__contact-phone [raw]', '[class*="phone"] [raw]',
        '.js__phone [raw]', '.re__btn-short-info-phone[raw]'
      ];
      var encryptedPhone = null;
      for (var rs = 0; rs < rawSels.length; rs++) {
        try {
          var rawEls = document.querySelectorAll(rawSels[rs]);
          for (var re = 0; re < rawEls.length; re++) {
            var rawVal = rawEls[re].getAttribute('raw') || rawEls[re].getAttribute('data-raw') || rawEls[re].getAttribute('data-phone-raw');
            if (rawVal && rawVal.length > 5) { encryptedPhone = rawVal; break; }
          }
          if (encryptedPhone) break;
        } catch(ex) {}
      }
      
      // Also scan script tags and JS variables for encrypted phone data
      if (!encryptedPhone) {
        try {
          var scripts = document.querySelectorAll('script:not([src])');
          for (var si = 0; si < scripts.length; si++) {
            var sc = scripts[si].textContent || '';
            // Look for phone patterns in inline scripts
            var rawMatch = sc.match(/["']raw["']\\s*:\\s*["']([^"']{10,})["']/);
            if (rawMatch) { encryptedPhone = rawMatch[1]; break; }
            var phoneEncMatch = sc.match(/PhoneNumber["']?\\s*[:=]\\s*["']([^"']{10,})["']/);
            if (phoneEncMatch) { encryptedPhone = phoneEncMatch[1]; break; }
            var encMatch = sc.match(/encrypted(?:Phone)?["']?\\s*[:=]\\s*["']([^"']{10,})["']/i);
            if (encMatch) { encryptedPhone = encMatch[1]; break; }
          }
        } catch(ex) {}
      }
      
      // Also check data attributes on phone containers
      if (!encryptedPhone) {
        try {
          var phoneContainers = document.querySelectorAll('[class*="phone"], [class*="Phone"], .re__contact-phone, .js__phone-container');
          for (var pc = 0; pc < phoneContainers.length; pc++) {
            var attrs = phoneContainers[pc].attributes;
            for (var ai = 0; ai < attrs.length; ai++) {
              var attrVal = attrs[ai].value;
              if (attrs[ai].name !== 'class' && attrs[ai].name !== 'style' && attrVal.length > 10 && /[A-Za-z0-9+/=]{10,}/.test(attrVal)) {
                encryptedPhone = attrVal;
                break;
              }
            }
            if (encryptedPhone) break;
          }
        } catch(ex) {}
      }
      
      if (encryptedPhone) {
        // Try calling DecryptPhone API - first without Turnstile token
        try {
          var decryptResp = await fetch('/Product/ProductDetail/DecryptPhone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
            body: JSON.stringify({ PhoneNumber: encryptedPhone })
          });
          if (decryptResp.ok) {
            var decryptData = await decryptResp.json();
            var decrypted = decryptData.PhoneNumber || decryptData.phoneNumber || decryptData.phone || decryptData.Phone;
            if (!decrypted && typeof decryptData === 'object') {
              var keys = Object.keys(decryptData);
              for (var dk = 0; dk < keys.length; dk++) {
                var dv = decryptData[keys[dk]];
                if (typeof dv === 'string' && /0[3-9]\d{8,9}/.test(dv.replace(/[^0-9]/g, ''))) { decrypted = dv; break; }
              }
            }
            if (decrypted && isValidPhone(decrypted)) {
              return JSON.stringify({phone: decrypted, method: 'decrypt_api'});
            }
          }
        } catch(ex) {}
      }
      
      // Intercept XHR/fetch to capture decrypted phone from reveal button click
      var interceptedPhone = null;
      var origFetch = window.fetch;
      window.fetch = function() {
        return origFetch.apply(this, arguments).then(function(resp) {
          var url = (arguments[0] && arguments[0].url) || (typeof arguments[0] === 'string' ? arguments[0] : '');
          if (url.indexOf('DecryptPhone') >= 0 || url.indexOf('decrypt') >= 0 || url.indexOf('phone') >= 0) {
            resp.clone().text().then(function(t) {
              try {
                var d = JSON.parse(t);
                var p = d.PhoneNumber || d.phoneNumber || d.phone || d.Phone;
                if (p && !isMasked(p)) interceptedPhone = p;
              } catch(e) {}
            });
          }
          return resp;
        });
      };
      var origXHROpen = XMLHttpRequest.prototype.open;
      var origXHRSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(m, u) {
        this._url = u;
        return origXHROpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function() {
        var xhr = this;
        xhr.addEventListener('load', function() {
          var u = xhr._url || '';
          if (u.indexOf('DecryptPhone') >= 0 || u.indexOf('decrypt') >= 0 || u.indexOf('phone') >= 0) {
            try {
              var d = JSON.parse(xhr.responseText);
              var p = d.PhoneNumber || d.phoneNumber || d.phone || d.Phone;
              if (p && !isMasked(p)) interceptedPhone = p;
            } catch(e) {}
          }
        });
        return origXHRSend.apply(this, arguments);
      };
    }
    
    // For Nhatot - look for phone in API data embedded in page
    var isNhatot = window.location.hostname.indexOf('nhatot') >= 0 || window.location.hostname.indexOf('chotot') >= 0;
    if (isNhatot) {
      try {
        var nextData = document.getElementById('__NEXT_DATA__');
        if (nextData) {
          var ndJson = JSON.parse(nextData.textContent);
          var ndStr = JSON.stringify(ndJson);
          var ndMatch = ndStr.match(/0[3-9]\d{8}/);
          if (ndMatch && isValidPhone(ndMatch[0])) return JSON.stringify({phone: ndMatch[0], method: 'nhatot_next_data'});
        }
      } catch(ex) {}
    }
    
    // Step 3: Click reveal buttons (fallback for both marketplaces)
    var revealTexts = ['Hiện số', 'Xem SĐT', 'Xem số', 'Bấm để hiện số'];
    var allEls = document.querySelectorAll('button, a, span, div');
    for (var j = 0; j < allEls.length; j++) {
      var txt = (allEls[j].textContent || '').trim();
      for (var rt = 0; rt < revealTexts.length; rt++) {
        if (txt.indexOf(revealTexts[rt]) >= 0) {
          allEls[j].click();
          await new Promise(r => setTimeout(r, 3000));
          break;
        }
      }
    }
    
    var revealSels = [
      '[class*="phone"] button', '.re__btn-short-info-phone', '.js__phone-btn',
      '.re__contact-phone button', '[class*="ContactPhone"] button',
      '[data-aut-id="btnPhone"]', 'button[class*="phone"]'
    ];
    for (var rsi = 0; rsi < revealSels.length; rsi++) {
      try { var els = document.querySelectorAll(revealSels[rsi]); for (var e = 0; e < els.length; e++) els[e].click(); } catch(ex) {}
    }
    await new Promise(r => setTimeout(r, 3000));
    
    // Check intercepted phone from XHR/fetch monkey-patch
    if (interceptedPhone && isValidPhone(interceptedPhone)) {
      return JSON.stringify({phone: interceptedPhone, method: 'xhr_intercept'});
    }
    
    // Step 4: Re-check tel: links after reveal
    telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (var t = 0; t < telLinks.length; t++) {
      var p2 = telLinks[t].getAttribute('href').replace('tel:', '').trim();
      if (isValidPhone(p2)) return JSON.stringify({phone: p2, method: 'tel_link_after_reveal'});
    }
    
    // Step 5: Check phone elements
    var phoneSels = ['[class*="phone-number"]', '[class*="PhoneNumber"]', '[class*="phone__number"]', '.re__contact-phone', '[class*="ContactPhone"]'];
    for (var ps = 0; ps < phoneSels.length; ps++) {
      try {
        var pels = document.querySelectorAll(phoneSels[ps]);
        for (var pe = 0; pe < pels.length; pe++) {
          var ptxt = pels[pe].textContent.trim();
          var pmatch = ptxt.match(/0[3-9]\\d{8}/);
          if (pmatch && !isMasked(ptxt) && !isExcluded(pmatch[0])) return JSON.stringify({phone: pmatch[0], method: 'phone_element'});
        }
      } catch(ex) {}
    }
    
    // Step 6: Body regex fallback
    var bodyText = document.body.innerText;
    var matches = bodyText.match(/0[3-9]\\d[\\s.-]?\\d{3}[\\s.-]?\\d{4}/g);
    if (matches) {
      for (var w = 0; w < matches.length; w++) {
        if (!isMasked(matches[w]) && !isExcluded(matches[w])) return JSON.stringify({phone: matches[w], method: 'body_regex'});
      }
    }
    
    var maskedFound = /0[3-9]\\d+\\*{2,}/.test(bodyText);
    var debugInfo = {
      url: window.location.href,
      title: (document.title || '').substring(0, 100),
      bodyLen: bodyText.length,
      isBDS: isBDS
    };
    if (isBDS) {
      var phoneEls = document.querySelectorAll('[class*="phone"], [class*="Phone"]');
      debugInfo.phoneElCount = phoneEls.length;
      debugInfo.encryptedFound = !!encryptedPhone;
      debugInfo.interceptedPhone = interceptedPhone;
      if (phoneEls.length > 0) {
        debugInfo.phoneElSample = (phoneEls[0].outerHTML || '').substring(0, 300);
      }
      // Check all elements with 'raw' attribute
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
    return { phone: null, method: data.method || 'parse_no_phone', debug: { title: data.title, bodyLen: data.bodyLen, url: data.url } };
  } catch {
    return { phone: null, method: 'parse_error' };
  }
}

async function extractPhoneForListing(listingUrl: string, marketplace: string): Promise<{ phone: string | null; method: string }> {
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
      // Navigate to domain root, set cookies via document.cookie, then go to listing
      const domainUrl = marketplace === 'batdongsan' ? 'https://batdongsan.com.vn/' : 'https://www.nhatot.com/';
      const setCookieJS = `(async () => {
        var pairs = ${JSON.stringify(cookieStr)}.split('; ');
        for (var i = 0; i < pairs.length; i++) document.cookie = pairs[i] + '; path=/';
        return pairs.length;
      })()`;
      
      query = `mutation ExtractPhone($url: String!, $jsCode: String!) {
  domainPage: goto(url: "${domainUrl}", waitUntil: domContentLoaded) { status }
  setCookies: evaluate(content: ${JSON.stringify(setCookieJS)}, timeout: 5000) { value }
  gotoListing: goto(url: $url, waitUntil: networkIdle) { status url }
  phoneData: evaluate(content: $jsCode, timeout: 45000) { value }
}`;
    } else {
      query = `mutation ExtractPhone($url: String!, $jsCode: String!) {
  goto(url: $url, waitUntil: networkIdle) { status url }
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
    
    if (result.errors) {
      console.error(`[extract-phone] BQL errors: ${JSON.stringify(result.errors).substring(0, 300)}`);
    }
    if (hasCookies && result.data?.setCookiesOnDomain?.value) {
      console.log(`[extract-phone] Cookie injection: ${result.data.setCookiesOnDomain.value}`);
    }
    
    const phoneResult = parsePhoneResult(result?.data?.phoneData?.value);
    console.log(`[extract-phone] Result: ${JSON.stringify(phoneResult)}`);
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
