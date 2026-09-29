import { describe, it, expect } from 'vitest';
import { reduceInquiry, inquiryDeadline, type InquiryEvent } from '../viewing-domain.ts';

let n = 0;
const ev = (type: string, occurred_at: string, payload: Record<string, unknown> = {}): InquiryEvent =>
  ({ id: ++n, inquiry_id: 'inq-1', type, payload, actor: 'OPS:op-1', occurred_at });

const T = (h: number) => new Date(Date.UTC(2026, 8, 29, h)).toISOString();

describe('reduceInquiry', () => {
  it('waits for the code, then is new, then sourcing once an agent is asked', () => {
    expect(reduceInquiry('inq-1', [ev('SUBMITTED', T(1))]).state).toBe('AWAITING_CODE');
    const confirmed = reduceInquiry('inq-1', [ev('SUBMITTED', T(1)), ev('CONFIRMED', T(2))]);
    expect(confirmed.state).toBe('NEW');
    expect(confirmed.confirmedAt).toBe(T(2));
    const asked = reduceInquiry('inq-1', [
      ev('SUBMITTED', T(1)), ev('CONFIRMED', T(2)), ev('AGENT_ASKED', T(3), { realtor_id: 'r1', medium: 'ZALO' }),
    ]);
    expect(asked.state).toBe('SOURCING');
    expect(asked.agents.r1).toMatchObject({ askedAt: T(3), medium: 'ZALO', answer: null });
  });

  it('records what each agent answered, the latest answer standing', () => {
    const v = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)),
      ev('AGENT_ASKED', T(2), { realtor_id: 'r1' }),
      ev('AGENT_ANSWERED', T(3), { realtor_id: 'r1', answer: 'NO_UNITS' }),
      ev('AGENT_ANSWERED', T(5), { realtor_id: 'r1', answer: 'HAS_UNITS' }),
      ev('AGENT_ASKED', T(4), { realtor_id: 'r2' }),
    ]);
    expect(v.agents.r1).toMatchObject({ answer: 'HAS_UNITS', answeredAt: T(5) });
    expect(v.agents.r2).toMatchObject({ askedAt: T(4), answer: null });
  });

  it('keeps the first ask when an agent is asked again', () => {
    const v = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)), ev('AGENT_ASKED', T(2), { realtor_id: 'r1', medium: 'ZALO' }),
      ev('AGENT_ASKED', T(6), { realtor_id: 'r1', medium: 'PHONE' }),
    ]);
    expect(v.agents.r1).toMatchObject({ askedAt: T(2), medium: 'ZALO' });
  });

  it('reduces events arriving out of order the same as in order', () => {
    const inOrder = [
      ev('SUBMITTED', T(1)), ev('CONFIRMED', T(2)),
      ev('AGENT_ASKED', T(3), { realtor_id: 'r1' }), ev('AGENT_ANSWERED', T(4), { realtor_id: 'r1', answer: 'NO_REPLY' }),
      ev('CLOSED', T(5), { reason: 'NOTHING_FOUND' }),
    ];
    const shuffled = [inOrder[4], inOrder[2], inOrder[0], inOrder[3], inOrder[1]];
    expect(reduceInquiry('inq-1', shuffled)).toEqual(reduceInquiry('inq-1', inOrder));
  });

  it('never goes back to NEW when the code arrives after an ask', () => {
    // Clock skew between the webhook and the console.
    const v = reduceInquiry('inq-1', [ev('AGENT_ASKED', T(1), { realtor_id: 'r1' }), ev('CONFIRMED', T(2))]);
    expect(v.state).toBe('SOURCING');
  });

  it('closes with a reason, keeps late answers, and reopens to where it was', () => {
    const closed = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)), ev('AGENT_ASKED', T(2), { realtor_id: 'r1' }),
      ev('CLOSED', T(3), { reason: 'RENTED_ELSEWHERE' }),
      ev('AGENT_ANSWERED', T(4), { realtor_id: 'r1', answer: 'HAS_UNITS' }),
    ]);
    expect(closed).toMatchObject({ state: 'CLOSED', closedReason: 'RENTED_ELSEWHERE', closedAt: T(3) });
    expect(closed.agents.r1.answer).toBe('HAS_UNITS');

    const reopened = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)), ev('CLOSED', T(2), { reason: 'DUPLICATE' }), ev('REOPENED', T(3)),
    ]);
    expect(reopened).toMatchObject({ state: 'NEW', closedReason: null });
  });

  it('files an unknown close reason as OTHER and ignores an unknown answer', () => {
    const v = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)), ev('AGENT_ANSWERED', T(2), { realtor_id: 'r1', answer: 'MAYBE' }),
      ev('CLOSED', T(3), { reason: 'BORED' }),
    ]);
    expect(v.agents.r1).toBeUndefined();
    expect(v.closedReason).toBe('OTHER');
  });

  it('puts the deadline 24 hours after the code', () => {
    expect(inquiryDeadline(reduceInquiry('inq-1', [ev('CONFIRMED', T(2))]))).toBe(new Date(Date.UTC(2026, 8, 30, 2)).toISOString());
    expect(inquiryDeadline(reduceInquiry('inq-1', []))).toBeNull();
  });
});
