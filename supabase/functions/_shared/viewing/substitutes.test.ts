import { describe, it, expect } from 'vitest';
import {
  profileOf,
  rankSubstitutes,
  isOfferable,
  toRenderable,
  MAX_SUBSTITUTES,
  PRICE_CEILING_RATIO,
} from './substitutes.ts';
import type { ShortlistCandidate } from './intake.ts';

const listing = (over: Partial<ShortlistCandidate> = {}): ShortlistCandidate => ({
  id: 'x', is_active: true, price_vnd: 15_000_000, price_confidence: 'HIGH',
  bedrooms: 2, area_sqm: 70, district_code: 'HCM-D2', realtor_id: null, title: 'A flat', ...over,
});

/** A shortlist of three 2BR flats in Thao Dien around 15m. */
const shortlist = [
  listing({ id: 's1', price_vnd: 14_000_000 }),
  listing({ id: 's2', price_vnd: 15_000_000 }),
  listing({ id: 's3', price_vnd: 17_000_000 }),
];

describe('reading what the renter wanted', () => {
  it('takes the median price, not the mean', () => {
    // One 40m outlier must not drag the target up and turn every suggestion
    // into something they cannot afford.
    const withOutlier = [...shortlist, listing({ id: 's4', price_vnd: 40_000_000 })];
    expect(profileOf(withOutlier).targetPriceVnd).toBe(17_000_000);
    // The mean would be 21.5m.
  });

  it('collects the districts and bedroom counts they actually chose', () => {
    const p = profileOf([listing({ id: 'a', district_code: 'HCM-D1', bedrooms: 1 }), listing({ id: 'b' })]);
    expect(p.districts.sort()).toEqual(['HCM-D1', 'HCM-D2']);
    expect(p.bedrooms.sort()).toEqual([1, 2]);
  });

  it('remembers what to never suggest back', () => {
    expect(profileOf(shortlist).excludeListingIds).toEqual(['s1', 's2', 's3']);
  });

  it('survives a shortlist with no prices at all', () => {
    expect(profileOf([listing({ price_vnd: null })]).targetPriceVnd).toBe(0);
  });
});

describe('never suggesting something they cannot request', () => {
  it('applies the same gate intake does', () => {
    // A suggestion intake would refuse is a worse failure than no suggestion:
    // the renter taps it and is told no.
    expect(isOfferable(listing())).toBe(true);
    expect(isOfferable(listing({ is_active: false }))).toBe(false);
    expect(isOfferable(listing({ price_confidence: 'LOW' }))).toBe(false);
    expect(isOfferable(listing({ price_vnd: null }))).toBe(false);
    expect(isOfferable(listing({ bedrooms: null }))).toBe(false);
    expect(isOfferable(listing({ area_sqm: null }))).toBe(false);
    expect(isOfferable(listing({ district_code: null }))).toBe(false);
  });

  it('filters ineligible candidates out of the ranking', () => {
    const subs = rankSubstitutes(profileOf(shortlist), [
      listing({ id: 'c1', price_confidence: 'LOW' }),
      listing({ id: 'c2', is_active: false }),
      listing({ id: 'c3' }),
    ]);
    expect(subs.map(s => s.listingId)).toEqual(['c3']);
  });

  it('never suggests a listing already on the shortlist', () => {
    const subs = rankSubstitutes(profileOf(shortlist), [listing({ id: 's2' }), listing({ id: 'c1' })]);
    expect(subs.map(s => s.listingId)).toEqual(['c1']);
  });
});

describe('the price band', () => {
  it('is generous below and tight above', () => {
    // Cheaper is rarely unwelcome. Dearer is what wasted their time already.
    const p = profileOf(shortlist); // target 15m
    const subs = rankSubstitutes(p, [
      listing({ id: 'cheap', price_vnd: 12_000_000 }),     // 0.8x - in
      listing({ id: 'tooCheap', price_vnd: 9_000_000 }),   // 0.6x - out
      listing({ id: 'dearer', price_vnd: 16_500_000 }),    // 1.1x - in
      listing({ id: 'tooDear', price_vnd: 22_000_000 }),   // 1.47x - out
    ], 10);
    expect(subs.map(s => s.listingId).sort()).toEqual(['cheap', 'dearer']);
  });

  it('skips the band entirely when nothing shortlisted had a price', () => {
    // Otherwise a profile with target 0 would reject every candidate.
    const p = profileOf([listing({ id: 's1', price_vnd: null })]);
    const subs = rankSubstitutes(p, [listing({ id: 'c1', price_vnd: 15_000_000 })]);
    expect(subs).toHaveLength(1);
  });

  it('is asymmetric, and deliberately so', () => {
    expect(PRICE_CEILING_RATIO).toBeLessThan(1.25);
  });
});

describe('ranking', () => {
  it('puts district above bedrooms above price', () => {
    const p = profileOf(shortlist); // D2, 2 bed, 15m
    const subs = rankSubstitutes(p, [
      listing({ id: 'wrongDistrict', district_code: 'HCM-D7', bedrooms: 2, price_vnd: 15_000_000 }),
      listing({ id: 'rightAll', district_code: 'HCM-D2', bedrooms: 2, price_vnd: 15_000_000 }),
      listing({ id: 'rightDistrictWrongBeds', district_code: 'HCM-D2', bedrooms: 1, price_vnd: 15_000_000 }),
    ], 10);
    expect(subs.map(s => s.listingId)).toEqual(['rightAll', 'rightDistrictWrongBeds', 'wrongDistrict']);
  });

  it('caps at three, because every suggestion is a billed line', () => {
    const many = Array.from({ length: 10 }, (_, i) => listing({ id: `c${i}` }));
    expect(rankSubstitutes(profileOf(shortlist), many)).toHaveLength(MAX_SUBSTITUTES);
  });

  it('is stable, so an operator re-reading a request sees what they saw', () => {
    const candidates = [
      listing({ id: 'b', price_vnd: 15_000_000 }),
      listing({ id: 'a', price_vnd: 15_000_000 }),
      listing({ id: 'c', price_vnd: 14_000_000 }),
    ];
    const first = rankSubstitutes(profileOf(shortlist), candidates, 10).map(s => s.listingId);
    const second = rankSubstitutes(profileOf(shortlist), [...candidates].reverse(), 10).map(s => s.listingId);
    expect(first).toEqual(second);
  });

  it('explains itself', () => {
    const subs = rankSubstitutes(profileOf(shortlist), [listing({ id: 'c1', price_vnd: 14_000_000 })]);
    expect(subs[0].reasons).toContain('same district (HCM-D2)');
    expect(subs[0].reasons).toContain('2 bed, as shortlisted');
    expect(subs[0].reasons).toContain('same price or cheaper');
  });

  it('returns nothing rather than something bad when nothing fits', () => {
    // An empty result is honest. renderNoSupply already handles it by promising
    // a human follow-up instead of listing irrelevant flats.
    const subs = rankSubstitutes(profileOf(shortlist), [
      listing({ id: 'c1', price_vnd: 60_000_000 }),
      listing({ id: 'c2', is_active: false }),
    ]);
    expect(subs).toEqual([]);
  });
});

describe('handing them to the renderer', () => {
  it('drops the scoring, which is ours and not the renter\'s business', () => {
    const subs = rankSubstitutes(profileOf(shortlist), [listing({ id: 'c1' })]);
    const rendered = toRenderable(subs);
    expect(rendered[0]).toEqual({ title: 'A flat', priceVnd: 15_000_000, districtCode: 'HCM-D2' });
    expect(Object.keys(rendered[0])).not.toContain('score');
  });
});
