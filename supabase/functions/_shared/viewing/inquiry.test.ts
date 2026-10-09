import { describe, it, expect } from 'vitest';
import {
  buildInquiryLink,
  buildSearchLink,
  describeInquiry,
  renderInquiryConfirmed,
  validateInquiryInput,
  windowClosesAt,
} from './inquiry.ts';
import { watchCodeFromMessage } from './watch.ts';
import { refFromMessage } from './intake.ts';

const NOW = new Date('2026-09-29T03:00:00Z'); // 10:00 in HCMC

const valid = {
  complexId: '0b6f7a52-5a8e-4c7a-9f4e-2f7b1f0a9c11',
  name: 'Mai Nguyen',
  moveInDate: '2026-11-15',
  leaseMonths: 12,
  bedrooms: 2,
  budgetMaxVnd: 25_000_000,
  hasPets: true,
  notes: '  High floor  ',
};

describe('what the form may send', () => {
  it('accepts a request - no phone, no email, no channel to pick', () => {
    const r = validateInquiryInput(valid, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.notes).toBe('High floor');
      expect(r.value.hasPets).toBe(true);
      expect(Object.keys(r.value)).not.toContain('email');
    }
  });

  it('ignores an email or a channel a stale client still sends', () => {
    // Email is retired. An old page posting one gets a WhatsApp request.
    const r = validateInquiryInput({ ...valid, channel: 'EMAIL', email: 'mai@example.com' }, NOW);
    expect(r.ok).toBe(true);
    expect(r.ok && Object.keys(r.value)).not.toContain('email');
  });

  it('asks for the things a concierge cannot check without', () => {
    expect(validateInquiryInput({ ...valid, name: '  ' }, NOW).ok).toBe(false);
    expect(validateInquiryInput({ ...valid, moveInDate: undefined }, NOW).ok).toBe(false);
    expect(validateInquiryInput({ ...valid, budgetMaxVnd: null }, NOW).ok).toBe(false);
    expect(validateInquiryInput({ ...valid, leaseMonths: 9 }, NOW).ok).toBe(false);
    expect(validateInquiryInput({ ...valid, bedrooms: 5 }, NOW).ok).toBe(false);
  });

  it('refuses a move-in date in the past or beyond six months', () => {
    expect(validateInquiryInput({ ...valid, moveInDate: '2026-09-28' }, NOW).ok).toBe(false);
    expect(validateInquiryInput({ ...valid, moveInDate: '2026-09-29' }, NOW).ok).toBe(true);
    expect(validateInquiryInput({ ...valid, moveInDate: '2027-06-01' }, NOW).ok).toBe(false);
  });

  it('never takes a budget as a float, or a typo in millions', () => {
    expect(validateInquiryInput({ ...valid, budgetMaxVnd: 25 }, NOW).ok).toBe(false);
    expect(validateInquiryInput({ ...valid, budgetMaxVnd: 25_000_000.5 }, NOW).ok).toBe(false);
  });

  it('refuses something that is not a building id', () => {
    expect(validateInquiryInput({ ...valid, complexId: "'; drop table" }, NOW).ok).toBe(false);
  });
});

describe('the handshake', () => {
  it('carries a code the webhook finds, and no viewing ref', () => {
    const link = buildInquiryLink('+84901112222', 'HW-4KX9', 'Empire City');
    const text = decodeURIComponent(link.split('?text=')[1]);
    expect(text).toBe("Hi Hausto - I'd like to request availability at Empire City (HW-4KX9)");
    expect(watchCodeFromMessage(text)).toBe('HW-4KX9');
    expect(refFromMessage(text)).toBeNull();
  });
});

describe('the words', () => {
  const summary = {
    fullName: 'Mai Nguyen', complexName: 'Empire City', bedrooms: 2, budgetMaxVnd: 25_000_000,
    moveInDate: '2026-11-15', leaseMonths: 12, hasPets: true,
  };

  it('says back what we heard', () => {
    expect(describeInquiry(summary))
      .toBe('2 bedrooms, up to 25.000.000 ₫ a month, moving in from 15 Nov, 12-month lease, with a pet');
    expect(describeInquiry({ ...summary, bedrooms: 4, hasPets: false })).toMatch(/^4\+ bedrooms, .*lease$/);
  });

  it('confirms who does what by when, and that alerts come too', () => {
    const body = renderInquiryConfirmed({ ...summary, watchExpiresAt: '2026-11-29T16:59:59Z' });
    expect(body).toContain('Thanks Mai');
    expect(body).toContain('Empire City');
    expect(body).toContain('within 24 hours');
    expect(body).toContain('Until 29 Nov');
    expect(body).toContain('STOP');
    expect(body).not.toMatch(/book/i);
    expect(body).not.toMatch(/[—–]/);
  });

  it('shuts the window 24 hours after their last message', () => {
    expect(windowClosesAt('2026-09-29T03:00:00Z')?.toISOString()).toBe('2026-09-30T03:00:00.000Z');
    expect(windowClosesAt(null)).toBeNull();
  });

  it('promises a search 48 hours, each place confirmed with its agent', () => {
    const body = renderInquiryConfirmed({
      ...summary, complexName: 'District 2 and Binh Thanh', kind: 'AREA', watchExpiresAt: '2026-11-29T16:59:59Z',
    });
    expect(body).toContain('your search in District 2 and Binh Thanh is in');
    expect(body).toContain('Facebook groups and agents\' circles');
    expect(body).toContain('within 48 hours - each one confirmed with its agent');
    expect(body).not.toContain('24 hours');
    // "Facebook" is not booking talk (invariant 6); the word is.
    expect(body).not.toMatch(/\bbook(ed|ing)?\b/i);
    expect(body).not.toMatch(/[—–]/);
  });
});

describe('Priority search - an area instead of a building', () => {
  const area = { ...valid, complexId: undefined, areaDistrictCodes: ['D2', 'BINH_THANH'] };

  it('takes district codes in place of a building, once each', () => {
    const r = validateInquiryInput({ ...area, areaDistrictCodes: ['D2', 'BINH_THANH', 'D2'] }, NOW);
    expect(r.ok && r.value).toMatchObject({ complexId: null, areaDistrictCodes: ['D2', 'BINH_THANH'] });
  });

  it('is one place per request: an area sent with a building id is the area', () => {
    const r = validateInquiryInput({ ...area, complexId: valid.complexId }, NOW);
    expect(r.ok && r.value).toMatchObject({ complexId: null, areaDistrictCodes: ['D2', 'BINH_THANH'] });
  });

  it('refuses none, more than four, and anything that is not a district code', () => {
    expect(validateInquiryInput({ ...area, areaDistrictCodes: [] }, NOW).ok).toBe(false);
    expect(validateInquiryInput({ ...area, areaDistrictCodes: ['D1', 'D2', 'D3', 'D4', 'D7'] }, NOW).ok).toBe(false);
    expect(validateInquiryInput({ ...area, areaDistrictCodes: ['District 2'] }, NOW).ok).toBe(false);
    expect(validateInquiryInput({ ...area, areaDistrictCodes: ["D2'; drop table"] }, NOW).ok).toBe(false);
  });

  it('still asks for everything a person searching needs', () => {
    expect(validateInquiryInput({ ...area, budgetMaxVnd: null }, NOW).ok).toBe(false);
    expect(validateInquiryInput({ ...area, name: '' }, NOW).ok).toBe(false);
  });

  it('hands over with a search worded as one, carrying the code', () => {
    const text = decodeURIComponent(buildSearchLink('+84901112222', 'HW-4KX9', 'District 2 and Binh Thanh').split('?text=')[1]);
    expect(text).toBe('Hi Hausto - please search District 2 and Binh Thanh for me (HW-4KX9)');
    expect(watchCodeFromMessage(text)).toBe('HW-4KX9');
    expect(refFromMessage(text)).toBeNull();
  });
});
