// The model calls behind paste-parse, shared by the console's "Suggest from
// reply" (ops-parse-reply) and the AI operator's planner (ai-operator-plan),
// and behind "Suggest a unit" on an availability request (S7.2b).
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
import {
  UNIT_PARSE_MODEL,
  UNIT_PARSE_PROMPT,
  buildUnitParseInput,
  interpretUnitParse,
  type UnitParseContext,
  type UnitSuggestion,
} from './unit-parse.ts';

type JsonCall = { ok: true; json: unknown; usage: unknown } | { ok: false; error: string };

/** One JSON-mode completion at temperature 0. */
async function callJson(model: string, system: string, user: string, maxTokens: number, apiKey: string): Promise<JsonCall> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `openai ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
    return { ok: true, json: JSON.parse(data?.choices?.[0]?.message?.content ?? '{}'), usage: data?.usage ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ParseCallResult =
  | { ok: true; suggestion: ParseSuggestion; usage: unknown }
  | { ok: false; error: string };

export async function callParseModel(ctx: ParseContext, apiKey: string): Promise<ParseCallResult> {
  const r = await callJson(PARSE_MODEL, PARSE_PROMPT, buildParseInput(ctx), 300, apiKey);
  return r.ok ? { ok: true, suggestion: interpretParse(r.json, ctx), usage: r.usage } : r;
}

export type UnitParseCallResult =
  | { ok: true; suggestion: UnitSuggestion; usage: unknown }
  | { ok: false; error: string };

/** Up to five units, each a dozen short fields - a bigger answer than paste-parse's. */
export async function callUnitParseModel(ctx: UnitParseContext, apiKey: string): Promise<UnitParseCallResult> {
  const r = await callJson(UNIT_PARSE_MODEL, UNIT_PARSE_PROMPT, buildUnitParseInput(ctx), 900, apiKey);
  return r.ok ? { ok: true, suggestion: interpretUnitParse(r.json, ctx), usage: r.usage } : r;
}
