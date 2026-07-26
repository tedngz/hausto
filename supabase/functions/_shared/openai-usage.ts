// Shared helper to log OpenAI API usage into public.openai_usage_log.
// Non-blocking: never throws — failures are logged and swallowed so cost
// tracking cannot break the caller's happy path.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

// Daily spend ceiling, in USD. A soft app-level stop that sits under whatever
// hard limit the OpenAI project itself enforces — set that too, since this one
// cannot help if the key is being spent from outside this codebase.
const DAILY_USD_CAP = Number(Deno.env.get('OPENAI_DAILY_USD_CAP') ?? '1');

// gpt-4o-mini pricing per 1M tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = PRICING[model] ?? PRICING['gpt-4o-mini'];
  return (
    (promptTokens / 1_000_000) * p.input +
    (completionTokens / 1_000_000) * p.output
  );
}

export interface LogUsageArgs {
  fn: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  images?: number;
  metadata?: Record<string, unknown>;
}

// Every call site invokes this fire-and-forget (no await) so cost tracking
// never adds latency to a user-facing response. That means the isolate can be
// torn down the moment the handler resolves, cancelling the insert mid-flight.
// EdgeRuntime.waitUntil keeps the isolate alive for the background work, which
// is what makes the un-awaited calls actually land.
type WaitUntil = { waitUntil?: (p: Promise<unknown>) => void };

export function logOpenAIUsage(args: LogUsageArgs): Promise<void> {
  const task = sendUsage(args);
  const rt = (globalThis as { EdgeRuntime?: WaitUntil }).EdgeRuntime;
  rt?.waitUntil?.(task);
  return task;
}

// UTC day, matching get_openai_usage_summary so the guard and the admin panel
// agree on where one day ends.
function spendKey(): string {
  return `openai:spend:${new Date().toISOString().split('T')[0]}`;
}

async function redis(path: string): Promise<unknown> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;
  const resp = await fetch(`${UPSTASH_REDIS_REST_URL}/${path}`, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
  });
  if (!resp.ok) throw new Error(`redis ${resp.status}`);
  return (await resp.json())?.result ?? null;
}

async function recordSpend(usd: number): Promise<void> {
  if (usd <= 0) return;
  try {
    const key = spendKey();
    const total = Number(await redis(`incrbyfloat/${encodeURIComponent(key)}/${usd.toFixed(6)}`));
    // First write of the day → expire after 48h so keys don't accumulate.
    if (Number.isFinite(total) && total <= usd) {
      await redis(`expire/${encodeURIComponent(key)}/172800`);
    }
  } catch (e) {
    console.warn('[openai-cost] spend counter failed:', String(e).substring(0, 160));
  }
}

// Today's spend in USD. Redis is the fast path; if it is unavailable we fall
// back to summing openai_usage_log, so the guard still works when Redis does
// not. Returns null only when neither source can answer.
export async function getDailySpendUsd(): Promise<number | null> {
  try {
    const cached = await redis(`get/${encodeURIComponent(spendKey())}`);
    if (cached !== null && cached !== undefined) {
      const n = Number(cached);
      if (Number.isFinite(n)) return n;
    }
  } catch (e) {
    console.warn('[openai-cost] spend read failed, falling back to db:', String(e).substring(0, 160));
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/openai_spend_today`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!resp.ok) return null;
    const n = Number(await resp.json());
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    console.warn('[openai-cost] db spend read failed:', String(e).substring(0, 160));
    return null;
  }
}

// Call before starting expensive work. Fails OPEN when spend is unknowable
// (both Redis and the log unreachable) — blocking every AI feature on a
// telemetry outage is worse than the overspend the OpenAI-side cap catches.
export async function isOpenAIBudgetExhausted(): Promise<boolean> {
  const spent = await getDailySpendUsd();
  if (spent === null) {
    console.warn('[openai-cost] spend unknown — allowing call');
    return false;
  }
  if (spent >= DAILY_USD_CAP) {
    console.warn(`[openai-cost] daily cap reached: $${spent.toFixed(4)} >= $${DAILY_USD_CAP}`);
    return true;
  }
  return false;
}

async function sendUsage(args: LogUsageArgs): Promise<void> {
  try {
    const prompt = args.usage?.prompt_tokens ?? 0;
    const completion = args.usage?.completion_tokens ?? 0;
    const total = args.usage?.total_tokens ?? prompt + completion;
    const usd = estimateCostUsd(args.model, prompt, completion);

    // Also emit a structured log line so it's greppable in edge logs
    console.log(
      `[openai-cost] fn=${args.fn} model=${args.model} pt=${prompt} ct=${completion} imgs=${args.images ?? 0} usd=${usd.toFixed(6)}`,
    );

    await recordSpend(usd);

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/openai_usage_log`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        fn: args.fn,
        model: args.model,
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
        images: args.images ?? 0,
        estimated_usd: usd,
        metadata: args.metadata ?? null,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.warn(`[openai-cost] log insert failed ${resp.status}: ${txt.substring(0, 160)}`);
    }
  } catch (e) {
    console.warn('[openai-cost] log failed:', String(e).substring(0, 160));
  }
}
