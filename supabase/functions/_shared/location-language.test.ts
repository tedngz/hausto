import { describe, expect, it } from 'vitest';
import { normalizeLocationForEnglishDisplay } from './location-language.ts';

describe('normalizeLocationForEnglishDisplay', () => {
  it('labels administrative divisions in English', () => {
    expect(normalizeLocationForEnglishDisplay('Phường Tân Định, Quận 1, Thành phố Hồ Chí Minh'))
      .toBe('Ward Tan Dinh, District 1, Ho Chi Minh City');
    expect(normalizeLocationForEnglishDisplay('Xã Phước Kiển, Huyện Nhà Bè, Hồ Chí Minh'))
      .toBe('Commune Phuoc Kien, District Nha Be, Ho Chi Minh City');
  });

  it('labels a district that follows a ward number with no comma', () => {
    expect(normalizeLocationForEnglishDisplay('Phường 10 Quận 3, Hồ Chí Minh'))
      .toBe('Ward 10 District 3, Ho Chi Minh City');
  });

  it('leaves Huyện and Quận alone inside a street name', () => {
    expect(normalizeLocationForEnglishDisplay('Đường Bà Huyện Thanh Quan, Quận 3, Hồ Chí Minh'))
      .toBe('Duong Ba Huyen Thanh Quan, District 3, Ho Chi Minh City');
    expect(normalizeLocationForEnglishDisplay('Bà Huyện Thanh Quan, Phường Võ Thị Sáu, Quận 3'))
      .toBe('Ba Huyen Thanh Quan, Ward Vo Thi Sau, District 3');
  });

  it('does not read a street segment that opens with Huyện as a district', () => {
    expect(normalizeLocationForEnglishDisplay('Huyện Quang Street, Tan Dinh Ward, District 1'))
      .toBe('Huyen Quang Street, Tan Dinh Ward, District 1');
  });

  it('leaves an English address unchanged', () => {
    const s = 'Huyen Quang Street, Tan Dinh Ward, District 1, Ho Chi Minh City';
    expect(normalizeLocationForEnglishDisplay(s)).toBe(s);
  });
});
