// A viewing request as its renter sees it in the hub's Viewings tab, and what
// they may change about it there (2026-10-08).
//
// Reduced on the server and handed over as words, like the lock-in page's
// plan: `events` is not readable from a browser - it carries operator notes
// and agents' outcomes - and a client reducing half a log would show a state
// the system does not agree with. So this is the only place a request's
// derived state is put into renter language, and it carries no agent field
// of any kind (SPEC §6): no name, no number, no note, no message.
//
// Pure. The edge function `viewing-request-manage` reads the rows and the
// log; this decides what they say and what may be done.

import { HOLDING_TIME_STATES, type ItemState, type RequestView } from '../viewing-domain.ts';
import { formatVnd, hcmcLong } from './format.ts';
import { lockInDeadline } from './lock-in.ts';
import type { AvailabilityWindow } from './intake.ts';

/** Where one place stands, in the renter's terms. */
export type PlaceStatus =
  | 'ASKING'       // the agent is being asked
  | 'FREE'         // the agent confirmed a time at the renter's times
  | 'KEPT'         // in a plan the renter locked in
  | 'NOT_KEPT'     // confirmed, but left out of the plan the renter locked in
  | 'OTHER_TIMES'  // the agent offered other times
  | 'NOT_FREE'     // not at the renter's times, nothing else offered
  | 'RENTED'
  | 'NEW_PRICE'
  | 'NO_ANSWER'    // silent after chasing, or no working number
  | 'REMOVED';     // the renter took it out

/**
 * The hub, opened on the Viewings tab. Where a WhatsApp message sends a renter
 * to change their times (itinerary.ts renderOtherDays).
 */
export const VIEWINGS_PATH = '/hub?tab=viewings';

/** Where the request as a whole stands. */
export type RequestStage =
  | 'ASKING'       // agents being asked
  | 'NEW_TIMES'    // no agent can do their times; we asked them for other days
  | 'PLANNING'     // every agent answered; the plan is being put together
  | 'PLAN_READY'   // the plan is waiting behind a template for the renter's reply
  | 'PLAN_SENT'    // the plan is on WhatsApp, to lock in
  | 'LOCKED_IN'
  | 'DONE'         // locked in, and every viewing has started
  | 'NOTHING_FREE'
  | 'CANCELLED';

export interface RenterPlaceRow {
  itemId: string;
  listingId: string;
  title: string;
  imageUrl: string | null;
  districtCode: string | null;
  priceVndAtRequest: number;
}

export interface RenterPlace {
  itemId: string;
  listingId: string;
  title: string;
  imageUrl: string | null;
  districtCode: string | null;
  /** What it costs: the agent's new price where they named one. */
  priceVnd: number;
  status: PlaceStatus;
  /** One line, ready to show. */
  label: string;
  /** The confirmed time, for FREE and KEPT. */
  startsAt: string | null;
  /** Times the agent offered instead, for OTHER_TIMES. */
  offeredTimes: string[];
  canRemove: boolean;
}

export interface RenterRequest {
  ref: string;
  createdAt: string;
  availability: AvailabilityWindow[];
  stage: RequestStage;
  stageLabel: string;
  /** When the plan has to be locked in by, while it can be. */
  lockInBy: string | null;
  places: RenterPlace[];
  canChangeTimes: boolean;
  canCancel: boolean;
  /** Places can still join it (intake.ts pickJoinable). */
  canAdd: boolean;
}

/** Item states worth taking a place out for: the agent is asked, or holding time. */
const REMOVABLE = new Set<ItemState>(['PENDING', ...HOLDING_TIME_STATES]);

function slotStart(slots: unknown[]): string | null {
  const s = (slots[0] as { starts_at?: unknown } | undefined)?.starts_at;
  return typeof s === 'string' ? s : null;
}

function slotStarts(slots: unknown[]): string[] {
  return (slots as { starts_at?: unknown }[])
    .map(s => s?.starts_at)
    .filter((s): s is string => typeof s === 'string');
}

/**
 * May the renter still change this request at all? Up to the plan being
 * locked in; after that, while a viewing they kept is still ahead.
 */
export function stillOpen(view: RequestView, now: number): boolean {
  switch (view.state) {
    case 'SUBMITTED':
    case 'CONTACTING':
    case 'ASSEMBLING':
    case 'DELIVERED':
      return true;
    case 'CONFIRMED':
      return keptAhead(view, now).length > 0;
    default:
      return false;
  }
}

/** Kept places whose viewing has not started yet. */
function keptAhead(view: RequestView, now: number): string[] {
  return view.confirmedItemIds.filter(id => {
    const it = view.items[id];
    const at = it && it.state === 'CONFIRMED' ? slotStart(it.slots) : null;
    return !!at && Date.parse(at) > now;
  });
}

/**
 * New times, only before the plan is put together: agents are asked about the
 * renter's times, and a plan built from their answers is about those times.
 * After that, changing a time is a conversation on WhatsApp.
 */
export function canChangeTimes(view: RequestView): boolean {
  return (view.state === 'SUBMITTED' || view.state === 'CONTACTING')
    && !view.deliveredMessageId && !view.heldItinerary && view.itineraryOrder.length === 0;
}

/**
 * Take one place out. Never the last: a request with nothing in it is a
 * cancelled one, and saying so is clearer than an empty plan.
 */
export function canRemovePlace(view: RequestView, itemId: string, now: number): boolean {
  if (!stillOpen(view, now)) return false;
  const it = view.items[itemId];
  if (!it || !REMOVABLE.has(it.state)) return false;
  const at = slotStart(it.slots);
  if (at && Date.parse(at) <= now) return false;
  if (view.state === 'CONFIRMED') {
    const ahead = keptAhead(view, now);
    return ahead.includes(itemId) && ahead.length > 1;
  }
  const left = Object.values(view.items).filter(i => i.state !== 'WITHDRAWN' && i.itemId !== itemId);
  return left.length > 0;
}

function placeLabel(status: PlaceStatus, startsAt: string | null, offered: string[], priceVnd: number): string {
  switch (status) {
    case 'ASKING': return 'Asking the agent';
    case 'FREE': return startsAt ? `Free ${hcmcLong(startsAt)}` : 'Free at your times';
    case 'KEPT': return startsAt ? `Locked in for ${hcmcLong(startsAt)}` : 'Locked in';
    case 'NOT_KEPT': return 'Not in the plan you locked in';
    case 'OTHER_TIMES':
      return offered.length ? `The agent offered ${offered.map(hcmcLong).join(' or ')}` : 'The agent offered other times';
    case 'NOT_FREE': return 'Not free at your times';
    case 'RENTED': return 'Already rented';
    case 'NEW_PRICE': return `Still free, now ${formatVnd(priceVnd)} a month`;
    case 'NO_ANSWER': return 'The agent did not answer';
    case 'REMOVED': return 'Removed';
  }
}

function placeStatus(view: RequestView, itemId: string): PlaceStatus {
  const it = view.items[itemId];
  switch (it?.state) {
    case undefined:
    case 'PENDING':
    case 'CONTACTED':
      return 'ASKING';
    case 'CONFIRMED':
      if (view.state !== 'CONFIRMED') return 'FREE';
      return view.confirmedItemIds.includes(itemId) ? 'KEPT' : 'NOT_KEPT';
    case 'ALTERNATIVE_OFFERED': return 'OTHER_TIMES';
    case 'UNAVAILABLE': return 'NOT_FREE';
    case 'ALREADY_RENTED': return 'RENTED';
    case 'PRICE_CHANGED': return 'NEW_PRICE';
    case 'NO_RESPONSE':
    case 'UNREACHABLE':
      return 'NO_ANSWER';
    case 'WITHDRAWN': return 'REMOVED';
  }
}

function stageOf(view: RequestView, now: number): RequestStage {
  switch (view.state) {
    case 'DRAFT':
    case 'SUBMITTED':
    case 'CONTACTING':
      // Held behind a template, the renter has not read the question yet,
      // but the page can ask it: it is the same question.
      return view.otherDaysAsked ? 'NEW_TIMES' : 'ASKING';
    case 'ASSEMBLING':
      return view.heldItinerary ? 'PLAN_READY' : 'PLANNING';
    case 'DELIVERED': return 'PLAN_SENT';
    case 'CONFIRMED': return keptAhead(view, now).length > 0 ? 'LOCKED_IN' : 'DONE';
    case 'FAILED_NO_SUPPLY': return 'NOTHING_FREE';
    case 'CANCELLED': return 'CANCELLED';
  }
}

const STAGE_LABEL: Record<RequestStage, string> = {
  ASKING: 'Asking the agents - we message you on WhatsApp once they answer',
  NEW_TIMES: 'The agents cannot do these days - change your times and we will ask again',
  PLANNING: 'The agents have answered - your plan is coming on WhatsApp',
  PLAN_READY: 'Your plan is ready - reply to us on WhatsApp to see it',
  PLAN_SENT: 'Your plan is on WhatsApp',
  LOCKED_IN: 'Locked in',
  DONE: 'Done',
  NOTHING_FREE: 'Nothing was free at your times',
  CANCELLED: 'Cancelled',
};

export function renterRequestView(opts: {
  view: RequestView;
  ref: string;
  createdAt: string;
  availability: AvailabilityWindow[];
  rows: RenterPlaceRow[];
  canAdd: boolean;
  now: number;
}): RenterRequest {
  const { view, now } = opts;
  const stage = stageOf(view, now);
  const open = stillOpen(view, now);
  const places = opts.rows.map((r): RenterPlace => {
    const it = view.items[r.itemId];
    const status = placeStatus(view, r.itemId);
    const startsAt = status === 'FREE' || status === 'KEPT' ? slotStart(it?.slots ?? []) : null;
    const offered = status === 'OTHER_TIMES' ? slotStarts(it?.slots ?? []) : [];
    const priceVnd = it?.actualPriceVnd ?? r.priceVndAtRequest;
    return {
      itemId: r.itemId,
      listingId: r.listingId,
      title: r.title,
      imageUrl: r.imageUrl,
      districtCode: r.districtCode,
      priceVnd,
      status,
      label: placeLabel(status, startsAt, offered, priceVnd),
      startsAt,
      offeredTimes: offered,
      canRemove: canRemovePlace(view, r.itemId, now),
    };
  });
  // The plan's own order: what is happening first, then what is still being
  // asked, then the dead ends, and what the renter took out last.
  const rank: Record<PlaceStatus, number> = {
    KEPT: 0, FREE: 0, OTHER_TIMES: 1, ASKING: 2, NEW_PRICE: 3, NOT_KEPT: 4,
    NOT_FREE: 5, RENTED: 5, NO_ANSWER: 5, REMOVED: 6,
  };
  places.sort((a, b) => rank[a.status] - rank[b.status]
    || (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));

  const deadline = stage === 'PLAN_SENT' || stage === 'PLAN_READY' ? lockInDeadline(view) : null;
  return {
    ref: opts.ref,
    createdAt: opts.createdAt,
    availability: opts.availability,
    stage,
    stageLabel: stage === 'PLAN_SENT' && deadline
      ? `Your plan is on WhatsApp - lock it in by ${hcmcLong(deadline)}`
      : STAGE_LABEL[stage],
    lockInBy: deadline,
    places,
    canChangeTimes: canChangeTimes(view),
    canCancel: open,
    canAdd: open && opts.canAdd,
  };
}
