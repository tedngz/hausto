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
  'RENTER_REPLIED',
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
        if (e.item_id) item(e.item_id);
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
