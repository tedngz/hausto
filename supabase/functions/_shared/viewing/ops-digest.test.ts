import { describe, it, expect } from 'vitest';
import type { DomainEvent, InquiryEvent } from '../viewing-domain.ts';
import {
  DIGEST_MIN_GAP_MS, digestDue, escalationUpdate, inquiryMessageUpdate, inquiryUpdates, renderDigest, viewingUpdates,
} from './ops-digest.ts';

let id = 0;
const ev = (type: string, payload: Record<string, unknown> = {}, actor = 'SYSTEM', at = '2026-10-08T02:00:00.000Z'): DomainEvent =>
  ({ id: ++id, request_id: 'r1', item_id: null, type, payload, actor, occurred_at: at });
const iev = (type: string, payload: Record<string, unknown> = {}): InquiryEvent =>
  ({ id: ++id, inquiry_id: 'q1', type, payload, actor: 'SYSTEM', occurred_at: '2026-10-08T03:00:00.000Z' });

describe('viewing request updates', () => {
  it('marks the replies a person must answer, and leaves a yes as news', () => {
    const u = viewingUpdates('HV-4KX2', [
      ev('RENTER_REPLIED', { intent: 'QUESTION' }),
      ev('RENTER_REPLIED', { intent: 'CONFIRM' }),
      ev('RENTER_REPLIED', { intent: 'UNKNOWN', handshake: true }),
    ]);
    expect(u.map(x => [x.what, x.needsYou])).toEqual([
      ['the renter wrote on WhatsApp (question) - it needs an answer', true],
      ['the renter said yes on WhatsApp', false],
    ]);
  });

  it('says what an agent answered, the plan, the lock-in and an end', () => {
    const u = viewingUpdates('HV-4KX2', [
      ev('OUTCOME_RECORDED', { outcome: 'ALREADY_RENTED', note: 'renter details never here' }),
      ev('ITINERARY_DELIVERED', { message_id: 'm1' }),
      ev('REQUEST_CONFIRMED', { cover: 'PASS' }),
      ev('REQUEST_CANCELLED', { reason: 'NOT_LOCKED_IN' }),
    ]);
    expect(u.map(x => x.what)).toEqual([
      'a place is already rented',
      'the plan went to the renter',
      'the renter locked the plan in with the Pass',
      'cancelled - not locked in by the deadline - agents are owed a release',
    ]);
    expect(u.every(x => !x.needsYou)).toBe(true);
  });

  it('leaves out a renter\'s own cancellation, which is emailed as it happens', () => {
    expect(viewingUpdates('HV-4KX2', [ev('REQUEST_CANCELLED', { reason: 'RENTER_DECLINED' }, 'RENTER')])).toEqual([]);
  });

  it('ignores the steps nobody needs to hear about', () => {
    expect(viewingUpdates('HV-4KX2', [ev('REALTOR_CONTACTED'), ev('ITEM_NUDGED'), ev('REPLY_SENT')])).toEqual([]);
  });
});

describe('availability and area search updates', () => {
  it('a new request needs someone, with its own clock', () => {
    expect(inquiryUpdates('BUILDING', 'Empire City', [iev('CONFIRMED')])[0])
      .toMatchObject({ what: 'new availability request - the renter is waiting, reply due within 24 hours', needsYou: true });
    expect(inquiryUpdates('SEARCH', 'Thao Dien', [iev('CONFIRMED')])[0].what).toContain('area search');
    expect(inquiryUpdates('SEARCH', 'Thao Dien', [iev('CONFIRMED')])[0].what).toContain('3 days');
  });

  it('offers and closes are news', () => {
    expect(inquiryUpdates('BUILDING', 'Empire City', [iev('UNITS_OFFERED'), iev('CLOSED', { reason: 'NOTHING_FOUND' })])
      .map(x => [x.what, x.needsYou])).toEqual([['units went to the renter', false], ['closed (nothing found)', false]]);
  });

  it('a renter message needs an answer', () => {
    expect(inquiryMessageUpdate('BUILDING', 'Empire City', '2026-10-08T03:00:00Z').needsYou).toBe(true);
  });
});

describe('the email', () => {
  it('puts what needs a person first, then news by kind, and never quotes anyone', () => {
    const alert = renderDigest([
      ...viewingUpdates('HV-4KX2', [ev('ITINERARY_DELIVERED')]),
      ...inquiryUpdates('BUILDING', 'Empire City', [iev('UNITS_OFFERED')]),
      escalationUpdate('HV-7MNP', 'No working number for this agent. A person has to find one.', '2026-10-08T01:00:00.000Z'),
    ])!;
    expect(alert.subject).toBe('Hausto ops - 1 needs you, 2 updates');
    const lines = alert.text.split('\n');
    expect(lines[0]).toBe('NEEDS YOU');
    expect(lines[1]).toMatch(/^- HV-7MNP: the AI operator needs a person: No working number/);
    expect(lines).toContain('VIEWING REQUESTS');
    expect(lines).toContain('BUILDING AVAILABILITY');
    expect(alert.text).toContain('https://hausto-ops.vercel.app');
  });

  it('says only how many updates when nothing needs anyone', () => {
    expect(renderDigest(viewingUpdates('HV-4KX2', [ev('ITINERARY_DELIVERED')]))!.subject).toBe('Hausto ops - 1 update');
    expect(renderDigest([])).toBeNull();
  });
});

describe('when it goes', () => {
  const now = Date.parse('2026-10-08T04:00:00Z');
  const news = viewingUpdates('HV-4KX2', [ev('ITINERARY_DELIVERED')]);
  const urgent = viewingUpdates('HV-4KX2', [ev('RENTER_REPLIED', { intent: 'QUESTION' })]);

  it('goes at once when something needs a person', () => {
    expect(digestDue(urgent, now - 60_000, now)).toBe(true);
  });

  it('holds news until the last digest is old enough', () => {
    expect(digestDue(news, now - 60_000, now)).toBe(false);
    expect(digestDue(news, now - DIGEST_MIN_GAP_MS, now)).toBe(true);
    expect(digestDue(news, null, now)).toBe(true);
  });

  it('never sends an empty one', () => {
    expect(digestDue([], null, now)).toBe(false);
  });
});

describe('links', () => {
  it('gives what needs a person a link straight to it in the console', () => {
    const alert = renderDigest([
      ...viewingUpdates('HV-4KX2', [ev('RENTER_REPLIED', { intent: 'QUESTION' })], 'req-9'),
      ...inquiryUpdates('SEARCH', 'Thao Dien', [iev('CONFIRMED')], 'inq-3'),
    ])!;
    expect(alert.text).toContain('\n  https://hausto-ops.vercel.app/#/request/req-9\n');
    expect(alert.text).toContain('\n  https://hausto-ops.vercel.app/#/inquiry/inq-3\n');
  });
});
