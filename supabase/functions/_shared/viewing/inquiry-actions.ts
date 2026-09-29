// The operator's steps on an availability request (SPEC §11, PLAN-v3 S7.1).
//
// Reached only through `performOpsAction` (invariant 10), so a person in the
// ops console and, later, the AI operator do exactly the same thing. Each step
// is a typed `inquiry_events` row (invariants 1 and 2); the reply is a message
// on the request's thread, checked like any operator reply to a renter.
//
// Agents are asked by hand here - on Zalo or by phone - and the step records
// that it happened. Asking through the bridge is S7.2.

import type { WhatsAppAdapter } from '../whatsapp/adapter.ts';
import {
  ConsecutiveMessageError,
  ServiceWindowClosedError,
  type MessageStore,
} from '../whatsapp/send.ts';
import {
  AGENT_ANSWERS,
  INQUIRY_ASK_MEDIA,
  INQUIRY_CLOSE_REASONS,
  reduceInquiry,
  type InquiryEvent,
  type InquiryEventType,
  type InquiryView,
} from '../viewing-domain.ts';
import { checkOperatorReply } from './thread.ts';
import { NoWhatsAppError, recordInquiryMessage, sendConciergeWhatsApp } from './concierge.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export const INQUIRY_ACTIONS = [
  'INQUIRY_ASK_AGENT',
  'INQUIRY_AGENT_ANSWERED',
  'INQUIRY_REPLY',
  'INQUIRY_CLOSE',
  'INQUIRY_REOPEN',
] as const;
export type InquiryAction = typeof INQUIRY_ACTIONS[number];

export function isInquiryAction(action: string): action is InquiryAction {
  return (INQUIRY_ACTIONS as readonly string[]).includes(action);
}

export interface InquiryResult {
  status: number;
  body: Record<string, unknown>;
}

const done = (body: Record<string, unknown>): InquiryResult => ({ status: 200, body: { success: true, ...body } });
const refuse = (status: number, error: string, message?: string): InquiryResult =>
  ({ status, body: { error, ...(message ? { message } : {}) } });

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const MAX_NOTE = 500;

/** The request and its derived state, or a refusal. */
async function load(db: Supa, inquiryId: string): Promise<
  { ok: true; view: InquiryView; row: { id: string; channel: string; whatsapp_confirmed_at: string | null } } |
  { ok: false; result: InquiryResult }
> {
  if (!/^[0-9a-f-]{36}$/i.test(inquiryId)) return { ok: false, result: refuse(400, 'inquiryId is required') };
  const { data: row } = await db
    .from('complex_inquiries').select('id, channel, whatsapp_confirmed_at').eq('id', inquiryId).maybeSingle();
  if (!row) return { ok: false, result: refuse(404, 'not_found', 'No such request.') };
  if (row.channel !== 'WHATSAPP') {
    return { ok: false, result: refuse(409, 'email_request', 'An email request - it is answered in Admin Tools.') };
  }
  const { data: events } = await db
    .from('inquiry_events').select('id, inquiry_id, type, payload, actor, occurred_at').eq('inquiry_id', inquiryId);
  return { ok: true, view: reduceInquiry(inquiryId, (events ?? []) as InquiryEvent[]), row };
}

async function append(
  db: Supa,
  inquiryId: string,
  type: InquiryEventType,
  payload: Record<string, unknown>,
  actor: string,
): Promise<InquiryResult | null> {
  const { error } = await db.from('inquiry_events').insert({
    inquiry_id: inquiryId, type, payload, actor, occurred_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[inquiry-actions] event insert failed:', error);
    return refuse(500, 'event_failed');
  }
  return null;
}

function note(input: Record<string, unknown>): string | null {
  return str(input.note).slice(0, MAX_NOTE) || null;
}

export async function performInquiryAction(
  db: Supa,
  deps: { whatsapp: WhatsAppAdapter; messages: MessageStore; newKey?: () => string },
  actor: string,
  action: InquiryAction,
  input: Record<string, unknown>,
): Promise<InquiryResult> {
  const inquiryId = str(input.inquiryId);
  const loaded = await load(db, inquiryId);
  if (!loaded.ok) return loaded.result;
  const { view, row } = loaded;

  if (action === 'INQUIRY_REOPEN') {
    if (view.state !== 'CLOSED') return refuse(409, 'not_closed', 'The request is open.');
    return (await append(db, inquiryId, 'REOPENED', { note: note(input) }, actor)) ?? done({ recorded: 'REOPENED' });
  }

  if (view.state === 'CLOSED') return refuse(409, 'closed', 'The request is closed - reopen it first.');
  // Before the code arrives there is nobody to reply to, and asking agents on
  // behalf of a form that may never be sent is work thrown away.
  if (!row.whatsapp_confirmed_at) {
    return refuse(409, 'awaiting_code', 'The renter has not sent the WhatsApp message yet.');
  }

  if (action === 'INQUIRY_ASK_AGENT' || action === 'INQUIRY_AGENT_ANSWERED') {
    const realtorId = str(input.realtorId);
    const { data: realtor } = realtorId
      ? await db.from('realtors').select('id').eq('id', realtorId).maybeSingle()
      : { data: null };
    if (!realtor) return refuse(400, 'invalid_realtor', 'Pick an agent from the building\'s roster.');

    if (action === 'INQUIRY_ASK_AGENT') {
      const medium = (str(input.medium) || 'ZALO').toUpperCase();
      if (!(INQUIRY_ASK_MEDIA as readonly string[]).includes(medium)) {
        return refuse(400, 'invalid_medium', 'Asked on ZALO or PHONE.');
      }
      return (await append(db, inquiryId, 'AGENT_ASKED', { realtor_id: realtorId, medium, note: note(input) }, actor))
        ?? done({ recorded: 'AGENT_ASKED' });
    }

    const answer = str(input.answer).toUpperCase();
    if (!(AGENT_ANSWERS as readonly string[]).includes(answer)) {
      return refuse(400, 'invalid_answer', `The answer is one of ${AGENT_ANSWERS.join(', ')}.`);
    }
    return (await append(db, inquiryId, 'AGENT_ANSWERED', { realtor_id: realtorId, answer, note: note(input) }, actor))
      ?? done({ recorded: 'AGENT_ANSWERED' });
  }

  if (action === 'INQUIRY_CLOSE') {
    const reason = str(input.reason).toUpperCase();
    if (!(INQUIRY_CLOSE_REASONS as readonly string[]).includes(reason)) {
      return refuse(400, 'invalid_reason', `The reason is one of ${INQUIRY_CLOSE_REASONS.join(', ')}.`);
    }
    return (await append(db, inquiryId, 'CLOSED', { reason, note: note(input) }, actor)) ?? done({ recorded: 'CLOSED' });
  }

  // INQUIRY_REPLY. Checked like any operator reply to a renter: no phone
  // numbers (they reach agents through us), no booking before anything is.
  const checked = checkOperatorReply(str(input.body), 'SUBMITTED');
  if (!checked.ok) return refuse(400, 'invalid_reply', checked.error);
  const key = str(input.key) || deps.newKey?.() || crypto.randomUUID();

  let sent: { messageId: string; status: string };
  try {
    sent = await sendConciergeWhatsApp(db, deps.messages, deps.whatsapp, { inquiryId, body: checked.body, key });
  } catch (e) {
    if (e instanceof ServiceWindowClosedError) {
      return refuse(409, 'window_closed', 'Their WhatsApp window has closed. It reopens when they write to us.');
    }
    if (e instanceof ConsecutiveMessageError) {
      return refuse(409, 'too_many_consecutive', 'They have not replied to our last two messages. Wait for them.');
    }
    if (e instanceof NoWhatsAppError) return refuse(409, 'awaiting_code', (e as Error).message);
    throw e;
  }
  if (sent.status === 'FAILED') return refuse(502, 'send_failed', 'WhatsApp refused the message.');

  await recordInquiryMessage(db, {
    inquiryId, direction: 'outbound', source: 'dashboard', whatsappMessageId: sent.messageId, body: checked.body, now: new Date(),
  });
  await db.from('complex_inquiries').update({ last_message_at: new Date().toISOString() }).eq('id', inquiryId);
  return done({ recorded: 'REPLIED', messageId: sent.messageId });
}
