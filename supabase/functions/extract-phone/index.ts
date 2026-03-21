import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Marketplace-specific selectors and login flows
const MARKETPLACE_CONFIG: Record<string, {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  phoneRevealSelector: string;
  phoneResultSelector: string;
  usernameEnv: string;
  passwordEnv: string;
  loginCheckSelector: string;
}> = {
  batdongsan: {
    loginUrl: 'https://batdongsan.com.vn/dang-nhap',
    usernameSelector: 'input[name="email"], input[name="username"], input[type="email"]',
    passwordSelector: 'input[name="password"], input[type="password"]',
    submitSelector: 'button[type="submit"], .btn-login, .js__btn-login',
    phoneRevealSelector: '.js__phone-btn, .phone-btn, button[data-toggle="phone"], .btn-show-phone, [class*="phone"][class*="btn"], [class*="show"][class*="phone"], a[href*="tel:"]',
    phoneResultSelector: '.js__phone-number, .phone-number, [class*="phone-number"], [class*="phoneNumber"], a[href^="tel:"]',
    usernameEnv: 'BATDONGSAN_USERNAME',
    passwordEnv: 'BATDONGSAN_PASSWORD',
    loginCheckSelector: '.user-menu, .logged-in, .js__user-info, [class*="avatar"], [class*="user-name"]',
  },
  nhatot: {
    loginUrl: 'https://www.nhatot.com/dang-nhap',
    usernameSelector: 'input[name="email"], input[name="phone"], input[type="email"], input[type="tel"]',
    passwordSelector: 'input[name="password"], input[type="password"]',
    submitSelector: 'button[type="submit"], .btn-login, [class*="login-btn"]',
    phoneRevealSelector: '.ContactPhone_btn__wrapper, [class*="ContactPhone"], [class*="show-phone"], button[class*="phone"], [data-aut-id="btnPhone"]',
    phoneResultSelector: '.ContactPhone_phone__number, [class*="phone__number"], [class*="phoneNumber"], a[href^="tel:"]',
    usernameEnv: 'NHATOT_USERNAME',
    passwordEnv: 'NHATOT_PASSWORD',
    loginCheckSelector: '.Avatar, [class*="avatar"], [class*="user-menu"], [class*="UserMenu"]',
  },
};

// Clean and validate phone number
function cleanPhoneNumber(raw: string): string | null {
  if (!raw) return null;
  // Remove all non-digit chars except leading +
  let cleaned = raw.replace(/[^\d+]/g, '');
  // Remove country code prefix if present
  if (cleaned.startsWith('+84')) cleaned = '0' + cleaned.slice(3);
  if (cleaned.startsWith('84') && cleaned.length > 10) cleaned = '0' + cleaned.slice(2);
  // Validate Vietnamese phone (10-11 digits starting with 0)
  if (/^0\d{9,10}$/.test(cleaned)) return cleaned;
  // Also accept raw 9-10 digit numbers
  if (/^\d{9,10}$/.test(cleaned)) return '0' + cleaned;
  return null;
}

// Detect marketplace from URL
function detectMarketplace(url: string): string | null {
  if (url.includes('batdongsan.com.vn')) return 'batdongsan';
  if (url.includes('nhatot.com') || url.includes('chotot.com')) return 'nhatot';
  return null;
}

// Execute a Browserless BQL (Browser Query Language) script
async function executeBrowserlessScript(script: string, timeout = 30000): Promise<any> {
  if (!BROWSERLESS_API_KEY) throw new Error('BROWSERLESS_API_KEY not configured');

  const response = await fetch(`https://production-sfo.browserless.io/chromium/bql?token=${BROWSERLESS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: script,
    }),
    signal: AbortSignal.timeout(timeout + 5000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Browserless API error [${response.status}]: ${errorText}`);
  }

  return response.json();
}

// Build BQL mutation for login + phone extraction
function buildPhoneExtractionScript(
  listingUrl: string,
  config: typeof MARKETPLACE_CONFIG[string],
  username: string,
  password: string,
): string {
  return `
mutation ExtractPhone {
  goto(url: "${config.loginUrl}", waitUntil: networkIdle) {
    status
    url
  }

  usernameInput: type(
    selector: "${config.usernameSelector}"
    text: "${username}"
  ) {
    time
  }

  passwordInput: type(
    selector: "${config.passwordSelector}"
    text: "${password}"
  ) {
    time
  }

  submitLogin: click(selector: "${config.submitSelector}") {
    time
  }

  waitForLogin: waitForSelector(
    selector: "${config.loginCheckSelector}"
    timeout: 10000
  ) {
    time
  }

  navigateToListing: goto(url: "${listingUrl}", waitUntil: networkIdle) {
    status
    url
  }

  waitForPage: waitForSelector(
    selector: "body"
    timeout: 5000
  ) {
    time
  }

  revealPhone: click(selector: "${config.phoneRevealSelector}") {
    time
  }

  waitForPhone: waitForSelector(
    selector: "${config.phoneResultSelector}"
    timeout: 8000
  ) {
    time
  }

  phoneText: text(selector: "${config.phoneResultSelector}") {
    text
  }

  pageContent: text(selector: "body") {
    text
  }
}`;
}

// Fallback: simpler script that just navigates and looks for tel: links
function buildFallbackScript(listingUrl: string): string {
  return `
mutation FallbackPhone {
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

// Extract phone from page content using regex patterns
function extractPhoneFromText(text: string): string | null {
  if (!text) return null;
  
  // Vietnamese phone patterns
  const patterns = [
    /(?:0[3-9]\d{8})/g,                    // Standard 10-digit
    /(?:\+84[3-9]\d{8})/g,                 // With country code
    /(?:84[3-9]\d{8})/g,                   // Country code without +
    /(?:0\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/g, // Formatted
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

// Main extraction for a single listing
async function extractPhoneForListing(
  listingUrl: string,
  marketplace: string,
): Promise<{ phone: string | null; method: string }> {
  const config = MARKETPLACE_CONFIG[marketplace];
  if (!config) return { phone: null, method: 'unsupported_marketplace' };

  const username = Deno.env.get(config.usernameEnv);
  const password = Deno.env.get(config.passwordEnv);
  
  if (!username || !password) {
    console.log(`[extract-phone] No credentials for ${marketplace}`);
    return { phone: null, method: 'no_credentials' };
  }

  // Attempt 1: Full login + reveal flow
  try {
    console.log(`[extract-phone] Attempting login + reveal for: ${listingUrl}`);
    const script = buildPhoneExtractionScript(listingUrl, config, username, password);
    const result = await executeBrowserlessScript(script, 25000);
    
    // Check phone text from revealed element
    const phoneText = result?.data?.phoneText?.text;
    if (phoneText) {
      const phone = cleanPhoneNumber(phoneText);
      if (phone) {
        console.log(`[extract-phone] Found phone via reveal: ${phone}`);
        return { phone, method: 'reveal_button' };
      }
    }

    // Check tel: links in page
    const pageContent = result?.data?.pageContent?.text || '';
    const phoneFromContent = extractPhoneFromText(pageContent);
    if (phoneFromContent) {
      console.log(`[extract-phone] Found phone in page content: ${phoneFromContent}`);
      return { phone: phoneFromContent, method: 'page_content' };
    }
  } catch (error) {
    console.warn(`[extract-phone] Login+reveal failed for ${listingUrl}:`, error);
  }

  // Attempt 2: Fallback - just navigate and look for tel: links (no login)
  try {
    console.log(`[extract-phone] Fallback: checking tel: links for ${listingUrl}`);
    const fallbackScript = buildFallbackScript(listingUrl);
    const result = await executeBrowserlessScript(fallbackScript, 15000);
    
    // Extract from tel: links
    const phoneLinksHtml = result?.data?.phoneLinks?.html || '';
    const telMatch = phoneLinksHtml.match(/href="tel:([^"]+)"/);
    if (telMatch) {
      const phone = cleanPhoneNumber(telMatch[1]);
      if (phone) {
        console.log(`[extract-phone] Found phone via tel: link: ${phone}`);
        return { phone, method: 'tel_link' };
      }
    }

    // Extract from page text
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
    // Authenticate: service role or user JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
    const isAnonKey = token === Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!isServiceRole && !isAnonKey) {
      const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: authError } = await supabaseAuth.auth.getUser(token);
      if (authError || !userData?.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
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

    // Mode 1: Single property by ID (update existing record)
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

      return new Response(JSON.stringify({ 
        success: true, phone, method, propertyId 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mode 2: Batch extraction for multiple listings
    if (Array.isArray(listings) && listings.length > 0) {
      const maxBatch = 10;
      const batch = listings.slice(0, maxBatch);
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

        // Brief pause between requests to avoid rate limits
        if (batch.indexOf(listing) < batch.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      console.log(`[extract-phone] Batch: ${extracted}/${batch.length} phones extracted`);

      return new Response(JSON.stringify({ 
        success: true, 
        total: batch.length, 
        extracted, 
        results 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mode 3: Auto-fill — find external properties missing phone numbers
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

      console.log(`[extract-phone] AutoFill: processing ${missingPhone.length} properties missing phone`);

      const results: Array<{ id: string; phone: string | null; method: string }> = [];
      let extracted = 0;

      for (const prop of missingPhone) {
        const mp = prop.source || detectMarketplace(prop.source_url);
        if (!mp) {
          results.push({ id: prop.id, phone: null, method: 'unsupported' });
          continue;
        }

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

      return new Response(JSON.stringify({ 
        success: true, total: missingPhone.length, extracted, results 
      }), {
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
