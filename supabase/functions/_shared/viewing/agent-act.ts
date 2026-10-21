// Carrying out what `decideAction` decided.
//
// Split from the decision so the decision stays pure and this stays dumb. If a
// judgement appears in here, it is in the wrong file.
//
// Everything sends at most one message, because `decideAction` returns at most
// one action. The consecutive-outbound guard in send.ts is the backstop rather
// than the mechanism.

import type { WhatsAppAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { sendFreeForm, ServiceWindowClosedError, ConsecutiveMessageError } from '../whatsapp/send.ts';
import {
  addDays, generateRef, hcmcDate, intakeEvents, MIN_LEAD_DAYS, oneOpenRequestMessage, requestGate, requestGateMessage,
  screenCandidates, validateAvailability, type AvailabilityWindow, type ShortlistCandidate,
} from './intake.ts';
import { renderSelectionProblem, renderReRequested, renderRequestOnSite } from './selection.ts';
import { countLapsedPlans, findOpenRequests } from './open-request.ts';
import { freeViewingAvailable, hasPassCover } from './lock-in-run.ts';
import { PASS_DAYS, PASS_PRICE_USD } from './lock-in.ts';
import { renderWelcome } from './search.ts';
import { WELCOME_PURPOSE } from './search-limits.ts';
import type { AgentAction } from './agent.ts';
import { renderAlertDetails, renderWatchConfirmed, renderWatchProblem } from './watch.ts';
import { alertItemsFor, markAlertDetailed } from './alerts.ts';
import { renderInquiryConfirmed } from './inquiry.ts';
import { recordInquiryMessage } from './concierge.ts';
import { renderLockInReply } from './lock-in.ts';
import { renderLinkOutcome } from './account-link.ts';
import { SITE_URL } from './watch.ts';
import { renderRequestReceived } from './intake.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

const CANDIDATE_COLUMNS =
  'id, is_active, price_vnd, price_confidence, bedrooms, area_sqm, district_code, realtor_id, title';

export interface ActResult {
  performed: AgentAction['kind'];
  messageId?: string;
  newRequestId?: string;
  ref?: string;
  /** A pick that could not become a request here, sent to the site instead - and why. */
  onSite?: string;
  error?: string;
}

/** A listing's page, which is where a viewing is asked for. */
function pageOf(listing: { id: string; title?: string | null }): { title: string; url: string } {
  return { title: listing.title ?? 'A place', url: `${SITE_URL}/property/${listing.id}` };
}

/**
 * Do it, and send one message.
 *
 * Failures are returned rather than thrown. This runs inside the inbound
 * webhook, where an exception would cost us Meta's whole delivery batch - the
 * renter's message is already stored and the window already re-opened, and
 * losing those to a failed agent reply would be a far worse trade.
 */
export async function performAction(
  db: Supa,
  adapter: WhatsAppAdapter,
  action: AgentAction,
  ctx: { renterId: string; requestId?: string; providerMessageId: string; now?: Date },
): Promise<ActResult> {
  const store = new SupabaseMessageStore(db);

  try {
    if (action.kind === 'SELECTION_PROBLEM') {
      const result = await sendFreeForm(store, adapter, {
        renterId: ctx.renterId,
        requestId: ctx.requestId,
        // Keyed on the inbound message, so a webhook redelivery cannot send a
        // second copy of the same explanation.
        purpose: `AGENT_SELECTION_PROBLEM:${ctx.providerMessageId}`,
        body: renderSelectionProblem(action.problem),
      });
      return { performed: action.kind, messageId: result.message.id };
    }

    if (action.kind === 'RE_REQUEST') {
      return await createReRequest(db, adapter, action.listingIds, ctx);
    }

    if (action.kind === 'WELCOME') {
      const result = await sendFreeForm(store, adapter, {
        renterId: ctx.renterId,
        // Keyed on the renter alone: a number is greeted once, ever.
        purpose: WELCOME_PURPOSE,
        body: renderWelcome(),
      });
      return { performed: action.kind, messageId: result.message.id };
    }

    if (action.kind === 'SEARCH_PICK') {
      // Re-read, as a re-request does: a listing can go between the results
      // and the reply, and a link to a dead page is not an answer.
      const { data: found } = await db
        .from('external_properties').select('id, title, is_active').in('id', action.listingIds);
      const live = action.listingIds
        .map(id => ((found ?? []) as { id: string; title: string | null; is_active: boolean }[]).find(f => f.id === id))
        .filter((f): f is { id: string; title: string | null; is_active: boolean } => !!f && f.is_active !== false);
      const result = await sendFreeForm(store, adapter, {
        renterId: ctx.renterId,
        requestId: ctx.requestId,
        purpose: `SEARCH_PICK:${ctx.providerMessageId}`,
        body: live.length > 0 ? renderRequestOnSite({ places: live.map(pageOf) }) : renderSelectionProblem('EXPIRED'),
      });
      return { performed: live.length > 0 ? action.kind : 'SELECTION_PROBLEM', messageId: result.message.id };
    }

    if (action.kind === 'WATCH_CONFIRMED') {
      const result = await sendFreeForm(store, adapter, {
        renterId: ctx.renterId,
        // Keyed on the watch, so a second send of the same code - a double tap,
        // a redelivery - is answered once.
        purpose: `WATCH_CONFIRMED:${action.watchId}`,
        body: action.inquiry
          ? renderInquiryConfirmed({ ...action.inquiry, watchExpiresAt: action.expiresAt })
          : renderWatchConfirmed(action),
      });
      // On a request, the confirmation opens the concierge's thread - and being
      // on it is what routes the renter's next message there (concierge.ts).
      if (action.inquiry && !result.deduplicated) {
        await recordInquiryMessage(db, {
          inquiryId: action.inquiry.id, direction: 'outbound', source: 'system',
          whatsappMessageId: result.message.id, body: result.message.body ?? '', now: new Date(),
        });
      }
      return { performed: action.kind, messageId: result.message.id };
    }

    if (action.kind === 'WATCH_PROBLEM') {
      const result = await sendFreeForm(store, adapter, {
        renterId: ctx.renterId,
        purpose: `WATCH_PROBLEM:${ctx.providerMessageId}`,
        body: renderWatchProblem(action.problem),
      });
      return { performed: action.kind, messageId: result.message.id };
    }

    if (action.kind === 'ALERT_DETAILS') {
      const items = await alertItemsFor(db, action.alertMessageId);
      const result = await sendFreeForm(store, adapter, {
        renterId: ctx.renterId,
        // Keyed on the alert: the places go once, however many times the
        // renter answers it.
        purpose: `ALERT_DETAILS:${action.alertMessageId}`,
        body: renderAlertDetails(items),
      });
      await markAlertDetailed(db, action.alertMessageId, new Date());
      return { performed: action.kind, messageId: result.message.id };
    }

    if (action.kind === 'ACCOUNT_LINKED') {
      const result = await sendFreeForm(store, adapter, {
        renterId: ctx.renterId,
        purpose: `ACCOUNT_LINKED:${ctx.providerMessageId}`,
        body: renderLinkOutcome(action.link),
      });
      return { performed: action.kind, messageId: result.message.id };
    }

    if (action.kind === 'LOCK_IN_LINK') {
      const result = await sendFreeForm(store, adapter, {
        renterId: ctx.renterId,
        requestId: ctx.requestId,
        // Keyed on the inbound message: one answer per "yes", however often
        // Meta redelivers it.
        purpose: `LOCK_IN_LINK:${ctx.providerMessageId}`,
        body: renderLockInReply({ siteUrl: SITE_URL, ...action.lockIn }),
      });
      return { performed: action.kind, messageId: result.message.id };
    }

    if (action.kind === 'REQUEST_RECEIVED') {
      const r = action.received;
      const result = await sendFreeForm(store, adapter, {
        renterId: ctx.renterId,
        requestId: r.requestId,
        // Keyed on the request: one receipt however often the renter sends
        // the link's message, or Meta redelivers it. An acknowledgement, so it
        // does not count towards three in a row (send.ts).
        purpose: 'REQUEST_RECEIVED',
        body: renderRequestReceived({ ref: r.ref, titles: r.titles, siteUrl: SITE_URL }),
      });
      // Something the renter heard that was not the plan: it moves the
      // silence clock and nothing else (SPEC §9).
      if (!result.deduplicated && result.message.status !== 'FAILED') {
        await db.from('events').insert({
          request_id: r.requestId, type: 'HOLDING_UPDATE_SENT',
          payload: { message_id: result.message.id, purpose: 'REQUEST_RECEIVED' }, actor: 'SYSTEM',
        });
      }
      return { performed: action.kind, messageId: result.message.id, ref: r.ref };
    }

    // SEARCH is performed by viewing-agent-search, which owns the model call,
    // the budget guard and the usage logging. Duplicating any of that here to
    // save an HTTP hop would mean two places that can spend money.
    return { performed: 'NONE', error: 'SEARCH is dispatched by the caller' };
  } catch (e) {
    if (e instanceof ServiceWindowClosedError) return { performed: action.kind, error: 'service_window_closed' };
    if (e instanceof ConsecutiveMessageError) return { performed: action.kind, error: 'too_many_consecutive' };
    return { performed: action.kind, error: (e as Error).message };
  }
}

/**
 * May a pick from suggestions become a request from WhatsApp, and on which
 * times? The questions `viewing-request-create` asks at submit, asked again
 * here - before 2026-10-13 a reply of "2" skipped every one of them, which was
 * harmless only while VIEWING_AGENT_ENABLED was off.
 *
 * - a signed-in account behind the number, which plans lock in to;
 * - no request already being worked (intake.ts `pickBlocking`);
 * - `requestGate`: the Pass, or the number's one free place;
 * - times still offerable (MIN_LEAD_DAYS) - the request picked from has them,
 *   but it failed, usually because they went by.
 *
 * Any no sends them to the pages instead, where the modal asks each question
 * properly. `reason` is null where the page explains itself.
 */
async function reRequestVerdict(
  db: Supa,
  renterId: string,
  placeCount: number,
  priorAvailability: unknown,
  now: Date,
): Promise<{ go: true; availability: AvailabilityWindow[] } | { go: false; reason: string | null }> {
  const { data: renter } = await db.from('renters').select('user_id, phone_e164').eq('id', renterId).maybeSingle();
  if (!renter?.user_id) return { go: false, reason: null };

  const today = hcmcDate(now);
  const [{ blocking }, lapsed, hasPass, freeViewing] = await Promise.all([
    findOpenRequests(db, renter.user_id, today, now),
    countLapsedPlans(db, renter.user_id),
    hasPassCover(db, renter.user_id),
    freeViewingAvailable(db, renter.phone_e164),
  ]);
  if (blocking) return { go: false, reason: oneOpenRequestMessage(blocking.ref) };

  const gate = requestGate({ hasPass, placeCount, joining: false, freeViewingAvailable: freeViewing, lapsedPlans: lapsed });
  if (!gate.ok) return { go: false, reason: requestGateMessage(gate.reason, PASS_PRICE_USD, PASS_DAYS) };

  // The times still ahead, past the lead the operator needs; then the same
  // check intake makes, so nothing reaches the log that intake would refuse.
  const earliest = addDays(today, MIN_LEAD_DAYS);
  const ahead = (Array.isArray(priorAvailability) ? priorAvailability as AvailabilityWindow[] : [])
    .filter(w => typeof w?.date === 'string' && w.date >= earliest);
  const times = validateAvailability(ahead, today);
  if (!times.ok) return { go: false, reason: 'The times on your last request have gone by, so these need new ones.' };

  return { go: true, availability: times.value! };
}

/**
 * A new request from listings the renter picked out of a suggestion.
 *
 * A NEW request, not items appended to the old one. The request they picked
 * from is finished - failed, or confirmed - and adding items to it after its
 * outcome would corrupt a state the reducer has already derived.
 *
 * The listings are screened again with the same gate intake uses. They passed
 * it when they were suggested, but that was a message ago and verification runs
 * every twenty minutes. And the renter is gated as intake gates them
 * (`reRequestVerdict`).
 */
async function createReRequest(
  db: Supa,
  adapter: WhatsAppAdapter,
  listingIds: string[],
  ctx: { renterId: string; requestId?: string; providerMessageId: string; now?: Date },
): Promise<ActResult> {
  const { data: found } = await db.from('external_properties').select(CANDIDATE_COLUMNS).in('id', listingIds);
  const { eligible } = screenCandidates(listingIds, (found ?? []) as ShortlistCandidate[]);

  if (eligible.length === 0) {
    // Everything they picked went in the time between our message and their
    // reply. Telling them so is the honest answer; silently doing nothing is not.
    const store = new SupabaseMessageStore(db);
    const result = await sendFreeForm(store, adapter, {
      renterId: ctx.renterId,
      requestId: ctx.requestId,
      purpose: `AGENT_SELECTION_PROBLEM:${ctx.providerMessageId}`,
      body: renderSelectionProblem('EXPIRED'),
    });
    return { performed: 'SELECTION_PROBLEM', messageId: result.message.id };
  }

  // Carry the availability forward from the request they were picking against,
  // so they are not asked the same question twice - as far as it still holds.
  let prior: unknown = [];
  if (ctx.requestId) {
    const { data } = await db
      .from('viewing_requests').select('availability').eq('id', ctx.requestId).maybeSingle();
    prior = data?.availability ?? [];
  }
  const verdict = await reRequestVerdict(db, ctx.renterId, eligible.length, prior, ctx.now ?? new Date());
  if (!verdict.go) {
    const store = new SupabaseMessageStore(db);
    const result = await sendFreeForm(store, adapter, {
      renterId: ctx.renterId,
      requestId: ctx.requestId,
      purpose: `AGENT_RE_REQUEST_ON_SITE:${ctx.providerMessageId}`,
      body: renderRequestOnSite({ reason: verdict.reason ?? undefined, places: eligible.map(pageOf) }),
    });
    return { performed: 'RE_REQUEST', messageId: result.message.id, onSite: verdict.reason ?? 'not signed in' };
  }
  const availability = verdict.availability;

  let request: { id: string; ref: string } | null = null;
  for (let attempt = 0; attempt < 5 && !request; attempt++) {
    const { data, error } = await db
      .from('viewing_requests')
      .insert({ ref: generateRef(), renter_id: ctx.renterId, availability })
      .select('id, ref')
      .single();
    if (!error) { request = data; break; }
    if (error.code !== '23505') return { performed: 'RE_REQUEST', error: error.message };
  }
  if (!request) return { performed: 'RE_REQUEST', error: 'ref_collision' };

  const { data: items, error: itemsErr } = await db
    .from('request_items')
    .insert(eligible.map((c, i) => ({
      request_id: request!.id,
      listing_id: c.id,
      realtor_id: c.realtor_id,
      price_vnd_at_request: c.price_vnd,
      sort_order: i,
    })))
    .select('id, listing_id, realtor_id, price_vnd_at_request');

  if (itemsErr || !items) {
    await db.from('viewing_requests').delete().eq('id', request.id);
    return { performed: 'RE_REQUEST', error: itemsErr?.message ?? 'items_failed' };
  }

  const { error: evErr } = await db.from('events').insert(intakeEvents({
    requestId: request.id,
    availability,
    items: items.map((i: Record<string, unknown>) => ({
      itemId: String(i.id),
      listingId: String(i.listing_id),
      priceVndAtRequest: Number(i.price_vnd_at_request),
      realtorId: (i.realtor_id as string) ?? null,
    })),
  }));
  if (evErr) {
    // A request whose rows exist but whose log does not has no state at all,
    // since state is derived. Better to have neither.
    await db.from('viewing_requests').delete().eq('id', request.id);
    return { performed: 'RE_REQUEST', error: evErr.message };
  }

  const store = new SupabaseMessageStore(db);
  const result = await sendFreeForm(store, adapter, {
    renterId: ctx.renterId,
    requestId: request.id,
    purpose: `AGENT_RE_REQUEST:${ctx.providerMessageId}`,
    body: renderReRequested({ ref: request.ref, titles: eligible.map(c => c.title ?? 'A place') }),
  });

  return {
    performed: 'RE_REQUEST',
    messageId: result.message.id,
    newRequestId: request.id,
    ref: request.ref,
  };
}
