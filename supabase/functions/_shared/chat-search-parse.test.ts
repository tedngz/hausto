import { describe, it, expect } from 'vitest';
import { extractAmenities, parseBedrooms, parsePrice, splitAvoidedAreas } from './chat-search-parse.ts';

// The message that found nothing in budget on 2026-10-19, with 2-bedrooms at
// 13M and 15M in the database.
const REPORTED =
  'I am looking for a 2-bedroom apartment that includes access to a swimming pool and a gym if possible ' +
  '(if not it’s okay). My budget is a maximum of 12M–15M VND per month, and I am open to a lease term of ' +
  'either 6 months or 1 year(flexible). Regarding the district, I am open to all, but I would prefer to ' +
  'avoid District 9 and District 2.';

describe('parsePrice', () => {
  it('reads a range as a ceiling of its upper end', () => {
    expect(parsePrice(REPORTED)).toBe(15_000_000);
    expect(parsePrice('budget 12-15 million')).toBe(15_000_000);
    expect(parsePrice('12 to 15tr a month')).toBe(15_000_000);
    expect(parsePrice('between 10m and 12m')).toBeNull();
  });

  it('still reads a single ceiling', () => {
    expect(parsePrice('under 20M')).toBe(20_000_000);
    expect(parsePrice('max of 18 million')).toBe(18_000_000);
    expect(parsePrice('15m vnd')).toBe(15_000_000);
    expect(parsePrice('dưới 10 triệu')).toBe(10_000_000);
  });

  it('does not read a size or a lease as a budget', () => {
    expect(parsePrice('50-70 m2 apartment')).toBeNull();
    expect(parsePrice('60-80m² please')).toBeNull();
    expect(parsePrice('a lease of 6-12 months')).toBeNull();
  });
});

describe('parseBedrooms', () => {
  it('reads a hyphenated count', () => {
    expect(parseBedrooms(REPORTED)).toBe('2');
    expect(parseBedrooms('a 3-bedroom flat')).toBe('3');
    expect(parseBedrooms('2-br near the river')).toBe('2');
    expect(parseBedrooms('two-bedroom place')).toBe('2');
  });

  it('keeps the forms it already read', () => {
    expect(parseBedrooms('2 bedrooms')).toBe('2');
    expect(parseBedrooms('1br')).toBe('1');
    expect(parseBedrooms('2 bed apartment')).toBe('2');
    expect(parseBedrooms('3 phòng ngủ')).toBe('3');
    expect(parseBedrooms('5 bedroom villa')).toBe('4+');
    expect(parseBedrooms('a studio')).toBe('studio');
  });

  it('does not count months or years', () => {
    expect(parseBedrooms('6 months or 1 year')).toBeNull();
  });
});

describe('extractAmenities', () => {
  it('reads what was asked for and nothing hiding inside other words', () => {
    // "access" is not AC, "location" is not a cat.
    expect(extractAmenities(REPORTED)).toEqual(['pool', 'gym']);
    expect(extractAmenities('great location, with carpet')).toEqual([]);
  });

  it('still reads short terms as words', () => {
    expect(extractAmenities('needs AC and a TV')).toEqual(['tv', 'air conditioning']);
    expect(extractAmenities('I have a cat')).toEqual(['pet']);
    expect(extractAmenities('two balconies')).toEqual(['balcony']);
    expect(extractAmenities('có hồ bơi và máy lạnh')).toEqual(['pool', 'air conditioning']);
  });
});

describe('splitAvoidedAreas', () => {
  it('takes the places to avoid out of the places asked for', () => {
    const { wanted, avoided } = splitAvoidedAreas(REPORTED);
    expect(avoided).toEqual(['District 9 and District 2']);
    expect(wanted).not.toMatch(/District [29]/);
  });

  it('keeps a list going past commas, and stops at a turn back', () => {
    expect(splitAvoidedAreas('avoid D9, D2 and Binh Tan please').avoided).toEqual(['D9, D2 and Binh Tan please']);
    const r = splitAvoidedAreas('anywhere except District 7, but Thao Dien would be great');
    expect(r.avoided).toEqual(['District 7']);
    expect(r.wanted).toMatch(/Thao Dien/);
  });

  it('does not let a comma carry an avoid clause into a wish', () => {
    const r = splitAvoidedAreas("I don't want anything noisy, D1 is fine");
    expect(r.avoided).toEqual(['anything noisy']);
    expect(r.wanted).toMatch(/D1/);
  });

  it('reads "not" and "no" only in front of a place', () => {
    expect(splitAvoidedAreas('D7 but not District 4').avoided).toEqual(['District 4']);
    expect(splitAvoidedAreas('no Q9 please').avoided).toEqual(['Q9 please']);
    expect(splitAvoidedAreas('not too far from District 1').avoided).toEqual([]);
    expect(splitAvoidedAreas('I am not going to District 2 often').avoided).toEqual([]);
    expect(splitAvoidedAreas('no pets, District 3').avoided).toEqual([]);
  });

  it('leaves a message with nothing to avoid alone', () => {
    const text = '2 bedroom in Thao Dien under 20M';
    expect(splitAvoidedAreas(text)).toEqual({ wanted: text, avoided: [] });
  });
});
