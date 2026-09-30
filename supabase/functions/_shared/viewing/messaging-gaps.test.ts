// The gaps closed on 2026-09-30: a holding update that reaches a renter whose
// window has shut, the chase when a plan goes unanswered, an itinerary sent
// twice, and the send layer's two double-send paths.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { sendFreeForm, DuplicateKeyError, OptedOutError, type MessageStore } from '../whatsapp/send.ts';
import { TEMPLATES } from '../whatsapp/templates.ts';
import { deliver } from './deliver.ts';
import { dueActions, holdingUpdateOnHold, HOUR_MS, CHASE_RENTER_AFTER_MS } from './reminders.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';

let db: FakeDb;
let adapter: MockAdapter;
const WINDOW_OPEN = () => new Date(Date.now() + 6 * HOUR_MS).toISOString();

beforeEach(() => {
  db = new FakeDb();
  adapter = new MockAdapter();
  db.tables.renters.push({ id: 'renter-1', phone_e164: '+447700900123', display_name: 'Sam Carter', service_window_expires_at: WINDOW_OPEN(), opted_out_at: null });
  db.tables.viewing_requests.push({ id: 'req-1', ref: 'HV-4KX9', renter_id: 'renter-1', created_at: new Date(Date.now() - 30 * HOUR_MS).toISOString() });
  db.tables.external_properties.push({ id: 'l1', title: 'Sunny 2BR in Thao Dien', district_code: 'D2' });
  db.tables.request_items.push({ id: 'i1', request_id: 'req-1', listing_id: 'l1', price_vnd_at_request: 15_000_000, sort_order: 0 });
  db.tables.events.push(
    { id: 'e1', request_id: 'req-1', item_id: null, type: 'REQUEST_SUBMITTED', payload: {}, actor: 'RENTER', occurred_at: new Date(Date.now() - 30 * HOUR_MS).toISOString() },
    { id: 'e2', request_id: 'req-1', item_id: 'i1', type: 'ITEM_ADDED', payload: {}, actor: 'RENTER', occurred_at: new Date(Date.now() - 30 * HOUR_MS).toISOString() },
  );
});

// deno-lint-ignore no-explicit-any
const send = (purpose: 'ITINERARY' | 'HOLDING_UPDATE', order?: string[]) => deliver(db as any, adapter, { requestId: 'req-1', purpose, order });

describe('a holding update to a renter whose window has shut', () => {
  const approved = TEMPLATES.REQUEST_UPDATE.approved;
  afterEach(() => { (TEMPLATES.REQUEST_UPDATE as { approved: boolean }).approved = approved; });

  beforeEach(() => { db.tables.renters[0].service_window_expires_at = new Date(Date.now() - HOUR_MS).toISOString(); });

  it('goes as request_update once Meta has approved it, and moves the clock', async () => {
    (TEMPLATES.REQUEST_UPDATE as { approved: boolean }).approved = true;
    const r = await send('HOLDING_UPDATE');
    expect(r).toMatchObject({ ok: true, deduplicated: false });
    expect(adapter.delivered[0]).toMatchObject({ templateName: 'request_update', templateParams: ['Sam', 'Sunny 2BR in Thao Dien'] });
    expect(db.tables.events.at(-1)).toMatchObject({ type: 'HOLDING_UPDATE_SENT', payload: { via: 'TEMPLATE' } });
  });

  it('is refused as template_unavailable until then, and nothing is sent', async () => {
    (TEMPLATES.REQUEST_UPDATE as { approved: boolean }).approved = false;
    expect(await send('HOLDING_UPDATE')).toMatchObject({ ok: false, code: 'template_unavailable' });
    expect(adapter.delivered).toHaveLength(0);
  });

  it('holds a template refusal for a day, not until the renter writes', () => {
    const at = '2026-10-01T00:00:00.000Z';
    const hold = (hours: number) => holdingUpdateOnHold({
      refusedAt: at, reason: 'template_unavailable', windowExpiresAt: null, now: Date.parse(at) + hours * HOUR_MS,
    });
    expect(hold(23)).toBe(true);
    expect(hold(25)).toBe(false);
  });
});

describe('a plan the renter has not answered', () => {
  const log = (extra: DomainEvent[] = []) => [
    ...db.tables.events as unknown as DomainEvent[],
    { id: 9, request_id: 'req-1', item_id: null, type: 'ITINERARY_DELIVERED', payload: { message_id: 'm1' }, actor: 'OPS', occurred_at: '2026-10-01T00:00:00.000Z' },
    ...extra,
  ];
  const due = (events: DomainEvent[], hours: number) => dueActions({
    view: reduceRequest('req-1', events), events, createdAt: '2026-09-30T00:00:00.000Z',
    now: Date.parse('2026-10-01T00:00:00.000Z') + hours * HOUR_MS,
  }).map(a => a.kind);

  it('becomes a person\'s to-do after 48 hours, and never a message', () => {
    expect(CHASE_RENTER_AFTER_MS).toBe(48 * HOUR_MS);
    expect(due(log(), 47)).not.toContain('CHASE_RENTER');
    expect(due(log(), 49)).toEqual(['CHASE_RENTER']);
  });

  it('is not owed once they answer, or once an operator writes to them', () => {
    const replied = { id: 10, request_id: 'req-1', item_id: null, type: 'RENTER_REPLIED', payload: { intent: 'QUESTION' }, actor: 'RENTER', occurred_at: '2026-10-01T05:00:00.000Z' };
    expect(due(log([replied]), 60)).not.toContain('CHASE_RENTER');
    const wrote = { id: 11, request_id: 'req-1', item_id: null, type: 'REPLY_SENT', payload: { message_id: 'o1' }, actor: 'OPS', occurred_at: '2026-10-02T12:00:00.000Z' };
    expect(due(log([wrote]), 60)).not.toContain('CHASE_RENTER');
    expect(due(log([wrote]), 85)).toContain('CHASE_RENTER');
  });
});

describe('sending the itinerary again', () => {
  beforeEach(() => {
    db.tables.events.push({ id: 'e3', request_id: 'req-1', item_id: 'i1', type: 'OUTCOME_RECORDED', payload: { outcome: 'CONFIRMED', slots: [{ starts_at: '2026-10-05T03:00:00Z', duration_minutes: 30 }] }, actor: 'OPS', occurred_at: new Date().toISOString() });
  });

  it('is one message when the plan is the same, and a new one when it changed', async () => {
    expect(await send('ITINERARY', ['i1'])).toMatchObject({ ok: true, deduplicated: false });
    expect(await send('ITINERARY', ['i1'])).toMatchObject({ ok: true, deduplicated: true });
    expect(adapter.delivered).toHaveLength(1);

    db.tables.events.push({ id: 'e4', request_id: 'req-1', item_id: 'i1', type: 'OUTCOME_RECORDED', payload: { outcome: 'CONFIRMED', slots: [{ starts_at: '2026-10-06T03:00:00Z', duration_minutes: 30 }] }, actor: 'OPS', occurred_at: new Date(Date.now() + 1000).toISOString() });
    expect(await send('ITINERARY', ['i1'])).toMatchObject({ ok: true, deduplicated: false });
    expect(adapter.delivered).toHaveLength(2);
    expect(String(adapter.delivered[1].body)).toContain('6 Oct');
  });
});

describe('the send layer', () => {
  // deno-lint-ignore no-explicit-any
  const store = () => new SupabaseMessageStore(db as any);

  it('sends a failed message again on the same key, and a sent one never', async () => {
    adapter.failNextDelivery();
    const first = await sendFreeForm(store(), adapter, { renterId: 'renter-1', purpose: 'X', body: 'hello' });
    expect(first.message.status).toBe('FAILED');
    const retry = await sendFreeForm(store(), adapter, { renterId: 'renter-1', purpose: 'X', body: 'hello' });
    expect(retry).toMatchObject({ deduplicated: false, message: { id: first.message.id, status: 'SENT' } });
    const again = await sendFreeForm(store(), adapter, { renterId: 'renter-1', purpose: 'X', body: 'hello' });
    expect(again.deduplicated).toBe(true);
    expect(adapter.delivered).toHaveLength(1);
    expect(db.tables.messages).toHaveLength(1);
  });

  it('does not send when another caller wrote the same key between its read and its write', async () => {
    // The race: this caller's read finds nothing, the other caller's row lands,
    // and this caller's insert hits the unique index.
    const real = store();
    const racing: MessageStore = {
      getRenter: id => real.getRenter(id),
      countConsecutiveOutbound: id => real.countConsecutiveOutbound(id),
      touchServiceWindow: (id, at) => real.touchServiceWindow(id, at),
      markSent: (id, p) => real.markSent(id, p),
      markFailed: (id, e) => real.markFailed(id, e),
      findByIdempotencyKey: (() => {
        let calls = 0;
        return (key: string) => (++calls === 1 ? Promise.resolve(null) : real.findByIdempotencyKey(key));
      })(),
      insertQueued: async row => {
        db.tables.messages.push({ ...row, id: 'theirs', status: 'SENT' });
        return real.insertQueued(row);
      },
    };
    await expect(real.insertQueued({ direction: 'OUT', channel: 'WHATSAPP', to_phone: 'x', idempotency_key: 'dup' }))
      .resolves.toBeTruthy();
    await expect(real.insertQueued({ direction: 'OUT', channel: 'WHATSAPP', to_phone: 'x', idempotency_key: 'dup' }))
      .rejects.toBeInstanceOf(DuplicateKeyError);

    const r = await sendFreeForm(racing, adapter, { renterId: 'renter-1', purpose: 'Y', body: 'hello' });
    expect(r).toMatchObject({ deduplicated: true, message: { id: 'theirs' } });
    expect(adapter.delivered).toHaveLength(0);
  });

  it('says a renter opted out in a way callers can tell apart', async () => {
    db.tables.renters[0].opted_out_at = new Date().toISOString();
    await expect(sendFreeForm(store(), adapter, { renterId: 'renter-1', purpose: 'Z', body: 'hi' }))
      .rejects.toBeInstanceOf(OptedOutError);
    expect(await send('HOLDING_UPDATE')).toMatchObject({ ok: false, code: 'opted_out' });
  });
});
