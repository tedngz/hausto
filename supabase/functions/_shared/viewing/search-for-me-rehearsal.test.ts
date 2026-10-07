// Search for me, end to end (the pricing rework, step 5; SPEC §11): an area
// request from the brief, to the agents asked, to one offer, to the viewing
// request it leads to - on the FakeDb and the MockAdapter, through the calls
// the form, the webhook, the console and the Zalo bridge make. Silent unless:
//
//   REHEARSAL_PRINT=1 npx vitest run rehearsal

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { BridgeChannel } from '../realtor/channel.ts';
import { bridgeAck, bridgeInbound, bridgePull } from '../realtor/bridge.ts';
import { availabilityDraft } from '../realtor/drafts.ts';
import { SupabaseRealtorMessageStore } from '../realtor/store.ts';
import { performOpsAction, type OpsDeps } from './ops-actions.ts';
import { handleInbound } from './routing.ts';
import { decideAction } from './agent.ts';
import { performAction } from './agent-act.ts';
import { linkViewingToInquiry } from './concierge.ts';
import { createInquiry } from './inquiry-create.ts';
import { INQUIRY_DEADLINE_JOB } from './inquiry-deadline.ts';
import { screenCandidates, type ShortlistCandidate } from './intake.ts';
import { areaLabelVi } from './place.ts';
import { inquiryDeadline, reduceInquiry, type InquiryEvent } from '../viewing-domain.ts';

const USER = 'user-with-pass';
const PHONE = '+447700900123';
const BUSINESS = '+84901112222';
// On file, and listing in District 2 - so on the area's roster.
const LINH = '99999999-2222-4333-8444-000000000001';
const LINH_PHONE = '+84901234567';
const PRINT = process.env.REHEARSAL_PRINT === '1';

function say(who: string, body: string) {
  if (!PRINT) return;
  const rule = '─'.repeat(64);
  console.log(`\n${rule}\n  ${who}\n${rule}`);
  console.log(body.split('\n').map(l => '  ' + l).join('\n'));
}

/** vn_district_code, as far as these locations need it. */
function districtOf(location: string): string | null {
  const loc = location.toLowerCase();
  if (loc.includes('thu duc')) return 'THU_DUC';
  if (loc.includes('binh thanh')) return 'BINH_THANH';
  const n = loc.match(/(?:quan|district)\s*(\d{1,2})/);
  return n ? `D${Number(n[1])}` : null;
}

let db: FakeDb;
let deps: OpsDeps;
let whatsapp: MockAdapter;

const at = (iso: string) => vi.setSystemTime(new Date(iso));
// deno-lint-ignore no-explicit-any
const act = (input: Record<string, unknown>) => performOpsAction(db as any, deps, 'OPS:op-1', input);
const search = () => db.tables.complex_inquiries[0];
const view = () => reduceInquiry(String(search().id), db.tables.inquiry_events as unknown as InquiryEvent[]);

const brief = {
  areaDistrictCodes: ['D2', 'BINH_THANH'],
  name: 'Mai Nguyen',
  moveInDate: '2026-11-15',
  leaseMonths: 12,
  bedrooms: 2,
  budgetMaxVnd: 25_000_000,
  hasPets: false,
  notes: 'Near the river if possible',
};
// deno-lint-ignore no-explicit-any
const create = (raw: unknown, userId: string | null) => createInquiry(db as any, raw, { userId, now: new Date(), businessPhone: BUSINESS });

/** A renter's WhatsApp message, and our automatic reply if there is one - as the webhook does it. */
async function renterSends(text: string) {
  say('Renter', text);
  // deno-lint-ignore no-explicit-any
  const outcome = await handleInbound(db as any, deps.messages, {
    from: PHONE, text, providerMessageId: `wamid.${Math.random()}`, timestamp: new Date().toISOString(),
  });
  const action = decideAction({
    enabled: false, intent: outcome.intent, text, requestId: outcome.requestId,
    optedOut: outcome.optedOut, confirmed: outcome.confirmed, selection: outcome.selection,
    watch: outcome.watch, alertMessageId: outcome.alertMessageId, inquiryId: outcome.inquiryId,
  });
  let reply: string | undefined;
  if (action.kind !== 'NONE' && action.kind !== 'SEARCH') {
    // deno-lint-ignore no-explicit-any
    const result = await performAction(db as any, whatsapp, action, {
      renterId: outcome.renterId, requestId: outcome.requestId, providerMessageId: 'wamid.x',
    });
    expect(result.error).toBeUndefined();
    reply = String(db.tables.messages.find(m => m.id === result.messageId)?.body ?? '');
    say('Hausto', reply);
  }
  return { outcome, action, reply };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-10-06T03:00:00Z'); // a Tuesday, 10:00 in HCMC
  db = new FakeDb();
  whatsapp = new MockAdapter();
  deps = {
    whatsapp,
    // deno-lint-ignore no-explicit-any
    messages: new SupabaseMessageStore(db as any),
    realtorChannel: new BridgeChannel(),
    // deno-lint-ignore no-explicit-any
    realtorMessages: new SupabaseRealtorMessageStore(db as any),
  };
  db.passHolders.add(USER);
  Object.assign(db.tables, {
    complexes: [], complex_watches: [], complex_inquiries: [], inquiry_events: [], complex_inquiry_messages: [],
    realtors: [{ id: LINH, phone_e164: LINH_PHONE, display_name: 'Linh' }],
    realtor_messages: [], alert_items: [],
  });
  // An advertised 2BR in District 2, from Linh: a lead for the search, never an offer.
  db.tables.external_properties.push({
    id: 'l-ad', source: 'batdongsan', external_id: 'bds-1', is_active: true, price_vnd: 22_000_000,
    price_confidence: 'HIGH', bedrooms: 2, area_sqm: 75, district_code: 'D2', realtor_id: LINH,
    title: '2BR in Thao Dien, river view', last_verified_at: null,
  });
  // The database's defaults and triggers, for the rows this writes: a uuid for
  // a new agent, and sync_canonical_listing_fields() for a captured unit -
  // its district read from its location, as vn_district_code reads it.
  db.onInsert.realtors = row => ({ ...row, id: crypto.randomUUID() });
  db.onInsert.external_properties = row => ({
    ...row,
    bedrooms: parseInt(String(row.rooms), 10),
    area_sqm: parseInt(String(row.size), 10),
    price_vnd: Number(row.price),
    price_confidence: 'HIGH',
    district_code: districtOf(String(row.location ?? '')),
  });
});
afterEach(() => vi.useRealTimers());

describe('Search for me rehearsal', () => {
  it('goes from the brief, to agents asked, to one offer, to a linked viewing request', async () => {
    if (PRINT) console.log('\n\n══ REHEARSAL - Search for me, District 2 and Binh Thanh ══');

    // 1. The brief, from the search modal. Nothing is sent until the code arrives.
    const created = await create(brief, USER);
    expect(created).toMatchObject({ status: 200, body: { kind: 'AREA', complexName: 'District 2 and Binh Thanh' } });
    expect(search()).toMatchObject({
      complex_id: null, area_district_codes: ['D2', 'BINH_THANH'], area_label: 'District 2 and Binh Thanh', user_id: USER,
    });
    expect(db.tables.inquiry_events[0]).toMatchObject({ type: 'SUBMITTED', payload: { reply_within_hours: 48 } });
    expect(db.tables.complex_watches[0]).toMatchObject({ complex_id: null, area_label: 'District 2 and Binh Thanh', status: 'PENDING' });
    const id = String(search().id);
    const text = decodeURIComponent(String(created.body.waLink).split('?text=')[1]);
    expect(text).toBe(`Hi Hausto - please search District 2 and Binh Thanh for me (${created.body.code})`);

    // 2. The code. The search is confirmed, and its 48 hours start.
    at('2026-10-06T03:05:00Z');
    const first = await renterSends(text);
    expect(first.action.kind).toBe('WATCH_CONFIRMED');
    expect(first.reply).toContain('Thanks Mai - your search in District 2 and Binh Thanh is in');
    expect(first.reply).toContain('within 48 hours');
    expect(first.reply).not.toMatch(/[—–]/);
    expect(view().state).toBe('NEW');
    expect(inquiryDeadline(view())).toBe('2026-10-08T03:05:00.000Z');
    // The reminders move out with the promise: 8 and 2 hours before it.
    expect(db.tables.jobs.filter(j => j.kind === INQUIRY_DEADLINE_JOB).map(j => j.run_after))
      .toEqual(['2026-10-07T19:05:00.000Z', '2026-10-08T01:05:00.000Z']);

    // 3. Agents asked. Linh, on file, on Zalo through the bridge - the area in
    //    the draft, nothing about Mai.
    at('2026-10-06T04:00:00Z');
    const draft = availabilityDraft({
      complexName: `khu vực ${areaLabelVi(['D2', 'BINH_THANH'])}`, bedrooms: 2, budgetMaxVnd: 25_000_000,
      moveInDate: '2026-11-15', leaseMonths: 12, hasPets: false,
    });
    expect(draft).toContain('đang tìm căn ở khu vực Quận 2 và Bình Thạnh cho khách');
    say('Hausto to Linh  [Zalo, through the bridge]', draft);
    expect((await act({ action: 'INQUIRY_ASK_AGENT', inquiryId: id, realtorId: LINH, medium: 'ZALO', message: draft })).body)
      .toMatchObject({ recorded: 'AGENT_ASKED', queued: true });
    // deno-lint-ignore no-explicit-any
    const pulled = await bridgePull(db as any, new Date());
    // deno-lint-ignore no-explicit-any
    await bridgeAck(db as any, { messageId: pulled.outbox[0].messageId, sent: true, providerId: 'z1' }, new Date());
    expect(view().agents[LINH]).toMatchObject({ medium: 'ZALO', askedAt: '2026-10-06T04:00:00.000Z' });
    expect(view().state).toBe('SOURCING');

    //    And an agent met in a Facebook group, not on file: asked by their number.
    expect((await act({
      action: 'INQUIRY_ASK_AGENT', inquiryId: id, agentPhone: '0907 654 321', agentName: 'Huy', medium: 'PHONE',
    })).status).toBe(200);
    const huy = db.tables.realtors.find(r => r.phone_e164 === '+84907654321');
    expect(huy).toMatchObject({ display_name: 'Huy' });
    expect(view().agents[String(huy!.id)]).toMatchObject({ medium: 'PHONE' });
    // A number that is not a Vietnamese mobile is no agent's.
    expect((await act({ action: 'INQUIRY_ASK_AGENT', inquiryId: id, agentPhone: '+44 7700 900123', medium: 'PHONE' })).body.error)
      .toBe('invalid_phone');

    // Linh answers on Zalo, and it lands on this search.
    at('2026-10-06T06:00:00Z');
    // deno-lint-ignore no-explicit-any
    expect(await bridgeInbound(db as any, {
      fromPhone: LINH_PHONE, text: 'Còn 1 căn 2PN Masteri Thảo Điền, tầng 12, 80m2, 24tr', providerMessageId: 'zin-1',
    })).toMatchObject({ stored: true, inquiryId: id });

    // 4. Units, each with where it is: one of the search's districts.
    const unit = { realtorId: LINH, bedrooms: 2, areaSqm: 80, priceVnd: 24_000_000, floor: '12', building: 'Masteri Thao Dien' };
    expect((await act({ action: 'INQUIRY_CAPTURE_UNIT', inquiryId: id, ...unit })).body.error).toBe('invalid_district');
    expect((await act({ action: 'INQUIRY_CAPTURE_UNIT', inquiryId: id, ...unit, districtCode: 'D7' })).body.error)
      .toBe('invalid_district');
    // A building named after another district would be filed there by the trigger.
    expect((await act({
      action: 'INQUIRY_CAPTURE_UNIT', inquiryId: id, ...unit, building: 'Thu Duc House', districtCode: 'D2',
    })).body.error).toBe('wrong_district');
    expect(db.tables.external_properties.map(l => l.id)).toEqual(['l-ad']);

    const a = await act({ action: 'INQUIRY_CAPTURE_UNIT', inquiryId: id, ...unit, districtCode: 'D2' });
    expect(a.status).toBe(200);
    const aId = String(a.body.listingId);
    expect(db.tables.external_properties.find(l => l.id === aId)).toMatchObject({
      source: 'concierge', title: '2BR at Masteri Thao Dien, floor 12', location: 'Masteri Thao Dien, District 2',
      district_code: 'D2', realtor_id: LINH,
    });
    //    And one from an agent met in a group, entered by number on the capture form.
    const b = await act({
      action: 'INQUIRY_CAPTURE_UNIT', inquiryId: id, agentPhone: '0912 345 678', agentName: 'Trang',
      bedrooms: 2, areaSqm: 72, priceVnd: 21_500_000, building: 'Saigon Pearl', districtCode: 'BINH_THANH',
    });
    expect(b.status).toBe(200);
    const bId = String(b.body.listingId);
    expect(db.tables.external_properties.find(l => l.id === bId)?.district_code).toBe('BINH_THANH');
    expect(view().capturedListingIds).toEqual([aId, bId]);

    // 5. One offer. What is only advertised stays a lead: a search offers what
    //    an agent confirmed.
    at('2026-10-06T08:00:00Z');
    expect(await act({ action: 'INQUIRY_OFFER_UNITS', inquiryId: id, listingIds: [aId, 'l-ad'] }))
      .toMatchObject({ status: 422, body: { error: 'not_confirmed' } });
    const offered = await act({ action: 'INQUIRY_OFFER_UNITS', inquiryId: id, listingIds: [aId, bId], key: 'offer-1' });
    expect(offered.status).toBe(200);
    const sent = whatsapp.delivered.at(-1)!;
    say('Hausto  [the offer, from the console]', String(sent.body));
    expect(sent.toPhone).toBe(PHONE);
    expect(sent.body).toContain('Hi Mai, here is what we found in District 2 and Binh Thanh:');
    expect(sent.body).toContain('1. 2BR at Masteri Thao Dien, floor 12');
    expect(sent.body).toContain('2. 2BR at Saigon Pearl');
    expect(sent.body).toContain(`${aId}?inq=${id}`);
    expect(sent.body).toContain('your Pass covers the viewings');
    expect(sent.body).not.toContain('first viewing is free');
    expect(sent.body).not.toMatch(/[—–]/);
    // No agent's number, on file or met in a group (invariant 4).
    for (const phone of [LINH_PHONE, '+84907654321', '+84912345678']) expect(sent.body).not.toContain(phone);
    expect(view()).toMatchObject({ state: 'OFFERED', offeredListingIds: [aId, bId] });
    // The confirmation and the one offer: nothing else reached her.
    expect(whatsapp.delivered.filter(m => m.toPhone === PHONE)).toHaveLength(2);

    // Her answer comes back to the search, for a person to read.
    at('2026-10-06T09:00:00Z');
    const reply = await renterSends('The first one looks great - can I see it on Saturday?');
    expect(reply.outcome.inquiryId).toBe(id);
    expect(reply.action.kind).toBe('NONE');

    // 6. She opens it and taps Request viewing. Intake takes the unit as it
    //    takes any listing, and the request it makes closes the search.
    const listing = db.tables.external_properties.find(l => l.id === aId) as unknown as ShortlistCandidate;
    expect(screenCandidates([aId], [listing]).eligible.map(c => c.id)).toEqual([aId]);
    db.tables.viewing_requests.push({ id: 'req-1', ref: 'HV-7QK2', renter_id: search().renter_id, inquiry_id: null });
    // deno-lint-ignore no-explicit-any
    expect(await linkViewingToInquiry(db as any, { inquiryId: id, requestId: 'req-1', now: new Date() })).toBe('LINKED');
    expect(db.tables.viewing_requests[0].inquiry_id).toBe(id);
    expect(view()).toMatchObject({ state: 'CLOSED', closedReason: 'VIEWING_REQUESTED' });
  });
});

describe('who may ask', () => {
  it('is a signed-in Pass holder, with one search at a time', async () => {
    expect(await create(brief, null)).toMatchObject({ status: 401, body: { error: 'sign_in_required' } });
    expect(await create(brief, 'user-without-pass')).toMatchObject({ status: 402, body: { error: 'pass_required' } });
    expect(db.tables.complex_inquiries).toHaveLength(0);

    expect((await create(brief, USER)).status).toBe(200);
    const again = await create({ ...brief, areaDistrictCodes: ['D7'] }, USER);
    expect(again).toMatchObject({ status: 409, body: { error: 'one_open_search' } });
    expect(String(again.body.message)).toContain('still searching District 2 and Binh Thanh');

    // Closed, it no longer holds the next one back.
    db.tables.inquiry_events.push({
      id: 99, inquiry_id: search().id, type: 'CLOSED', payload: { reason: 'NOTHING_FOUND' }, actor: 'OPS:op-1',
      occurred_at: new Date().toISOString(),
    });
    expect((await create({ ...brief, areaDistrictCodes: ['D7'] }, USER)).status).toBe(200);
  });

  it('lets go of a search whose code never came, once the code has expired', async () => {
    expect((await create(brief, USER)).status).toBe(200);
    at('2026-10-14T03:00:00Z'); // eight days on, nothing sent from WhatsApp
    expect((await create(brief, USER)).status).toBe(200);
  });

  it('asks the Pass for a building too, since 2026-10-07', async () => {
    const CX = '0b6f7a52-5a8e-4c7a-9f4e-2f7b1f0a9c11';
    db.tables.complexes = [{ id: CX, name: 'Empire City', is_published: true }];
    const building = { ...brief, areaDistrictCodes: undefined, complexId: CX };
    expect(await create(building, null)).toMatchObject({ status: 401, body: { error: 'sign_in_required' } });
    expect(await create(building, 'user-without-pass')).toMatchObject({ status: 402, body: { error: 'pass_required' } });
    const r = await create(building, USER);
    expect(r).toMatchObject({ status: 200, body: { kind: 'BUILDING', complexName: 'Empire City' } });
    expect(search()).toMatchObject({ complex_id: CX, user_id: USER });
    expect(db.tables.inquiry_events[0].payload).not.toHaveProperty('reply_within_hours');
  });
});
