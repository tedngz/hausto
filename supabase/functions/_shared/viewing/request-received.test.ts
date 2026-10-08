// The receipt: the answer to a renter's first WhatsApp message on a request
// (2026-10-08). When it goes, what it says, that it goes once - and that it
// never makes the plan or the viewing-day message a refused third in a row.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { sendFreeForm, isAcknowledgement, ConsecutiveMessageError } from '../whatsapp/send.ts';
import { handleInbound } from './routing.ts';
import { decideAction } from './agent.ts';
import { performAction } from './agent-act.ts';
import { renderRequestReceived } from './intake.ts';

const PHONE = '+84901234567';
let db: FakeDb;
let store: SupabaseMessageStore;
let adapter: MockAdapter;
let n = 0;

const at = (s: number) => new Date(Date.parse('2026-10-08T03:00:00Z') + s * 1000).toISOString();
// deno-lint-ignore no-explicit-any
const inbound = (text: string) => handleInbound(db as any, store, {
  from: PHONE, text, providerMessageId: `wamid.${++n}`, timestamp: new Date().toISOString(),
});
const out = () => db.tables.messages.filter(m => m.direction === 'OUT');

async function answer(text: string) {
  await new Promise(r => setTimeout(r, 5));
  const o = await inbound(text);
  await new Promise(r => setTimeout(r, 5));
  const action = decideAction({
    enabled: false, intent: o.intent, text, requestId: o.requestId, optedOut: o.optedOut,
    confirmed: o.confirmed, received: o.received,
  });
  // deno-lint-ignore no-explicit-any
  if (action.kind !== 'NONE') await performAction(db as any, adapter, action, {
    renterId: o.renterId, requestId: o.requestId, providerMessageId: `wamid.${n}`,
  });
  return { o, action };
}

beforeEach(() => {
  db = new FakeDb();
  // deno-lint-ignore no-explicit-any
  store = new SupabaseMessageStore(db as any);
  adapter = new MockAdapter();
  n = 0;
  db.tables.renters.push({ id: 'renter-1', phone_e164: PHONE, service_window_expires_at: null, opted_out_at: null });
  db.tables.viewing_requests.push({ id: 'req-1', ref: 'HV-P6XT', renter_id: 'renter-1', created_at: at(0) });
  db.tables.external_properties.push(
    { id: 'l1', title: 'Bright and Airy 1BR in Lush City Garden' },
    { id: 'l2', title: 'Modern Family Haven in D2 Giang Vo' },
  );
  db.tables.request_items.push(
    { id: 'i1', request_id: 'req-1', listing_id: 'l1', price_vnd_at_request: 15_000_000 },
    { id: 'i2', request_id: 'req-1', listing_id: 'l2', price_vnd_at_request: 25_500_000 },
  );
  db.tables.events.push(
    { id: 'e1', request_id: 'req-1', item_id: null, type: 'REQUEST_SUBMITTED', payload: {}, actor: 'RENTER', occurred_at: at(1) },
    { id: 'e2', request_id: 'req-1', item_id: 'i1', type: 'ITEM_ADDED', payload: {}, actor: 'RENTER', occurred_at: at(2) },
    { id: 'e3', request_id: 'req-1', item_id: 'i2', type: 'ITEM_ADDED', payload: {}, actor: 'RENTER', occurred_at: at(3) },
  );
});

describe('the receipt', () => {
  it('answers the first message with the request and its places, agent on or off', async () => {
    const { action } = await answer('Hi Hausto - my viewing request is HV-P6XT');
    expect(action.kind).toBe('REQUEST_RECEIVED');
    expect(out()).toHaveLength(1);
    expect(out()[0].body).toBe(renderRequestReceived({
      ref: 'HV-P6XT', titles: ['Bright and Airy 1BR in Lush City Garden', 'Modern Family Haven in D2 Giang Vo'],
      siteUrl: 'https://hausto.com',
    }));
    expect(String(out()[0].body)).toMatch(/^Thanks - we have your request HV-P6XT for 2 places:\n1\. Bright/);
    expect(db.tables.events.filter(e => e.type === 'HOLDING_UPDATE_SENT')).toHaveLength(1);
  });

  it('names a single place in the first line', () => {
    expect(renderRequestReceived({ ref: 'HV-P6XT', titles: ['Studio Quận 1'], siteUrl: 'https://hausto.com' }).split('\n')[0])
      .toBe('Thanks - we have your request HV-P6XT for Studio Quận 1');
  });

  it('goes once, however often the link message is sent', async () => {
    await answer('Hi Hausto - my viewing request is HV-P6XT');
    const again = await answer('Hi Hausto - my viewing request is HV-P6XT');
    expect(again.action.kind).toBe('NONE');
    expect(out()).toHaveLength(1);
  });

  it('is not sent for a request that has moved on to its plan', async () => {
    db.tables.events.push(
      { id: 'e4', request_id: 'req-1', item_id: 'i1', type: 'OUTCOME_RECORDED', payload: { outcome: 'CONFIRMED', slots: [{ starts_at: at(99999) }] }, actor: 'SYSTEM', occurred_at: at(4) },
      { id: 'e5', request_id: 'req-1', item_id: 'i2', type: 'OUTCOME_RECORDED', payload: { outcome: 'ALREADY_RENTED' }, actor: 'SYSTEM', occurred_at: at(5) },
      { id: 'e6', request_id: 'req-1', item_id: null, type: 'ITINERARY_ASSEMBLED', payload: { ordered_item_ids: ['i1'] }, actor: 'SYSTEM', occurred_at: at(6) },
    );
    const { o } = await answer('Hi Hausto - my viewing request is HV-P6XT');
    expect(o.received).toBeUndefined();
  });

  it('is never the answer to an opt-out', () => {
    const received = { requestId: 'req-1', ref: 'HV-P6XT', titles: ['A'] };
    for (const input of [{ optedOut: true, intent: 'UNKNOWN' }, { optedOut: false, intent: 'OPT_OUT' }]) {
      expect(decideAction({ enabled: true, text: 'x', confirmed: false, received, ...input }).kind).toBe('NONE');
    }
  });
});

describe('three in a row', () => {
  it('does not count the receipt: two more of ours can still follow', async () => {
    await answer('Hi Hausto - my viewing request is HV-P6XT');
    expect(isAcknowledgement(String(out()[0].idempotency_key))).toBe(true);
    const tick = () => new Promise(r => setTimeout(r, 5));
    for (const purpose of ['HOLDING_UPDATE:1', 'ITINERARY']) {
      await tick();
      const r = await sendFreeForm(store, adapter, { renterId: 'renter-1', requestId: 'req-1', purpose, body: purpose });
      expect(r.message.status).toBe('SENT');
    }
    // The third of ours after the receipt is still refused.
    await tick();
    await expect(sendFreeForm(store, adapter, { renterId: 'renter-1', requestId: 'req-1', purpose: 'VIEWING_DAY', body: 'x' }))
      .rejects.toBeInstanceOf(ConsecutiveMessageError);
  });
});
