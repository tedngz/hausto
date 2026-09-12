// Assembling the itinerary, and rendering the one message that carries it.
//
// Two rules shape this file more than anything else.
//
// **Partial success is the happy path** (invariant 5). Three confirmed of five
// is the normal result, so nothing here treats a shortfall as an error state.
// The message leads with what the renter got, mentions what fell through in one
// line, and never apologises for a 3-of-5.
//
// **One message, not a sequence** (message-window rules). From 2026-10-01 Meta
// bills every service message, and a code path that sends three in a row to the
// same renter is a bug the send service refuses outright. So this returns a
// single string, however many stops it carries.
//
// Ops orders the stops by hand - route optimization is explicitly out of scope
// and they know the city. What this does is warn about the two orderings that
// are wrong regardless of local knowledge: overlaps, and a district hop with no
// time to make it.

import { formatVnd, hcmcLong, hcmcTime, hcmcDate } from './format.ts';
import type { RequestView } from '../viewing-domain.ts';

/** A listing, as the itinerary needs it. No realtor field - see §6 below. */
export interface StopListing {
  itemId: string;
  listingTitle: string;
  districtCode: string | null;
  /** What the renter was shown at intake. */
  priceVndAtRequest: number;
}

export interface ItineraryStop {
  itemId: string;
  listingTitle: string;
  districtCode: string | null;
  priceVnd: number;
  startsAt: string;
  durationMinutes: number;
}

export type WarningKind = 'OVERLAP' | 'DISTRICT_HOP' | 'UNKNOWN_DISTRICT';

export interface Warning {
  kind: WarningKind;
  message: string;
  itemIds: string[];
}

/**
 * Crossing Ho Chi Minh City between districts, allowed for in the gap between
 * two viewings. Not a route estimate - there are no coordinates on any active
 * listing (PLAN-v3 finding D) and this is not pretending otherwise. It is the
 * threshold below which the operator should look again.
 */
export const DISTRICT_HOP_MINUTES = 45;

interface Slot { starts_at: string; duration_minutes: number }

function firstSlot(slots: unknown[]): Slot | null {
  const s = slots[0] as Slot | undefined;
  if (!s || typeof s.starts_at !== 'string') return null;
  return { starts_at: s.starts_at, duration_minutes: Number(s.duration_minutes) || 30 };
}

export interface Assembled {
  stops: ItineraryStop[];
  warnings: Warning[];
  /** Items that were requested but are not in the itinerary, and why. */
  dropped: { itemId: string; state: string }[];
}

/**
 * Build the itinerary from the log and an ops-chosen order.
 *
 * Only CONFIRMED items become stops. A PRICE_CHANGED item has no slot by
 * construction (SPEC §4), so it cannot be one however much the renter might
 * still want it - re-offering it is a new request, not a line in this one.
 */
export function assembleItinerary(
  view: RequestView,
  listings: StopListing[],
  order: string[],
): Assembled {
  const byItem = new Map(listings.map(l => [l.itemId, l]));
  const stops: ItineraryStop[] = [];
  const dropped: { itemId: string; state: string }[] = [];

  // Ops order first, then any confirmed item ops did not place - appended
  // rather than dropped, because losing a confirmed viewing to a missing id is
  // the one failure the renter would actually be harmed by.
  const ordered = [...order, ...Object.keys(view.items).filter(id => !order.includes(id))];

  for (const itemId of ordered) {
    const item = view.items[itemId];
    if (!item) continue;
    if (item.state !== 'CONFIRMED') {
      dropped.push({ itemId, state: item.state });
      continue;
    }
    const slot = firstSlot(item.slots);
    const listing = byItem.get(itemId);
    if (!slot || !listing) {
      // A confirmed item with no usable slot is a data fault, not a viewing.
      // It is reported rather than silently rendered as "time to be confirmed".
      dropped.push({ itemId, state: 'CONFIRMED_NO_SLOT' });
      continue;
    }
    stops.push({
      itemId,
      listingTitle: listing.listingTitle,
      districtCode: listing.districtCode,
      // The price the broker actually quoted wins over the advertised one. This
      // is the whole reason `price_vnd_at_request` is stored: never quote a
      // figure the broker has already changed.
      priceVnd: item.actualPriceVnd ?? listing.priceVndAtRequest,
      startsAt: slot.starts_at,
      durationMinutes: slot.duration_minutes,
    });
  }

  return { stops, warnings: warningsFor(stops), dropped };
}

/**
 * What is wrong with this ordering, regardless of local knowledge.
 *
 * Computed against the order ops chose rather than the clock, because a stop
 * placed after one it starts before is the mistake worth catching.
 */
export function warningsFor(stops: ItineraryStop[]): Warning[] {
  const warnings: Warning[] = [];

  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const cur = stops[i];
    const prevEnd = Date.parse(prev.startsAt) + prev.durationMinutes * 60_000;
    const curStart = Date.parse(cur.startsAt);

    if (curStart < prevEnd) {
      warnings.push({
        kind: 'OVERLAP',
        message: `${cur.listingTitle} starts before ${prev.listingTitle} finishes.`,
        itemIds: [prev.itemId, cur.itemId],
      });
      continue;
    }

    // Same day only: a gap measured across a night is not a journey.
    if (hcmcDate(new Date(curStart)) !== hcmcDate(new Date(Date.parse(prev.startsAt)))) continue;

    const gapMinutes = (curStart - prevEnd) / 60_000;
    if (!prev.districtCode || !cur.districtCode) {
      warnings.push({
        kind: 'UNKNOWN_DISTRICT',
        message: `No district on ${!prev.districtCode ? prev.listingTitle : cur.listingTitle} - check the travel time by hand.`,
        itemIds: [prev.itemId, cur.itemId],
      });
    } else if (prev.districtCode !== cur.districtCode && gapMinutes < DISTRICT_HOP_MINUTES) {
      warnings.push({
        kind: 'DISTRICT_HOP',
        message: `${prev.districtCode} to ${cur.districtCode} with ${Math.round(gapMinutes)} minutes between.`,
        itemIds: [prev.itemId, cur.itemId],
      });
    }
  }

  return warnings;
}

// ── The message ─────────────────────────────────────────────────────────────

/**
 * The renter-facing DTO. There is no realtor field on it and there is not
 * meant to be: §6 says enforce privacy at the query layer, and a renderer that
 * cannot be handed a phone number cannot print one.
 */
export interface ItineraryMessage {
  ref: string;
  stops: ItineraryStop[];
  requestedCount: number;
}

/**
 * One message. Not a greeting then a list then a question.
 *
 * Vocabulary note: nothing here says "booked" or "confirmed with you". At
 * delivery the request is DELIVERED, not CONFIRMED - the renter has not agreed
 * to anything yet - and invariant 6 is explicit that booking language before
 * that is a promise we cannot honour.
 */
export function renderItinerary(m: ItineraryMessage): string {
  const lines: string[] = [];
  const n = m.stops.length;

  lines.push(
    n === m.requestedCount
      ? `All ${n} of the places you asked about are free to view. Here is the plan:`
      : `${n} of the ${m.requestedCount} places you asked about are free to view. Here is the plan:`,
  );
  lines.push('');

  let lastDate = '';
  m.stops.forEach((stop, i) => {
    const date = hcmcDate(new Date(Date.parse(stop.startsAt)));
    // The day is named once, then only the times - a renter scanning three
    // stops on one afternoon should not read the date three times.
    const when = date === lastDate ? hcmcTime(stop.startsAt) : hcmcLong(stop.startsAt);
    lastDate = date;
    lines.push(`${i + 1}. ${when} - ${stop.listingTitle}`);
    lines.push(`   ${formatVnd(stop.priceVnd)}/month${stop.districtCode ? ` - ${stop.districtCode}` : ''}`);
  });

  lines.push('');
  if (n < m.requestedCount) {
    // One line, no apology and no detail. Which broker said what is not the
    // renter's business, and a paragraph about it reads as an excuse.
    const missing = m.requestedCount - n;
    lines.push(`The other ${missing === 1 ? 'one is' : `${missing} are`} no longer available at the price advertised.`);
  }
  lines.push('Reply YES to lock these in, or tell us what to change.');
  lines.push(`Ref ${m.ref}`);

  return lines.join('\n');
}

/**
 * Nothing could be confirmed. Never sent on its own (invariant 5) - it carries
 * substitutes, because FAILED_NO_SUPPLY with no alternative is a dead end and
 * a dead end is not an outcome we make a renter read.
 */
export function renderNoSupply(opts: {
  ref: string;
  requestedCount: number;
  substitutes: { title: string; priceVnd: number; districtCode: string | null }[];
}): string {
  const lines: string[] = [
    `None of the ${opts.requestedCount} places you asked about are still free - the market here moves in days, not weeks.`,
  ];
  if (opts.substitutes.length > 0) {
    lines.push('');
    lines.push('These are close matches that are available now:');
    for (const s of opts.substitutes) {
      lines.push(`- ${s.title} - ${formatVnd(s.priceVnd)}/month${s.districtCode ? ` - ${s.districtCode}` : ''}`);
    }
    lines.push('');
    lines.push('Reply with a number and we will arrange those viewings.');
  } else {
    lines.push('');
    lines.push('We are looking for close matches and will come back to you today.');
  }
  lines.push(`Ref ${opts.ref}`);
  return lines.join('\n');
}
