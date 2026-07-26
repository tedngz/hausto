// Shared helper to log OpenAI API usage into public.openai_usage_log.
// Non-blocking: never throws — failures are logged and swallowed so cost
// tracking cannot break the caller's happy path.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
