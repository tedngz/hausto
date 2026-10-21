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
import { chat, parseJsonReply } from '../claude.ts';

export type DraftCallResult =
  | { ok: true; draft: DraftResult; usage: unknown }
  | { ok: false; error: string };

export async function callDraftModel(ctx: DraftContext): Promise<DraftCallResult> {
  const r = await chat({
    model: REPLY_MODEL,
    json: true,
    maxTokens: 400,
    timeoutMs: 25_000,
    messages: [
      { role: 'system', content: REPLY_PROMPT },
      { role: 'user', content: buildDraftInput(ctx) },
    ],
  });
  if (!r.ok) return { ok: false, error: r.error };
  try {
    return { ok: true, draft: interpretDraft(parseJsonReply(r.text), ctx), usage: r.usage };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
