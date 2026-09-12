import { describe, it, expect } from 'vitest';
import {
  dueActions,
  lastHeardFromUs,
  renderHoldingUpdate,
  HOUR_MS,
  MAX_SILENCE_MS,
  SILENCE_ACTION_MS,
  NUDGE_AFTER_MS,
} from './reminders.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';

const T0 = Date.parse('2026-09-11T00:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();

let seq = 0;
const ev = (type: string, offsetMs: number, payload: Record<string, unknown> = {}, itemId?: string): DomainEvent => ({
  id: ++seq, request_id: 'r', item_id: itemId ?? null, type, payload, actor: 'SYSTEM', occurred_at: at(offsetMs),
});

function logOf(...events: DomainEvent[]) {
  seq = 0;
  return events;
}

const submitted = (items: number) => {
  const out = [ev('REQUEST_SUBMITTED', 0)];
  for (let i = 1; i <= items; i++) out.push(ev('ITEM_ADDED', 0, { listing_id: `l${i}` }, `i${i}`));
  return out;
};

describe('the silence clock', () => {
  it('starts at intake, because the confirmation page already made a promise', () => {
    const events = logOf(...submitted(3));
    expect(lastHeardFromUs(events, at(0))).toBe(T0);
  });

  it('moves forward on anything we send the renter', () => {
    const events = logOf(...submitted(3), ev('ITINERARY_DELIVERED', 5 * HOUR_MS, { message_id: 'm1' }));
    expect(lastHeardFromUs(events, at(0))).toBe(T0 + 5 * HOUR_MS);
  });

  it('acts before the deadline rather than on it', () => {
    // A job firing exactly at hour 24 has already lost: the send has to
    // happen, be delivered and be read, and the first can fail and need a retry.
    expect(SILENCE_ACTION_MS).toBeLessThan(MAX_SILENCE_MS);
  });
});

describe('what is due', () => {
  const base = (events: DomainEvent[], nowMs: number) => dueActions({
    view: reduceRequest('r', events), events, createdAt: at(0), now: T0 + nowMs,
  });

  it('says nothing while the request is fresh', () => {
    expect(base(logOf(...submitted(3)), 2 * HOUR_MS)).toHaveLength(0);
  });

  it('owes the renter an update once the clock runs down', () => {
    const actions = base(logOf(...submitted(3)), SILENCE_ACTION_MS);
    expect(actions.map(a => a.kind)).toContain('HOLDING_UPDATE');
  });

  it('stops owing one the moment the itinerary goes out', () => {
    const events = logOf(...submitted(3), ev('ITINERARY_DELIVERED', 21 * HOUR_MS, { message_id: 'm1' }));
    expect(base(events, 22 * HOUR_MS).map(a => a.kind)).not.toContain('HOLDING_UPDATE');
  });

  it('chases a broker who has gone quiet, and not one just contacted', () => {
    const events = logOf(...submitted(2), ev('REALTOR_CONTACTED', 0, { channel: 'ZALO' }, 'i1'));
    expect(base(events, 1 * HOUR_MS).filter(a => a.kind === 'NUDGE_REALTOR')).toHaveLength(0);
    const due = base(events, NUDGE_AFTER_MS).filter(a => a.kind === 'NUDGE_REALTOR');
    expect(due).toHaveLength(1);
    expect(due[0].itemId).toBe('i1');
  });

  it('measures the chase from the last nudge, not from first contact', () => {
    const events = logOf(
      ...submitted(1),
      ev('REALTOR_CONTACTED', 0, { channel: 'ZALO' }, 'i1'),
      ev('ITEM_NUDGED', 6 * HOUR_MS, { attempt: 1 }, 'i1'),
    );
    // Seven hours after contact but one hour after the nudge: not due again.
    expect(base(events, 7 * HOUR_MS).filter(a => a.kind === 'NUDGE_REALTOR')).toHaveLength(0);
    expect(base(events, 12 * HOUR_MS).filter(a => a.kind === 'NUDGE_REALTOR')).toHaveLength(1);
  });

  it('never chases a broker who already answered', () => {
    const events = logOf(
      ...submitted(1),
      ev('REALTOR_CONTACTED', 0, { channel: 'ZALO' }, 'i1'),
      ev('OUTCOME_RECORDED', 1 * HOUR_MS, { outcome: 'ALREADY_RENTED', slots: [] }, 'i1'),
    );
    expect(base(events, 50 * HOUR_MS).filter(a => a.kind === 'NUDGE_REALTOR')).toHaveLength(0);
  });

  it('owes a closed request nothing, however long it sits', () => {
    const events = logOf(...submitted(3), ev('REQUEST_CANCELLED', 1 * HOUR_MS, { reason: 'renter' }));
    expect(base(events, 400 * HOUR_MS)).toHaveLength(0);
  });

  it('still reminds a confirmed request about tomorrow\'s viewing', () => {
    // Closed for coordination is not closed for the renter.
    const events = logOf(
      ...submitted(1),
      ev('OUTCOME_RECORDED', 1 * HOUR_MS, { outcome: 'CONFIRMED', slots: [{ starts_at: at(72 * HOUR_MS), duration_minutes: 30 }] }, 'i1'),
      ev('ITINERARY_DELIVERED', 2 * HOUR_MS, { message_id: 'm1' }),
      ev('REQUEST_CONFIRMED', 3 * HOUR_MS, { confirmed_item_ids: ['i1'] }),
    );
    const slots = [{ itemId: 'i1', startsAt: at(72 * HOUR_MS) }];
    const view = reduceRequest('r', events);
    const early = dueActions({ view, events, createdAt: at(0), now: T0 + 40 * HOUR_MS, slots });
    expect(early.map(a => a.kind)).not.toContain('VIEWING_REMINDER');
    const due = dueActions({ view, events, createdAt: at(0), now: T0 + 60 * HOUR_MS, slots });
    expect(due.map(a => a.kind)).toContain('VIEWING_REMINDER');
  });

  it('does not remind about a viewing that has already happened', () => {
    const events = logOf(
      ...submitted(1),
      ev('OUTCOME_RECORDED', 1 * HOUR_MS, { outcome: 'CONFIRMED', slots: [{ starts_at: at(10 * HOUR_MS), duration_minutes: 30 }] }, 'i1'),
      ev('ITINERARY_DELIVERED', 2 * HOUR_MS, { message_id: 'm1' }),
      ev('REQUEST_CONFIRMED', 3 * HOUR_MS, { confirmed_item_ids: ['i1'] }),
    );
    const view = reduceRequest('r', events);
    const due = dueActions({
      view, events, createdAt: at(0), now: T0 + 20 * HOUR_MS,
      slots: [{ itemId: 'i1', startsAt: at(10 * HOUR_MS) }],
    });
    expect(due.map(a => a.kind)).not.toContain('VIEWING_REMINDER');
  });
});

// ── The S6 acceptance criterion ─────────────────────────────────────────────

describe('property: no open request goes 24h without the renter hearing something', () => {
  /**
   * A tiny deterministic PRNG. Seeded so a failure is reproducible - a random
   * property test that cannot be replayed reports a bug you then cannot find.
   */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  /** A plausible random log: some items, some contacts, nudges and outcomes. */
  function randomLog(rand: () => number) {
    seq = 0;
    const itemCount = 3 + Math.floor(rand() * 3);
    const events: DomainEvent[] = [ev('REQUEST_SUBMITTED', 0)];
    for (let i = 1; i <= itemCount; i++) events.push(ev('ITEM_ADDED', 0, { listing_id: `l${i}` }, `i${i}`));

    let deliveredAt: number | null = null;
    for (let i = 1; i <= itemCount; i++) {
      const roll = rand();
      const t = Math.floor(rand() * 30 * HOUR_MS);
      if (roll < 0.25) continue;                                    // never contacted
      events.push(ev('REALTOR_CONTACTED', t, { channel: 'ZALO' }, `i${i}`));
      if (roll < 0.5) continue;                                     // contacted, silent
      const outcome = rand() < 0.5
        ? { outcome: 'CONFIRMED', slots: [{ starts_at: at(100 * HOUR_MS), duration_minutes: 30 }] }
        : { outcome: 'ALREADY_RENTED', slots: [] };
      events.push(ev('OUTCOME_RECORDED', t + HOUR_MS, outcome, `i${i}`));
    }
    if (rand() < 0.4) {
      deliveredAt = Math.floor(rand() * 40 * HOUR_MS);
      events.push(ev('ITINERARY_DELIVERED', deliveredAt, { message_id: 'm1' }));
    }
    if (rand() < 0.15) events.push(ev('REQUEST_CANCELLED', Math.floor(rand() * 40 * HOUR_MS), { reason: 'renter' }));
    return events;
  }

  it('holds across 500 random logs and clocks', () => {
    const rand = rng(20260912);
    let openAndSilentCases = 0;

    for (let trial = 0; trial < 500; trial++) {
      const events = randomLog(rand);
      const now = T0 + Math.floor(rand() * 96 * HOUR_MS);
      const view = reduceRequest('r', events);

      // Only events that have actually happened by `now` are visible - a
      // scheduler must not be rescued by an event from its own future.
      const visible = events.filter(e => Date.parse(e.occurred_at) <= now);
      const viewNow = reduceRequest('r', visible);
      const silentFor = now - lastHeardFromUs(visible, at(0));
      const isClosed = ['CONFIRMED', 'CANCELLED', 'FAILED_NO_SUPPLY'].includes(viewNow.state);

      const actions = dueActions({ view: viewNow, events: visible, createdAt: at(0), now });

      if (!isClosed && silentFor >= SILENCE_ACTION_MS) {
        openAndSilentCases++;
        expect(
          actions.some(a => a.kind === 'HOLDING_UPDATE'),
          `trial ${trial}: open, silent ${Math.floor(silentFor / HOUR_MS)}h, state ${viewNow.state}, no update due`,
        ).toBe(true);
      }

      // The contrapositive: never nag a request that has just been answered.
      if (silentFor < SILENCE_ACTION_MS) {
        expect(actions.some(a => a.kind === 'HOLDING_UPDATE'), `trial ${trial}: nagged too early`).toBe(false);
      }

      void view;
    }

    // A property that never met its precondition has proved nothing.
    expect(openAndSilentCases).toBeGreaterThan(50);
  });
});

describe('the holding update', () => {
  it('says what is known and when to expect the rest, and nothing else', () => {
    const events = logOf(
      ...submitted(5),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'CONFIRMED', slots: [{ starts_at: at(72 * HOUR_MS), duration_minutes: 30 }] }, 'i1'),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'ALREADY_RENTED', slots: [] }, 'i2'),
    );
    const text = renderHoldingUpdate({ ref: 'HV-4KX7', view: reduceRequest('r', events) });
    expect(text).toContain('2 of 5');
    expect(text).toContain('HV-4KX7');
    expect(text.toLowerCase()).not.toContain('sorry');
    // One message, three lines. Every message inside the window is billed.
    expect(text.split('\n')).toHaveLength(3);
  });

  it('does not claim progress it has not made', () => {
    const text = renderHoldingUpdate({ ref: 'HV-4KX7', view: reduceRequest('r', logOf(...submitted(4))) });
    expect(text).toContain('waiting on 4 agents');
  });
});
