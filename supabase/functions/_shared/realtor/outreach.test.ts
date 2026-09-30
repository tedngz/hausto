import { describe, it, expect } from 'vitest';
import { FakeDb } from '../viewing/fake-db.ts';
import {
  loadOutreach,
  outreachRefusal,
  MAX_CHECKS_PER_AGENT_PER_WEEK,
  MAX_NEW_AGENTS_PER_DAY,
  type PriorMessage,
} from './outreach.ts';
import { availabilityDraft } from './drafts.ts';
import { assertNoRenterIdentity } from './send.ts';

const NOW = new Date('2026-10-01T05:00:00Z'); // 12:00 in Ho Chi Minh City
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const check = (inquiryId: string, createdAt: string, status = 'SENT'): PriorMessage =>
  ({ realtorId: 'a1', inquiryId, purpose: 'AVAILABILITY_CHECK', createdAt, status });

describe('who the bridge may ask', () => {
  it('asks an agent about a request once', () => {
    expect(outreachRefusal({ toAgent: [], inquiryId: 'q1', newAgentsToday: 0, now: NOW })).toBeNull();
    expect(outreachRefusal({ toAgent: [check('q1', daysAgo(1))], inquiryId: 'q1', newAgentsToday: 0, now: NOW }))
      .toMatch(/already been asked/);
  });

  it('does not count a send that failed', () => {
    expect(outreachRefusal({ toAgent: [check('q1', daysAgo(0), 'FAILED')], inquiryId: 'q1', newAgentsToday: 0, now: NOW }))
      .toBeNull();
  });

  it(`caps checks to one agent at ${MAX_CHECKS_PER_AGENT_PER_WEEK} a week, across requests`, () => {
    const three = [check('q1', daysAgo(1)), check('q2', daysAgo(3)), check('q3', daysAgo(6))];
    expect(outreachRefusal({ toAgent: three, inquiryId: 'q4', newAgentsToday: 0, now: NOW })).toMatch(/this week/);
    const older = [check('q1', daysAgo(1)), check('q2', daysAgo(3)), check('q3', daysAgo(8))];
    expect(outreachRefusal({ toAgent: older, inquiryId: 'q4', newAgentsToday: 0, now: NOW })).toBeNull();
  });

  it(`caps agents new to us at ${MAX_NEW_AGENTS_PER_DAY} a day, and lets known agents through`, () => {
    expect(outreachRefusal({ toAgent: [], inquiryId: 'q1', newAgentsToday: MAX_NEW_AGENTS_PER_DAY, now: NOW }))
      .toMatch(/new to us/);
    const known: PriorMessage[] = [{ realtorId: 'a1', inquiryId: null, purpose: 'REQUEST_VIEWING', createdAt: daysAgo(10), status: 'SENT' }];
    expect(outreachRefusal({ toAgent: known, inquiryId: 'q1', newAgentsToday: MAX_NEW_AGENTS_PER_DAY, now: NOW })).toBeNull();
  });

  it('counts the agents whose first message from us went today', async () => {
    const db = new FakeDb();
    const out = (realtor_id: string, created_at: string, status = 'SENT') =>
      ({ realtor_id, inquiry_id: 'q', purpose: 'AVAILABILITY_CHECK', direction: 'OUT', created_at, status });
    db.tables.realtor_messages = [
      out('new-1', '2026-10-01T02:00:00Z'),
      out('new-2', '2026-10-01T03:00:00Z'),
      out('old-1', '2026-10-01T03:30:00Z'), out('old-1', '2026-09-20T03:00:00Z'),
      out('failed', '2026-10-01T04:00:00Z', 'FAILED'),
      out('yesterday', '2026-09-30T10:00:00Z'), // 17:00 on the 30th there
    ];
    // deno-lint-ignore no-explicit-any
    const facts = await loadOutreach(db as any, 'old-1', NOW);
    expect(facts.newAgentsToday).toBe(2);
    expect(facts.toAgent).toHaveLength(2);
  });
});

describe('the availability check', () => {
  const brief = {
    complexName: 'Empire City', bedrooms: 2, budgetMaxVnd: 25_000_000, moveInDate: '2026-11-15', leaseMonths: 12, hasPets: false,
  };

  it('says what is wanted and asks for photos, price and a time', () => {
    const text = availabilityDraft(brief);
    expect(text).toContain('Empire City');
    expect(text).toContain('2 phòng ngủ, tối đa 25.000.000 ₫/tháng');
    expect(text).toContain('15/11, thuê 12 tháng');
    expect(text).toContain('hình, giá và khi nào xem được');
    expect(availabilityDraft({ ...brief, bedrooms: 4, budgetMaxVnd: null, hasPets: true })).toContain('từ 4 phòng ngủ\n- vào ở');
  });

  it('passes the check every message to an agent passes', () => {
    expect(() => assertNoRenterIdentity(availabilityDraft(brief), { phone_e164: '+447700900123', display_name: 'Mai Nguyen' }))
      .not.toThrow();
  });
});
