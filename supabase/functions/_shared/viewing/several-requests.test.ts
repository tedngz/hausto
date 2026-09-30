// One renter, several things on the go: an itinerary waiting for their yes,
// and availability requests for two buildings. Which of them does a reply
// answer? (routing.ts `handleInbound`.)

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { handleInbound } from './routing.ts';
import { sendAlert } from './alerts.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';

const PHONE = '+447700900123';
let db: FakeDb;
let store: SupabaseMessageStore;
let clock = 0;

/** A minute later each time, so "the last thing we sent" is well defined. */
const tick = () => new Date(Date.parse('2026-10-01T02:00:00Z') + ++clock * 60_000).toISOString();

/** One of our outbound messages, as the send layer leaves it: WhatsApp's id in provider_id. */
function ours(id: string, opts: { requestId?: string; inquiries?: string[]; alert?: boolean } = {}) {
  const at = tick();
  db.tables.messages.push({
    id, direction: 'OUT', channel: 'WHATSAPP', to_phone: PHONE, body: `message ${id}`,
    status: 'SENT', provider_id: `wamid.${id}`, request_id: opts.requestId ?? null,
    idempotency_key: `k-${id}`, created_at: at,
  });
  for (const inquiryId of opts.inquiries ?? []) {
    db.tables.complex_inquiry_messages.push({
      id: `cim-${id}-${inquiryId}`, inquiry_id: inquiryId, direction: 'outbound', source: 'dashboard',
      channel: 'WHATSAPP', body: `message ${id}`, whatsapp_message_id: id, created_at: at,
    });
  }
  if (opts.alert) db.tables.alert_items.push({ id: `ai-${id}`, renter_id: 'renter-1', listing_id: 'l9', message_id: id, detail_sent_at: null });
}

const reply = (text: string, contextId?: string) =>
  // deno-lint-ignore no-explicit-any
  handleInbound(db as any, store, {
    from: PHONE, text, providerMessageId: `wamid.in.${Math.random()}`, timestamp: tick(),
    ...(contextId ? { contextId } : {}),
  });

const view = () => reduceRequest('req-1', db.tables.events.filter(e => e.request_id === 'req-1') as unknown as DomainEvent[]);

beforeEach(() => {
  clock = 0;
  db = new FakeDb();
  // deno-lint-ignore no-explicit-any
  store = new SupabaseMessageStore(db as any);
  db.tables.renters.push({
    id: 'renter-1', phone_e164: PHONE, display_name: 'Sam', service_window_expires_at: '2026-10-02T00:00:00Z', opted_out_at: null,
  });
  db.tables.complex_inquiry_messages = [];
  db.tables.complex_inquiries = [
    { id: 'inq-A', renter_id: 'renter-1', channel: 'WHATSAPP' },
    { id: 'inq-B', renter_id: 'renter-1', channel: 'WHATSAPP' },
  ];
  db.tables.alert_items = [];
  // A viewing request whose itinerary went out and waits for "yes".
  db.tables.viewing_requests.push({ id: 'req-1', ref: 'HV-4KX9', renter_id: 'renter-1', created_at: '2026-09-28T00:00:00Z' });
  db.tables.request_items.push({ id: 'i1', request_id: 'req-1', listing_id: 'l1', price_vnd_at_request: 1 });
  const e = (type: string, payload: Record<string, unknown> = {}, item: string | null = null) =>
    db.tables.events.push({ request_id: 'req-1', item_id: item, type, payload, actor: 'SYSTEM', occurred_at: tick() });
  e('REQUEST_SUBMITTED');
  e('ITEM_ADDED', { listing_id: 'l1' }, 'i1');
  e('OUTCOME_RECORDED', { outcome: 'CONFIRMED', slots: [{ starts_at: '2026-10-05T03:00:00Z', duration_minutes: 30 }] }, 'i1');
  ours('itinerary', { requestId: 'req-1' });
  e('ITINERARY_DELIVERED', { message_id: 'itinerary' });
});

describe('a bare yes', () => {
  it('goes to the itinerary waiting for it, even after an offer went out', async () => {
    ours('offer-A', { inquiries: ['inq-A'] });
    const out = await reply('Yes please');
    expect(out.requestId).toBe('req-1');
    expect(out.confirmed).toBe(true);
    expect(view().state).toBe('CONFIRMED');
    expect(out.inquiryIds ?? []).toEqual([]);
  });

  it('goes to the offer when they swiped to reply to it', async () => {
    ours('offer-A', { inquiries: ['inq-A'] });
    const out = await reply('Yes please', 'wamid.offer-A');
    expect(out.inquiryIds).toEqual(['inq-A']);
    expect(out.confirmed).toBe(false);
    expect(view().state).toBe('DELIVERED');
  });

  it('is only a question when nothing is waiting for a yes', async () => {
    db.tables.events.push({ request_id: 'req-1', type: 'REQUEST_CONFIRMED', payload: { confirmed_item_ids: ['i1'] }, actor: 'RENTER', occurred_at: tick() });
    ours('offer-A', { inquiries: ['inq-A'] });
    const out = await reply('yes');
    expect(out.inquiryIds).toEqual(['inq-A']);
    expect(out.requestId).toBeUndefined();
  });
});

describe('a swipe-reply', () => {
  it('answers the building they replied to, not the one we wrote about last', async () => {
    ours('offer-A', { inquiries: ['inq-A'] });
    ours('offer-B', { inquiries: ['inq-B'] });
    const plain = await reply('what floor is the second one?');
    expect(plain.inquiryIds).toEqual(['inq-B']);
    const swiped = await reply('what floor is the second one?', 'wamid.offer-A');
    expect(swiped.inquiryIds).toEqual(['inq-A']);
    expect(db.tables.complex_inquiry_messages.filter(m => m.direction === 'inbound').map(m => m.inquiry_id))
      .toEqual(['inq-B', 'inq-A']);
  });

  it('answers the itinerary when they replied to it, whatever came since', async () => {
    ours('offer-A', { inquiries: ['inq-A'] });
    const out = await reply('can we move the 10:00?', 'wamid.itinerary');
    expect(out.requestId).toBe('req-1');
    expect(out.inquiryIds ?? []).toEqual([]);
  });

  it("ignores a context id that is not one of this renter's messages", async () => {
    ours('offer-A', { inquiries: ['inq-A'] });
    db.tables.messages.push({ id: 'theirs', direction: 'OUT', to_phone: '+84900000000', provider_id: 'wamid.theirs', created_at: tick() });
    const out = await reply('hello', 'wamid.theirs');
    expect(out.inquiryIds).toEqual(['inq-A']); // falls back to the last message we sent this renter
  });
});

it('files a reply on every request its message covered', async () => {
  ours('offer-AB', { inquiries: ['inq-A', 'inq-B'] });
  const out = await reply('The Celadon one looks good');
  expect(out.inquiryIds).toEqual(['inq-A', 'inq-B']);
  expect(db.tables.complex_inquiry_messages.filter(m => m.direction === 'inbound').map(m => m.inquiry_id).sort())
    .toEqual(['inq-A', 'inq-B']);
});

it('holds the weekly alert while an itinerary waits for a yes', async () => {
  const adapter = new MockAdapter();
  const items = [{ listingId: 'l9', title: 'A place', priceVnd: 1, bedrooms: 2, source: 'WATCH' as const, watchId: 'w1', label: 'Empire City' }];
  // deno-lint-ignore no-explicit-any
  const held = await sendAlert(db as any, store, adapter, { renterId: 'renter-1', renterName: 'Sam', items, now: new Date(tick()) });
  expect(held).toMatchObject({ sent: false, held: true });
  expect(adapter.delivered).toHaveLength(0);

  await reply('yes');
  expect(view().state).toBe('CONFIRMED');
  // deno-lint-ignore no-explicit-any
  const sent = await sendAlert(db as any, store, adapter, { renterId: 'renter-1', renterName: 'Sam', items, now: new Date(tick()) });
  expect(sent.sent).toBe(true);
});
