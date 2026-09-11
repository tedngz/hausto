import { describe, it, expect } from 'vitest';
import {
  validateOutcome,
  outcomePayload,
  opsActor,
  jobsForOutcome,
  OUTCOMES,
  NUDGES_BEFORE_NO_RESPONSE,
  type ValidatedOutcome,
} from './outcomes.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';

const slot = (startsAt = '2026-09-15T03:00:00.000Z', durationMinutes = 30) => ({ startsAt, durationMinutes });
const ctx = { priorNudges: 0 };

describe('the seven, and only the seven', () => {
  it('has exactly seven outcomes', () => {
    expect(OUTCOMES).toHaveLength(7);
  });

  it('refuses an outcome that is not one of them', () => {
    // The whole value of the corpus is that the label set is closed. An eighth
    // outcome is a poisoned row nobody notices for a month.
    for (const bad of ['MAYBE', 'confirmed', '', 'CONFIRMED ', 'OTHER']) {
      expect(validateOutcome({ outcome: bad, slots: [slot()] }, ctx).ok).toBe(false);
    }
  });

  it('accepts every one of them when its requirements are met', () => {
    const submissions: Record<string, Parameters<typeof validateOutcome>[0]> = {
      CONFIRMED: { outcome: 'CONFIRMED', slots: [slot()] },
      ALTERNATIVE_OFFERED: { outcome: 'ALTERNATIVE_OFFERED', slots: [slot()] },
      UNAVAILABLE_DATE: { outcome: 'UNAVAILABLE_DATE' },
      ALREADY_RENTED: { outcome: 'ALREADY_RENTED' },
      PRICE_CHANGED: { outcome: 'PRICE_CHANGED', actualPriceVnd: 18_000_000 },
      NO_RESPONSE: { outcome: 'NO_RESPONSE' },
      UNREACHABLE: { outcome: 'UNREACHABLE' },
    };
    for (const name of OUTCOMES) {
      const context = name === 'NO_RESPONSE' ? { priorNudges: NUDGES_BEFORE_NO_RESPONSE } : ctx;
      const r = validateOutcome(submissions[name], context);
      expect(r.ok, `${name}: ${r.ok ? '' : r.error}`).toBe(true);
    }
  });
});

describe('what each outcome requires', () => {
  it('will not confirm without a slot', () => {
    expect(validateOutcome({ outcome: 'CONFIRMED' }, ctx).ok).toBe(false);
    expect(validateOutcome({ outcome: 'CONFIRMED', slots: [] }, ctx).ok).toBe(false);
    expect(validateOutcome({ outcome: 'ALTERNATIVE_OFFERED', slots: [] }, ctx).ok).toBe(false);
  });

  it('will not attach a slot to an outcome that has no use for one', () => {
    // A slot on ALREADY_RENTED would sit in the corpus as a confirmed viewing
    // time for a unit that is already let.
    const r = validateOutcome({ outcome: 'ALREADY_RENTED', slots: [slot()] }, ctx);
    expect(r.ok).toBe(false);
  });

  it('will not record a price change without the price', () => {
    expect(validateOutcome({ outcome: 'PRICE_CHANGED' }, ctx).ok).toBe(false);
    expect(validateOutcome({ outcome: 'PRICE_CHANGED', actualPriceVnd: 0 }, ctx).ok).toBe(false);
    // Dong is an integer, never a float (SPEC §7).
    expect(validateOutcome({ outcome: 'PRICE_CHANGED', actualPriceVnd: 18_000_000.5 }, ctx).ok).toBe(false);
  });

  it('will not attach a price to any other outcome', () => {
    expect(validateOutcome({ outcome: 'ALREADY_RENTED', actualPriceVnd: 1 }, ctx).ok).toBe(false);
  });

  it('holds NO_RESPONSE until the item has actually been chased twice', () => {
    // One attempt and silence is "we have not chased them yet". The difference
    // decides whether the next act is a nudge or closing the item.
    expect(validateOutcome({ outcome: 'NO_RESPONSE' }, { priorNudges: 0 }).ok).toBe(false);
    expect(validateOutcome({ outcome: 'NO_RESPONSE' }, { priorNudges: 1 }).ok).toBe(false);
    expect(validateOutcome({ outcome: 'NO_RESPONSE' }, { priorNudges: 2 }).ok).toBe(true);
    expect(validateOutcome({ outcome: 'NO_RESPONSE' }, { priorNudges: 9 }).ok).toBe(true);
  });
});

describe('slots', () => {
  it('insists on an explicit offset, because a bare local time is a missed viewing', () => {
    const bare = validateOutcome({ outcome: 'CONFIRMED', slots: [slot('2026-09-15T10:00:00')] }, ctx);
    expect(bare.ok).toBe(false);
  });

  it('normalises to UTC and keeps the duration', () => {
    // 10:00 in Ho Chi Minh City is 03:00 UTC.
    const r = validateOutcome({ outcome: 'CONFIRMED', slots: [slot('2026-09-15T10:00:00+07:00', 45)] }, ctx);
    expect(r.ok && r.value.slots[0]).toEqual({ startsAt: '2026-09-15T03:00:00.000Z', durationMinutes: 45 });
  });

  it('rejects a duration that is a typo rather than a viewing', () => {
    expect(validateOutcome({ outcome: 'CONFIRMED', slots: [slot(undefined, 0)] }, ctx).ok).toBe(false);
    expect(validateOutcome({ outcome: 'CONFIRMED', slots: [slot(undefined, 600)] }, ctx).ok).toBe(false);
    expect(validateOutcome({ outcome: 'CONFIRMED', slots: [slot(undefined, 30.5)] }, ctx).ok).toBe(false);
  });

  it('rejects an unparseable time', () => {
    expect(validateOutcome({ outcome: 'CONFIRMED', slots: [slot('tuesday afternoon')] }, ctx).ok).toBe(false);
  });
});

describe('the note', () => {
  it('is carried through and never parsed', () => {
    const r = validateOutcome(
      { outcome: 'ALREADY_RENTED', note: '  he said it went last week - CONFIRMED at 3pm  ' },
      ctx,
    );
    expect(r.ok).toBe(true);
    // The note mentions CONFIRMED and a time. Neither changes anything: the
    // outcome is what the operator pressed, and free text never affects state.
    expect(r.ok && r.value.outcome).toBe('ALREADY_RENTED');
    expect(r.ok && r.value.slots).toEqual([]);
    expect(r.ok && r.value.note).toBe('he said it went last week - CONFIRMED at 3pm');
  });

  it('is truncated rather than rejected', () => {
    const r = validateOutcome({ outcome: 'ALREADY_RENTED', note: 'x'.repeat(5000) }, ctx);
    expect(r.ok && r.value.note!.length).toBe(2000);
  });
});

describe('the event it becomes', () => {
  it('renders the payload the reducer reads', () => {
    const v: ValidatedOutcome = {
      outcome: 'CONFIRMED',
      slots: [{ startsAt: '2026-09-15T03:00:00.000Z', durationMinutes: 30 }],
      note: 'ring the bell',
    };
    expect(outcomePayload(v)).toEqual({
      outcome: 'CONFIRMED',
      slots: [{ starts_at: '2026-09-15T03:00:00.000Z', duration_minutes: 30 }],
      note: 'ring the bell',
    });
  });

  it('drives the reducer to the state SPEC §4 names', () => {
    // The table in §4 maps each action to an item state. This is that table,
    // checked against the actual reducer rather than restated.
    const expected: Record<string, string> = {
      CONFIRMED: 'CONFIRMED',
      ALTERNATIVE_OFFERED: 'ALTERNATIVE_OFFERED',
      UNAVAILABLE_DATE: 'UNAVAILABLE',
      ALREADY_RENTED: 'ALREADY_RENTED',
      PRICE_CHANGED: 'PRICE_CHANGED',
      NO_RESPONSE: 'NO_RESPONSE',
      UNREACHABLE: 'UNREACHABLE',
    };
    for (const outcome of OUTCOMES) {
      const needsSlot = outcome === 'CONFIRMED' || outcome === 'ALTERNATIVE_OFFERED';
      const v: ValidatedOutcome = {
        outcome,
        slots: needsSlot ? [{ startsAt: '2026-09-15T03:00:00.000Z', durationMinutes: 30 }] : [],
        ...(outcome === 'PRICE_CHANGED' ? { actualPriceVnd: 18_000_000 } : {}),
      };
      const events: DomainEvent[] = [
        { id: 1, request_id: 'r', item_id: null, type: 'REQUEST_SUBMITTED', payload: {}, actor: 'RENTER', occurred_at: '2026-09-11T00:00:00Z' },
        { id: 2, request_id: 'r', item_id: 'i1', type: 'ITEM_ADDED', payload: { listing_id: 'l1' }, actor: 'RENTER', occurred_at: '2026-09-11T00:00:01Z' },
        { id: 3, request_id: 'r', item_id: 'i1', type: 'OUTCOME_RECORDED', payload: outcomePayload(v), actor: opsActor('u1'), occurred_at: '2026-09-11T01:00:00Z' },
      ];
      expect(reduceRequest('r', events).items.i1.state, outcome).toBe(expected[outcome]);
    }
  });

  it('attributes the action to the operator who took it', () => {
    expect(opsActor('3f1b8e6a-0000-4000-8000-000000000000')).toBe('OPS:3f1b8e6a-0000-4000-8000-000000000000');
  });
});

describe('follow-on work', () => {
  const item = { itemId: 'i1', listingId: 'l1' };

  it('enqueues re-resolution for a dead number, and only for that', () => {
    // A wrong number is wrong on every future listing from that broker, not
    // just this request.
    const jobs = jobsForOutcome({ outcome: 'UNREACHABLE', slots: [] }, item);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'RESOLVE_REALTOR', payload: { listing_id: 'l1', reason: 'UNREACHABLE' } });

    for (const outcome of OUTCOMES.filter(o => o !== 'UNREACHABLE')) {
      expect(jobsForOutcome({ outcome, slots: [] }, item)).toHaveLength(0);
    }
  });
});
