import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Marketplace-specific selectors for phone extraction
const MARKETPLACE_CONFIG: Record<string, {
  phoneRevealSelector: string;
  phoneResultSelector: string;
}> = {
  batdongsan: {
    phoneRevealSelector: '[class*="phone"] button, .re__btn-short-info-phone, .js__phone-btn, .re__contact-phone button',
    phoneResultSelector: '[class*="phone-number"], .re__contact-phone a[href^="tel:"], a[href^="tel:"]',
  },
  nhatot: {
    phoneRevealSelector: '[class*="ContactPhone"] button, [data-aut-id="btnPhone"], button[class*="phone"]',
    phoneResultSelector: '[class*="phone__number"], [class*="ContactPhone"] a[href^="tel:"], a[href^="tel:"]',
  },
};

function cleanPhoneNumber(raw: string): string | null {
  if (!raw) return null;
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

async function executeBrowserlessScript(script: string, variables?: Record<string, unknown>, timeout = 30000): Promise<any> {
  if (!BROWSERLESS_API_KEY) throw new Error('BROWSERLESS_API_KEY not configured');

  const body: Record<string, unknown> = { query: script };
  if (variables && Object.keys(variables).length > 0) body.variables = variables;

  const response = await fetch(`https://production-sfo.browserless.io/chromium/bql?token=${BROWSERLESS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout + 5000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Browserless API error [${response.status}]: ${errorText}`);
  }

  return response.json();
}

// Build inline JS for phone extraction that runs inside the browser
function buildPhoneExtractionJS(config: typeof MARKETPLACE_CONFIG[string]): string {
  // Escape for embedding in BQL template literal
  const revealSels = config.phoneRevealSelector.split(', ');
  const resultSels = config.phoneResultSelector.split(', ');
  
  return [
    'async function extractPhone() {',
    '  await new Promise(r => setTimeout(r, 2000));',
    '  // Check existing tel links',
    '  var telLinks = document.querySelectorAll("a[href^=\\"tel:\\"]");',
    '  for (var i = 0; i < telLinks.length; i++) {',
    '    var phone = telLinks[i].getAttribute("href").replace("tel:", "").trim();',
    '    if (phone && phone.replace(/[^0-9]/g, "").length >= 9) return JSON.stringify({phone: phone, method: "tel_link"});',
    '  }',
    '  // Click reveal buttons',
    '  var allEls = document.querySelectorAll("button, a, span, div");',
    '  for (var j = 0; j < allEls.length; j++) {',
    '    var txt = allEls[j].textContent || "";',
    '    if (txt.indexOf("Hiện số") >= 0 || txt.indexOf("Xem SĐT") >= 0 || txt.indexOf("Show phone") >= 0) {',
    '      allEls[j].click();',
    '      await new Promise(r => setTimeout(r, 3000));',
    '      break;',
    '    }',
    '  }',
    ...revealSels.map(sel => [
      `  var btns = document.querySelectorAll("${sel.trim()}");`,
      '  for (var k = 0; k < btns.length; k++) { btns[k].click(); }',
    ]).flat(),
    '  await new Promise(r => setTimeout(r, 2000));',
    '  // Re-check tel links after click',
    '  telLinks = document.querySelectorAll("a[href^=\\"tel:\\"]");',
    '  for (var m = 0; m < telLinks.length; m++) {',
    '    var p2 = telLinks[m].getAttribute("href").replace("tel:", "").trim();',
    '    if (p2 && p2.replace(/[^0-9]/g, "").length >= 9) return JSON.stringify({phone: p2, method: "reveal_click"});',
    '  }',
    ...resultSels.map(sel => [
      `  var results = document.querySelectorAll("${sel.trim()}");`,
      '  for (var n = 0; n < results.length; n++) {',
      '    var t = results[n].textContent.trim();',
      '    if (t && /0[0-9\\s.-]{8,}/.test(t)) return JSON.stringify({phone: t, method: "result_selector"});',
      '  }',
    ]).flat(),
    '  // Regex scan body',
    '  var bodyText = document.body.innerText;',
    '  var match = bodyText.match(/0[3-9]\\d[\\s.-]?\\d{3}[\\s.-]?\\d{4}/);',
    '  if (match) return JSON.stringify({phone: match[0], method: "body_regex"});',
    '  return JSON.stringify({phone: null, method: "not_found"});',
    '}',
    'return extractPhone();',
  ].join('\n');
}

function buildExtractionScript(listingUrl: string, jsCode: string): string {
  // Escape the JS code for BQL content string
  const escapedJS = jsCode.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  
  return `mutation ExtractPhone {
  goto(url: "${listingUrl}", waitUntil: networkIdle) {
    status
    url
  }

  waitForPage: waitForSelector(
    selector: "body"
    timeout: 8000
  ) {
    time
  }

  phoneData: evaluate(
    content: "${escapedJS}"
    timeout: 15000
  ) {
    value
  }
}`;
}

function buildFallbackScript(listingUrl: string): string {
  return `mutation FallbackPhone {
  goto(url: "${listingUrl}", waitUntil: networkIdle) {
    status
    url
  }

  waitForPage: waitForSelector(
    selector: "body"
    timeout: 5000
  ) {
    time
  }

  phoneLinks: html(selector: "a[href^='tel:']") {
    html
  }

  pageContent: text(selector: "body") {
    text
  }
}`;
}

function extractPhoneFromText(text: string): string | null {
  if (!text) return null;
  const patterns = [
    /(?:0[3-9]\d{8})/g,
    /(?:\+84[3-9]\d{8})/g,
    /(?:84[3-9]\d{8})/g,
    /(?:0\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/g,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        const cleaned = cleanPhoneNumber(match);
        if (cleaned) return cleaned;
      }
    }
  }
  return null;
}

async function extractPhoneForListing(
  listingUrl: string,
  marketplace: string,
): Promise<{ phone: string | null; method: string }> {
  const config = MARKETPLACE_CONFIG[marketplace];
  if (!config) return { phone: null, method: 'unsupported_marketplace' };

  // Attempt 1: Navigate + JS evaluate (click reveal + extract)
  try {
    console.log(`[extract-phone] Attempting JS evaluate for: ${listingUrl}`);
    const jsCode = buildPhoneExtractionJS(config);
    const script = buildExtractionScript(listingUrl, jsCode);
    const result = await executeBrowserlessScript(script, 30000);

    const phoneDataStr = result?.data?.phoneData?.value;
    if (phoneDataStr) {
      try {
        const phoneData = JSON.parse(phoneDataStr);
        if (phoneData.phone) {
          const phone = cleanPhoneNumber(phoneData.phone);
          if (phone) {
            console.log(`[extract-phone] Found phone via ${phoneData.method}: ${phone}`);
            return { phone, method: phoneData.method };
          }
        }
      } catch (e) {
        console.warn(`[extract-phone] Failed to parse evaluate result:`, phoneDataStr);
      }
    }
  } catch (error) {
    console.warn(`[extract-phone] JS evaluate failed for ${listingUrl}:`, error);
  }

  // Attempt 2: Fallback - navigate and check tel: links + body text
  try {
    console.log(`[extract-phone] Fallback: checking tel: links for ${listingUrl}`);
    const fallbackScript = buildFallbackScript(listingUrl);
    const result = await executeBrowserlessScript(fallbackScript, 15000);

    const phoneLinksHtml = result?.data?.phoneLinks?.html || '';
    const telMatch = phoneLinksHtml.match(/href="tel:([^"]+)"/);
    if (telMatch) {
      const phone = cleanPhoneNumber(telMatch[1]);
      if (phone) {
        console.log(`[extract-phone] Found phone via tel: link: ${phone}`);
        return { phone, method: 'tel_link' };
      }
    }

    const pageContent = result?.data?.pageContent?.text || '';
    const phoneFromContent = extractPhoneFromText(pageContent);
    if (phoneFromContent) {
      console.log(`[extract-phone] Found phone in fallback content: ${phoneFromContent}`);
      return { phone: phoneFromContent, method: 'fallback_content' };
    }
  } catch (error) {
    console.warn(`[extract-phone] Fallback failed for ${listingUrl}:`, error);
  }

  return { phone: null, method: 'not_found' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: accept service role, anon key, or valid JWT
    const authHeader = req.headers.get('Authorization');
    const apiKey = req.headers.get('apikey') || new URL(req.url).searchParams.get('apikey') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const isAnonRequest = apiKey === anonKey || (authHeader && authHeader.replace('Bearer ', '') === anonKey);
    
    if (!isAnonRequest) {
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const token = authHeader.replace('Bearer ', '');
      const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
      if (!isServiceRole) {
        const supabaseAuth = createClient(SUPABASE_URL, anonKey, {
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
    console.log(`[extract-phone] Auth passed (anon: ${isAnonRequest})`);

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
