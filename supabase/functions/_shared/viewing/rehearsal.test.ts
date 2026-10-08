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
import { deliver, releaseHeldItinerary } from './deliver.ts';
import { sendViewingDay } from './viewing-day.ts';
import { handleInbound } from './routing.ts';
import { intakeEvents, buildDeepLink, generateRef } from './intake.ts';
import { validateOutcome, outcomePayload, opsActor } from './outcomes.ts';
import { reduceRequest, summarise, type DomainEvent } from '../viewing-domain.ts';
import { decideAction } from './agent.ts';
import { performAction } from './agent-act.ts';
import { loadLockIn, lockIn } from './lock-in-run.ts';
import { lockInAfterPurchase } from './lock-in-run.ts';
import { realtorDecisionsOwed } from './reminders.ts';

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
    { title: 'Sunny 2BR in Thao Dien', district: 'D2', price: 15_000_000 },
    { title: 'Studio near Ben Thanh', district: 'D1', price: 16_000_000 },
    { title: 'Quiet 1BR, Phu Nhuan', district: 'PHU_NHUAN', price: 17_000_000 },
    { title: 'Riverside 2BR, Binh Thanh', district: 'BINH_THANH', price: 18_000_000 },
    { title: 'Loft in District 3', district: 'D3', price: 19_000_000 },
  ];
  listings.forEach((l, i) => {
    db.tables.external_properties.push({
      id: `listing-${i + 1}`, title: l.title, district_code: l.district,
      price_vnd: l.price, is_active: true, bedrooms: 2, area_sqm: 70,
      price_confidence: 'HIGH',
    });
  });

  // Signed up, no Pass: how every renter starts since the pricing rework
  // (SPEC §9).
  db.tables.renters.push({
    id: 'renter-1', phone_e164: PHONE, user_id: 'user-1',
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
    const first = await inbound(handshakeText);
    expect(db.tables.renters[0].service_window_expires_at).toBeTruthy();
    log(`\n  → window open until ${db.tables.renters[0].service_window_expires_at}`);
    expect(view().state).toBe('SUBMITTED');

    // The receipt: the one answer the first message gets, agent on or off.
    const receipt = decideAction({
      enabled: false, intent: first.intent, text: handshakeText, requestId: first.requestId,
      optedOut: first.optedOut, confirmed: first.confirmed, received: first.received,
    });
    expect(receipt.kind).toBe('REQUEST_RECEIVED');
    // deno-lint-ignore no-explicit-any
    await performAction(db as any, adapter, receipt, {
      renterId: first.renterId, requestId: first.requestId, providerMessageId: 'wamid.handshake',
    });
    const receiptBody = String(db.tables.messages.filter(m => m.direction === 'OUT').pop()!.body);
    say('us → RENTER  (the receipt)', receiptBody);
    expect(receiptBody).toContain(`Thanks - we have your request ${ref} for 5 places:`);
    expect(receiptBody).not.toMatch(/book/i);

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

    // After the receipt, which answered the renter's own message.
    const outbound = db.tables.messages.filter(m => m.direction === 'OUT').slice(1);
    say('us → RENTER  (the itinerary)', String(outbound[0].body));

    // The rule the whole send service exists to hold.
    expect(outbound).toHaveLength(1);
    log(`\n  → ${outbound.length} outbound message, not ${s.confirmed}.`);

    // The plan is the pitch: places and times, no agent. And for a renter
    // without the Pass, where to lock it in and what that costs.
    expect(String(outbound[0].body)).toContain(`https://hausto.com/lock-in/${ref}`);
    expect(String(outbound[0].body)).toContain('Your first viewing is on us');
    expect(String(outbound[0].body)).not.toContain('Reply YES');

    // 4. A "yes" anyway. It cannot lock the plan in - the free viewing is one
    // place they choose, the Pass is a payment - so the one answer is where to.
    say('RENTER → us', 'yes please');
    const reply = await inbound('yes please');
    expect(reply.confirmed).toBe(false);
    const action = decideAction({
      enabled: false, intent: reply.intent, text: 'yes please', requestId: reply.requestId,
      optedOut: reply.optedOut, confirmed: reply.confirmed, lockIn: reply.lockIn,
    });
    expect(action.kind).toBe('LOCK_IN_LINK');
    // deno-lint-ignore no-explicit-any
    await performAction(db as any, adapter, action, {
      renterId: reply.renterId, requestId: reply.requestId, providerMessageId: 'wamid.yes',
    });
    const answer = db.tables.messages.filter(m => m.direction === 'OUT').pop()!;
    say('us → RENTER  (where to lock in)', String(answer.body));
    expect(view().state).toBe('DELIVERED');

    // 5. On the page they take the Pass, for all three. The checkout is opened
    // from the page (create-pass-order logs it), and the purchase - recorded by
    // the redirect or the webhook - locks the plan in. Confirmed on the web:
    // nothing goes on WhatsApp, or the morning-of message would be a third in
    // a row.
    const before = db.tables.messages.length;
    db.tables.events.push({
      request_id: requestId, type: 'LOCK_IN_CHECKOUT_OPENED',
      payload: { checkout_id: 'chk-1', expires_at: new Date(Date.now() + 3600_000).toISOString() },
      actor: 'RENTER', occurred_at: new Date().toISOString(),
    });
    db.passHolders.add('user-1');
    // deno-lint-ignore no-explicit-any
    const locked = await lockInAfterPurchase(db as any, { requestId, checkoutId: 'chk-1', userId: 'user-1' });
    expect(locked).toMatchObject({ ok: true, cover: 'PASS' });
    expect(view().state).toBe('CONFIRMED');
    expect(view().confirmedItemIds).toHaveLength(3);
    expect(db.tables.messages.length).toBe(before);
    log(`\n  → paid on the web, all 3 locked in; state: ${view().state}; nothing sent on WhatsApp\n`);

    // 5. The morning of. The first agent agreed to their number going out; the
    // second gave a meeting point but not their number; the third said
    // nothing, so the renter gets the listing's location and us.
    db.tables.realtors = [
      { id: 'agent-1', phone_e164: '+84903334444', display_name: 'Minh' },
      { id: 'agent-2', phone_e164: '+84905556666', display_name: 'Lan' },
    ];
    db.tables.request_items[0].realtor_id = 'agent-1';
    db.tables.request_items[1].realtor_id = 'agent-2';
    db.tables.external_properties[2].location = 'Street Phan Xich Long, Ward 2, Phu Nhuan, Ho Chi Minh City';
    const details = (itemId: string, payload: Record<string, unknown>) => db.tables.events.push({
      request_id: requestId, item_id: itemId, type: 'VIEWING_DETAILS_RECORDED', payload,
      actor: opsActor('ops-user-1'), occurred_at: new Date().toISOString(),
    });
    details(itemIds[0], { meeting_point: 'Lobby of block B, 12 Thao Dien Street', agent_first_name: 'Minh', share_phone: true });
    details(itemIds[1], { meeting_point: 'Front gate, 45 Le Loi, District 1', agent_first_name: 'Lan', share_phone: false });

    const morning = new Date('2026-09-19T00:30:00Z'); // 07:30 in Ho Chi Minh City
    // deno-lint-ignore no-explicit-any
    const day = await sendViewingDay(db as any, adapter, { requestId, now: morning });
    expect(day).toMatchObject({ ok: true, via: 'FREE_FORM', stops: 3 });
    const dayText = String(db.tables.messages.filter(m => m.direction === 'OUT').pop()!.body);
    say('us → RENTER  (the morning of the viewings)', dayText);
    expect(dayText).toContain('+84 90 333 4444');
    expect(dayText).not.toContain('555');

    // The same day with the window shut - days after the "yes", the usual case -
    // goes as the approved viewing_reminder template.
    db.tables.events = db.tables.events.filter(e => e.type !== 'VIEWING_DAY_SENT');
    db.tables.messages = [];
    db.tables.renters[0].service_window_expires_at = null;
    // deno-lint-ignore no-explicit-any
    const shut = await sendViewingDay(db as any, adapter, { requestId, now: morning, attempt: 2 });
    expect(shut).toMatchObject({ ok: true, via: 'TEMPLATE' });
    const params = adapter.delivered[adapter.delivered.length - 1].templateParams ?? [];
    say('us → RENTER  (the same morning, window shut: viewing_reminder)',
      `Hi ${params[0]}, a reminder that your viewing is ${params[1]} at ${params[2]}. ` +
      'Reply here if anything has changed and we will rearrange it.');
  });

  it('plays the free viewing: one place, picked on the page', async () => {
    log('\n\n  ── The free viewing ─────────────────────────────────────────');
    await inbound(decodeURIComponent(buildDeepLink(BUSINESS, ref).split('?text=')[1]));
    record(itemIds[0], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-19T02:00:00Z', durationMinutes: 30 }] });
    record(itemIds[1], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-19T04:00:00Z', durationMinutes: 30 }] });
    for (const id of itemIds.slice(2)) record(id, { outcome: 'ALREADY_RENTED' });
    // deno-lint-ignore no-explicit-any
    await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order: [itemIds[0], itemIds[1]] });

    // The page: the free viewing covers the one place they pick.
    // deno-lint-ignore no-explicit-any
    const ctx = (await loadLockIn(db as any, { requestId }, Date.now()))!;
    expect(ctx.status).toBe('OPEN');
    // deno-lint-ignore no-explicit-any
    const kept = await lockIn(db as any, ctx, {
      userId: 'user-1', choice: { cover: 'FREE_VIEWING', itemId: itemIds[1] }, actor: 'RENTER', now: Date.now(),
    });
    expect(kept).toMatchObject({ ok: true, cover: 'FREE_VIEWING', confirmedItemIds: [itemIds[1]] });
    log(`\n  → locked in with the free viewing: ${ctx.stops.find(s => s.itemId === itemIds[1])!.title}`);

    // The agent of the place they kept is told to expect them; the other, to
    // stand down.
    const owed = realtorDecisionsOwed(view());
    expect(owed).toEqual(expect.arrayContaining([
      { itemId: itemIds[1], decision: 'CONFIRM' },
      { itemId: itemIds[0], decision: 'RELEASE' },
    ]));

    // And the number has had its free viewing.
    // deno-lint-ignore no-explicit-any
    expect(db.tables.free_viewings).toHaveLength(1);
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
  it('plays the itinerary with the window shut: the template, then the plan on their reply', async () => {
    // The bodies as Meta approved them (docs/whatsapp-go-live.md). The send
    // carries only the parameters, so the rehearsal fills them in.
    const BODIES: Record<string, (p: string[]) => string> = {
      itinerary_ready: p => `Hi ${p[0]}, good news - ${p[1]} of your viewings are confirmed. The first is ${p[2]}. ` +
        'Reply here and we will send you the full schedule with addresses.',
      no_supply_substitutes: p => `Hi ${p[0]}, an update on request ${p[1]} - none of the places you picked could be ` +
        'confirmed for your times. We have found some close matches. Reply here and we will send them over.',
      request_update: p => `Hi ${p[0]}, we have an update on your request for ${p[1]}. Reply here to see it.`,
    };
    const template = () => {
      const d = adapter.delivered[adapter.delivered.length - 1];
      return BODIES[String(d.templateName)](d.templateParams ?? []);
    };
    const lastBody = () => String(db.tables.messages.filter(m => m.direction === 'OUT').pop()!.body);
    const shutAndSend = async (order: string[]) => {
      db.tables.renters[0].service_window_expires_at = null;
      // deno-lint-ignore no-explicit-any
      const r = await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY', order, actor: opsActor('ops-user-1') });
      expect(r).toMatchObject({ ok: true, held: true });
    };
    const reply = async (text: string) => {
      say('RENTER → us', text);
      await inbound(text);
      // deno-lint-ignore no-explicit-any
      const released = await releaseHeldItinerary(db as any, adapter, db.tables.renters[0].id as string);
      expect(released?.result).toMatchObject({ ok: true, held: false });
    };

    log('\n\n  ── The plan, with the window shut ───────────────────────────');
    await inbound(decodeURIComponent(buildDeepLink(BUSINESS, ref).split('?text=')[1]));
    record(itemIds[0], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-19T02:00:00Z', durationMinutes: 30 }] });
    record(itemIds[1], { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-19T04:00:00Z', durationMinutes: 30 }] });
    for (const id of itemIds.slice(2)) record(id, { outcome: 'ALREADY_RENTED' });
    await shutAndSend([itemIds[0], itemIds[1]]);
    say('us → RENTER  (window shut: itinerary_ready)', template());
    await reply('ok great');
    say('us → RENTER  (the plan, released by their reply)', lastBody());
    expect(view().state).toBe('DELIVERED');

    log('\n\n  ── Nothing confirmed, with the window shut ──────────────────');
    seed();
    await inbound(decodeURIComponent(buildDeepLink(BUSINESS, ref).split('?text=')[1]));
    for (const id of itemIds) record(id, { outcome: 'ALREADY_RENTED' });
    await shutAndSend([]);
    say(`us → RENTER  (window shut: ${adapter.delivered[adapter.delivered.length - 1].templateName})`, template());
    await reply('oh no, what else is there?');
    say('us → RENTER  (released by their reply)', lastBody());

    log('\n\n  ── Other times offered, with the window shut ────────────────');
    seed();
    await inbound(decodeURIComponent(buildDeepLink(BUSINESS, ref).split('?text=')[1]));
    record(itemIds[0], { outcome: 'ALTERNATIVE_OFFERED', slots: [{ startsAt: '2026-09-20T03:00:00Z', durationMinutes: 30 }] });
    for (const id of itemIds.slice(1)) record(id, { outcome: 'ALREADY_RENTED' });
    await shutAndSend([]);
    expect(adapter.delivered[adapter.delivered.length - 1].templateName).toBe('request_update');
    say('us → RENTER  (window shut: request_update)', template());
    await reply('hi');
    say('us → RENTER  (released by their reply)', lastBody());
    expect(lastBody()).not.toMatch(/\bbook(ed|ing)\b/i);
  });
});
