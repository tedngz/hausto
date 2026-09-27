// The one model call behind paste-parse, shared by the console's "Suggest from
// reply" (ops-parse-reply) and the AI operator's planner (ai-operator-plan).
//
// Two callers, one call: a reply read two ways would make the agreement rate
// measure the difference between two prompts rather than the model against the
// operator. The budget guard and usage log stay with each caller, which knows
// whether it may spend.

import {
  PARSE_MODEL,
  PARSE_PROMPT,
  buildParseInput,
  interpretParse,
  type ParseContext,
  type ParseSuggestion,
} from './parse-reply.ts';

export type ParseCallResult =
  | { ok: true; suggestion: ParseSuggestion; usage: unknown }
  | { ok: false; error: string };

export async function callParseModel(ctx: ParseContext, apiKey: string): Promise<ParseCallResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PARSE_MODEL,
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: PARSE_PROMPT },
          { role: 'user', content: buildParseInput(ctx) },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `openai ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
    return { ok: true, suggestion: interpretParse(parsed, ctx), usage: data?.usage ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
