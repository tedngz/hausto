import { describe, it, expect } from 'vitest';
import { planRequest, type PlanItem, type PlanInput, type UnreadReply } from './planner.ts';
import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';
import { NUDGE_AFTER_MS, HOUR_MS } from './reminders.ts';
import type { ParseSuggestion } from './parse-reply.ts';

const T0 = Date.parse('2026-09-27T01:00:00Z');
let seq = 0;
const ev = (type: string, offsetMs: number, payload: Record<string, unknown> = {}, itemId?: string): DomainEvent => ({
  id: ++seq, request_id: 'r', item_id: itemId ?? null, type, payload, actor: 'SYSTEM',
  occurred_at: new Date(T0 + offsetMs).toISOString(),
});

const items = (n: number, contact = true): PlanItem[] =>
  Array.from({ length: n }, (_, i) => ({
    itemId: `i${i + 1}`, listingTitle: `Căn ${i + 1}`, listingUrl: null, districtCode: 'HCM-D1',
    priceVnd: 15_000_000, hasContact: contact,
  }));

function plan(events: DomainEvent[], opts: Partial<PlanInput> = {}) {
  return planRequest({
    requestId: 'r',
    view: reduceRequest('r', events),
    events,
    items: items(2),
    availability: [{ date: '2026-09-29', part: 'MORNING' }],
    unreadReplies: [],
    now: T0 + HOUR_MS,
    ...opts,
  });
}

const submitted = (n = 2) => {
  seq = 0;
  const out = [ev('REQUEST_SUBMITTED', 0)];
  for (let i = 1; i <= n; i++) out.push(ev('ITEM_ADDED', 0, {}, `i${i}`));
  return out;
};

const slot = (iso: string) => [{ starts_at: iso, duration_minutes: 30 }];
const byKey = (ps: ReturnType<typeof plan>) => Object.fromEntries(ps.map(p => [p.key, p]));

describe('a fresh request', () => {
  it('proposes the first message to every agent with a number, as a Vietnamese draft', () => {
    const ps = plan(submitted());
    expect(ps.map(p => p.key)).toEqual(['CONTACT:i1', 'CONTACT:i2']);
    expect(ps[0]).toMatchObject({ action: 'CONTACTED', input: { itemId: 'i1', channel: 'ZALO' } });
    expect(String(ps[0].input.message)).toContain('Chào anh/chị');
  });

  it('escalates an agent with no number rather than inventing a contact', () => {
    const ps = plan(submitted(), { items: items(2, false) });
    expect(ps.every(p => p.action === 'ESCALATE')).toBe(true);
    expect(ps[0].key).toBe('NO_CONTACT:i1');
  });
});

describe('chasing', () => {
  it('waits the six hours before chasing, then chases', () => {
    const events = [...submitted(1), ev('REALTOR_CONTACTED', 0, {}, 'i1')];
    expect(plan(events, { items: items(1), now: T0 + NUDGE_AFTER_MS - 60_000 })).toEqual([]);
    const ps = plan(events, { items: items(1), now: T0 + NUDGE_AFTER_MS });
    expect(ps).toEqual([expect.objectContaining({ key: 'NUDGE:i1:1', action: 'NUDGE' })]);
  });

  it('measures from the last chase, and numbers the next one', () => {
    const events = [
      ...submitted(1), ev('REALTOR_CONTACTED', 0, {}, 'i1'), ev('ITEM_NUDGED', NUDGE_AFTER_MS, { attempt: 1 }, 'i1'),
    ];
    expect(plan(events, { items: items(1), now: T0 + NUDGE_AFTER_MS + HOUR_MS })).toEqual([]);
    expect(plan(events, { items: items(1), now: T0 + 2 * NUDGE_AFTER_MS })[0].key).toBe('NUDGE:i1:2');
  });

  it('proposes NO_RESPONSE only after two chases and more silence', () => {
    const events = [
      ...submitted(1), ev('REALTOR_CONTACTED', 0, {}, 'i1'),
      ev('ITEM_NUDGED', NUDGE_AFTER_MS, { attempt: 1 }, 'i1'),
      ev('ITEM_NUDGED', 2 * NUDGE_AFTER_MS, { attempt: 2 }, 'i1'),
    ];
    const [p] = plan(events, { items: items(1), now: T0 + 3 * NUDGE_AFTER_MS });
    expect(p).toMatchObject({ key: 'NO_RESPONSE:i1', action: 'OUTCOME', input: { outcome: 'NO_RESPONSE' } });
  });
});

describe('agent replies', () => {
  const suggestion = (s: Partial<ParseSuggestion>): ParseSuggestion => ({
    outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-29T02:00:00.000Z', durationMinutes: 30 }],
    actualPriceVnd: null, note: 'Tuesday 9:00 works', confidence: 'HIGH', problems: [], model: 'm', ...s,
  });
  const contacted = () => [...submitted(1), ev('REALTOR_CONTACTED', 0, {}, 'i1')];

  it('proposes the outcome paste-parse read, carrying what it suggested', () => {
    const unread: UnreadReply[] = [{ itemId: 'i1', messageId: 'rm1', suggestion: suggestion({}) }];
    const [p] = plan(contacted(), { items: items(1), unreadReplies: unread, now: T0 + 10 * HOUR_MS });
    expect(p).toMatchObject({
      key: 'OUTCOME:i1:rm1', action: 'OUTCOME', confidence: 'HIGH',
      input: { itemId: 'i1', outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-29T02:00:00.000Z', durationMinutes: 30 }] },
    });
    expect((p.input.suggested as ParseSuggestion).model).toBe('m');
  });

  it('reads the reply before chasing - no nudge for an agent who answered', () => {
    const unread: UnreadReply[] = [{ itemId: 'i1', messageId: 'rm1', suggestion: suggestion({}) }];
    const ps = plan(contacted(), { items: items(1), unreadReplies: unread, now: T0 + 10 * HOUR_MS });
    expect(ps.map(p => p.action)).toEqual(['OUTCOME']);
  });

  it('escalates a reply that settles nothing, or that could not be read', () => {
    for (const s of [suggestion({ outcome: null, problems: ['settles nothing'] }), null]) {
      const [p] = plan(contacted(), { items: items(1), unreadReplies: [{ itemId: 'i1', messageId: 'rm1', suggestion: s }] });
      expect(p).toMatchObject({ key: 'OUTCOME:i1:rm1', action: 'ESCALATE', confidence: 'LOW' });
    }
  });
});

describe('the itinerary', () => {
  it('is proposed once every agent has answered, ordered by the clock', () => {
    const events = [
      ...submitted(2),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'CONFIRMED', slots: slot('2026-09-29T04:00:00Z') }, 'i1'),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'CONFIRMED', slots: slot('2026-09-29T02:00:00Z') }, 'i2'),
    ];
    const p = byKey(plan(events))['DELIVER:r'];
    expect(p).toMatchObject({ action: 'DELIVER', input: { requestId: 'r', order: ['i2', 'i1'] } });
  });

  it('is not proposed while any agent is still out', () => {
    const events = [
      ...submitted(2),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'CONFIRMED', slots: slot('2026-09-29T04:00:00Z') }, 'i1'),
      ev('REALTOR_CONTACTED', HOUR_MS, {}, 'i2'),
    ];
    expect(byKey(plan(events))['DELIVER:r']).toBeUndefined();
  });

  it('escalates a clash instead of sending it', () => {
    const events = [
      ...submitted(2),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'CONFIRMED', slots: slot('2026-09-29T02:00:00Z') }, 'i1'),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'CONFIRMED', slots: slot('2026-09-29T02:10:00Z') }, 'i2'),
    ];
    expect(byKey(plan(events))['DELIVER:r'].action).toBe('ESCALATE');
  });

  it('is not proposed twice', () => {
    const events = [
      ...submitted(1),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'CONFIRMED', slots: slot('2026-09-29T02:00:00Z') }, 'i1'),
      ev('ITINERARY_DELIVERED', 2 * HOUR_MS, { message_id: 'm1' }),
    ];
    expect(byKey(plan(events, { items: items(1) }))['DELIVER:r']).toBeUndefined();
  });
});

describe('the renter', () => {
  it('escalates a question, keyed on the newest reply', () => {
    const events = [...submitted(1), ev('RENTER_REPLIED', HOUR_MS, { intent: 'QUESTION', message_id: 'm7' })];
    const p = byKey(plan(events, { items: items(1) }))['RENTER:m7'];
    expect(p).toMatchObject({ action: 'ESCALATE', input: { reason: 'RENTER_REPLY', intents: ['QUESTION'] } });
  });

  it('proposes cancelling on a decline, at low confidence - a keyword "no" can mean less', () => {
    const events = [...submitted(1), ev('RENTER_REPLIED', HOUR_MS, { intent: 'DECLINE', message_id: 'm7' })];
    const p = byKey(plan(events, { items: items(1) }))['RENTER:m7'];
    expect(p).toMatchObject({ action: 'CANCEL_REQUEST', confidence: 'LOW', input: { reason: 'RENTER_DECLINED' } });
  });
});

describe('a closed request', () => {
  it('proposes only telling the brokers, with the drafts they need', () => {
    const events = [
      ...submitted(2),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'CONFIRMED', slots: slot('2026-09-29T02:00:00Z') }, 'i1'),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'ALTERNATIVE_OFFERED', slots: slot('2026-09-30T02:00:00Z') }, 'i2'),
      ev('ITINERARY_DELIVERED', 2 * HOUR_MS, { message_id: 'm1' }),
      ev('REQUEST_CONFIRMED', 3 * HOUR_MS, { confirmed_item_ids: ['i1'] }),
    ];
    const ps = plan(events, { now: T0 + 10 * HOUR_MS });
    expect(ps.map(p => p.key)).toEqual(['NOTIFY:i1:CONFIRM', 'NOTIFY:i2:RELEASE']);
    expect(String(ps[0].input.message)).toContain('09:00 ngày 29/09');
  });

  it('proposes nothing at all once everyone is told', () => {
    const events = [
      ...submitted(1),
      ev('OUTCOME_RECORDED', HOUR_MS, { outcome: 'ALREADY_RENTED', slots: [] }, 'i1'),
      ev('REQUEST_CANCELLED', 2 * HOUR_MS, { reason: 'OTHER' }),
    ];
    expect(plan(events, { items: items(1) })).toEqual([]);
  });
});

describe('answering the renter with a draft', () => {
  const question = () => [...submitted(1), ev('RENTER_REPLIED', HOUR_MS, { intent: 'QUESTION', message_id: 'm7' })];
  const draft = { kind: 'DRAFT' as const, message: 'Yes, it is furnished.\nRef HV-4KX9', confidence: 'HIGH' as const, needsAgent: false, note: 'from listing' };

  it('proposes the reply, keyed on the reply it answers, with an idempotency key of its own', () => {
    const p = byKey(plan(question(), { items: items(1), renterDraft: { messageId: 'm7', draft } }))['RENTER:m7'];
    expect(p).toMatchObject({
      action: 'REPLY', confidence: 'HIGH',
      input: { requestId: 'r', message: 'Yes, it is furnished.\nRef HV-4KX9', clientKey: 'reply-m7' },
    });
  });

  it('flags a holding reply - the agent still has to be asked', () => {
    const holding = { ...draft, needsAgent: true, confidence: 'LOW' as const };
    const p = byKey(plan(question(), { items: items(1), renterDraft: { messageId: 'm7', draft: holding } }))['RENTER:m7'];
    expect(p.confidence).toBe('LOW');
    expect(p.rationale).toMatch(/still have to ask them/);
  });

  it('escalates with the reason when nothing can be sent', () => {
    const p = byKey(plan(question(), { items: items(1), renterDraft: { messageId: 'm7', draft: null, blocked: 'the 24-hour window is closed.' } }))['RENTER:m7'];
    expect(p.action).toBe('ESCALATE');
    expect(p.rationale).toContain('No draft: the 24-hour window is closed.');
  });

  it('never proposes a draft written for an older message', () => {
    const events = [...question(), ev('RENTER_REPLIED', 2 * HOUR_MS, { intent: 'RESCHEDULE', message_id: 'm8' })];
    const p = byKey(plan(events, { items: items(1), renterDraft: { messageId: 'm7', draft } }))['RENTER:m8'];
    expect(p.action).toBe('ESCALATE');
  });
});
