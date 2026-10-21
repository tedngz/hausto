import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ANALYZE_COUNT } from '../_shared/vibe-policy.ts';
import { assessRun, BLIND_STREAK, blindStreak, type RunAssessment } from '../_shared/crawl-telemetry.ts';
import { sameBodyHash } from '../_shared/qstash-body-hash.ts';
import { FIRECRAWL_DAILY_CREDITS, firecrawlCreditsLeft, planRun, upstashCounter } from '../_shared/firecrawl-budget.ts';
import { isAgencyFeedSource } from '../_shared/agency-feeds.ts';
import { cronEveryMinutes } from '../_shared/crawl-cadence.ts';

// The Supabase edge runtime's own global, which Deno's types do not declare.
// Type-only: erased at compile time, so it changes nothing that runs.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Vibe analysis runs in analyze-vibe, on Claude; without its key there is no
// point asking for it.
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL')!;
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!;
const QSTASH_TOKEN = Deno.env.get('QSTASH_TOKEN');
const QSTASH_CURRENT_SIGNING_KEY = Deno.env.get('QSTASH_CURRENT_SIGNING_KEY');
const QSTASH_NEXT_SIGNING_KEY = Deno.env.get('QSTASH_NEXT_SIGNING_KEY');

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/scheduled-crawl`;

const CONFIG_KEY = 'crawl:config';
// How often pg_cron calls this function (the `auto-crawl-v3` job, jobid 13).
// It need not be the only trigger: every caller that sends no `action` starts a
// rotation run, so `status` reports this job alongside the QStash schedules it
// lists live, and the admin page sums them to say how long one rotation takes.
// On 2026-10-15 a QStash schedule fired beside this job on every tick, and the
// rotation ran twice as fast as a page counting only pg_cron said.
const CRON_MINUTES = 30;
const PG_CRON_JOB = 'auto-crawl-v3';
const DAILY_COUNT_KEY = 'crawl:daily_count';

// The runtime kills this worker 150s after the request arrived, with no catch
// block, no finally and no log line - the caller just gets a 504 (one landed at
// exactly +150.0s on 2026-10-15 16:05:12). Anything still pending then is lost,
// and QStash answers the 504 by retrying, which starts a fresh rotation run.
// So a run answers by ANSWER_BY_MS, and everything after the scrape fits into
// what is left rather than assuming it has time.
const WALL_CLOCK_MS = 150_000;
const ANSWER_BY_MS = WALL_CLOCK_MS - 10_000;
// What closeRun needs after the scrape: three small queries.
const CLOSE_RESERVE_MS = 8_000;
// One inline vibe analysis took 18-26s in the 2026-10-15 logs. Starting one
// with less left than this is how a run outlived the wall clock.
const INLINE_VIBE_MS = 40_000;

// The daily cap is a Firecrawl guard, so it belongs per source: what it is
// really rationing is one detail-page fetch per listing, and not every source
// spends one.
//
//   batdongsan, housingsgn   1 Firecrawl fetch per listing (scrapeDetailPage)
//   nhatot                   0 - the chotot ad payload replaces the fetch
//   rentapartment,           0 - and no search page either: all three are
//   vnrenthome, jhouse           read from the agency's own feed (_shared/agency-feeds.ts)
//
// Both still cost one search-page fetch per RUN, and one vision pass per
// listing. The vision pass is not worth rationing: 1447 calls over 14 days came
// to $2.12 on gpt-4o-mini, and Claude Haiku 5.5 is cheaper per photo.
//
// nhatot is held at the same 20 as the others for now, even though its
// Firecrawl cost would allow far more. Only 6.8% of HCMC nhatot rows ever
// crawled are still active, against ~50% for batdongsan: chotot ads run out and
// sellers repost, so a bigger nhatot index decays rather than accumulates.
// Crawling harder into that would buy churn.
//
// Raise it once `delisted_at` lands (PLAN-v3 S1 item 5) and the survival rate
// has been measured with the discovery fix in place - the resurrection sweep is
// already running. This is the one line to change; the per-source machinery
// below is what makes raising it safe, since nhatot's budget is no longer
// shared with the sources that actually spend Firecrawl per listing.
const MAX_DAILY_LISTINGS: Record<string, number> = {
  batdongsan: 20,
  housingsgn: 20,
  nhatot: 20,
  rentapartment: 20,
  vnrenthome: 20,
  jhouse: 20,
};
const DEFAULT_MAX_DAILY_LISTINGS = 20;

function dailyCapFor(source: string): number {
  return MAX_DAILY_LISTINGS[source] ?? DEFAULT_MAX_DAILY_LISTINGS;
}

// ===== QStash signature verification =====
async function verifyQStashSignature(signature: string, body: string): Promise<boolean> {
  // QStash signs with a JWT in the upstash-signature header
  // We verify the JWT signature using HMAC-SHA256 with the signing keys
  for (const key of [QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY]) {
    if (!key) continue;
    try {
      const parts = signature.split('.');
      if (parts.length !== 3) continue;
      
      const encoder = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      );
      
      const signatureBytes = Uint8Array.from(
        atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
        c => c.charCodeAt(0)
      );
      
      const dataToVerify = encoder.encode(`${parts[0]}.${parts[1]}`);
      const valid = await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, dataToVerify);
      
      if (valid) {
        // Also check expiry from JWT payload
        try {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            console.log('[scheduled-crawl] QStash JWT expired');
            continue;
          }
          // Verify body hash if present. QStash sends it in base64url, so it is
          // compared alphabet- and padding-blind (_shared/qstash-body-hash.ts).
          if (payload.body) {
            const bodyHash = await crypto.subtle.digest('SHA-256', encoder.encode(body));
            if (!sameBodyHash(String(payload.body), new Uint8Array(bodyHash))) {
              console.log('[scheduled-crawl] QStash body hash mismatch');
              continue;
            }
          }
        } catch { /* payload parse error, still accept if signature valid */ }
        return true;
      }
    } catch (e) {
      console.error('[scheduled-crawl] QStash verify error:', e);
    }
  }
  return false;
}

// Never returns the secret itself - verify_cron_secret() is SECURITY DEFINER
// and answers with a boolean, so the plaintext stays inside the database.
async function isValidCronSecret(supabase: any, token: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('verify_cron_secret', { _token: token });
    if (error) {
      console.error('[scheduled-crawl] cron secret check failed:', error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error('[scheduled-crawl] cron secret check error:', e);
    return false;
  }
}

async function isAdminUser(supabase: any, token: string): Promise<boolean> {
  if (!token || token === SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    if (!userId) return false;
    const { data: role } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    return !!role;
  } catch (e) {
    console.error('[scheduled-crawl] admin check error:', e);
    return false;
  }
}

// ===== QStash self-chaining: publish a follow-up message =====
// Fallback fire-and-forget self-invocation (used when QStash isn't available)
function selfInvokeFallback(payload: Record<string, unknown>, delaySec = 5): boolean {
  try {
    const task = (async () => {
      if (delaySec > 0) await new Promise(r => setTimeout(r, delaySec * 1000));
      try {
        const res = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify(payload),
        });
        console.log(`[scheduled-crawl] self-invoke fallback chain status=${res.status} payload=${JSON.stringify(payload)}`);
      } catch (err) {
        console.error('[scheduled-crawl] self-invoke fallback error:', err);
      }
    })();
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(task);
    }
    return true;
  } catch (e) {
    console.error('[scheduled-crawl] self-invoke schedule error:', e);
    return false;
  }
}

// ===== What starts a rotation run =====
// pg_cron's job lives in the database and is described by the constants above.
// QStash schedules are listed live: one was made in the Upstash console with
// nothing in the repo recording it, and only the API can say it is there.
interface RotationTrigger {
  kind: 'pg_cron' | 'qstash';
  name: string;
  cron: string;
  /** Minutes between runs, or null when the schedule fires unevenly. */
  everyMinutes: number | null;
  createdAt?: string;
}

async function rotationTriggers(): Promise<{ triggers: RotationTrigger[]; error?: string }> {
  const triggers: RotationTrigger[] = [
    { kind: 'pg_cron', name: PG_CRON_JOB, cron: `*/${CRON_MINUTES} * * * *`, everyMinutes: CRON_MINUTES },
  ];
  if (!QSTASH_TOKEN) return { triggers, error: 'QSTASH_TOKEN not set' };
  try {
    const res = await fetch('https://qstash.upstash.io/v2/schedules', {
      headers: { 'Authorization': `Bearer ${QSTASH_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { triggers, error: `QStash answered HTTP ${res.status}` };
    const schedules = await res.json() as {
      scheduleId: string; cron: string; destination: string; createdAt?: number; isPaused?: boolean;
    }[];
    for (const s of schedules) {
      // The account may hold schedules for other functions; only ours count.
      if (s.isPaused || s.destination?.replace(/\/+$/, '') !== FUNCTION_URL) continue;
      triggers.push({
        kind: 'qstash',
        name: s.scheduleId,
        cron: s.cron,
        everyMinutes: cronEveryMinutes(s.cron),
        createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : undefined,
      });
    }
    return { triggers };
  } catch (e) {
    return { triggers, error: `QStash schedules unreadable: ${(e as Error).message}` };
  }
}

async function qstashPublish(payload: Record<string, unknown>, delaySec = 5): Promise<boolean> {
  if (!QSTASH_TOKEN) {
    console.log('[scheduled-crawl] QSTASH_TOKEN not set, using self-invoke fallback');
    return selfInvokeFallback(payload, delaySec);
  }

  try {
    const res = await fetch(`https://qstash.upstash.io/v2/publish/${FUNCTION_URL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
        'Upstash-Delay': `${delaySec}s`,
        'Upstash-Retries': '2',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(`[scheduled-crawl] QStash self-chain published: messageId=${data.messageId}`);
      return true;
    }

    // A 4xx is QStash saying it did NOT take the message - a rejected token, a
    // malformed target URL. Nothing is queued, so self-invoking cannot
    // double-process the payload, and refusing to fall back only stalls the
    // chain until the next cron tick. That is what a rotated QSTASH_TOKEN did
    // here: every run logged one line and quietly dropped its continuation.
    //
    // 5xx and network errors keep the old no-fallback behaviour on purpose -
    // there the message may well have been accepted before the response was
    // lost, and self-invoking on top of it would run the work twice.
    console.error(`[scheduled-crawl] QStash publish rejected (HTTP ${res.status}):`, data);
    if (res.status === 401 || res.status === 403) {
      console.error(
        '[scheduled-crawl] QSTASH_TOKEN is set but Upstash rejects it. Rotate the token in the Upstash console '
        + 'and re-set the secret; chaining is running on the self-invoke fallback until then.',
      );
    }
    if (res.status >= 400 && res.status < 500) {
      return selfInvokeFallback(payload, delaySec);
    }
    return false;
  } catch (e) {
    console.error(
      '[scheduled-crawl] QStash publish error - not falling back, the message may have been accepted:', e,
    );
    return false;
  }
}

interface CrawlConfig {
  paused: boolean;
  frequencyMinutes: number;
  maxListingsPerRun: number;
  /** Floor in VND: sub-mid-range listings don't fit the target renter or carry Fast-Track margin */
  minPriceVnd: number;
  /** Which source platforms the rotation crawls; subset of MARKETPLACES */
  enabledMarketplaces: string[];
  /** Every source that existed when the config was last saved. A source added
   *  since is not in it, and starts enabled (see getConfig). */
  knownMarketplaces?: string[];
  configStorageError?: string;
}

// Sizing, because these two numbers are not independent and the arithmetic is
// not obvious from either one:
//
// A run crawls exactly ONE location+marketplace combo, and there are 10
// locations x 6 marketplaces = 60 of them (rentapartment and vnrenthome added
// 2026-10-14 as Hanoi and Da Nang were dropped, jhouse 2026-10-15). pg_cron
// fires every 30 minutes, so 48 runs a day means any given combo comes back
// around only every ~30 hours. The rotation, not `frequencyMinutes`, is what
// paces a source. That assumes pg_cron is the only trigger: each QStash schedule
// aimed here adds its own runs (see CRON_MINUTES), and with one beside it the
// rotation is ~15h, which a 24h cooldown overshoots. The admin page does this
// sum from `status` and warns when the cooldown is longer than the rotation.
//
// So frequencyMinutes only decides whether a due combo gets SKIPPED. Above ~30h
// it starts skipping runs outright (it was 2880, i.e. 48h); below ~30h it
// changes nothing, because the rotation is already slower than that. 1440 sits
// under the rotation period without pretending to be a real cadence, and taking
// it to the 30-minute floor would buy nothing.
//
// `maxListingsPerRun` is the actual throttle: the daily ceiling is roughly
// 48 x maxListingsPerRun. It was 1 in production, which is ~48 candidates a day
// across all three sources before rejections - and the observed rate was ~2.
// That, not a broken crawler, is why the index sat at 111 listings.
const DEFAULT_CONFIG: CrawlConfig = {
  paused: false,
  frequencyMinutes: 1440,
  maxListingsPerRun: 10,
  minPriceVnd: 5_000_000,
  enabledMarketplaces: ['batdongsan', 'nhatot', 'housingsgn', 'rentapartment', 'vnrenthome', 'jhouse'],
};

// Redis helpers
let lastRedisError: string | null = null;

async function redisGet(key: string): Promise<any> {
  try {
    const res = await fetch(`${UPSTASH_REDIS_REST_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(["GET", key]),
    });
    const data = await res.json();
    if (data.error) {
      lastRedisError = data.error;
      console.error('[Redis GET error]', key, data.error);
      return null;
    }
    if (data.result === null || data.result === undefined) return null;
    try { return JSON.parse(data.result); } catch { return data.result; }
  } catch (e) {
    lastRedisError = String(e);
    console.error('[Redis GET error]', key, e);
    return null;
  }
}

async function redisSet(key: string, value: any, exSeconds?: number): Promise<boolean> {
  try {
    const cmd = exSeconds
      ? ["SETEX", key, String(exSeconds), JSON.stringify(value)]
      : ["SET", key, JSON.stringify(value)];
    const res = await fetch(`${UPSTASH_REDIS_REST_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cmd),
    });
    const data = await res.json();
    if (data.error) {
      lastRedisError = data.error;
      console.error('[Redis SET error]', key, data.error);
      return false;
    }
    return true;
  } catch (e) {
    lastRedisError = String(e);
    console.error('[Redis SET error]', key, e);
    return false;
  }
}

async function getConfig(): Promise<CrawlConfig> {
  lastRedisError = null;
  const stored = await redisGet(CONFIG_KEY);
  if (lastRedisError) {
    return { ...DEFAULT_CONFIG, paused: true, configStorageError: lastRedisError };
  }
  if (!stored) return DEFAULT_CONFIG;
  const config: CrawlConfig = { ...DEFAULT_CONFIG, ...stored };
  // A saved `enabledMarketplaces` lists the sources an admin ticked, out of
  // the ones that existed then - so a source added later would never run until
  // someone found it and ticked it. One the saved config has never seen is
  // enabled instead; unticking it in admin tools saves it as known, and that
  // choice then sticks. Configs saved before `knownMarketplaces` existed knew
  // the original three.
  const known = new Set(stored.knownMarketplaces ?? LEGACY_MARKETPLACES);
  const unseen = MARKETPLACES.filter((m) => !known.has(m));
  if (Array.isArray(stored.enabledMarketplaces) && unseen.length > 0) {
    config.enabledMarketplaces = [...new Set([...stored.enabledMarketplaces, ...unseen])];
  }
  return config;
}

// Track last crawl time per location+marketplace in Redis
function crawlTrackKey(location: string, marketplace: string): string {
  const normalized = location.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `crawl:track:${normalized}:${marketplace}`;
}

async function getLastCrawlTime(location: string, marketplace: string): Promise<number | null> {
  const val = await redisGet(crawlTrackKey(location, marketplace));
  return val ? Number(val) : null;
}

async function setLastCrawlTime(location: string, marketplace: string): Promise<void> {
  const key = crawlTrackKey(location, marketplace);
  const timestamp = Date.now();
  console.log(`[scheduled-crawl] Setting crawl time: key=${key}, value=${timestamp}`);
  await redisSet(key, timestamp, 48 * 60 * 60);
  // Verify the write
  const readBack = await redisGet(key);
  console.log(`[scheduled-crawl] Verified crawl time: key=${key}, readBack=${readBack}`);
}

// Ho Chi Minh City's central districts only. Viewings are arranged there and
// nowhere else, so Hanoi (7 districts) and Da Nang (3) were dropped on
// 2026-10-08 (owner's decision): they took half the rotation and every
// Firecrawl credit it spent. Listings already held there stay searchable.
//
// The schedule is what keeps Firecrawl under its 50 a day
// (_shared/firecrawl-budget.ts, which also enforces it): 10 districts x 3
// sources, each every frequencyMinutes (2880), is 5 runs a source a day. At 3
// listings a run that is at most 45 credits - a search page each, and a detail
// page per new listing on batdongsan and housingsgn.
const CRAWL_LOCATIONS: { city: string; location: string }[] = [
  { city: 'ho_chi_minh', location: 'Quận 1' },
  { city: 'ho_chi_minh', location: 'Quận 3' },
  { city: 'ho_chi_minh', location: 'Quận 4' },
  { city: 'ho_chi_minh', location: 'Quận 7' },
  { city: 'ho_chi_minh', location: 'Quận 10' },
  { city: 'ho_chi_minh', location: 'Bình Thạnh' },
  { city: 'ho_chi_minh', location: 'Phú Nhuận' },
  { city: 'ho_chi_minh', location: 'Tân Bình' },
  { city: 'ho_chi_minh', location: 'Gò Vấp' },
  { city: 'ho_chi_minh', location: 'Thủ Đức' },
];

const MARKETPLACES = ['batdongsan', 'nhatot', 'housingsgn', 'rentapartment', 'vnrenthome', 'jhouse'] as const;
// The sources a config saved before `knownMarketplaces` was recorded knew about.
const LEGACY_MARKETPLACES = ['batdongsan', 'nhatot', 'housingsgn'];

const MIN_PRICE_VND = 5_000_000;
const MAX_PRICE_VND = 200_000_000;

function isSuspiciousListing(property: any): { suspicious: boolean; reason?: string } {
  if (!property.title || property.title.length < 5) {
    return { suspicious: true, reason: 'Title too short or missing' };
  }
  if (property.price && property.price > 0 && property.price < MIN_PRICE_VND) {
    return { suspicious: true, reason: `Price too low: ${property.price} VND` };
  }
  if (property.price && property.price > MAX_PRICE_VND) {
    return { suspicious: true, reason: `Price too high for rental: ${property.price} VND` };
  }
  if (!property.images || property.images.length === 0) {
    return { suspicious: true, reason: 'No images' };
  }
  const text = `${(property.title || '').toLowerCase()} ${(property.description || '').toLowerCase()}`;
  const saleKeywords = [
    'bán gấp', 'bán nhanh', 'cần bán', 'sang nhượng', 'for sale', 'mua bán',
    'bán căn', 'bán lô', 'bán đất', 'chuyển nhượng', 'bán chung cư', 'giá bán',
    'bán nhà', 'bán biệt thự', 'bán villa', 'mua ngay',
  ];
  for (const keyword of saleKeywords) {
    if (text.includes(keyword)) return { suspicious: true, reason: `Sale keyword: "${keyword}"` };
  }
  const nonResidentialKeywords = [
    'văn phòng cho thuê', 'office for rent', 'mặt bằng kinh doanh', 'mặt bằng cho thuê',
    'cửa hàng cho thuê', 'shop for rent', 'cho thuê shop',
    'kho xưởng', 'nhà xưởng', 'xưởng sản xuất', 'kho bãi', 'warehouse',
    'factory', 'industrial', 'công nghiệp', 'thương mại', 'commercial property',
    'kinh doanh mặt bằng', 'showroom', 'coworking', 'co-working',
    'đất nền', 'đất thổ cư', 'đất nông nghiệp', 'farmland', 'land for sale',
    'khách sạn', 'hotel for', 'resort for', 'motel', 'nhà nghỉ cho thuê',
    'căn hộ dịch vụ bán', 'penthouse bán',
    'văn phòng', 'office space', 'office', 'cho thuê văn phòng', 'thuê văn phòng',
    'officetel cho thuê', 'cho thuê officetel',
    'mặt bằng', 'retail space', 'commercial space', 'business space',
    'cho thuê mặt bằng', 'thuê mặt bằng',
  ];
  for (const keyword of nonResidentialKeywords) {
    if (text.includes(keyword)) return { suspicious: true, reason: `Non-residential: "${keyword}"` };
  }
  return { suspicious: false };
}

function normalizeSourceUrl(url: string): string {
  try {
    const u = new URL(url.toLowerCase().trim());
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source'];
    paramsToRemove.forEach(p => u.searchParams.delete(p));
    u.searchParams.sort();
    return u.toString().replace(/\/+$/, '');
  } catch {
    return url.toLowerCase().trim().replace(/\/+$/, '');
  }
}

function normalizeLocation(location: string): string {
  return location.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}


// Run vibe analysis for a property and update it
async function runVibeAnalysis(supabase: any, propertyId: string, propertyData: any): Promise<boolean> {
  if (!ANTHROPIC_API_KEY || !propertyData.images || propertyData.images.length === 0) return false;

  try {
    // One highlight per photo: analyse the whole stored gallery, not a sample.
    const imagesToAnalyze = propertyData.images.slice(0, ANALYZE_COUNT);
    console.log(`[scheduled-crawl] Running vibe analysis for "${propertyData.title}" (${imagesToAnalyze.length} images)`);

    const analyzeResponse = await fetch(`${SUPABASE_URL}/functions/v1/analyze-vibe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        imageUrls: imagesToAnalyze,
        generateContent: true,
        propertyInfo: {
          title: propertyData.title,
          location: propertyData.location,
          price: propertyData.price,
          size: propertyData.size,
          rooms: propertyData.rooms,
        },
      }),
    });

    if (!analyzeResponse.ok) {
      console.error(`[scheduled-crawl] analyze-vibe failed: ${analyzeResponse.status}`);
      await analyzeResponse.text(); // consume body
      return false;
    }

    const analyzeData = await analyzeResponse.json();
    // analyze-vibe returns { analysis: { image_analyses: [...], modern, cozy, ... } }
    const analysisResult = analyzeData.analysis;
    const imageAnalysesRaw = analysisResult?.image_analyses || [];
    if (!imageAnalysesRaw || imageAnalysesRaw.length === 0) {
      console.error('[scheduled-crawl] No image analyses returned from analyze-vibe');
      return false;
    }

    // Build image_analyses array with proper image_index for UI compatibility
    const imageAnalyses = imageAnalysesRaw.map((a: any, idx: number) => ({
      image_index: idx,
      image_highlight: a.image_highlight || '',
      detailed_analysis: a.detailed_analysis || '',
      amenities: a.amenities || [],
      suggested_activities: a.suggested_activities || [],
      suggested_amenities: a.suggested_amenities || [],
      vibe_scores: {
        modern: a.modern || 5, cozy: a.cozy || 5, luxurious: a.luxurious || 5,
        minimalist: a.minimalist || 5, spacious: a.spacious || 5,
        natural_light: a.natural_light || 5, urban: a.urban || 5, elegant: a.elegant || 5,
      },
    }));

    // Derive styles from aggregated vibe scores
    const vibeScoreMap: Record<string, number> = {
      'Modern': analysisResult.modern || 5,
      'Cozy': analysisResult.cozy || 5,
      'Luxurious': analysisResult.luxurious || 5,
      'Minimalist': analysisResult.minimalist || 5,
      'Spacious': analysisResult.spacious || 5,
      'Elegant': analysisResult.elegant || 5,
      'Urban': analysisResult.urban || 5,
      'Rustic': analysisResult.rustic || 5,
    };
    // Tags must discriminate: pick styles that STAND OUT relative to this
    // listing's own score profile, not everything above an absolute bar
    // (LLM positivity bias rates most photos 6-8 on modern/cozy/luxurious,
    // which used to tag every listing "Modern, Cozy, Luxurious").
    const scoreValues = Object.values(vibeScoreMap);
    const meanScore = scoreValues.reduce((s, v) => s + v, 0) / scoreValues.length;
    const derivedStyles = Object.entries(vibeScoreMap)
      .filter(([_, score]) => score >= 7 && score >= meanScore + 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([style]) => style);
    if (derivedStyles.length === 0) {
      // Flat profile: fall back to the single highest-scoring style
      const top = Object.entries(vibeScoreMap).sort((a, b) => b[1] - a[1])[0];
      derivedStyles.push(top && top[1] >= 6 ? top[0] : 'Contemporary');
    }

    // Derive colors from vibe scores
    const derivedColors: string[] = [];
    if ((analysisResult.cozy || 0) >= 6 || (analysisResult.rustic || 0) >= 6) derivedColors.push('Warm');
    if ((analysisResult.minimalist || 0) >= 6) derivedColors.push('Neutral');
    if ((analysisResult.modern || 0) >= 6) derivedColors.push('Cool');
    if ((analysisResult.colorful || 0) >= 6) derivedColors.push('Bold');
    if ((analysisResult.natural_light || 0) >= 7) derivedColors.push('Bright');
    if ((analysisResult.elegant || 0) >= 6) derivedColors.push('Refined');
    if (derivedColors.length === 0) derivedColors.push('Neutral', 'Warm');

    // Collect activities from all image analyses, restricted to quiz allowlist
    const ALLOWED_ACTIVITIES = ['Working', 'Reading', 'Relaxing', 'Entertaining', 'Cooking', 'Exercising'];
    const ACTIVITY_SYNONYMS: Record<string, string> = {
      'work': 'Working', 'working': 'Working', 'office': 'Working', 'study': 'Working', 'studying': 'Working',
      'read': 'Reading', 'reading': 'Reading',
      'relax': 'Relaxing', 'relaxing': 'Relaxing', 'living': 'Relaxing', 'lounging': 'Relaxing', 'resting': 'Relaxing', 'sleeping': 'Relaxing', 'meditation': 'Relaxing', 'meditating': 'Relaxing',
      'entertain': 'Entertaining', 'entertaining': 'Entertaining', 'socializing': 'Entertaining', 'hosting': 'Entertaining', 'gathering': 'Entertaining', 'dining': 'Entertaining',
      'cook': 'Cooking', 'cooking': 'Cooking', 'baking': 'Cooking',
      'exercise': 'Exercising', 'exercising': 'Exercising', 'workout': 'Exercising', 'yoga': 'Exercising', 'fitness': 'Exercising',
    };
    const normalizeActivity = (raw: string): string | null => {
      if (!raw || typeof raw !== 'string') return null;
      const key = raw.trim().toLowerCase();
      if (ACTIVITY_SYNONYMS[key]) return ACTIVITY_SYNONYMS[key];
      const matched = ALLOWED_ACTIVITIES.find(a => a.toLowerCase() === key);
      return matched || null;
    };
    const allActivities = new Set<string>();
    for (const a of imageAnalysesRaw) {
      if (a.suggested_activities) {
        a.suggested_activities.forEach((act: string) => {
          const normalized = normalizeActivity(act);
          if (normalized) allActivities.add(normalized);
        });
      }
    }
    const derivedActivities = Array.from(allActivities).slice(0, 5);
    if (derivedActivities.length === 0) derivedActivities.push('Relaxing');

    const updatedVibeAnalysis = {
      ...(propertyData.vibe_analysis || {}),
      image_analyses: imageAnalyses,
      styles: derivedStyles,
      colors: derivedColors,
      activities: derivedActivities,
      // Store aggregated vibe scores at top level for scoring
      modern: analysisResult.modern || 5,
      cozy: analysisResult.cozy || 5,
      luxurious: analysisResult.luxurious || 5,
      minimalist: analysisResult.minimalist || 5,
      spacious: analysisResult.spacious || 5,
      natural_light: analysisResult.natural_light || 5,
      urban: analysisResult.urban || 5,
      elegant: analysisResult.elegant || 5,
      rustic: analysisResult.rustic || 5,
      colorful: analysisResult.colorful || 5,
    };

    // Build positional highlights: one per image, aligned by index
    const positionalHighlights: string[] = new Array(imagesToAnalyze.length).fill('');
    
    imageAnalysesRaw.forEach((a: any, idx: number) => {
      if (a.image_highlight && typeof a.image_highlight === 'string' && a.image_highlight.trim()) {
        positionalHighlights[idx] = a.image_highlight.trim();
      }
    });
    
    // Fill gaps with fallback
    for (let i = 0; i < positionalHighlights.length; i++) {
      if (!positionalHighlights[i]) {
        positionalHighlights[i] = 'Premium living space feature';
      }
    }

    const allAmenities = new Set<string>(propertyData.amenities || []);
    for (const a of imageAnalysesRaw) {
      if (a.amenities) a.amenities.forEach((am: string) => allAmenities.add(am));
      if (a.suggested_amenities) a.suggested_amenities.forEach((am: string) => allAmenities.add(am));
    }

    await supabase
      .from('external_properties')
      .update({
        vibe_analysis: updatedVibeAnalysis,
        highlights: positionalHighlights,
        amenities: Array.from(allAmenities),
      })
      .eq('id', propertyId);

    console.log(`[scheduled-crawl] Vibe analysis done: ${positionalHighlights.length} image highlights for "${propertyData.title}"`);
    return true;
  } catch (e) {
    console.error('[scheduled-crawl] Vibe analysis error:', e);
    return false;
  }
}

// ===== One crawl of one target, measured =====
//
// Shared by the rotation and by an admin's on-demand crawl (`crawl-target`), so
// both go through scrape-marketplace's own save - its image floor, interior
// gate and vibe queue - and both leave the same row in `crawl_runs`, judged the
// same way. The admin page used to crawl through crawl-external-properties,
// which wrote listings live with none of those gates and no telemetry.

interface RunHandle { id: string | null; startedAt: string }

// Opened before the scrape so a run that times out or dies still leaves a row -
// the runs that vanish are exactly the ones worth seeing (PLAN-v3 S1.1).
async function openRun(supabase: any, source: string, location: string): Promise<RunHandle> {
  const startedAt = new Date().toISOString();
  try {
    const { data } = await supabase
      .from('crawl_runs')
      .insert({ source, location, started_at: startedAt })
      .select('id')
      .single();
    return { id: data?.id ?? null, startedAt };
  } catch (e) {
    // Telemetry must never cost a crawl. A run we cannot measure is still a
    // run worth doing.
    console.warn('[scheduled-crawl] crawl_runs insert failed:', e);
    return { id: null, startedAt };
  }
}

// scrape-marketplace saves as it goes (directSave), so even a call that times
// out here may have stored listings. `result` is null when it did not answer
// in time; `error` says why the run should not count as a clean one.
async function scrapeTarget(params: {
  marketplace: string;
  location: string;
  query: string;
  maxResults: number;
  minPrice: number;
  timeoutMs: number;
}): Promise<{ result: any | null; error: string | null }> {
  const timeoutMs = Math.max(10_000, Math.min(140_000, params.timeoutMs));
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/scrape-marketplace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        marketplace: params.marketplace,
        query: params.query,
        location: params.location,
        crawlLocation: params.location,
        includeVibeAnalysis: false,
        maxResults: params.maxResults,
        pages: 1,
        directSave: true,
        minPrice: params.minPrice,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const result = await res.json();
      console.log(`[scheduled-crawl] Scrape+save completed:`, JSON.stringify(result));
      return { result, error: result?.success ? null : 'scrape did not report success' };
    }
    console.error(`[scheduled-crawl] Scrape failed: ${res.status}`, await res.text());
    return { result: null, error: `scrape failed: HTTP ${res.status}` };
  } catch {
    console.warn(`[scheduled-crawl] Scrape call timed out for ${params.location}/${params.marketplace}, but directSave may have persisted partial results`);
    return { result: null, error: `scrape timed out after ${Math.round(timeoutMs / 1000)}s` };
  }
}

interface ScrapeCounts {
  newListings: number;
  updatedListings: number;
  duplicatesSkipped: number;
  filtered: number;
}

function countsOf(scrapeResult: any): ScrapeCounts {
  // Listings the search page showed that the index already holds are
  // duplicates as much as the ones the saver dedupes, and they are most of
  // any page. Uncounted, a page full of them read as an empty page.
  const knownOnPage = scrapeResult?.knownOnPage || 0;
  return {
    newListings: scrapeResult?.newListings || 0,
    updatedListings: scrapeResult?.updatedListings || 0,
    duplicatesSkipped: (scrapeResult?.duplicatesSkipped || 0) + knownOnPage,
    filtered: scrapeResult?.filtered || 0,
  };
}

// Close the telemetry row and judge the run.
//
// The reason breakdown comes from `crawler_rejections`, which already records
// one row per rejected candidate with its reason. Reading it back by (source,
// rejected_at >= startedAt) rather than threading a counter through
// scrape-marketplace keeps a 2,700-line function untouched. The cost is that a
// second concurrent run of the SAME source in the same window would have its
// rejections counted here too - rare, and it can only inflate a share that is
// already being flagged, never hide one.
async function closeRun(
  supabase: any,
  run: RunHandle,
  source: string,
  location: string,
  counts: ScrapeCounts,
  error: string | null,
): Promise<RunAssessment & { attempted: number }> {
  let reasons: Record<string, number> = {};
  try {
    const { data: rejections } = await supabase
      .from('crawler_rejections')
      .select('reason')
      .eq('source', source)
      .gte('rejected_at', run.startedAt)
      .limit(1000);
    for (const r of (rejections ?? []) as { reason: string }[]) {
      const key = r.reason ?? 'unknown';
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
  } catch (e) {
    console.warn('[scheduled-crawl] rejection readback failed:', e);
    reasons = {};
  }

  // `attempted` is derived rather than reported, so the parts always sum to
  // the whole: every candidate handed to the saver either landed, updated,
  // deduped or was filtered.
  const attempted = counts.newListings + counts.updatedListings + counts.duplicatesSkipped + counts.filtered;
  const assessment = assessRun({
    attempted,
    written: counts.newListings,
    updated: counts.updatedListings,
    duplicates: counts.duplicatesSkipped,
    rejected: counts.filtered,
    reasons,
  });

  if (run.id) {
    try {
      await supabase.from('crawl_runs').update({
        finished_at: new Date().toISOString(),
        attempted,
        written: counts.newListings,
        updated: counts.updatedListings,
        duplicates: counts.duplicatesSkipped,
        rejected: counts.filtered,
        reasons,
        healthy: assessment.healthy,
        verdict: assessment.verdict,
        error,
      }).eq('id', run.id);
    } catch (e) {
      console.warn('[scheduled-crawl] crawl_runs update failed:', e);
    }
  }

  // The line that was missing for 35 days. An unhealthy run is logged at
  // error level even though the HTTP response is a 200, because the response
  // is read by a cron that cannot act on it and the log is read by a person
  // who can.
  if (!assessment.healthy) {
    console.error(`[scheduled-crawl] UNHEALTHY ${source}/${location}: ${assessment.verdict} - ${assessment.message}`);
  }

  // One empty page is a quiet district; many in a row is a source we have
  // stopped seeing, which no single run's verdict can say (blindStreak).
  try {
    const { data: recent } = await supabase
      .from('crawl_runs')
      .select('attempted')
      .eq('source', source)
      .not('finished_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(BLIND_STREAK);
    const blind = blindStreak(source, (recent ?? []) as { attempted: number | null }[]);
    if (blind) console.error(`[scheduled-crawl] UNHEALTHY ${blind}`);
  } catch (e) {
    console.warn('[scheduled-crawl] blind-streak readback failed:', e);
  }

  return { ...assessment, attempted };
}

Deno.serve(async (req) => {
  console.log(`[scheduled-crawl] Request received: ${req.method} at ${new Date().toISOString()}`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Read body once for both QStash verification and action parsing
  const rawBody = await req.text();
  let body: Record<string, any> = {};
  try { body = JSON.parse(rawBody); } catch { /* empty body */ }

  // ===== Authorization =====
  // A run scrapes marketplaces and spends model budget on vibe analysis, so
  // every caller has to prove it is one of the four legitimate ones:
  //
  //   pg_cron          x-cron-secret header, checked against Vault
  //   QStash           signed message (self-chained continuations)
  //   self-invoke      service-role key (the QStash fallback path)
  //   admin tools page a signed-in user holding the admin role
  //
  // This used to end in `isAuthorized = true` for everything else, on the
  // grounds that pg_cron authenticates with the anon key. The anon key is
  // published in the client bundle, so that check could not tell pg_cron apart
  // from any stranger with curl - the endpoint was open. pg_cron now sends a
  // dedicated secret instead (20260818140000_scheduled_crawl_cron_auth.sql).
  const qstashSignature = req.headers.get('upstash-signature');
  const cronSecret = req.headers.get('x-cron-secret') || '';
  const authToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if (qstashSignature) {
    const validSignature = await verifyQStashSignature(qstashSignature, rawBody);
    if (!validSignature) {
      console.log('[scheduled-crawl] QStash signature verification failed');
      return new Response(JSON.stringify({ error: 'Invalid QStash signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // A delivery from a QStash schedule carries its id, which is what traces a
    // run back to a schedule in the Upstash console.
    const scheduleId = req.headers.get('upstash-schedule-id');
    console.log(`[scheduled-crawl] Authorized via QStash signature${scheduleId ? ` (schedule ${scheduleId})` : ''}`);
  } else if (cronSecret && await isValidCronSecret(supabase, cronSecret)) {
    console.log('[scheduled-crawl] Authorized via cron secret');
  } else if (authToken && authToken === SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[scheduled-crawl] Authorized via service role key');
  } else if (await isAdminUser(supabase, authToken)) {
    console.log('[scheduled-crawl] Authorized via admin user');
  } else {
    console.warn('[scheduled-crawl] Rejected unauthorized request');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log(`[scheduled-crawl] Body:`, JSON.stringify(body));

    // Handle config management actions
    if (body.action === 'get-config') {
      const config = await getConfig();
      return new Response(JSON.stringify({ success: true, config }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'set-config') {
      // Checked separately from the top-level gate on purpose: pg_cron is
      // allowed to start a crawl and has no business rewriting the schedule
      // while it is at it. Service role or an admin-role user only.
      const configToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (configToken !== SUPABASE_SERVICE_ROLE_KEY && !(await isAdminUser(supabase, configToken))) {
        console.warn('[scheduled-crawl] Unauthorized set-config attempt');
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const currentConfig = await getConfig();
      const newConfig: CrawlConfig = {
        paused: body.paused !== undefined ? body.paused : currentConfig.paused,
        frequencyMinutes: body.frequencyMinutes !== undefined ? Math.max(30, Math.min(4320, body.frequencyMinutes)) : currentConfig.frequencyMinutes,
        maxListingsPerRun: body.maxListingsPerRun !== undefined ? Math.max(1, Math.min(10, body.maxListingsPerRun)) : currentConfig.maxListingsPerRun,
        minPriceVnd: body.minPriceVnd !== undefined ? Math.max(0, Math.min(50_000_000, Number(body.minPriceVnd) || 0)) : (currentConfig.minPriceVnd ?? DEFAULT_CONFIG.minPriceVnd),
        enabledMarketplaces: Array.isArray(body.enabledMarketplaces)
          ? body.enabledMarketplaces.filter((m: string) => (MARKETPLACES as readonly string[]).includes(m))
          : (currentConfig.enabledMarketplaces ?? DEFAULT_CONFIG.enabledMarketplaces),
      };
      if (newConfig.enabledMarketplaces.length === 0) {
        newConfig.enabledMarketplaces = DEFAULT_CONFIG.enabledMarketplaces;
      }
      newConfig.knownMarketplaces = [...MARKETPLACES];
      const saved = await redisSet(CONFIG_KEY, newConfig);
      if (!saved) {
        return new Response(JSON.stringify({ success: false, error: 'Crawl config storage is unavailable', config: currentConfig, storageError: lastRedisError }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('[scheduled-crawl] Config updated:', JSON.stringify(newConfig));
      return new Response(JSON.stringify({ success: true, config: newConfig }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle bulk vibe backfill action
    if (body.action === 'backfill-vibe') {
      console.log('[scheduled-crawl] Starting bulk vibe backfill for external properties');
      
      // Fetch more properties to check — we filter client-side anyway
      const { data: needsVibe } = await supabase
        .from('external_properties')
        .select('id, title, location, price, size, rooms, images, amenities, vibe_analysis, highlights')
        .eq('is_active', true)
        .not('images', 'eq', '{}')
        .order('created_at', { ascending: false })
        .limit(200);

      if (!needsVibe || needsVibe.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No properties to backfill', analyzed: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const isGenericHighlight = (h: string) => !h || h === 'Premium living space feature' || h === 'Quality living space';

      const toBackfill = needsVibe.filter((p: any) => {
        if (!p.vibe_analysis?.styles || p.vibe_analysis.styles.length === 0) return true;
        if (!p.vibe_analysis?.colors || p.vibe_analysis.colors.length === 0) return true;
        if (!p.vibe_analysis?.activities || p.vibe_analysis.activities.length === 0) return true;
        if (!p.vibe_analysis?.image_analyses || p.vibe_analysis.image_analyses.length === 0) return true;
        if (!p.highlights || p.highlights.length === 0) return true;
        if (p.highlights.every((h: string) => isGenericHighlight(h))) return true;

        const hasUsableSecondaryHighlight = p.vibe_analysis.image_analyses.some((analysis: any) => {
          const imageIndex = Number(analysis?.image_index);
          const highlight = analysis?.image_highlight || analysis?.highlight;
          return Number.isFinite(imageIndex) && imageIndex > 0 && highlight && !isGenericHighlight(highlight);
        });

        return !hasUsableSecondaryHighlight;
      });

      console.log(`[scheduled-crawl] Found ${toBackfill.length}/${needsVibe.length} properties needing vibe backfill`);

      if (toBackfill.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'All properties already have vibe data', analyzed: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let analyzed = 0;
      let failed = 0;
      const results: any[] = [];
      let stoppedEarly = false;
      for (const prop of toBackfill) {
        const elapsed = Date.now() - startTime;
        if (elapsed > 120000) {
          console.log(`[scheduled-crawl] Stopping backfill - ${Math.round(elapsed/1000)}s elapsed`);
          stoppedEarly = true;
          break;
        }
        try {
          const success = await runVibeAnalysis(supabase, prop.id, prop);
          if (success) analyzed++;
          else failed++;
          results.push({ id: prop.id, title: prop.title, success });
          await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
          console.error(`[scheduled-crawl] Backfill error for ${prop.id}:`, e);
          results.push({ id: prop.id, title: prop.title, success: false, error: String(e) });
          failed++;
        }
      }

      // Self-chain via QStash if we stopped early OR if there are more properties than we processed
      // This ensures all properties eventually get processed across multiple runs
      let chained = false;
      const remainingCount = toBackfill.length - analyzed - failed;
      if (stoppedEarly && remainingCount > 0) {
        console.log(`[scheduled-crawl] Self-chaining backfill: ${analyzed} done, ~${remainingCount} remaining`);
        chained = await qstashPublish({ action: 'backfill-vibe', continuation: true }, 5);
      }

      // Invalidate property discovery cache so fresh data with highlights is served
      if (analyzed > 0) {
        try {
          await supabase.functions.invoke('property-discovery-cache', {
            body: { action: 'invalidate' },
          });
          console.log('[scheduled-crawl] Property discovery cache invalidated after backfill');
        } catch (e) {
          console.error('[scheduled-crawl] Failed to invalidate cache:', e);
        }
      }

      console.log(`[scheduled-crawl] Vibe backfill complete: ${analyzed} success, ${failed} failed out of ${toBackfill.length}${chained ? ' (continuation queued)' : ''}`);
      return new Response(JSON.stringify({ success: true, total: toBackfill.length, analyzed, failed, results, chained, duration: `${Date.now() - startTime}ms` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== RAW HARVEST: Use Firecrawl credits, skip model cost entirely =====
    if (body.action === 'raw-harvest') {
      const cfg = await getConfig();
      if (cfg.paused) {
        console.log('[raw-harvest] Paused via config. Stopping chain.');
        return new Response(JSON.stringify({ success: true, message: 'Paused', paused: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('[scheduled-crawl] RAW HARVEST mode start');
      const RAW_TRACK_PREFIX = 'crawl:track:raw';
      const RAW_SESSION_KEY = 'crawl:raw:session';

      // Pick oldest raw-tracked location (separate from AI-mode tracker)
      const rawLastSeen = await Promise.all(
        CRAWL_LOCATIONS.flatMap(loc =>
          MARKETPLACES.map(async mp => {
            const norm = loc.location.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const key = `${RAW_TRACK_PREFIX}:${norm}:${mp}`;
            const v = await redisGet(key);
            return { loc, mp, key, ts: v ? Number(v) : null };
          })
        )
      );
      const bestRaw = rawLastSeen.find(r => r.ts === null) || rawLastSeen.sort((a, b) => (a.ts! - b.ts!))[0];
      if (!bestRaw) {
        return new Response(JSON.stringify({ success: true, message: 'No raw targets' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log(`[raw-harvest] Target: ${bestRaw.loc.location} on ${bestRaw.mp}`);
      // Mark immediately to avoid re-picking
      await redisSet(bestRaw.key, Date.now(), 7 * 24 * 60 * 60);

      let outOfCredits = false;
      let summary: any = null;
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 140000);
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/scrape-marketplace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            marketplace: bestRaw.mp,
            query: 'cho thuê căn hộ chung cư nhà ở',
            location: bestRaw.loc.location,
            crawlLocation: bestRaw.loc.location,
            includeVibeAnalysis: false,
            maxResults: 30,
            pages: 3,
            directSave: true,
            rawMode: true,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        summary = await resp.json().catch(() => ({}));
        if (resp.status === 402 || summary?.outOfCredits) {
          outOfCredits = true;
          console.warn('[raw-harvest] Firecrawl out of credits, stopping chain');
        }
      } catch (e) {
        console.error('[raw-harvest] scrape call error:', e);
      }

      // Update session counter
      const session = (await redisGet(RAW_SESSION_KEY)) || { newListings: 0, runs: 0, startedAt: Date.now() };
      session.newListings += summary?.newListings || 0;
      session.runs += 1;
      session.lastTarget = `${bestRaw.loc.location}/${bestRaw.mp}`;
      session.lastSummary = summary;
      session.outOfCredits = outOfCredits;
      await redisSet(RAW_SESSION_KEY, session, 24 * 60 * 60);

      // Self-chain unless out of credits
      let chained = false;
      if (!outOfCredits) {
        chained = await qstashPublish({ action: 'raw-harvest', continuation: true }, 5);
      }

      return new Response(JSON.stringify({
        success: true,
        target: `${bestRaw.loc.location}/${bestRaw.mp}`,
        summary,
        outOfCredits,
        chained,
        session,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ===== RAW HARVEST PROJECTS: target specific HCMC apartment complexes =====
    if (body.action === 'raw-harvest-projects') {
      const cfgP = await getConfig();
      if (cfgP.paused) {
        console.log('[raw-harvest-projects] Paused via config. Stopping chain.');
        return new Response(JSON.stringify({ success: true, message: 'Paused', paused: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log('[scheduled-crawl] RAW HARVEST PROJECTS mode start');
      const RAW_PROJ_PREFIX = 'crawl:track:raw_proj';
      const RAW_PROJ_SESSION_KEY = 'crawl:raw_proj:session';

      // Curated HCMC project list (project name → district label used by scrape-marketplace)
      const HCM_PROJECTS: { project: string; location: string }[] = [
        // D1
        { project: 'Vinhomes Golden River', location: 'Quận 1' },
        { project: 'Vinhomes Ba Son', location: 'Quận 1' },
        { project: 'The Marq', location: 'Quận 1' },
        // D4
        { project: 'Saigon Royal', location: 'Quận 4' },
        { project: 'The Tresor', location: 'Quận 4' },
        { project: 'Millennium Masteri', location: 'Quận 4' },
        { project: 'Icon 56', location: 'Quận 4' },
        { project: 'RiverGate Residence', location: 'Quận 4' },
        { project: 'Gold View', location: 'Quận 4' },
        // D7 / Phu My Hung
        { project: 'Saigon Riverside', location: 'Quận 7' },
        { project: 'Riverside Residence', location: 'Quận 7' },
        { project: 'Saigon South Residences', location: 'Quận 7' },
        { project: 'Sky Garden', location: 'Quận 7' },
        { project: 'Happy Valley', location: 'Quận 7' },
        { project: 'Midtown Phu My Hung', location: 'Quận 7' },
        { project: 'Scenic Valley', location: 'Quận 7' },
        { project: 'The Panorama', location: 'Quận 7' },
        { project: 'The Ascentia', location: 'Quận 7' },
        { project: 'Urban Hill', location: 'Quận 7' },
        { project: 'Riviera Point', location: 'Quận 7' },
        { project: 'Eco Green Saigon', location: 'Quận 7' },
        { project: 'Sunrise City', location: 'Quận 7' },
        // D2 / Thu Duc
        { project: 'Masteri Thao Dien', location: 'Thủ Đức' },
        { project: 'Masteri An Phu', location: 'Thủ Đức' },
        { project: 'Gateway Thao Dien', location: 'Thủ Đức' },
        { project: 'Estella Heights', location: 'Thủ Đức' },
        { project: 'The Vista An Phu', location: 'Thủ Đức' },
        { project: 'Thao Dien Pearl', location: 'Thủ Đức' },
        { project: 'Q2 Thao Dien', location: 'Thủ Đức' },
        { project: 'Lumiere Riverside', location: 'Thủ Đức' },
        { project: "D'Edge Thao Dien", location: 'Thủ Đức' },
        { project: 'Nassim Thao Dien', location: 'Thủ Đức' },
        { project: 'Empire City', location: 'Thủ Đức' },
        { project: 'The River Thu Thiem', location: 'Thủ Đức' },
        { project: 'Sala Thu Thiem', location: 'Thủ Đức' },
        { project: 'New City Thu Thiem', location: 'Thủ Đức' },
        { project: 'Diamond Island', location: 'Thủ Đức' },
        { project: 'The Sun Avenue', location: 'Thủ Đức' },
        { project: 'Vinhomes Grand Park', location: 'Thủ Đức' },
        { project: 'Centana Thu Thiem', location: 'Thủ Đức' },
        // Binh Thanh
        { project: 'Vinhomes Central Park', location: 'Bình Thạnh' },
        { project: 'Saigon Pearl', location: 'Bình Thạnh' },
        { project: 'Sunwah Pearl', location: 'Bình Thạnh' },
        { project: 'The Manor', location: 'Bình Thạnh' },
        { project: 'City Garden', location: 'Bình Thạnh' },
        // Phu Nhuan / Tan Binh
        { project: 'Botanica Premier', location: 'Tân Bình' },
        { project: 'Newton Residence', location: 'Phú Nhuận' },
        { project: 'Orchard Park View', location: 'Phú Nhuận' },
      ];

      // Allow caller to optionally restrict to one project
      const onlyProject: string | undefined = body.project;
      const candidates = onlyProject
        ? HCM_PROJECTS.filter(p => p.project.toLowerCase() === onlyProject.toLowerCase())
        : HCM_PROJECTS;

      if (candidates.length === 0) {
        return new Response(JSON.stringify({ success: false, message: 'No matching project' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Pick oldest unseen project+marketplace combo. The agency feeds are
      // left out: they are read whole, newest first, and cannot be searched
      // by building name, so a project run on one would just repeat the
      // district rotation.
      const lastSeen = await Promise.all(
        candidates.flatMap(p =>
          MARKETPLACES.filter(mp => !isAgencyFeedSource(mp)).map(async mp => {
            const norm = p.project.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const key = `${RAW_PROJ_PREFIX}:${norm}:${mp}`;
            const v = await redisGet(key);
            return { p, mp, key, ts: v ? Number(v) : null };
          })
        )
      );
      const best = lastSeen.find(r => r.ts === null) || lastSeen.sort((a, b) => (a.ts! - b.ts!))[0];
      if (!best) {
        return new Response(JSON.stringify({ success: true, message: 'No project targets' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.log(`[raw-harvest-projects] Target: ${best.p.project} (${best.p.location}) on ${best.mp}`);
      await redisSet(best.key, Date.now(), 14 * 24 * 60 * 60);

      let outOfCredits = false;
      let summary: any = null;
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 140000);
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/scrape-marketplace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            marketplace: best.mp,
            query: best.p.project,
            location: best.p.location,
            crawlLocation: best.p.location,
            includeVibeAnalysis: false,
            maxResults: 30,
            pages: 3,
            directSave: true,
            rawMode: true,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        summary = await resp.json().catch(() => ({}));
        if (resp.status === 402 || summary?.outOfCredits) {
          outOfCredits = true;
          console.warn('[raw-harvest-projects] Firecrawl out of credits, stopping chain');
        }
      } catch (e) {
        console.error('[raw-harvest-projects] scrape call error:', e);
      }

      const session = (await redisGet(RAW_PROJ_SESSION_KEY)) || { newListings: 0, runs: 0, startedAt: Date.now() };
      session.newListings += summary?.newListings || 0;
      session.runs += 1;
      session.lastTarget = `${best.p.project}/${best.mp}`;
      session.lastSummary = summary;
      session.outOfCredits = outOfCredits;
      await redisSet(RAW_PROJ_SESSION_KEY, session, 24 * 60 * 60);

      // Self-chain unless out of credits or restricted to a single project
      let chained = false;
      if (!outOfCredits && !onlyProject) {
        chained = await qstashPublish({ action: 'raw-harvest-projects', continuation: true }, 5);
      }

      return new Response(JSON.stringify({
        success: true,
        target: `${best.p.project}/${best.mp}`,
        summary,
        outOfCredits,
        chained,
        session,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ===== RAW HARVEST status query =====
    if (body.action === 'raw-status') {
      const config = await getConfig();
      const session = (await redisGet('crawl:raw:session')) || null;
      const projectsSession = (await redisGet('crawl:raw_proj:session')) || null;
      return new Response(JSON.stringify({ success: true, config, session, projectsSession }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== What the admin page needs to show the rotation as it really is =====
    // The districts and sources come from here rather than from the page, so a
    // district or source added to this file shows up there without a second
    // edit. Today's spend is per source (MAX_DAILY_LISTINGS) and Firecrawl's
    // is shared (_shared/firecrawl-budget.ts).
    if (body.action === 'status') {
      const config = await getConfig();
      const today = new Date().toISOString().slice(0, 10);
      const spend = await Promise.all(MARKETPLACES.map(async (source) => ({
        source,
        used: Number((await redisGet(`${DAILY_COUNT_KEY}:${today}:${source}`)) || 0),
        cap: dailyCapFor(source),
        agencyFeed: isAgencyFeedSource(source),
      })));
      const [firecrawlLeft, rotation] = await Promise.all([
        firecrawlCreditsLeft(upstashCounter(UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN)),
        rotationTriggers(),
      ]);
      return new Response(JSON.stringify({
        success: true,
        config,
        locations: CRAWL_LOCATIONS.map((l) => l.location),
        marketplaces: MARKETPLACES,
        spend,
        firecrawl: { left: firecrawlLeft, daily: FIRECRAWL_DAILY_CREDITS },
        cronMinutes: CRON_MINUTES,
        triggers: rotation.triggers,
        triggersError: rotation.error,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ===== One crawl an admin asked for =====
    // A district from the rotation, or a building searched by name inside a
    // district. It runs even while the schedule is paused - the pause is for
    // the schedule - and saves through exactly the path the rotation does,
    // under the same Firecrawl ceiling. It is not counted against the
    // rotation's per-source daily caps; the Firecrawl ceiling is what costs
    // money, and it still applies.
    if (body.action === 'crawl-target') {
      const targetToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (targetToken !== SUPABASE_SERVICE_ROLE_KEY && !(await isAdminUser(supabase, targetToken))) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const fail = (error: string) => new Response(JSON.stringify({ success: false, error }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

      const marketplace = String(body.marketplace || '');
      if (!(MARKETPLACES as readonly string[]).includes(marketplace)) return fail(`Unknown source: ${marketplace}`);
      const project = typeof body.project === 'string' ? body.project.trim().slice(0, 80) : '';
      const location = String(body.location || '').trim().slice(0, 60);
      if (project) {
        // The agency feeds are read whole, newest first, and cannot be
        // searched by building name.
        if (isAgencyFeedSource(marketplace)) return fail(`${marketplace} cannot be searched by building`);
        if (!location) return fail('A building search needs its district');
      } else if (!CRAWL_LOCATIONS.some((l) => l.location === location)) {
        return fail(`Not a rotation district: ${location}`);
      }

      const config = await getConfig();
      const wanted = Math.max(1, Math.min(10, Number(body.maxResults) || config.maxListingsPerRun));
      const creditsLeft = await firecrawlCreditsLeft(upstashCounter(UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN));
      const plan = planRun(marketplace, creditsLeft, wanted);
      if (!plan.run) {
        return new Response(JSON.stringify({
          success: false,
          error: `Firecrawl budget: ${creditsLeft} credit(s) left today, not enough for ${marketplace}`,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const label = project ? `${project} · ${location}` : location;
      // A district crawled by hand counts as crawled, so the rotation does not
      // repeat it straight after.
      if (!project) await setLastCrawlTime(location, marketplace);
      const run = await openRun(supabase, marketplace, label);
      const scrape = await scrapeTarget({
        marketplace,
        location,
        query: project || 'cho thuê căn hộ chung cư nhà ở',
        maxResults: plan.maxResults,
        minPrice: config.minPriceVnd ?? DEFAULT_CONFIG.minPriceVnd,
        timeoutMs: startTime + ANSWER_BY_MS - CLOSE_RESERVE_MS - Date.now(),
      });
      const scrapeResult = scrape.result;
      const counts = countsOf(scrapeResult);
      const assessment = await closeRun(supabase, run, marketplace, label, counts, scrape.error);

      if (counts.newListings > 0 || counts.updatedListings > 0) {
        try {
          await supabase.functions.invoke('property-discovery-cache', { body: { action: 'invalidate' } });
        } catch (e) {
          console.error('[scheduled-crawl] Failed to invalidate cache:', e);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        summary: {
          target: label,
          marketplace,
          maxResults: plan.maxResults,
          ...counts,
          attempted: assessment.attempted,
          scrapeCompleted: !!scrapeResult?.success,
          healthy: assessment.healthy,
          verdict: assessment.verdict,
          verdictMessage: assessment.message,
        },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    // Everything below is the rotation, which the cron starts with no action.
    // An action this deployment does not know - a page newer than the
    // function, say - is refused rather than taken as a request to crawl.
    if (body.action !== undefined) {
      return new Response(JSON.stringify({ success: false, error: `Unknown action: ${String(body.action)}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const config = await getConfig();

    if (config.paused) {
      console.log('[scheduled-crawl] Crawling is paused. Skipping.');
      return new Response(JSON.stringify({ success: true, message: 'Crawling is paused', config }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[scheduled-crawl] Starting crawl (frequency: ${config.frequencyMinutes}min, max: ${config.maxListingsPerRun}/run)`);

    // Step 1: Find the best location to crawl using Redis-tracked crawl times
    let bestTarget: { city: string; location: string; marketplace: string; lastCrawl: number | null } | null = null;
    let oldestCrawlTime = Infinity;

    // Check all location+marketplace combos in parallel batches
    const enabledMps = (config.enabledMarketplaces ?? DEFAULT_CONFIG.enabledMarketplaces)
      .filter((m) => (MARKETPLACES as readonly string[]).includes(m));
    const candidateMps = enabledMps.length > 0 ? enabledMps : [...MARKETPLACES];

    // Drop sources that have already spent their daily budget BEFORE choosing a
    // target. The rotation picks the oldest-crawled combo, and a target is only
    // marked crawled once it actually runs - so a capped source stays the oldest
    // combo forever and every remaining run of the day exits on its budget check
    // having crawled nothing. With one shared counter that merely ended the
    // day's crawling; with per-source counts it would let a cheap source's cap
    // block an expensive one that still had budget, which is backwards.
    const today = new Date().toISOString().slice(0, 10);
    const spend = await Promise.all(candidateMps.map(async (mp) => ({
      mp,
      used: ((await redisGet(`${DAILY_COUNT_KEY}:${today}:${mp}`)) || 0) as number,
    })));
    const rotationMps = spend.filter(({ mp, used }) => used < dailyCapFor(mp)).map(({ mp }) => mp);
    if (rotationMps.length === 0) {
      const detail = spend.map(({ mp, used }) => `${mp} ${used}/${dailyCapFor(mp)}`).join(', ');
      console.log(`[scheduled-crawl] Every source has spent its daily budget (${detail}). Skipping.`);
      return new Response(JSON.stringify({
        success: true,
        message: 'Daily limit reached for all enabled sources',
        spend,
        config,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const checks: Promise<{ loc: typeof CRAWL_LOCATIONS[0]; mp: string; lastCrawl: number | null }>[] = [];
    for (const loc of CRAWL_LOCATIONS) {
      for (const mp of rotationMps) {
        checks.push(
          getLastCrawlTime(loc.location, mp).then(lastCrawl => ({ loc, mp, lastCrawl }))
        );
      }
    }
    const results = await Promise.all(checks);

    for (const { loc, mp, lastCrawl } of results) {
      if (lastCrawl === null) {
        // Never crawled - highest priority
        if (bestTarget === null || bestTarget.lastCrawl !== null) {
          bestTarget = { city: loc.city, location: loc.location, marketplace: mp, lastCrawl: null };
          oldestCrawlTime = 0;
        }
      } else if (bestTarget === null || (bestTarget.lastCrawl !== null && lastCrawl < oldestCrawlTime)) {
        oldestCrawlTime = lastCrawl;
        bestTarget = { city: loc.city, location: loc.location, marketplace: mp, lastCrawl };
      }
    }

    if (!bestTarget) {
      console.log('[scheduled-crawl] No targets found');
      return new Response(JSON.stringify({ success: true, message: 'No targets to crawl' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Skip if last crawl was within the configured frequency
    if (bestTarget.lastCrawl !== null) {
      const minsSinceLastCrawl = (Date.now() - bestTarget.lastCrawl) / (1000 * 60);
      if (minsSinceLastCrawl < config.frequencyMinutes) {
        console.log(`[scheduled-crawl] All locations crawled within ${config.frequencyMinutes}min. Skipping.`);
        return new Response(JSON.stringify({
          success: true,
          message: `All locations recently crawled (within ${config.frequencyMinutes}min)`,
          nextTarget: { ...bestTarget, minutesSinceLastCrawl: Math.round(minsSinceLastCrawl) },
          config,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`[scheduled-crawl] Target: ${bestTarget.location} on ${bestTarget.marketplace} (last crawl: ${bestTarget.lastCrawl ? new Date(bestTarget.lastCrawl).toISOString() : 'never'})`);

    // Check daily listing limit before proceeding. Counted per source, so a
    // cheap source running hot cannot consume the budget a costly one needs -
    // which is what a single shared counter did.
    const dailyCap = dailyCapFor(bestTarget.marketplace);
    const todayKey = `${DAILY_COUNT_KEY}:${new Date().toISOString().slice(0, 10)}:${bestTarget.marketplace}`;
    const dailyCount = (await redisGet(todayKey)) || 0;
    if (dailyCount >= dailyCap) {
      console.log(`[scheduled-crawl] Daily limit reached for ${bestTarget.marketplace}: ${dailyCount}/${dailyCap} listings today. Skipping.`);
      return new Response(JSON.stringify({
        success: true,
        message: `Daily limit reached for ${bestTarget.marketplace} (${dailyCount}/${dailyCap})`,
        config,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cap maxListingsPerRun to remaining daily budget
    const remainingBudget = dailyCap - dailyCount;
    const wantedMax = Math.min(config.maxListingsPerRun, remainingBudget);

    // And to the Firecrawl credits left today (_shared/firecrawl-budget.ts):
    // a search page, then a detail page per listing where the source needs
    // one. scrape-marketplace enforces the ceiling call by call; planning here
    // keeps a run from buying a search page it cannot follow up.
    const creditsLeft = await firecrawlCreditsLeft(upstashCounter(UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN));
    const plan = planRun(bestTarget.marketplace, creditsLeft, wantedMax);
    if (!plan.run) {
      console.log(`[scheduled-crawl] Firecrawl budget: ${creditsLeft} credit(s) left today, not enough for ${bestTarget.marketplace}. Skipping.`);
      return new Response(JSON.stringify({
        success: true,
        message: `Firecrawl budget: ${creditsLeft} credit(s) left today`,
        config,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const effectiveMax = plan.maxResults;
    console.log(`[scheduled-crawl] Daily budget for ${bestTarget.marketplace}: ${dailyCount}/${dailyCap} used, ${creditsLeft} Firecrawl credit(s) left, effective max this run: ${effectiveMax}`);

    // Mark this location+marketplace as crawled NOW (even before scraping starts)
    await setLastCrawlTime(bestTarget.location, bestTarget.marketplace);

    const run = await openRun(supabase, bestTarget.marketplace, bestTarget.location);

    // Step 2: scrape-marketplace saves through its own gates (directSave), so
    // even if this call times out, properties already saved are not lost.
    const answerBy = startTime + ANSWER_BY_MS;
    const msLeft = () => answerBy - Date.now();
    const scrape = await scrapeTarget({
      marketplace: bestTarget.marketplace,
      location: bestTarget.location,
      query: 'cho thuê căn hộ chung cư nhà ở',
      maxResults: effectiveMax,
      minPrice: config.minPriceVnd ?? DEFAULT_CONFIG.minPriceVnd,
      timeoutMs: msLeft() - CLOSE_RESERVE_MS,
    });
    const scrapeResult = scrape.result;

    const counts = countsOf(scrapeResult);
    const { newListings, updatedListings, duplicatesSkipped, filtered } = counts;
    let vibeAnalyzed = 0;

    // Close the run as soon as the scrape is in. It measures the scrape, and
    // everything below is follow-up work that can run long: closing it last
    // is what left 17 of 22 agency-feed runs open on 2026-10-08..15, killed by
    // the wall clock while waiting on backfill-image-highlights after a scrape
    // that had already saved its listings.
    const assessment = await closeRun(
      supabase, run, bestTarget.marketplace, bestTarget.location, counts, scrape.error,
    );
    const attempted = assessment.attempted;

    // Update daily listing counter
    if (newListings > 0) {
      const updatedDailyCount = dailyCount + newListings;
      // TTL = seconds until midnight UTC
      const now = new Date();
      const midnight = new Date(now);
      midnight.setUTCDate(midnight.getUTCDate() + 1);
      midnight.setUTCHours(0, 0, 0, 0);
      const ttlSeconds = Math.max(60, Math.floor((midnight.getTime() - now.getTime()) / 1000));
      await redisSet(todayKey, updatedDailyCount, ttlSeconds);
      console.log(`[scheduled-crawl] Daily count updated for ${bestTarget.marketplace}: ${updatedDailyCount}/${dailyCap}`);
    }

    // Step 3: Always chain vibe backfill via QStash after each crawl
    // This ensures any properties with missing/generic highlights get processed
    console.log(`[scheduled-crawl] Chaining vibe backfill (new: ${newListings}, updated: ${updatedListings})`);
    const backfillChained = await qstashPublish({ action: 'backfill-vibe', continuation: true, source: 'post-crawl' }, 10);
    if (!backfillChained) {
      console.warn('[scheduled-crawl] Failed to chain vibe backfill via QStash — will attempt inline analysis');
    }

    // Step 4: Only when the chain could not be published, do inline vibe
    // analysis for properties missing highlights. With the chain in place this
    // ran anyway, ten seconds ahead of the chained backfill and over the same
    // rows, so the two analysed one listing twice (16:04:38 and 16:04:49 on
    // 2026-10-15) - and the inline copy is what outlived the wall clock.
    if (ANTHROPIC_API_KEY && scrapeResult?.success && !backfillChained) {
      if (msLeft() > INLINE_VIBE_MS) {
        // Fetch more properties to find all that need analysis
        const { data: needsVibe } = await supabase
          .from('external_properties')
          .select('id, title, location, price, size, rooms, images, amenities, vibe_analysis, highlights')
          .eq('is_active', true)
          .not('images', 'eq', '{}')
          .order('created_at', { ascending: false })
          .limit(20);

        if (needsVibe) {
          const isGenericHighlight = (h: string) => !h || h === 'Premium living space feature' || h === 'Quality living space';

            const toAnalyze = needsVibe.filter((p: any) => {
              if (!p.vibe_analysis?.styles || p.vibe_analysis.styles.length === 0) return true;
              if (!p.vibe_analysis?.image_analyses || p.vibe_analysis.image_analyses.length === 0) return true;
              if (!p.highlights || p.highlights.length === 0) return true;
              if (p.highlights.every((h: string) => isGenericHighlight(h))) return true;

              const hasUsableSecondaryHighlight = p.vibe_analysis.image_analyses.some((analysis: any) => {
                const imageIndex = Number(analysis?.image_index);
                const highlight = analysis?.image_highlight || analysis?.highlight;
                return Number.isFinite(imageIndex) && imageIndex > 0 && highlight && !isGenericHighlight(highlight);
              });

              return !hasUsableSecondaryHighlight;
            });

          for (const prop of toAnalyze) {
            if (msLeft() < INLINE_VIBE_MS) break;
            try {
              const success = await runVibeAnalysis(supabase, prop.id, prop);
              if (success) vibeAnalyzed++;
              await new Promise(r => setTimeout(r, 1500));
            } catch (e) {
              console.error(`[scheduled-crawl] Inline vibe error for ${prop.id}:`, e);
            }
          }
          console.log(`[scheduled-crawl] Inline vibe: ${vibeAnalyzed}/${toAnalyze.length} analyzed`);

          // If we couldn't finish all, chain another backfill
          if (toAnalyze.length > vibeAnalyzed) {
            console.log(`[scheduled-crawl] ${toAnalyze.length - vibeAnalyzed} properties still need vibe - chaining additional backfill`);
            await qstashPublish({ action: 'backfill-vibe', continuation: true, source: 'inline-overflow' }, 15);
          }
        }
      }
    }

    // Trigger backfill-image-highlights for any properties missing image-level
    // highlights - bounded by the time left. It works through up to 20
    // listings at ~3s per image and waits out the model rate limit, so it
    // routinely needs minutes, and awaiting it whole is what killed the run.
    // It saves listing by listing, and the next run and the vibe queue pick up
    // whatever it had not reached, so being cut short loses nothing.
    if ((newListings > 0 || vibeAnalyzed > 0) && msLeft() > 15_000) {
      try {
        const backfillResp = await fetch(`${SUPABASE_URL}/functions/v1/backfill-image-highlights`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
          },
          body: JSON.stringify({ limit: 20 }),
          signal: AbortSignal.timeout(msLeft() - 5_000),
        });
        if (backfillResp.ok) {
          const backfillData = await backfillResp.json();
          console.log(`[scheduled-crawl] Backfill image highlights: ${backfillData.successCount || 0}/${backfillData.total || 0} processed`);
        } else {
          console.error(`[scheduled-crawl] Backfill image highlights failed: ${backfillResp.status}`);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'TimeoutError') {
          console.log('[scheduled-crawl] Backfill image highlights still running at the time limit - left to finish or resume next run');
        } else {
          console.error('[scheduled-crawl] Failed to trigger backfill-image-highlights:', e);
        }
      }
    }

    // Invalidate property discovery cache after crawl + vibe analysis
    if (newListings > 0 || updatedListings > 0 || vibeAnalyzed > 0) {
      try {
        await supabase.functions.invoke('property-discovery-cache', {
          body: { action: 'invalidate' },
        });
        console.log('[scheduled-crawl] Property discovery cache invalidated');
      } catch (e) {
        console.error('[scheduled-crawl] Failed to invalidate cache:', e);
      }
    }

    const duration = Date.now() - startTime;

    const summary = {
      duration: `${duration}ms`,
      target: bestTarget,
      newListings,
      updatedListings,
      duplicatesSkipped,
      filtered,
      attempted,
      vibeAnalyzed,
      directSaveMode: true,
      scrapeCompleted: !!scrapeResult?.success,
      // Surfaced in the response as well as the log so a caller testing a
      // source by hand sees the verdict without opening the dashboard.
      healthy: assessment.healthy,
      verdict: assessment.verdict,
      verdictMessage: assessment.message,
    };

    console.log('[scheduled-crawl] Completed:', JSON.stringify(summary));

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[scheduled-crawl] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: `${Date.now() - startTime}ms`,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
