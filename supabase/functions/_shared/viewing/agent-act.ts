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
import { generateRef, intakeEvents, screenCandidates, type ShortlistCandidate } from './intake.ts';
import { renderSelectionProblem, renderReRequested } from './selection.ts';
import type { AgentAction } from './agent.ts';
import { renderAlertDetails, renderWatchConfirmed, renderWatchProblem } from './watch.ts';
import { alertItemsFor, markAlertDetailed } from './alerts.ts';
import { renderInquiryConfirmed } from './inquiry.ts';
import { recordInquiryMessage } from './concierge.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

const CANDIDATE_COLUMNS =
  'id, is_active, price_vnd, price_confidence, bedrooms, area_sqm, district_code, realtor_id, title';

export interface ActResult {
  performed: AgentAction['kind'];
  messageId?: string;
  newRequestId?: string;
  ref?: string;
  error?: string;
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
  ctx: { renterId: string; requestId?: string; providerMessageId: string },
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

    // SEARCH is performed by viewing-agent-search, which owns the OpenAI call,
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
 * A new request from listings the renter picked out of a suggestion.
 *
 * A NEW request, not items appended to the old one. The request they picked
 * from is finished - failed, or confirmed - and adding items to it after its
 * outcome would corrupt a state the reducer has already derived.
 *
 * The listings are screened again with the same gate intake uses. They passed
 * it when they were suggested, but that was a message ago and verification runs
 * every twenty minutes.
 */
async function createReRequest(
  db: Supa,
  adapter: WhatsAppAdapter,
  listingIds: string[],
  ctx: { renterId: string; requestId?: string; providerMessageId: string },
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
  // so they are not asked the same question twice.
  let availability: unknown = [];
  if (ctx.requestId) {
    const { data: prior } = await db
      .from('viewing_requests').select('availability').eq('id', ctx.requestId).maybeSingle();
    availability = prior?.availability ?? [];
  }

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
    availability: availability as { date: string; part: 'MORNING' | 'AFTERNOON' | 'EVENING' }[],
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
