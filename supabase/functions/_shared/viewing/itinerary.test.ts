import { describe, it, expect } from 'vitest';
import {
  assembleItinerary,
  warningsFor,
  renderItinerary,
  renderNoSupply,
  DISTRICT_HOP_MINUTES,
  type ItineraryStop,
  type StopListing,
} from './itinerary.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';

let seq = 0;
const ev = (type: string, payload: Record<string, unknown> = {}, itemId?: string): DomainEvent => ({
  id: ++seq, request_id: 'r', item_id: itemId ?? null, type, payload, actor: 'SYSTEM',
  occurred_at: '2026-09-11T00:00:00.000Z',
});

const slot = (startsAt: string, duration = 30) => ({ starts_at: startsAt, duration_minutes: duration });

/** n items; `outcomes` maps item index (1-based) to an OUTCOME_RECORDED payload. */
function build(n: number, outcomes: Record<number, Record<string, unknown>> = {}) {
  seq = 0;
  const events = [ev('REQUEST_SUBMITTED')];
  const listings: StopListing[] = [];
  for (let i = 1; i <= n; i++) {
    events.push(ev('ITEM_ADDED', { listing_id: `l${i}`, price_vnd_at_request: 15_000_000 }, `i${i}`));
    listings.push({
      itemId: `i${i}`, listingTitle: `Flat ${i}`, districtCode: 'HCM-D1', priceVndAtRequest: 15_000_000,
    });
    if (outcomes[i]) events.push(ev('OUTCOME_RECORDED', outcomes[i], `i${i}`));
  }
  return { view: reduceRequest('r', events), listings };
}

const confirmed = (startsAt: string, duration = 30) => ({
  outcome: 'CONFIRMED', slots: [slot(startsAt, duration)],
});

describe('assembling', () => {
  it('turns the 3-of-5 partial result into three stops and two drops', () => {
    // The acceptance criterion for S6, and the shape invariant 5 calls normal.
    const { view, listings } = build(5, {
      1: confirmed('2026-09-15T02:00:00Z'),
      2: confirmed('2026-09-15T04:00:00Z'),
      3: confirmed('2026-09-15T07:00:00Z'),
      4: { outcome: 'ALREADY_RENTED', slots: [] },
      5: { outcome: 'UNREACHABLE', slots: [] },
    });
    const a = assembleItinerary(view, listings, ['i1', 'i2', 'i3']);
    expect(a.stops.map(s => s.itemId)).toEqual(['i1', 'i2', 'i3']);
    expect(a.dropped.map(d => d.state).sort()).toEqual(['ALREADY_RENTED', 'UNREACHABLE']);
    expect(a.warnings).toHaveLength(0);
  });

  it('honours the order ops chose, not the clock', () => {
    // Ops orders by hand and knows the city; a resort here would quietly
    // override them.
    const { view, listings } = build(2, {
      1: confirmed('2026-09-15T08:00:00Z'),
      2: confirmed('2026-09-15T02:00:00Z'),
    });
    const a = assembleItinerary(view, listings, ['i1', 'i2']);
    expect(a.stops.map(s => s.itemId)).toEqual(['i1', 'i2']);
    // ...and says the ordering is wrong rather than fixing it silently.
    expect(a.warnings[0].kind).toBe('OVERLAP');
  });

  it('appends a confirmed item ops forgot to place, rather than losing it', () => {
    const { view, listings } = build(2, {
      1: confirmed('2026-09-15T02:00:00Z'),
      2: confirmed('2026-09-15T06:00:00Z'),
    });
    const a = assembleItinerary(view, listings, ['i1']);
    expect(a.stops.map(s => s.itemId)).toEqual(['i1', 'i2']);
  });

  it('quotes the price the broker actually gave, not the advertised one', () => {
    // A PRICE_CHANGED item has no slot so it is not a stop - but a CONFIRMED
    // item can still carry a corrected price, and quoting the old one is the
    // mistake `price_vnd_at_request` exists to make visible.
    const { view, listings } = build(1, {
      1: { outcome: 'CONFIRMED', slots: [slot('2026-09-15T02:00:00Z')], actual_price_vnd: 17_500_000 },
    });
    const a = assembleItinerary(view, listings, ['i1']);
    expect(a.stops[0].priceVnd).toBe(17_500_000);
  });

  it('drops a confirmed item whose slot is missing instead of inventing a time', () => {
    const { view, listings } = build(1, { 1: { outcome: 'CONFIRMED', slots: [] } });
    const a = assembleItinerary(view, listings, ['i1']);
    expect(a.stops).toHaveLength(0);
    expect(a.dropped[0].state).toBe('CONFIRMED_NO_SLOT');
  });

  it('never makes a stop of an unconfirmed item', () => {
    const { view, listings } = build(3, {
      1: { outcome: 'ALTERNATIVE_OFFERED', slots: [slot('2026-09-15T02:00:00Z')] },
      2: { outcome: 'PRICE_CHANGED', slots: [], actual_price_vnd: 20_000_000 },
    });
    const a = assembleItinerary(view, listings, ['i1', 'i2', 'i3']);
    expect(a.stops).toHaveLength(0);
    expect(a.dropped.map(d => d.state)).toEqual(['ALTERNATIVE_OFFERED', 'PRICE_CHANGED', 'PENDING']);
  });
});

describe('warnings', () => {
  const stop = (over: Partial<ItineraryStop>): ItineraryStop => ({
    itemId: 'i', listingTitle: 'Flat', districtCode: 'HCM-D1', priceVnd: 1,
    startsAt: '2026-09-15T02:00:00Z', durationMinutes: 30, ...over,
  });

  it('catches a district hop with no time to make it', () => {
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: 'HCM-D1', startsAt: '2026-09-15T02:00:00Z' }),
      stop({ itemId: 'b', districtCode: 'HCM-D7', startsAt: '2026-09-15T02:40:00Z' }),
    ]);
    expect(w[0].kind).toBe('DISTRICT_HOP');
    expect(w[0].message).toContain('HCM-D1 to HCM-D7');
  });

  it('allows the same hop with enough of a gap', () => {
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: 'HCM-D1', startsAt: '2026-09-15T02:00:00Z' }),
      stop({ itemId: 'b', districtCode: 'HCM-D7', startsAt: `2026-09-15T0${2 + 2}:00:00Z` }),
    ]);
    expect(w).toHaveLength(0);
  });

  it('does not warn about two stops in the same district, however tight', () => {
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: 'HCM-D1', startsAt: '2026-09-15T02:00:00Z' }),
      stop({ itemId: 'b', districtCode: 'HCM-D1', startsAt: '2026-09-15T02:35:00Z' }),
    ]);
    expect(w).toHaveLength(0);
  });

  it('does not measure a gap across a night', () => {
    // 18:00 one day to 09:00 the next is not a journey with five minutes spare.
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: 'HCM-D1', startsAt: '2026-09-15T11:00:00Z' }),
      stop({ itemId: 'b', districtCode: 'HCM-D7', startsAt: '2026-09-16T02:00:00Z' }),
    ]);
    expect(w).toHaveLength(0);
  });

  it('says so rather than guessing when a district is missing', () => {
    // Zero active listings are geocoded (PLAN-v3 finding D), so a missing
    // district means the check cannot run - not that the hop is fine.
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: null, startsAt: '2026-09-15T02:00:00Z' }),
      stop({ itemId: 'b', districtCode: 'HCM-D7', startsAt: '2026-09-15T02:40:00Z' }),
    ]);
    expect(w[0].kind).toBe('UNKNOWN_DISTRICT');
  });

  it('reports an overlap once, not also as a hop', () => {
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: 'HCM-D1', startsAt: '2026-09-15T02:00:00Z', durationMinutes: 60 }),
      stop({ itemId: 'b', districtCode: 'HCM-D7', startsAt: '2026-09-15T02:30:00Z' }),
    ]);
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('OVERLAP');
  });

  it('uses a threshold, not a route estimate', () => {
    expect(DISTRICT_HOP_MINUTES).toBe(45);
  });
});

describe('the message', () => {
  const stops: ItineraryStop[] = [
    { itemId: 'i1', listingTitle: 'Sunny 2BR in Thao Dien', districtCode: 'HCM-D2', priceVnd: 18_000_000, startsAt: '2026-09-15T02:00:00Z', durationMinutes: 30 },
    { itemId: 'i2', listingTitle: 'Studio near Ben Thanh', districtCode: 'HCM-D1', priceVnd: 11_500_000, startsAt: '2026-09-15T04:00:00Z', durationMinutes: 30 },
    { itemId: 'i3', listingTitle: 'Quiet 1BR, Phu Nhuan', districtCode: 'HCM-PN', priceVnd: 9_000_000, startsAt: '2026-09-16T03:00:00Z', durationMinutes: 30 },
  ];

  it('is one message carrying every stop', () => {
    // Any code path that sends 3+ messages in a row to the same renter is a
    // bug, so three stops must be one string.
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 5 });
    expect(typeof text).toBe('string');
    for (const s of stops) expect(text).toContain(s.listingTitle);
  });

  it('leads with what the renter got', () => {
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 5 });
    expect(text.split('\n')[0]).toBe('3 of the 5 places you asked about are free to view. Here is the plan:');
  });

  it('mentions the shortfall in one line and does not apologise', () => {
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 5 });
    expect(text).toContain('The other 2 are no longer available at the price advertised.');
    expect(text.toLowerCase()).not.toContain('sorry');
    expect(text.toLowerCase()).not.toContain('unfortunately');
  });

  it('says nothing about a shortfall when there is none', () => {
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 3 });
    expect(text).toContain('All 3 of the places');
    expect(text).not.toContain('no longer available');
  });

  it('names the day once and then only the times', () => {
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 3 });
    // Two stops on the 15th, one on the 16th: the date appears twice, not
    // three times.
    expect(text.match(/Sep/g) ?? []).toHaveLength(2);
  });

  it('shows times in Ho Chi Minh City, not UTC', () => {
    // 02:00Z is 09:00 local. A renter reading 02:00 turns up at the wrong time
    // or, more likely, not at all.
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 3 });
    expect(text).toContain('09:00');
    expect(text).not.toContain('02:00');
  });

  it('formats every price as dong', () => {
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 3 });
    expect(text).toContain('18.000.000 ₫');
    expect(text).toContain('11.500.000 ₫');
  });

  it('uses request language, never booking language', () => {
    // At delivery the request is DELIVERED, not CONFIRMED. The renter has not
    // agreed to anything yet and invariant 6 forbids implying they have.
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 5 }).toLowerCase();
    for (const word of ['booked', 'booking', 'reserved', 'your appointment']) {
      expect(text, word).not.toContain(word);
    }
  });

  it('carries the ref so a reply can be routed', () => {
    expect(renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 3 })).toContain('HV-4KX7');
  });

  it('cannot print a realtor phone, because it is never given one', () => {
    // §6 enforced by shape: there is no realtor field on the DTO to leak.
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 3 });
    expect(text).not.toMatch(/\+?84\d{7,}/);
  });
});

describe('nothing confirmed', () => {
  it('never ships without substitutes when substitutes exist', () => {
    const text = renderNoSupply({
      ref: 'HV-4KX7',
      requestedCount: 4,
      substitutes: [
        { title: 'Flat A', priceVnd: 14_000_000, districtCode: 'HCM-D3' },
        { title: 'Flat B', priceVnd: 15_500_000, districtCode: 'HCM-BT' },
      ],
    });
    expect(text).toContain('Flat A');
    expect(text).toContain('Flat B');
    expect(text).toContain('Reply with a number');
  });

  it('promises a follow-up rather than ending on a dead end', () => {
    // FAILED_NO_SUPPLY with no alternative is a dead end, and a dead end is
    // not something we make a renter read.
    const text = renderNoSupply({ ref: 'HV-4KX7', requestedCount: 4, substitutes: [] });
    expect(text).toContain('come back to you today');
  });
});
