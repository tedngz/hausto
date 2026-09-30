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

describe('reduceInquiry - units (S7.1b)', () => {
  it('records captured units and marks their agent as having units', () => {
    const v = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)), ev('UNIT_CAPTURED', T(2), { listing_id: 'u1', realtor_id: 'r1' }),
      ev('UNIT_CAPTURED', T(3), { listing_id: 'u2', realtor_id: 'r1' }),
    ]);
    expect(v.state).toBe('SOURCING');
    expect(v.capturedListingIds).toEqual(['u1', 'u2']);
    expect(v.agents.r1.answer).toBe('HAS_UNITS');
  });

  it('keeps an answer recorded before the capture', () => {
    const v = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)), ev('AGENT_ANSWERED', T(2), { realtor_id: 'r1', answer: 'NO_REPLY' }),
      ev('UNIT_CAPTURED', T(3), { listing_id: 'u1', realtor_id: 'r1' }),
    ]);
    // "No reply" then a unit is odd, but the log says both; the explicit answer stands.
    expect(v.agents.r1.answer).toBe('NO_REPLY');
  });

  it('is OFFERED once units went out, and stays so when more agents are asked', () => {
    const v = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)), ev('UNIT_CAPTURED', T(2), { listing_id: 'u1' }),
      ev('UNITS_OFFERED', T(3), { listing_ids: ['u1', 'l9'], message_id: 'm1' }),
      ev('AGENT_ASKED', T(4), { realtor_id: 'r2' }),
    ]);
    expect(v).toMatchObject({ state: 'OFFERED', offeredListingIds: ['u1', 'l9'], offeredAt: T(3) });
  });

  it('keeps every unit ever offered, the last offer dated', () => {
    const v = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)),
      ev('UNITS_OFFERED', T(2), { listing_ids: ['a', 'b'] }),
      ev('UNITS_OFFERED', T(5), { listing_ids: ['b', 'c'] }),
    ]);
    expect(v.offeredListingIds).toEqual(['a', 'b', 'c']);
    expect(v.offeredAt).toBe(T(5));
  });

  it('ignores an offer with no units', () => {
    expect(reduceInquiry('inq-1', [ev('CONFIRMED', T(1)), ev('UNITS_OFFERED', T(2), { listing_ids: [] })]).state).toBe('NEW');
  });

  it('reopens to OFFERED when something was offered before it closed', () => {
    const v = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)), ev('UNITS_OFFERED', T(2), { listing_ids: ['a'] }),
      ev('CLOSED', T(3), { reason: 'RENTER_WENT_QUIET' }), ev('REOPENED', T(4)),
    ]);
    expect(v.state).toBe('OFFERED');
  });

  it('reduces capture and offer arriving out of order the same as in order', () => {
    const inOrder = [
      ev('SUBMITTED', T(1)), ev('CONFIRMED', T(2)), ev('AGENT_ASKED', T(3), { realtor_id: 'r1' }),
      ev('UNIT_CAPTURED', T(4), { listing_id: 'u1', realtor_id: 'r1' }),
      ev('UNITS_OFFERED', T(5), { listing_ids: ['u1'] }),
    ];
    const shuffled = [inOrder[4], inOrder[1], inOrder[3], inOrder[0], inOrder[2]];
    expect(reduceInquiry('inq-1', shuffled)).toEqual(reduceInquiry('inq-1', inOrder));
  });
});

describe('reduceInquiry - the brief', () => {
  it('has none until the renter changes it, then the latest stands', () => {
    expect(reduceInquiry('inq-1', [ev('CONFIRMED', T(1))]).brief).toBeNull();
    const v = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)),
      ev('BRIEF_CHANGED', T(2), { bedrooms: [3, 2], budget_max_vnd: 30_000_000, message_id: 'm1' }),
      ev('BRIEF_CHANGED', T(4), { bedrooms: [2, 3, 4], budget_max_vnd: null, message_id: 'm2' }),
    ]);
    expect(v.brief).toEqual({ bedrooms: [2, 3, 4], budgetMaxVnd: null });
    expect(v.state).toBe('NEW');
  });

  it('ignores a change with no usable bedrooms', () => {
    const v = reduceInquiry('inq-1', [
      ev('CONFIRMED', T(1)), ev('BRIEF_CHANGED', T(2), { bedrooms: [0, 9, 'two'], budget_max_vnd: 1 }),
    ]);
    expect(v.brief).toBeNull();
  });

  it('reduces the same in any order', () => {
    const events = [
      ev('CONFIRMED', T(1)),
      ev('AGENT_ASKED', T(2), { realtor_id: 'r1' }),
      ev('BRIEF_CHANGED', T(3), { bedrooms: [3], budget_max_vnd: 30_000_000 }),
      ev('UNITS_OFFERED', T(4), { listing_ids: ['u1'] }),
      ev('BRIEF_CHANGED', T(5), { bedrooms: [2, 3], budget_max_vnd: 35_000_000 }),
    ];
    const forwards = reduceInquiry('inq-1', events);
    expect(reduceInquiry('inq-1', [...events].reverse())).toEqual(forwards);
    expect(reduceInquiry('inq-1', [events[4], events[0], events[3], events[2], events[1]])).toEqual(forwards);
    expect(forwards.brief).toEqual({ bedrooms: [2, 3], budgetMaxVnd: 35_000_000 });
  });
});
