import { describe, it, expect } from 'vitest';
import {
  reduceRequest,
  summarise,
  EVENT_TYPES,
  OUTCOMES,
  type DomainEvent,
  type Outcome,
} from './viewing-domain.ts';

const REQ = 'req-1';
let seq = 0;

function ev(
  type: string,
  opts: { item?: string; payload?: Record<string, unknown>; at?: string } = {},
): DomainEvent {
  seq += 1;
  return {
    id: seq,
    request_id: REQ,
    item_id: opts.item ?? null,
    type,
    payload: opts.payload ?? {},
    actor: 'SYSTEM',
    occurred_at: opts.at ?? `2026-09-11T00:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

/** Every permutation for small logs; a deterministic sample for larger ones. */
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  if (xs.length > 6) {
    const out: T[][] = [xs, [...xs].reverse()];
    for (let s = 1; s < 12; s++) {
      const c = [...xs];
      // Deterministic shuffle so a failure is reproducible.
      for (let i = c.length - 1; i > 0; i--) {
        const j = (i * 7 + s * 13) % (i + 1);
        [c[i], c[j]] = [c[j], c[i]];
      }
      out.push(c);
    }
    return out;
  }
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest]),
  );
}

describe('reduceRequest: every event type is handled', () => {
  // The DoD requires coverage of every event type. This asserts the list itself
  // is covered, so adding a type to EVENT_TYPES without a test fails here
  // rather than silently going unreduced.
  const covered = new Set<string>();

  it('reduces each event type without throwing', () => {
    for (const type of EVENT_TYPES) {
      const events = [
        ev('REQUEST_SUBMITTED'),
        ev('ITEM_ADDED', { item: 'i1' }),
        ev(type, { item: 'i1', payload: { outcome: 'CONFIRMED', realtor_id: 'r1', message_id: 'm1', reason: 'x' } }),
      ];
      expect(() => reduceRequest(REQ, events)).not.toThrow();
      covered.add(type);
    }
    expect(covered.size).toBe(EVENT_TYPES.length);
  });

  it('maps every outcome to an item state', () => {
    for (const outcome of OUTCOMES) {
      const view = reduceRequest(REQ, [
        ev('REQUEST_SUBMITTED'),
        ev('ITEM_ADDED', { item: 'i1' }),
        ev('OUTCOME_RECORDED', { item: 'i1', payload: { outcome } }),
      ]);
      expect(view.items.i1.outcome).toBe(outcome);
      expect(view.items.i1.state).not.toBe('PENDING');
    }
  });

  it('ignores an unknown type instead of throwing', () => {
    const view = reduceRequest(REQ, [
      ev('REQUEST_SUBMITTED'),
      ev('SOMETHING_A_NEWER_WRITER_ADDED', { payload: { x: 1 } }),
    ]);
    expect(view.state).toBe('SUBMITTED');
  });
});

describe('out-of-order arrival', () => {
  // The event OCCURS after the outcome - clock skew, or a contact recorded
  // late. Sorting cannot save this one: the reducer sees CONTACTED last and
  // must refuse it, or a finished item walks back to CONTACTED.
  it('refuses a REALTOR_CONTACTED that occurred after its outcome', () => {
    const outcome = ev('OUTCOME_RECORDED', { item: 'i1', payload: { outcome: 'ALREADY_RENTED' }, at: '2026-09-11T00:00:02.000Z' });
    const contacted = ev('REALTOR_CONTACTED', { item: 'i1', at: '2026-09-11T00:00:09.000Z' });

    // Both delivery orders, since neither should matter.
    expect(reduceRequest(REQ, [outcome, contacted]).items.i1.state).toBe('ALREADY_RENTED');
    expect(reduceRequest(REQ, [contacted, outcome]).items.i1.state).toBe('ALREADY_RENTED');
  });

  it('still applies a REALTOR_CONTACTED that legitimately precedes the outcome', () => {
    const contacted = ev('REALTOR_CONTACTED', { item: 'i1', at: '2026-09-11T00:00:01.000Z' });
    const outcome = ev('OUTCOME_RECORDED', { item: 'i1', payload: { outcome: 'ALREADY_RENTED' }, at: '2026-09-11T00:00:02.000Z' });
    const view = reduceRequest(REQ, [outcome, contacted]);
    expect(view.items.i1.state).toBe('ALREADY_RENTED');
  });

  it('reaches the same terminal state forwards, backwards and shuffled', () => {
    seq = 0;
    const log = [
      ev('REQUEST_SUBMITTED'),
      ev('ITEM_ADDED', { item: 'i1' }),
      ev('ITEM_ADDED', { item: 'i2' }),
      ev('REALTOR_RESOLVED', { item: 'i1', payload: { realtor_id: 'r1', method: 'PHONE' } }),
      ev('REALTOR_CONTACTED', { item: 'i1' }),
      ev('REALTOR_CONTACTED', { item: 'i2' }),
      ev('ITEM_NUDGED', { item: 'i2', payload: { attempt: 1 } }),
      ev('OUTCOME_RECORDED', { item: 'i1', payload: { outcome: 'CONFIRMED', slots: ['s1'] } }),
      ev('OUTCOME_RECORDED', { item: 'i2', payload: { outcome: 'NO_RESPONSE' } }),
      ev('ITINERARY_ASSEMBLED', { payload: { ordered_item_ids: ['i1'] } }),
      ev('ITINERARY_DELIVERED', { payload: { message_id: 'm1' } }),
      ev('REQUEST_CONFIRMED', { payload: { confirmed_item_ids: ['i1'] } }),
    ];

    const expected = JSON.stringify(reduceRequest(REQ, log));
    for (const order of permutations(log)) {
      expect(JSON.stringify(reduceRequest(REQ, order))).toBe(expected);
    }
  });

  it('breaks identical timestamps by id, deterministically', () => {
    const same = '2026-09-11T00:00:00.000Z';
    const a: DomainEvent = { id: 1, request_id: REQ, item_id: 'i1', type: 'REALTOR_CONTACTED', payload: {}, actor: 'SYSTEM', occurred_at: same };
    const b: DomainEvent = { id: 2, request_id: REQ, item_id: 'i1', type: 'OUTCOME_RECORDED', payload: { outcome: 'CONFIRMED' }, actor: 'SYSTEM', occurred_at: same };

    expect(reduceRequest(REQ, [a, b]).items.i1.state).toBe('CONFIRMED');
    expect(reduceRequest(REQ, [b, a]).items.i1.state).toBe('CONFIRMED');
  });
});

describe('request state', () => {
  it('cancellation wins over anything else in the log', () => {
    seq = 0;
    const view = reduceRequest(REQ, [
      ev('REQUEST_SUBMITTED'),
      ev('ITEM_ADDED', { item: 'i1' }),
      ev('REQUEST_CANCELLED', { payload: { reason: 'renter withdrew' } }),
      ev('OUTCOME_RECORDED', { item: 'i1', payload: { outcome: 'CONFIRMED' } }),
      ev('ITINERARY_DELIVERED', { payload: { message_id: 'm1' } }),
    ]);
    expect(view.state).toBe('CANCELLED');
    expect(view.cancelledReason).toBe('renter withdrew');
  });

  it('a confirmed request is not walked back by a late delivery event', () => {
    seq = 0;
    const view = reduceRequest(REQ, [
      ev('REQUEST_SUBMITTED'),
      ev('REQUEST_CONFIRMED', { payload: { confirmed_item_ids: ['i1'] } }),
      ev('ITINERARY_DELIVERED', { payload: { message_id: 'm2' } }),
    ]);
    expect(view.state).toBe('CONFIRMED');
  });
});

describe('partial success is the happy path', () => {
  it('reports three of five as partial, not as failure', () => {
    seq = 0;
    const events = [ev('REQUEST_SUBMITTED')];
    for (const id of ['i1', 'i2', 'i3', 'i4', 'i5']) events.push(ev('ITEM_ADDED', { item: id }));
    const outcomes: Outcome[] = ['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'ALREADY_RENTED', 'NO_RESPONSE'];
    outcomes.forEach((o, i) => events.push(ev('OUTCOME_RECORDED', { item: `i${i + 1}`, payload: { outcome: o } })));

    const s = summarise(reduceRequest(REQ, events));
    expect(s).toMatchObject({ total: 5, confirmed: 3, unresolved: 0, isPartial: true, hasNothing: false });
  });

  it('flags zero confirmed as having nothing', () => {
    seq = 0;
    const view = reduceRequest(REQ, [
      ev('REQUEST_SUBMITTED'),
      ev('ITEM_ADDED', { item: 'i1' }),
      ev('OUTCOME_RECORDED', { item: 'i1', payload: { outcome: 'ALREADY_RENTED' } }),
    ]);
    expect(summarise(view).hasNothing).toBe(true);
  });
});
