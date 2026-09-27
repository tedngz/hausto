// The model call behind a drafted renter reply. The spend guard and usage log
// stay with the caller, which knows whether it may spend.

import {
  REPLY_MODEL,
  REPLY_PROMPT,
  buildDraftInput,
  interpretDraft,
  type DraftContext,
  type DraftResult,
} from './renter-reply.ts';

export type DraftCallResult =
  | { ok: true; draft: DraftResult; usage: unknown }
  | { ok: false; error: string };

export async function callDraftModel(ctx: DraftContext, apiKey: string): Promise<DraftCallResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: REPLY_MODEL,
        response_format: { type: 'json_object' },
        // A little warmth in the wording; the rules are in the checks, not the temperature.
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: 'system', content: REPLY_PROMPT },
          { role: 'user', content: buildDraftInput(ctx) },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `openai ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
    return { ok: true, draft: interpretDraft(parsed, ctx), usage: data?.usage ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
