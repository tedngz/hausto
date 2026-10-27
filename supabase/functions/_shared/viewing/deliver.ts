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
import {
  sendFreeForm,
  sendTemplate,
  isWindowOpen,
  ServiceWindowClosedError,
  ConsecutiveMessageError,
  OptedOutError,
  UnapprovedTemplateError,
} from '../whatsapp/send.ts';
import { TEMPLATES } from '../whatsapp/templates.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';
import {
  assembleItinerary,
  freeOnOtherDays,
  renderItinerary,
  renderNoSupply,
  renderOtherDays,
  renderAlternativesOnly,
  type PrioritySearchOffer,
  type StopListing,
  type Warning,
} from './itinerary.ts';
import { lastHeardFromUs, renderHoldingUpdate } from './reminders.ts';
import { hcmcLong } from './format.ts';
import { profileOf, rankSubstitutes, toRenderable } from './substitutes.ts';
import type { ShortlistCandidate } from './intake.ts';
import { lockInDeadline, renderLockInLine, PASS_DAYS, PASS_PRICE_USD } from './lock-in.ts';
import { freeViewingAvailable, hasPassCover, planPassCover } from './lock-in-run.ts';
import { prioritySearchPath, REPLY_WITHIN_HOURS } from './place.ts';
import { VIEWINGS_PATH } from './renter-view.ts';
import { SITE_URL } from './watch.ts';
import { loadTerms } from '../lease-terms.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

// The closed set, exported as a value so callers taking a purpose off the wire
// can check it rather than cast. Note there is no NO_SUPPLY: that message is
// ITINERARY with nothing confirmed, which is how deliver() reaches it. The
// viewing-day message is not here either: it is about a renter's day, not one
// request (viewing-day.ts).
export const DELIVERY_PURPOSES = ['ITINERARY', 'HOLDING_UPDATE'] as const;
export type DeliveryPurpose = typeof DELIVERY_PURPOSES[number];

export interface DeliverOptions {
  requestId: string;
  purpose: DeliveryPurpose;
  /** Ops-chosen itinerary order. Ignored for anything but ITINERARY. */
  order?: string[];
  /**
   * Explicit substitutes, if the caller has some. Left unset, a zero-confirmed
   * request picks its own - see findSubstitutes below.
   */
  substitutes?: { title: string; priceVnd: number; districtCode: string | null; listingId?: string }[];
  attempt?: number;
  /** `OPS:<uuid>` or `SYSTEM`. */
  actor?: string;
}

export type DeliverResult =
  | { ok: true; messageId: string; deduplicated: boolean; stops: number; warnings: Warning[]; preview: string;
      /**
       * The renter's window was shut, so a template told them the plan is
       * ready and the plan itself waits for their reply (ITINERARY_HELD).
       * `preview` is the plan that will go, not the template that went.
       */
      held: boolean;
      /** It asked the renter for other days rather than sending a plan (OTHER_DAYS_ASKED). */
      otherDays: boolean }
  | { ok: false;
      code: 'unknown_request' | 'service_window_closed' | 'too_many_consecutive' | 'opted_out' | 'template_unavailable' | 'send_failed';
      message: string; preview?: string };

/** A short, stable fingerprint of a message's text (FNV-1a). */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

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
    db.from('ops_request_items_view').select('id, listing_id, listing_title, district_code, price_vnd_at_request')
      .eq('request_id', opts.requestId),
  ]);

  const view = reduceRequest(opts.requestId, (events ?? []) as DomainEvent[]);
  // What each ad states about the lease, under what its agent told us (the
  // view's `terms`) - one line per stop. A failed read is "not stated".
  const adTerms = await loadTerms(db, (items ?? []).map((i: Record<string, unknown>) => String(i.listing_id)));
  // A place the renter removed is not one they asked about any more, so it is
  // neither a stop nor counted in "3 of the 5 places you asked about".
  const listings: StopListing[] = (items ?? [])
    .filter((i: Record<string, unknown>) => view.items[String(i.id)]?.state !== 'WITHDRAWN')
    .map((i: Record<string, unknown>) => ({
      itemId: String(i.id),
      listingTitle: String(i.listing_title ?? 'A place'),
      districtCode: (i.district_code as string) ?? null,
      priceVndAtRequest: Number(i.price_vnd_at_request ?? 0),
      terms: adTerms.get(String(i.listing_id)) ?? null,
    }));

  let text: string;
  let stops = 0;
  let firstStartsAt: string | null = null;
  let alternativesOnly = false;
  // Nothing at their times, but a place is still there on other days: a
  // question for the renter, not a plan (OTHER_DAYS_ASKED).
  let otherDays = false;
  let warnings: Warning[] = [];
  let orderedItemIds: string[] | null = null;
  let substitutes: { title: string; priceVnd: number; districtCode: string | null; listingId?: string }[] = [];
  // Recorded as SUGGESTIONS_OFFERED so a reply of "2" has something to resolve
  // against. Without it the message says "reply with a number" and the number
  // means nothing - which is what it did before this.
  let offeredListingIds: string[] = [];

  if (opts.purpose === 'ITINERARY') {
    const assembled = assembleItinerary(view, listings, opts.order ?? view.itineraryOrder);
    stops = assembled.stops.length;
    warnings = assembled.warnings;
    orderedItemIds = assembled.stops.map(s => s.itemId);
    firstStartsAt = assembled.stops.map(s => s.startsAt).sort()[0] ?? null;
    alternativesOnly = stops === 0 && assembled.alternatives.length > 0;
    if (alternativesOnly) {
      // Nothing at their times, but agents offered others. That is not "none
      // are free" - these units are available and their agents are waiting on
      // an answer - so it is not the no-supply message and carries no
      // substitutes.
      text = renderAlternativesOnly({
        ref: request.ref, requestedCount: listings.length, alternatives: assembled.alternatives,
      });
    } else if (stops === 0 && freeOnOtherDays(view, listings).length > 0) {
      // Their agents could not do those days and did not say the places were
      // rented. Asking for other days is the answer that keeps the places
      // the renter chose; "none are still free" would be untrue about them.
      // No ITINERARY_ASSEMBLED and no ITINERARY_DELIVERED, so their times can
      // still be changed (renter-view.ts canChangeTimes).
      otherDays = true;
      orderedItemIds = null;
      text = renderOtherDays({
        ref: request.ref, requestedCount: listings.length,
        places: freeOnOtherDays(view, listings), changeTimesUrl: `${SITE_URL}${VIEWINGS_PATH}`,
      });
    } else if (stops === 0) {
      // Zero confirmed and nothing to be had on other days. FAILED_NO_SUPPLY
      // ships with close matches, or with Priority search when there are
      // none - never with a promise to come back that nothing keeps.
      const found = opts.substitutes ?? await findSubstitutes(db, opts.requestId);
      substitutes = found;
      offeredListingIds = found.map(s => s.listingId).filter((id): id is string => !!id);
      text = renderNoSupply({
        ref: request.ref, requestedCount: listings.length, substitutes: found,
        prioritySearch: found.length === 0 ? await prioritySearchFor(db, request) : undefined,
      });
    } else {
      text = renderItinerary({
        ref: request.ref, stops: assembled.stops, requestedCount: listings.length,
        alternatives: assembled.alternatives,
        lockInLine: await lockInLineFor(db, request, view),
      });
    }
  } else {
    text = renderHoldingUpdate({ ref: request.ref, view });
  }

  // The key says which message this is, so a retry is the same message and a
  // different one is not. A holding update's names the silence it breaks -
  // when the renter last heard from us - so the next, a day on, is new; keyed
  // on the purpose alone, every one after a request's first was taken for a
  // duplicate, wrote no event, and was queued again every pass. An
  // itinerary's names its words, so sending the same plan twice is one
  // message and sending a changed plan is a second, rather than a silent
  // "already sent".
  const store = new SupabaseMessageStore(db);
  let messageId: string;
  let deduplicated = false;

  // With their window shut nothing free-form may reach them, so the message
  // goes as the approved template that says it in outline and asks them to
  // reply. A holding update ends there: their reply opens the window and an
  // operator answers it. An itinerary is held (ITINERARY_HELD): their reply
  // opens the window and releases it, free-form (releaseHeldItinerary).
  const renter = await store.getRenter(request.renter_id);
  const viaTemplate = !!renter && !isWindowOpen(renter, new Date());
  const held = viaTemplate && opts.purpose === 'ITINERARY';
  const place = listings.length === 1 ? listings[0].listingTitle : `${listings.length} places`;
  const template = !viaTemplate
    ? null
    : opts.purpose === 'ITINERARY' && stops > 0 && firstStartsAt
      ? { name: TEMPLATES.ITINERARY_READY.name, params: [String(stops), hcmcLong(firstStartsAt)] }
      // Only with matches to send: the template says "we have found some".
      : opts.purpose === 'ITINERARY' && !alternativesOnly && substitutes.length > 0
        ? { name: TEMPLATES.NO_SUPPLY_SUBSTITUTES.name, params: [request.ref] }
        // A holding update, other times on offer, or nothing found yet.
        : { name: TEMPLATES.REQUEST_UPDATE.name, params: [place] };

  // Keyed as above. A held plan's template has a key of its own, so the plan
  // its release sends is a new message rather than a duplicate of it.
  // The other-days ask names the round of times it is about: new times that
  // come back the same way ask the same words again, and that is a new
  // question, not a duplicate of the last.
  const purpose = opts.purpose === 'HOLDING_UPDATE'
    ? `HOLDING_UPDATE:${new Date(lastHeardFromUs((events ?? []) as DomainEvent[], request.created_at)).toISOString()}`
    : otherDays
      ? `${held ? 'OTHER_DAYS_HELD' : 'OTHER_DAYS'}:t${view.availabilityChanges}:${fingerprint(text)}`
      : `${held ? 'ITINERARY_HELD' : 'ITINERARY'}:${fingerprint(text)}`;

  try {
    const result = template
      ? await sendTemplate(store, adapter, {
        renterId: request.renter_id,
        requestId: opts.requestId,
        purpose,
        templateName: template.name,
        params: [await firstName(db, request.renter_id), ...template.params],
        attempt: opts.attempt ?? 1,
      })
      : await sendFreeForm(store, adapter, {
        renterId: request.renter_id,
        requestId: opts.requestId,
        purpose,
        body: text,
        attempt: opts.attempt ?? 1,
      });
    messageId = result.message.id;
    deduplicated = result.deduplicated;
    if (result.message.status === 'FAILED') {
      return { ok: false, code: 'send_failed', message: 'WhatsApp refused the message.', preview: text };
    }
  } catch (e) {
    if (e instanceof ServiceWindowClosedError) {
      // The window shut between the check above and the send. Writing a SENT
      // row for a message nobody receives would be worse than refusing.
      return {
        ok: false,
        code: 'service_window_closed',
        message: 'The renter has not messaged us in 24h, so a free-form send is illegal. It goes once they write.',
        preview: text,
      };
    }
    if (e instanceof UnapprovedTemplateError) {
      return { ok: false, code: 'template_unavailable', message: (e as Error).message, preview: text };
    }
    if (e instanceof ConsecutiveMessageError) {
      return { ok: false, code: 'too_many_consecutive', message: (e as Error).message, preview: text };
    }
    if (e instanceof OptedOutError) {
      return { ok: false, code: 'opted_out', message: (e as Error).message, preview: text };
    }
    return { ok: false, code: 'send_failed', message: (e as Error).message, preview: text };
  }

  // Deduplicated means this exact send already happened. The events it should
  // have written were written then; writing them again would put two
  // ITINERARY_DELIVERED rows in an append-only log for one delivery.
  if (deduplicated) {
    return { ok: true, messageId, deduplicated, stops, warnings, preview: text, held, otherDays };
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
  if (otherDays) {
    // A question, not a plan: nothing assembled, nothing delivered. Held, it
    // waits on their reply like a held plan (releaseHeldItinerary).
    toWrite.push({
      request_id: opts.requestId,
      type: 'OTHER_DAYS_ASKED',
      payload: { message_id: messageId, ...(held ? { held: true, template: template!.name } : {}) },
      actor,
    });
  } else {
    toWrite.push({
      request_id: opts.requestId,
      // A holding update is something the renter heard: it moves the silence
      // clock and nothing else. Only the itinerary is ITINERARY_DELIVERED,
      // because only that means the plan has gone out.
      // A held itinerary is neither: the renter knows a plan exists and has not
      // seen it, so nothing they say yet can confirm it.
      type: held ? 'ITINERARY_HELD' : opts.purpose === 'ITINERARY' ? 'ITINERARY_DELIVERED' : 'HOLDING_UPDATE_SENT',
      payload: held
        ? { message_id: messageId, ordered_item_ids: orderedItemIds ?? [], template: template!.name }
        : { message_id: messageId, ...(viaTemplate ? { via: 'TEMPLATE' } : {}) },
      actor,
    });
  }

  // What was put in front of the renter, in the order shown. Without this a
  // reply of "2" resolves against nothing and the "reply with a number" line in
  // the message is a promise we cannot keep. Not while held: the list has
  // not been shown, and the release picks it again.
  if (offeredListingIds.length > 0 && !held) {
    toWrite.push({
      request_id: opts.requestId,
      type: 'SUGGESTIONS_OFFERED',
      payload: { listing_ids: offeredListingIds, source: 'SUBSTITUTES', message_id: messageId },
      actor,
    });
  }

  const { error: evErr } = await db.from('events').insert(toWrite);
  if (evErr) console.error('[deliver] event insert failed after a successful send:', evErr);

  return { ok: true, messageId, deduplicated, stops, warnings, preview: text, held, otherDays };
}

const CLOSED_STATES = new Set(['CONFIRMED', 'CANCELLED', 'FAILED_NO_SUPPLY']);

/**
 * Send the itinerary a template held for this renter, now that they have
 * written. Both inbound paths call it after handleInbound has recorded the
 * message, which is what opened the window.
 *
 * The newest held request only. Two would be two messages to one reply, and
 * the other stays held for the next. The plan is reassembled rather than
 * replayed, in the order on file: an outcome recorded while it was held is in
 * it, which is what the renter should read now.
 */
export async function releaseHeldItinerary(
  db: Supa,
  adapter: WhatsAppAdapter,
  renterId: string,
): Promise<{ requestId: string; result: DeliverResult } | null> {
  const { data: requests } = await db
    .from('viewing_requests').select('id').eq('renter_id', renterId)
    .order('created_at', { ascending: false }).limit(20);
  const ids = (requests ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return null;

  // A question about other days waits the same way, and is released the same
  // way: deliver() reaches it again from the log as it stands now.
  const { data: heldEvents } = await db
    .from('events').select('request_id').in('request_id', ids).in('type', ['ITINERARY_HELD', 'OTHER_DAYS_ASKED']);
  const candidates = new Set((heldEvents ?? []).map((e: { request_id: string }) => e.request_id));

  for (const requestId of ids) {
    if (!candidates.has(requestId)) continue;
    const { data: events } = await db
      .from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
      .eq('request_id', requestId).order('occurred_at', { ascending: true });
    const view = reduceRequest(requestId, (events ?? []) as DomainEvent[]);
    if (CLOSED_STATES.has(view.state)) continue;
    if (!view.heldItinerary && !view.otherDaysAsked?.held) continue;
    const result = await deliver(db, adapter, {
      requestId, purpose: 'ITINERARY', order: view.heldItinerary?.orderedItemIds, actor: 'SYSTEM',
    });
    return { requestId, result };
  }
  return null;
}

/**
 * Close matches for a request whose whole shortlist fell through.
 *
 * Reads the renter's own shortlist to infer what they wanted, then ranks live
 * listings against it. Deterministic - see substitutes.ts for why this is not
 * an LLM call.
 *
 * Returns [] on any failure rather than throwing: a substitute search that
 * breaks must not stop the renter being told their request failed, which is
 * the more important half of the message.
 */
async function findSubstitutes(db: Supa, requestId: string) {
  const columns =
    'id, is_active, price_vnd, price_confidence, bedrooms, area_sqm, district_code, realtor_id, title';
  try {
    const { data: items } = await db
      .from('request_items').select('listing_id').eq('request_id', requestId);
    const listingIds = (items ?? []).map((i: { listing_id: string }) => i.listing_id);
    if (listingIds.length === 0) return [];

    const { data: shortlisted } = await db
      .from('external_properties').select(columns).in('id', listingIds);
    const profile = profileOf((shortlisted ?? []) as ShortlistCandidate[]);

    // Candidates from the districts they chose. Scoped rather than scanning the
    // whole index: a substitute in another city is not a substitute, and the
    // ranker would score it last anyway.
    let query = db.from('external_properties').select(columns).eq('is_active', true).limit(200);
    if (profile.districts.length > 0) query = query.in('district_code', profile.districts);

    const { data: candidates } = await query;
    // Keeps listingId alongside the renderable fields: the renderer ignores
    // it, and SUGGESTIONS_OFFERED needs it.
    const ranked = rankSubstitutes(profile, (candidates ?? []) as ShortlistCandidate[]);
    return ranked.map((r, i) => ({ ...toRenderable([r])[0], listingId: r.listingId, position: i + 1 }));
  } catch (e) {
    console.error('[deliver] substitute search failed, sending without:', (e as Error).message);
    return [];
  }
}

/**
 * Priority search, for a request with nothing left and no close match: a
 * link that opens it filled in from what the renter shortlisted - its
 * districts, the most bedrooms, the dearest price - and worded for whether
 * they hold the Pass and still have their free viewing.
 */
async function prioritySearchFor(
  db: Supa,
  request: { id: string; renter_id: string },
): Promise<PrioritySearchOffer> {
  const { data: renter } = await db
    .from('renters').select('user_id, phone_e164').eq('id', request.renter_id).maybeSingle();
  const { data: items } = await db.from('request_items').select('listing_id').eq('request_id', request.id);
  const listingIds = (items ?? []).map((i: { listing_id: string }) => i.listing_id);
  const { data: shortlisted } = listingIds.length > 0
    ? await db.from('external_properties').select('price_vnd, bedrooms, district_code').in('id', listingIds)
    : { data: [] };
  const rows = (shortlisted ?? []) as { price_vnd: number | null; bedrooms: number | null; district_code: string | null }[];
  const most = (xs: (number | null)[]) => {
    const ns = xs.filter((x): x is number => typeof x === 'number' && x > 0);
    return ns.length > 0 ? Math.max(...ns) : null;
  };
  const hasPass = await hasPassCover(db, renter?.user_id ?? null);
  return {
    url: `${SITE_URL}${prioritySearchPath({
      districtCodes: rows.map(r => r.district_code).filter((d): d is string => !!d),
      bedrooms: most(rows.map(r => r.bedrooms)),
      budgetMaxVnd: most(rows.map(r => r.price_vnd)),
    })}`,
    hasPass,
    freeViewing: !hasPass && (renter?.phone_e164 ? await freeViewingAvailable(db, renter.phone_e164) : true),
    browseUrl: `${SITE_URL}/hub`,
    passPriceUsd: PASS_PRICE_USD,
    passDays: PASS_DAYS,
    replyWithinHours: REPLY_WITHIN_HOURS.AREA,
  };
}

/**
 * The lock-in line for a renter without the Pass, or undefined for one with
 * it - a Pass holder's "yes" locks the plan in, as it always did (SPEC §9).
 * "With it" is the Pass covering this plan: live now, or live when the request
 * was made (`planPassCover`).
 *
 * The deadline is the one this delivery will set: the plan arrives now unless
 * it already has, and the three-hour floor runs from this send. Once the plan
 * has gone out it is fixed, so sending the same plan again is the same text,
 * and the same message.
 */
async function lockInLineFor(
  db: Supa,
  request: { ref: string; renter_id: string; created_at: string },
  view: ReturnType<typeof reduceRequest>,
): Promise<string | undefined> {
  const { data: renter } = await db
    .from('renters').select('user_id, phone_e164').eq('id', request.renter_id).maybeSingle();
  if (await planPassCover(db, { userId: renter?.user_id ?? null, requestedAt: request.created_at })) return undefined;
  const now = new Date().toISOString();
  const deadline = lockInDeadline({
    ...view,
    planArrivedAt: view.planArrivedAt ?? now,
    lastDeliveredAt: view.lastDeliveredAt ?? now,
  });
  if (!deadline) return undefined;
  return renderLockInLine({
    siteUrl: SITE_URL,
    ref: request.ref,
    deadline,
    freeViewingAvailable: renter?.phone_e164 ? await freeViewingAvailable(db, renter.phone_e164) : true,
  });
}

/** The renter's first name for a template, or "there". */
async function firstName(db: Supa, renterId: string): Promise<string> {
  const { data } = await db.from('renters').select('display_name').eq('id', renterId).maybeSingle();
  return String(data?.display_name ?? '').trim().split(/\s+/)[0] || 'there';
}
