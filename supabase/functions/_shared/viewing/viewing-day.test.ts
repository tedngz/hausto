// The viewing-day message (viewing-day.ts): where to go, who to meet, and the
// agent's number when they agreed - the one place invariant 4 lets a realtor's
// number reach a renter, so most of what is asserted here is when it must not.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';
import {
  validateViewingDetails,
  keptViewings,
  viewingDayDue,
  viewingDaySendAt,
  dayStops,
  renderViewingDay,
  viewingDayTemplateParams,
  sendViewingDay,
  formatAgentPhone,
  TEMPLATE_PLACE_MAX,
  type DayRequest,
  type DayStop,
} from './viewing-day.ts';

// Saturday 3 October 2026. 03:00Z is 10:00 in Ho Chi Minh City, 07:00Z is 14:00.
const DATE = '2026-10-03';
const TEN = '2026-10-03T03:00:00.000Z';
const TWO = '2026-10-03T07:00:00.000Z';
const MORNING = new Date('2026-10-03T00:30:00.000Z'); // 07:30 there

let seq = 0;
const ev = (
  type: string, payload: Record<string, unknown> = {}, itemId: string | null = null, request = 'r',
  at = '2026-09-28T00:00:00.000Z',
): DomainEvent => ({ id: ++seq, request_id: request, item_id: itemId, type, payload, actor: 'SYSTEM', occurred_at: at });

/** A request whose renter kept i1 at 10:00 and i2 at 14:00, both agents having confirmed. */
function confirmedLog(opts: { request?: string; kept?: string[]; details?: Record<string, Record<string, unknown>> } = {}) {
  const r = opts.request ?? 'r';
  const t = (m: number) => new Date(Date.parse('2026-09-28T00:00:00Z') + m * 60_000).toISOString();
  const log = [
    ev('REQUEST_SUBMITTED', {}, null, r, t(0)),
    ev('ITEM_ADDED', { listing_id: 'l1' }, 'i1', r, t(0)),
    ev('ITEM_ADDED', { listing_id: 'l2' }, 'i2', r, t(0)),
    ev('OUTCOME_RECORDED', { outcome: 'CONFIRMED', slots: [{ starts_at: TEN, duration_minutes: 30 }] }, 'i1', r, t(1)),
    ev('OUTCOME_RECORDED', { outcome: 'CONFIRMED', slots: [{ starts_at: TWO, duration_minutes: 30 }] }, 'i2', r, t(2)),
    ev('ITINERARY_DELIVERED', { message_id: 'm1' }, null, r, t(3)),
    ev('REQUEST_CONFIRMED', { confirmed_item_ids: opts.kept ?? ['i1', 'i2'] }, null, r, t(4)),
  ];
  let m = 5;
  for (const [itemId, payload] of Object.entries(opts.details ?? {})) {
    log.push(ev('VIEWING_DETAILS_RECORDED', payload, itemId, r, t(m++)));
  }
  return log;
}

const MEET_L4 = { meeting_point: 'Lobby of tower L4, 208 Nguyen Huu Canh', agent_first_name: 'Minh', share_phone: true };
const MEET_NASSIM = { meeting_point: 'Reception, The Nassim, 23 Thao Dien', agent_first_name: 'Lan', share_phone: false };

const LISTINGS = new Map([
  ['i1', { title: 'Sunny 2BR in Vinhomes Central Park', location: 'Street Nguyen Huu Canh, Binh Thanh', realtorId: 'a1' }],
  ['i2', { title: 'Studio at The Nassim', location: 'Thao Dien, District 2', realtorId: 'a2' }],
]);
const PHONES = new Map([['a1', '+84901234567'], ['a2', '+84938765432']]);

const dayRequest = (events: DomainEvent[], id = 'r'): DayRequest =>
  ({ id, ref: 'HV-4KX9', view: reduceRequest(id, events), listings: LISTINGS });

describe('the reducer', () => {
  it('keeps the latest details per item, and moves no state', () => {
    const events = confirmedLog({ details: { i1: MEET_L4 } });
    events.push(ev('VIEWING_DETAILS_RECORDED', { ...MEET_L4, share_phone: false }, 'i1', 'r', '2026-09-29T00:00:00.000Z'));
    const view = reduceRequest('r', events);
    expect(view.items.i1.details).toEqual({
      meetingPoint: MEET_L4.meeting_point, agentFirstName: 'Minh', sharePhone: false,
    });
    expect(view.items.i1.state).toBe('CONFIRMED');
    expect(view.state).toBe('CONFIRMED');
  });

  it('ignores details with no meeting point or no item', () => {
    const events = confirmedLog();
    events.push(ev('VIEWING_DETAILS_RECORDED', { agent_first_name: 'Minh', share_phone: true }, 'i1'));
    events.push(ev('VIEWING_DETAILS_RECORDED', MEET_L4, null));
    expect(reduceRequest('r', events).items.i1.details).toBeUndefined();
  });

  it('records each day sent once', () => {
    const events = confirmedLog();
    events.push(ev('VIEWING_DAY_SENT', { date: DATE, message_id: 'x' }));
    events.push(ev('VIEWING_DAY_SENT', { date: DATE, message_id: 'x' }));
    expect(reduceRequest('r', events).viewingDaysSent).toEqual([DATE]);
  });

  it('reduces the same in any order', () => {
    // Details can be recorded before the outcome lands in the log (a slow
    // write, a replay); whatever order they arrive in, the view is the same.
    const events = [
      ...confirmedLog({ details: { i1: MEET_L4, i2: MEET_NASSIM } }),
      ev('VIEWING_DAY_SENT', { date: DATE, message_id: 'x' }, null, 'r', '2026-10-03T00:30:00.000Z'),
    ];
    const forwards = reduceRequest('r', events);
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 50; n++) {
      const shuffled = [...events].sort(() => rand() - 0.5);
      expect(reduceRequest('r', shuffled)).toEqual(forwards);
    }
    expect([...events].reverse().length).toBe(events.length);
    expect(reduceRequest('r', [...events].reverse())).toEqual(forwards);
  });
});

describe('what the operator may record', () => {
  it('takes a meeting point, a first name and an explicit yes or no', () => {
    const r = validateViewingDetails({ meetingPoint: '  Lobby of  tower L4\n208 NHC ', agentFirstName: ' Minh ', sharePhone: true });
    expect(r).toEqual({ ok: true, value: { meetingPoint: 'Lobby of tower L4 208 NHC', agentFirstName: 'Minh', sharePhone: true } });
  });

  it('refuses any phone number typed into the free text', () => {
    // The only number the renter gets is the agent's own, from their contact,
    // with their consent. One typed here could be anyone's.
    for (const meetingPoint of ['Call 0901 234 567 at the gate', 'Lobby, +44 7700 900123']) {
      const r = validateViewingDetails({ meetingPoint, agentFirstName: 'Minh', sharePhone: false });
      expect(r.ok).toBe(false);
    }
    expect(validateViewingDetails({ meetingPoint: 'Lobby', agentFirstName: 'Minh 0901234567', sharePhone: false }).ok).toBe(false);
  });

  it('will not guess the consent', () => {
    expect(validateViewingDetails({ meetingPoint: 'Lobby of L4', agentFirstName: 'Minh' }).ok).toBe(false);
    expect(validateViewingDetails({ meetingPoint: 'Lobby of L4', sharePhone: 'yes' }).ok).toBe(false);
  });

  it('needs somewhere to meet', () => {
    expect(validateViewingDetails({ meetingPoint: ' ', sharePhone: false }).ok).toBe(false);
    expect(validateViewingDetails({ meetingPoint: 'x'.repeat(201), sharePhone: false }).ok).toBe(false);
  });
});

describe('when it is owed', () => {
  it('only for viewings the renter kept, in a confirmed request', () => {
    expect(keptViewings(reduceRequest('r', confirmedLog({ kept: ['i2'] }))).map(v => v.itemId)).toEqual(['i2']);
    // Delivered but not answered: not a plan yet.
    const unanswered = confirmedLog().filter(e => e.type !== 'REQUEST_CONFIRMED');
    expect(keptViewings(reduceRequest('r', unanswered))).toEqual([]);
    const cancelled = [...confirmedLog(), ev('REQUEST_CANCELLED', { reason: 'RENTER_DECLINED' }, null, 'r', '2026-09-30T00:00:00.000Z')];
    expect(keptViewings(reduceRequest('r', cancelled))).toEqual([]);
  });

  it('goes at 07:00 there, or two hours before an earlier first viewing', () => {
    expect(new Date(viewingDaySendAt(DATE, TEN)).toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(new Date(viewingDaySendAt(DATE, '2026-10-03T01:00:00.000Z')).toISOString()).toBe('2026-10-02T23:00:00.000Z');
  });

  it('is owed from then until the last viewing starts, and never twice', () => {
    const view = reduceRequest('r', confirmedLog());
    expect(viewingDayDue(view, Date.parse('2026-10-02T12:00:00Z'))).toBeNull(); // the evening before
    expect(viewingDayDue(view, Date.parse('2026-10-02T23:59:00Z'))).toBeNull(); // 06:59
    expect(viewingDayDue(view, MORNING.getTime())).toBe(DATE);
    expect(viewingDayDue(view, Date.parse('2026-10-03T05:00:00Z'))).toBe(DATE); // between the two
    expect(viewingDayDue(view, Date.parse(TWO))).toBeNull();
    const sent = reduceRequest('r', [...confirmedLog(), ev('VIEWING_DAY_SENT', { date: DATE })]);
    expect(viewingDayDue(sent, MORNING.getTime())).toBeNull();
  });
});

describe("the agent's number (invariant 4)", () => {
  it('goes only with consent', () => {
    const stops = dayStops([dayRequest(confirmedLog({ details: { i1: MEET_L4, i2: MEET_NASSIM } }))], DATE, PHONES);
    expect(stops.map(s => [s.itemId, s.agentPhone])).toEqual([['i1', '+84901234567'], ['i2', null]]);
  });

  it('never without recorded details, whatever numbers the caller holds', () => {
    const stops = dayStops([dayRequest(confirmedLog())], DATE, PHONES);
    expect(stops.every(s => s.agentPhone === null)).toBe(true);
  });

  it('never for a viewing on another day, or one the renter did not keep', () => {
    const kept = dayStops([dayRequest(confirmedLog({ kept: ['i2'], details: { i1: MEET_L4 } }))], DATE, PHONES);
    expect(kept.map(s => s.itemId)).toEqual(['i2']);
    expect(dayStops([dayRequest(confirmedLog({ details: { i1: MEET_L4 } }))], '2026-10-04', PHONES)).toEqual([]);
  });

  it('property: every number in a stop is a consented, kept viewing on that day', () => {
    // Random logs over the things that decide it - which items were kept,
    // whether the request was confirmed or cancelled, what consent was
    // recorded and in which order - and the rule checked from outside.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 300; n++) {
      const kept = ['i1', 'i2'].filter(() => rand() < 0.6);
      const log = confirmedLog({ kept });
      const consents: Record<string, boolean | undefined> = {};
      for (const itemId of ['i1', 'i2']) {
        const k = Math.floor(rand() * 4); // none, yes, no, yes-then-no
        if (k === 0) continue;
        const later = (i: number) => new Date(Date.parse('2026-09-29T00:00:00Z') + i * 60_000).toISOString();
        log.push(ev('VIEWING_DETAILS_RECORDED', { ...MEET_L4, share_phone: k !== 2 }, itemId, 'r', later(n * 3)));
        if (k === 3) log.push(ev('VIEWING_DETAILS_RECORDED', { ...MEET_L4, share_phone: false }, itemId, 'r', later(n * 3 + 1)));
        consents[itemId] = k === 1;
      }
      const cancelled = rand() < 0.2;
      if (cancelled) log.push(ev('REQUEST_CANCELLED', { reason: 'OTHER' }, null, 'r', '2026-10-01T00:00:00.000Z'));
      const date = rand() < 0.8 ? DATE : '2026-10-04';

      const stops = dayStops([dayRequest(log.sort(() => rand() - 0.5))], date, PHONES);
      for (const s of stops) {
        if (!s.agentPhone) continue;
        expect(cancelled).toBe(false);
        expect(date).toBe(DATE);
        expect(kept).toContain(s.itemId);
        expect(consents[s.itemId]).toBe(true);
      }
      const text = stops.length ? renderViewingDay(stops, date) : '';
      for (const [itemId, phone] of [['i1', PHONES.get('a1')!], ['i2', PHONES.get('a2')!]]) {
        const shown = text.includes(formatAgentPhone(phone));
        const allowed = !cancelled && date === DATE && kept.includes(itemId) && consents[itemId] === true;
        if (shown) expect(allowed).toBe(true);
      }
    }
  });
});

describe('the words', () => {
  const both = () => dayStops([dayRequest(confirmedLog({ details: { i1: MEET_L4, i2: MEET_NASSIM } }))], DATE, PHONES);

  it('says where, who, and how to reach them', () => {
    const text = renderViewingDay(both(), DATE);
    expect(text).toContain('Your viewings today, Sat 3 Oct:');
    expect(text).toContain('1. 10:00 - Sunny 2BR in Vinhomes Central Park');
    expect(text).toContain('   Meet: Lobby of tower L4, 208 Nguyen Huu Canh');
    expect(text).toContain('   Agent: Minh, +84 90 123 4567');
    expect(text).toContain('   Agent: Lan');
    expect(text).not.toContain('+84 93');
    expect(text).toContain('Call the agent, or reply here');
    expect(text).toContain('Ref HV-4KX9');
    expect(text).not.toMatch(/\bbook(ed|ing)\b/i);
    expect(text).not.toContain('—');
  });

  it('falls back to the listing location, and to us, when nothing was recorded', () => {
    const stops = dayStops([dayRequest(confirmedLog({ kept: ['i2'] }))], DATE, PHONES);
    const text = renderViewingDay(stops, DATE);
    expect(text).toContain('Your viewing today, Sat 3 Oct:');
    expect(text).toContain('14:00 - Studio at The Nassim');
    expect(text).toContain('Where: Thao Dien, District 2');
    expect(text).not.toContain('Agent:');
    expect(text).toContain('Reply here and we will reach the agent for you.');
  });

  it('fits the approved viewing_reminder template on one line', () => {
    const [name, when, place] = viewingDayTemplateParams('Tran Thi Lan', both());
    expect(name).toBe('Tran');
    expect(when).toBe('today at 10:00');
    expect(place).toBe(
      'Sunny 2BR in Vinhomes Central Park - meet: Lobby of tower L4, 208 Nguyen Huu Canh - agent: Minh, +84 90 123 4567; ' +
      'then 14:00 at Studio at The Nassim - meet: Reception, The Nassim, 23 Thao Dien - agent: Lan',
    );
    expect(viewingDayTemplateParams(null, both())[0]).toBe('there');
  });

  it('leaves the rest to a reply when the day is too long for one parameter', () => {
    const long: DayStop[] = Array.from({ length: 5 }, (_, i) => ({
      requestId: 'r', itemId: `i${i}`, ref: 'HV-4KX9', startsAt: TEN, listingTitle: 'A'.repeat(150),
      where: 'B'.repeat(150), meetingPointKnown: true, agentFirstName: 'Minh', agentPhone: null,
    }));
    const place = viewingDayTemplateParams('Lan', long)[2];
    expect(place).toMatch(/and \d more today - reply here for the full list$/);
    expect(place.length).toBeLessThan(TEMPLATE_PLACE_MAX + 60);
    expect(place).not.toMatch(/[\n\t]| {4}/);
  });
});

describe('sending it', () => {
  let db: FakeDb;
  let adapter: MockAdapter;

  const pushLog = (events: DomainEvent[]) => events.forEach(e => db.tables.events.push({ ...e, id: `e${e.id}` }));

  beforeEach(() => {
    seq = 0;
    db = new FakeDb();
    adapter = new MockAdapter();
    db.tables.renters.push({
      id: 'renter-1', phone_e164: '+447700900123', display_name: 'Sam Carter',
      service_window_expires_at: null, opted_out_at: null,
    });
    db.tables.realtors = [
      { id: 'a1', phone_e164: '+84901234567', display_name: 'Minh' },
      { id: 'a2', phone_e164: '+84938765432', display_name: 'Lan' },
    ];
    db.tables.external_properties.push(
      { id: 'l1', title: 'Sunny 2BR in Vinhomes Central Park', location: 'Street Nguyen Huu Canh, Binh Thanh' },
      { id: 'l2', title: 'Studio at The Nassim', location: 'Thao Dien, District 2' },
    );
    db.tables.viewing_requests.push({ id: 'r', ref: 'HV-4KX9', renter_id: 'renter-1', created_at: '2026-09-28T00:00:00Z' });
    db.tables.request_items.push(
      { id: 'i1', request_id: 'r', listing_id: 'l1', realtor_id: 'a1', price_vnd_at_request: 20_000_000 },
      { id: 'i2', request_id: 'r', listing_id: 'l2', realtor_id: 'a2', price_vnd_at_request: 12_000_000 },
    );
  });

  // deno-lint-ignore no-explicit-any
  const send = (requestId = 'r', attempt = 1) => sendViewingDay(db as any, adapter, { requestId, now: MORNING, attempt });

  it('uses the approved reminder template when the window has closed', async () => {
    pushLog(confirmedLog({ details: { i1: MEET_L4, i2: MEET_NASSIM } }));
    const r = await send();
    expect(r).toMatchObject({ ok: true, via: 'TEMPLATE', date: DATE, stops: 2 });
    expect(adapter.delivered).toHaveLength(1);
    expect(adapter.delivered[0].templateName).toBe('viewing_reminder');
    expect(adapter.delivered[0].templateParams?.[2]).toContain('+84 90 123 4567');
    expect(adapter.delivered[0].templateParams?.[2]).not.toContain('+84 93');
    expect(db.tables.events.filter(e => e.type === 'VIEWING_DAY_SENT')).toHaveLength(1);
  });

  it('sends the full message free-form when the window is open', async () => {
    db.tables.renters[0].service_window_expires_at = new Date(MORNING.getTime() + 3600_000).toISOString();
    pushLog(confirmedLog({ details: { i1: MEET_L4 } }));
    const r = await send();
    expect(r).toMatchObject({ ok: true, via: 'FREE_FORM' });
    expect(adapter.delivered[0].body).toContain('Meet: Lobby of tower L4');
  });

  it('is one message for a renter with two requests that day', async () => {
    // A second request, confirmed separately, with one viewing at 16:00.
    db.tables.viewing_requests.push({ id: 'r2', ref: 'HV-7PQ3', renter_id: 'renter-1', created_at: '2026-09-29T00:00:00Z' });
    db.tables.external_properties.push({ id: 'l3', title: 'Loft in District 3', location: 'District 3' });
    db.tables.request_items.push({ id: 'i3', request_id: 'r2', listing_id: 'l3', realtor_id: 'a1', price_vnd_at_request: 18_000_000 });
    pushLog(confirmedLog({ details: { i1: MEET_L4 } }));
    pushLog([
      ev('REQUEST_SUBMITTED', {}, null, 'r2'),
      ev('ITEM_ADDED', { listing_id: 'l3' }, 'i3', 'r2'),
      ev('OUTCOME_RECORDED', { outcome: 'CONFIRMED', slots: [{ starts_at: '2026-10-03T09:00:00.000Z', duration_minutes: 30 }] }, 'i3', 'r2', '2026-09-29T01:00:00.000Z'),
      ev('ITINERARY_DELIVERED', { message_id: 'm9' }, null, 'r2', '2026-09-29T02:00:00.000Z'),
      ev('REQUEST_CONFIRMED', { confirmed_item_ids: ['i3'] }, null, 'r2', '2026-09-29T03:00:00.000Z'),
    ]);

    const first = await send('r2');
    expect(first).toMatchObject({ ok: true, stops: 3, deduplicated: false });
    // The other request's job finds its day already sent.
    expect(await send('r')).toMatchObject({ ok: false, code: 'not_due' });
    expect(adapter.delivered).toHaveLength(1);
    expect(adapter.delivered[0].templateParams?.[2]).toContain('then 16:00 at Loft in District 3');
    const sent = db.tables.events.filter(e => e.type === 'VIEWING_DAY_SENT');
    expect(sent.map(e => e.request_id).sort()).toEqual(['r', 'r2']);
    // Both requests now read as sent for the day.
    for (const id of ['r', 'r2']) {
      const view = reduceRequest(id, db.tables.events.filter(e => e.request_id === id) as unknown as DomainEvent[]);
      expect(viewingDayDue(view, MORNING.getTime())).toBeNull();
    }
  });

  it("is the same message when the other request's job runs before the events land", async () => {
    // The second job reads "not sent yet" because the first one's
    // VIEWING_DAY_SENT has not been written: the key is the renter and the
    // date, not the request, so it finds the first job's row and sends nothing.
    db.tables.viewing_requests.push({ id: 'r2', ref: 'HV-7PQ3', renter_id: 'renter-1', created_at: '2026-09-29T00:00:00Z' });
    db.tables.external_properties.push({ id: 'l3', title: 'Loft in District 3', location: 'District 3' });
    db.tables.request_items.push({ id: 'i3', request_id: 'r2', listing_id: 'l3', realtor_id: 'a1', price_vnd_at_request: 1 });
    pushLog(confirmedLog({ details: { i1: MEET_L4 } }));
    pushLog([
      ev('OUTCOME_RECORDED', { outcome: 'CONFIRMED', slots: [{ starts_at: '2026-10-03T09:00:00.000Z', duration_minutes: 30 }] }, 'i3', 'r2', '2026-09-29T01:00:00.000Z'),
      ev('ITINERARY_DELIVERED', { message_id: 'm9' }, null, 'r2', '2026-09-29T02:00:00.000Z'),
      ev('REQUEST_CONFIRMED', { confirmed_item_ids: ['i3'] }, null, 'r2', '2026-09-29T03:00:00.000Z'),
    ]);
    expect(await send('r')).toMatchObject({ ok: true, deduplicated: false });
    db.tables.events = db.tables.events.filter(e => e.type !== 'VIEWING_DAY_SENT');
    expect(await send('r2')).toMatchObject({ ok: true, deduplicated: true });
    expect(adapter.delivered).toHaveLength(1);
  });

  it('owes nothing for a request the renter has not said yes to', async () => {
    pushLog(confirmedLog().filter(e => e.type !== 'REQUEST_CONFIRMED'));
    expect(await send()).toMatchObject({ ok: false, code: 'not_due' });
    expect(adapter.delivered).toHaveLength(0);
  });

  it('reads no agent number it is not going to send', async () => {
    // Nobody consented, so the realtors table is never read at all.
    pushLog(confirmedLog({ details: { i2: MEET_NASSIM } }));
    const reads: string[] = [];
    const from = db.from.bind(db);
    db.from = (table: string) => { reads.push(table); return from(table); };
    await send();
    expect(reads).not.toContain('realtors');
    expect(JSON.stringify(adapter.delivered)).not.toMatch(/\+84 ?9/);
  });
});
