// The dress rehearsal: the whole renter-facing conversation, printed.
//
// roundtrip.test.ts proves the flow composes. This one exists to show the
// WORDS, because the thing no assertion catches is copy that is correct and
// reads badly - and after WHATSAPP_MODE=cloud there is no rehearsal left:
// /dev/phone refuses to run against a live number, by design.
//
// Silent by default; set REHEARSAL_PRINT=1 to read the transcript:
//
//   REHEARSAL_PRINT=1 npx vitest run rehearsal
//
// The assertions run either way, so this cannot rot into a script nobody
// executes. It drives the same FakeDb, MockAdapter and deliver() the demo
// uses - not a retelling of the flow written to look good.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { deliver } from './deliver.ts';
import { handleInbound } from './routing.ts';
import { intakeEvents, buildDeepLink, generateRef } from './intake.ts';
import { validateOutcome, outcomePayload, opsActor } from './outcomes.ts';
import { reduceRequest, summarise, type DomainEvent } from '../viewing-domain.ts';

const PHONE = '+84901234567';
// Deliberately NOT the +84000000000 default: a rehearsal that silently used
// the placeholder would rehearse the exact failure we are trying to avoid.
const BUSINESS = '+84901112222';
const PRINT = process.env.REHEARSAL_PRINT === '1';

const log = (...a: unknown[]) => { if (PRINT) console.log(...a); };

function say(who: string, body: string) {
  if (!PRINT) return;
  const rule = '─'.repeat(64);
  console.log(`\n${rule}\n  ${who}\n${rule}`);
  console.log(body.split('\n').map(l => '  ' + l).join('\n'));
}

let db: FakeDb;
let adapter: MockAdapter;
let store: SupabaseMessageStore;
let requestId: string;
let ref: string;
let itemIds: string[];

function seed() {
  db = new FakeDb();
  adapter = new MockAdapter();
  // deno-lint-ignore no-explicit-any
  store = new SupabaseMessageStore(db as any);

  const listings = [
    { title: 'Sunny 2BR in Thao Dien', district: 'HCM-D2', price: 15_000_000 },
    { title: 'Studio near Ben Thanh', district: 'HCM-D1', price: 16_000_000 },
    { title: 'Quiet 1BR, Phu Nhuan', district: 'HCM-PN', price: 17_000_000 },
    { title: 'Riverside 2BR, Binh Thanh', district: 'HCM-BT', price: 18_000_000 },
    { title: 'Loft in District 3', district: 'HCM-D3', price: 19_000_000 },
  ];
  listings.forEach((l, i) => {
    db.tables.external_properties.push({
      id: `listing-${i + 1}`, title: l.title, district_code: l.district,
      price_vnd: l.price, is_active: true, bedrooms: 2, area_sqm: 70,
      price_confidence: 'HIGH',
    });
  });

  db.tables.renters.push({
    id: 'renter-1', phone_e164: PHONE,
    service_window_expires_at: null, opted_out_at: null,
  });

  ref = generateRef();
  requestId = 'request-1';
  db.tables.viewing_requests.push({
    id: requestId, ref, renter_id: 'renter-1',
    availability: [{ date: '2026-09-19', part: 'MORNING' },
                   { date: '2026-09-19', part: 'AFTERNOON' }],
    created_at: new Date('2026-09-16T00:00:00Z').toISOString(),
  });

  itemIds = [];
  listings.forEach((l, i) => {
    const id = `item-${i + 1}`;
    itemIds.push(id);
    db.tables.request_items.push({
      id, request_id: requestId, listing_id: `listing-${i + 1}`,
      realtor_id: null, price_vnd_at_request: l.price, sort_order: i,
    });
  });

  for (const e of intakeEvents({
    requestId,
    availability: [{ date: '2026-09-19', part: 'MORNING' }],
    items: itemIds.map((itemId, i) => ({
      itemId, listingId: `listing-${i + 1}`,
      priceVndAtRequest: listings[i].price, realtorId: null,
    })),
  })) {
    db.tables.events.push({ ...e, occurred_at: new Date('2026-09-16T00:00:00Z').toISOString() });
  }
}

const view = () => reduceRequest(requestId, db.tables.events as unknown as DomainEvent[]);

function record(itemId: string, submission: Parameters<typeof validateOutcome>[0]) {
  const v = validateOutcome(submission, { priorNudges: 0 });
  if (!v.ok) throw new Error(`illegal outcome: ${v.error}`);
  db.tables.events.push({
    request_id: requestId, item_id: itemId, type: 'OUTCOME_RECORDED',
    payload: outcomePayload(v.value), actor: opsActor('ops-user-1'),
    occurred_at: new Date().toISOString(),
  });
}

const inbound = (text: string) =>
  // deno-lint-ignore no-explicit-any
  handleInbound(db as any, store, {
    from: PHONE, text, providerMessageId: `wamid.${Math.random()}`,
    timestamp: new Date().toISOString(),
  });

describe('dress rehearsal', () => {
  beforeEach(seed);

  it('plays the whole conversation a renter actually sees', async () => {
    log('\n\n╔══════════════════════════════════════════════════════════════╗');
    log(`║  REHEARSAL - request ${ref.padEnd(40)}║`);
    log('╚══════════════════════════════════════════════════════════════╝');

    // 1. The deep link. This is the only thing that opens the window.
    const link = buildDeepLink(BUSINESS, ref);
    log(`\n  The link on the confirmation page:\n  ${link}`);
    expect(link).toContain(BUSINESS.replace('+', ''));

    const handshakeText = decodeURIComponent(link.split('?text=')[1]);
    say(`RENTER → us  (taps the link)`, handshakeText);
    await inbound(handshakeText);
    expect(db.tables.renters[0].service_window_expires_at).toBeTruthy();
    log(`\n  → window open until ${db.tables.renters[0].service_window_expires_at}`);
    expect(view().state).toBe('SUBMITTED');

    // 2. Ops works the five. Partial success is the happy path (CLAUDE.md §5).
    record(itemIds[0], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-19T02:00:00Z', durationMinutes: 30 }] });
    record(itemIds[1], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-19T04:00:00Z', durationMinutes: 30 }] });
    record(itemIds[2], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-19T07:00:00Z', durationMinutes: 30 }] });
    record(itemIds[3], { outcome: 'ALREADY_RENTED' });
    record(itemIds[4], { outcome: 'PRICE_CHANGED', actualPriceVnd: 25_000_000 });

    const s = summarise(view());
    log(`\n  Ops recorded 5 outcomes: ${s.confirmed} confirmed, ${s.total - s.confirmed} not.`);
    expect(s).toMatchObject({ total: 5, confirmed: 3, isPartial: true });

    // 3. ONE message carrying everything.
    // deno-lint-ignore no-explicit-any
    const result = await deliver(db as any, adapter, {
      requestId, purpose: 'ITINERARY',
      order: [itemIds[0], itemIds[1], itemIds[2]],
      actor: opsActor('ops-user-1'),
    });
    expect(result.ok).toBe(true);

    const outbound = db.tables.messages.filter(m => m.direction === 'OUT');
    say('us → RENTER  (the itinerary)', String(outbound[0].body));

    // The rule the whole send service exists to hold.
    expect(outbound).toHaveLength(1);
    log(`\n  → ${outbound.length} outbound message, not ${s.confirmed}.`);

    // 4. One tap back.
    say('RENTER → us', 'yes please');
    const reply = await inbound('yes please');
    expect(reply.confirmed).toBe(true);
    expect(view().state).toBe('CONFIRMED');
    log(`\n  → state: ${view().state}\n`);
  });

  it('plays the zero-confirmed path, which is the one that has to read well', async () => {
    log('\n\n  ── Nothing could be confirmed ───────────────────────────────');
    await inbound(decodeURIComponent(buildDeepLink(BUSINESS, ref).split('?text=')[1]));
    for (const id of itemIds) record(id, { outcome: 'ALREADY_RENTED' });

    // deno-lint-ignore no-explicit-any
    const result = await deliver(db as any, adapter, {
      // Not a purpose of its own: no-supply is ITINERARY with nothing
      // confirmed, which is how deliver() reaches renderNoSupply.
      requestId, purpose: 'ITINERARY', order: [], actor: opsActor('ops-user-1'),
    });
    expect(result.ok).toBe(true);

    const body = String(db.tables.messages.filter(m => m.direction === 'OUT').pop()!.body);
    say('us → RENTER  (no supply)', body);

    // The promise this message makes must be one something can keep.
    expect(body).not.toMatch(/\bbook(ed|ing)\b/i);
  });

  it('plays the two alternative paths: offered times beside a plan, and instead of one', async () => {
    log('\n\n  ── Agents offered other times ───────────────────────────────');
    await inbound(decodeURIComponent(buildDeepLink(BUSINESS, ref).split('?text=')[1]));
    record(itemIds[0], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-19T02:00:00Z', durationMinutes: 30 }] });
    record(itemIds[1], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-19T04:00:00Z', durationMinutes: 30 }] });
    record(itemIds[2], { outcome: 'ALTERNATIVE_OFFERED', slots: [
      { startsAt: '2026-09-20T03:00:00Z', durationMinutes: 30 },
      { startsAt: '2026-09-21T08:30:00Z', durationMinutes: 30 },
    ] });
    record(itemIds[3], { outcome: 'ALREADY_RENTED' });
    record(itemIds[4], { outcome: 'UNAVAILABLE_DATE' });

    // deno-lint-ignore no-explicit-any
    const withPlan = await deliver(db as any, adapter, {
      requestId, purpose: 'ITINERARY', order: [itemIds[0], itemIds[1]], actor: opsActor('ops-user-1'),
    });
    expect(withPlan.ok).toBe(true);
    const plan = String(db.tables.messages.filter(m => m.direction === 'OUT').pop()!.body);
    say('us → RENTER  (plan, plus other times offered)', plan);
    expect(plan).toContain('offered different times');
    expect(plan).not.toMatch(/\bbook(ed|ing)\b/i);

    // Nothing at their times: the offers are the message.
    seed();
    await inbound(decodeURIComponent(buildDeepLink(BUSINESS, ref).split('?text=')[1]));
    record(itemIds[0], { outcome: 'ALTERNATIVE_OFFERED', slots: [{ startsAt: '2026-09-20T03:00:00Z', durationMinutes: 30 }] });
    record(itemIds[1], { outcome: 'ALTERNATIVE_OFFERED', slots: [{ startsAt: '2026-09-22T11:00:00Z', durationMinutes: 30 }] });
    for (const id of itemIds.slice(2)) record(id, { outcome: 'ALREADY_RENTED' });
    // deno-lint-ignore no-explicit-any
    const offersOnly = await deliver(db as any, adapter, {
      requestId, purpose: 'ITINERARY', order: [], actor: opsActor('ops-user-1'),
    });
    expect(offersOnly.ok).toBe(true);
    const body = String(db.tables.messages.filter(m => m.direction === 'OUT').pop()!.body);
    say('us → RENTER  (only other times offered)', body);
    expect(body).toContain('offered other times');
    expect(body).not.toMatch(/close matches/);
  });
});
