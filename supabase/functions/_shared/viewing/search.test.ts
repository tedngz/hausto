import { describe, it, expect } from 'vitest';
import {
  validateFilters,
  toQueryString,
  renderSearchResults,
  MAX_RESULTS,
  MIN_PLAUSIBLE_VND,
  MAX_PLAUSIBLE_VND,
  type SearchResult,
} from './search.ts';

describe('never trusting the model', () => {
  it('caps the limit regardless of what it asks for', () => {
    const v = validateFilters({ limit: 500, city: 'ho chi minh' });
    expect(v.filters!.limit).toBe(MAX_RESULTS);
  });

  it('only ever searches crawled listings', () => {
    // Internal properties are a different ledger with a different booking path;
    // a renter cannot request a viewing on one through this flow.
    expect(validateFilters({ source: 'internal' }).filters!.source).toBe('external');
  });

  it('drops a city the index does not cover', () => {
    const v = validateFilters({ city: 'Paris' });
    expect(v.filters!.city).toBeUndefined();
    expect(v.dropped).toContain('city:paris');
  });

  it('ignores keys that are not part of the contract', () => {
    const v = validateFilters({ city: 'hanoi', sql: 'DROP TABLE', order_by: 'x' });
    expect(Object.keys(v.filters!).sort()).toEqual(['city', 'limit', 'source']);
  });

  it('refuses a payload that is not an object at all', () => {
    expect(validateFilters('nope').ok).toBe(false);
    expect(validateFilters(null).ok).toBe(false);
  });
});

describe('budgets, where a model is most likely to be wrong', () => {
  it('reads Saigon shorthand as millions', () => {
    // "15 triệu", "15m" and "15" all mean 15,000,000 to anyone talking about
    // rent here. A literal 15 would filter to nothing.
    expect(validateFilters({ max_budget: 15 }).filters!.max_budget).toBe(15_000_000);
    expect(validateFilters({ max_budget: 15.5 }).filters!.max_budget).toBe(15_500_000);
  });

  it('leaves a full figure alone', () => {
    expect(validateFilters({ max_budget: 15_000_000 }).filters!.max_budget).toBe(15_000_000);
  });

  it('drops implausible figures rather than searching on them', () => {
    expect(validateFilters({ max_budget: 0 }).filters!.max_budget).toBeUndefined();
    expect(validateFilters({ max_budget: -5 }).filters!.max_budget).toBeUndefined();
    expect(validateFilters({ max_budget: MAX_PLAUSIBLE_VND + 1 }).filters!.max_budget).toBeUndefined();
    expect(validateFilters({ max_budget: 'lots' }).dropped).toContain('max_budget:lots');
  });

  it('swaps a reversed pair instead of searching an impossible band', () => {
    // min > max can never match, and the renter reads the empty result as
    // "nothing like that exists".
    const v = validateFilters({ min_budget: 20, max_budget: 10 });
    expect(v.filters!.min_budget).toBe(10_000_000);
    expect(v.filters!.max_budget).toBe(20_000_000);
    expect(v.dropped).toContain('budget:swapped');
  });

  it('keeps the plausible floor above a typo', () => {
    expect(MIN_PLAUSIBLE_VND).toBeGreaterThanOrEqual(1_000_000);
  });
});

describe('rooms and style', () => {
  it('accepts the values that mean something', () => {
    for (const rooms of ['studio', '1', '2', '3', '4']) {
      expect(validateFilters({ rooms }).filters!.rooms, rooms).toBe(rooms);
    }
    expect(validateFilters({ rooms: 2 }).filters!.rooms).toBe('2');
  });

  it('drops the ones that do not', () => {
    const v = validateFilters({ rooms: 'a few' });
    expect(v.filters!.rooms).toBeUndefined();
    expect(v.dropped).toContain('rooms:a few');
  });

  it('passes a style through but bounds its length', () => {
    expect(validateFilters({ style: 'Modern' }).filters!.style).toBe('modern');
    expect(validateFilters({ style: 'x'.repeat(200) }).filters!.style!.length).toBe(40);
  });
});

describe('the query string', () => {
  it('carries only what was set', () => {
    const v = validateFilters({ city: 'ho chi minh', max_budget: 18, rooms: '2' });
    const qs = toQueryString(v.filters!);
    expect(qs).toContain('city=ho+chi+minh');
    expect(qs).toContain('max_budget=18000000');
    expect(qs).toContain('rooms=2');
    expect(qs).toContain('limit=3');
    expect(qs).toContain('source=external');
    expect(qs).not.toContain('min_budget');
  });
});

describe('the reply', () => {
  const results: SearchResult[] = [
    { id: 'a1', title: 'Sunny 2BR in Thao Dien', price_vnd: 18_000_000, district_code: 'HCM-D2', rooms: '2 Bedrooms', size: '70 m2' },
    { id: 'a2', title: 'Studio near Ben Thanh', price_vnd: 11_500_000, district_code: 'HCM-D1', rooms: 'Studio' },
    { id: 'a3', title: 'Quiet 1BR, Phu Nhuan', price_vnd: 9_000_000, district_code: 'HCM-PN' },
  ];

  it('is one message carrying every result', () => {
    // Three photos would be three messages, which sendFreeForm refuses at the
    // third. The link previews an image anyway.
    const text = renderSearchResults({ results, siteUrl: 'https://hausto.com' });
    expect(typeof text).toBe('string');
    for (const r of results) expect(text).toContain(r.title);
  });

  it('gives each result a deep link to its page', () => {
    const text = renderSearchResults({ results, siteUrl: 'https://hausto.com' });
    expect(text).toContain('https://hausto.com/property/a1');
    expect(text).toContain('https://hausto.com/property/a3');
  });

  it('prefers the url the search endpoint supplied over building one', () => {
    const text = renderSearchResults({
      results: [{ id: 'a1', title: 'A flat', url: 'https://hausto.com/property/canonical-id' }],
      siteUrl: 'https://example.invalid',
    });
    expect(text).toContain('https://hausto.com/property/canonical-id');
    expect(text).not.toContain('example.invalid');
  });

  it('says price on request rather than quoting an uncorrected figure', () => {
    // When the canonical read finds nothing the caller nulls the price, and
    // the renter must see no number rather than a wrong one - "730 ₫" for a
    // $730 flat, which is what the raw `price` column says, is worse than
    // saying nothing.
    const text = renderSearchResults({
      results: [{ id: 'a1', title: 'A flat', price_vnd: null, price_display: null }],
      siteUrl: 'https://hausto.com',
    });
    expect(text).toContain('price on request');
    expect(text).not.toContain('₫');
  });

  it('never shows more than three however many it is handed', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...results[0], id: `x${i}`, title: `Flat ${i}` }));
    const text = renderSearchResults({ results: many, siteUrl: 'https://hausto.com' });
    expect(text).toContain('Flat 0');
    expect(text).toContain('Flat 2');
    expect(text).not.toContain('Flat 3');
  });

  it('formats dong the Vietnamese way', () => {
    const text = renderSearchResults({ results, siteUrl: 'https://hausto.com' });
    expect(text).toContain('18.000.000 ₫');
  });

  it('falls back to the display price when there is no canonical one', () => {
    const text = renderSearchResults({
      results: [{ id: 'b', title: 'A flat', price_vnd: null, price_display: '$700 / month' }],
      siteUrl: 'https://hausto.com',
    });
    expect(text).toContain('$700 / month');
  });

  it('says so plainly when nothing matches, and offers a way forward', () => {
    const text = renderSearchResults({ results: [], siteUrl: 'https://hausto.com' });
    expect(text).toContain('Nothing live matches');
    expect(text).toContain('wider budget');
  });

  it('carries the ref when there is one, so a reply routes', () => {
    expect(renderSearchResults({ results, siteUrl: 'https://hausto.com', ref: 'HV-4KX7' })).toContain('HV-4KX7');
  });

  it('never leaks a realtor number - it is given none', () => {
    const text = renderSearchResults({ results, siteUrl: 'https://hausto.com' });
    expect(text).not.toMatch(/\+?84\d{7,}/);
  });
});
