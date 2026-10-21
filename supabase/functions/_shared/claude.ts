// Every text and vision model call goes through here: Claude, through the
// official SDK. Embeddings stay on OpenAI - Anthropic has no embedding model -
// so OPENAI_API_KEY is now read by the embedding functions and nothing else.
//
// Callers still assemble OpenAI-shaped messages (a system turn, then user and
// assistant turns whose content is a string or text/image_url parts), because
// that is how every prompt in this codebase was already built. toClaude(), in
// claude-messages.ts, is the one place that maps them.
//
// Usage comes back in OpenAI's shape too ({prompt_tokens, completion_tokens}),
// which is what logOpenAIUsage and the daily spend cap read.

import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { toClaude, type ChatMessage } from './claude-messages.ts';

export { MAX_IMAGE_BYTES, MAX_IMAGES_PER_CALL, parseJsonReply, type ChatMessage, type ChatPart } from './claude-messages.ts';

/** High-volume work: crawl extraction, photo analysis, chat, listing copy. */
export const FAST_MODEL = 'claude-haiku-5-5';
/** Low-volume work where a misread costs more than the tokens: the AI operator. */
export const CAREFUL_MODEL = 'claude-sonnet-5-5';

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export type ChatResult =
  | { ok: true; text: string; usage: ChatUsage; model: string }
  | {
    ok: false;
    /** HTTP status, or null when the call never got an answer. */
    status: number | null;
    /** The account is out of credit - retrying will not help until it is topped up. */
    quota: boolean;
    error: string;
  };

export interface ChatRequest {
  messages: ChatMessage[];
  /**
   * A ceiling, not a target: only the tokens written are billed. Size it with
   * room to spare - Claude writes fuller JSON than gpt-4o-mini did, and the
   * caps carried over from it cut the photo analyses off mid-object.
   */
  maxTokens: number;
  model?: string;
  /** Ask for one JSON object back, as OpenAI's json_object mode did. */
  json?: boolean;
  timeoutMs?: number;
  /** The SDK retries 429, 5xx and dropped connections. Callers with their own backoff pass 0. */
  maxRetries?: number;
}

const JSON_ONLY = 'Reply with one JSON object and nothing else - no code fences, no prose before or after it.';

export function hasClaudeKey(): boolean {
  return !!Deno.env.get('ANTHROPIC_API_KEY');
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
    client = new Anthropic({ apiKey });
  }
  return client;
}

// Thinking off. These calls are extraction and short answers, sized and timed
// for a model that answers directly, and thinking would count against their
// max_tokens. Haiku 5.5 takes 'disabled' at its default effort; Sonnet 5.5
// rejects 'disabled' and spells the same thing 'between_tools'.
function thinkingFor(model: string): Record<string, string> {
  return model.startsWith('claude-sonnet-5-5') ? { type: 'between_tools' } : { type: 'disabled' };
}

/** One completion. Never throws: a failure comes back as { ok: false }. */
export async function chat(req: ChatRequest): Promise<ChatResult> {
  const model = req.model ?? FAST_MODEL;
  const { system, messages } = toClaude(req.messages);
  if (!messages.length) return { ok: false, status: 400, quota: false, error: 'no user message to send' };
  // Reported as the 401 the API would give, so no caller's backoff retries it.
  if (!hasClaudeKey()) return { ok: false, status: 401, quota: false, error: 'ANTHROPIC_API_KEY not configured' };
  const systemText = req.json ? [system, JSON_ONLY].filter(Boolean).join('\n\n') : system;

  try {
    const res = await getClient().messages.create(
      {
        model,
        max_tokens: req.maxTokens,
        ...(systemText ? { system: systemText } : {}),
        thinking: thinkingFor(model),
        messages,
      } as unknown as Anthropic.MessageCreateParamsNonStreaming,
      {
        timeout: req.timeoutMs ?? 60_000,
        ...(req.maxRetries !== undefined ? { maxRetries: req.maxRetries } : {}),
      },
    );

    const u = res.usage;
    const prompt = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const usage = { prompt_tokens: prompt, completion_tokens: u.output_tokens ?? 0, total_tokens: prompt + (u.output_tokens ?? 0) };

    // A decline is an HTTP 200 with no answer in it. There is no fallback
    // model for Haiku, so it is a failure like any other to the caller.
    if (res.stop_reason === 'refusal') {
      return { ok: false, status: 200, quota: false, error: 'claude declined the request' };
    }
    // A reply cut off at the cap is usually half a JSON object, which the
    // caller can only report as unparseable. Say why here, where it is known.
    if (res.stop_reason === 'max_tokens') {
      console.warn(`[claude] ${model} reply cut off at max_tokens=${req.maxTokens}`);
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();
    return { ok: true, text, usage, model };
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      const message = String(e.message ?? '');
      return {
        ok: false,
        status: typeof e.status === 'number' ? e.status : null,
        // What the API answers once prepaid credit runs out.
        quota: /credit balance/i.test(message),
        error: `claude ${e.status ?? 'error'}: ${message.slice(0, 200)}`,
      };
    }
    return { ok: false, status: null, quota: false, error: String(e).slice(0, 200) };
  }
}
