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
import { linkViewingToInquiry, runInquiryDeadline } from './concierge.ts';
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


describe('capturing units and offering them (S7.1b)', () => {
  const AGENT = '99999999-2222-4333-8444-555555555555';
  const unit = { realtorId: AGENT, bedrooms: 2, areaSqm: 80, priceVnd: 24_000_000, floor: '18' };

  beforeEach(async () => {
    db.tables.realtors.push({ id: AGENT, phone_e164: '+84907654321', display_name: 'Linh' });
    db.tables.complexes[0] = { id: 'cx-1', name: 'Empire City', district: 'Thu Duc', city: 'ho_chi_minh' };
    db.tables.external_properties = [];
    db.tables.alert_items = [];
    // sync_canonical_listing_fields(), for the rows this writes.
    db.onInsert.external_properties = row => ({
      ...row,
      bedrooms: parseInt(String(row.rooms), 10),
      area_sqm: parseInt(String(row.size), 10),
      price_vnd: Number(row.price),
      price_confidence: 'HIGH',
      district_code: 'THU_DUC',
    });
    await renterSends(`Hi Hausto - please check availability at Empire City for me (${code})`);
  });

  const capture = async (over: Record<string, unknown> = {}) => {
    const r = await act({ action: 'INQUIRY_CAPTURE_UNIT', inquiryId: INQ, ...unit, ...over });
    return { r, id: r.body.listingId as string };
  };

  it('enters an agent\'s unit as a listing Request viewing will accept, and logs it', async () => {
    const { r, id } = await capture();
    expect(r.status).toBe(200);
    expect(db.tables.external_properties.find(l => l.id === id)).toMatchObject({
      source: 'concierge', is_active: true, realtor_id: AGENT, bedrooms: 2, price_vnd: 24_000_000,
    });
    expect(view().capturedListingIds).toEqual([id]);
    expect(view().agents[AGENT].answer).toBe('HAS_UNITS');
  });

  it('removes a unit intake would refuse, and says why', async () => {
    db.onInsert.external_properties = row => ({ ...row, bedrooms: 2, area_sqm: 80, price_vnd: 24_000_000, district_code: null });
    const { r } = await capture();
    expect(r.status).toBe(422);
    expect(db.tables.external_properties).toHaveLength(0);
    expect(view().capturedListingIds).toEqual([]);
  });

  it('refuses a building outside Ho Chi Minh City', async () => {
    db.tables.complexes[0].city = 'hanoi';
    expect((await capture()).r.status).toBe(409);
  });

  it('offers units in one message: sent, on the thread, logged, and kept out of the weekly alert', async () => {
    const a = await capture();
    const b = await capture({ floor: '9', priceVnd: 22_500_000 });
    at('2026-09-29T05:00:00Z');
    const r = await act({ action: 'INQUIRY_OFFER_UNITS', inquiryId: INQ, listingIds: [a.id, b.id], key: 'offer-1' });
    expect(r.status).toBe(200);

    const sent = whatsapp.delivered.at(-1)!;
    expect(sent.toPhone).toBe(PHONE);
    expect(sent.body).toContain('Hi Mai, here is what we found at Empire City:');
    expect(sent.body).toContain(`?inq=${INQ}`);
    expect(db.tables.complex_inquiry_messages.at(-1)).toMatchObject({ direction: 'outbound', body: sent.body });
    expect(view()).toMatchObject({ state: 'OFFERED', offeredListingIds: [a.id, b.id] });
    expect(db.tables.alert_items.map(x => x.listing_id)).toEqual([a.id, b.id]);

    // Their answer comes back to the request.
    at('2026-09-29T06:00:00Z');
    expect((await renterSends('The first one please')).inquiryId).toBe(INQ);
  });

  it('refuses a listing from another building, and a unit gone stale', async () => {
    db.tables.external_properties.push({
      id: 'elsewhere', source: 'batdongsan', external_id: 'x', is_active: true, price_vnd: 20_000_000,
      price_confidence: 'HIGH', bedrooms: 2, area_sqm: 70, district_code: 'D1', title: 'Somewhere else',
    });
    expect((await act({ action: 'INQUIRY_OFFER_UNITS', inquiryId: INQ, listingIds: ['elsewhere'] })).body.error)
      .toBe('not_this_building');

    const { id } = await capture();
    at('2026-10-20T00:00:00Z');
    const r = await act({ action: 'INQUIRY_OFFER_UNITS', inquiryId: INQ, listingIds: [id] });
    expect(r.body.error).toBe('stale_unit');

    // Reconfirmed with the agent, it can go. (The window has long shut, so
    // that is the refusal now - which is the point of the template in S7.1c.)
    expect((await act({ action: 'INQUIRY_RECONFIRM_UNIT', inquiryId: INQ, listingId: id })).status).toBe(200);
    expect((await act({ action: 'INQUIRY_OFFER_UNITS', inquiryId: INQ, listingIds: [id] })).body.error).toBe('window_closed');
  });

  it('refuses more than five, none, and an operator line with a phone number', async () => {
    const { id } = await capture();
    expect((await act({ action: 'INQUIRY_OFFER_UNITS', inquiryId: INQ, listingIds: [] })).status).toBe(400);
    expect((await act({ action: 'INQUIRY_OFFER_UNITS', inquiryId: INQ, listingIds: ['1', '2', '3', '4', '5', '6'] })).status).toBe(400);
    expect((await act({ action: 'INQUIRY_OFFER_UNITS', inquiryId: INQ, listingIds: [id], message: 'Call Linh on 0907 654 321' })).status).toBe(400);
    expect(view().state).toBe('SOURCING');
  });
});


describe('the handoff, the deadlines and the update template (S7.1c)', () => {
  beforeEach(async () => {
    db.tables.jobs = [];
    await renterSends(`Hi Hausto - please check availability at Empire City for me (${code})`);
  });

  it('enqueues the 16h and 22h reminders when the code arrives', () => {
    const jobs = db.tables.jobs.filter(j => j.kind === 'INQUIRY_DEADLINE');
    expect(jobs.map(j => j.run_after)).toEqual(['2026-09-29T19:00:00.000Z', '2026-09-30T01:00:00.000Z']);
    expect(jobs.every(j => (j.payload as { inquiry_id: string }).inquiry_id === INQ)).toBe(true);
  });

  it('emails the reminder when nobody has answered, and not once someone has', async () => {
    const sent: { subject: string; text: string }[] = [];
    // deno-lint-ignore no-explicit-any
    const run = () => runInquiryDeadline(db as any, INQ, new Date('2026-09-29T19:00:00Z'), async a => { sent.push(a); });
    expect(await run()).toBe('SENT');
    expect(sent[0].subject).toBe('Empire City - availability reply due in 8h');

    at('2026-09-29T20:00:00Z');
    await act({ action: 'INQUIRY_REPLY', inquiryId: INQ, body: 'Still asking two agents - can you do mid-November or later?' });
    expect(await run()).toBe('NOT_NEEDED');
    expect(sent).toHaveLength(1);
  });

  it('does not count the automatic confirmation as an answer', async () => {
    // The code's reply goes out as source 'system' (agent-act.ts files it so);
    // the request is still unanswered by a person.
    db.tables.complex_inquiry_messages.push({
      inquiry_id: INQ, direction: 'outbound', source: 'system', body: 'Thanks Mai - your request...',
      created_at: '2026-09-29T03:00:05.000Z',
    });
    // deno-lint-ignore no-explicit-any
    expect(await runInquiryDeadline(db as any, INQ, new Date(), async () => {})).toBe('SENT');
  });

  it('links a viewing request made from the offer, and closes the request as VIEWING_REQUESTED', async () => {
    const renterId = db.tables.complex_inquiries[0].renter_id;
    db.tables.viewing_requests.push({ id: 'req-9', ref: 'HV-4KX9', renter_id: renterId, inquiry_id: null });
    // deno-lint-ignore no-explicit-any
    expect(await linkViewingToInquiry(db as any, { inquiryId: INQ, requestId: 'req-9', now: new Date() })).toBe('LINKED');
    expect(db.tables.viewing_requests[0].inquiry_id).toBe(INQ);
    expect(view()).toMatchObject({ state: 'CLOSED', closedReason: 'VIEWING_REQUESTED' });

    // A second viewing request from the same offer links too, and closes nothing twice.
    db.tables.viewing_requests.push({ id: 'req-10', ref: 'HV-4KXA', renter_id: renterId, inquiry_id: null });
    // deno-lint-ignore no-explicit-any
    await linkViewingToInquiry(db as any, { inquiryId: INQ, requestId: 'req-10', now: new Date() });
    expect(db.tables.inquiry_events.filter(e => e.type === 'CLOSED')).toHaveLength(1);
  });

  it('will not let a forwarded offer link close someone else\'s request', async () => {
    db.tables.viewing_requests.push({ id: 'req-x', ref: 'HV-XXXX', renter_id: 'someone-else', inquiry_id: null });
    // deno-lint-ignore no-explicit-any
    expect(await linkViewingToInquiry(db as any, { inquiryId: INQ, requestId: 'req-x', now: new Date() })).toBe('SKIPPED');
    expect(db.tables.viewing_requests[0].inquiry_id).toBeNull();
    expect(view().state).not.toBe('CLOSED');
  });

  it('refuses the update template while the window is open, and until Meta approves it', async () => {
    expect((await act({ action: 'INQUIRY_SEND_UPDATE', inquiryId: INQ })).body.error).toBe('window_open');
    at('2026-09-30T05:00:00Z');
    const r = await act({ action: 'INQUIRY_SEND_UPDATE', inquiryId: INQ });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('template_not_approved');
  });
});

it('leaves email requests to Admin Tools', async () => {
  db.tables.complex_inquiries[0].channel = 'EMAIL';
  const r = await act({ action: 'INQUIRY_CLOSE', inquiryId: INQ, reason: 'OTHER' });
  expect(r.status).toBe(409);
  expect(r.body.error).toBe('email_request');
});
