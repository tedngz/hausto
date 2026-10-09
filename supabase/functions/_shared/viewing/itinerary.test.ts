import { describe, it, expect } from 'vitest';
import {
  assembleItinerary,
  warningsFor,
  renderItinerary,
  renderNoSupply,
  renderOtherDays,
  renderAlternativesOnly,
  freeOnOtherDays,
  DISTRICT_HOP_MINUTES,
  busySlots,
  clashesWith,
  type ItineraryStop,
  type PrioritySearchOffer,
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

  const offer = (o: Partial<PrioritySearchOffer> = {}): PrioritySearchOffer => ({
    url: 'https://hausto.com/hub?priority=D7&beds=2&max=17000000',
    hasPass: false, freeViewing: true, browseUrl: 'https://hausto.com/hub',
    passPriceUsd: 25, passDays: 30, replyWithinHours: 72, ...o,
  });

  it('ends on something to do, never on a promise to come back', () => {
    // "We will come back to you today" was a follow-up nothing in the system
    // made. Every version ends on a link the renter can use now.
    for (const o of [offer({ hasPass: true }), offer(), offer({ freeViewing: false })]) {
      const text = renderNoSupply({ ref: 'HV-4KX7', requestedCount: 4, substitutes: [], prioritySearch: o });
      expect(text).not.toMatch(/come back to you/);
      expect(text).toContain('Extensive search');
      expect(text).toContain('/hub?priority=D7');
      expect(text).not.toMatch(/Search for me/i);
    }
  });

  it('offers Extensive search as theirs to a Pass holder, without a price', () => {
    const text = renderNoSupply({ ref: 'HV-4KX7', requestedCount: 2, substitutes: [], prioritySearch: offer({ hasPass: true }) });
    expect(text).toContain('Your Pass includes Extensive search');
    expect(text).toContain('within 3 days');
    expect(text).not.toContain('$25');
    expect(text).not.toContain('free viewing');
  });

  it('puts the unused free viewing first for a renter without the Pass, and the Pass in one line', () => {
    const text = renderNoSupply({ ref: 'HV-4KX7', requestedCount: 2, substitutes: [], prioritySearch: offer() });
    const lines = text.split('\n');
    const free = lines.findIndex(l => l.includes('free viewing is still unused'));
    const pass = lines.findIndex(l => l.includes('Extensive search, part of the Pass ($25 for 30 days)'));
    expect(free).toBeGreaterThan(0);
    expect(pass).toBe(free + 1);
    expect(lines[free]).toContain('https://hausto.com/hub');
  });

  it('does not mention a free viewing the number has already had', () => {
    const text = renderNoSupply({ ref: 'HV-4KX7', requestedCount: 2, substitutes: [], prioritySearch: offer({ freeViewing: false }) });
    expect(text).not.toContain('free viewing');
    expect(text).toContain('To find more, let us ask the agents in our network for you');
  });

  it('leaves Extensive search out when there are close matches to reply to', () => {
    const text = renderNoSupply({
      ref: 'HV-4KX7', requestedCount: 2,
      substitutes: [{ title: 'Flat A', priceVnd: 14_000_000, districtCode: 'D3' }],
      prioritySearch: offer(),
    });
    expect(text).toContain('Reply with a number');
    expect(text).not.toContain('Extensive search');
  });

  it('says "the place" for one, not "none of the 1 places"', () => {
    const text = renderNoSupply({ ref: 'HV-4KX7', requestedCount: 1, substitutes: [], prioritySearch: offer() });
    expect(text.split('\n')[0]).toBe('The place you asked about is no longer free - the market here moves in days, not weeks.');
  });
});

describe('not on those days (UNAVAILABLE_DATE)', () => {
  it('is any place whose agent could not do the times, and nothing rented or silent', () => {
    const { view, listings } = build(4, {
      1: { outcome: 'UNAVAILABLE_DATE', slots: [] },
      2: { outcome: 'ALREADY_RENTED', slots: [] },
      3: { outcome: 'NO_RESPONSE', slots: [] },
      4: { outcome: 'UNAVAILABLE_DATE', slots: [] },
    });
    expect(freeOnOtherDays(view, listings).map(l => l.itemId)).toEqual(['i1', 'i4']);
  });

  it('is none when every place is rented', () => {
    const { view, listings } = build(2, {
      1: { outcome: 'ALREADY_RENTED', slots: [] },
      2: { outcome: 'ALREADY_RENTED', slots: [] },
    });
    expect(freeOnOtherDays(view, listings)).toEqual([]);
  });

  const url = 'https://hausto.com/hub?tab=viewings';

  it('asks for other days, lists the places, and never says they are gone', () => {
    const { view, listings } = build(2, {
      1: { outcome: 'UNAVAILABLE_DATE', slots: [] },
      2: { outcome: 'UNAVAILABLE_DATE', slots: [] },
    });
    const text = renderOtherDays({ ref: 'HV-P6XT', requestedCount: 2, places: freeOnOtherDays(view, listings), changeTimesUrl: url });
    expect(text.split('\n')[0]).toBe('The agents cannot show these 2 places on the days you gave, but neither has been rented:');
    for (const l of listings) expect(text).toContain(l.listingTitle);
    expect(text).toContain(`Pick other days and we will ask the agents again: ${url}`);
    expect(text).not.toMatch(/no longer free|still free|close matches/);
    expect(text).not.toMatch(/book/i);
    expect(text.trim().endsWith('Ref HV-P6XT')).toBe(true);
  });

  it('names only the places still to be had when some were rented', () => {
    const { view, listings } = build(3, {
      1: { outcome: 'ALREADY_RENTED', slots: [] },
      2: { outcome: 'UNAVAILABLE_DATE', slots: [] },
      3: { outcome: 'NO_RESPONSE', slots: [] },
    });
    const text = renderOtherDays({ ref: 'HV-P6XT', requestedCount: 3, places: freeOnOtherDays(view, listings), changeTimesUrl: url });
    expect(text).toContain('None of the 3 places you asked about can be seen on the days you gave, but this one has not been rented:');
    expect(text).toContain(listings[1].listingTitle);
    expect(text).not.toContain(listings[0].listingTitle);
    expect(text).toContain('we will ask the agent again');
  });

  it('speaks of one place as one', () => {
    const { view, listings } = build(1, { 1: { outcome: 'UNAVAILABLE_DATE', slots: [] } });
    const text = renderOtherDays({ ref: 'HV-P6XT', requestedCount: 1, places: freeOnOtherDays(view, listings), changeTimesUrl: url });
    expect(text.split('\n')[0]).toBe('The agent cannot show this place on the days you gave, but it has not been rented:');
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
