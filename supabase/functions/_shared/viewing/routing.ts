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
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';
import { classifyIntent } from './intent.ts';
import { parseSelection, resolveSelection, MAX_SELECTED, type Offer } from './selection.ts';
import { freeViewingAvailable, hasPassCover, loadLockIn, lockIn } from './lock-in-run.ts';
import { linkAccount, linkCodeFromMessage, type LinkOutcome } from './account-link.ts';
import { codeUsable, watchCodeFromMessage, type WatchProblem } from './watch.ts';
import { pendingAlert } from './alerts.ts';
import { itineraryAwaitingAnswer } from './open-request.ts';
import {
  confirmInquiryForWatch, inquiriesAnswered, recordInquiryInbound, type ConfirmedInquiry,
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
  /**
   * Set when the reply was a "yes" to a plan the renter cannot lock in by
   * replying - no Pass - so the one answer is where to lock it in (SPEC §9).
   */
  lockIn?: LockInPrompt;
  /** Set when the message carried an account link code (account-link.ts). */
  link?: LinkOutcome;
  /** Set when the reply picked from a list we sent. */
  selection?: SelectionOutcome;
  /** Set when the message carried a complex-watch code (SPEC §11). */
  watch?: WatchOutcome;
  /** The alert this answers, when the last thing we sent was one (SPEC §11). */
  alertMessageId?: string;
  /** The availability request this answers, when the message it answers was on its thread. */
  inquiryId?: string;
  /** Every availability request it answers - one offer can cover several buildings. */
  inquiryIds?: string[];
  /**
   * Set on the wa.me handshake while the request is still being worked: the
   * one reply it gets is the receipt (agent.ts REQUEST_RECEIVED).
   */
  received?: RequestReceived;
}

/** What the receipt for a request names. */
export interface RequestReceived {
  requestId: string;
  ref: string;
  /** The places in it, as the renter asked for them. */
  titles: string[];
}

/**
 * The receipt, if this request is owed one: still being worked - its agents
 * being asked - so "we are asking the agents now" is true. A request whose
 * plan is ready or delivered, or that has closed, is answered by those.
 */
// deno-lint-ignore no-explicit-any
async function receiptFor(db: any, requestId: string): Promise<RequestReceived | undefined> {
  const [{ data: request }, { data: events }, { data: items }] = await Promise.all([
    db.from('viewing_requests').select('ref').eq('id', requestId).maybeSingle(),
    db.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at').eq('request_id', requestId),
    db.from('ops_request_items_view').select('id, listing_title').eq('request_id', requestId),
  ]);
  if (!request) return undefined;
  const view = reduceRequest(requestId, (events ?? []) as DomainEvent[]);
  if (view.state !== 'SUBMITTED' && view.state !== 'CONTACTING') return undefined;
  const titles = ((items ?? []) as { id: string; listing_title: string | null }[])
    .filter(i => view.items[i.id]?.state !== 'WITHDRAWN')
    .map(i => String(i.listing_title ?? 'A place'));
  return { requestId, ref: String(request.ref), titles };
}

/** The message of ours a reply is about. */
interface Answered {
  id: string;
  requestId: string | null;
  createdAt: string;
  /** True when WhatsApp told us: the renter swiped to reply to this message. */
  explicit: boolean;
}

/**
 * What a reply answers. When the renter swipes to reply to one of our
 * messages, WhatsApp names it (`context.id`, our `provider_id`), and that wins
 * over every guess: a renter with two buildings on the go can answer the older
 * offer. Otherwise it is the last thing we sent them - a bare "yes" is about
 * whatever we last asked.
 */
async function answeredMessage(db: Supa, phoneE164: string, contextId?: string): Promise<Answered | undefined> {
  if (contextId) {
    const { data } = await db
      .from('messages').select('id, request_id, created_at')
      .eq('provider_id', contextId).eq('to_phone', phoneE164).eq('direction', 'OUT')
      .maybeSingle();
    if (data) {
      return { id: String(data.id), requestId: data.request_id ?? null, createdAt: String(data.created_at), explicit: true };
    }
  }
  const { data: last } = await db
    .from('messages').select('id, request_id, created_at')
    .eq('to_phone', phoneE164).eq('direction', 'OUT')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return last
    ? { id: String(last.id), requestId: last.request_id ?? null, createdAt: String(last.created_at), explicit: false }
    : undefined;
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

/** Where a renter without the Pass locks a plan in, for the reply to their "yes". */
export interface LockInPrompt {
  ref: string;
  deadline: string;
  freeViewingAvailable: boolean;
}

/**
 * Lock the plan in on a "yes" - for a Pass holder, whose Pass covers every
 * stop. Anyone else cannot lock a plan in by replying (the free viewing is
 * one place they choose, the Pass is a payment), so for them this returns
 * where to do it instead (SPEC §9).
 *
 * Only for a request that has actually been sent an itinerary. A "yes"
 * arriving before delivery is a renter agreeing to nothing in particular -
 * most often it is the wa.me handshake message itself, which is the first
 * thing they ever send us. Confirming on that would close a request before a
 * single broker had been rung. A plan held behind a template has not been
 * seen either, so a "yes" to the template releases it and keeps nothing.
 *
 * Partial success is the happy path (invariant 5): a renter confirming three
 * of five is confirming the request, not three fifths of one.
 */
// deno-lint-ignore no-explicit-any
async function confirmIfDelivered(db: any, requestId: string, timestamp: string): Promise<{
  confirmed: boolean;
  lockIn?: LockInPrompt;
}> {
  const now = Date.parse(timestamp);
  const ctx = await loadLockIn(db, { requestId }, now);
  if (!ctx || ctx.view.state !== 'DELIVERED' || ctx.stops.length === 0) return { confirmed: false };

  if (ctx.userId && await hasPassCover(db, ctx.userId)) {
    const result = await lockIn(db, ctx, { userId: ctx.userId, choice: { cover: 'PASS' }, actor: 'RENTER', now });
    return { confirmed: result.ok && !result.already };
  }
  if (ctx.status !== 'OPEN' || !ctx.deadline) return { confirmed: false };
  return {
    confirmed: false,
    lockIn: { ref: ctx.ref, deadline: ctx.deadline, freeViewingAvailable: await freeViewingAvailable(db, ctx.phoneE164) },
  };
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
    .select('id, complex_id, area_label, status, renter_id, user_id, bedrooms, budget_max_vnd, expires_at, created_at')
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

  // A building's name, or an area's label (Priority search).
  const { data: complex } = w.complex_id
    ? await db.from('complexes').select('name').eq('id', w.complex_id).maybeSingle()
    : { data: null };
  return {
    kind: 'CONFIRMED',
    watchId: String(w.id),
    complexName: complex?.name ?? w.area_label ?? 'that building',
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
  m: { from: string; text: string; providerMessageId: string; timestamp: string; contextId?: string },
): Promise<InboundOutcome> {
  const renter = await upsertRenterByPhone(db, m.from);
  const now = new Date(m.timestamp);

  // The reply is state, so it goes in the log - with what it meant, over the
  // closed set in intent.ts.
  const { intent } = classifyIntent(m.text);

  // A watch code, a reply to an alert, or a reply on an availability
  // request's thread is not about a viewing request - attaching it to their
  // newest one would put "yes" on the wrong thread, and on a delivered
  // itinerary it would confirm viewings they were not asked about. All three
  // are checked before the request is resolved, for that reason. The last two
  // cannot both match: each asks which message of ours this answers.
  //
  // Except a "yes" while an itinerary waits for one. "Reply YES to lock these
  // in" is the one question we ask that a bare yes answers, so an offer or an
  // alert sent after it does not take the yes away from it - unless the
  // renter swiped to reply to that other message, which says what they meant.
  // (The weekly alert is held while an itinerary waits, so a yes to it cannot
  // be mistaken for this.)
  // A link code from the Pass success page is about the account, not any
  // thread - checked like a watch code, before anything else is resolved.
  const linkCode = linkCodeFromMessage(m.text);
  const watchCode = linkCode ? null : watchCodeFromMessage(m.text);
  const coded = !!(watchCode || linkCode);
  const answered = coded ? undefined : await answeredMessage(db, renter.phone_e164, m.contextId);
  const awaitingYes = !coded && intent === 'CONFIRM' && !answered?.explicit
    ? await itineraryAwaitingAnswer(db, renter.id)
    : undefined;
  const alertMessageId = coded || awaitingYes || !answered ? undefined : await pendingAlert(db, answered, now);
  const inquiryIds = coded || awaitingYes || alertMessageId || !answered
    ? []
    : await inquiriesAnswered(db, answered, now);
  const inquiryId = inquiryIds[0];
  const requestId = coded || alertMessageId || inquiryId
    ? undefined
    : awaitingYes
      ?? (answered?.explicit && answered.requestId ? answered.requestId : await resolveRequestId(db, renter.id, m.text));

  const message = await recordInbound(store, {
    renterId: renter.id,
    requestId,
    body: m.text,
    providerMessageId: m.providerMessageId,
    now: new Date(m.timestamp),
  });

  let received: RequestReceived | undefined;
  if (requestId) {
    // The wa.me handshake - the first message, carrying the ref the deep link
    // put there - opens the window. Flagged so thread.ts does not show every
    // new request as a renter waiting on a reply; answered with the receipt
    // (agent.ts), not by an operator.
    const handshake = refFromMessage(m.text) != null && !(await hasReplied(db, requestId));
    if (handshake && intent !== 'OPT_OUT') received = await receiptFor(db, requestId);
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
  let lockInPrompt: LockInPrompt | undefined;
  if (intent === 'CONFIRM' && requestId) {
    ({ confirmed, lockIn: lockInPrompt } = await confirmIfDelivered(db, requestId, m.timestamp));
  }

  // A selection resolves against the last list we showed them. Recorded here
  // rather than acted on: creating the new request is the caller's job
  // (viewing-agent-select), because it writes rows and queues operator work.
  let selection: SelectionOutcome | undefined;
  if (intent === 'SELECTION' && requestId) {
    selection = await resolveOffer(db, requestId, m.text, new Date(m.timestamp));
  }

  const link = linkCode && intent !== 'OPT_OUT' ? await linkAccount(db, linkCode, renter, now) : undefined;
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

  // Filed on each request it answers whatever it says - STOP included, since
  // the concierge needs to see that too.
  for (const id of inquiryIds) {
    await recordInquiryInbound(db, { inquiryId: id, whatsappMessageId: message.id, body: m.text, now });
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
    ...(lockInPrompt && !optedOut ? { lockIn: lockInPrompt } : {}),
    ...(link ? { link } : {}),
    ...(watch ? { watch } : {}),
    ...(alertMessageId ? { alertMessageId } : {}),
    ...(inquiryId ? { inquiryId, inquiryIds } : {}),
    ...(received && !optedOut ? { received } : {}),
  };
}
