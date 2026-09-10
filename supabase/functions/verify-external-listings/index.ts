import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fetchNhatotAd, buildNhatotListing } from '../_shared/nhatot.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FAILURE_THRESHOLD = 2;
const FETCH_TIMEOUT_MS = 10_000;
const BATCH_SIZE = 25;
const CONCURRENCY = 2;

// Tiered re-verification cadence, tuned to the HCMC market where units lease
// within 2-6 weeks of posting: a listing's entire high-churn life is its first
// ~42 days, so that whole window gets the fast cadence. Survivors past it
// (overpriced / long-tail) churn slower.
const RECENT_LISTING_DAYS = 42;      // the 6-week lease window = high churn risk
const RECENT_REVERIFY_DAYS = 2;      // inside the lease window: check every 2 days
const OLD_REVERIFY_DAYS = 5;         // past the window: every 5 days
const SUSPECT_REVERIFY_HOURS = 6;    // already failed once: confirm or clear it fast
const RESURRECTION_BATCH = 20;       // dead nhatot rows re-probed per run - see resurrectNhatotAds
const MAX_UNVERIFIED_AGE_DAYS = 45;  // unconfirmed past the lease window + grace: archive

type DeadResult = { status: 'alive' | 'dead' | 'error'; reason?: string };

const NHATOT_DEAD_KEYWORDS = [
  'tin đăng đã bị gỡ',
  'tin đăng không tồn tại',
  'không tồn tại',
  'tin-dang-het-han',
  'tin đăng đã hết hạn',
  'tin đã được bán',
  'tin đã hết hạn',
  'không tìm thấy tin đăng',
  'tin đăng này đã bị ẩn',
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

async function verifyPlain(url: string, deadKeywords: string[], expectedCode?: string): Promise<DeadResult> {
  try {
    const res = await fetchWithTimeout(url);
    const finalUrl = res.url.toLowerCase();
    if (res.status === 404 || res.status === 410) return { status: 'dead', reason: `http_${res.status}` };
    if (res.status >= 500) return { status: 'error', reason: `http_${res.status}` };
    if (finalUrl.includes('tin-dang-het-han') || finalUrl.includes('expired')) {
      return { status: 'dead', reason: 'redirect_expired' };
    }
    if (!res.ok) return { status: 'error', reason: `http_${res.status}` };

    // Removed listings often 200 after silently redirecting to the homepage
    // or a search page - a redirect that drops the listing path is dead.
    try {
      const originalPath = new URL(url).pathname.replace(/\/$/, '');
      const finalPath = new URL(res.url).pathname.replace(/\/$/, '');
      const slug = originalPath.split('/').filter(Boolean).pop() || '';
      if (originalPath && finalPath !== originalPath && slug && !finalPath.includes(slug)) {
        return { status: 'dead', reason: 'redirect_away' };
      }
    } catch { /* URL parse issues: fall through to content checks */ }

    const html = (await res.text()).toLowerCase();
    for (const kw of deadKeywords) {
      if (html.includes(kw)) return { status: 'dead', reason: `keyword:${kw}` };
    }
    // Strongest signal when we know the listing's property code (housingsgn):
    // a live listing page always contains its own code.
    if (expectedCode && !html.includes(expectedCode.toLowerCase())) {
      return { status: 'dead', reason: 'code_missing' };
    }
    return { status: 'alive' };
  } catch (e) {
    return { status: 'error', reason: (e as Error).message };
  }
}

// Browserless /function API: unlike /content, it exposes the FINAL URL after
// client-side redirects, so removed listings that bounce to the homepage or a
// search page are caught even when the page itself looks healthy.
async function verifyViaBrowserless(url: string, deadKeywords: string[]): Promise<DeadResult> {
  const browserlessKey = Deno.env.get('BROWSERLESS_API_KEY');
  if (!browserlessKey) return { status: 'error', reason: 'no_browserless_key' };
  try {
    const code = `export default async function ({ page, context }) {
      const response = await page.goto(context.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const html = await page.content();
      return {
        data: {
          status: response ? response.status() : 0,
          finalUrl: page.url(),
          html: html.slice(0, 300000),
        },
        type: 'application/json',
      };
    }`;
    const res = await fetch(`https://production-sfo.browserless.io/function?token=${browserlessKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, context: { url } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { status: 'error', reason: `browserless_${res.status}` };
    const raw = await res.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return { status: 'error', reason: 'browserless_parse' };
    }
    // /function may return the payload directly or wrapped in { data, type }
    if (data && typeof data === 'object' && data.data && typeof data.data === 'object') data = data.data;
    const status = Number(data?.status) || 0;
    const finalUrl = String(data?.finalUrl || '').toLowerCase();
    const html = typeof data?.html === 'string' ? data.html.toLowerCase() : '';
    // No content is a tooling failure, never evidence the listing is dead
    if (!html) return { status: 'error', reason: 'browserless_empty' };

    if (status === 404 || status === 410) return { status: 'dead', reason: `http_${status}` };
    if (status >= 500) return { status: 'error', reason: `http_${status}` };
    if (finalUrl.includes('tin-dang-het-han') || finalUrl.includes('expired')) {
      return { status: 'dead', reason: 'redirect_expired' };
    }
    // Redirect away from the listing path (homepage / search page) = removed
    try {
      const originalPath = new URL(url).pathname.replace(/\/$/, '');
      const finalPath = new URL(finalUrl).pathname.replace(/\/$/, '');
      const slug = originalPath.split('/').filter(Boolean).pop() || '';
      if (originalPath && finalPath !== originalPath && slug && !finalPath.includes(slug)) {
        return { status: 'dead', reason: 'redirect_away' };
      }
    } catch { /* URL parse issues: fall through to content checks */ }

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

// nhatot is chotot: the official public gateway gives a definitive answer
// ("entity not found" once an ad is delisted), far more reliable than
// scraping the SPA shell, which renders enough content to look alive.
async function verifyViaChototApi(url: string): Promise<DeadResult> {
  const idMatch = url.match(/(\d{6,})(?:\.htm)?(?:[?#].*)?$/);
  if (!idMatch) return { status: 'error', reason: 'no_list_id' };
  try {
    const res = await fetchWithTimeout(`https://gateway.chotot.com/v1/public/ad-listing/${idMatch[1]}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.status === 404) return { status: 'dead', reason: 'gateway_not_found' };
    if (!res.ok) return { status: 'error', reason: `gateway_${res.status}` };
    const data = await res.json().catch(() => null);
    if (data?.ad && typeof data.ad === 'object') return { status: 'alive' };
    const msg = String(data?.message || '').toLowerCase();
    if (msg.includes('not found')) return { status: 'dead', reason: 'gateway_not_found' };
    return { status: 'error', reason: 'gateway_unrecognized' };
  } catch (e) {
    return { status: 'error', reason: (e as Error).message };
  }
}

// Deactivation used to be a one-way door. Everything here selects on
// is_active = true, so once a listing was marked dead nothing looked at it
// again - and chotot ads do not stay dead. They expire, the seller bumps or
// reposts, and the SAME list id serves a live ad again. Probing 56 dead ids
// found 11% live, several reposted within hours of being written off.
//
// So the cheapest supply in the index is the part already written off: one
// gateway call per row, no crawling and no HTML. Rows come back newest-dead
// first, because a listing that died yesterday is far likelier to have been
// reposted than one that died in March.
//
// This is not the same thing as `is_relist`, which dedupe-external-listings
// sets when the same property reappears under a DIFFERENT id.
// deno-lint-ignore no-explicit-any
async function resurrectNhatotAds(supabase: any, summary: { resurrected: number }): Promise<void> {
  const { data: buried, error } = await supabase
    .from('external_properties')
    .select('id, source_url')
    .eq('source', 'nhatot')
    .eq('is_active', false)
    .eq('last_verification_reason', 'gateway_not_found')
    .order('deactivated_at', { ascending: false, nullsFirst: false })
    .limit(RESURRECTION_BATCH);

  if (error || !buried?.length) return;

  for (const row of buried as { id: string; source_url: string }[]) {
    const ad = await fetchNhatotAd(row.source_url);
    if (!ad) continue;
    const listing = buildNhatotListing(ad, row.source_url);
    // A repost that no longer clears the display floor is not worth reviving:
    // it would only be hidden again by the next pass.
    if (!listing || listing.images.length < 5) continue;

    const now = new Date().toISOString();
    await supabase.from('external_properties').update({
      is_active: true,
      deactivated_at: null,
      last_verified_at: now,
      last_verification_status: 'alive',
      last_verification_reason: null,
      verification_failures: 0,
      // The repost is a new ad in every respect but its id - price and gallery
      // are refreshed from it rather than trusting what we stored months ago.
      price: listing.price,
      price_display: listing.priceDisplay,
      images: listing.images,
      videos: listing.videos,
      updated_at: now,
    }).eq('id', row.id);

    summary.resurrected++;
    console.log(`[verify-external-listings] Resurrected ${row.id} - reposted at ${listing.priceDisplay}`);
  }

  if (summary.resurrected > 0) {
    console.log(`[verify-external-listings] Resurrection sweep: ${summary.resurrected}/${buried.length} back from the dead`);
  }
}

async function verifyListing(source: string, url: string, externalId?: string): Promise<DeadResult> {
  const kind = detectSource(source, url);
  // housingsgn property codes look like "CAL0223" - when the external_id is
  // one, a live page must contain it (guards against soft-404 pages).
  const code = kind === 'housingsgn' && externalId && /^[a-z]{2,5}\d{2,6}$/i.test(externalId)
    ? externalId
    : undefined;
  switch (kind) {
    case 'nhatot': {
      // Gateway API first (definitive); Browserless only as a fallback when
      // the gateway itself errors.
      const viaApi = await verifyViaChototApi(url);
      if (viaApi.status !== 'error') return viaApi;
      return await verifyViaBrowserless(url, NHATOT_DEAD_KEYWORDS);
    }
    // Batdongsan is Cloudflare-protected — go through Browserless
    case 'batdongsan': return await verifyViaBrowserless(url, BATDONGSAN_DEAD_KEYWORDS);
    case 'airbnb': return await verifyPlain(url, AIRBNB_DEAD_KEYWORDS);
    case 'housingsgn': return await verifyPlain(url, ['404 not found', 'không tìm thấy trang', 'page not found', 'trang không tồn tại'], code);
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

  const summary = { checked: 0, alive: 0, dead_increment: 0, deactivated: 0, stale_archived: 0, errors: 0, resurrected: 0, deactivated_ids: [] as string[] };

  try {
    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const recentCrawlCutoff = new Date(nowMs - RECENT_LISTING_DAYS * dayMs).toISOString();
    const recentReverifyCutoff = new Date(nowMs - RECENT_REVERIFY_DAYS * dayMs).toISOString();
    const oldReverifyCutoff = new Date(nowMs - OLD_REVERIFY_DAYS * dayMs).toISOString();
    const suspectReverifyCutoff = new Date(nowMs - SUSPECT_REVERIFY_HOURS * 60 * 60 * 1000).toISOString();
    const ageCapCutoff = new Date(nowMs - MAX_UNVERIFIED_AGE_DAYS * dayMs).toISOString();

    // Hard age cap: archive listings crawled >60 days ago that were never confirmed alive since
    const { data: staleRows } = await supabase
      .from('external_properties')
      .update({
        is_active: false,
        deactivated_at: new Date().toISOString(),
        last_verification_status: 'stale',
        last_verification_reason: `age_cap_${MAX_UNVERIFIED_AGE_DAYS}d`,
      })
      .eq('is_active', true)
      .lt('crawled_at', ageCapCutoff)
      .or(`last_verified_at.is.null,last_verified_at.lt.${ageCapCutoff}`)
      .select('id');
    const staleArchived = staleRows?.length ?? 0;
    summary.stale_archived = staleArchived;
    if (staleArchived > 0) {
      console.log(`[verify-external-listings] Age cap: archived ${staleArchived} stale listings`);
    }

    // Run before the "nothing due" early return below: the sweep looks at rows
    // the verification pass by definition never selects.
    await resurrectNhatotAds(supabase, summary);

    // Pull only listings due for a check, oldest-verified first (never-verified first).
    // Due = never verified, OR one dead result already on record (confirm or clear
    // it within hours rather than leaving a probably-gone listing up for days),
    // OR recent listing past its 2-day cadence, OR old listing past its 5-day one.
    const { data: listings, error } = await supabase
      .from('external_properties')
      .select('id, source, source_url, external_id, verification_failures')
      .eq('is_active', true)
      .or(
        `last_verified_at.is.null,` +
        `and(verification_failures.gte.1,last_verified_at.lte.${suspectReverifyCutoff}),` +
        `and(crawled_at.gte.${recentCrawlCutoff},last_verified_at.lte.${recentReverifyCutoff}),` +
        `last_verified_at.lte.${oldReverifyCutoff}`
      )
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
      const result = await verifyListing(item.source, item.source_url, item.external_id);
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
    if (summary.deactivated > 0 || summary.stale_archived > 0 || summary.resurrected > 0) {
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
