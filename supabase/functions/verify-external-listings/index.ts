import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { assessVerification } from '../_shared/crawl-telemetry.ts';
import { fetchNhatotAd, buildNhatotListing, type NhatotAd } from '../_shared/nhatot.ts';
import { normalizeListingCopy } from '../_shared/listing-language.ts';
import { repricedCopy } from '../_shared/repriced-copy.ts';
import { AGENCY_FEED_SOURCES, agencySourceOf, verifyAgencyListing } from '../_shared/agency-sources.ts';

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

// batdongsan is the one source every check of which costs a Browserless
// session (Cloudflare), so it runs on its own slower cadence and a daily
// ceiling instead of the tiers above. On the 2-day tier its ~100 listings
// spent ~50 units a day. The ceiling wins over the cadence: with more listings
// due than it allows, the oldest-verified go first and the rest wait, which
// still keeps every row well inside MAX_UNVERIFIED_AGE_DAYS. Counted from
// rows verified in the last 24h, so nhatot's rare Browserless fallback is not
// included - leave headroom for it.
const BATDONGSAN_REVERIFY_DAYS = 7;
const BATDONGSAN_DAILY_CHECKS = 4;

// `livePrice` is set only by verifiers that can read the listing's own price
// back. It is what separates "the URL still resolves" from "this unit is still
// on offer at this price", which is the only version ops can act on. `ad` is
// the payload it was read from, kept so a re-price can rewrite the description
// without a second fetch (_shared/repriced-copy.ts).
type DeadResult = { status: 'alive' | 'dead' | 'error'; reason?: string; livePrice?: number; liveDisplay?: string; ad?: NhatotAd };

// Sources whose price can be re-read during verification, and which are
// therefore subject to the freshness decay below. nhatot's ad payload carries
// the price; batdongsan and housingsgn would need their detail pages parsed,
// which costs a Firecrawl fetch per listing and is not built. They keep
// price_confirmed_at NULL and are deliberately exempt - decaying listings whose
// price we have no way to check would delete supply to no purpose.
//
// The agency feeds read their rent back for free - rentapartment from its REST
// record, vnrenthome from its JSON-LD (_shared/agency-sources.ts) - so they are
// held to the same standard.
const PRICE_CONFIRMING_SOURCES = new Set(['nhatot', ...AGENCY_FEED_SOURCES]);

// Dead results that are the source itself saying the unit is gone, as opposed
// to a page that failed to load or matched a keyword. Only these earn
// `delisted_at` (see the dead branch below).
const SOURCE_SAYS_GONE = new Set(['gateway_not_found', 'source_rented', 'source_not_found']);

// How far a price may move before it is a different offer rather than rounding.
const PRICE_DRIFT_TOLERANCE = 0.02;

// Without a price confirmation in this long, a listing stops being something
// ops can be asked to act on.
const PRICE_CONFIRMATION_TTL_DAYS = 21;

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
    if (data?.ad && typeof data.ad === 'object') {
      const price = typeof data.ad.price === 'number' && data.ad.price > 0 ? data.ad.price : undefined;
      return { status: 'alive', livePrice: price, ad: data.ad };
    }
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
    .select('id, source_url, title')
    .eq('source', 'nhatot')
    .eq('is_active', false)
    .eq('last_verification_reason', 'gateway_not_found')
    .order('deactivated_at', { ascending: false, nullsFirst: false })
    .limit(RESURRECTION_BATCH);

  if (error || !buried?.length) return;

  for (const row of buried as { id: string; source_url: string; title: string | null }[]) {
    const ad = await fetchNhatotAd(row.source_url);
    if (!ad) continue;
    const listing = buildNhatotListing(ad, row.source_url);
    // A repost that no longer clears the display floor is not worth reviving:
    // it would only be hidden again by the next pass.
    if (!listing || listing.images.length < 5) continue;

    const copy = await repricedCopy(ad, row.source_url, row.title, normalizeListingCopy);
    const now = new Date().toISOString();
    await supabase.from('external_properties').update({
      is_active: true,
      deactivated_at: null,
      // A repost clears the delisting it earned: the listing's own source is
      // serving it again, which is the same class of evidence that set it.
      delisted_at: null,
      last_verified_at: now,
      last_verification_status: 'alive',
      last_verification_reason: null,
      verification_failures: 0,
      // The repost is a new ad in every respect but its id - price, gallery
      // and description are refreshed from it rather than trusting what we
      // stored months ago. Taking the price straight off the payload IS a
      // price confirmation, and the freshest one available, so the decay clock
      // restarts here.
      price: listing.price,
      price_display: listing.priceDisplay,
      price_confirmed_at: now,
      images: listing.images,
      videos: listing.videos,
      ...(copy ?? {}),
      updated_at: now,
    }).eq('id', row.id);

    summary.resurrected++;
    console.log(`[verify-external-listings] Resurrected ${row.id} - reposted at ${listing.priceDisplay}`);
  }

  if (summary.resurrected > 0) {
    console.log(`[verify-external-listings] Resurrection sweep: ${summary.resurrected}/${buried.length} back from the dead`);
  }
}

// Decay: a listing nobody has confirmed the price of in three weeks is not
// something ops can be asked to act on, however reliably its URL keeps
// resolving. This is the half `last_verified_at` never covered.
//
// Restricted to sources whose price can actually be read back. Applying it to
// batdongsan or housingsgn today would sweep out listings for failing a check
// that was never run against them - deleting supply to no purpose, which is the
// opposite of what this milestone is for. They become eligible by teaching their
// verifiers to return `livePrice`, not by changing this function.
// deno-lint-ignore no-explicit-any
async function decayUnconfirmedListings(supabase: any, summary: { decayed: number }): Promise<void> {
  const cutoff = new Date(Date.now() - PRICE_CONFIRMATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const { data: stale, error } = await supabase
    .from('external_properties')
    .update({
      is_active: false,
      delisted_at: now,
      last_verification_status: 'stale',
      last_verification_reason: `price_unconfirmed_${PRICE_CONFIRMATION_TTL_DAYS}d`,
      updated_at: now,
    })
    .eq('is_active', true)
    .in('source', [...PRICE_CONFIRMING_SOURCES])
    // A row that has never been verified falls back to `crawled_at`, because
    // crawling it IS when its price was last read off the source. Without that,
    // a listing crawled an hour ago has a NULL confirmation and would be swept
    // on the very next run - decaying the freshest supply in the index.
    .or(`price_confirmed_at.lt.${cutoff},and(price_confirmed_at.is.null,crawled_at.lt.${cutoff})`)
    .select('id');

  if (error) {
    console.warn('[verify-external-listings] Decay sweep failed:', error.message);
    return;
  }
  summary.decayed = stale?.length ?? 0;
  if (summary.decayed > 0) {
    console.log(`[verify-external-listings] Decayed ${summary.decayed} listing(s) unconfirmed for ${PRICE_CONFIRMATION_TTL_DAYS}+ days`);
  }
}

async function verifyListing(source: string, url: string, externalId?: string): Promise<DeadResult> {
  // An agency the feed marks rented is dead on the source's own word, and a
  // live one hands back its current rent.
  const agency = agencySourceOf(source, url);
  if (agency) return await verifyAgencyListing(agency, url);
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

  // `deactivation_reasons` is the tally behind the 20% ceiling below: which
  // reason took each listing off the index, not just how many went.
  const summary = { checked: 0, alive: 0, dead_increment: 0, deactivated: 0, stale_archived: 0, errors: 0, resurrected: 0, reprice: 0, delisted: 0, decayed: 0, deactivated_ids: [] as string[], deactivation_reasons: {} as Record<string, number> };

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
      // Units an agent confirmed for a request (source 'concierge') have no page to
      // check and their own 14-day expiry - see offer.ts.
      .neq('source', 'concierge')
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

    // After resurrection, so an ad that came back today is not swept for a
    // confirmation it just received.
    await decayUnconfirmedListings(supabase, summary);

    // Pull only listings due for a check, oldest-verified first (never-verified first).
    // Due = never verified, OR one dead result already on record (confirm or clear
    // it within hours rather than leaving a probably-gone listing up for days),
    // OR recent listing past its 2-day cadence, OR old listing past its 5-day one.
    // batdongsan is pulled separately below, under its own budget.
    const { data: tiered, error } = await supabase
      .from('external_properties')
      .select('id, source, source_url, external_id, verification_failures, price, price_display, title')
      .eq('is_active', true)
      .neq('source', 'concierge')
      .neq('source', 'batdongsan')
      .or(
        `last_verified_at.is.null,` +
        `and(verification_failures.gte.1,last_verified_at.lte.${suspectReverifyCutoff}),` +
        `and(crawled_at.gte.${recentCrawlCutoff},last_verified_at.lte.${recentReverifyCutoff}),` +
        `last_verified_at.lte.${oldReverifyCutoff}`
      )
      .order('last_verified_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

    if (error) throw error;

    const { count: bdsUsed, error: bdsCountError } = await supabase
      .from('external_properties')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'batdongsan')
      .gte('last_verified_at', new Date(nowMs - dayMs).toISOString());
    if (bdsCountError) throw bdsCountError;

    const bdsBudget = Math.max(0, BATDONGSAN_DAILY_CHECKS - (bdsUsed ?? 0));
    let bds: typeof tiered = [];
    if (bdsBudget > 0) {
      const bdsReverifyCutoff = new Date(nowMs - BATDONGSAN_REVERIFY_DAYS * dayMs).toISOString();
      const { data, error: bdsError } = await supabase
        .from('external_properties')
        .select('id, source, source_url, external_id, verification_failures, price, price_display, title')
        .eq('is_active', true)
        .eq('source', 'batdongsan')
        .or(
          `last_verified_at.is.null,` +
          `and(verification_failures.gte.1,last_verified_at.lte.${suspectReverifyCutoff}),` +
          `last_verified_at.lte.${bdsReverifyCutoff}`
        )
        .order('last_verified_at', { ascending: true, nullsFirst: true })
        .limit(Math.min(bdsBudget, BATCH_SIZE));
      if (bdsError) throw bdsError;
      bds = data ?? [];
    }

    const listings = [...(tiered ?? []), ...(bds ?? [])];
    if (listings.length === 0) {
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
        const update: Record<string, unknown> = {
          last_verified_at: now,
          last_verification_status: 'alive',
          last_verification_reason: null,
          verification_failures: 0,
        };

        if (typeof result.livePrice === 'number') {
          // Reading the price back is the point of the exercise, so record when
          // it happened whether or not the number moved.
          update.price_confirmed_at = now;

          const stored = Number(item.price) || 0;
          const drift = stored > 0 ? Math.abs(result.livePrice - stored) / stored : 1;
          if (drift > PRICE_DRIFT_TOLERANCE) {
            // A moved price does NOT delist the unit. The seller re-priced; the
            // unit is still on offer and we want it, at the new number. What
            // would be wrong is leaving ops to quote a figure the broker has
            // already changed - that is the mismatch `price_vnd_at_request` in
            // SPEC exists to catch, and it should not have to.
            update.price = result.livePrice;
            update.price_display = result.liveDisplay ?? `${result.livePrice.toLocaleString()} VND`;
            if (result.ad) {
              const copy = await repricedCopy(result.ad, item.source_url, item.title, normalizeListingCopy);
              if (copy) Object.assign(update, copy);
              else console.warn(`[verify-external-listings] Reprice ${item.id}: description not rewritten, may still quote the old rent`);
            }
            summary.reprice++;
            console.log(`[verify-external-listings] Reprice ${item.id}: ${stored.toLocaleString()} -> ${result.livePrice.toLocaleString()} VND`);
          }
        }

        await supabase.from('external_properties').update(update).eq('id', item.id);
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
          const why = result.reason ?? 'unknown';
          summary.deactivation_reasons[why] = (summary.deactivation_reasons[why] ?? 0) + 1;
          // `delisted_at` is the stronger claim and only some evidence earns it.
          // The chotot ad API answering "no ad found" twice is the listing's own
          // source saying it is gone. A page that failed to load, redirected, or
          // matched a keyword is not - that is what `deactivated_at` records,
          // and on nhatot it is routinely wrong, since expired ads come back
          // under the same id when the seller reposts.
          if (PRICE_CONFIRMING_SOURCES.has(item.source) && SOURCE_SAYS_GONE.has(result.reason ?? '')) {
            update.delisted_at = now;
            summary.delisted++;
          }
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

    // PLAN-v3 S1: a single verification reason must not silently deactivate
    // more than 20% of a run. This is the check that would have caught the
    // nhatot collapse in August, and it is also what would catch the gateway
    // genuinely starting to refuse us - the two look identical from inside a
    // single listing, and only the share tells them apart.
    //
    // It warns rather than halting. Stopping the pass would leave the index
    // half-verified on a threshold that might be a real cull, and a loud log
    // with the reason named is what a person can actually act on.
    const health = assessVerification({ checked: summary.checked, reasons: summary.deactivation_reasons });
    if (!health.healthy) {
      console.error(`[verify-external-listings] DEACTIVATION SKEW: ${health.message}`);
    }

    // Invalidate discovery cache if we deactivated anything
    if (summary.deactivated > 0 || summary.stale_archived > 0 || summary.resurrected > 0 || summary.decayed > 0) {
      try {
        await supabase.functions.invoke('property-discovery-cache', { body: { action: 'invalidate' } });
      } catch (e) {
        console.error('[verify-external-listings] Cache invalidation failed:', e);
      }
    }

    return new Response(JSON.stringify({ message: 'Verification complete', summary, health }), {
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
