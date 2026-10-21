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
import { chat, parseJsonReply } from '../claude.ts';

type JsonCall = { ok: true; json: unknown; usage: unknown } | { ok: false; error: string };

/** One JSON completion. Claude Sonnet 5.5 takes no temperature; the prompt pins the shape. */
async function callJson(model: string, system: string, user: string, maxTokens: number): Promise<JsonCall> {
  const r = await chat({
    model,
    json: true,
    maxTokens,
    timeoutMs: 20_000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  if (!r.ok) return { ok: false, error: r.error };
  try {
    return { ok: true, json: parseJsonReply(r.text), usage: r.usage };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ParseCallResult =
  | { ok: true; suggestion: ParseSuggestion; usage: unknown }
  | { ok: false; error: string };

export async function callParseModel(ctx: ParseContext): Promise<ParseCallResult> {
  const r = await callJson(PARSE_MODEL, PARSE_PROMPT, buildParseInput(ctx), 300);
  return r.ok ? { ok: true, suggestion: interpretParse(r.json, ctx), usage: r.usage } : r;
}

export type UnitParseCallResult =
  | { ok: true; suggestion: UnitSuggestion; usage: unknown }
  | { ok: false; error: string };

/** Up to five units, each a dozen short fields - a bigger answer than paste-parse's. */
export async function callUnitParseModel(ctx: UnitParseContext): Promise<UnitParseCallResult> {
  const r = await callJson(UNIT_PARSE_MODEL, UNIT_PARSE_PROMPT, buildUnitParseInput(ctx), 900);
  return r.ok ? { ok: true, suggestion: interpretUnitParse(r.json, ctx), usage: r.usage } : r;
}
