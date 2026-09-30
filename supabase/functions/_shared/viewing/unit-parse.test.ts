import { describe, it, expect } from 'vitest';
import { buildUnitParseInput, interpretUnitParse, MAX_SUGGESTED_UNITS, type UnitParseContext } from './unit-parse.ts';

const ctx: UnitParseContext = {
  reply: 'Còn 2 căn 2PN: tầng 18 Linden 82m2 full NT 24tr, tầng 9 Cove 76m2 22tr5, trống sẵn',
  complexName: 'Empire City',
  brief: { bedrooms: [2], budgetMaxVnd: 25_000_000 },
  now: new Date('2026-10-01T03:00:00Z'),
};

const unit = (over: Record<string, unknown> = {}) => ({
  bedrooms: 2, area_sqm: 82, price_vnd: 24_000_000, floor: '18', tower: 'Linden', furnishing: 'FULL',
  pets_ok: null, available_from: '2026-10-01', quote: 'tầng 18 Linden 82m2 full NT 24tr', ...over,
});

describe('reading an agent\'s answer into units', () => {
  it('takes each unit the agent offered, with the words it came from', () => {
    const s = interpretUnitParse({
      answer: 'HAS_UNITS', confident: true, summary: 'Two 2BRs free now.',
      units: [unit(), unit({ area_sqm: 76, price_vnd: 22_500_000, floor: '9', tower: 'Cove', furnishing: null, quote: 'tầng 9 Cove 76m2 22tr5' })],
    }, ctx);
    expect(s).toMatchObject({ answer: 'HAS_UNITS', confidence: 'HIGH', note: 'Two 2BRs free now.' });
    expect(s.units).toHaveLength(2);
    expect(s.units[0]).toEqual({
      bedrooms: 2, areaSqm: 82, priceVnd: 24_000_000, floor: '18', tower: 'Linden', furnishing: 'FULL',
      petsOk: null, availableFrom: '2026-10-01', quote: 'tầng 18 Linden 82m2 full NT 24tr', problems: [],
    });
  });

  it('drops a field the capture form would refuse, and says what to ask', () => {
    const s = interpretUnitParse({
      answer: 'HAS_UNITS', confident: true,
      units: [unit({ price_vnd: 24, area_sqm: null }), unit({ bedrooms: null, furnishing: 'LUXURY', available_from: 'soon' })],
    }, ctx);
    expect(s.confidence).toBe('LOW');
    expect(s.units[0]).toMatchObject({ priceVnd: null, areaSqm: null });
    expect(s.units[0].problems).toEqual(['price 24 looks wrong', 'no floor area - ask the agent']);
    expect(s.units[1]).toMatchObject({ bedrooms: null, furnishing: null, availableFrom: null });
    expect(s.units[1].problems).toContain('no bedroom count - ask the agent');
  });

  it('flags a unit outside what the renter asked for', () => {
    const s = interpretUnitParse({ answer: 'HAS_UNITS', confident: true, units: [unit({ bedrooms: 3 }), unit({ price_vnd: 35_000_000 })] }, ctx);
    expect(s.units[0].problems).toEqual(['outside the brief: 3BR - they asked for 2 bedrooms']);
    expect(s.units[1].problems[0]).toMatch(/^outside the brief: 35.000.000 ₫ - over their 25.000.000 ₫ budget/);
  });

  it('counts five bedrooms as four-plus, and keeps at most five units', () => {
    const s = interpretUnitParse({
      answer: 'HAS_UNITS', confident: true, units: Array.from({ length: 8 }, () => unit({ bedrooms: 5 })),
    }, { ...ctx, brief: { bedrooms: [4], budgetMaxVnd: null } });
    expect(s.units).toHaveLength(MAX_SUGGESTED_UNITS);
    expect(s.units[0]).toMatchObject({ bedrooms: 4, problems: [] });
  });

  it('suggests nothing when there is nothing, or nothing it could read', () => {
    expect(interpretUnitParse({ answer: 'NO_UNITS', units: [unit()] }, ctx)).toMatchObject({ answer: 'NO_UNITS', units: [] });
    expect(interpretUnitParse({ answer: 'HAS_UNITS', units: [] }, ctx)).toMatchObject({ answer: 'UNCLEAR', units: [] });
    expect(interpretUnitParse(null, ctx)).toMatchObject({ answer: 'UNCLEAR', units: [], confidence: 'LOW' });
    expect(interpretUnitParse({ answer: 'MAYBE' }, ctx).answer).toBe('UNCLEAR');
  });

  it('gives the model the building, the brief and the day - and nothing about the renter', () => {
    const input = buildUnitParseInput(ctx);
    expect(input).toContain('Today: 2026-10-01');
    expect(input).toContain('Building: Empire City');
    expect(input).toContain('We asked for: 2 bedrooms, up to 25000000 VND a month');
    expect(input.endsWith(ctx.reply)).toBe(true);
  });
});
