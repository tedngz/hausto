import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Known hotline numbers to exclude
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

// Build a single JS that: opens login modal on the listing page, logs in, then reveals phone
function buildLoginAndExtractJS(marketplace: string, username: string, password: string): string {
  const isNhatot = marketplace === 'nhatot';
  
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
    
    // Helper to set input value with React compatibility
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    function setInput(el, val) {
      el.focus();
      nativeSetter.call(el, val);
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
    }
    
    // Step 0: Check if phone is already visible (no login needed)
    var telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (var i = 0; i < telLinks.length; i++) {
      var phone = telLinks[i].getAttribute('href').replace('tel:', '').trim();
      if (isValidPhone(phone)) {
        return JSON.stringify({phone: phone, method: 'tel_link_immediate', loginAttempted: false});
      }
    }
    
    // Step 1: Find and click the login button in the header/nav
    var loginClicked = false;
    var loginSelectors = ${isNhatot 
      ? `['a[href*="dang-nhap"]', 'button:has-text("Đăng nhập")', '[class*="login"]', '[data-aut-id="btnLogin"]']`
      : `['a[href*="dang-nhap"]', '.re__link-se--login', '[class*="login"]', 'a:has-text("Đăng nhập")']`
    };
    
    // Try CSS selectors first
    for (var s = 0; s < loginSelectors.length; s++) {
      try {
        var el = document.querySelector(loginSelectors[s]);
        if (el) { el.click(); loginClicked = true; break; }
      } catch(e) {}
    }
    
    // Fallback: find any element with "Đăng nhập" text
    if (!loginClicked) {
      var allEls = document.querySelectorAll('a, button, span, div');
      for (var j = 0; j < allEls.length; j++) {
        var txt = (allEls[j].textContent || '').trim();
        if (txt === 'Đăng nhập' || txt === 'ĐĂNG NHẬP') {
          allEls[j].click();
          loginClicked = true;
          break;
        }
      }
    }
    
    if (!loginClicked) {
      return JSON.stringify({phone: null, method: 'login_button_not_found', loginAttempted: false});
    }
    
    // Wait for login modal/form to appear
    await new Promise(r => setTimeout(r, 3000));
    
    // Step 2: Fill login form
    var userInput = null;
    var pwdInput = null;
    
    // Find username/email input
    var userSels = ['input[name="email"]', 'input[name="username"]', 'input[type="email"]', 'input[name="phone"]', 'input[type="tel"]', 'input[name="loginName"]'];
    for (var u = 0; u < userSels.length; u++) {
      var candidates = document.querySelectorAll(userSels[u]);
      for (var c = 0; c < candidates.length; c++) {
        // Pick visible input (not hidden)
        var style = window.getComputedStyle(candidates[c]);
        if (style.display !== 'none' && style.visibility !== 'hidden' && candidates[c].offsetParent !== null) {
          userInput = candidates[c];
          break;
        }
      }
      if (userInput) break;
    }
    
    // Fallback: find any visible text/email input in a form or modal
    if (!userInput) {
      var allInputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type])');
      for (var ai = 0; ai < allInputs.length; ai++) {
        var st = window.getComputedStyle(allInputs[ai]);
        if (st.display !== 'none' && st.visibility !== 'hidden' && allInputs[ai].offsetParent !== null) {
          // Check if it's in a modal/overlay context
          var parent = allInputs[ai].closest('[class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="popup"], [class*="Popup"], [class*="overlay"], [class*="login"], [class*="Login"]');
          if (parent) { userInput = allInputs[ai]; break; }
        }
      }
    }
    
    if (!userInput) {
      return JSON.stringify({phone: null, method: 'username_input_not_found', loginAttempted: true});
    }
    
    setInput(userInput, ${JSON.stringify(username)});
    await new Promise(r => setTimeout(r, 500));
    
    // Find password input
    var pwdCandidates = document.querySelectorAll('input[type="password"]');
    for (var p = 0; p < pwdCandidates.length; p++) {
      var pst = window.getComputedStyle(pwdCandidates[p]);
      if (pst.display !== 'none' && pst.visibility !== 'hidden' && pwdCandidates[p].offsetParent !== null) {
        pwdInput = pwdCandidates[p];
        break;
      }
    }
    
    if (!pwdInput) {
      return JSON.stringify({phone: null, method: 'password_input_not_found', loginAttempted: true});
    }
    
    setInput(pwdInput, ${JSON.stringify(password)});
    await new Promise(r => setTimeout(r, 500));
    
    // Step 3: Submit login
    var submitted = false;
    // Find submit button in the same form/modal context
    var form = userInput.closest('form');
    if (form) {
      var submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) { submitBtn.click(); submitted = true; }
      else {
        var btns = form.querySelectorAll('button');
        for (var b = 0; b < btns.length; b++) {
          var btxt = (btns[b].textContent || '').trim().toLowerCase();
          if (btxt.indexOf('đăng nhập') >= 0 || btxt.indexOf('login') >= 0) {
            btns[b].click(); submitted = true; break;
          }
        }
        if (!submitted) form.submit();
      }
      submitted = true;
    }
    
    if (!submitted) {
      // Try to find a submit button anywhere in a modal
      var modalBtns = document.querySelectorAll('[class*="modal"] button, [class*="Modal"] button, [class*="dialog"] button, [class*="login"] button');
      for (var mb = 0; mb < modalBtns.length; mb++) {
        var mbtxt = (modalBtns[mb].textContent || '').trim().toLowerCase();
        if (mbtxt.indexOf('đăng nhập') >= 0 || mbtxt.indexOf('login') >= 0) {
          modalBtns[mb].click(); submitted = true; break;
        }
      }
    }
    
    // Wait for login to complete
    await new Promise(r => setTimeout(r, 5000));
    
    // Step 4: Now try to reveal phone number
    // Click reveal buttons
    var revealTexts = ['Hiện số', 'Xem SĐT', 'Xem số', 'Bấm để hiện số'];
    var allClickables = document.querySelectorAll('button, a, span, div');
    for (var rv = 0; rv < allClickables.length; rv++) {
      var rvtxt = (allClickables[rv].textContent || '').trim();
      for (var rt = 0; rt < revealTexts.length; rt++) {
        if (rvtxt.indexOf(revealTexts[rt]) >= 0) {
          allClickables[rv].click();
          await new Promise(r => setTimeout(r, 3000));
          break;
        }
      }
    }
    
    // Also click marketplace-specific selectors
    ${marketplace === 'batdongsan' 
      ? `var bdsRevealSels = ['[class*="phone"] button', '.re__btn-short-info-phone', '.js__phone-btn', '.re__contact-phone button'];
    for (var bs = 0; bs < bdsRevealSels.length; bs++) {
      try { var bels = document.querySelectorAll(bdsRevealSels[bs]); for (var be = 0; be < bels.length; be++) bels[be].click(); } catch(e) {}
    }`
      : `var ntRevealSels = ['[class*="ContactPhone"] button', '[data-aut-id="btnPhone"]', 'button[class*="phone"]'];
    for (var ns = 0; ns < ntRevealSels.length; ns++) {
      try { var nels = document.querySelectorAll(ntRevealSels[ns]); for (var ne = 0; ne < nels.length; ne++) nels[ne].click(); } catch(e) {}
    }`}
    
    await new Promise(r => setTimeout(r, 2000));
    
    // Step 5: Extract phone number
    // Check tel: links
    telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (var t = 0; t < telLinks.length; t++) {
      var p2 = telLinks[t].getAttribute('href').replace('tel:', '').trim();
      if (isValidPhone(p2)) {
        return JSON.stringify({phone: p2, method: 'tel_link_after_login', loginAttempted: true});
      }
    }
    
    // Check phone-related elements
    var phoneSels = ['[class*="phone-number"]', '[class*="PhoneNumber"]', '[class*="phone__number"]', '.re__contact-phone', '[class*="ContactPhone"]'];
    for (var ps = 0; ps < phoneSels.length; ps++) {
      try {
        var pels = document.querySelectorAll(phoneSels[ps]);
        for (var pe = 0; pe < pels.length; pe++) {
          var ptxt = pels[pe].textContent.trim();
          var pmatch = ptxt.match(/0[3-9]\\d{8}/);
          if (pmatch && !isMasked(ptxt) && !isExcluded(pmatch[0])) {
            return JSON.stringify({phone: pmatch[0], method: 'phone_element_after_login', loginAttempted: true});
          }
        }
      } catch(e) {}
    }
    
    // Regex scan body
    var bodyText = document.body.innerText;
    var matches = bodyText.match(/0[3-9]\\d[\\s.-]?\\d{3}[\\s.-]?\\d{4}/g);
    if (matches) {
      for (var w = 0; w < matches.length; w++) {
        if (!isMasked(matches[w]) && !isExcluded(matches[w])) {
          return JSON.stringify({phone: matches[w], method: 'body_regex_after_login', loginAttempted: true});
        }
      }
    }
    
    // Check if we found only masked numbers
    var maskedFound = /0[3-9]\\d+\\*{2,}/.test(bodyText);
    return JSON.stringify({
      phone: null, 
      method: maskedFound ? 'masked_only_login_may_have_failed' : 'not_found_after_login',
      loginAttempted: true,
      currentUrl: window.location.href
    });
  })()`;
}

// Build simple extraction JS without login (for fallback)
function buildSimpleExtractJS(): string {
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
    
    // Check tel: links
    var telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (var i = 0; i < telLinks.length; i++) {
      var phone = telLinks[i].getAttribute('href').replace('tel:', '').trim();
      if (isValidPhone(phone)) {
        return JSON.stringify({phone: phone, method: 'tel_link_no_login'});
      }
    }
    
    // Click reveal buttons
    var allEls = document.querySelectorAll('button, a, span, div');
    for (var j = 0; j < allEls.length; j++) {
      var txt = (allEls[j].textContent || '').trim();
      if (txt.indexOf('Hiện số') >= 0 || txt.indexOf('Xem SĐT') >= 0) {
        allEls[j].click();
        await new Promise(r => setTimeout(r, 3000));
        break;
      }
    }
    
    // Re-check tel: links
    telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (var m = 0; m < telLinks.length; m++) {
      var p2 = telLinks[m].getAttribute('href').replace('tel:', '').trim();
      if (isValidPhone(p2)) {
        return JSON.stringify({phone: p2, method: 'tel_link_after_reveal'});
      }
    }
    
    // Body regex
    var bodyText = document.body.innerText;
    var match = bodyText.match(/0[3-9]\\d[\\s.-]?\\d{3}[\\s.-]?\\d{4}/g);
    if (match) {
      for (var w = 0; w < match.length; w++) {
        if (!isMasked(match[w]) && !isExcluded(match[w])) {
          return JSON.stringify({phone: match[w], method: 'body_regex_no_login'});
        }
      }
    }
    
    var maskedFound = /0[3-9]\\d+\\*{2,}/.test(bodyText);
    return JSON.stringify({phone: null, method: maskedFound ? 'masked_only' : 'not_found'});
  })()`;
}

function buildBQLQuery(): string {
  return `mutation ExtractPhone($url: String!, $jsCode: String!) {
  goto(url: $url, waitUntil: networkIdle) {
    status
    url
  }
  waitForPage: waitForSelector(selector: "body", timeout: 10000) {
    time
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
  const envKeys: Record<string, [string, string]> = {
    batdongsan: ['BATDONGSAN_USERNAME', 'BATDONGSAN_PASSWORD'],
    nhatot: ['NHATOT_USERNAME', 'NHATOT_PASSWORD'],
  };
  
  const [userKey, passKey] = envKeys[marketplace] || [];
  const username = userKey ? Deno.env.get(userKey) : null;
  const password = passKey ? Deno.env.get(passKey) : null;
  const hasCredentials = username && password;

  // Attempt 1: Login on listing page + extract
  if (hasCredentials) {
    try {
      console.log(`[extract-phone] Login+extract on listing page for ${marketplace}: ${listingUrl}`);
      const jsCode = buildLoginAndExtractJS(marketplace, username, password);
      const query = buildBQLQuery();
      const result = await executeBrowserlessScript(query, { url: listingUrl, jsCode }, 60000);

      const phoneResult = parsePhoneResult(result?.data?.phoneData?.value);
      console.log(`[extract-phone] Login+extract result: ${JSON.stringify(phoneResult)}`);
      if (phoneResult.phone) return phoneResult;
    } catch (error) {
      console.warn(`[extract-phone] Login+extract failed:`, error);
    }
  }

  // Attempt 2: Simple extraction without login
  try {
    console.log(`[extract-phone] Simple extract for: ${listingUrl}`);
    const jsCode = buildSimpleExtractJS();
    const query = buildBQLQuery();
    const result = await executeBrowserlessScript(query, { url: listingUrl, jsCode }, 30000);

    const phoneResult = parsePhoneResult(result?.data?.phoneData?.value);
    if (phoneResult.phone) {
      console.log(`[extract-phone] Simple extract found: ${phoneResult.phone}`);
      return phoneResult;
    }
  } catch (error) {
    console.warn(`[extract-phone] Simple extract failed:`, error);
  }

  return { phone: null, method: 'not_found' };
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
