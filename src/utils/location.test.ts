import { describe, expect, it } from 'vitest';
import { translateLocationToEnglish } from './locationTranslation';
import { districtCentre } from './geocoding';

describe('translateLocationToEnglish', () => {
  it('labels administrative divisions in English', () => {
    expect(translateLocationToEnglish('Phường Tân Định, Quận 1, Hồ Chí Minh'))
      .toBe('Ward Tan Dinh, District 1, Ho Chi Minh City');
    expect(translateLocationToEnglish('Phường 10 Quận 3'))
      .toBe('Ward 10 District 3');
  });

  it('leaves Huyện, Quận and directions alone inside a street name', () => {
    expect(translateLocationToEnglish('Bà Huyện Thanh Quan, Quận 3'))
      .toBe('Ba Huyen Thanh Quan, District 3');
    expect(translateLocationToEnglish('Đường Nam Kỳ Khởi Nghĩa, Quận 3'))
      .toBe('Street Nam Ky Khoi Nghia, District 3');
  });
});

describe('districtCentre', () => {
  const district1 = districtCentre('District 1, Ho Chi Minh City');

  it('places a numbered district', () => {
    expect(district1).not.toBeNull();
    expect(district1!.lat).toBeGreaterThan(10.75);
    expect(district1!.lat).toBeLessThan(10.80);
    expect(district1!.lng).toBeGreaterThan(106.68);
    expect(district1!.lng).toBeLessThan(106.72);
  });

  it('places an address whose street came back garbled', () => {
    expect(districtCentre('District Quang Street, Tan Dinh Ward, District 1, Ho Chi Minh City'))
      .toEqual(district1);
  });

  it('does not read District 10 as District 1', () => {
    expect(districtCentre('Ward 12, District 10, Ho Chi Minh City')).not.toEqual(district1);
  });

  it('reads Vietnamese and abbreviated district names', () => {
    expect(districtCentre('Quận 1, Hồ Chí Minh')).toEqual(district1);
    expect(districtCentre('Le Thanh Ton, D1')).toEqual(district1);
    expect(districtCentre('Phan Xich Long, Ward 2, District Phú Nhuận'))
      .toEqual(districtCentre('Phu Nhuan'));
  });

  it('sends Districts 2 and 9 to Thu Duc', () => {
    expect(districtCentre('Thao Dien, District 2')).toEqual(districtCentre('Thu Duc'));
  });

  it('gives up on a place it has no outline for', () => {
    expect(districtCentre('Son Tra, Da Nang')).toBeNull();
  });
});
