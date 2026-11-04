// The Hausto half of the Zalo bridge, on the in-memory database: an approved
// message waits in the outbox, the device claims and sends it, and only its
// ack writes "contacted" to the log.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from '../viewing/fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { BridgeChannel } from './channel.ts';
import { SupabaseRealtorMessageStore } from './store.ts';
import { performOpsAction, type OpsDeps } from '../viewing/ops-actions.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';
import { bridgePull, bridgeAck, bridgeInbound, agentPhotoAllowed, CLAIM_LEASE_MS, type StorePhoto } from './bridge.ts';

let db: FakeDb;
let deps: OpsDeps;
const T0 = new Date('2026-09-27T03:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

// deno-lint-ignore no-explicit-any
const act = (input: Record<string, unknown>) => performOpsAction(db as any, deps, 'OPS:op-1', input);
// deno-lint-ignore no-explicit-any
const pull = (now = T0) => bridgePull(db as any, now);
const out = () => db.tables.realtor_messages.filter(m => m.direction === 'OUT');
const events = (type: string) => db.tables.events.filter(e => e.type === type);
const view = () => reduceRequest('req-1', db.tables.events as unknown as DomainEvent[]);

beforeEach(() => {
  db = new FakeDb();
  deps = {
    whatsapp: new MockAdapter(),
    // deno-lint-ignore no-explicit-any
    messages: new SupabaseMessageStore(db as any),
    realtorChannel: new BridgeChannel(),
    // deno-lint-ignore no-explicit-any
    realtorMessages: new SupabaseRealtorMessageStore(db as any),
  };
  db.tables.zalo_bridge_status = [{ id: 'singleton', paused: false }];
  db.tables.realtors = [{ id: 'realtor-1', phone_e164: '+84901234567' }, { id: 'realtor-2', phone_e164: '+84987654321' }];
  db.tables.renters.push({ id: 'renter-1', phone_e164: '+84912345678', display_name: null });
  db.tables.viewing_requests.push({ id: 'req-1', ref: 'HV-4KX9', renter_id: 'renter-1', created_at: new Date().toISOString() });
  db.tables.request_items.push(
    { id: 'i1', request_id: 'req-1', listing_id: 'l1', realtor_id: 'realtor-1', price_vnd_at_request: 15_000_000, created_at: new Date().toISOString() },
  );
  db.tables.events.push(
    { id: 'e1', request_id: 'req-1', item_id: null, type: 'REQUEST_SUBMITTED', payload: {}, actor: 'RENTER', occurred_at: '2026-09-27T00:00:00Z' },
    { id: 'e2', request_id: 'req-1', item_id: 'i1', type: 'ITEM_ADDED', payload: {}, actor: 'RENTER', occurred_at: '2026-09-27T00:00:00Z' },
  );
});

describe('an approved message through the bridge', () => {
  it('waits in the outbox, and the log does not yet say "contacted"', async () => {
    const r = await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh, căn còn không ạ?' });
    expect(r.body).toMatchObject({ recorded: 'REALTOR_CONTACTED', queued: true });
    expect(out()[0]).toMatchObject({ status: 'QUEUED', on_sent_event: { type: 'REALTOR_CONTACTED', item_id: 'i1' } });
    expect(events('REALTOR_CONTACTED')).toHaveLength(0);
    expect(view().items.i1.state).toBe('PENDING');
  });

  it('is handed to the device once per lease, with the agent\'s number', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    const first = await pull();
    expect(first.outbox).toEqual([{ messageId: out()[0].id, phone: '+84901234567', body: 'Chào anh' }]);
    expect((await pull(at(60_000))).outbox).toEqual([]);
    expect((await pull(at(CLAIM_LEASE_MS + 1000))).outbox).toHaveLength(1);
  });

  it('becomes "contacted" when the device reports it sent - once, however often it says so', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    const id = out()[0].id as string;
    // deno-lint-ignore no-explicit-any
    expect(await bridgeAck(db as any, { messageId: id, sent: true, providerId: 'z-1' }, at(5_000))).toEqual({ ok: true, eventWritten: true });
    // deno-lint-ignore no-explicit-any
    expect(await bridgeAck(db as any, { messageId: id, sent: true, providerId: 'z-1' }, at(9_000))).toEqual({ ok: true, eventWritten: false });
    expect(out()[0]).toMatchObject({ status: 'SENT', provider_id: 'z-1' });
    expect(events('REALTOR_CONTACTED')).toHaveLength(1);
    expect(events('REALTOR_CONTACTED')[0]).toMatchObject({ actor: 'OPS:op-1', occurred_at: at(5_000).toISOString() });
    expect(view().items.i1.state).toBe('CONTACTED');
  });

  it('when it fails, says so, and sending again retries the same message', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    const id = out()[0].id as string;
    // deno-lint-ignore no-explicit-any
    await bridgeAck(db as any, { messageId: id, sent: false, error: 'This number is not on Zalo.' }, at(5_000));
    expect(out()[0]).toMatchObject({ status: 'FAILED', error: 'This number is not on Zalo.' });
    expect(events('REALTOR_CONTACTED')).toHaveLength(0);

    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh, em nhắn lại ạ' });
    expect(out()).toHaveLength(1);
    expect(out()[0]).toMatchObject({ status: 'QUEUED', body: 'Chào anh, em nhắn lại ạ' });
    expect((await pull(at(10_000))).outbox).toHaveLength(1);
  });

  it('holds everything while an operator has paused sending, and keeps the watch list', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    await act({ action: 'SET_BRIDGE', paused: true });
    const r = await pull();
    expect(r).toMatchObject({ paused: true, outbox: [], watch: ['+84901234567'] });
  });

  it('leaves the watch list out when the device does not ask, and still hands out the outbox', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    // deno-lint-ignore no-explicit-any
    const r = await bridgePull(db as any, T0, { withWatch: false });
    expect(r).not.toHaveProperty('watch');
    // The agent's number found on its own, without the watch list's lookup.
    expect(r.outbox).toEqual([{ messageId: out()[0].id, phone: '+84901234567', body: 'Chào anh' }]);
  });

  it('defers a broker notification the same way', async () => {
    db.tables.events.push(
      { id: 'e3', request_id: 'req-1', item_id: 'i1', type: 'OUTCOME_RECORDED', payload: { outcome: 'CONFIRMED', slots: [{ starts_at: '2026-09-29T02:00:00Z', duration_minutes: 30 }] }, actor: 'OPS:op-1', occurred_at: '2026-09-27T01:00:00Z' },
      { id: 'e4', request_id: 'req-1', item_id: null, type: 'ITINERARY_DELIVERED', payload: { message_id: 'm' }, actor: 'OPS:op-1', occurred_at: '2026-09-27T01:10:00Z' },
      { id: 'e5', request_id: 'req-1', item_id: null, type: 'REQUEST_CONFIRMED', payload: { confirmed_item_ids: ['i1'] }, actor: 'RENTER', occurred_at: '2026-09-27T01:20:00Z' },
    );
    await act({ action: 'NOTIFY_REALTOR', itemId: 'i1', decision: 'CONFIRM', message: 'Khách chốt rồi ạ' });
    expect(events('REALTOR_NOTIFIED')).toHaveLength(0);
    // deno-lint-ignore no-explicit-any
    await bridgeAck(db as any, { messageId: out()[0].id as string, sent: true }, at(1000));
    expect(view().items.i1.notified).toBe('CONFIRM');
  });
});

describe('what the device hears', () => {
  it('stores an agent\'s reply against the item we last sent them', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    // deno-lint-ignore no-explicit-any
    await bridgeAck(db as any, { messageId: out()[0].id as string, sent: true }, at(1000));
    // deno-lint-ignore no-explicit-any
    const r = await bridgeInbound(db as any, { fromPhone: '0901234567', text: 'Còn em, thứ 3 9h nhé', providerMessageId: 'z100' });
    expect(r).toMatchObject({ stored: true, requestId: 'req-1', itemId: 'i1' });
    const reply = db.tables.realtor_messages.find(m => m.direction === 'IN')!;
    expect(reply).toMatchObject({ body: 'Còn em, thứ 3 9h nhé', actor: 'BRIDGE', status: 'RECEIVED', idempotency_key: 'bridge:z100' });
  });

  it('is idempotent on Zalo\'s message id', async () => {
    const m = { fromPhone: '+84901234567', text: 'ok em', providerMessageId: 'z100' };
    // deno-lint-ignore no-explicit-any
    await bridgeInbound(db as any, m);
    // deno-lint-ignore no-explicit-any
    await bridgeInbound(db as any, m);
    expect(db.tables.realtor_messages.filter(x => x.direction === 'IN')).toHaveLength(1);
  });

  it('drops anyone who is not a known agent, without storing a word', async () => {
    // deno-lint-ignore no-explicit-any
    const r = await bridgeInbound(db as any, { fromPhone: '0933333333', text: 'Con ăn cơm chưa?', providerMessageId: 'z1' });
    expect(r).toEqual({ stored: false, reason: 'not a known agent' });
    expect(db.tables.realtor_messages ?? []).toHaveLength(0);
  });
});

describe("an agent's photos (S7.2b)", () => {
  const INQ = '11111111-2222-4333-8444-555555555555';
  const copied: { url: string; path: string }[] = [];
  const store: StorePhoto = (url, path) => {
    copied.push({ url, path });
    return Promise.resolve(url.includes('broken') ? null : `https://storage.test/${path}.jpg`);
  };
  // deno-lint-ignore no-explicit-any
  const inbound = (m: Record<string, unknown>) => bridgeInbound(db as any, { fromPhone: '+84901234567', text: '', providerMessageId: 'z', ...m } as never, store);

  beforeEach(() => {
    copied.length = 0;
    // The last thing we sent this agent was an availability check.
    db.tables.realtor_messages = [{
      id: 'check-1', inquiry_id: INQ, request_id: null, item_id: null, realtor_id: 'realtor-1', direction: 'OUT',
      purpose: 'AVAILABILITY_CHECK', status: 'SENT', body: 'Chào anh', created_at: '2026-09-30T02:00:00Z',
    }];
  });

  it("copies them under the request's folder and keeps them on the reply", async () => {
    const r = await inbound({ providerMessageId: 'z:77', text: 'Tầng 18 nè', photos: ['https://photo.zdn.vn/a.jpg', 'https://b-f1-zpg.zdn.vn/b.jpg'] });
    expect(r).toMatchObject({ stored: true, inquiryId: INQ, photos: 2 });
    expect(copied.map(c => c.path)).toEqual([`concierge/${INQ}/agent-z77-0`, `concierge/${INQ}/agent-z77-1`]);
    expect(db.tables.realtor_messages.at(-1)).toMatchObject({
      direction: 'IN', inquiry_id: INQ, body: 'Tầng 18 nè',
      attachments: [{ url: `https://storage.test/concierge/${INQ}/agent-z77-0.jpg` }, { url: `https://storage.test/concierge/${INQ}/agent-z77-1.jpg` }],
    });
  });

  it('stores a photo with no words, and says so when one could not be copied', async () => {
    await inbound({ providerMessageId: 'p1', photos: ['https://photo.zdn.vn/a.jpg'] });
    expect(db.tables.realtor_messages.at(-1)).toMatchObject({ body: '(photo)' });
    await inbound({ providerMessageId: 'p2', photos: ['https://photo.zdn.vn/broken.jpg'] });
    expect(db.tables.realtor_messages.at(-1)?.body).toMatch(/could not be copied/);
    expect(db.tables.realtor_messages.at(-1)?.attachments).toBeUndefined();
  });

  it("fetches from Zalo's hosts only - a forged inbound cannot point it elsewhere", async () => {
    const r = await inbound({ providerMessageId: 'p3', photos: ['https://evil.example/zdn.vn.jpg', 'http://photo.zdn.vn/a.jpg'] });
    expect(r).toEqual({ stored: false, reason: 'empty' });
    expect(copied).toHaveLength(0);
    expect(agentPhotoAllowed('https://photo-stal-1.zdn.vn/x.jpg')).toBe(true);
    expect(agentPhotoAllowed('https://zdn.vn.evil.com/x.jpg')).toBe(false);
    expect(agentPhotoAllowed('https://evilzdn.vn/x.jpg')).toBe(false);
    expect(agentPhotoAllowed('not a url')).toBe(false);
  });

  it("ignores a photo about a viewing request's unit, as before", async () => {
    db.tables.realtor_messages = [{
      id: 'ask-1', request_id: 'req-1', item_id: 'i1', realtor_id: 'realtor-1', direction: 'OUT',
      purpose: 'REQUEST_VIEWING', status: 'SENT', body: 'Chào anh', created_at: '2026-09-30T02:00:00Z',
    }];
    expect(await inbound({ providerMessageId: 'p4', photos: ['https://photo.zdn.vn/a.jpg'] })).toEqual({ stored: false, reason: 'empty' });
    expect(copied).toHaveLength(0);
  });
});
