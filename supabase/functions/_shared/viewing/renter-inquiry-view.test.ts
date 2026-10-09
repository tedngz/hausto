// Availability requests in the Viewings tab (2026-10-09): what the renter is
// told about each, the places we sent, which requests are theirs - and that
// nothing about an agent or another renter reaches them.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { listRenterInquiries, renterInquiryView, type RenterInquiryRow } from './renter-inquiry-view.ts';
import type { InquiryEvent } from '../viewing-domain.ts';

const NOW = Date.parse('2026-10-09T10:00:00Z');          // 17:00 in Ho Chi Minh City
const HOUR = 3_600_000;
const BUSINESS = '+84900000000';
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

let seq = 0;
const ev = (type: string, at: string, payload: Record<string, unknown> = {}, inquiryId = 'inq-1'): InquiryEvent =>
  ({ id: ++seq, inquiry_id: inquiryId, type, payload, actor: 'OPS:op-1', occurred_at: at });

const row = (over: Partial<RenterInquiryRow> = {}): RenterInquiryRow => ({
  id: 'inq-1',
  code: 'HW-WGGM',
  kind: 'BUILDING',
  place: 'Celadon City',
  createdAt: ago(2),
  moveIn: '2026-11-15',
  bedrooms: 2,
  budgetMaxVnd: 25_000_000,
  watch: { status: 'ACTIVE', expiresAt: '2026-11-29T16:59:59Z' },
  ...over,
});

const view = (events: InquiryEvent[], over: Partial<RenterInquiryRow> = {}, listings: Parameters<typeof renterInquiryView>[0]['listings'] = []) =>
  renterInquiryView({ row: row(over), events, listings, now: NOW });

describe('renterInquiryView: where it stands', () => {
  beforeEach(() => { seq = 0; });

  it('asks for the WhatsApp message until the code arrives', () => {
    const v = view([ev('SUBMITTED', ago(2))], { watch: { status: 'PENDING', expiresAt: '2026-11-29T16:59:59Z' } });
    expect(v.stage).toBe('SEND_CODE');
    expect(v.stageLabel).toBe('Waiting for your WhatsApp message - send it and we start');
    expect(v.alertsUntil).toBeNull();
  });

  it('a code past its week was never sent, and folds away', () => {
    const v = view([ev('SUBMITTED', ago(8 * 24))], { createdAt: ago(8 * 24), watch: { status: 'PENDING', expiresAt: '2026-11-29T16:59:59Z' } });
    expect(v.stage).toBe('NOT_SENT');
    expect(v.stageLabel).toBe('Never sent on WhatsApp - the code has expired');
  });

  it('a building promises a reply 24 hours from the code, in Ho Chi Minh City time', () => {
    const v = view([ev('SUBMITTED', ago(2)), ev('CONFIRMED', ago(1))]);
    expect(v.stage).toBe('CHECKING');
    // Confirmed 16:00 ICT on the 9th; 24 hours on.
    expect(v.stageLabel).toBe('Asking the agents here - we reply on WhatsApp by Sat 10 Oct, 16:00');
    expect(v.alertsUntil).toBe('2026-11-29T16:59:59Z');
  });

  it('an area promises its first places 48 hours from the code', () => {
    const v = view([
      ev('SUBMITTED', ago(2), { area_district_codes: ['D2'], reply_within_hours: 48 }),
      ev('CONFIRMED', ago(1)),
      ev('AGENT_ASKED', ago(0.5), { realtor_id: 'rt-1', medium: 'ZALO' }),
    ], { kind: 'AREA', place: 'District 2' });
    expect(v.stage).toBe('CHECKING');
    expect(v.stageLabel).toBe('Searching - the first places reach you on WhatsApp by Sun 11 Oct, 16:00');
  });

  it('past the promise, it says it is still on it rather than naming a time gone by', () => {
    const v = view([ev('SUBMITTED', ago(30)), ev('CONFIRMED', ago(29))], { createdAt: ago(30) });
    expect(v.stageLabel).toBe('Still asking the agents - we message you on WhatsApp');
  });

  it('closed: a viewing asked for, nothing found, and the rest by reason', () => {
    const base = [ev('SUBMITTED', ago(30)), ev('CONFIRMED', ago(29))];
    const closed = (reason: string) => view([...base, ev('CLOSED', ago(1), { reason })]);
    expect(closed('VIEWING_REQUESTED')).toMatchObject({ stage: 'VIEWING', stageLabel: 'You asked to view a place we found' });
    expect(closed('NOTHING_FOUND')).toMatchObject({ stage: 'NOTHING_FOUND', stageLabel: 'Nothing there that fits is free for now' });
    expect(closed('RENTER_WENT_QUIET').stageLabel).toBe('Closed - we did not hear back from you');
    expect(closed('LEASE_SIGNED').stageLabel).toBe('Closed - you found a place');
    expect(closed('OTHER').stageLabel).toBe('Closed');
  });

  it('reopened, it is back to being worked', () => {
    const v = view([
      ev('SUBMITTED', ago(30)), ev('CONFIRMED', ago(29)),
      ev('CLOSED', ago(5), { reason: 'NOTHING_FOUND' }), ev('REOPENED', ago(1)),
    ]);
    expect(v.stage).toBe('CHECKING');
  });

  it('reads the same whatever order the events arrive in', () => {
    const events = [
      ev('SUBMITTED', ago(30)), ev('CONFIRMED', ago(29)),
      ev('UNIT_CAPTURED', ago(10), { listing_id: 'lst-1', realtor_id: 'rt-1' }),
      ev('UNITS_OFFERED', ago(9), { listing_ids: ['lst-1'], message_id: 'msg-1' }),
    ];
    expect(view([...events].reverse())).toEqual(view(events));
  });
});

describe('renterInquiryView: what was found', () => {
  beforeEach(() => { seq = 0; });

  const offered = [
    ev('SUBMITTED', ago(30)), ev('CONFIRMED', ago(29)),
    ev('UNIT_CAPTURED', ago(12), { listing_id: 'lst-2', realtor_id: 'rt-1' }),
    ev('UNIT_CAPTURED', ago(11), { listing_id: 'lst-9', realtor_id: 'rt-1' }), // captured, never offered
    ev('UNITS_OFFERED', ago(10), { listing_ids: ['lst-2', 'lst-1'], message_id: 'msg-1' }),
  ];
  const listings = [
    { id: 'lst-1', title: 'Celadon 2BR', imageUrl: 'https://img/1.jpg', priceVnd: 18_000_000, bedrooms: 2, isActive: true },
    { id: 'lst-2', title: 'Celadon Ruby 2BR', imageUrl: null, priceVnd: 22_000_000, bedrooms: 2, isActive: false },
    { id: 'lst-9', title: 'Not offered', imageUrl: null, priceVnd: 1, bedrooms: 2, isActive: true },
  ];

  it('lists what was offered, in the order it went, and nothing held back', () => {
    const v = view(offered, {}, listings);
    expect(v.stage).toBe('FOUND');
    expect(v.stageLabel).toBe('We found 2 places - open one to request a viewing');
    expect(v.found.map(p => p.listingId)).toEqual(['lst-2', 'lst-1']);
  });

  it('each links to its page carrying the request, and says when it has lapsed', () => {
    const [ruby, plain] = view(offered, {}, listings).found;
    expect(plain).toEqual({
      listingId: 'lst-1', title: 'Celadon 2BR', imageUrl: 'https://img/1.jpg', priceVnd: 18_000_000, bedrooms: 2,
      listed: true, path: '/property/lst-1?inq=inq-1',
    });
    expect(ruby.listed).toBe(false);
  });

  it('carries no agent, and none of the log', () => {
    const json = JSON.stringify(view(offered, {}, listings));
    expect(json).not.toContain('rt-1');
    expect(json).not.toContain('msg-1');
    expect(json).not.toContain('OPS:');
  });

  it('tells them the brief in force: the form, until they widen it on the thread', () => {
    expect(view(offered).brief).toBe('2 bedrooms · up to 25.000.000 ₫ a month · moving in 15 Nov');
    const widened = view([...offered, ev('BRIEF_CHANGED', ago(1), { bedrooms: [2, 3], budget_max_vnd: 30_000_000, message_id: 'in-1' })]);
    expect(widened.brief).toBe('2 or 3 bedrooms · up to 30.000.000 ₫ a month · moving in 15 Nov');
    expect(view(offered, { bedrooms: 4, budgetMaxVnd: null, moveIn: null }).brief).toBe('4+ bedrooms');
    expect(view(offered, { bedrooms: 1 }).brief.startsWith('1 bedroom ·')).toBe(true);
  });
});

describe('listRenterInquiries', () => {
  let db: FakeDb;

  beforeEach(() => {
    seq = 0;
    db = new FakeDb();
    db.tables.renters = [
      { id: 'ren-1', user_id: 'user-1', phone_e164: '+84901111111' },
      { id: 'ren-2', user_id: 'user-2', phone_e164: '+84902222222' },
    ];
    db.tables.complexes = [{ id: 'cx-1', name: 'Celadon City' }];
    db.tables.complex_watches = [
      { id: 'w-1', code: 'HW-AAAA', status: 'ACTIVE', expires_at: '2026-11-29T16:59:59Z' },
      { id: 'w-2', code: 'HW-BBBB', status: 'PENDING', expires_at: '2026-12-01T16:59:59Z' },
      { id: 'w-3', code: 'HW-CCCC', status: 'ACTIVE', expires_at: '2026-12-01T16:59:59Z' },
      { id: 'w-4', code: 'HW-DDDD', status: 'ACTIVE', expires_at: '2026-12-01T16:59:59Z' },
    ];
    const inquiry = (id: string, over: Record<string, unknown>) => ({
      id, user_id: null, renter_id: null, complex_id: null, area_district_codes: null, area_label: null,
      watch_id: null, channel: 'WHATSAPP', created_at: ago(5), full_name: 'Jane Renter',
      target_move_in_date: '2026-11-15', bedrooms_needed: 2, budget_max_vnd: 25_000_000, ...over,
    });
    db.tables.complex_inquiries = [
      // Hers, signed in: a building, confirmed and offered.
      inquiry('inq-1', { user_id: 'user-1', complex_id: 'cx-1', watch_id: 'w-1', created_at: ago(30) }),
      // Hers, signed in: a search whose code has not arrived.
      inquiry('inq-2', { user_id: 'user-1', area_district_codes: ['D2', 'BINH_THANH'], area_label: 'District 2 and Binh Thanh', watch_id: 'w-2', created_at: ago(1) }),
      // Hers through her number: made signed out before the Pass gate.
      inquiry('inq-3', { renter_id: 'ren-1', complex_id: 'cx-1', watch_id: 'w-3', created_at: ago(200) }),
      // Someone else's.
      inquiry('inq-4', { user_id: 'user-2', renter_id: 'ren-2', complex_id: 'cx-1', watch_id: 'w-4' }),
      // Hers, but by email from before WhatsApp: answered there.
      inquiry('inq-5', { user_id: 'user-1', complex_id: 'cx-1', channel: 'EMAIL' }),
      // Hers, but long gone.
      inquiry('inq-6', { user_id: 'user-1', complex_id: 'cx-1', created_at: ago(100 * 24) }),
    ];
    db.tables.inquiry_events = [
      ev('SUBMITTED', ago(30), {}, 'inq-1'), ev('CONFIRMED', ago(29), {}, 'inq-1'),
      ev('UNITS_OFFERED', ago(3), { listing_ids: ['lst-1'], message_id: 'msg-1' }, 'inq-1'),
      ev('SUBMITTED', ago(1), { area_district_codes: ['D2', 'BINH_THANH'], reply_within_hours: 48 }, 'inq-2'),
      ev('SUBMITTED', ago(200), {}, 'inq-3'), ev('CONFIRMED', ago(199), {}, 'inq-3'),
      ev('CLOSED', ago(100), { reason: 'NOTHING_FOUND' }, 'inq-3'),
      ev('SUBMITTED', ago(5), {}, 'inq-4'), ev('CONFIRMED', ago(4), {}, 'inq-4'),
    ];
    db.tables.external_properties = [
      { id: 'lst-1', title: 'Celadon 2BR', images: ['/relative.jpg', 'https://img/1.jpg'], price_vnd: 18_000_000, bedrooms: 2, is_active: true,
        contact_phone: '0903333333', contact_name: 'Agent Anh' },
    ];
  });

  const list = () => listRenterInquiries(db, 'user-1', { now: NOW, businessPhone: BUSINESS, sinceDays: 90 });

  it("lists the account's WhatsApp requests, newest first, by account or by linked number", async () => {
    const out = await list();
    expect(out.map(q => q.id)).toEqual(['inq-2', 'inq-1', 'inq-3']);
  });

  it('names each by building or area, with its code', async () => {
    const [search, building] = await list();
    expect(search).toMatchObject({ kind: 'AREA', place: 'District 2 and Binh Thanh', code: 'HW-BBBB', stage: 'SEND_CODE' });
    expect(building).toMatchObject({ kind: 'BUILDING', place: 'Celadon City', code: 'HW-AAAA', stage: 'FOUND' });
  });

  it('before the code arrives the button sends it; after, it opens a plain chat', async () => {
    const [search, building] = await list();
    expect(decodeURIComponent(search.waLink)).toBe(
      'https://wa.me/84900000000?text=Hi Hausto - please search District 2 and Binh Thanh for me (HW-BBBB)');
    expect(building.waLink).toBe('https://wa.me/84900000000');
  });

  it('reads the found place from the listing, its first real photo, and no contact', async () => {
    const [, building, old] = await list();
    expect(building.found).toEqual([{
      listingId: 'lst-1', title: 'Celadon 2BR', imageUrl: 'https://img/1.jpg', priceVnd: 18_000_000, bedrooms: 2,
      listed: true, path: '/property/lst-1?inq=inq-1',
    }]);
    expect(old.stage).toBe('NOTHING_FOUND');
    const json = JSON.stringify(await list());
    for (const leak of ['0903333333', 'Agent Anh', 'Jane Renter', '+8490', 'ren-1', 'user-1']) {
      expect(json).not.toContain(leak);
    }
  });

  it('an account with no requests and no number gets an empty list', async () => {
    expect(await listRenterInquiries(db, 'user-9', { now: NOW, businessPhone: BUSINESS, sinceDays: 90 })).toEqual([]);
  });
});
