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

function parseCookieString(cookieStr: string, domain: string): Array<{name: string; value: string; domain: string; path: string}> {
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

function getCookiesForMarketplace(marketplace: string): Array<{name: string; value: string; domain: string; path: string}> {
  if (marketplace === 'batdongsan') {
    const raw = Deno.env.get('BATDONGSAN_COOKIES');
    return raw ? parseCookieString(raw, '.batdongsan.com.vn') : [];
  }
  if (marketplace === 'nhatot') {
    const raw = Deno.env.get('NHATOT_COOKIES');
    return raw ? parseCookieString(raw, '.nhatot.com') : [];
  }
  return [];
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
    
    // Step 1: Check tel: links
    var telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (var i = 0; i < telLinks.length; i++) {
      var phone = telLinks[i].getAttribute('href').replace('tel:', '').trim();
      if (isValidPhone(phone)) {
        return JSON.stringify({phone: phone, method: 'tel_link'});
      }
    }
    
    // Step 2: Click reveal buttons
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
    
    // Also click marketplace-specific selectors
    var revealSels = [
      '[class*="phone"] button', '.re__btn-short-info-phone', '.js__phone-btn',
      '.re__contact-phone button', '[class*="ContactPhone"] button',
      '[data-aut-id="btnPhone"]', 'button[class*="phone"]'
    ];
    for (var rs = 0; rs < revealSels.length; rs++) {
      try {
        var els = document.querySelectorAll(revealSels[rs]);
        for (var e = 0; e < els.length; e++) els[e].click();
      } catch(ex) {}
    }
    
    await new Promise(r => setTimeout(r, 2000));
    
    // Step 3: Re-check tel: links after reveal
    telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (var t = 0; t < telLinks.length; t++) {
      var p2 = telLinks[t].getAttribute('href').replace('tel:', '').trim();
      if (isValidPhone(p2)) {
        return JSON.stringify({phone: p2, method: 'tel_link_after_reveal'});
      }
    }
    
    // Step 4: Check phone-related elements
    var phoneSels = [
      '[class*="phone-number"]', '[class*="PhoneNumber"]', '[class*="phone__number"]',
      '.re__contact-phone', '[class*="ContactPhone"]'
    ];
    for (var ps = 0; ps < phoneSels.length; ps++) {
      try {
        var pels = document.querySelectorAll(phoneSels[ps]);
        for (var pe = 0; pe < pels.length; pe++) {
          var ptxt = pels[pe].textContent.trim();
          var pmatch = ptxt.match(/0[3-9]\\d{8}/);
          if (pmatch && !isMasked(ptxt) && !isExcluded(pmatch[0])) {
            return JSON.stringify({phone: pmatch[0], method: 'phone_element'});
          }
        }
      } catch(ex) {}
    }
    
    // Step 5: Regex scan body
    var bodyText = document.body.innerText;
    var matches = bodyText.match(/0[3-9]\\d[\\s.-]?\\d{3}[\\s.-]?\\d{4}/g);
    if (matches) {
      for (var w = 0; w < matches.length; w++) {
        if (!isMasked(matches[w]) && !isExcluded(matches[w])) {
          return JSON.stringify({phone: matches[w], method: 'body_regex'});
        }
      }
    }
    
    var maskedFound = /0[3-9]\\d+\\*{2,}/.test(bodyText);
    return JSON.stringify({
      phone: null, 
      method: maskedFound ? 'masked_only' : 'not_found',
      url: window.location.href
    });
  })()`;
}

// Build BQL with cookie injection before navigation
function buildBQLWithCookies(cookies: Array<{name: string; value: string; domain: string; path: string}>): string {
  if (cookies.length === 0) {
    // No cookies — simple goto + extract
    return `mutation ExtractPhone($url: String!, $jsCode: String!) {
  goto(url: $url, waitUntil: networkIdle) {
    status
    url
  }
  phoneData: evaluate(content: $jsCode, timeout: 45000) {
    value
  }
}`;
  }

  // With cookies: inject first, then navigate
  return `mutation ExtractPhone($url: String!, $jsCode: String!, $cookies: [CookieInput!]!) {
  setCookies: cookies(cookies: $cookies) {
    cookies {
      name
    }
  }
  goto(url: $url, waitUntil: networkIdle) {
    status
    url
  }
  phoneData: evaluate(content: $jsCode, timeout: 45000) {
    value
  }
}`;
}

function parsePhoneResult(resultStr: string | undefined | null): { phone: string | null; method: string } {
  if (!resultStr) return { phone: null, method: 'no_result' };
  try {
    const data = JSON.parse(resultStr);
    if (data.phone) {
      const phone = cleanPhoneNumber(data.phone);
      if (phone) return { phone, method: data.method };
    }
    return { phone: null, method: data.method || 'parse_no_phone' };
  } catch {
    return { phone: null, method: 'parse_error' };
  }
}

async function extractPhoneForListing(
  listingUrl: string,
  marketplace: string,
): Promise<{ phone: string | null; method: string }> {
  if (!BROWSERLESS_API_KEY) throw new Error('BROWSERLESS_API_KEY not configured');

  const cookies = getCookiesForMarketplace(marketplace);
  const jsCode = buildExtractJS();
  const query = buildBQLWithCookies(cookies);

  const variables: Record<string, unknown> = { url: listingUrl, jsCode };
  if (cookies.length > 0) {
    variables.cookies = cookies;
  }

  try {
    console.log(`[extract-phone] Extracting from ${listingUrl} (cookies: ${cookies.length > 0 ? 'yes' : 'no'})`);

    const response = await fetch(`https://production-sfo.browserless.io/chromium/bql?token=${BROWSERLESS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(65000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[extract-phone] Browserless error [${response.status}]: ${errorText}`);
      return { phone: null, method: `browserless_error_${response.status}` };
    }

    const result = await response.json();
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
    // Auth check
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
        await supabase
          .from('external_properties')
          .update({ contact_phone: phone, updated_at: new Date().toISOString() })
          .eq('id', propertyId);
        console.log(`[extract-phone] Updated property ${propertyId} with phone ${phone} (method: ${method})`);
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

        if (!url || !mp) {
          results.push({ sourceUrl: url, phone: null, method: 'invalid_input' });
          continue;
        }

        const { phone, method } = await extractPhoneForListing(url, mp);
        results.push({ sourceUrl: url, phone, method, propertyId: id });

        if (phone && id) {
          await supabase
            .from('external_properties')
            .update({ contact_phone: phone, updated_at: new Date().toISOString() })
            .eq('id', id);
          extracted++;
        }

        if (batch.indexOf(listing) < batch.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      console.log(`[extract-phone] Batch: ${extracted}/${batch.length} phones extracted`);
      return new Response(JSON.stringify({ success: true, total: batch.length, extracted, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mode 3: Auto-fill
    if (body.autoFill) {
      const limit = Math.min(body.limit || 5, 10);
      const { data: missingPhone } = await supabase
        .from('external_properties')
        .select('id, source_url, source')
        .is('contact_phone', null)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(limit);

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
          await supabase
            .from('external_properties')
            .update({ contact_phone: phone, updated_at: new Date().toISOString() })
            .eq('id', prop.id);
          extracted++;
        }

        if (missingPhone.indexOf(prop) < missingPhone.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      return new Response(JSON.stringify({ success: true, total: missingPhone.length, extracted, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      error: 'Provide either {propertyId, sourceUrl}, {listings: [...]}, or {autoFill: true}'
    }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[extract-phone] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      success: false
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
