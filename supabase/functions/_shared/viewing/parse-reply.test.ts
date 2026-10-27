import { describe, it, expect } from 'vitest';
import { interpretParse, buildParseInput, PARSE_PROMPT, PRICE_TOLERANCE, type ParseContext } from './parse-reply.ts';
import { withinWindows } from './intake.ts';

// Sunday 27 Sep 2026, 10:00 in Ho Chi Minh City.
const NOW = new Date('2026-09-27T03:00:00Z');

const ctx: ParseContext = {
  reply: 'Còn em, thứ 3 10h xem được nhé',
  listingTitle: 'Căn hộ 2PN Thảo Điền',
  priceVnd: 15_000_000,
  availability: [
    { date: '2026-09-29', part: 'MORNING' },     // Tuesday
    { date: '2026-10-01', part: 'EVENING' },     // Thursday
  ],
  now: NOW,
};

const read = (raw: Record<string, unknown>) => interpretParse({ confident: true, summary: 'x', ...raw }, ctx);

describe('the renter windows, on the clock', () => {
  it('knows a morning from an afternoon, in Ho Chi Minh City time', () => {
    expect(withinWindows('2026-09-29T03:00:00Z', ctx.availability)).toBe(true);   // Tue 10:00
    expect(withinWindows('2026-09-29T05:30:00Z', ctx.availability)).toBe(false);  // Tue 12:30
    expect(withinWindows('2026-10-01T11:00:00Z', ctx.availability)).toBe(true);   // Thu 18:00
    expect(withinWindows('2026-09-30T03:00:00Z', ctx.availability)).toBe(false);  // Wed, not a window
  });
});

describe('what the reply becomes', () => {
  it('is CONFIRMED when the agent names a time inside the renter\'s windows', () => {
    const s = read({ reading: 'AVAILABLE', times: ['2026-09-29 10:00'] });
    expect(s.outcome).toBe('CONFIRMED');
    expect(s.slots).toEqual([{ startsAt: '2026-09-29T03:00:00.000Z', durationMinutes: 30 }]);
    expect(s.confidence).toBe('HIGH');
    expect(s.problems).toEqual([]);
  });

  it('is ALTERNATIVE_OFFERED when every time named is outside them', () => {
    // Saturday 10:00 - the renter never said Saturday.
    const s = read({ reading: 'AVAILABLE', times: ['2026-10-03 10:00'] });
    expect(s.outcome).toBe('ALTERNATIVE_OFFERED');
    expect(s.slots.map(x => x.startsAt)).toEqual(['2026-10-03T03:00:00.000Z']);
  });

  it('keeps only the in-window times when some are in and some out, and says so', () => {
    const s = read({ reading: 'AVAILABLE', times: ['2026-09-29 10:00', '2026-10-03 10:00'] });
    expect(s.outcome).toBe('CONFIRMED');
    expect(s.slots).toHaveLength(1);
    expect(s.problems.join(' ')).toMatch(/outside the renter/);
    expect(s.confidence).toBe('LOW');
  });

  it('makes a new price PRICE_CHANGED, with no slot, whatever times came with it', () => {
    // "Còn em, giá 18tr, thứ 3 10h được" - available, but not at the price the
    // renter agreed to. SPEC §4: PRICE_CHANGED is slotless.
    const s = read({ reading: 'AVAILABLE', times: ['2026-09-29 10:00'], price_vnd: 18_000_000 });
    expect(s.outcome).toBe('PRICE_CHANGED');
    expect(s.actualPriceVnd).toBe(18_000_000);
    expect(s.slots).toEqual([]);
    expect(s.note).toContain('Times offered: 2026-09-29 10:00');
  });

  it('treats a price said roughly as the same price', () => {
    const near = Math.round(15_000_000 * (1 + PRICE_TOLERANCE / 2));
    const s = read({ reading: 'AVAILABLE', times: ['2026-09-29 10:00'], price_vnd: near });
    expect(s.outcome).toBe('CONFIRMED');
    expect(s.actualPriceVnd).toBeNull();
  });

  it('reads rented as ALREADY_RENTED and a wrong number as UNREACHABLE', () => {
    expect(read({ reading: 'ALREADY_RENTED' }).outcome).toBe('ALREADY_RENTED');
    expect(read({ reading: 'WRONG_PERSON' }).outcome).toBe('UNREACHABLE');
  });

  it('reads "not at those times" with nothing better offered as UNAVAILABLE_DATE', () => {
    expect(read({ reading: 'NOT_AT_THOSE_TIMES' }).outcome).toBe('UNAVAILABLE_DATE');
  });

  it('suggests nothing for a reply that settles nothing', () => {
    // "Để anh hỏi chủ nhà đã" - save it and wait.
    const s = read({ reading: 'UNCLEAR' });
    expect(s.outcome).toBeNull();
    expect(s.confidence).toBe('LOW');
  });

  it('never suggests NO_RESPONSE - there is a reply', () => {
    const s = read({ reading: 'NO_RESPONSE' as never });
    expect(s.outcome).not.toBe('NO_RESPONSE');
  });

  it('flags an agreement with no readable time rather than inventing one', () => {
    const s = read({ reading: 'AVAILABLE', times: [] });
    expect(s.outcome).toBe('CONFIRMED');
    expect(s.slots).toEqual([]);
    expect(s.problems.join(' ')).toMatch(/pick one/);
    expect(s.confidence).toBe('LOW');
  });
});

describe('what it refuses to fill in', () => {
  it('drops a time in the past, and a time a month out, as misread dates', () => {
    const s = read({ reading: 'AVAILABLE', times: ['2026-09-20 10:00', '2026-12-01 10:00'] });
    expect(s.slots).toEqual([]);
    expect(s.problems).toHaveLength(3); // two bad dates, then no time left
  });

  it('turns garbage into a low-confidence empty suggestion instead of throwing', () => {
    for (const raw of [null, 'text', 42, { reading: 'AVAILABLE', times: 'tomorrow' }, { times: ['soon'] }]) {
      const s = interpretParse(raw, ctx);
      expect(s.confidence).toBe('LOW');
      expect(s.slots).toEqual([]);
    }
  });

  it('is LOW confidence when the model said it was unsure', () => {
    expect(read({ reading: 'ALREADY_RENTED', confident: false }).confidence).toBe('LOW');
  });

  it('uses the duration the agent gave, within reason', () => {
    expect(read({ reading: 'AVAILABLE', times: ['2026-09-29 10:00'], duration_minutes: 60 }).slots[0].durationMinutes).toBe(60);
    expect(read({ reading: 'AVAILABLE', times: ['2026-09-29 10:00'], duration_minutes: 900 }).slots[0].durationMinutes).toBe(30);
  });
});

describe('what the model is told', () => {
  it('names today and each window with its weekday and hours, so "thứ 3" can be resolved', () => {
    const input = buildParseInput(ctx);
    expect(input).toContain('Today: Sunday 2026-09-27');
    expect(input).toContain('- Tuesday 2026-09-29 morning (08:00-12:00)');
    expect(input).toContain('- Thursday 2026-10-01 evening (17:00-21:00)');
    expect(input).toContain('Price we listed: 15000000 VND');
    expect(input).toContain('Còn em, thứ 3 10h xem được nhé');
  });

  it('carries nothing about the renter, because it is given nothing', () => {
    expect(buildParseInput(ctx)).not.toMatch(/\+84|renter/i);
  });
});

describe('the terms the agent states', () => {
  // "Thứ 3 10h được em. Cọc 2 tháng, HĐ tối thiểu 1 năm, không nuôi thú cưng,
  // phí quản lý 500k, điện 3.5k/số" - the first message asked about all four.
  const terms = {
    available_from: null, min_lease_months: 12, deposit_months: 2, pets: 'NOT_ALLOWED',
    fees: [
      { name: 'Management fee', included: false, amount: '500,000 VND/month' },
      { name: 'Electricity', included: false, amount: '3,500 VND/kWh' },
    ],
  };

  it('reads them beside the outcome, without touching it', () => {
    const s = read({ reading: 'AVAILABLE', times: ['2026-09-29 10:00'], terms });
    expect(s.outcome).toBe('CONFIRMED');
    expect(s.confidence).toBe('HIGH');
    expect(s.terms).toMatchObject({ depositMonthsMin: 2, depositMonthsMax: 2, minLeaseMonths: 12, petsAllowed: false });
    expect(s.terms!.fees.map(f => [f.kind, f.amount])).toEqual([
      ['MANAGEMENT', '500,000 VND/month'], ['ELECTRICITY', '3,500 VND/kWh'],
    ]);
  });

  it('holds them to the bounds the listing readers keep', () => {
    const s = read({ reading: 'AVAILABLE', times: ['2026-09-29 10:00'],
      terms: { deposit_months: 30, min_lease_months: 0, pets: 'MAYBE', available_from: 'soon' } });
    expect(s.terms).toMatchObject({ depositMonthsMin: null, minLeaseMonths: null, petsAllowed: null, availability: null });
  });

  it('drops a fee that carries a phone number, and lets the outcome stand', () => {
    const s = read({ reading: 'AVAILABLE', times: ['2026-09-29 10:00'], terms: {
      fees: [{ name: 'Parking - call 0901 234 567', included: false, amount: null },
        { name: 'Water', included: false, amount: '100,000 VND/person' }],
    } });
    expect(s.terms!.fees.map(f => f.kind)).toEqual(['WATER']);
    expect(s.problems).toEqual([]);
    expect(s.confidence).toBe('HIGH');
  });

  it('says when a reply is only terms, rather than that it settles nothing', () => {
    const s = read({ reading: 'UNCLEAR', terms });
    expect(s.outcome).toBeNull();
    expect(s.problems).toEqual(['Only the terms - nothing settled about the viewing yet.']);
  });

  it('reports none when the model gave none, or garbage', () => {
    for (const raw of [{ reading: 'ALREADY_RENTED' }, { reading: 'AVAILABLE', terms: 'cọc 2 tháng' }]) {
      const s = read(raw);
      expect(s.terms).toMatchObject({ depositMonthsMin: null, fees: [] });
    }
  });

  it('asks the model for the shape termsFromModel reads', () => {
    expect(PARSE_PROMPT).toContain('"deposit_months": number | [min, max] | null');
    expect(PARSE_PROMPT).toContain('"pets": "ALLOWED" | "NOT_ALLOWED" | null');
  });
});
