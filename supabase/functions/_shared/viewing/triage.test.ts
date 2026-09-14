import { describe, it, expect } from 'vitest';
import { triage, urgency, openItems, formatVnd, humanAge, SLA_BREACH_HOURS, HOUR_MS } from './triage.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';

const NOW = Date.parse('2026-09-12T00:00:00.000Z');
let seq = 0;
const ev = (type: string, payload: Record<string, unknown> = {}, itemId?: string): DomainEvent => ({
  id: ++seq,
  request_id: 'r',
  item_id: itemId ?? null,
  type,
  payload,
  actor: 'SYSTEM',
  occurred_at: '2026-09-11T00:00:00.000Z',
});

/** A request with `n` items, all PENDING, plus whatever else is passed. */
function view(n: number, extra: DomainEvent[] = []) {
  seq = 0;
  const events = [ev('REQUEST_SUBMITTED')];
  for (let i = 1; i <= n; i++) events.push(ev('ITEM_ADDED', { listing_id: `l${i}` }, `i${i}`));
  return reduceRequest('r', [...events, ...extra]);
}

const outcome = (o: string, itemId: string) =>
  ev('OUTCOME_RECORDED', { outcome: o, slots: o === 'CONFIRMED' ? [{ starts_at: '2026-09-15T03:00:00Z', duration_minutes: 30 }] : [] }, itemId);

describe('the SLA clock', () => {
  it('runs from the last thing the renter heard, not from intake', () => {
    // A request answered at hour 20 is not late at hour 25. Measuring from
    // intake would flag it and send the operator to chase a request that has
    // already been answered.
    const age = 25 * 3600;
    expect(urgency(age, null, NOW)).toBe('LATE');
    expect(urgency(age, NOW - 2 * HOUR_MS, NOW)).toBe('OK');
  });

  it('warns well before the promise is broken', () => {
    expect(urgency(1 * 3600, null, NOW)).toBe('OK');
    expect(urgency(13 * 3600, null, NOW)).toBe('WARN');
    expect(urgency(SLA_BREACH_HOURS * 3600, null, NOW)).toBe('LATE');
  });
});

describe('what the operator works next', () => {
  it('puts brokers still to contact above replies outstanding', () => {
    // Contacting is the operator's scarce act; waiting is not.
    const toContact = triage(view(3), 3600, null, NOW);
    const waiting = triage(
      view(3, [ev('REALTOR_CONTACTED', { channel: 'ZALO' }, 'i1'), ev('REALTOR_CONTACTED', { channel: 'ZALO' }, 'i2'), ev('REALTOR_CONTACTED', { channel: 'ZALO' }, 'i3')]),
      3600, null, NOW,
    );
    expect(toContact.rank).toBeLessThan(waiting.rank);
    expect(toContact.waitingOn).toBe('3 brokers to contact');
    expect(waiting.waitingOn).toBe('3 replies outstanding');
  });

  it('sorts a late request above a fresh one doing the same thing', () => {
    const late = triage(view(3), 30 * 3600, null, NOW);
    const fresh = triage(view(3), 3600, null, NOW);
    expect(late.rank).toBeLessThan(fresh.rank);
    expect(late.urgency).toBe('LATE');
  });

  it('drops a closed request out of the working set however old it is', () => {
    const confirmed = view(3, [ev('REQUEST_CONFIRMED', { confirmed_item_ids: ['i1'] })]);
    const t = triage(confirmed, 200 * 3600, null, NOW);
    expect(t.actionable).toBe(false);
    expect(t.rank).toBeGreaterThan(triage(view(3), 3600, null, NOW).rank);
  });

  it('calls a partial result ready to assemble, not unfinished', () => {
    // Three of five confirmed with two dead ends is a finished request
    // (invariant 5), and the queue must not nag about the two.
    const v = view(5, [
      outcome('CONFIRMED', 'i1'), outcome('CONFIRMED', 'i2'), outcome('CONFIRMED', 'i3'),
      outcome('ALREADY_RENTED', 'i4'), outcome('UNREACHABLE', 'i5'),
    ]);
    const t = triage(v, 3600, null, NOW);
    expect(openItems(v)).toHaveLength(0);
    expect(t.waitingOn).toBe('Ready to assemble - 3 of 5 confirmed');
    expect(t.actionable).toBe(true);
  });

  it('flags a zero-confirmed request as needing substitutes, never as done', () => {
    const v = view(3, [outcome('ALREADY_RENTED', 'i1'), outcome('ALREADY_RENTED', 'i2'), outcome('UNREACHABLE', 'i3')]);
    expect(triage(v, 3600, null, NOW).waitingOn).toBe('Nothing confirmed - needs substitutes');
  });

  it('counts a contacted item as open, and an outcome as closed', () => {
    const contacted = view(2, [ev('REALTOR_CONTACTED', { channel: 'ZALO' }, 'i1')]);
    expect(openItems(contacted)).toHaveLength(2);
    const done = view(2, [outcome('CONFIRMED', 'i1')]);
    expect(openItems(done).map(i => i.state)).toEqual(['PENDING']);
  });
});

describe('display conventions', () => {
  it('formats dong the Vietnamese way', () => {
    expect(formatVnd(15_000_000)).toBe('15.000.000 ₫');
  });

  it('reads an age at a glance', () => {
    expect(humanAge(120)).toBe('2m');
    expect(humanAge(3 * 3600)).toBe('3h');
    expect(humanAge(72 * 3600)).toBe('3d');
  });
});
