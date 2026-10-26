// The operator's actions, end to end against the in-memory database.
//
// These are the tools the AI operator will call, so what is asserted here is
// what either kind of operator can and cannot do: every action writes typed
// events and never a status, every message is a row before it counts as sent,
// and nothing about the renter reaches a broker.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { ManualChannel } from '../realtor/channel.ts';
import { SupabaseRealtorMessageStore } from '../realtor/store.ts';
import { performOpsAction, type OpsDeps } from './ops-actions.ts';
import { handleInbound } from './routing.ts';
import { waitingReplies } from './thread.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';

const ACTOR = 'OPS:op-1';
const RENTER_PHONE = '+84912345678';
const SLOT = { startsAt: '2026-09-28T03:00:00.000Z', durationMinutes: 30 };

let db: FakeDb;
let deps: OpsDeps;
let whatsapp: MockAdapter;
let channel: ManualChannel;
let keys = 0;

// deno-lint-ignore no-explicit-any
const act = (input: Record<string, unknown>) => performOpsAction(db as any, deps, ACTOR, input);
const eventsOf = (type: string) => db.tables.events.filter(e => e.type === type);
const view = () => reduceRequest('req-1', db.tables.events as unknown as DomainEvent[]);

let clock = 0;
/** Seeded events get explicit, increasing times so replay order is the written order. */
function seedEvent(type: string, payload: Record<string, unknown> = {}, itemId: string | null = null) {
  clock += 1;
  db.tables.events.push({
    id: `seed${clock}`,
    request_id: 'req-1',
    item_id: itemId,
    type,
    payload,
    actor: 'SYSTEM',
    occurred_at: new Date(Date.parse('2026-09-25T00:00:00Z') + clock * 1000).toISOString(),
  });
}

beforeEach(() => {
  db = new FakeDb();
  whatsapp = new MockAdapter();
  channel = new ManualChannel();
  keys = 0;
  clock = 0;
  deps = {
    whatsapp,
    // deno-lint-ignore no-explicit-any
    messages: new SupabaseMessageStore(db as any),
    realtorChannel: channel,
    // deno-lint-ignore no-explicit-any
    realtorMessages: new SupabaseRealtorMessageStore(db as any),
    newKey: () => `key-${++keys}`,
  };

  db.tables.renters.push({
    id: 'renter-1', phone_e164: RENTER_PHONE, display_name: 'Tran Thi Lan',
    service_window_expires_at: new Date(Date.now() + 6 * 3600_000).toISOString(), opted_out_at: null,
  });
  db.tables.viewing_requests.push({ id: 'req-1', ref: 'HV-4KX9', renter_id: 'renter-1', created_at: '2026-09-25T00:00:00Z' });
  db.tables.external_properties.push(
    { id: 'l1', title: 'Căn hộ 2PN Thảo Điền', source: 'nhatot', source_agent_id: 'acc-77' },
    { id: 'l2', title: 'Studio Quận 1', source: 'batdongsan', source_agent_id: null },
  );
  db.tables.request_items.push(
    { id: 'i1', request_id: 'req-1', listing_id: 'l1', realtor_id: null, price_vnd_at_request: 15_000_000 },
    { id: 'i2', request_id: 'req-1', listing_id: 'l2', realtor_id: null, price_vnd_at_request: 9_000_000 },
  );
  seedEvent('REQUEST_SUBMITTED');
  seedEvent('ITEM_ADDED', { listing_id: 'l1' }, 'i1');
  seedEvent('ITEM_ADDED', { listing_id: 'l2' }, 'i2');
});

describe('contacting a broker', () => {
  it('stores the words sent and points the event at them', async () => {
    const r = await act({ action: 'CONTACTED', itemId: 'i1', channel: 'ZALO', message: 'Chào anh, căn còn không ạ?' });
    expect(r.status).toBe(200);

    const [row] = db.tables.realtor_messages;
    expect(row).toMatchObject({ direction: 'OUT', purpose: 'REQUEST_VIEWING', status: 'SENT', actor: ACTOR });
    expect(eventsOf('REALTOR_CONTACTED')[0]).toMatchObject({
      item_id: 'i1', actor: ACTOR, payload: { channel: 'ZALO', draft_id: row.id },
    });
    expect(view().items.i1.state).toBe('CONTACTED');
  });

  it("refuses a message carrying the renter's number or name, and records nothing", async () => {
    for (const message of ['Khách số 0912 345 678', 'Khách tên Tran Thi Lan muốn xem']) {
      const r = await act({ action: 'CONTACTED', itemId: 'i1', message });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('renter_identity');
    }
    expect(db.tables.realtor_messages ?? []).toHaveLength(0);
    expect(eventsOf('REALTOR_CONTACTED')).toHaveLength(0);
  });

  it('files the event against the request the item belongs to, whatever the body claims', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', requestId: 'someone-else', message: 'Chào anh' });
    expect(eventsOf('REALTOR_CONTACTED')[0].request_id).toBe('req-1');
  });
});

describe('chasing and hearing back', () => {
  it('numbers each nudge, stores each one, and clears the to-do', async () => {
    db.tables.jobs.push({ id: 'j1', kind: 'NUDGE_REALTOR', payload: { request_id: 'req-1', item_id: 'i1' }, completed_at: null });
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    await act({ action: 'NUDGE', itemId: 'i1', message: 'Em nhắn lại ạ' });
    await act({ action: 'NUDGE', itemId: 'i1', message: 'Em nhắn lại lần nữa ạ' });

    expect(eventsOf('ITEM_NUDGED').map(e => (e.payload as { attempt: number }).attempt)).toEqual([1, 2]);
    expect(db.tables.realtor_messages.filter(m => m.purpose === 'NUDGE')).toHaveLength(2);
    expect(db.tables.jobs[0].completed_at).not.toBeNull();
  });

  it("pairs the broker's reply with the outcome read from it", async () => {
    const r = await act({
      action: 'OUTCOME', itemId: 'i1', outcome: 'CONFIRMED', slots: [SLOT],
      realtorReply: 'Còn em, 10h thứ 2 được nhé', note: 'friendly',
    });
    expect(r.status).toBe(200);
    const reply = db.tables.realtor_messages.find(m => m.direction === 'IN')!;
    expect(reply).toMatchObject({ purpose: 'REPLY', status: 'RECEIVED', body: 'Còn em, 10h thứ 2 được nhé' });
    expect(eventsOf('OUTCOME_RECORDED')[0].payload).toMatchObject({ outcome: 'CONFIRMED', reply_message_id: reply.id });
  });

  it('stores a reply that settles nothing without touching state', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    const before = view();
    const r = await act({ action: 'REALTOR_REPLY', itemId: 'i1', message: 'Để anh hỏi chủ nhà đã' });
    expect(r.status).toBe(200);
    expect(view()).toEqual(before);
  });

  it('still refuses an outcome outside the seven, reply or not', async () => {
    const r = await act({ action: 'OUTCOME', itemId: 'i1', outcome: 'MAYBE', realtorReply: 'hmm' });
    expect(r.status).toBe(400);
    expect(db.tables.realtor_messages ?? []).toHaveLength(0);
  });

  it('files the re-resolution to-do where the console will show it', async () => {
    await act({ action: 'OUTCOME', itemId: 'i1', outcome: 'UNREACHABLE' });
    expect(db.tables.jobs[0]).toMatchObject({
      kind: 'RESOLVE_REALTOR', payload: { request_id: 'req-1', item_id: 'i1', listing_id: 'l1' },
    });
  });
});

describe('saving a number the operator found', () => {
  it('normalises it, attaches it to the item, and enriches every future listing', async () => {
    db.tables.jobs.push({ id: 'j1', kind: 'RESOLVE_REALTOR', payload: { request_id: 'req-1', item_id: 'i1' }, completed_at: null });
    const r = await act({ action: 'RECORD_CONTACT', itemId: 'i1', phone: '090 123 4567', name: 'Anh Hùng' });
    expect(r.status).toBe(200);

    const [realtor] = db.tables.realtors;
    expect(realtor).toMatchObject({ phone_e164: '+84901234567', display_name: 'Anh Hùng' });
    expect(db.tables.request_items.find(i => i.id === 'i1')!.realtor_id).toBe(realtor.id);
    expect(eventsOf('REALTOR_RESOLVED')[0].payload).toEqual({ realtor_id: realtor.id, method: 'MANUAL' });
    expect(db.tables.external_properties.find(p => p.id === 'l1')!.realtor_id).toBe(realtor.id);
    expect(db.tables.realtor_identities).toEqual([
      expect.objectContaining({ realtor_id: realtor.id, source: 'nhatot', source_agent_id: 'acc-77' }),
    ]);
    expect(db.tables.jobs[0].completed_at).not.toBeNull();
    expect(view().items.i1.realtorId).toBe(realtor.id);
  });

  it('reuses the broker it already knows by number', async () => {
    await act({ action: 'RECORD_CONTACT', itemId: 'i1', phone: '0901234567' });
    await act({ action: 'RECORD_CONTACT', itemId: 'i2', phone: '+84 90 123 45 67' });
    expect(db.tables.realtors).toHaveLength(1);
  });

  it('refuses something that is not a Vietnamese mobile number', async () => {
    const r = await act({ action: 'RECORD_CONTACT', itemId: 'i1', phone: '12345' });
    expect(r.status).toBe(400);
    expect(db.tables.realtors ?? []).toHaveLength(0);
  });
});

describe("telling the broker the renter's decision", () => {
  const confirmRequest = async () => {
    await act({ action: 'OUTCOME', itemId: 'i1', outcome: 'CONFIRMED', slots: [SLOT] });
    await act({ action: 'OUTCOME', itemId: 'i2', outcome: 'ALTERNATIVE_OFFERED', slots: [SLOT] });
    seedEvent('ITINERARY_DELIVERED', { message_id: 'm1' });
    clock += 10_000; // after the outcomes the fake stamped with the real clock
    db.tables.events.push({
      id: 'confirm', request_id: 'req-1', item_id: null, type: 'REQUEST_CONFIRMED',
      payload: { confirmed_item_ids: ['i1'] }, actor: 'RENTER', occurred_at: new Date(Date.now() + 60_000).toISOString(),
    });
  };

  it('refuses before the renter has decided', async () => {
    await act({ action: 'OUTCOME', itemId: 'i1', outcome: 'CONFIRMED', slots: [SLOT] });
    const r = await act({ action: 'NOTIFY_REALTOR', itemId: 'i1', decision: 'CONFIRM', message: 'Khách chốt rồi ạ' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('not_owed');
  });

  it('confirms the kept viewing and releases the other, once each', async () => {
    await confirmRequest();

    const wrong = await act({ action: 'NOTIFY_REALTOR', itemId: 'i2', decision: 'CONFIRM', message: 'Khách chốt ạ' });
    expect(wrong.body.error).toBe('wrong_decision');

    expect((await act({ action: 'NOTIFY_REALTOR', itemId: 'i1', decision: 'CONFIRM', message: 'Khách chốt ạ' })).status).toBe(200);
    expect((await act({ action: 'NOTIFY_REALTOR', itemId: 'i2', decision: 'RELEASE', message: 'Không cần giữ lịch ạ' })).status).toBe(200);

    expect(view().items.i1.notified).toBe('CONFIRM');
    expect(view().items.i2.notified).toBe('RELEASE');
    expect(view().state).toBe('CONFIRMED');

    const again = await act({ action: 'NOTIFY_REALTOR', itemId: 'i1', decision: 'CONFIRM', message: 'Khách chốt ạ' });
    expect(again.status).toBe(409);
  });
});

describe('answering the renter', () => {
  it('sends inside the window, logs REPLY_SENT, and clears what was waiting', async () => {
    seedEvent('RENTER_REPLIED', { intent: 'QUESTION', message_id: 'in-1' });
    const r = await act({ action: 'REPLY', requestId: 'req-1', clientKey: 'compose-0001', message: 'Yes, pets are fine there.' });
    expect(r.status).toBe(200);

    expect(whatsapp.delivered).toHaveLength(1);
    expect(db.tables.messages[0]).toMatchObject({ direction: 'OUT', body: 'Yes, pets are fine there.', status: 'SENT' });
    expect(eventsOf('REPLY_SENT')[0]).toMatchObject({ actor: ACTOR, payload: { message_id: db.tables.messages[0].id } });
    expect(waitingReplies(db.tables.events as unknown as DomainEvent[])).toEqual([]);
  });

  it('is one message and one event however many times it is retried', async () => {
    const input = { action: 'REPLY', requestId: 'req-1', clientKey: 'compose-0001', message: 'On it.' };
    await act(input);
    await act(input);
    expect(whatsapp.delivered).toHaveLength(1);
    expect(eventsOf('REPLY_SENT')).toHaveLength(1);
  });

  it('refuses when the window is closed, and sends nothing', async () => {
    db.tables.renters[0].service_window_expires_at = new Date(Date.now() - 1000).toISOString();
    const r = await act({ action: 'REPLY', requestId: 'req-1', clientKey: 'compose-0001', message: 'Hello again' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('window_closed');
    expect(whatsapp.delivered).toHaveLength(0);
    expect(eventsOf('REPLY_SENT')).toHaveLength(0);
  });

  it("refuses a broker's number on its way to the renter", async () => {
    const r = await act({ action: 'REPLY', requestId: 'req-1', clientKey: 'compose-0001', message: 'Call him: 0901234567' });
    expect(r.status).toBe(400);
    expect(whatsapp.delivered).toHaveLength(0);
  });

  it('refuses a send with no idempotency key', async () => {
    const r = await act({ action: 'REPLY', requestId: 'req-1', message: 'Hello' });
    expect(r.status).toBe(400);
  });

  it('can mark replies as needing no answer, but only when something is waiting', async () => {
    expect((await act({ action: 'ACK_REPLIES', requestId: 'req-1' })).status).toBe(409);
    seedEvent('RENTER_REPLIED', { intent: 'UNKNOWN', message_id: 'in-1' });
    expect((await act({ action: 'ACK_REPLIES', requestId: 'req-1' })).status).toBe(200);
    expect(waitingReplies(db.tables.events as unknown as DomainEvent[])).toEqual([]);
    expect(whatsapp.delivered).toHaveLength(0);
  });
});

describe('the handshake is not a reply', () => {
  it('flags the first ref-carrying message, and nothing after it', async () => {
    const store = deps.messages;
    const send = (text: string, id: string) =>
      // deno-lint-ignore no-explicit-any
      handleInbound(db as any, store, { from: RENTER_PHONE, text, providerMessageId: id, timestamp: new Date().toISOString() });

    await send('Hi Hausto - my viewing request is HV-4KX9', 'wamid.1');
    await send('HV-4KX9 can we do Saturday instead?', 'wamid.2');

    const replies = eventsOf('RENTER_REPLIED').map(e => e.payload as Record<string, unknown>);
    expect(replies[0].handshake).toBe(true);
    expect(replies[1].handshake).toBeUndefined();
    expect(waitingReplies(db.tables.events as unknown as DomainEvent[])).toHaveLength(1);
  });
});

describe('cancelling a request (gap 9)', () => {
  it('needs a reason from the closed set', async () => {
    const r = await act({ action: 'CANCEL_REQUEST', requestId: 'req-1', reason: 'changed my mind lol' });
    expect(r.status).toBe(400);
    expect(eventsOf('REQUEST_CANCELLED')).toHaveLength(0);
  });

  it('writes REQUEST_CANCELLED, clears queued broker work, and owes every held broker a release', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    await act({ action: 'OUTCOME', itemId: 'i2', outcome: 'ALTERNATIVE_OFFERED', slots: [SLOT] });
    db.tables.jobs.push({ id: 'j1', kind: 'NUDGE_REALTOR', payload: { request_id: 'req-1', item_id: 'i1' }, completed_at: null });

    const r = await act({ action: 'CANCEL_REQUEST', requestId: 'req-1', reason: 'RENTER_FOUND_PLACE', note: 'signed elsewhere' });
    expect(r.status).toBe(200);
    expect(eventsOf('REQUEST_CANCELLED')[0]).toMatchObject({
      actor: ACTOR, payload: { reason: 'RENTER_FOUND_PLACE', note: 'signed elsewhere' },
    });
    expect(view().state).toBe('CANCELLED');
    expect(db.tables.jobs[0].completed_at).not.toBeNull();

    // Both brokers were holding time: one still looking, one with slots offered.
    expect((await act({ action: 'NOTIFY_REALTOR', itemId: 'i1', decision: 'RELEASE', message: 'Không cần giữ ạ' })).status).toBe(200);
    expect((await act({ action: 'NOTIFY_REALTOR', itemId: 'i2', decision: 'RELEASE', message: 'Không cần giữ ạ' })).status).toBe(200);
  });

  it('refuses to cancel twice', async () => {
    await act({ action: 'CANCEL_REQUEST', requestId: 'req-1', reason: 'DUPLICATE' });
    expect((await act({ action: 'CANCEL_REQUEST', requestId: 'req-1', reason: 'DUPLICATE' })).status).toBe(409);
  });
});

describe('what paste-parse suggested travels with the outcome', () => {
  it('is stored beside the operator\'s choice, reduced to what measures agreement', async () => {
    await act({
      action: 'OUTCOME', itemId: 'i1', outcome: 'ALTERNATIVE_OFFERED', slots: [SLOT],
      realtorReply: 'Thứ 7 10h được em',
      suggested: {
        outcome: 'CONFIRMED', slots: [{ startsAt: SLOT.startsAt, durationMinutes: 30 }],
        actualPriceVnd: null, confidence: 'HIGH', model: 'gpt-4o-mini', note: 'free text dropped', problems: ['x'],
      },
    });
    const payload = eventsOf('OUTCOME_RECORDED')[0].payload as Record<string, unknown>;
    expect(payload.outcome).toBe('ALTERNATIVE_OFFERED');
    expect(payload.suggested).toEqual({
      outcome: 'CONFIRMED', slot_starts: [SLOT.startsAt], actual_price_vnd: null, confidence: 'HIGH', model: 'gpt-4o-mini',
    });
  });

  it('drops a suggested outcome outside the seven rather than storing it', async () => {
    await act({ action: 'OUTCOME', itemId: 'i1', outcome: 'ALREADY_RENTED', suggested: { outcome: 'MAYBE' } });
    const payload = eventsOf('OUTCOME_RECORDED')[0].payload as { suggested: { outcome: unknown } };
    expect(payload.suggested.outcome).toBeNull();
  });
});

describe('where to meet on the day (viewing-day.ts)', () => {
  const details = { meetingPoint: 'Lobby of tower L4, 208 Nguyen Huu Canh', agentFirstName: 'Minh', sharePhone: false };

  it('waits for the agent to confirm a time', async () => {
    const r = await act({ action: 'VIEWING_DETAILS', itemId: 'i1', ...details });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('not_confirmed');
    expect(eventsOf('VIEWING_DETAILS_RECORDED')).toHaveLength(0);
  });

  it('records the details as an event that moves nothing', async () => {
    seedEvent('OUTCOME_RECORDED', { outcome: 'CONFIRMED', slots: [{ starts_at: SLOT.startsAt, duration_minutes: 30 }] }, 'i1');
    const r = await act({ action: 'VIEWING_DETAILS', itemId: 'i1', ...details });
    expect(r.status).toBe(200);
    expect(eventsOf('VIEWING_DETAILS_RECORDED')[0]).toMatchObject({
      item_id: 'i1', actor: ACTOR,
      payload: { meeting_point: details.meetingPoint, agent_first_name: 'Minh', share_phone: false },
    });
    expect(view().items.i1).toMatchObject({ state: 'CONFIRMED', details: { sharePhone: false } });
  });

  it('refuses a number typed into the meeting point, and records nothing', async () => {
    seedEvent('OUTCOME_RECORDED', { outcome: 'CONFIRMED', slots: [{ starts_at: SLOT.startsAt, duration_minutes: 30 }] }, 'i1');
    const r = await act({ action: 'VIEWING_DETAILS', itemId: 'i1', ...details, meetingPoint: 'Gate 2, call 0901 234 567' });
    expect(r.status).toBe(400);
    expect(eventsOf('VIEWING_DETAILS_RECORDED')).toHaveLength(0);
  });

  it('cannot promise to share a number nobody has', async () => {
    seedEvent('OUTCOME_RECORDED', { outcome: 'CONFIRMED', slots: [{ starts_at: SLOT.startsAt, duration_minutes: 30 }] }, 'i1');
    const refused = await act({ action: 'VIEWING_DETAILS', itemId: 'i1', ...details, sharePhone: true });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('no_contact');

    await act({ action: 'RECORD_CONTACT', itemId: 'i1', phone: '0901234567', name: 'Minh' });
    const ok = await act({ action: 'VIEWING_DETAILS', itemId: 'i1', ...details, sharePhone: true });
    expect(ok.status).toBe(200);
    expect(view().items.i1.details?.sharePhone).toBe(true);
  });
});

describe('what the agent said about the terms (LEASE_TERMS)', () => {
  const terms = {
    depositMonthsMin: 2, depositMonthsMax: 2, minLeaseMonths: 12, petsAllowed: false,
    availability: null, availableFrom: null,
    fees: [{ kind: 'MANAGEMENT', label: 'Management fee', included: false, amount: '500,000 VND/month' }],
  };

  it('records them as a typed event that moves nothing, in any state', async () => {
    const before = view();
    const r = await act({ action: 'LEASE_TERMS', itemId: 'i1', terms, note: 'said it twice' });
    expect(r.status).toBe(200);
    expect(eventsOf('LEASE_TERMS_RECORDED')[0]).toMatchObject({
      item_id: 'i1', actor: ACTOR,
      payload: {
        deposit_months_min: 2, deposit_months_max: 2, min_lease_months: 12, pets_allowed: false,
        fees: [{ kind: 'MANAGEMENT', label: 'Management fee', included: false, amount: '500,000 VND/month' }],
        note: 'said it twice',
      },
    });
    expect(view().state).toBe(before.state);
    expect(view().items.i1).toMatchObject({ state: 'PENDING', terms: { minLeaseMonths: 12, petsAllowed: false } });
  });

  it('keeps the reply they came from, when it is this item\'s', async () => {
    await act({ action: 'REALTOR_REPLY', itemId: 'i1', message: 'Cọc 2 tháng em' });
    await act({ action: 'REALTOR_REPLY', itemId: 'i2', message: 'Không nuôi thú cưng' });
    const [mine, theirs] = db.tables.realtor_messages.filter(m => m.direction === 'IN');
    await act({ action: 'LEASE_TERMS', itemId: 'i1', terms, replyMessageId: mine.id });
    await act({ action: 'LEASE_TERMS', itemId: 'i1', terms, replyMessageId: theirs.id });
    const [a, b] = eventsOf('LEASE_TERMS_RECORDED').map(e => e.payload as Record<string, unknown>);
    expect(a.reply_message_id).toBe(mine.id);
    expect(b).not.toHaveProperty('reply_message_id');
  });

  it('refuses terms outside the bounds, and records nothing', async () => {
    const r = await act({ action: 'LEASE_TERMS', itemId: 'i1', terms: { ...terms, depositMonthsMin: 30 } });
    expect(r).toMatchObject({ status: 400, body: { error: 'invalid_terms' } });
    expect((await act({ action: 'LEASE_TERMS', itemId: 'i1', terms: {} })).status).toBe(400);
    expect((await act({ action: 'LEASE_TERMS', itemId: 'i1' })).status).toBe(400);
    expect(eventsOf('LEASE_TERMS_RECORDED')).toHaveLength(0);
  });

  it('refuses a phone number in a fee, since the renter reads them', async () => {
    for (const fee of [
      { kind: 'PARKING', label: 'Parking, ask guard 0901 234 567', included: true },
      { kind: 'OTHER', label: 'Cleaning', included: false, amount: '+44 7700 900123' },
    ]) {
      const r = await act({ action: 'LEASE_TERMS', itemId: 'i1', terms: { ...terms, fees: [fee] } });
      expect(r).toMatchObject({ status: 400, body: { error: 'invalid_terms' } });
    }
    expect(eventsOf('LEASE_TERMS_RECORDED')).toHaveLength(0);
  });
});
