import { describe, it, expect } from 'vitest';
import {
  assembleItinerary,
  warningsFor,
  renderItinerary,
  renderNoSupply,
  renderAlternativesOnly,
  DISTRICT_HOP_MINUTES,
  busySlots,
  clashesWith,
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
      itemId: `i${i}`, listingTitle: `Flat ${i}`, districtCode: 'D1', priceVndAtRequest: 15_000_000,
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

  it('quotes the price the renter was shown, which is the only price a stop can have', () => {
    // A re-priced unit cannot reach an itinerary at all: PRICE_CHANGED is
    // terminal and slotless (SPEC §4), so there is no path from "the broker
    // moved the price" to a stop. The itinerary therefore never has to choose
    // between two prices - and must not imply it could.
    const { view, listings } = build(1, {
      1: { outcome: 'CONFIRMED', slots: [slot('2026-09-15T02:00:00Z')] },
    });
    expect(assembleItinerary(view, listings, ['i1']).stops[0].priceVnd).toBe(15_000_000);

    const repriced = build(1, { 1: { outcome: 'PRICE_CHANGED', slots: [], actual_price_vnd: 17_500_000 } });
    const a = assembleItinerary(repriced.view, repriced.listings, ['i1']);
    expect(a.stops).toHaveLength(0);
    expect(a.dropped[0].state).toBe('PRICE_CHANGED');
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
    itemId: 'i', listingTitle: 'Flat', districtCode: 'D1', priceVnd: 1,
    startsAt: '2026-09-15T02:00:00Z', durationMinutes: 30, ...over,
  });

  it('catches a district hop with no time to make it', () => {
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: 'D1', startsAt: '2026-09-15T02:00:00Z' }),
      stop({ itemId: 'b', districtCode: 'D7', startsAt: '2026-09-15T02:40:00Z' }),
    ]);
    expect(w[0].kind).toBe('DISTRICT_HOP');
    expect(w[0].message).toContain('D1 to D7');
  });

  it('allows the same hop with enough of a gap', () => {
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: 'D1', startsAt: '2026-09-15T02:00:00Z' }),
      stop({ itemId: 'b', districtCode: 'D7', startsAt: `2026-09-15T0${2 + 2}:00:00Z` }),
    ]);
    expect(w).toHaveLength(0);
  });

  it('does not warn about two stops in the same district, however tight', () => {
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: 'D1', startsAt: '2026-09-15T02:00:00Z' }),
      stop({ itemId: 'b', districtCode: 'D1', startsAt: '2026-09-15T02:35:00Z' }),
    ]);
    expect(w).toHaveLength(0);
  });

  it('does not measure a gap across a night', () => {
    // 18:00 one day to 09:00 the next is not a journey with five minutes spare.
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: 'D1', startsAt: '2026-09-15T11:00:00Z' }),
      stop({ itemId: 'b', districtCode: 'D7', startsAt: '2026-09-16T02:00:00Z' }),
    ]);
    expect(w).toHaveLength(0);
  });

  it('says so rather than guessing when a district is missing', () => {
    // Zero active listings are geocoded (PLAN-v3 finding D), so a missing
    // district means the check cannot run - not that the hop is fine.
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: null, startsAt: '2026-09-15T02:00:00Z' }),
      stop({ itemId: 'b', districtCode: 'D7', startsAt: '2026-09-15T02:40:00Z' }),
    ]);
    expect(w[0].kind).toBe('UNKNOWN_DISTRICT');
  });

  it('reports an overlap once, not also as a hop', () => {
    const w = warningsFor([
      stop({ itemId: 'a', districtCode: 'D1', startsAt: '2026-09-15T02:00:00Z', durationMinutes: 60 }),
      stop({ itemId: 'b', districtCode: 'D7', startsAt: '2026-09-15T02:30:00Z' }),
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
    { itemId: 'i1', listingTitle: 'Sunny 2BR in Thao Dien', districtCode: 'D2', priceVnd: 18_000_000, startsAt: '2026-09-15T02:00:00Z', durationMinutes: 30 },
    { itemId: 'i2', listingTitle: 'Studio near Ben Thanh', districtCode: 'D1', priceVnd: 11_500_000, startsAt: '2026-09-15T04:00:00Z', durationMinutes: 30 },
    { itemId: 'i3', listingTitle: 'Quiet 1BR, Phu Nhuan', districtCode: 'PHU_NHUAN', priceVnd: 9_000_000, startsAt: '2026-09-16T03:00:00Z', durationMinutes: 30 },
  ];

  it('is one message carrying every stop', () => {
    // Any code path that sends 3+ messages in a row to the same renter is a
    // bug, so three stops must be one string.
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 5 });
    expect(typeof text).toBe('string');
    for (const s of stops) expect(text).toContain(s.listingTitle);
  });

  it('names each district in words, never by its code', () => {
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 5 });
    expect(text).toContain('18.000.000 ₫/month - District 2');
    expect(text).toContain('9.000.000 ₫/month - Phu Nhuan');
    expect(text).not.toMatch(/PHU_NHUAN|\bD[12]\b/);
  });

  it('leads with what the renter got', () => {
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 5 });
    expect(text.split('\n')[0]).toBe('3 of the 5 places you asked about are free to view. Here is the plan:');
  });

  it('mentions the shortfall in one line and does not apologise', () => {
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 5 });
    expect(text).toContain('We could not confirm the other 2 for these times.');
    expect(text.toLowerCase()).not.toContain('sorry');
    expect(text.toLowerCase()).not.toContain('unfortunately');
  });

  it('does not tell the renter WHY an item is missing', () => {
    // The renderer is handed stops, never outcomes, so any reason it gave
    // would be a guess across seven of them (SPEC §4). It used to guess
    // "no longer available at the price advertised", which is false for an
    // ALREADY_RENTED unit and misleading for a PRICE_CHANGED one.
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 5 });
    expect(text).not.toMatch(/price advertised/i);
    expect(text).not.toMatch(/\brented\b/i);
  });

  it('uses the singular when exactly one fell through', () => {
    const text = renderItinerary({ ref: 'HV-4KX7', stops, requestedCount: 4 });
    expect(text).toContain('We could not confirm the other one for these times.');
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
        { title: 'Flat A', priceVnd: 14_000_000, districtCode: 'D3' },
        { title: 'Flat B', priceVnd: 15_500_000, districtCode: 'BINH_THANH' },
      ],
    });
    expect(text).toContain('Flat A');
    expect(text).toContain('Flat B');
    expect(text).toContain('Reply with a number');
    expect(text).toContain('15.500.000 ₫/month - Binh Thanh');
    expect(text).not.toContain('BINH_THANH');
  });

  it('promises a follow-up rather than ending on a dead end', () => {
    // FAILED_NO_SUPPLY with no alternative is a dead end, and a dead end is
    // not something we make a renter read.
    const text = renderNoSupply({ ref: 'HV-4KX7', requestedCount: 4, substitutes: [] });
    expect(text).toContain('come back to you today');
  });
});

describe('other times an agent offered (gap 7)', () => {
  const offered = (...times: string[]) => ({ outcome: 'ALTERNATIVE_OFFERED', slots: times.map(t => slot(t)) });

  it('collects them apart from the stops, earliest first', () => {
    const { view, listings } = build(3, {
      1: confirmed('2026-09-15T02:00:00Z'),
      2: offered('2026-09-19T08:00:00Z', '2026-09-18T03:00:00Z'),
      3: { outcome: 'ALREADY_RENTED', slots: [] },
    });
    const a = assembleItinerary(view, listings, ['i1']);
    expect(a.stops.map(s => s.itemId)).toEqual(['i1']);
    expect(a.alternatives).toEqual([expect.objectContaining({
      itemId: 'i2', startsAt: ['2026-09-18T03:00:00Z', '2026-09-19T08:00:00Z'],
    })]);
    // Never a stop: the renter did not choose these times.
    expect(a.warnings).toEqual([]);
  });

  it('puts them in the same one message, after the plan, in local time', () => {
    const { view, listings } = build(3, {
      1: confirmed('2026-09-15T02:00:00Z'),
      2: offered('2026-09-18T03:00:00Z', '2026-09-19T08:00:00Z'),
      3: { outcome: 'ALREADY_RENTED', slots: [] },
    });
    const a = assembleItinerary(view, listings, ['i1']);
    const text = renderItinerary({ ref: 'HV-4KX9', stops: a.stops, requestedCount: 3, alternatives: a.alternatives });
    expect(text).toContain('1 of the 3 places');
    expect(text).toContain('The agent for one more offered different times:');
    // 03:00Z is 10:00 in Ho Chi Minh City, 08:00Z is 15:00.
    expect(text).toContain('Flat 2 - 15.000.000 ₫/month - District 1: Fri 18 Sept, 10:00 or Sat 19 Sept, 15:00');
    expect(text).toContain('We could not confirm the last one for these times.');
    expect(text).toContain('If one of the other times suits you, tell us which.');
    expect(text).not.toMatch(/book/i);
  });

  it('does not count an offered unit as a dead end', () => {
    const { view, listings } = build(2, {
      1: confirmed('2026-09-15T02:00:00Z'),
      2: offered('2026-09-18T03:00:00Z'),
    });
    const a = assembleItinerary(view, listings, ['i1']);
    const text = renderItinerary({ ref: 'HV-4KX9', stops: a.stops, requestedCount: 2, alternatives: a.alternatives });
    expect(text).not.toContain('could not confirm');
  });

  it('when nothing is free at their times, lists the offers instead of saying none are free', () => {
    const { view, listings } = build(3, {
      1: offered('2026-09-18T03:00:00Z'),
      2: offered('2026-09-19T08:00:00Z'),
      3: { outcome: 'ALREADY_RENTED', slots: [] },
    });
    const a = assembleItinerary(view, listings, []);
    expect(a.stops).toHaveLength(0);
    const text = renderAlternativesOnly({ ref: 'HV-4KX9', requestedCount: 3, alternatives: a.alternatives });
    expect(text).toContain('the agents for 2 of them offered other times');
    expect(text).toContain('Tell us which of these suit you');
    // No plan exists yet, so there is nothing to say YES to.
    expect(text).not.toMatch(/reply yes/i);
    expect(text).toContain('Ref HV-4KX9');
  });
});

describe('a clash, found as each agent answers', () => {
  const view = reduceRequest('r', [
    ev('REQUEST_SUBMITTED'), ev('ITEM_ADDED', {}, 'a'), ev('ITEM_ADDED', {}, 'b'),
    ev('OUTCOME_RECORDED', { outcome: 'CONFIRMED', slots: [slot('2026-09-12T02:00:00.000Z', 60)] }, 'a'),
    ev('OUTCOME_RECORDED', { outcome: 'ALREADY_RENTED' }, 'b'),
  ]);
  const busy = busySlots(view, id => `Place ${id}`);

  it('lists the confirmed viewings, each by its first slot', () => {
    expect(busy).toEqual([{ itemId: 'a', listingTitle: 'Place a', startsAt: '2026-09-12T02:00:00.000Z', durationMinutes: 60 }]);
  });

  it('finds an overlap either side, and lets back to back through', () => {
    expect(clashesWith({ startsAt: '2026-09-12T02:30:00.000Z', durationMinutes: 30 }, busy, 'c')).toHaveLength(1);
    expect(clashesWith({ startsAt: '2026-09-12T01:45:00.000Z', durationMinutes: 30 }, busy, 'c')).toHaveLength(1);
    expect(clashesWith({ startsAt: '2026-09-12T03:00:00.000Z', durationMinutes: 30 }, busy, 'c')).toHaveLength(0);
    expect(clashesWith({ startsAt: '2026-09-12T01:30:00.000Z', durationMinutes: 30 }, busy, 'c')).toHaveLength(0);
  });

  it('agrees with the warning the itinerary gives', () => {
    const stops = (start: string): ItineraryStop[] => [
      { itemId: 'a', listingTitle: 'A', districtCode: 'D1', priceVnd: 1, startsAt: '2026-09-12T02:00:00.000Z', durationMinutes: 60 },
      { itemId: 'c', listingTitle: 'C', districtCode: 'D1', priceVnd: 1, startsAt: start, durationMinutes: 30 },
    ];
    for (const start of ['2026-09-12T02:30:00.000Z', '2026-09-12T02:59:00.000Z', '2026-09-12T03:00:00.000Z']) {
      const overlap = warningsFor(stops(start)).some(w => w.kind === 'OVERLAP');
      expect(clashesWith({ startsAt: start, durationMinutes: 30 }, busy, 'c').length > 0).toBe(overlap);
    }
  });

  it('never counts a place against itself', () => {
    expect(clashesWith({ startsAt: '2026-09-12T02:00:00.000Z', durationMinutes: 30 }, busy, 'a')).toHaveLength(0);
  });
});
