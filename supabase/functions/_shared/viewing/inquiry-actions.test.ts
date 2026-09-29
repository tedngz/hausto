// The operator's steps on an availability request, against the in-memory
// database - the same calls the ops console and, later, the AI operator make.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { ManualChannel } from '../realtor/channel.ts';
import { SupabaseRealtorMessageStore } from '../realtor/store.ts';
import { performOpsAction, type OpsDeps } from './ops-actions.ts';
import { handleInbound } from './routing.ts';
import { generateWatchCode, watchExpiry } from './watch.ts';
import { reduceInquiry, type InquiryEvent } from '../viewing-domain.ts';

const INQ = '11111111-2222-4333-8444-555555555555';
const PHONE = '+447700900123';

let db: FakeDb;
let deps: OpsDeps;
let whatsapp: MockAdapter;
let code: string;

// deno-lint-ignore no-explicit-any
const act = (input: Record<string, unknown>) => performOpsAction(db as any, deps, 'OPS:op-1', input);
const view = () => reduceInquiry(INQ, db.tables.inquiry_events as unknown as InquiryEvent[]);
const at = (iso: string) => vi.setSystemTime(new Date(iso));

async function renterSends(text: string) {
  // deno-lint-ignore no-explicit-any
  return handleInbound(db as any, deps.messages, {
    from: PHONE, text, providerMessageId: `wamid.${Math.random()}`, timestamp: new Date().toISOString(),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-09-29T03:00:00Z');
  db = new FakeDb();
  whatsapp = new MockAdapter();
  deps = {
    whatsapp,
    // deno-lint-ignore no-explicit-any
    messages: new SupabaseMessageStore(db as any),
    realtorChannel: new ManualChannel(),
    // deno-lint-ignore no-explicit-any
    realtorMessages: new SupabaseRealtorMessageStore(db as any),
  };
  code = generateWatchCode();
  db.tables.complexes = [{ id: 'cx-1', name: 'Empire City' }];
  db.tables.realtors = [{ id: 'r-1', phone_e164: '+84901234567', display_name: 'Harry' }];
  db.tables.complex_watches = [{
    id: 'w-1', complex_id: 'cx-1', code, status: 'PENDING', renter_id: null, user_id: null, bedrooms: 2,
    budget_max_vnd: 25_000_000, created_at: new Date().toISOString(), expires_at: watchExpiry(new Date(), '2026-11-15').toISOString(),
  }];
  db.tables.complex_inquiries = [{
    id: INQ, complex_id: 'cx-1', full_name: 'Mai Nguyen', channel: 'WHATSAPP', watch_id: 'w-1',
    bedrooms_needed: 2, budget_max_vnd: 25_000_000, target_move_in_date: '2026-11-15', lease_duration_months: 12,
    has_pets: false, whatsapp_confirmed_at: null, renter_id: null, created_at: new Date().toISOString(),
  }];
  db.tables.inquiry_events = [];
});
afterEach(() => vi.useRealTimers());

describe('before the code arrives', () => {
  it('refuses every step - there is nobody to reply to yet', async () => {
    const r = await act({ action: 'INQUIRY_ASK_AGENT', inquiryId: INQ, realtorId: 'r-1' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('awaiting_code');
    expect(db.tables.inquiry_events).toHaveLength(0);
  });
});

describe('once confirmed', () => {
  beforeEach(async () => {
    await renterSends(`Hi Hausto - please check availability at Empire City for me (${code})`);
  });

  it('writes CONFIRMED when the code arrives', () => {
    expect(db.tables.inquiry_events.map(e => e.type)).toEqual(['CONFIRMED']);
    expect(view().state).toBe('NEW');
  });

  it('records an agent asked and what they answered, as typed events stamped with the operator', async () => {
    at('2026-09-29T04:00:00Z');
    expect((await act({ action: 'INQUIRY_ASK_AGENT', inquiryId: INQ, realtorId: 'r-1', medium: 'zalo', note: 'Tower 2' })).status).toBe(200);
    at('2026-09-29T06:00:00Z');
    expect((await act({ action: 'INQUIRY_AGENT_ANSWERED', inquiryId: INQ, realtorId: 'r-1', answer: 'has_units' })).status).toBe(200);
    expect(view().state).toBe('SOURCING');
    expect(view().agents['r-1']).toMatchObject({ medium: 'ZALO', answer: 'HAS_UNITS' });
    expect(db.tables.inquiry_events.at(-1)).toMatchObject({ actor: 'OPS:op-1', type: 'AGENT_ANSWERED' });
  });

  it('refuses an agent not on file, an unknown answer, a bad reason', async () => {
    expect((await act({ action: 'INQUIRY_ASK_AGENT', inquiryId: INQ, realtorId: 'r-nope' })).status).toBe(400);
    expect((await act({ action: 'INQUIRY_AGENT_ANSWERED', inquiryId: INQ, realtorId: 'r-1', answer: 'MAYBE' })).status).toBe(400);
    expect((await act({ action: 'INQUIRY_CLOSE', inquiryId: INQ, reason: 'BORED' })).status).toBe(400);
    expect(db.tables.inquiry_events).toHaveLength(1);
  });

  it('replies on WhatsApp, files it on the thread, and routes their answer back to the request', async () => {
    at('2026-09-29T05:00:00Z');
    const r = await act({ action: 'INQUIRY_REPLY', inquiryId: INQ, body: 'Hi Mai - two 2BRs are free from mid-November. Want to see them?', key: 'k1' });
    expect(r.status).toBe(200);
    expect(whatsapp.delivered.at(-1)?.toPhone).toBe(PHONE);
    expect(db.tables.complex_inquiry_messages.at(-1)).toMatchObject({ direction: 'outbound', source: 'dashboard' });

    at('2026-09-29T06:00:00Z');
    const back = await renterSends('Yes please');
    expect(back.inquiryId).toBe(INQ);
  });

  it('refuses a reply with a phone number or booking talk, sending nothing', async () => {
    const sentBefore = whatsapp.delivered.length;
    expect((await act({ action: 'INQUIRY_REPLY', inquiryId: INQ, body: 'Call the agent on 0901 234 567' })).status).toBe(400);
    expect((await act({ action: 'INQUIRY_REPLY', inquiryId: INQ, body: 'Your booking is set' })).status).toBe(400);
    expect(whatsapp.delivered.length).toBe(sentBefore);
  });

  it('refuses a reply once the window has shut', async () => {
    at('2026-09-30T04:00:00Z');
    const r = await act({ action: 'INQUIRY_REPLY', inquiryId: INQ, body: 'Found one!' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('window_closed');
  });

  it('closes with a reason, refuses work on a closed request, and reopens', async () => {
    expect((await act({ action: 'INQUIRY_CLOSE', inquiryId: INQ, reason: 'NOTHING_FOUND' })).status).toBe(200);
    expect(view()).toMatchObject({ state: 'CLOSED', closedReason: 'NOTHING_FOUND' });
    expect((await act({ action: 'INQUIRY_ASK_AGENT', inquiryId: INQ, realtorId: 'r-1' })).status).toBe(409);
    expect((await act({ action: 'INQUIRY_CLOSE', inquiryId: INQ, reason: 'DUPLICATE' })).status).toBe(409);
    expect((await act({ action: 'INQUIRY_REOPEN', inquiryId: INQ })).status).toBe(200);
    expect(view().state).toBe('NEW');
  });
});

it('leaves email requests to Admin Tools', async () => {
  db.tables.complex_inquiries[0].channel = 'EMAIL';
  const r = await act({ action: 'INQUIRY_CLOSE', inquiryId: INQ, reason: 'OTHER' });
  expect(r.status).toBe(409);
  expect(r.body.error).toBe('email_request');
});
