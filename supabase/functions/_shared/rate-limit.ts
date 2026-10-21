// Durable rate limiting and caller identification for the public AI endpoints.
//
// An in-memory Map is not a spend control on edge functions: every cold start
// hands the caller a fresh quota and each concurrent isolate keeps its own
// counter, so the effective limit is "as much as you like, just reconnect".
// Redis is already provisioned here for the model spend counter, and gives one
// counter shared by every isolate that survives restarts.
//
// Falls back to a per-isolate Map when Redis is unconfigured so local dev still
// works, but that fallback is close to no limit at all in production: ten
// sequential requests to this project each booted their own isolate, so each
// one would start from a clean counter. The budget guard in openai-usage.ts is
// the real backstop.

const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

/**
 * The client's IP as far as it can be trusted.
 *
 * Measured against the deployed edge runtime, one request looks like:
 *
 *   x-forwarded-for: "113.22.112.214,113.22.112.214, 99.82.173.50"
 *   cf-connecting-ip: "113.22.112.214"
 *
 * Two things follow, and both are easy to get wrong:
 *
 * - The RIGHTMOST X-Forwarded-For entry is an AWS edge hop that changes on
 *   every single request (99.82.173.50, then .49, then 99.83.104.110). Keying
 *   on it hands each request its own bucket, so nothing is ever limited - it
 *   looks like a working limiter and is not one.
 * - Cloudflare sits in front and rewrites the chain, so a caller-supplied
 *   X-Forwarded-For never reaches us (a request sent with 9.9.9.9 arrived with
 *   the header above, unchanged).
 *
 * cf-connecting-ip is the one Cloudflare writes itself and cannot be forged
 * from outside, so it leads. The X-Forwarded-For fallback takes the LEFTMOST
 * entry, which is the real client on this path.
 */
export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();

  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();

  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

async function redis(path: string): Promise<unknown> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;
  const resp = await fetch(`${UPSTASH_REDIS_REST_URL}/${path}`, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
  });
  if (!resp.ok) throw new Error(`redis ${resp.status}`);
  return (await resp.json())?.result ?? null;
}

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryHit(key: string, limit: number, windowSec: number): boolean {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || now > entry.resetAt) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return false;
  }
  entry.count++;
  return entry.count > limit;
}

/**
 * Counts this request against `key` and reports whether it busts `limit` within
 * a fixed `windowSec` window. Fails OPEN on a Redis error: a cache outage
 * should not take a product feature down, and the daily USD cap still bounds
 * the damage.
 */
export async function isRateLimited(key: string, limit: number, windowSec: number): Promise<boolean> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    return memoryHit(key, limit, windowSec);
  }
  try {
    const redisKey = encodeURIComponent(`rl:${key}`);
    const count = Number(await redis(`incr/${redisKey}`));
    if (count === 1) await redis(`expire/${redisKey}/${windowSec}`);
    return Number.isFinite(count) && count > limit;
  } catch (e) {
    console.warn('[rate-limit] redis failed, falling back to memory:', String(e).substring(0, 160));
    return memoryHit(key, limit, windowSec);
  }
}

export interface Caller {
  /** Signed-in user id, or null for an anonymous caller. */
  userId: string | null;
  /** Caller was holding the service-role key. */
  isServiceRole: boolean;
  /** Rate-limit bucket: the user id when signed in, otherwise the peer IP. */
  key: string;
}

/**
 * Works out who is calling. The anon/publishable key is public by definition,
 * so a request carrying it is anonymous - only a token that resolves to a real
 * user counts as signed in.
 */
export async function identifyCaller(req: Request, supabase: {
  auth: { getUser: (t: string) => Promise<{ data: { user: { id: string } | null } }> };
}): Promise<Caller> {
  const ip = clientIp(req);
  const token = (req.headers.get('Authorization') || req.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim();

  if (!token) return { userId: null, isServiceRole: false, key: `ip:${ip}` };

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (serviceKey && token === serviceKey) {
    return { userId: null, isServiceRole: true, key: 'service' };
  }

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const publishableKey = Deno.env.get('VITE_SUPABASE_PUBLISHABLE_KEY') || '';
  if (token === anonKey || (publishableKey && token === publishableKey)) {
    return { userId: null, isServiceRole: false, key: `ip:${ip}` };
  }

  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) return { userId: user.id, isServiceRole: false, key: `user:${user.id}` };
  } catch (e) {
    console.warn('[rate-limit] token check failed:', String(e).substring(0, 160));
  }
  return { userId: null, isServiceRole: false, key: `ip:${ip}` };
}
