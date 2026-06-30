import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FAILURE_THRESHOLD = 2;
const FETCH_TIMEOUT_MS = 10_000;
const BATCH_SIZE = 25;
const CONCURRENCY = 2;

type DeadResult = { status: 'alive' | 'dead' | 'error'; reason?: string };

const NHATOT_DEAD_KEYWORDS = [
  'tin đăng đã bị gỡ',
  'tin đăng không tồn tại',
  'không tồn tại',
  'tin-dang-het-han',
  'tin đăng đã hết hạn',
];

const BATDONGSAN_DEAD_KEYWORDS = [
  'tin không tồn tại',
  'tin đã bị xóa',
  'tin đăng đã hết hạn',
  'tin đăng không tồn tại',
  'hết hạn',
  'không tìm thấy tin',
];

const AIRBNB_DEAD_KEYWORDS = [
  "we can't find",
  'listing unavailable',
  'this listing is no longer available',
  'page not found',
];

function detectSource(source: string, url: string): 'nhatot' | 'batdongsan' | 'airbnb' | 'housingsgn' | 'unknown' {
  const s = (source || '').toLowerCase();
  const u = (url || '').toLowerCase();
  if (s.includes('nhatot') || u.includes('nhatot')) return 'nhatot';
  if (s.includes('batdongsan') || u.includes('batdongsan')) return 'batdongsan';
  if (s.includes('airbnb') || u.includes('airbnb')) return 'airbnb';
  if (s.includes('housingsgn') || u.includes('housingsgn')) return 'housingsgn';
  return 'unknown';
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HaustoVerifier/1.0; +https://hausto.com)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

async function verifyPlain(url: string, deadKeywords: string[]): Promise<DeadResult> {
  try {
    const res = await fetchWithTimeout(url);
    const finalUrl = res.url.toLowerCase();
    if (res.status === 404 || res.status === 410) return { status: 'dead', reason: `http_${res.status}` };
    if (res.status >= 500) return { status: 'error', reason: `http_${res.status}` };
    if (finalUrl.includes('tin-dang-het-han') || finalUrl.includes('expired')) {
      return { status: 'dead', reason: 'redirect_expired' };
    }
    if (!res.ok) return { status: 'error', reason: `http_${res.status}` };

    const html = (await res.text()).toLowerCase();
    for (const kw of deadKeywords) {
      if (html.includes(kw)) return { status: 'dead', reason: `keyword:${kw}` };
    }
    return { status: 'alive' };
  } catch (e) {
    return { status: 'error', reason: (e as Error).message };
  }
}

async function verifyViaBrowserless(url: string, deadKeywords: string[]): Promise<DeadResult> {
  const browserlessKey = Deno.env.get('BROWSERLESS_API_KEY');
  if (!browserlessKey) return { status: 'error', reason: 'no_browserless_key' };
  try {
    const res = await fetch(`https://production-sfo.browserless.io/content?token=${browserlessKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 15_000 } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404 || res.status === 410) return { status: 'dead', reason: `http_${res.status}` };
    if (!res.ok) return { status: 'error', reason: `browserless_${res.status}` };
    const html = (await res.text()).toLowerCase();
    for (const kw of deadKeywords) {
      if (html.includes(kw)) return { status: 'dead', reason: `keyword:${kw}` };
    }
    // Heuristic: a healthy listing page is large; tiny responses likely indicate a notice page
    if (html.length < 2000) return { status: 'dead', reason: 'tiny_response' };
    return { status: 'alive' };
  } catch (e) {
    return { status: 'error', reason: (e as Error).message };
  }
}

async function verifyListing(source: string, url: string): Promise<DeadResult> {
  const kind = detectSource(source, url);
  switch (kind) {
    // Both Nhatot and Batdongsan are Cloudflare-protected — go through Browserless
    case 'nhatot': return await verifyViaBrowserless(url, NHATOT_DEAD_KEYWORDS);
    case 'batdongsan': return await verifyViaBrowserless(url, BATDONGSAN_DEAD_KEYWORDS);
    case 'airbnb': return await verifyPlain(url, AIRBNB_DEAD_KEYWORDS);
    case 'housingsgn': return await verifyPlain(url, ['404 Not Found', 'không tìm thấy trang']);
    default: return { status: 'error', reason: 'unknown_source' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } }
  );

  const summary = { checked: 0, alive: 0, dead_increment: 0, deactivated: 0, errors: 0, deactivated_ids: [] as string[] };

  try {
    // Pull batch ordered by oldest verified first (NULLS FIRST so never-verified come first)
    const { data: listings, error } = await supabase
      .from('external_properties')
      .select('id, source, source_url, verification_failures')
      .eq('is_active', true)
      .order('last_verified_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!listings || listings.length === 0) {
      return new Response(JSON.stringify({ message: 'No active external listings to verify', summary }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[verify-external-listings] Verifying ${listings.length} listings`);

    const processOne = async (item: any) => {
      summary.checked++;
      const result = await verifyListing(item.source, item.source_url);
      const now = new Date().toISOString();

      if (result.status === 'alive') {
        summary.alive++;
        await supabase.from('external_properties').update({
          last_verified_at: now,
          last_verification_status: 'alive',
          last_verification_reason: null,
          verification_failures: 0,
        }).eq('id', item.id);
      } else if (result.status === 'dead') {
        const newCount = (item.verification_failures || 0) + 1;
        summary.dead_increment++;
        const update: Record<string, unknown> = {
          last_verified_at: now,
          last_verification_status: 'dead',
          last_verification_reason: result.reason ?? 'unknown',
          verification_failures: newCount,
        };
        if (newCount >= FAILURE_THRESHOLD) {
          update.is_active = false;
          update.deactivated_at = now;
          summary.deactivated++;
          summary.deactivated_ids.push(item.id);
        }
        await supabase.from('external_properties').update(update).eq('id', item.id);
        console.log(`[verify-external-listings] Dead (${newCount}/${FAILURE_THRESHOLD}) - ${item.id} - ${result.reason}`);
      } else {
        summary.errors++;
        await supabase.from('external_properties').update({
          last_verified_at: now,
          last_verification_status: 'error',
          last_verification_reason: result.reason ?? 'unknown',
        }).eq('id', item.id);
        console.log(`[verify-external-listings] Error - ${item.id} - ${result.reason}`);
      }
    };

    // Process in concurrent chunks to stay within edge timeout while limiting Browserless parallelism
    for (let i = 0; i < listings.length; i += CONCURRENCY) {
      const chunk = listings.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(processOne));
    }

    // Invalidate discovery cache if we deactivated anything
    if (summary.deactivated > 0) {
      try {
        await supabase.functions.invoke('property-discovery-cache', { body: { action: 'invalidate' } });
      } catch (e) {
        console.error('[verify-external-listings] Cache invalidation failed:', e);
      }
    }

    return new Response(JSON.stringify({ message: 'Verification complete', summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[verify-external-listings] Fatal error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message, summary }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
