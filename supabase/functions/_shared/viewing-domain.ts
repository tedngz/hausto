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
  'OTHER',
] as const;
export type CancelReason = typeof CANCEL_REASONS[number];

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
}

export interface RequestView {
  requestId: string;
  state: RequestState;
  items: Record<string, ItemView>;
  itineraryOrder: string[];
  deliveredMessageId?: string;
  confirmedItemIds: string[];
  failureReason?: string;
  substituteListingIds: string[];
  cancelledReason?: string;
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

      case 'ITINERARY_DELIVERED':
        if (typeof p.message_id === 'string') view.deliveredMessageId = p.message_id;
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

      case 'REQUEST_CONFIRMED':
        view.confirmedItemIds = Array.isArray(p.confirmed_item_ids) ? p.confirmed_item_ids as string[] : [];
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
  'SUBMITTED',      // the form (complex-inquiry-create)
  'CONFIRMED',      // the WhatsApp code arrived - the 24 hours start
  'AGENT_ASKED',    // an operator asked an agent about the building
  'AGENT_ANSWERED', // what that agent said, as one of AGENT_ANSWERS
  'CLOSED',         // with one of INQUIRY_CLOSE_REASONS
  'REOPENED',
] as const;
export type InquiryEventType = typeof INQUIRY_EVENT_TYPES[number];

export const INQUIRY_STATES = [
  'AWAITING_CODE', // the form was sent, the WhatsApp message was not
  'NEW',           // confirmed; nobody asked yet
  'SOURCING',      // agents being asked
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
  closedReason: InquiryCloseReason | null;
  closedAt: string | null;
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
    inquiryId, state: 'AWAITING_CODE', confirmedAt: null, agents: {}, closedReason: null, closedAt: null,
  };
  const agent = (id: string): InquiryAgentView =>
    (view.agents[id] ??= { realtorId: id, askedAt: null, medium: null, answer: null, answeredAt: null });

  const sorted = [...events].sort((a, b) =>
    a.occurred_at !== b.occurred_at ? (a.occurred_at < b.occurred_at ? -1 : 1) : a.id - b.id);

  for (const e of sorted) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const realtorId = typeof p.realtor_id === 'string' ? p.realtor_id : null;
    const working = () => { if (view.state !== 'CLOSED') view.state = 'SOURCING'; };

    switch (e.type as InquiryEventType) {
      case 'SUBMITTED':
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
        view.state = Object.keys(view.agents).length > 0 ? 'SOURCING' : view.confirmedAt ? 'NEW' : 'AWAITING_CODE';
        break;
    }
  }
  return view;
}

/** When the renter was promised a reply by: 24 hours from the code. */
export function inquiryDeadline(view: InquiryView): string | null {
  return view.confirmedAt ? new Date(Date.parse(view.confirmedAt) + INQUIRY_REPLY_WITHIN_MS).toISOString() : null;
}
