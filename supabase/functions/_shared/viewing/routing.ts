// What happens when a renter messages us, independent of how the message
// arrived.
//
// Two callers: `whatsapp-webhook`, where Meta delivers it, and `dev-phone`,
// where /dev/phone simulates it. They must do the same thing - a mock path that
// takes a shortcut is a mock path that hides the bug you were going to find in
// production. So the shortcut is not available: both call this.

import { recordInbound, type MessageStore, type StoredMessage } from '../whatsapp/send.ts';
import { upsertRenterByPhone } from '../whatsapp/store.ts';
import { isOptOut } from '../whatsapp/inbound.ts';
import { refFromMessage } from './intake.ts';

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

  // The reply is state, so it goes in the log. `intent` is UNCLASSIFIED here on
  // purpose: classifying it is S6, and a placeholder the reducer ignores is
  // honest where guessing this early would not be.
  if (requestId) {
    await db.from('events').insert({
      request_id: requestId,
      type: 'RENTER_REPLIED',
      payload: { intent: 'UNCLASSIFIED', message_id: message.id },
      actor: 'RENTER',
      occurred_at: new Date(m.timestamp).toISOString(),
    });
  }

  let optedOut = false;
  if (isOptOut(m.text)) {
    await db.from('renters').update({ opted_out_at: new Date().toISOString() }).eq('id', renter.id);
    optedOut = true;
  }

  return { renterId: renter.id, requestId, message, optedOut };
}
