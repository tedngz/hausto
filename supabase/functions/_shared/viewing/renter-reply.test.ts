import { describe, it, expect } from 'vitest';
import {
  interpretDraft,
  buildDraftInput,
  describeStatus,
  maskPhones,
  MAX_DRAFT_CHARS,
  type DraftContext,
} from './renter-reply.ts';

const ctx: DraftContext = {
  ref: 'HV-4KX9',
  state: 'DELIVERED',
  now: new Date('2026-09-27T03:00:00Z'),
  listings: [{
    itemId: 'i1', title: 'Sunny 2BR in Thao Dien', districtCode: 'D2', location: 'Thao Dien, Thu Duc',
    priceVnd: 15_000_000, bedrooms: 2, areaSqm: 70, amenities: ['pool', 'gym'],
    description: 'Fully furnished, pets allowed. Call Mr Hung 0901 234 567 to view.',
    status: 'confirmed for Tue 29 Sept, 09:00',
  }],
  thread: [
    { direction: 'OUT', body: '1 of the 2 places you asked about are free to view...', at: '2026-09-26T10:00:00Z' },
    { direction: 'IN', body: 'Is it furnished? my number is 0912345678', at: '2026-09-27T02:00:00Z' },
  ],
};

describe('what the model is shown', () => {
  const input = buildDraftInput(ctx);

  it('carries the listing facts and where each unit stands', () => {
    expect(input).toContain('Sunny 2BR in Thao Dien');
    expect(input).toContain('Status: confirmed for Tue 29 Sept, 09:00');
    expect(input).toContain('15.000.000 ₫/month');
    expect(input).toContain('2 bedrooms, 70 m2, District 2');
    expect(input).toContain('Amenities: pool, gym');
    expect(input).toContain('Request HV-4KX9, state DELIVERED');
  });

  it('masks every phone number - the agent\'s in a description, the renter\'s in their own message', () => {
    expect(input).not.toMatch(/0901 234 567|0912345678/);
    expect(input).toContain('Call Mr Hung [number hidden]');
    expect(input).toContain('my number is [number hidden]');
  });

  it('carries what the ad states about the lease, and what it leaves out', () => {
    const withTerms = buildDraftInput({
      ...ctx,
      listings: [{ ...ctx.listings[0], terms: "Terms the ad states (read 26 Sep 2026): deposit 2 months' rent. Not stated in the ad: the pet policy." }],
    });
    expect(withTerms).toContain("Lease terms: Terms the ad states (read 26 Sep 2026): deposit 2 months' rent. Not stated in the ad: the pet policy.");
    expect(input).not.toContain('Lease terms');
  });

  it('leaves prices and refs alone when masking', () => {
    expect(maskPhones('15000000 and HV-4KX9 and 15.000.000')).toBe('15000000 and HV-4KX9 and 15.000.000');
  });
});

describe('what comes back', () => {
  it('becomes a draft, with the ref added when the model forgot it', () => {
    const d = interpretDraft({ reply: 'Yes, it is fully furnished and pets are allowed.', confident: true, needs_agent: false, note: 'answered from listing' }, ctx);
    expect(d).toEqual({
      kind: 'DRAFT',
      message: 'Yes, it is fully furnished and pets are allowed.\nRef HV-4KX9',
      confidence: 'HIGH', needsAgent: false, note: 'answered from listing',
    });
  });

  it('is low confidence whenever the agent still has to be asked', () => {
    const d = interpretDraft({ reply: 'We will ask the agent about Saturday and come back to you. Ref HV-4KX9', confident: true, needs_agent: true }, ctx);
    expect(d).toMatchObject({ kind: 'DRAFT', confidence: 'LOW', needsAgent: true });
  });

  it('escalates a draft that says booked before the renter confirmed', () => {
    const d = interpretDraft({ reply: 'You are booked for Tuesday 9am!', confident: true }, ctx);
    expect(d.kind).toBe('ESCALATE');
  });

  it('escalates a draft carrying a phone number, whoever it belongs to', () => {
    expect(interpretDraft({ reply: 'You can call the agent on 0901234567.', confident: true }, ctx).kind).toBe('ESCALATE');
  });

  it('escalates an empty or overlong draft', () => {
    expect(interpretDraft({}, ctx).kind).toBe('ESCALATE');
    expect(interpretDraft({ reply: 'x'.repeat(MAX_DRAFT_CHARS + 1), confident: true }, ctx).kind).toBe('ESCALATE');
  });

  it('allows booking language once the request is confirmed', () => {
    const d = interpretDraft({ reply: 'Your booking for Tuesday is set. Ref HV-4KX9', confident: true }, { ...ctx, state: 'CONFIRMED' });
    expect(d.kind).toBe('DRAFT');
  });
});

describe('where a unit stands, in words', () => {
  it('names offered times and a changed price, and never the agent', () => {
    expect(describeStatus('ALTERNATIVE_OFFERED', [{ starts_at: '2026-10-03T03:00:00Z' }])).toContain('offered Sat 3 Oct, 10:00');
    expect(describeStatus('PRICE_CHANGED', [], 18_000_000)).toContain('18.000.000 ₫');
    expect(describeStatus('ALREADY_RENTED', [])).toBe('already rented - no longer available');
  });
});
