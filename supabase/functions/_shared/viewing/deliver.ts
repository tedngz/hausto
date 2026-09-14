// Turning a request into something the renter reads, and sending it.
//
// Extracted so the ops endpoint and the job runner share one implementation
// rather than one calling the other over HTTP. A self-call would double the
// auth surface, hide failures behind a status code, and make the send path
// depend on the function being reachable from inside itself.
//
// The ordering here is the load-bearing part: send first, then write the
// events. An ITINERARY_DELIVERED for a message that never left would stop the
// silence watch from firing again for that request, which is the one failure
// that breaks S6's promise quietly rather than loudly.

import type { WhatsAppAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { sendFreeForm, ServiceWindowClosedError, ConsecutiveMessageError } from '../whatsapp/send.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';
import { assembleItinerary, renderItinerary, renderNoSupply, type StopListing, type Warning } from './itinerary.ts';
import { renderHoldingUpdate, renderViewingReminder } from './reminders.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export type DeliveryPurpose = 'ITINERARY' | 'HOLDING_UPDATE' | 'VIEWING_REMINDER';

export interface DeliverOptions {
  requestId: string;
  purpose: DeliveryPurpose;
  /** Ops-chosen itinerary order. Ignored for anything but ITINERARY. */
  order?: string[];
  substitutes?: { title: string; priceVnd: number; districtCode: string | null }[];
  /** Required for VIEWING_REMINDER: which viewing is being reminded about. */
  itemId?: string;
  attempt?: number;
  /** `OPS:<uuid>` or `SYSTEM`. */
  actor?: string;
}

export type DeliverResult =
  | { ok: true; messageId: string; deduplicated: boolean; stops: number; warnings: Warning[]; preview: string }
  | { ok: false; code: 'unknown_request' | 'service_window_closed' | 'too_many_consecutive' | 'send_failed';
      message: string; preview?: string };

export async function deliver(
  db: Supa,
  adapter: WhatsAppAdapter,
  opts: DeliverOptions,
): Promise<DeliverResult> {
  const { data: request } = await db
    .from('viewing_requests').select('id, ref, renter_id, created_at').eq('id', opts.requestId).maybeSingle();
  if (!request) return { ok: false, code: 'unknown_request', message: `Unknown request ${opts.requestId}` };

  const [{ data: events }, { data: items }] = await Promise.all([
    db.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
      .eq('request_id', opts.requestId).order('occurred_at', { ascending: true }),
    db.from('ops_request_items_view').select('id, listing_title, district_code, price_vnd_at_request')
      .eq('request_id', opts.requestId),
  ]);

  const view = reduceRequest(opts.requestId, (events ?? []) as DomainEvent[]);
  const listings: StopListing[] = (items ?? []).map((i: Record<string, unknown>) => ({
    itemId: String(i.id),
    listingTitle: String(i.listing_title ?? 'A place'),
    districtCode: (i.district_code as string) ?? null,
    priceVndAtRequest: Number(i.price_vnd_at_request ?? 0),
  }));

  let text: string;
  let stops = 0;
  let warnings: Warning[] = [];
  let orderedItemIds: string[] | null = null;

  if (opts.purpose === 'ITINERARY') {
    const assembled = assembleItinerary(view, listings, opts.order ?? view.itineraryOrder);
    stops = assembled.stops.length;
    warnings = assembled.warnings;
    orderedItemIds = assembled.stops.map(s => s.itemId);
    text = stops === 0
      // Zero confirmed. FAILED_NO_SUPPLY ships with substitutes or it is a
      // dead end, and a dead end is not something we make a renter read.
      ? renderNoSupply({ ref: request.ref, requestedCount: listings.length, substitutes: opts.substitutes ?? [] })
      : renderItinerary({ ref: request.ref, stops: assembled.stops, requestedCount: listings.length });
  } else if (opts.purpose === 'VIEWING_REMINDER') {
    const item = opts.itemId ? view.items[opts.itemId] : undefined;
    const slot = item?.slots?.[0] as { starts_at?: string } | undefined;
    const listing = listings.find(l => l.itemId === opts.itemId);
    if (!item || !slot?.starts_at || !listing) {
      // Nothing to remind about. Refusing beats sending "you have a viewing"
      // with the time left blank.
      return {
        ok: false,
        code: 'unknown_request',
        message: `No confirmed viewing to remind about on item ${opts.itemId ?? '(none given)'}`,
      };
    }
    text = renderViewingReminder({
      ref: request.ref,
      listingTitle: listing.listingTitle,
      startsAt: slot.starts_at,
      districtCode: listing.districtCode,
    });
  } else {
    text = renderHoldingUpdate({ ref: request.ref, view });
  }

  const store = new SupabaseMessageStore(db);
  let messageId: string;
  let deduplicated = false;

  try {
    const result = await sendFreeForm(store, adapter, {
      renterId: request.renter_id,
      requestId: opts.requestId,
      purpose: opts.purpose,
      body: text,
      attempt: opts.attempt ?? 1,
    });
    messageId = result.message.id;
    deduplicated = result.deduplicated;
  } catch (e) {
    if (e instanceof ServiceWindowClosedError) {
      // The human-blocked dependency surfacing, not a bug. Re-opening a window
      // needs an approved template and none of the four are approved, so there
      // is nothing to fall back to - and writing a SENT row for a message
      // nobody receives would be worse than refusing.
      return {
        ok: false,
        code: 'service_window_closed',
        message:
          'The renter has not messaged us in 24h, so a free-form send is illegal. ' +
          'Re-opening needs an approved template - none are approved yet (templates.ts).',
        preview: text,
      };
    }
    if (e instanceof ConsecutiveMessageError) {
      return { ok: false, code: 'too_many_consecutive', message: (e as Error).message, preview: text };
    }
    return { ok: false, code: 'send_failed', message: (e as Error).message, preview: text };
  }

  // Deduplicated means this exact send already happened. The events it should
  // have written were written then; writing them again would put two
  // ITINERARY_DELIVERED rows in an append-only log for one delivery.
  if (deduplicated) {
    return { ok: true, messageId, deduplicated, stops, warnings, preview: text };
  }

  const actor = opts.actor ?? 'SYSTEM';
  const toWrite: Record<string, unknown>[] = [];
  if (orderedItemIds) {
    toWrite.push({
      request_id: opts.requestId,
      type: 'ITINERARY_ASSEMBLED',
      payload: { ordered_item_ids: orderedItemIds, warnings },
      actor,
    });
  }
  toWrite.push({
    request_id: opts.requestId,
    // A holding update is something the renter heard - it moves the silence
    // clock - but it is not the itinerary, and typing it as one would make the
    // queue think the request was finished.
    // Both a holding update and a viewing reminder are things the renter
    // heard: they move the silence clock and nothing else. Only the itinerary
    // is ITINERARY_DELIVERED, because only that means the plan has gone out.
    type: opts.purpose === 'ITINERARY' ? 'ITINERARY_DELIVERED' : 'HOLDING_UPDATE_SENT',
    payload: { message_id: messageId },
    actor,
  });

  const { error: evErr } = await db.from('events').insert(toWrite);
  if (evErr) console.error('[deliver] event insert failed after a successful send:', evErr);

  return { ok: true, messageId, deduplicated, stops, warnings, preview: text };
}
