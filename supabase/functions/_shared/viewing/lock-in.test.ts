// Locking a plan in: the one paid step since the pricing rework (SPEC §9).
//
// The pure rules first - the deadline, who may lock what in, what blocks a
// new request - then the paths on MockAdapter with seeded data: the free
// viewing claimed once per number, a plan cancelled by its deadline with its
// agents released, and a payment started in time that keeps its plan.

import { describe, it, expect, beforeEach } from 'vitest';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';
import {
  checkoutHonoured,
  decideLockIn,
  lockableStops,
  lockInDeadline,
  lockInStatus,
  renderLockInLine,
} from './lock-in.ts';
import { blocksNewRequest, pickBlocking, type JoinCandidate } from './intake.ts';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { ManualChannel } from '../realtor/channel.ts';
import { SupabaseRealtorMessageStore } from '../realtor/store.ts';
import { deliver } from './deliver.ts';
import { loadLockIn, lockIn, lockInAfterPurchase } from './lock-in-run.ts';
import { runLockInDeadline } from './lock-in-deadline.ts';
import { dueActions, realtorDecisionsOwed } from './reminders.ts';
import type { OpsDeps } from './ops-actions.ts';

const HOUR = 60 * 60 * 1000;
let seq = 0;

function ev(type: string, at: string, opts: { item?: string; payload?: Record<string, unknown> } = {}): DomainEvent {
  seq += 1;
  return {
    id: seq, request_id: 'req-1', item_id: opts.item ?? null, type,
    payload: opts.payload ?? {}, actor: 'SYSTEM', occurred_at: at,
  };
}

/** Two confirmed stops on Sat 19 Sep (09:00 and 14:00 in Ho Chi Minh City), one rented. */
function planLog(deliveredAt = '2026-09-16T03:00:00.000Z'): DomainEvent[] {
  return [
    ev('REQUEST_SUBMITTED', '2026-09-15T00:00:00.000Z'),
    ev('ITEM_ADDED', '2026-09-15T00:00:01.000Z', { item: 'i1' }),
    ev('ITEM_ADDED', '2026-09-15T00:00:02.000Z', { item: 'i2' }),
    ev('ITEM_ADDED', '2026-09-15T00:00:03.000Z', { item: 'i3' }),
    ev('OUTCOME_RECORDED', '2026-09-15T05:00:00.000Z', { item: 'i1', payload: { outcome: 'CONFIRMED', slots: [{ starts_at: '2026-09-19T02:00:00Z', duration_minutes: 30 }] } }),
    ev('OUTCOME_RECORDED', '2026-09-15T05:01:00.000Z', { item: 'i2', payload: { outcome: 'CONFIRMED', slots: [{ starts_at: '2026-09-19T07:00:00Z', duration_minutes: 30 }] } }),
    ev('OUTCOME_RECORDED', '2026-09-15T05:02:00.000Z', { item: 'i3', payload: { outcome: 'ALREADY_RENTED', slots: [] } }),
    ev('ITINERARY_ASSEMBLED', deliveredAt, { payload: { ordered_item_ids: ['i1', 'i2'] } }),
    ev('ITINERARY_DELIVERED', deliveredAt, { payload: { message_id: 'm1' } }),
  ];
}

const reduce = (events: DomainEvent[]) => reduceRequest('req-1', events);

describe('the reducer, for lock-in events', () => {
  const log = [
    ...planLog(),
    ev('LOCK_IN_CHECKOUT_OPENED', '2026-09-16T04:00:00.000Z', { payload: { checkout_id: 'chk-1', expires_at: '2026-09-16T05:00:00.000Z' } }),
    // Logged twice - a retry - and still one checkout.
    ev('LOCK_IN_CHECKOUT_OPENED', '2026-09-16T04:00:01.000Z', { payload: { checkout_id: 'chk-1', expires_at: '2026-09-16T05:00:00.000Z' } }),
    ev('REQUEST_CONFIRMED', '2026-09-16T04:10:00.000Z', { payload: { confirmed_item_ids: ['i1', 'i2'], cover: 'PASS', checkout_id: 'chk-1' } }),
  ];

  it('records the checkout once and the cover, and moves to CONFIRMED only on the lock-in', () => {
    const v = reduce(log);
    expect(v.state).toBe('CONFIRMED');
    expect(v.confirmedCover).toBe('PASS');
    expect(v.checkouts).toEqual([{ checkoutId: 'chk-1', openedAt: '2026-09-16T04:00:00.000Z', expiresAt: '2026-09-16T05:00:00.000Z' }]);
    // The checkout alone moves nothing: opening one is not paying.
    expect(reduce(log.slice(0, -1)).state).toBe('DELIVERED');
  });

  it('reduces the same forwards, backwards and shuffled', () => {
    const expected = reduce(log);
    const orders = [log, [...log].reverse()];
    for (let s = 1; s < 10; s++) {
      const c = [...log];
      for (let i = c.length - 1; i > 0; i--) {
        const j = (i * 7 + s * 13) % (i + 1);
        [c[i], c[j]] = [c[j], c[i]];
      }
      orders.push(c);
    }
    for (const o of orders) {
      const v = reduce(o);
      expect(v.state).toBe(expected.state);
      expect(v.confirmedCover).toBe(expected.confirmedCover);
      expect(v.checkouts).toEqual(expected.checkouts);
      expect(v.planArrivedAt).toBe(expected.planArrivedAt);
    }
  });

  it('keeps a cancelled plan cancelled whatever order the lock-in arrives in', () => {
    const both = [
      ...planLog(),
      ev('REQUEST_CANCELLED', '2026-09-17T03:00:00.000Z', { payload: { reason: 'NOT_LOCKED_IN' } }),
      ev('REQUEST_CONFIRMED', '2026-09-17T03:00:05.000Z', { payload: { confirmed_item_ids: ['i1'], cover: 'FREE_VIEWING' } }),
    ];
    expect(reduce(both).state).toBe('CANCELLED');
    expect(reduce([...both].reverse()).state).toBe('CANCELLED');
  });

  it('takes the plan as arrived when it was first held, and delivered when it last went out', () => {
    const held = [
      ...planLog().slice(0, 7),
      ev('ITINERARY_HELD', '2026-09-16T01:00:00.000Z', { payload: { message_id: 't1', ordered_item_ids: ['i1', 'i2'], template: 'itinerary_ready' } }),
      ev('ITINERARY_DELIVERED', '2026-09-16T09:00:00.000Z', { payload: { message_id: 'm1' } }),
    ];
    for (const o of [held, [...held].reverse()]) {
      const v = reduce(o);
      expect(v.planArrivedAt).toBe('2026-09-16T01:00:00.000Z');
      expect(v.lastDeliveredAt).toBe('2026-09-16T09:00:00.000Z');
    }
  });

  it('reads a confirmation from before the rework as covering nothing in particular', () => {
    const v = reduce([...planLog(), ev('REQUEST_CONFIRMED', '2026-09-16T05:00:00.000Z', { payload: { confirmed_item_ids: ['i1'] } })]);
    expect(v.state).toBe('CONFIRMED');
    expect(v.confirmedCover).toBeUndefined();
  });
});

describe('lockInDeadline', () => {
  it('is 24 hours after the plan arrived, when that comes first', () => {
    // Delivered Wed 16 Sep 10:00 local; first stop Sat 19 Sep.
    expect(lockInDeadline(reduce(planLog('2026-09-16T03:00:00.000Z')))).toBe('2026-09-17T03:00:00.000Z');
  });

  it('is 18:00 the day before the first stop, when that comes first', () => {
    // Delivered Fri 18 Sep 08:00 local: 18:00 Friday (11:00Z) is earlier than 24 hours on.
    expect(lockInDeadline(reduce(planLog('2026-09-18T01:00:00.000Z')))).toBe('2026-09-18T11:00:00.000Z');
  });

  it('is never less than three hours with the plan in hand', () => {
    // Delivered Fri 18 Sep 17:00 local - after the cutoff - so until 20:00.
    expect(lockInDeadline(reduce(planLog('2026-09-18T10:00:00.000Z')))).toBe('2026-09-18T13:00:00.000Z');
  });

  it('runs the three hours from the plan itself when it was held behind a template first', () => {
    const v = reduce([
      ...planLog().slice(0, 7),
      ev('ITINERARY_HELD', '2026-09-17T02:00:00.000Z', { payload: { message_id: 't1', ordered_item_ids: ['i1', 'i2'], template: 'itinerary_ready' } }),
      // The renter replied the next afternoon, which released it.
      ev('ITINERARY_DELIVERED', '2026-09-18T09:00:00.000Z', { payload: { message_id: 'm1' } }),
    ]);
    expect(lockInDeadline(v)).toBe('2026-09-18T12:00:00.000Z');
  });

  it('rounds up to the quarter hour, so the renter only gains', () => {
    expect(lockInDeadline(reduce(planLog('2026-09-16T03:07:00.000Z')))).toBe('2026-09-17T03:15:00.000Z');
  });

  it('has none without a plan, or with nothing to lock in', () => {
    expect(lockInDeadline(reduce(planLog().slice(0, 7)))).toBeNull();
    const nothing = planLog().map(e => e.type === 'OUTCOME_RECORDED'
      ? { ...e, payload: { outcome: 'ALREADY_RENTED', slots: [] } } : e);
    expect(lockInDeadline(reduce(nothing))).toBeNull();
  });
});

describe('lockInStatus', () => {
  const deadline = Date.parse('2026-09-17T03:00:00.000Z');

  it('is open until the deadline and lapsed after it', () => {
    const v = reduce(planLog());
    expect(lockInStatus(v, deadline - 1)).toBe('OPEN');
    expect(lockInStatus(v, deadline)).toBe('LAPSED');
  });

  it('waits for a checkout opened in time, and only that one', () => {
    const inTime = reduce([...planLog(), ev('LOCK_IN_CHECKOUT_OPENED', '2026-09-17T02:30:00.000Z',
      { payload: { checkout_id: 'chk-1', expires_at: '2026-09-17T03:30:00.000Z' } })]);
    expect(lockInStatus(inTime, deadline + 10 * 60 * 1000)).toBe('PAYING');
    expect(lockInStatus(inTime, Date.parse('2026-09-17T03:30:00.000Z'))).toBe('LAPSED');
    expect(checkoutHonoured(inTime, 'chk-1')).toBe(true);

    const late = reduce([...planLog(), ev('LOCK_IN_CHECKOUT_OPENED', '2026-09-17T03:05:00.000Z',
      { payload: { checkout_id: 'chk-2', expires_at: '2026-09-17T04:05:00.000Z' } })]);
    expect(lockInStatus(late, deadline + 10 * 60 * 1000)).toBe('LAPSED');
    expect(checkoutHonoured(late, 'chk-2')).toBe(false);
  });

  it('names the other states', () => {
    expect(lockInStatus(reduce(planLog().slice(0, 7)), deadline)).toBe('NOT_READY');
    expect(lockInStatus(reduce([...planLog(), ev('REQUEST_CONFIRMED', '2026-09-16T05:00:00.000Z',
      { payload: { confirmed_item_ids: ['i1'], cover: 'FREE_VIEWING' } })]), deadline)).toBe('LOCKED_IN');
    expect(lockInStatus(reduce([...planLog(), ev('REQUEST_CANCELLED', '2026-09-16T05:00:00.000Z',
      { payload: { reason: 'RENTER_DECLINED' } })]), deadline)).toBe('CLOSED');
  });

  it('lists the stops a lock-in can keep, earliest first', () => {
    expect(lockableStops(reduce(planLog())).map(s => s.itemId)).toEqual(['i1', 'i2']);
  });
});

describe('decideLockIn', () => {
  const stops = ['i1', 'i2'];

  it('covers every stop for a Pass holder, whatever they asked for', () => {
    expect(decideLockIn({ stopItemIds: stops, hasPass: true, freeViewingAvailable: true, choice: { cover: 'FREE_VIEWING', itemId: 'i1' } }))
      .toEqual({ ok: true, cover: 'PASS', confirmedItemIds: ['i1', 'i2'] });
  });

  it('covers the one stop picked with the free viewing', () => {
    expect(decideLockIn({ stopItemIds: stops, hasPass: false, freeViewingAvailable: true, choice: { cover: 'FREE_VIEWING', itemId: 'i2' } }))
      .toEqual({ ok: true, cover: 'FREE_VIEWING', confirmedItemIds: ['i2'] });
    // A one-stop plan needs no pick.
    expect(decideLockIn({ stopItemIds: ['i1'], hasPass: false, freeViewingAvailable: true, choice: { cover: 'FREE_VIEWING' } }))
      .toEqual({ ok: true, cover: 'FREE_VIEWING', confirmedItemIds: ['i1'] });
  });

  it('refuses what cannot be covered', () => {
    const no = (input: Parameters<typeof decideLockIn>[0]) => decideLockIn(input);
    expect(no({ stopItemIds: [], hasPass: true, freeViewingAvailable: true, choice: { cover: 'PASS' } })).toEqual({ ok: false, reason: 'NOTHING_TO_LOCK' });
    expect(no({ stopItemIds: stops, hasPass: false, freeViewingAvailable: true, choice: { cover: 'PASS' } })).toEqual({ ok: false, reason: 'NEEDS_PASS' });
    expect(no({ stopItemIds: stops, hasPass: false, freeViewingAvailable: false, choice: { cover: 'FREE_VIEWING', itemId: 'i1' } })).toEqual({ ok: false, reason: 'FREE_VIEWING_USED' });
    expect(no({ stopItemIds: stops, hasPass: false, freeViewingAvailable: true, choice: { cover: 'FREE_VIEWING' } })).toEqual({ ok: false, reason: 'PICK_A_PLACE' });
    expect(no({ stopItemIds: stops, hasPass: false, freeViewingAvailable: true, choice: { cover: 'FREE_VIEWING', itemId: 'i9' } })).toEqual({ ok: false, reason: 'NOT_IN_PLAN' });
  });

  it('says where, by when and for how much, with no booking vocabulary', () => {
    const free = renderLockInLine({ siteUrl: 'https://hausto.com', ref: 'HV-4KX2', deadline: '2026-09-17T03:00:00.000Z', freeViewingAvailable: true });
    expect(free).toContain('https://hausto.com/lock-in/HV-4KX2');
    expect(free).toContain('Thu 17 Sept, 10:00');
    expect(free).toContain('first viewing is on us');
    const paid = renderLockInLine({ siteUrl: 'https://hausto.com', ref: 'HV-4KX2', deadline: '2026-09-17T03:00:00.000Z', freeViewingAvailable: false });
    expect(paid).toContain('$25 for 30 days');
    expect(paid).not.toContain('on us');
    for (const t of [free, paid]) expect(t).not.toMatch(/\bbook(ed|ing)?\b/i);
  });
});

describe('one request at a time', () => {
  const candidate = (over: Partial<JoinCandidate>): JoinCandidate => ({
    requestId: 'r', ref: 'HV-AAAA', createdAt: '2026-09-15T00:00:00Z',
    availability: [{ date: '2026-09-20', part: 'MORNING' }], listingIds: ['l1'],
    state: 'CONTACTING', delivered: false, ...over,
  });
  const today = '2026-09-16';

  it('blocks while agents are being asked and a window is ahead', () => {
    expect(blocksNewRequest(candidate({}), today)).toBe(true);
    expect(blocksNewRequest(candidate({ availability: [{ date: '2026-09-15', part: 'MORNING' }] }), today)).toBe(false);
  });

  it('blocks while a plan can be locked in or is being paid for, and not after', () => {
    expect(blocksNewRequest(candidate({ state: 'DELIVERED', delivered: true, lockIn: 'OPEN' }), today)).toBe(true);
    expect(blocksNewRequest(candidate({ state: 'DELIVERED', delivered: true, lockIn: 'PAYING' }), today)).toBe(true);
    expect(blocksNewRequest(candidate({ state: 'DELIVERED', delivered: true, lockIn: 'LAPSED' }), today)).toBe(false);
    // Nothing confirmed: nothing to lock in, so nothing to wait for.
    expect(blocksNewRequest(candidate({ state: 'DELIVERED', delivered: true, lockIn: 'NOT_READY' }), today)).toBe(false);
    expect(blocksNewRequest(candidate({ state: 'CONFIRMED', delivered: true, lockIn: 'LOCKED_IN' }), today)).toBe(false);
  });

  it('names the newest blocking request', () => {
    const older = candidate({ ref: 'HV-OLD1', createdAt: '2026-09-10T00:00:00Z' });
    const newer = candidate({ ref: 'HV-NEW1', createdAt: '2026-09-14T00:00:00Z' });
    expect(pickBlocking([older, newer], today)?.ref).toBe('HV-NEW1');
    expect(pickBlocking([candidate({ state: 'CANCELLED' })], today)).toBeNull();
  });
});

// ── On MockAdapter, with seeded data ────────────────────────────────────────

const PHONE = '+84901234567';
let db: FakeDb;
let adapter: MockAdapter;
let deps: OpsDeps;

/** A delivered two-stop plan, as the renter's WhatsApp thread has it. */
async function seedDelivered(requestId = 'req-1', ref = 'HV-4KX2', userId = 'user-1') {
  if (!db.tables.renters.some(r => r.id === 'renter-1')) {
    db.tables.renters.push({
      id: 'renter-1', phone_e164: PHONE, user_id: userId, opted_out_at: null,
      service_window_expires_at: new Date(Date.now() + 6 * HOUR).toISOString(),
    });
  }
  db.tables.viewing_requests.push({ id: requestId, ref, renter_id: 'renter-1', created_at: new Date().toISOString() });
  const titles = ['Sunny 2BR in Thao Dien', 'Studio near Ben Thanh'];
  titles.forEach((title, i) => {
    db.tables.external_properties.push({ id: `${requestId}-l${i}`, title, district_code: 'HCM-D2', price_vnd: 15_000_000, is_active: true });
    db.tables.request_items.push({ id: `${requestId}-i${i}`, request_id: requestId, listing_id: `${requestId}-l${i}`, price_vnd_at_request: 15_000_000, realtor_id: null });
  });
  // Viewings three days out, so the deadline is 24 hours after delivery.
  const day = new Date(Date.now() + 3 * 24 * HOUR);
  const push = (type: string, payload: Record<string, unknown> = {}, item: string | null = null) =>
    db.tables.events.push({ request_id: requestId, item_id: item, type, payload, actor: 'SYSTEM', occurred_at: new Date().toISOString() });
  push('REQUEST_SUBMITTED');
  titles.forEach((_, i) => {
    push('ITEM_ADDED', {}, `${requestId}-i${i}`);
    push('REALTOR_CONTACTED', { channel: 'ZALO' }, `${requestId}-i${i}`);
    push('OUTCOME_RECORDED', {
      outcome: 'CONFIRMED',
      slots: [{ starts_at: new Date(day.getTime() + i * 2 * HOUR).toISOString(), duration_minutes: 30 }],
    }, `${requestId}-i${i}`);
  });
  // deno-lint-ignore no-explicit-any
  const sent = await deliver(db as any, adapter, { requestId, purpose: 'ITINERARY' });
  if (!sent.ok) throw new Error(`delivery failed: ${sent.code}`);
}

const viewOf = (requestId = 'req-1') =>
  reduceRequest(requestId, db.tables.events.filter(e => e.request_id === requestId) as unknown as DomainEvent[]);

beforeEach(() => {
  db = new FakeDb();
  adapter = new MockAdapter();
  deps = {
    whatsapp: adapter,
    // deno-lint-ignore no-explicit-any
    messages: new SupabaseMessageStore(db as any),
    realtorChannel: new ManualChannel(),
    // deno-lint-ignore no-explicit-any
    realtorMessages: new SupabaseRealtorMessageStore(db as any),
  };
});

describe('the free viewing, on MockAdapter', () => {
  it('is offered in the plan, covers one place, and goes once per WhatsApp number', async () => {
    await seedDelivered();
    const plan = String(db.tables.messages.find(m => m.direction === 'OUT')!.body);
    expect(plan).toContain('https://hausto.com/lock-in/HV-4KX2');
    expect(plan).toContain('Your first viewing is on us');

    // deno-lint-ignore no-explicit-any
    const ctx = (await loadLockIn(db as any, { ref: 'HV-4KX2' }, Date.now()))!;
    // deno-lint-ignore no-explicit-any
    const kept = await lockIn(db as any, ctx, {
      userId: 'user-1', choice: { cover: 'FREE_VIEWING', itemId: 'req-1-i0' }, actor: 'RENTER', now: Date.now(),
    });
    expect(kept).toMatchObject({ ok: true, cover: 'FREE_VIEWING', confirmedItemIds: ['req-1-i0'] });
    expect(viewOf().state).toBe('CONFIRMED');
    expect(realtorDecisionsOwed(viewOf())).toEqual(expect.arrayContaining([
      { itemId: 'req-1-i0', decision: 'CONFIRM' },
      { itemId: 'req-1-i1', decision: 'RELEASE' },
    ]));

    // The next plan on the same number offers only the Pass, and the free
    // viewing cannot be spent again.
    await seedDelivered('req-2', 'HV-7WRT', 'user-1');
    const second = String(db.tables.messages.filter(m => m.direction === 'OUT').pop()!.body);
    expect(second).toContain('Lock these in with the Pass ($25 for 30 days)');
    // deno-lint-ignore no-explicit-any
    const ctx2 = (await loadLockIn(db as any, { ref: 'HV-7WRT' }, Date.now()))!;
    // deno-lint-ignore no-explicit-any
    expect(await lockIn(db as any, ctx2, {
      userId: 'user-1', choice: { cover: 'FREE_VIEWING', itemId: 'req-2-i0' }, actor: 'RENTER', now: Date.now(),
    })).toEqual({ ok: false, reason: 'FREE_VIEWING_USED' });
    expect(viewOf('req-2').state).toBe('DELIVERED');
  });

  it('is not anyone else to lock in', async () => {
    await seedDelivered();
    // deno-lint-ignore no-explicit-any
    const ctx = (await loadLockIn(db as any, { ref: 'HV-4KX2' }, Date.now()))!;
    // deno-lint-ignore no-explicit-any
    expect(await lockIn(db as any, ctx, {
      userId: 'someone-else', choice: { cover: 'FREE_VIEWING', itemId: 'req-1-i0' }, actor: 'RENTER', now: Date.now(),
    })).toEqual({ ok: false, reason: 'NOT_YOURS' });
  });
});

describe('the deadline, on MockAdapter', () => {
  it('cancels a plan nobody locked in, by rule, and releases its agents', async () => {
    await seedDelivered();
    const deadline = Date.parse(lockInDeadline(viewOf())!);
    const due = (now: number) => dueActions({
      view: viewOf(), events: db.tables.events as unknown as DomainEvent[],
      createdAt: String(db.tables.viewing_requests[0].created_at), now,
    }).filter(a => a.kind === 'LOCK_IN_DEADLINE');

    expect(due(deadline - 1)).toHaveLength(0);
    expect(due(deadline)).toHaveLength(1);

    // deno-lint-ignore no-explicit-any
    expect(await runLockInDeadline(db as any, deps, 'req-1', deadline)).toBe('CANCELLED');
    const cancel = db.tables.events.find(e => e.type === 'REQUEST_CANCELLED')!;
    expect(cancel).toMatchObject({ payload: { reason: 'NOT_LOCKED_IN' }, actor: 'SYSTEM' });
    expect(viewOf().state).toBe('CANCELLED');
    // Both agents held a slot; both are owed a release, which the drain turns
    // into RELEASE_REALTOR jobs.
    expect(realtorDecisionsOwed(viewOf())).toEqual([
      { itemId: 'req-1-i0', decision: 'RELEASE' },
      { itemId: 'req-1-i1', decision: 'RELEASE' },
    ]);
    // Nothing more is due, and running it again cancels nothing twice.
    expect(due(deadline + HOUR)).toHaveLength(0);
    // deno-lint-ignore no-explicit-any
    expect(await runLockInDeadline(db as any, deps, 'req-1', deadline + HOUR)).toBe('CLOSED');
    expect(db.tables.events.filter(e => e.type === 'REQUEST_CANCELLED')).toHaveLength(1);
  });

  it('waits for a payment started in time, and lets it lock the plan in after the deadline', async () => {
    await seedDelivered();
    const deadline = Date.parse(lockInDeadline(viewOf())!);
    db.tables.events.push({
      request_id: 'req-1', item_id: null, type: 'LOCK_IN_CHECKOUT_OPENED', actor: 'RENTER',
      payload: { checkout_id: 'chk-1', expires_at: new Date(deadline + HOUR).toISOString() },
      occurred_at: new Date(deadline - 10 * 60 * 1000).toISOString(),
    });

    // deno-lint-ignore no-explicit-any
    expect(await runLockInDeadline(db as any, deps, 'req-1', deadline + 5 * 60 * 1000)).toBe('PAYING');
    expect(viewOf().state).toBe('DELIVERED');

    // Polar settles at 20 past; the purchase is recorded and locks the plan in.
    db.passHolders.add('user-1');
    // deno-lint-ignore no-explicit-any
    const locked = await lockInAfterPurchase(db as any, {
      requestId: 'req-1', checkoutId: 'chk-1', userId: 'user-1', now: deadline + 20 * 60 * 1000,
    });
    expect(locked).toMatchObject({ ok: true, cover: 'PASS', confirmedItemIds: ['req-1-i0', 'req-1-i1'] });
    expect(viewOf().state).toBe('CONFIRMED');
    // The other purchase path arrives second and finds it done.
    // deno-lint-ignore no-explicit-any
    expect(await lockInAfterPurchase(db as any, { requestId: 'req-1', checkoutId: 'chk-1', userId: 'user-1' }))
      .toMatchObject({ ok: true, already: true });
    expect(db.tables.events.filter(e => e.type === 'REQUEST_CONFIRMED')).toHaveLength(1);
  });

  it('keeps nothing for a payment that lands after the plan was cancelled', async () => {
    await seedDelivered();
    const deadline = Date.parse(lockInDeadline(viewOf())!);
    // deno-lint-ignore no-explicit-any
    await runLockInDeadline(db as any, deps, 'req-1', deadline);
    db.passHolders.add('user-1');
    // deno-lint-ignore no-explicit-any
    const late = await lockInAfterPurchase(db as any, { requestId: 'req-1', checkoutId: 'chk-x', userId: 'user-1' });
    expect(late).toMatchObject({ ok: false, reason: 'NOT_OPEN' });
    expect(viewOf().state).toBe('CANCELLED');
  });
});
