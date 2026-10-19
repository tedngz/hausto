import { describe, expect, it } from 'vitest';
import { getNormalizedAmenities, normalizeAmenity } from './amenities';

const labels = (raw: string[], limit?: number) => getNormalizedAmenities(raw, limit).map(a => a.label);

describe('normalizeAmenity', () => {
  it('never reads a bed as a pet bed', () => {
    expect(normalizeAmenity('bed')).toBe('Bed');
    expect(normalizeAmenity('Bedding')).toBe('Bedding');
    expect(labels(['bed', 'bedding', 'Bed'])).not.toContain('Pet Friendly');
  });

  it('prefers the longest key a name contains', () => {
    expect(normalizeAmenity('coffee table')).toBe('Coffee Table');
    expect(normalizeAmenity('dining table')).toBe('Dining Table');
    expect(normalizeAmenity('Bedside table')).toBe('Table');
  });

  it('matches whole words only', () => {
    // "cctv" contains "tv", "bedside" contains "bed"
    expect(normalizeAmenity('CCTV')).toBe('CCTV');
    expect(normalizeAmenity('Bedside lamp')).toBe('Bedside lamp');
  });

  it('folds the spellings the crawler hands over', () => {
    expect(normalizeAmenity('Electric Stove')).toBe('Stove');
    expect(normalizeAmenity('Work Desk')).toBe('Desk');
    expect(normalizeAmenity('Car Parking')).toBe('Parking');
    expect(normalizeAmenity('Air conditioning')).toBe('Air Conditioning');
    expect(normalizeAmenity('Ceiling fans')).toBe('Ceiling Fan');
    expect(normalizeAmenity('large window')).toBe('Large Window');
  });

  it('still gives Pet Friendly to what says so', () => {
    expect(labels(['Pet Friendly'])).toEqual(['Pet Friendly']);
    expect(labels(['Pet Bed'])).toEqual(['Pet Friendly']);
  });
});

describe('getNormalizedAmenities', () => {
  // 4790edf3 (Masteri Thao Dien): the ad's list, then the photo analysis's.
  const masteri = [
    'Air Conditioning', 'Balcony', 'Electric Stove', 'Fridge', 'Microwave', 'TV', 'Wardrobe', 'Wood Floor',
    'Work Desk', 'BBQ Area', 'Car Parking', 'CCTV', 'Elevator', 'Pool', 'Gym', 'Sofa', 'Coffee table',
    'Television', 'Decorative rug', 'Curtains', 'sofa', 'dining table', 'bed', 'bedding',
  ];

  it("keeps the ad's own amenities ahead of the photos'", () => {
    expect(labels(masteri, 9)).toEqual([
      'AC', 'Balcony', 'Stove', 'Fridge', 'Microwave', 'TV', 'Wardrobe', 'Hardwood', 'Desk',
    ]);
  });

  it('folds spellings of one thing onto one entry', () => {
    const all = labels(masteri, 100);
    expect(all.filter(l => l === 'TV')).toHaveLength(1); // TV, Television
    expect(all.filter(l => l === 'Sofa')).toHaveLength(1); // Sofa, sofa
    expect(all).not.toContain('Pet Friendly');
  });
});
