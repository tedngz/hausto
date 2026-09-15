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
}

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
  const requestId = await resolveRequestId(db, renter.id, m.text);

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
    await db.from('events').insert({
      request_id: requestId,
      type: 'RENTER_REPLIED',
      payload: { intent, message_id: message.id },
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

  let optedOut = false;
  if (intent === 'OPT_OUT') {
    await db.from('renters').update({ opted_out_at: new Date().toISOString() }).eq('id', renter.id);
    optedOut = true;
  }

  return { renterId: renter.id, requestId, message, optedOut, intent, confirmed, selection };
}
