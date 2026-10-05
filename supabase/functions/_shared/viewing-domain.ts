// The viewing-coordination domain: event types, derived states, and the reducer
// that turns one into the other (SPEC §2-§3).
//
// This is the single source for these enums and for state. It lives under
// `_shared` rather than in `src/` because edge functions cannot reliably import
// across the SPA boundary at deploy time, and the functions are the writers.
// The file is pure TypeScript with no Deno APIs, so vitest runs it directly.

// ── Event types (SPEC §3) ───────────────────────────────────────────────────
export const EVENT_TYPES = [
  'REQUEST_SUBMITTED',
  'ITEM_ADDED',
  'REALTOR_RESOLVED',
  'REALTOR_CONTACTED',
  'OUTCOME_RECORDED',
  'ITEM_NUDGED',
  'ITINERARY_ASSEMBLED',
  'ITINERARY_DELIVERED',
  // The plan was ready but the renter's 24-hour window had shut, so an
  // approved template told them it was ready and asked them to reply. The plan
  // waits on the view (heldItinerary) and goes out free-form on their next
  // message (deliver.ts releaseHeldItinerary). Moves no state: nothing has
  // been put in front of them that they could say yes to.
  'ITINERARY_HELD',
  // Something the renter heard that was not the itinerary. It moves the
  // silence clock (S6's 24h promise) and nothing else - typing a holding
  // update as ITINERARY_DELIVERED would make the queue think the request was
  // finished.
  'HOLDING_UPDATE_SENT',
  // Listings we put in front of the renter, in the order shown. What a reply
  // of "2" resolves against - see selection.ts.
  'SUGGESTIONS_OFFERED',
  'RENTER_REPLIED',
  // An operator answered the renter in free text (a question, a new time).
  // Moves the silence clock like a holding update and clears the replies
  // waiting on a person - see thread.ts. No state change.
  'REPLY_SENT',
  // An operator read the renter's replies and decided none needs an answer
  // ("thanks!"). Clears the wait without spending a billed send.
  'REPLIES_ACKNOWLEDGED',
  // The broker was told the renter's decision: CONFIRM (the viewing is on) or
  // RELEASE (stop holding the slot). Owed once per item after the request
  // closes - see reminders.ts. Moves no state; the item's outcome stands.
  'REALTOR_NOTIFIED',
  // Where to meet, the agent's first name, and whether the agent agreed to
  // their number going to the renter on the day (viewing-day.ts). Per item;
  // the latest stands. Moves no state.
  'VIEWING_DETAILS_RECORDED',
  // The viewing-day message went out, for one Ho Chi Minh City date. Moves no
  // state; the scheduler reads it so a day is sent once.
  'VIEWING_DAY_SENT',
  // A Polar checkout for the Pass was opened from the lock-in page (the
  // pricing rework, SPEC §9). Moves no state. A checkout opened before the
  // lock-in deadline is honoured even if it completes after it, so the
  // deadline waits for it to close rather than cancel under a renter who is
  // paying (lock-in.ts `lockInLapsed`).
  'LOCK_IN_CHECKOUT_OPENED',
  'REQUEST_CONFIRMED',
  'REQUEST_CANCELLED',
  'REQUEST_FAILED',
] as const;
export type EventType = typeof EVENT_TYPES[number];

// ── Ops outcomes (SPEC §4) ──────────────────────────────────────────────────
// Exactly seven. An operator picks one; free text goes in `note` and never
// touches state. This is the constraint that makes the corpus worth having.
export const OUTCOMES = [
  'CONFIRMED',
  'ALTERNATIVE_OFFERED',
  'UNAVAILABLE_DATE',
  'ALREADY_RENTED',
  'PRICE_CHANGED',
  'NO_RESPONSE',
  'UNREACHABLE',
] as const;
export type Outcome = typeof OUTCOMES[number];

export const ITEM_STATES = [
  'PENDING',
  'CONTACTED',
  'CONFIRMED',
  'ALTERNATIVE_OFFERED',
  'UNAVAILABLE',
  'ALREADY_RENTED',
  'PRICE_CHANGED',
  'NO_RESPONSE',
  'UNREACHABLE',
] as const;
export type ItemState = typeof ITEM_STATES[number];

/**
 * Why a request was cancelled (REQUEST_CANCELLED). A closed set for the same
 * reason outcomes are: "why do requests die" is a question the log should be
 * able to answer by counting, and free text in `note` cannot be counted.
 */
export const CANCEL_REASONS = [
  'RENTER_DECLINED',       // said no to the plan, or pulled out
  'RENTER_FOUND_PLACE',    // no longer looking
  'RENTER_UNRESPONSIVE',   // never answered the itinerary
  'DUPLICATE',             // the same request filed twice
  'NOT_LOCKED_IN',         // the lock-in deadline passed with the plan not locked in (SPEC §9)
  'OTHER',
] as const;
export type CancelReason = typeof CANCEL_REASONS[number];

/**
 * How a locked-in plan was paid for (`REQUEST_CONFIRMED.cover`). The Pass
 * covers every stop; the free viewing covers one, once per WhatsApp number.
 * A confirmation from before the pricing rework carries no cover.
 */
export const COVERS = ['PASS', 'FREE_VIEWING'] as const;
export type Cover = typeof COVERS[number];

/** What a broker is told once the renter has decided (REALTOR_NOTIFIED). */
export const REALTOR_DECISIONS = ['CONFIRM', 'RELEASE'] as const;
export type RealtorDecision = typeof REALTOR_DECISIONS[number];

export const REQUEST_STATES = [
  'DRAFT',
  'SUBMITTED',
  'CONTACTING',
  'ASSEMBLING',
  'DELIVERED',
  'CONFIRMED',
  'FAILED_NO_SUPPLY',
  'CANCELLED',
] as const;
export type RequestState = typeof REQUEST_STATES[number];

/**
 * A complex watch (`complex_watches.status`, SPEC §11). Not a request and not
 * in the event log: nothing about it is an operator's decision, and its only
 * transitions are the renter sending the code and the renter saying STOP.
 */
export const WATCH_STATUSES = ['PENDING', 'ACTIVE', 'CANCELLED'] as const;
export type WatchStatus = typeof WATCH_STATUSES[number];

/**
 * Where a concierge availability request is answered
 * (`complex_inquiries.channel`, SPEC §11).
 */
export const INQUIRY_CHANNELS = ['WHATSAPP', 'EMAIL'] as const;
export type InquiryChannel = typeof INQUIRY_CHANNELS[number];

/**
 * How an agent came to be on a building's roster (`complex_agents.source`,
 * PLAN-v3 S7.0). LISTING is derived from their listings there and never stored;
 * the other two are what an operator adds - an agent met in the building's
 * groups, or the management company's leasing desk.
 */
export const BUILDING_AGENT_SOURCES = ['LISTING', 'MANUAL', 'MANAGEMENT'] as const;
export type BuildingAgentSource = typeof BUILDING_AGENT_SOURCES[number];

/** Why a listing was put in front of a renter unasked (`alert_items.source`). */
export const ALERT_SOURCES = ['WATCH', 'DIGEST'] as const;
export type AlertSource = typeof ALERT_SOURCES[number];

// An outcome names the state its item lands in. Kept as a map rather than a
// switch so adding an outcome without deciding its state is a type error.
const OUTCOME_TO_ITEM_STATE: Record<Outcome, ItemState> = {
  CONFIRMED: 'CONFIRMED',
  ALTERNATIVE_OFFERED: 'ALTERNATIVE_OFFERED',
  UNAVAILABLE_DATE: 'UNAVAILABLE',
  ALREADY_RENTED: 'ALREADY_RENTED',
  PRICE_CHANGED: 'PRICE_CHANGED',
  NO_RESPONSE: 'NO_RESPONSE',
  UNREACHABLE: 'UNREACHABLE',
};

// An item that has reached one of these is done; later process events about it
// are stale and must not move it back. This is what makes out-of-order arrival
// harmless rather than corrupting.
const TERMINAL_ITEM_STATES = new Set<ItemState>([
  'CONFIRMED',
  'ALTERNATIVE_OFFERED',
  'UNAVAILABLE',
  'ALREADY_RENTED',
  'PRICE_CHANGED',
  'NO_RESPONSE',
  'UNREACHABLE',
]);

export interface DomainEvent {
  id: number;
  request_id: string;
  item_id?: string | null;
  type: string;
  payload?: Record<string, unknown> | null;
  actor: string;
  occurred_at: string;
}

export interface ItemView {
  itemId: string;
  state: ItemState;
  outcome?: Outcome;
  slots: unknown[];
  actualPriceVnd?: number;
  nudges: number;
  realtorId?: string;
  /** Set once the broker has been told the renter's decision. */
  notified?: RealtorDecision;
  /** How the renter finds the viewing on the day (VIEWING_DETAILS_RECORDED). */
  details?: ViewingDetails;
}

/**
 * What the viewing-day message needs from the agent, recorded by an operator.
 * `sharePhone` is the agent's consent, not a preference of ours: without it the
 * renter reaches the agent through us (CLAUDE.md invariant 4).
 */
export interface ViewingDetails {
  meetingPoint: string;
  agentFirstName: string | null;
  sharePhone: boolean;
}

export interface RequestView {
  requestId: string;
  state: RequestState;
  items: Record<string, ItemView>;
  itineraryOrder: string[];
  deliveredMessageId?: string;
  /**
   * An itinerary waiting on the renter's reply, because their window was shut
   * when it was sent (ITINERARY_HELD). Cleared once one is delivered.
   */
  heldItinerary?: { messageId: string; orderedItemIds: string[] };
  confirmedItemIds: string[];
  /** How the lock-in was paid for. Absent on confirmations from before it was recorded. */
  confirmedCover?: Cover;
  /**
   * When the plan first reached the renter, held behind a template or in full
   * - the lock-in deadline runs from here (lock-in.ts).
   */
  planArrivedAt?: string;
  /** When the plan itself was last delivered, free-form. */
  lastDeliveredAt?: string;
  /** Pass checkouts opened from the lock-in page, oldest first. */
  checkouts: { checkoutId: string; openedAt: string; expiresAt: string }[];
  failureReason?: string;
  substituteListingIds: string[];
  cancelledReason?: string;
  /** Ho Chi Minh City dates whose viewing-day message has gone out. */
  viewingDaysSent: string[];
}

/**
 * Replay order: `occurred_at`, then `id`.
 *
 * The tiebreak is not decoration. Several events are written in one
 * transaction and share a timestamp to the microsecond, and without a stable
 * second key the same log could reduce two ways on two reads.
 */
export function sortEvents(events: DomainEvent[]): DomainEvent[] {
  return [...events].sort((a, b) => {
    if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? -1 : 1;
    return a.id - b.id;
  });
}

function emptyItem(itemId: string): ItemView {
  return { itemId, state: 'PENDING', slots: [], nudges: 0 };
}

/**
 * `(events) => state`. Pure: no clock, no I/O. A rule that needs the current
 * time takes it as an argument rather than reading one.
 *
 * Two properties the tests hold it to:
 *
 *  - Unknown event types are ignored, never thrown on. A newer writer must not
 *    break an older reader in the window between deploys.
 *  - Out-of-order arrival cannot corrupt state. A REALTOR_CONTACTED that lands
 *    after its OUTCOME_RECORDED is dropped, not applied - so forwards,
 *    backwards and shuffled all reduce to the same terminal state.
 */
export function reduceRequest(requestId: string, events: DomainEvent[]): RequestView {
  const view: RequestView = {
    requestId,
    state: 'DRAFT',
    items: {},
    itineraryOrder: [],
    confirmedItemIds: [],
    substituteListingIds: [],
    viewingDaysSent: [],
    checkouts: [],
  };

  const item = (id: string): ItemView => {
    if (!view.items[id]) view.items[id] = emptyItem(id);
    return view.items[id];
  };

  for (const e of sortEvents(events)) {
    const p = (e.payload ?? {}) as Record<string, unknown>;

    switch (e.type as EventType) {
      case 'REQUEST_SUBMITTED':
        if (view.state === 'DRAFT') view.state = 'SUBMITTED';
        break;

      case 'ITEM_ADDED':
        if (!e.item_id) break;
        item(e.item_id);
        // A place can join a request after it opened (intake.ts pickJoinable).
        // Intake refuses once assembly has begun, but an operator can assemble
        // between that check and this write - and then the order on file does
        // not include a place that still has an agent to ask. Back to
        // CONTACTING, so the request reads as unfinished until it is
        // re-assembled. Delivered and later are left alone: the renter has
        // their plan, and intake never joins those.
        if (view.state === 'ASSEMBLING') view.state = 'CONTACTING';
        break;

      case 'REALTOR_RESOLVED':
        if (e.item_id && typeof p.realtor_id === 'string') item(e.item_id).realtorId = p.realtor_id;
        break;

      case 'REALTOR_CONTACTED': {
        if (!e.item_id) break;
        const it = item(e.item_id);
        // Stale: this item already has an outcome. Applying it would walk a
        // finished item back to CONTACTED.
        if (TERMINAL_ITEM_STATES.has(it.state)) break;
        it.state = 'CONTACTED';
        if (view.state === 'SUBMITTED') view.state = 'CONTACTING';
        break;
      }

      case 'ITEM_NUDGED':
        if (e.item_id) item(e.item_id).nudges += 1;
        break;

      case 'OUTCOME_RECORDED': {
        if (!e.item_id) break;
        const outcome = p.outcome as Outcome | undefined;
        if (!outcome || !(outcome in OUTCOME_TO_ITEM_STATE)) break;
        const it = item(e.item_id);
        it.outcome = outcome;
        it.state = OUTCOME_TO_ITEM_STATE[outcome];
        it.slots = Array.isArray(p.slots) ? p.slots : [];
        if (typeof p.actual_price_vnd === 'number') it.actualPriceVnd = p.actual_price_vnd;
        if (view.state === 'SUBMITTED' || view.state === 'DRAFT') view.state = 'CONTACTING';
        break;
      }

      case 'ITINERARY_ASSEMBLED':
        view.itineraryOrder = Array.isArray(p.ordered_item_ids) ? p.ordered_item_ids as string[] : [];
        // Assembly cannot pull a request back from a state that follows it.
        if (view.state === 'SUBMITTED' || view.state === 'CONTACTING') view.state = 'ASSEMBLING';
        break;

      case 'ITINERARY_HELD':
        // A held plan behind a delivered one is history: the renter has the
        // plan, and releasing it again would send it twice.
        if (view.deliveredMessageId || typeof p.message_id !== 'string') break;
        // Earliest wins whatever order the log arrives in: sortEvents has put
        // it first by now, and a later one never moves it.
        view.planArrivedAt ??= e.occurred_at;
        view.heldItinerary = {
          messageId: p.message_id,
          orderedItemIds: Array.isArray(p.ordered_item_ids) ? p.ordered_item_ids as string[] : [],
        };
        break;

      case 'ITINERARY_DELIVERED':
        if (typeof p.message_id === 'string') view.deliveredMessageId = p.message_id;
        delete view.heldItinerary;
        view.planArrivedAt ??= e.occurred_at;
        view.lastDeliveredAt = e.occurred_at;
        if (view.state !== 'CONFIRMED' && view.state !== 'CANCELLED' && view.state !== 'FAILED_NO_SUPPLY') {
          view.state = 'DELIVERED';
        }
        break;

      case 'RENTER_REPLIED':
        // Intent classification drives later events; the reply alone moves
        // nothing, which is why there is no state change here.
        break;

      case 'SUGGESTIONS_OFFERED':
        // Read by the selection path, invisible to state: offering
        // alternatives is not progress on the request that failed.
        break;

      case 'REALTOR_NOTIFIED': {
        // Bookkeeping about the broker, not progress on the item: a confirmed
        // viewing is still CONFIRMED after we tell the broker so. Kept on the
        // view because the scheduler needs to know it is no longer owed.
        if (!e.item_id) break;
        const decision = p.decision as RealtorDecision | undefined;
        if (decision && (REALTOR_DECISIONS as readonly string[]).includes(decision)) {
          item(e.item_id).notified = decision;
        }
        break;
      }

      case 'VIEWING_DETAILS_RECORDED': {
        // Logistics, not progress: a meeting point moves no item. Kept whatever
        // the item's state, so the log reduces the same in any order; whether
        // the details are ever used is decided where they are read.
        if (!e.item_id || typeof p.meeting_point !== 'string' || !p.meeting_point) break;
        item(e.item_id).details = {
          meetingPoint: p.meeting_point,
          agentFirstName: typeof p.agent_first_name === 'string' && p.agent_first_name ? p.agent_first_name : null,
          sharePhone: p.share_phone === true,
        };
        break;
      }

      case 'VIEWING_DAY_SENT':
        if (typeof p.date === 'string' && !view.viewingDaysSent.includes(p.date)) view.viewingDaysSent.push(p.date);
        break;

      case 'REPLY_SENT':
      case 'REPLIES_ACKNOWLEDGED':
        // Read by thread.ts and the silence clock. An operator answering a
        // question is conversation, not coordination.
        break;

      case 'HOLDING_UPDATE_SENT':
        // Read by the silence watch, deliberately invisible to state: telling
        // a renter we are still working is not progress, and a request that
        // could be kept alive by saying so would never look stuck.
        break;

      case 'LOCK_IN_CHECKOUT_OPENED':
        // Bookkeeping for the deadline, not progress: opening a checkout is
        // not paying. One entry per checkout, however often it is logged.
        if (typeof p.checkout_id !== 'string' || typeof p.expires_at !== 'string') break;
        if (view.checkouts.some(c => c.checkoutId === p.checkout_id)) break;
        view.checkouts.push({ checkoutId: p.checkout_id, openedAt: e.occurred_at, expiresAt: p.expires_at });
        break;

      case 'REQUEST_CONFIRMED':
        view.confirmedItemIds = Array.isArray(p.confirmed_item_ids) ? p.confirmed_item_ids as string[] : [];
        if ((COVERS as readonly string[]).includes(p.cover as string)) view.confirmedCover = p.cover as Cover;
        if (view.state !== 'CANCELLED') view.state = 'CONFIRMED';
        break;

      case 'REQUEST_FAILED':
        view.failureReason = typeof p.reason === 'string' ? p.reason : undefined;
        view.substituteListingIds = Array.isArray(p.substitute_listing_ids) ? p.substitute_listing_ids as string[] : [];
        if (view.state !== 'CANCELLED' && view.state !== 'CONFIRMED') view.state = 'FAILED_NO_SUPPLY';
        break;

      case 'REQUEST_CANCELLED':
        // Cancellation wins over everything. A renter who pulled out did so
        // whatever else the log says.
        view.cancelledReason = typeof p.reason === 'string' ? p.reason : undefined;
        view.state = 'CANCELLED';
        break;

      default:
        // Unknown type from a newer writer. Ignored on purpose - see the
        // doc comment.
        break;
    }
  }

  return view;
}

/**
 * Partial success is the happy path (invariant 5). This is the shape every
 * caller should be reading: three of five confirmed is a normal result, not a
 * degraded one, and `FAILED_NO_SUPPLY` means zero.
 */
export function summarise(view: RequestView): {
  total: number;
  confirmed: number;
  unresolved: number;
  isPartial: boolean;
  hasNothing: boolean;
} {
  const items = Object.values(view.items);
  const confirmed = items.filter(i => i.state === 'CONFIRMED').length;
  const unresolved = items.filter(i => i.state === 'PENDING' || i.state === 'CONTACTED').length;
  return {
    total: items.length,
    confirmed,
    unresolved,
    isPartial: confirmed > 0 && confirmed < items.length,
    hasNothing: items.length > 0 && confirmed === 0 && unresolved === 0,
  };
}

// ── Availability requests (SPEC §11, PLAN-v3 S7.1) ──────────────────────────
//
// A request for a building is a sourcing job, and its state is derived here
// from `inquiry_events` the way a viewing request's is from `events`
// (invariant 1). The operator's steps are typed (invariant 2): who was asked,
// what they answered, why it closed. Free text goes in a `note` that nothing
// reads for state. Messages are the thread (`complex_inquiry_messages`), not
// events: what was said is not a state.

export const INQUIRY_EVENT_TYPES = [
  'SUBMITTED',      // the form (complex-inquiry-create); carries the reply promise for an area
  'CONFIRMED',      // the WhatsApp code arrived - the 24 hours start
  'AGENT_ASKED',    // an operator asked an agent about the building
  'AGENT_ANSWERED', // what that agent said, as one of AGENT_ANSWERS
  'UNIT_CAPTURED',  // an agent's offered unit, entered as a listing (S7.1b)
  'UNITS_OFFERED',  // the one message to the renter with the units in it
  'BRIEF_CHANGED',  // the renter said, in a message on the thread, what else they would take
  'CLOSED',         // with one of INQUIRY_CLOSE_REASONS
  'REOPENED',
] as const;
export type InquiryEventType = typeof INQUIRY_EVENT_TYPES[number];

export const INQUIRY_STATES = [
  'AWAITING_CODE', // the form was sent, the WhatsApp message was not
  'NEW',           // confirmed; nobody asked yet
  'SOURCING',      // agents being asked
  'OFFERED',       // units sent to the renter
  'CLOSED',
] as const;
export type InquiryState = typeof INQUIRY_STATES[number];

export const AGENT_ANSWERS = ['HAS_UNITS', 'NO_UNITS', 'NO_REPLY'] as const;
export type AgentAnswer = typeof AGENT_ANSWERS[number];

export const INQUIRY_CLOSE_REASONS = [
  'VIEWING_REQUESTED',  // the renter asked to see something we found
  'NOTHING_FOUND',
  'RENTER_WENT_QUIET',
  'RENTED_ELSEWHERE',
  'LEASE_SIGNED',       // the outcome agent-side referral fees would track
  'DUPLICATE',
  'OTHER',
] as const;
export type InquiryCloseReason = typeof INQUIRY_CLOSE_REASONS[number];

/** Media an agent can be asked on - REALTOR_MEDIA's by-hand subset. */
export const INQUIRY_ASK_MEDIA = ['ZALO', 'PHONE'] as const;
export type InquiryAskMedium = typeof INQUIRY_ASK_MEDIA[number];

export interface InquiryEvent {
  id: number;
  inquiry_id: string;
  type: string;
  payload?: Record<string, unknown> | null;
  actor: string;
  occurred_at: string;
}

export interface InquiryAgentView {
  realtorId: string;
  askedAt: string | null;
  medium: string | null;
  answer: AgentAnswer | null;
  answeredAt: string | null;
}

export interface InquiryView {
  inquiryId: string;
  state: InquiryState;
  confirmedAt: string | null;
  agents: Record<string, InquiryAgentView>;
  /** Listings entered from agents' offers, in capture order. */
  capturedListingIds: string[];
  /** Every listing put in front of the renter, and when the last offer went. */
  offeredListingIds: string[];
  offeredAt: string | null;
  /**
   * What the renter now says they would take, if they changed it on the
   * thread (BRIEF_CHANGED). Replaces the form's bedrooms and budget for what
   * may be offered; null means the form's still stand.
   */
  brief: InquiryBrief | null;
  closedReason: InquiryCloseReason | null;
  closedAt: string | null;
  /**
   * How long the renter was promised a reply in, from the code: 24 hours for
   * a building, 48 for an area (Search for me), as SUBMITTED recorded it.
   */
  replyWithinMs: number;
}

/**
 * What may be offered: bedroom counts (4 meaning 4 or more) and a monthly
 * budget in dong, null for none.
 */
export interface InquiryBrief {
  bedrooms: number[];
  budgetMaxVnd: number | null;
}

/** The promise the page and the confirmation make. */
export const INQUIRY_REPLY_WITHIN_MS = 24 * 60 * 60 * 1000;

/**
 * `(events) => state` for an availability request. Pure; ordered like
 * `sortEvents` - by `occurred_at`, then id - so events arriving out of order
 * reduce the same as in order.
 */
export function reduceInquiry(inquiryId: string, events: InquiryEvent[]): InquiryView {
  const view: InquiryView = {
    inquiryId, state: 'AWAITING_CODE', confirmedAt: null, agents: {}, capturedListingIds: [], offeredListingIds: [],
    offeredAt: null, brief: null, closedReason: null, closedAt: null, replyWithinMs: INQUIRY_REPLY_WITHIN_MS,
  };
  const agent = (id: string): InquiryAgentView =>
    (view.agents[id] ??= { realtorId: id, askedAt: null, medium: null, answer: null, answeredAt: null });

  const sorted = [...events].sort((a, b) =>
    a.occurred_at !== b.occurred_at ? (a.occurred_at < b.occurred_at ? -1 : 1) : a.id - b.id);

  for (const e of sorted) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const realtorId = typeof p.realtor_id === 'string' ? p.realtor_id : null;
    // Work moves a request forward, never back: asking another agent after
    // an offer went out does not un-offer it.
    const working = () => { if (view.state === 'AWAITING_CODE' || view.state === 'NEW') view.state = 'SOURCING'; };

    switch (e.type as InquiryEventType) {
      case 'SUBMITTED':
        if (typeof p.reply_within_hours === 'number' && p.reply_within_hours > 0) {
          view.replyWithinMs = p.reply_within_hours * 3_600_000;
        }
        break;
      case 'CONFIRMED':
        view.confirmedAt ??= e.occurred_at;
        if (view.state === 'AWAITING_CODE') view.state = 'NEW';
        break;
      case 'AGENT_ASKED':
        if (!realtorId) break;
        // The first ask counts: asking again is a nudge, not a new request.
        agent(realtorId).askedAt ??= e.occurred_at;
        agent(realtorId).medium ??= typeof p.medium === 'string' ? p.medium : null;
        working();
        break;
      case 'AGENT_ANSWERED': {
        if (!realtorId) break;
        const answer = p.answer as AgentAnswer;
        if (!(AGENT_ANSWERS as readonly string[]).includes(answer)) break;
        // The latest answer stands - "no units" then "one just came free".
        agent(realtorId).answer = answer;
        agent(realtorId).answeredAt = e.occurred_at;
        working();
        break;
      }
      case 'UNIT_CAPTURED': {
        const listingId = typeof p.listing_id === 'string' ? p.listing_id : null;
        if (!listingId) break;
        if (!view.capturedListingIds.includes(listingId)) view.capturedListingIds.push(listingId);
        if (realtorId) {
          // An agent whose unit was captured has units, whatever was recorded.
          agent(realtorId).answer ??= 'HAS_UNITS';
          agent(realtorId).answeredAt ??= e.occurred_at;
        }
        working();
        break;
      }
      case 'UNITS_OFFERED': {
        const ids = Array.isArray(p.listing_ids) ? p.listing_ids.filter((x): x is string => typeof x === 'string') : [];
        if (ids.length === 0) break;
        for (const id of ids) if (!view.offeredListingIds.includes(id)) view.offeredListingIds.push(id);
        view.offeredAt = e.occurred_at;
        if (view.state !== 'CLOSED') view.state = 'OFFERED';
        break;
      }
      case 'BRIEF_CHANGED': {
        // The latest stands - "3 bedrooms is fine" then "actually any size".
        // Moves no state: a wider brief is not progress.
        const beds = Array.isArray(p.bedrooms)
          ? [...new Set(p.bedrooms.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 4))].sort((a, b) => a - b)
          : [];
        if (beds.length === 0) break;
        const budget = p.budget_max_vnd;
        view.brief = {
          bedrooms: beds,
          budgetMaxVnd: typeof budget === 'number' && Number.isInteger(budget) && budget > 0 ? budget : null,
        };
        break;
      }
      case 'CLOSED': {
        const reason = p.reason as InquiryCloseReason;
        view.state = 'CLOSED';
        view.closedReason = (INQUIRY_CLOSE_REASONS as readonly string[]).includes(reason) ? reason : 'OTHER';
        view.closedAt = e.occurred_at;
        break;
      }
      case 'REOPENED':
        if (view.state !== 'CLOSED') break;
        view.closedReason = null;
        view.closedAt = null;
        view.state = view.offeredAt ? 'OFFERED'
          : Object.keys(view.agents).length > 0 || view.capturedListingIds.length > 0 ? 'SOURCING'
          : view.confirmedAt ? 'NEW' : 'AWAITING_CODE';
        break;
    }
  }
  return view;
}

/** When the renter was promised a reply by: 24 hours from the code, 48 for an area. */
export function inquiryDeadline(view: InquiryView): string | null {
  return view.confirmedAt ? new Date(Date.parse(view.confirmedAt) + view.replyWithinMs).toISOString() : null;
}
