// What happens when a renter messages us, independent of how the message
// arrived.
//
// Two callers: `whatsapp-webhook`, where Meta delivers it, and `dev-phone`,
// where /dev/phone simulates it. They must do the same thing - a mock path that
// takes a shortcut is a mock path that hides the bug you were going to find in
// production. So the shortcut is not available: both call this.

import { recordInbound, type MessageStore, type StoredMessage } from '../whatsapp/send.ts';
import { upsertRenterByPhone } from '../whatsapp/store.ts';
import { refFromMessage } from './intake.ts';
import { classifyIntent } from './intent.ts';
import { parseSelection, resolveSelection, MAX_SELECTED, type Offer } from './selection.ts';
import { reduceRequest, summarise, type DomainEvent } from '../viewing-domain.ts';
import { codeUsable, watchCodeFromMessage, type WatchProblem } from './watch.ts';
import { pendingAlert } from './alerts.ts';
import {
  confirmInquiryForWatch, inquiryAwaitingReply, recordInquiryInbound, type ConfirmedInquiry,
} from './concierge.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

/**
 * The request an inbound message belongs to, or undefined.
 *
 * A ref in the body wins - it is what the deep link put there. Otherwise the
 * renter's newest request, because a bare "yes" is about the thing we last
 * asked them. A ref that does not resolve returns undefined rather than falling
 * back to the newest: attaching a message to the wrong thread is worse than
 * attaching it to none, and a mistyped ref is exactly when that happens.
 */
export async function resolveRequestId(
  db: Supa,
  renterId: string,
  body: string,
): Promise<string | undefined> {
  const ref = refFromMessage(body);
  if (ref) {
    const { data } = await db
      .from('viewing_requests').select('id').eq('ref', ref).eq('renter_id', renterId).maybeSingle();
    return data?.id ?? undefined;
  }
  const { data } = await db
    .from('viewing_requests')
    .select('id')
    .eq('renter_id', renterId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? undefined;
}

export interface InboundOutcome {
  renterId: string;
  requestId?: string;
  message: StoredMessage;
  optedOut: boolean;
  intent: string;
  /** True when this reply closed the request. */
  confirmed: boolean;
  /** Set when the reply picked from a list we sent. */
  selection?: SelectionOutcome;
  /** Set when the message carried a complex-watch code (SPEC §11). */
  watch?: WatchOutcome;
  /** The alert this answers, when the last thing we sent was one (SPEC §11). */
  alertMessageId?: string;
  /** The availability request this answers, when the last thing we sent was on its thread. */
  inquiryId?: string;
}

export type WatchOutcome =
  | {
    kind: 'CONFIRMED';
    watchId: string;
    complexName: string;
    bedrooms: number | null;
    budgetMaxVnd: number | null;
    expiresAt: string;
    /** Set when the code came from an availability request (SPEC §11). */
    inquiry?: ConfirmedInquiry;
  }
  | { kind: 'PROBLEM'; problem: WatchProblem };

export interface SelectionOutcome {
  positions: number[];
  listingIds?: string[];
  problem?: 'NO_OFFER' | 'EXPIRED' | 'OUT_OF_RANGE';
}

/**
 * The most recent list we put in front of this renter, and what they picked
 * from it.
 *
 * Reads the newest SUGGESTIONS_OFFERED on the request. Older offers are
 * deliberately ignored rather than searched: a renter replying "2" means the
 * list in front of them, not one from last week, and resolveSelection's TTL
 * catches the case where even the newest is stale.
 */
// deno-lint-ignore no-explicit-any
async function resolveOffer(db: any, requestId: string, text: string, now: Date): Promise<SelectionOutcome> {
  const { data } = await db
    .from('events')
    .select('payload, occurred_at')
    .eq('request_id', requestId)
    .eq('type', 'SUGGESTIONS_OFFERED')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const listingIds: string[] = Array.isArray(data?.payload?.listing_ids) ? data.payload.listing_ids : [];
  const offer: Offer | null = data ? { listingIds, offeredAt: String(data.occurred_at) } : null;

  // Parsed against how many were actually offered, so "4" against three
  // suggestions is out of range rather than a silent miss.
  //
  // With no offer at all the cap falls back to the default rather than zero:
  // narrowing to nothing would discard the digits and report "not a
  // selection", when what actually happened is a selection with nothing to
  // resolve against - and those need different replies.
  const positions = parseSelection(text, listingIds.length || MAX_SELECTED);
  if (positions.length === 0) return { positions: [] };

  const resolved = resolveSelection(positions, offer, now);
  return resolved.ok
    ? { positions, listingIds: resolved.listingIds }
    : { positions, problem: resolved.reason };
}

/**
 * Write REQUEST_CONFIRMED, but only for a request that has actually been sent
 * an itinerary.
 *
 * A "yes" arriving before delivery is a renter agreeing to nothing in
 * particular - most often it is the wa.me handshake message itself, which is
 * the first thing they ever send us. Confirming on that would close a request
 * before a single broker had been rung.
 */
// deno-lint-ignore no-explicit-any
async function confirmIfDelivered(db: any, requestId: string, timestamp: string): Promise<boolean> {
  const { data: events } = await db
    .from('events')
    .select('id, request_id, item_id, type, payload, actor, occurred_at')
    .eq('request_id', requestId)
    .order('occurred_at', { ascending: true });

  const view = reduceRequest(requestId, (events ?? []) as DomainEvent[]);
  if (view.state !== 'DELIVERED') return false;

  const confirmedItemIds = Object.values(view.items)
    .filter(i => i.state === 'CONFIRMED')
    .map(i => i.itemId);

  // Partial success is the happy path (invariant 5): a renter confirming three
  // of five is confirming the request, not three fifths of one.
  if (confirmedItemIds.length === 0 && summarise(view).total > 0) return false;

  await db.from('events').insert({
    request_id: requestId,
    type: 'REQUEST_CONFIRMED',
    payload: { confirmed_item_ids: confirmedItemIds },
    actor: 'RENTER',
    occurred_at: new Date(timestamp).toISOString(),
  });
  return true;
}

/** Has this request heard from the renter before? */
// deno-lint-ignore no-explicit-any
async function hasReplied(db: any, requestId: string): Promise<boolean> {
  const { data } = await db
    .from('events')
    .select('id')
    .eq('request_id', requestId)
    .eq('type', 'RENTER_REPLIED')
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Turn a pending watch on, because its code just arrived from this phone.
 *
 * Sending the code is the opt-in (SPEC §11), so it also lifts an earlier STOP:
 * a renter who said STOP and then taps "alert me about Empire City" has
 * changed their mind in the most explicit way available. And it links the
 * phone to the account that created the watch, if the renter row has none -
 * never over a link that already exists.
 *
 * Idempotent on redelivery: the same code from the same phone confirms again.
 * The same code from a different phone is treated as unknown, not as a
 * transfer - a code is not a credential to be passed around.
 */
async function confirmWatch(
  db: Supa,
  code: string,
  renter: { id: string; opted_out_at: string | null },
  now: Date,
): Promise<WatchOutcome> {
  const { data: w } = await db
    .from('complex_watches')
    .select('id, complex_id, status, renter_id, user_id, bedrooms, budget_max_vnd, expires_at, created_at')
    .eq('code', code)
    .maybeSingle();

  if (!w || w.status === 'CANCELLED') return { kind: 'PROBLEM', problem: 'UNKNOWN' };
  if (w.status === 'ACTIVE' && w.renter_id !== renter.id) return { kind: 'PROBLEM', problem: 'UNKNOWN' };
  if (w.status === 'PENDING' && codeUsable(String(w.created_at), String(w.expires_at), now) === 'EXPIRED') {
    return { kind: 'PROBLEM', problem: 'EXPIRED' };
  }

  if (w.status === 'PENDING') {
    await db.from('complex_watches')
      .update({ status: 'ACTIVE', renter_id: renter.id, confirmed_at: now.toISOString() })
      .eq('id', w.id)
      .eq('status', 'PENDING');
    if (renter.opted_out_at) {
      await db.from('renters').update({ opted_out_at: null }).eq('id', renter.id);
    }
    if (w.user_id) {
      await db.from('renters').update({ user_id: w.user_id }).eq('id', renter.id).is('user_id', null);
    }
  }

  const { data: complex } = await db.from('complexes').select('name').eq('id', w.complex_id).maybeSingle();
  return {
    kind: 'CONFIRMED',
    watchId: String(w.id),
    complexName: complex?.name ?? 'that building',
    bedrooms: w.bedrooms ?? null,
    budgetMaxVnd: w.budget_max_vnd ?? null,
    expiresAt: String(w.expires_at),
  };
}

/**
 * Record one inbound message: window, row, event, opt-out. In that order.
 *
 * The window first, because it is the fact with a deadline attached. A message
 * we failed to store can be recovered from Meta; a window we failed to extend
 * silently blocks every reply for 24 hours.
 */
export async function handleInbound(
  db: Supa,
  store: MessageStore,
  m: { from: string; text: string; providerMessageId: string; timestamp: string },
): Promise<InboundOutcome> {
  const renter = await upsertRenterByPhone(db, m.from);
  const now = new Date(m.timestamp);

  // A watch code, a reply to an alert, or a reply on an availability
  // request's thread is not about a viewing request - attaching it to their
  // newest one would put "yes" on the wrong thread, and on a delivered
  // itinerary it would confirm viewings they were not asked about. All three
  // are checked before the request is resolved, for that reason. The last two
  // cannot both match: each asks what the last message we sent was.
  const watchCode = watchCodeFromMessage(m.text);
  const alertMessageId = watchCode ? undefined : await pendingAlert(db, renter.phone_e164, now);
  const inquiryId = watchCode || alertMessageId
    ? undefined
    : await inquiryAwaitingReply(db, renter.phone_e164, now);
  const requestId = watchCode || alertMessageId || inquiryId
    ? undefined
    : await resolveRequestId(db, renter.id, m.text);

  const message = await recordInbound(store, {
    renterId: renter.id,
    requestId,
    body: m.text,
    providerMessageId: m.providerMessageId,
    now: new Date(m.timestamp),
  });

  // The reply is state, so it goes in the log - with what it meant, over the
  // closed set in intent.ts.
  const { intent } = classifyIntent(m.text);

  if (requestId) {
    // The wa.me handshake - the first message, carrying the ref the deep link
    // put there - opens the window and answers nothing. Flagged so thread.ts
    // does not show every new request as a renter waiting on a reply.
    const handshake = refFromMessage(m.text) != null && !(await hasReplied(db, requestId));
    await db.from('events').insert({
      request_id: requestId,
      type: 'RENTER_REPLIED',
      payload: { intent, message_id: message.id, ...(handshake ? { handshake: true } : {}) },
      actor: 'RENTER',
      occurred_at: new Date(m.timestamp).toISOString(),
    });
  }

  // A confirmation is the one reply the system finishes on its own. Everything
  // else routes to an operator (see `needsOperator`), because a wrong
  // automated reply inside a billed window costs more than a person reading
  // one line.
  let confirmed = false;
  if (intent === 'CONFIRM' && requestId) {
    confirmed = await confirmIfDelivered(db, requestId, m.timestamp);
  }

  // A selection resolves against the last list we showed them. Recorded here
  // rather than acted on: creating the new request is the caller's job
  // (viewing-agent-select), because it writes rows and queues operator work.
  let selection: SelectionOutcome | undefined;
  if (intent === 'SELECTION' && requestId) {
    selection = await resolveOffer(db, requestId, m.text, new Date(m.timestamp));
  }

  const watch = watchCode ? await confirmWatch(db, watchCode, renter, now) : undefined;
  if (watch?.kind === 'CONFIRMED') {
    // A code from an availability request confirms the request too: the
    // concierge's clock starts now, and this message opens its thread.
    const inquiry = await confirmInquiryForWatch(db, {
      watchId: watch.watchId, complexName: watch.complexName, renter,
      inboundMessageId: message.id, body: m.text, now,
    });
    if (inquiry) watch.inquiry = inquiry;
  }

  // Filed on the request whatever it says - STOP included, since the
  // concierge needs to see that too.
  if (inquiryId) {
    await recordInquiryInbound(db, { inquiryId, whatsappMessageId: message.id, body: m.text, now });
  }

  let optedOut = false;
  if (intent === 'OPT_OUT') {
    await db.from('renters').update({ opted_out_at: new Date().toISOString() }).eq('id', renter.id);
    // STOP ends the watches too, rather than leaving them to wake up if the
    // renter ever opts back in for something else.
    await db.from('complex_watches').update({ status: 'CANCELLED' }).eq('renter_id', renter.id).eq('status', 'ACTIVE');
    optedOut = true;
  }

  return {
    renterId: renter.id, requestId, message, optedOut, intent, confirmed, selection,
    ...(watch ? { watch } : {}),
    ...(alertMessageId ? { alertMessageId } : {}),
    ...(inquiryId ? { inquiryId } : {}),
  };
}
