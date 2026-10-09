// A renter changing their own request from the Viewings tab, end to end
// against the in-memory database: what is written, what stops, who is owed
// what, what the renter hears on WhatsApp - and what they are refused.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { ManualChannel } from '../realtor/channel.ts';
import { SupabaseRealtorMessageStore } from '../realtor/store.ts';
import type { OpsDeps } from './ops-actions.ts';
import { applyRenterEdit, describeWindows, RENTER_ACTOR, type RenterEdit } from './renter-edits.ts';
import { renterRequestView } from './renter-view.ts';
import { realtorDecisionsOwed } from './reminders.ts';
import { planRequest, type PlanItem } from './planner.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';

const NOW = Date.parse('2026-09-25T03:00:00Z');
const SLOT = '2026-09-28T03:00:00.000Z';
const OLD = [{ date: '2026-09-28', part: 'MORNING' }];
const NEW = [{ date: '2026-09-29', part: 'AFTERNOON' }, { date: '2026-09-30', part: 'MORNING' }];

let db: FakeDb;
let deps: OpsDeps;
let whatsapp: MockAdapter;
let clock = 0;

const request = () => db.tables.viewing_requests[0] as unknown as { id: string; ref: string; renter_id: string; availability: unknown };
// deno-lint-ignore no-explicit-any
const edit = (e: RenterEdit, clientKey?: string) => applyRenterEdit(db as any, deps, request(), e, { now: NOW, clientKey });
const view = () => reduceRequest('req-1', db.tables.events as unknown as DomainEvent[]);
const eventsOf = (type: string) => db.tables.events.filter(e => e.type === type);

function seed(type: string, payload: Record<string, unknown> = {}, itemId: string | null = null) {
  clock += 1;
  db.tables.events.push({
    id: `seed${clock}`, request_id: 'req-1', item_id: itemId, type, payload, actor: 'SYSTEM',
    occurred_at: new Date(Date.parse('2026-09-24T00:00:00Z') + clock * 1000).toISOString(),
  });
}

beforeEach(() => {
  db = new FakeDb();
  whatsapp = new MockAdapter();
  clock = 0;
  deps = {
    whatsapp,
    // deno-lint-ignore no-explicit-any
    messages: new SupabaseMessageStore(db as any),
    realtorChannel: new ManualChannel(),
    // deno-lint-ignore no-explicit-any
    realtorMessages: new SupabaseRealtorMessageStore(db as any),
  };
  db.tables.renters.push({
    id: 'renter-1', phone_e164: '+84912345678', display_name: 'Lan',
    service_window_expires_at: new Date(Date.now() + 6 * 3600_000).toISOString(), opted_out_at: null,
  });
  db.tables.viewing_requests.push({ id: 'req-1', ref: 'HV-4KX9', renter_id: 'renter-1', availability: OLD, created_at: '2026-09-24T00:00:00Z' });
  db.tables.external_properties.push(
    { id: 'l1', title: 'Căn hộ 2PN Thảo Điền', district_code: 'THU_DUC' },
    { id: 'l2', title: 'Studio Quận 1', district_code: 'Q1' },
  );
  db.tables.request_items.push(
    { id: 'i1', request_id: 'req-1', listing_id: 'l1', realtor_id: 'r1', price_vnd_at_request: 15_000_000 },
    { id: 'i2', request_id: 'req-1', listing_id: 'l2', realtor_id: 'r2', price_vnd_at_request: 9_000_000 },
  );
  seed('REQUEST_SUBMITTED', { availability: OLD });
  seed('ITEM_ADDED', { listing_id: 'l1' }, 'i1');
  seed('ITEM_ADDED', { listing_id: 'l2' }, 'i2');
  seed('REALTOR_CONTACTED', {}, 'i1');
  seed('OUTCOME_RECORDED', { outcome: 'CONFIRMED', slots: [{ starts_at: SLOT, duration_minutes: 30 }] }, 'i1');
});

describe('removing a place', () => {
  it('writes ITEM_WITHDRAWN as the renter and tells them in one line', async () => {
    const r = await edit({ kind: 'REMOVE_PLACE', itemId: 'i1' });
    expect(r).toMatchObject({ ok: true, recorded: 'ITEM_WITHDRAWN', whatsapp: 'SENT' });
    expect(eventsOf('ITEM_WITHDRAWN')[0]).toMatchObject({ item_id: 'i1', actor: RENTER_ACTOR });
    expect(view().items.i1.state).toBe('WITHDRAWN');
    const out = db.tables.messages.filter(m => m.direction === 'OUT');
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe('Done - Căn hộ 2PN Thảo Điền is out of HV-4KX9. 1 place left in it.');
    expect(eventsOf('HOLDING_UPDATE_SENT')).toHaveLength(1);
  });

  it('makes an agent holding time owed a release at once, while the request goes on', async () => {
    await edit({ kind: 'REMOVE_PLACE', itemId: 'i1' });
    expect(view().state).toBe('CONTACTING');
    expect(realtorDecisionsOwed(view())).toEqual([{ itemId: 'i1', decision: 'RELEASE' }]);
  });

  it('owes nothing to an agent nobody had asked', async () => {
    await edit({ kind: 'REMOVE_PLACE', itemId: 'i2' });
    expect(realtorDecisionsOwed(view())).toEqual([]);
  });

  it('stops an ask still waiting in the bridge outbox, and only for that place', async () => {
    (db.tables.realtor_messages ??= []).push(
      { id: 'q1', request_id: 'req-1', item_id: 'i2', direction: 'OUT', purpose: 'REQUEST_VIEWING', status: 'QUEUED', claimed_at: null },
      { id: 'q2', request_id: 'req-1', item_id: 'i1', direction: 'OUT', purpose: 'NUDGE', status: 'QUEUED', claimed_at: null },
      { id: 'q3', request_id: 'req-1', item_id: 'i2', direction: 'OUT', purpose: 'NUDGE', status: 'QUEUED', claimed_at: '2026-09-25T02:59:00Z' },
    );
    await edit({ kind: 'REMOVE_PLACE', itemId: 'i2' });
    const byId = Object.fromEntries(db.tables.realtor_messages.map(m => [m.id, m.status]));
    expect(byId).toEqual({ q1: 'FAILED', q2: 'QUEUED', q3: 'QUEUED' });
  });

  it('refuses the last place: that is cancelling', async () => {
    await edit({ kind: 'REMOVE_PLACE', itemId: 'i2' });
    const r = await edit({ kind: 'REMOVE_PLACE', itemId: 'i1' });
    expect(r).toMatchObject({ ok: false, error: 'last_place' });
    expect(eventsOf('ITEM_WITHDRAWN')).toHaveLength(1);
  });

  it('refuses a place twice, and one not in the request', async () => {
    await edit({ kind: 'REMOVE_PLACE', itemId: 'i2' });
    expect(await edit({ kind: 'REMOVE_PLACE', itemId: 'i2' })).toMatchObject({ ok: false, error: 'already_removed' });
    expect(await edit({ kind: 'REMOVE_PLACE', itemId: 'nope' })).toMatchObject({ ok: false, error: 'unknown_place' });
  });

  it('still makes the change with the renter\'s window shut, and sends nothing', async () => {
    db.tables.renters[0].service_window_expires_at = new Date(Date.now() - 3600_000).toISOString();
    const r = await edit({ kind: 'REMOVE_PLACE', itemId: 'i2' });
    expect(r).toMatchObject({ ok: true, whatsapp: 'NOT_SENT' });
    expect(db.tables.messages).toHaveLength(0);
    expect(view().items.i2.state).toBe('WITHDRAWN');
  });

  it('emails operators what changed, and nothing about the renter', async () => {
    const r = await edit({ kind: 'REMOVE_PLACE', itemId: 'i1' });
    if (!r.ok) throw new Error('refused');
    expect(r.alert.subject).toBe('HV-4KX9 - renter removed a place');
    expect(r.alert.text).not.toMatch(/Lan|912345678/);
    expect(r.alert.text).toMatch(/owed a release/);
  });
});

describe('changing times', () => {
  it('updates the windows, logs the change, and asks every agent again', async () => {
    const r = await edit({ kind: 'CHANGE_TIMES', availability: NEW });
    expect(r).toMatchObject({ ok: true, recorded: 'AVAILABILITY_CHANGED', whatsapp: 'SENT' });
    expect(request().availability).toEqual(NEW);
    expect(eventsOf('AVAILABILITY_CHANGED')[0]).toMatchObject({ actor: RENTER_ACTOR, payload: { availability: NEW, previous: OLD } });
    expect(view().items.i1).toMatchObject({ state: 'PENDING', round: 1, staleHold: true });
    expect(db.tables.messages[0].body).toBe(
      'Done - HV-4KX9 now asks for Tue 29 Sept afternoon, Wed 30 Sept morning. We are asking the agents about the new times.');
  });

  it('has the AI operator ask again, saying the times changed, under a new key', async () => {
    await edit({ kind: 'CHANGE_TIMES', availability: NEW });
    const items: PlanItem[] = [
      { itemId: 'i1', listingTitle: 'Căn hộ 2PN Thảo Điền', unit: { name: 'căn 2PN ở Thảo Điền', url: null }, districtCode: null, priceVnd: 15_000_000, hasContact: true },
      { itemId: 'i2', listingTitle: 'Studio Quận 1', unit: { name: 'căn studio ở Quận 1', url: null }, districtCode: null, priceVnd: 9_000_000, hasContact: true },
    ];
    const proposals = planRequest({
      requestId: 'req-1', view: view(), events: db.tables.events as unknown as DomainEvent[], items,
      availability: NEW, unreadReplies: [], now: NOW,
    }).filter(p => p.action === 'CONTACTED');
    const byItem = Object.fromEntries(proposals.map(p => [p.itemId, p]));
    expect(byItem.i1.key).toBe('CONTACT:i1:r1');
    expect(String(byItem.i1.input.message)).toMatch(/^Chào anh\/chị,\n\nKhách bên em xin đổi lịch xem căn/);
    expect(String(byItem.i1.input.message)).toContain('29/09 buổi chiều, 30/09 buổi sáng');
    // Never asked before: an ordinary first ask, though its round counted.
    expect(byItem.i2.key).toBe('CONTACT:i2:r1');
    expect(String(byItem.i2.input.message)).toContain('Bên em có khách muốn xem căn');
  });

  it('owes the old slot a release if the request ends before the agent is asked again', async () => {
    await edit({ kind: 'CHANGE_TIMES', availability: NEW });
    seed('REQUEST_CANCELLED', { reason: 'OTHER' });
    expect(realtorDecisionsOwed(view())).toEqual([{ itemId: 'i1', decision: 'RELEASE' }]);
  });

  it('stops queued asks about the old times', async () => {
    (db.tables.realtor_messages ??= []).push(
      { id: 'q1', request_id: 'req-1', item_id: 'i2', direction: 'OUT', purpose: 'REQUEST_VIEWING', status: 'QUEUED', claimed_at: null },
    );
    await edit({ kind: 'CHANGE_TIMES', availability: NEW });
    expect(db.tables.realtor_messages[0].status).toBe('FAILED');
  });

  it('refuses the same times, and times intake would refuse', async () => {
    expect(await edit({ kind: 'CHANGE_TIMES', availability: OLD })).toMatchObject({ ok: false, error: 'same_times' });
    expect(await edit({ kind: 'CHANGE_TIMES', availability: [{ date: '2026-09-26', part: 'MORNING' }] }))
      .toMatchObject({ ok: false, error: 'invalid_times' });
    expect(eventsOf('AVAILABILITY_CHANGED')).toHaveLength(0);
  });

  it('refuses once the plan is being put together', async () => {
    seed('OUTCOME_RECORDED', { outcome: 'UNAVAILABLE_DATE' }, 'i2');
    seed('ITINERARY_ASSEMBLED', { ordered_item_ids: ['i1'] });
    expect(await edit({ kind: 'CHANGE_TIMES', availability: NEW })).toMatchObject({ ok: false, error: 'times_fixed' });
    expect(request().availability).toEqual(OLD);
  });
});

describe('cancelling', () => {
  it('is the console\'s own cancel, as the renter, with every holding agent owed a release', async () => {
    const r = await edit({ kind: 'CANCEL', reason: 'RENTER_FOUND_PLACE' });
    expect(r).toMatchObject({ ok: true, recorded: 'REQUEST_CANCELLED', whatsapp: 'SENT' });
    expect(eventsOf('REQUEST_CANCELLED')[0]).toMatchObject({ actor: RENTER_ACTOR, payload: { reason: 'RENTER_FOUND_PLACE' } });
    expect(realtorDecisionsOwed(view())).toEqual([{ itemId: 'i1', decision: 'RELEASE' }]);
    expect(db.tables.messages[0].body).toMatch(/^Done - HV-4KX9 is cancelled/);
  });

  it('refuses a request already cancelled', async () => {
    await edit({ kind: 'CANCEL', reason: 'RENTER_DECLINED' });
    expect(await edit({ kind: 'CANCEL', reason: 'RENTER_DECLINED' })).toMatchObject({ ok: false, error: 'closed' });
  });
});

describe('what the renter sees', () => {
  const rows = [
    { itemId: 'i1', listingId: 'l1', title: 'Căn hộ 2PN Thảo Điền', imageUrl: null, districtCode: null, priceVndAtRequest: 15_000_000 },
    { itemId: 'i2', listingId: 'l2', title: 'Studio Quận 1', imageUrl: null, districtCode: null, priceVndAtRequest: 9_000_000 },
  ];
  const seen = () => renterRequestView({
    view: view(), ref: 'HV-4KX9', createdAt: '2026-09-24T00:00:00Z', availability: OLD, rows, canAdd: true, now: NOW,
  });

  it('says where each place stands, confirmed first, in words', () => {
    const r = seen();
    expect(r.stage).toBe('ASKING');
    expect(r.places.map(p => [p.itemId, p.status, p.label])).toEqual([
      ['i1', 'FREE', 'Free Mon 28 Sept, 10:00'],
      ['i2', 'ASKING', 'Asking the agent'],
    ]);
    expect(r).toMatchObject({ canChangeTimes: true, canCancel: true, canAdd: true });
    expect(r.places.every(p => p.canRemove)).toBe(true);
  });

  it('carries no agent field of any kind', () => {
    const keys = new Set(seen().places.flatMap(p => Object.keys(p)));
    for (const k of keys) expect(k).not.toMatch(/realtor|agent|phone|note|message/i);
  });

  it('shows a removed place last, and offers no removal of the one left', async () => {
    await edit({ kind: 'REMOVE_PLACE', itemId: 'i1' });
    const r = seen();
    expect(r.places.map(p => [p.itemId, p.status, p.canRemove])).toEqual([['i2', 'ASKING', false], ['i1', 'REMOVED', false]]);
  });

  it('describes windows the way the renter picked them', () => {
    expect(describeWindows(NEW)).toBe('Tue 29 Sept afternoon, Wed 30 Sept morning');
  });

  it('asks for other days once we have, and lets the times be changed', async () => {
    seed('OUTCOME_RECORDED', { outcome: 'UNAVAILABLE_DATE' }, 'i1');
    seed('OUTCOME_RECORDED', { outcome: 'UNAVAILABLE_DATE' }, 'i2');
    seed('OTHER_DAYS_ASKED', { message_id: 'm1' });
    const r = seen();
    expect(r).toMatchObject({ stage: 'NEW_TIMES', canChangeTimes: true });
    expect(r.stageLabel).toBe('The agents cannot do these days - change your times and we will ask again');
    expect(r.places.map(p => p.label)).toEqual(['Not free at your times', 'Not free at your times']);

    // The new times answer it: every agent is asked again.
    expect(await edit({ kind: 'CHANGE_TIMES', availability: NEW })).toMatchObject({ ok: true });
    expect(seen().stage).toBe('ASKING');
  });
});
