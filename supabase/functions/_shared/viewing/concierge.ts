// The WhatsApp side of a concierge availability request (SPEC §11): tying
// messages to the request, and sending the concierge's words.
//
// `complex_inquiry_messages` is the request's thread, whatever carried each
// message - email or WhatsApp - so Admin Tools shows one conversation. A
// WhatsApp message on that thread carries `whatsapp_message_id`, the
// `messages` row it was, and that link is how a renter's next WhatsApp
// message is known to be about the request: when the last thing we sent them
// is on a request's thread, their reply belongs on it too.

import type { WhatsAppAdapter } from '../whatsapp/adapter.ts';
import { sendFreeForm, type MessageStore } from '../whatsapp/send.ts';
import { INQUIRY_REPLY_DAYS, describeInquiry, type InquirySummary } from './inquiry.ts';
import { deadlineAlertNeeded, deadlineJobs, renderDeadlineAlert } from './inquiry-deadline.ts';
import { reduceInquiry, type InquiryEvent } from '../viewing-domain.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface ConfirmedInquiry extends InquirySummary {
  id: string;
  /** False on a redelivered code - the request was confirmed already. */
  firstConfirm: boolean;
}

/**
 * The request a watch was created for, now confirmed from this phone.
 *
 * Called when the watch's code arrives. Sets the renter, the phone and the
 * confirmation time on the request - the concierge's 24 hours start here, not
 * at the form - and files the renter's code message as the first message on
 * its thread. Returns null for a watch that belongs to no request.
 */
export async function confirmInquiryForWatch(
  db: Supa,
  opts: {
    watchId: string;
    complexName: string;
    renter: { id: string; phone_e164: string };
    inboundMessageId: string;
    body: string;
    now: Date;
  },
): Promise<ConfirmedInquiry | null> {
  const { data: inq } = await db
    .from('complex_inquiries')
    .select('id, full_name, bedrooms_needed, budget_max_vnd, target_move_in_date, lease_duration_months, has_pets, whatsapp_confirmed_at')
    .eq('watch_id', opts.watchId)
    .maybeSingle();
  if (!inq) return null;

  const firstConfirm = !inq.whatsapp_confirmed_at;
  if (firstConfirm) {
    const now = opts.now.toISOString();
    await db.from('complex_inquiries').update({
      renter_id: opts.renter.id,
      phone: opts.renter.phone_e164,
      whatsapp_confirmed_at: now,
      last_inbound_at: now,
      last_message_at: now,
    }).eq('id', inq.id);
    await recordInquiryMessage(db, {
      inquiryId: inq.id, direction: 'inbound', source: 'whatsapp',
      whatsappMessageId: opts.inboundMessageId, body: opts.body, now: opts.now,
    });
    // The state change, in the request's log (PLAN-v3 S7.1): its 24 hours start.
    const { error } = await db.from('inquiry_events').insert({
      inquiry_id: inq.id, type: 'CONFIRMED', payload: { renter_id: opts.renter.id }, actor: 'RENTER', occurred_at: now,
    });
    if (error) console.error(`[concierge] CONFIRMED for ${inq.id} failed:`, error.message ?? error);
    // The 16h and 22h reminders (inquiry-deadline.ts). Each decides at run
    // time whether it is still needed.
    const { error: jobErr } = await db.from('jobs').insert(deadlineJobs(String(inq.id), now));
    if (jobErr) console.error(`[concierge] deadline jobs for ${inq.id} failed:`, jobErr.message ?? jobErr);
  }

  return {
    id: String(inq.id),
    firstConfirm,
    fullName: String(inq.full_name ?? ''),
    complexName: opts.complexName,
    bedrooms: Number(inq.bedrooms_needed),
    budgetMaxVnd: inq.budget_max_vnd ?? null,
    moveInDate: String(inq.target_move_in_date),
    leaseMonths: Number(inq.lease_duration_months),
    hasPets: inq.has_pets === true,
  };
}

/**
 * Is this inbound a reply on a request's thread? Returns the request id.
 *
 * Only when the last thing we sent this phone is on that thread, and recently.
 * The same rule as `pendingAlert` and `resolveRequestId`: a message answers
 * whatever we last said.
 */
export async function inquiryAwaitingReply(db: Supa, phoneE164: string, now: Date): Promise<string | undefined> {
  const { data: last } = await db
    .from('messages')
    .select('id, created_at')
    .eq('to_phone', phoneE164)
    .eq('direction', 'OUT')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return undefined;
  if (now.getTime() - Date.parse(String(last.created_at)) > INQUIRY_REPLY_DAYS * 86_400_000) return undefined;

  const { data: row } = await db
    .from('complex_inquiry_messages')
    .select('inquiry_id')
    .eq('whatsapp_message_id', last.id)
    .limit(1)
    .maybeSingle();
  return row?.inquiry_id ? String(row.inquiry_id) : undefined;
}

/** A renter's WhatsApp message, filed on the request and stamped on it. */
export async function recordInquiryInbound(
  db: Supa,
  opts: { inquiryId: string; whatsappMessageId: string; body: string; now: Date },
): Promise<void> {
  await recordInquiryMessage(db, { ...opts, direction: 'inbound', source: 'whatsapp' });
  const now = opts.now.toISOString();
  await db.from('complex_inquiries').update({ last_inbound_at: now, last_message_at: now }).eq('id', opts.inquiryId);
}

/**
 * One row on the request's thread.
 *
 * Idempotent on the WhatsApp message: the unique index on
 * `whatsapp_message_id` turns a redelivery into a no-op, which is why the
 * error is not thrown.
 */
export async function recordInquiryMessage(
  db: Supa,
  opts: {
    inquiryId: string;
    direction: 'inbound' | 'outbound';
    source: 'whatsapp' | 'dashboard' | 'email' | 'system';
    whatsappMessageId: string;
    body: string;
    now: Date;
  },
): Promise<void> {
  const { error } = await db.from('complex_inquiry_messages').insert({
    inquiry_id: opts.inquiryId,
    direction: opts.direction,
    source: opts.source,
    channel: 'WHATSAPP',
    from_email: null,
    to_emails: [],
    body: opts.body,
    whatsapp_message_id: opts.whatsappMessageId,
    created_at: opts.now.toISOString(),
  });
  if (error && error.code !== '23505') {
    console.error(`[concierge] filing a WhatsApp message on ${opts.inquiryId} failed:`, error.message ?? error);
  }
}

export class NoWhatsAppError extends Error {
  constructor(inquiryId: string) {
    super(`Request ${inquiryId} has not been confirmed on WhatsApp, so there is nobody to send to.`);
    this.name = 'NoWhatsAppError';
  }
}

/**
 * Send the concierge's words to a request's renter on WhatsApp.
 *
 * Free-form only: the window the renter's code opened is the one the "within
 * 24 hours" promise runs against, and outside it `sendFreeForm` throws
 * `ServiceWindowClosedError` rather than reaching for a template. The caller
 * decides what that means - email if there is one, or telling the admin.
 *
 * `key` makes it idempotent: the same reply retried is the same message. The
 * caller files it on the thread (the Gmail relay already has a row for it).
 */
export async function sendConciergeWhatsApp(
  db: Supa,
  store: MessageStore,
  adapter: WhatsAppAdapter,
  opts: { inquiryId: string; body: string; key: string },
): Promise<{ messageId: string; status: string }> {
  const { data: inq } = await db
    .from('complex_inquiries')
    .select('id, renter_id, whatsapp_confirmed_at')
    .eq('id', opts.inquiryId)
    .maybeSingle();
  if (!inq?.renter_id || !inq.whatsapp_confirmed_at) throw new NoWhatsAppError(opts.inquiryId);

  const result = await sendFreeForm(store, adapter, {
    renterId: String(inq.renter_id),
    purpose: `CONCIERGE:${opts.inquiryId}:${opts.key}`,
    body: opts.body,
  });
  return { messageId: result.message.id, status: result.message.status };
}

/**
 * Run one INQUIRY_DEADLINE job (inquiry-deadline.ts): email the ops team if
 * the request is still unanswered, otherwise nothing. `send` is the alert
 * transport - sendIntakeAlert in production - injected so this is testable.
 */
export async function runInquiryDeadline(
  db: Supa,
  inquiryId: string,
  now: Date,
  send: (alert: { subject: string; text: string }) => Promise<unknown>,
): Promise<'SENT' | 'NOT_NEEDED' | 'MISSING'> {
  const { data: inq } = await db
    .from('complex_inquiries')
    .select('id, complex_id, bedrooms_needed, budget_max_vnd, target_move_in_date, lease_duration_months, has_pets')
    .eq('id', inquiryId).maybeSingle();
  if (!inq) return 'MISSING';

  const { data: events } = await db
    .from('inquiry_events').select('id, inquiry_id, type, payload, actor, occurred_at').eq('inquiry_id', inquiryId);
  const view = reduceInquiry(inquiryId, (events ?? []) as InquiryEvent[]);

  // A person's answer: any message of ours other than the automatic confirmation.
  const { data: ours } = await db
    .from('complex_inquiry_messages').select('source, created_at')
    .eq('inquiry_id', inquiryId).eq('direction', 'outbound');
  const answeredAt = ((ours ?? []) as { source: string; created_at: string }[])
    .filter(m => m.source !== 'system')
    .map(m => m.created_at)
    .sort()
    .at(-1) ?? null;

  if (!deadlineAlertNeeded(view, answeredAt)) return 'NOT_NEEDED';

  const { data: complex } = await db.from('complexes').select('name').eq('id', inq.complex_id).maybeSingle();
  await send(renderDeadlineAlert({
    complexName: complex?.name ?? 'a building',
    summary: describeInquiry({
      fullName: '', complexName: '', bedrooms: Number(inq.bedrooms_needed), budgetMaxVnd: inq.budget_max_vnd ?? null,
      moveInDate: String(inq.target_move_in_date), leaseMonths: Number(inq.lease_duration_months), hasPets: inq.has_pets === true,
    }),
    confirmedAt: view.confirmedAt!,
    now,
    agentsAsked: Object.values(view.agents).filter(a => a.askedAt).length,
  }));
  return 'SENT';
}

/**
 * A viewing request made from an offer link (`?inq=`, offer.ts) points back
 * at the availability request, which closes itself as VIEWING_REQUESTED
 * (PLAN-v3 S7.1c) - the conversion the offer existed for.
 *
 * Only when both belong to the same renter: an offer link forwarded to a
 * friend must not close someone else's request. Best effort - the viewing
 * request stands either way, so this never throws.
 */
export async function linkViewingToInquiry(
  db: Supa,
  opts: { inquiryId: string; requestId: string; now: Date },
): Promise<'LINKED' | 'SKIPPED'> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(opts.inquiryId)) return 'SKIPPED';
    const { data: req } = await db
      .from('viewing_requests').select('id, renter_id, inquiry_id').eq('id', opts.requestId).maybeSingle();
    const { data: inq } = await db
      .from('complex_inquiries').select('id, renter_id').eq('id', opts.inquiryId).maybeSingle();
    if (!req || !inq?.renter_id || inq.renter_id !== req.renter_id) return 'SKIPPED';

    if (!req.inquiry_id) {
      await db.from('viewing_requests').update({ inquiry_id: opts.inquiryId }).eq('id', opts.requestId);
    }
    const { data: events } = await db
      .from('inquiry_events').select('id, inquiry_id, type, payload, actor, occurred_at').eq('inquiry_id', opts.inquiryId);
    if (reduceInquiry(opts.inquiryId, (events ?? []) as InquiryEvent[]).state !== 'CLOSED') {
      await db.from('inquiry_events').insert({
        inquiry_id: opts.inquiryId, type: 'CLOSED', actor: 'RENTER', occurred_at: opts.now.toISOString(),
        payload: { reason: 'VIEWING_REQUESTED', request_id: opts.requestId },
      });
    }
    return 'LINKED';
  } catch (e) {
    console.error(`[concierge] linking ${opts.requestId} to ${opts.inquiryId} failed:`, (e as Error).message);
    return 'SKIPPED';
  }
}
