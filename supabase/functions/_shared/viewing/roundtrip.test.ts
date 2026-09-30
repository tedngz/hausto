// The whole path, on MockAdapter, with seeded data (SPEC §8.3).
//
// Shortlist → request → handshake → ops outcomes → itinerary → reply →
// confirmed. Every unit below is tested on its own elsewhere; this asserts
// they compose, which is the part no unit test can show.
//
// It runs against the in-memory FakeDb and the MockAdapter that ships as the
// default everywhere, so it is the same code the demo runs - not a parallel
// implementation of the flow written to pass.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { deliver } from './deliver.ts';
import { handleInbound } from './routing.ts';
import { intakeEvents, buildDeepLink, generateRef } from './intake.ts';
import { validateOutcome, outcomePayload, opsActor } from './outcomes.ts';
import { reduceRequest, summarise, type DomainEvent } from '../viewing-domain.ts';
import { dueActions, SILENCE_ACTION_MS } from './reminders.ts';
import { decideAction } from './agent.ts';
import { performAction } from './agent-act.ts';

const PHONE = '+84901234567';
const BUSINESS = '+84900000000';

let db: FakeDb;
let adapter: MockAdapter;
let store: SupabaseMessageStore;
let requestId: string;
let ref: string;
let itemIds: string[];

/** Five shortlisted listings, a renter, a request. The state after intake. */
async function seed() {
  db = new FakeDb();
  adapter = new MockAdapter();
  // deno-lint-ignore no-explicit-any
  store = new SupabaseMessageStore(db as any);

  const titles = [
    'Sunny 2BR in Thao Dien', 'Studio near Ben Thanh', 'Quiet 1BR, Phu Nhuan',
    'Riverside 2BR, Binh Thanh', 'Loft in District 3',
  ];
  const districts = ['HCM-D2', 'HCM-D1', 'HCM-PN', 'HCM-BT', 'HCM-D3'];
  titles.forEach((title, i) => {
    db.tables.external_properties.push({
      id: `listing-${i + 1}`, title, district_code: districts[i],
      price_vnd: 15_000_000 + i * 1_000_000, is_active: true,
      bedrooms: 2, area_sqm: 70, price_confidence: 'HIGH',
    });
  });

  // Live listings the renter did NOT shortlist, for the substitute search to
  // find. Two are plausible neighbours; one is priced far out of their band and
  // must not be offered.
  db.tables.external_properties.push(
    { id: 'alt-1', title: 'Bright 2BR, Thao Dien', district_code: 'HCM-D2',
      price_vnd: 16_000_000, is_active: true, bedrooms: 2, area_sqm: 68, price_confidence: 'HIGH' },
    { id: 'alt-2', title: 'Corner 2BR near Ben Thanh', district_code: 'HCM-D1',
      price_vnd: 14_500_000, is_active: true, bedrooms: 2, area_sqm: 65, price_confidence: 'HIGH' },
    { id: 'alt-rich', title: 'Penthouse, Thao Dien', district_code: 'HCM-D2',
      price_vnd: 60_000_000, is_active: true, bedrooms: 4, area_sqm: 200, price_confidence: 'HIGH' },
  );

  db.tables.renters.push({ id: 'renter-1', phone_e164: PHONE, service_window_expires_at: null, opted_out_at: null });

  ref = generateRef();
  requestId = 'request-1';
  db.tables.viewing_requests.push({
    id: requestId, ref, renter_id: 'renter-1',
    availability: [{ date: '2026-09-15', part: 'MORNING' }, { date: '2026-09-15', part: 'AFTERNOON' }],
    created_at: new Date('2026-09-12T00:00:00Z').toISOString(),
  });

  itemIds = [];
  titles.forEach((_, i) => {
    const id = `item-${i + 1}`;
    itemIds.push(id);
    db.tables.request_items.push({
      id, request_id: requestId, listing_id: `listing-${i + 1}`,
      realtor_id: null, price_vnd_at_request: 15_000_000 + i * 1_000_000, sort_order: i,
    });
  });

  for (const e of intakeEvents({
    requestId,
    availability: [{ date: '2026-09-15', part: 'MORNING' }],
    items: itemIds.map((itemId, i) => ({
      itemId, listingId: `listing-${i + 1}`, priceVndAtRequest: 15_000_000 + i * 1_000_000, realtorId: null,
    })),
  })) {
    db.tables.events.push({ ...e, occurred_at: new Date('2026-09-12T00:00:00Z').toISOString() });
  }
}

/** Replay the log the way every reader does. */
function view() {
  return reduceRequest(requestId, db.tables.events as unknown as DomainEvent[]);
}

/** An operator recording one outcome, through the same validation the endpoint uses. */
function record(itemId: string, submission: Parameters<typeof validateOutcome>[0], priorNudges = 0) {
  const v = validateOutcome(submission, { priorNudges });
  if (!v.ok) throw new Error(`test recorded an illegal outcome: ${v.error}`);
  db.tables.events.push({
    request_id: requestId, item_id: itemId, type: 'OUTCOME_RECORDED',
    payload: outcomePayload(v.value), actor: opsActor('ops-user-1'),
    occurred_at: new Date().toISOString(),
  });
}

const inbound = (text: string, id = `wamid.${Math.random()}`) =>
  // deno-lint-ignore no-explicit-any
  handleInbound(db as any, store, { from: PHONE, text, providerMessageId: id, timestamp: new Date().toISOString() });

describe('the round trip, end to end on MockAdapter', () => {
  beforeEach(seed);

  it('closes: handshake, 3-of-5 outcomes, one itinerary, one reply, confirmed', async () => {
    // ── 1. The renter sends the deep-link message, opening the window ──────
    const link = buildDeepLink(BUSINESS, ref);
    const handshakeText = decodeURIComponent(link.split('?text=')[1]);
    const first = await inbound(handshakeText);

    expect(first.requestId).toBe(requestId);
    expect(db.tables.renters[0].service_window_expires_at).toBeTruthy();
    expect(view().state).toBe('SUBMITTED');

    // ── 2. Ops works the five. Three come back free; two do not ───────────
    record(itemIds[0], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-15T02:00:00Z', durationMinutes: 30 }] });
    record(itemIds[1], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-15T04:00:00Z', durationMinutes: 30 }] });
    record(itemIds[2], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-15T07:00:00Z', durationMinutes: 30 }] });
    record(itemIds[3], { outcome: 'ALREADY_RENTED' });
    record(itemIds[4], { outcome: 'PRICE_CHANGED', actualPriceVnd: 25_000_000 });

    const afterOps = summarise(view());
    expect(afterOps).toMatchObject({ total: 5, confirmed: 3, unresolved: 0, isPartial: true, hasNothing: false });

    // ── 3. One itinerary message ───────────────────────────────────────────
    // deno-lint-ignore no-explicit-any
    const result = await deliver(db as any, adapter, {
      requestId, purpose: 'ITINERARY',
      order: [itemIds[0], itemIds[1], itemIds[2]],
      actor: opsActor('ops-user-1'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops).toBe(3);
    expect(result.warnings).toHaveLength(0);

    // One message, not three. This is the rule the send service exists to
    // hold, and the point where a regression would be expensive.
    const outbound = db.tables.messages.filter(m => m.direction === 'OUT');
    expect(outbound).toHaveLength(1);
    expect(adapter.delivered).toHaveLength(1);

    const text = String(outbound[0].body);
    expect(text).toContain('3 of the 5 places');
    expect(text).toContain('Sunny 2BR in Thao Dien');
    expect(text).toContain('09:00');            // 02:00Z, shown in Ho Chi Minh City
    expect(text).toContain(ref);
    expect(text).not.toContain('Loft in District 3');   // priced out, not a stop
    expect(text.toLowerCase()).not.toContain('booked'); // not CONFIRMED yet

    expect(view().state).toBe('DELIVERED');

    // ── 4. The renter says yes ─────────────────────────────────────────────
    const reply = await inbound('yes please');
    expect(reply.intent).toBe('CONFIRM');
    expect(reply.confirmed).toBe(true);

    const final = view();
    expect(final.state).toBe('CONFIRMED');
    expect(final.confirmedItemIds.sort()).toEqual([itemIds[0], itemIds[1], itemIds[2]].sort());

    // ── 5. And nothing further is owed ─────────────────────────────────────
    const owed = dueActions({
      view: final,
      events: db.tables.events as unknown as DomainEvent[],
      createdAt: String(db.tables.viewing_requests[0].created_at),
      now: Date.parse('2026-09-14T00:00:00Z'),
    });
    expect(owed.filter(a => a.kind === 'HOLDING_UPDATE')).toHaveLength(0);
  });

  it('keeps a re-priced unit out of the itinerary entirely', async () => {
    // "Free on Tuesday, but 19.5m not 15m" has no way to become a viewing:
    // PRICE_CHANGED is terminal and slotless (SPEC §4). The renter is told
    // about it rather than shown a stale price - which is the behaviour the
    // outcome contract actually guarantees. Whether that SHOULD be a dead end
    // is a product question; it is not something to paper over here.
    record(itemIds[0], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-15T02:00:00Z', durationMinutes: 30 }] });
    record(itemIds[1], { outcome: 'PRICE_CHANGED', actualPriceVnd: 19_500_000 });
    for (let i = 2; i < 5; i++) record(itemIds[i], { outcome: 'ALREADY_RENTED' });

    await inbound('hi');
    // deno-lint-ignore no-explicit-any
    const result = await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order: [itemIds[0]] });
    expect(result.ok && result.stops).toBe(1);

    const text = String(db.tables.messages.find(m => m.direction === 'OUT')!.body);
    expect(text).toContain('1 of the 5 places');
    // Neither the old price nor the new one for the re-priced unit.
    expect(text).not.toContain('Studio near Ben Thanh');
    expect(text).not.toContain('19.500.000 ₫');
  });

  it('sends substitutes, never a bare dead end, when nothing is confirmed', async () => {
    for (const id of itemIds) record(id, { outcome: 'ALREADY_RENTED' });
    await inbound('hi');

    // deno-lint-ignore no-explicit-any
    const result = await deliver(db as any, adapter, {
      requestId, purpose: 'ITINERARY', order: [],
      substitutes: [{ title: 'Flat A', priceVnd: 14_000_000, districtCode: 'HCM-D3' }],
    });
    expect(result.ok).toBe(true);

    const text = String(db.tables.messages.find(m => m.direction === 'OUT')!.body);
    expect(text).toContain('Flat A');
    expect(text).toContain('Reply with a number');
  });

  it('finds its own substitutes when nothing is confirmed and none were supplied', async () => {
    // The hole this closes: renderNoSupply has always taken substitutes and
    // nothing ever produced any, so the message promised a follow-up nobody was
    // going to make.
    for (const id of itemIds) record(id, { outcome: 'ALREADY_RENTED' });
    await inbound('hi');

    // deno-lint-ignore no-explicit-any
    const result = await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order: [] });
    expect(result.ok).toBe(true);

    const text = String(db.tables.messages.find(m => m.direction === 'OUT')!.body);
    expect(text).toContain('Bright 2BR, Thao Dien');
    expect(text).toContain('Corner 2BR near Ben Thanh');
    // Out of the price band - offering it would waste the renter's time twice.
    expect(text).not.toContain('Penthouse');
    // And never one they already shortlisted and were just told is gone.
    expect(text).not.toContain('Sunny 2BR in Thao Dien');
    expect(text).toContain('Reply with a number');
  });

  it('still sends the failure when the substitute search finds nothing', async () => {
    // An empty result is honest, and the renter being told their request failed
    // matters more than the suggestions.
    db.tables.external_properties = db.tables.external_properties.filter(p => !String(p.id).startsWith('alt-'));
    for (const id of itemIds) record(id, { outcome: 'ALREADY_RENTED' });
    await inbound('hi');

    // deno-lint-ignore no-explicit-any
    const result = await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order: [] });
    expect(result.ok).toBe(true);
    const text = String(db.tables.messages.find(m => m.direction === 'OUT')!.body);
    expect(text).toContain('come back to you today');
  });

  it('refuses to send with the window shut, rather than logging a send nobody got', async () => {
    // No inbound at all, so the window never opened. This is the human-blocked
    // template dependency surfacing - the correct behaviour is refusal.
    record(itemIds[0], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-15T02:00:00Z', durationMinutes: 30 }] });
    for (let i = 1; i < 5; i++) record(itemIds[i], { outcome: 'ALREADY_RENTED' });

    // deno-lint-ignore no-explicit-any
    const result = await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order: [itemIds[0]] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('service_window_closed');
    expect(result.preview).toContain('Sunny 2BR');           // ops can still read it
    expect(db.tables.messages.filter(m => m.direction === 'OUT')).toHaveLength(0);
    expect(view().state).not.toBe('DELIVERED');              // and the log does not lie
  });

  it('does not send the itinerary twice when ops presses send twice', async () => {
    record(itemIds[0], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-15T02:00:00Z', durationMinutes: 30 }] });
    for (let i = 1; i < 5; i++) record(itemIds[i], { outcome: 'ALREADY_RENTED' });
    await inbound('hi');

    // deno-lint-ignore no-explicit-any
    const first = await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order: [itemIds[0]] });
    // deno-lint-ignore no-explicit-any
    const second = await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order: [itemIds[0]] });

    expect(first.ok && !first.deduplicated).toBe(true);
    expect(second.ok && second.deduplicated).toBe(true);
    expect(db.tables.messages.filter(m => m.direction === 'OUT')).toHaveLength(1);
    // And the append-only log carries one delivery, not two.
    expect(db.tables.events.filter(e => e.type === 'ITINERARY_DELIVERED')).toHaveLength(1);
  });

  it('owes a holding update when ops has been slow, and stops once it is sent', async () => {
    await inbound('hi');
    const createdAt = String(db.tables.viewing_requests[0].created_at);
    const late = Date.parse(createdAt) + SILENCE_ACTION_MS + 60_000;

    const before = dueActions({
      view: view(), events: db.tables.events as unknown as DomainEvent[], createdAt, now: late,
    });
    expect(before.map(a => a.kind)).toContain('HOLDING_UPDATE');

    // deno-lint-ignore no-explicit-any
    const sent = await deliver(db as any, adapter, { requestId, purpose: 'HOLDING_UPDATE' });
    expect(sent.ok).toBe(true);

    // It moved the silence clock without pretending the request had progressed.
    expect(db.tables.events.some(e => e.type === 'HOLDING_UPDATE_SENT')).toBe(true);
    expect(view().state).toBe('SUBMITTED');

    const after = dueActions({
      view: view(), events: db.tables.events as unknown as DomainEvent[], createdAt, now: late,
    });
    expect(after.map(a => a.kind)).not.toContain('HOLDING_UPDATE');

    // The next silence gets its own message. Keyed on the purpose alone, every
    // holding update after the first was taken for a duplicate and never sent.
    const sentBefore = adapter.delivered.length;
    db.tables.events.find(e => e.type === 'HOLDING_UPDATE_SENT')!.occurred_at = new Date(late).toISOString();
    // deno-lint-ignore no-explicit-any
    const next = await deliver(db as any, adapter, { requestId, purpose: 'HOLDING_UPDATE' });
    expect(next).toMatchObject({ ok: true, deduplicated: false });
    expect(adapter.delivered.length).toBe(sentBefore + 1);
    expect(db.tables.events.filter(e => e.type === 'HOLDING_UPDATE_SENT')).toHaveLength(2);
  });

  it('never puts a realtor number in anything the renter receives', async () => {
    db.tables.request_items.forEach(i => { i.realtor_id = 'realtor-1'; });
    record(itemIds[0], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-15T02:00:00Z', durationMinutes: 30 }] });
    for (let i = 1; i < 5; i++) record(itemIds[i], { outcome: 'ALREADY_RENTED' });
    await inbound('hi');

    // deno-lint-ignore no-explicit-any
    await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order: [itemIds[0]] });
    for (const m of db.tables.messages.filter(m => m.direction === 'OUT')) {
      expect(String(m.body)).not.toMatch(/\+?84\d{7,}/);
    }
  });

  it('honours an opt-out mid-flight and refuses to send after it', async () => {
    await inbound('hi');
    const out = await inbound('dừng');
    expect(out.intent).toBe('OPT_OUT');
    expect(db.tables.renters[0].opted_out_at).toBeTruthy();

    record(itemIds[0], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-15T02:00:00Z', durationMinutes: 30 }] });
    for (let i = 1; i < 5; i++) record(itemIds[i], { outcome: 'ALREADY_RENTED' });

    // deno-lint-ignore no-explicit-any
    const result = await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order: [itemIds[0]] });
    expect(result.ok).toBe(false);
    expect(db.tables.messages.filter(m => m.direction === 'OUT')).toHaveLength(0);
  });
});

describe('the agent switch, end to end', () => {
  beforeEach(seed);

  /** Fail the shortlist, send the no-supply message, capture what was offered. */
  async function offerSubstitutes() {
    for (const id of itemIds) record(id, { outcome: 'ALREADY_RENTED' });
    await inbound('hi');
    // deno-lint-ignore no-explicit-any
    await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order: [] });
    return db.tables.events.filter(e => e.type === 'SUGGESTIONS_OFFERED');
  }

  it('records what it offered, so a number can mean something', async () => {
    const offers = await offerSubstitutes();
    expect(offers).toHaveLength(1);
    expect((offers[0].payload as { listing_ids: string[] }).listing_ids.length).toBeGreaterThan(0);
  });

  it('does nothing at all when the switch is off', async () => {
    await offerSubstitutes();
    const outboundBefore = db.tables.messages.filter(m => m.direction === 'OUT').length;
    const out = await inbound('1');

    const action = decideAction({
      enabled: false, intent: out.intent, text: '1',
      requestId: out.requestId, optedOut: out.optedOut, confirmed: out.confirmed, selection: out.selection,
    });
    expect(action.kind).toBe('NONE');
    expect(action.kind === 'NONE' && action.reason).toBe('agent disabled');

    // Nothing sent, and no new request - the inbound is still stored and the
    // window still re-opened, which is the switch being off rather than the
    // whole path being dead.
    expect(db.tables.messages.filter(m => m.direction === 'OUT')).toHaveLength(outboundBefore);
    expect(db.tables.messages.filter(m => m.direction === 'IN').length).toBeGreaterThan(0);
    expect(db.tables.viewing_requests).toHaveLength(1);
  });

  it('turns a picked number into a new request when the switch is on', async () => {
    await offerSubstitutes();
    const out = await inbound('1');
    expect(out.intent).toBe('SELECTION');
    expect(out.selection?.listingIds?.length).toBe(1);

    const action = decideAction({
      enabled: true, intent: out.intent, text: '1',
      requestId: out.requestId, optedOut: out.optedOut, confirmed: out.confirmed, selection: out.selection,
    });
    expect(action.kind).toBe('RE_REQUEST');

    // deno-lint-ignore no-explicit-any
    const result = await performAction(db as any, adapter, action, {
      renterId: out.renterId, requestId: out.requestId, providerMessageId: 'wamid.pick',
    });

    expect(result.error).toBeUndefined();
    expect(result.performed).toBe('RE_REQUEST');
    // A NEW request, not items bolted onto the failed one.
    expect(db.tables.viewing_requests).toHaveLength(2);
    expect(result.ref).toMatch(/^HV-/);

    const confirmation = String(db.tables.messages.filter(m => m.direction === 'OUT').pop()!.body);
    expect(confirmation).toContain(result.ref!);
    expect(confirmation.toLowerCase()).not.toContain('booked');
  });

  it('sends exactly one message for one inbound', async () => {
    await offerSubstitutes();
    const before = db.tables.messages.filter(m => m.direction === 'OUT').length;
    const out = await inbound('1');
    const action = decideAction({
      enabled: true, intent: out.intent, text: '1',
      requestId: out.requestId, optedOut: out.optedOut, confirmed: out.confirmed, selection: out.selection,
    });
    // deno-lint-ignore no-explicit-any
    await performAction(db as any, adapter, action, {
      renterId: out.renterId, requestId: out.requestId, providerMessageId: 'wamid.one',
    });
    const after = db.tables.messages.filter(m => m.direction === 'OUT').length;
    expect(after - before).toBe(1);
  });

  it('will not act on a pick from someone who opted out', async () => {
    await offerSubstitutes();
    await inbound('dừng');
    const out = await inbound('1');
    const action = decideAction({
      enabled: true, intent: out.intent, text: '1',
      requestId: out.requestId, optedOut: true, confirmed: out.confirmed, selection: out.selection,
    });
    expect(action.kind).toBe('NONE');
    expect(db.tables.viewing_requests).toHaveLength(1);
  });
});
