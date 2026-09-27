import { describe, it, expect } from 'vitest';
import { describedPrice, rentMentionsVnd } from './price-mentions.ts';

const M = 1_000_000;
const sorted = (text: string) => rentMentionsVnd(text).sort((a, b) => a - b);

describe('rents quoted in Vietnamese', () => {
  it.each([
    ['Cho thuê căn hộ 2PN Vinhomes giá 16 triệu/tháng', [16 * M]],
    ['Giá 16tr', [16 * M]],
    ['Giá thuê 16tr5', [16.5 * M]],
    ['Giá 16,5 triệu', [16.5 * M]],
    ['Diện tích 80m2 giá 16 triệu', [16 * M]],
    ['Giá: 16.000.000đ/tháng', [16 * M]],
    ['Cho người nước ngoài thuê 15tr', [15 * M]],
    ['1PN 8tr, 2PN 12tr', [8 * M, 12 * M]],
    ['Giá 12 - 15 triệu tùy căn', [12 * M, 15 * M]],
    ['12-15tr', [12 * M, 15 * M]],
  ])('%s', (text, want) => {
    expect(sorted(text)).toEqual(want);
  });
});

describe('rents quoted in English', () => {
  it.each([
    ['Modern 2BR in Thao Dien - 16M VND/month', [16 * M]],
    ['Rent is 16.5 million VND per month', [16.5 * M]],
    ['16 millions VND', [16 * M]],
    ['16,000,000 VND per month', [16 * M]],
    ['VND 16,000,000', [16 * M]],
    ['Rent: $730 / month', [18_250_000]],
    ['$1,200 per month', [30 * M]],
    ['US$ 1.200 monthly', [30 * M]],
    ['700 USD a month', [17.5 * M]],
    ['$700-800/month', [17.5 * M, 20 * M]],
  ])('%s', (text, want) => {
    expect(sorted(text)).toEqual(want);
  });
});

describe('what is not the rent', () => {
  // Each of these, read as a rent, would flag a real listing.
  it.each([
    ['a deposit', 'Cọc 32tr'],
    ['a deposit in English', 'Deposit 32 million VND'],
    ['a fee', 'Phí quản lý 3 triệu'],
    ['a service charge', 'Cleaning service 2 million VND per month'],
    ['utilities', 'Tiền điện nước khoảng 2tr'],
    ['parking', 'Parking 3 million VND/month'],
    ['a discount', 'Giảm 3tr cho hợp đồng 1 năm'],
    ['a starting price', 'Căn hộ chỉ từ 6,5 triệu'],
    ['a floor in English', 'Units from 12 million VND'],
    ['a ceiling', 'Under 20 million VND'],
    ['a nightly rate', 'Short stay 1.2 triệu/đêm'],
    ['a yearly rate', 'Giá 180 triệu/năm'],
    ['a price per square metre', 'Giá 400k/m2'],
    ['a sale', 'Bán căn hộ giá 4,5 tỷ'],
    ['floor area', 'Spacious 82m2 apartment'],
    ['a frontage', 'House with 16m frontage'],
    ['a phone number', 'Liên hệ 0901 234 567 giá tốt'],
    ['an unspaced phone number', 'Giá tốt, gọi 0901234567'],
    ['a bare long number', 'Mã tin 16000000'],
    ['a figure too small to be a rent', 'Giá 1,5 triệu'],
  ])('%s: %s', (_why, text) => {
    expect(rentMentionsVnd(text)).toEqual([]);
  });

  it('keeps the rent when the deposit is in the next clause', () => {
    expect(rentMentionsVnd('Giá 16tr - Cọc 32tr')).toEqual([16 * M]);
    expect(rentMentionsVnd('Rent 16 million, deposit 32 million')).toEqual([16 * M]);
    expect(rentMentionsVnd('Giá thuê 16tr5, cọc 2 tháng')).toEqual([16.5 * M]);
    expect(rentMentionsVnd('Rent 16,5 triệu. Phí quản lý 1 triệu')).toEqual([16.5 * M]);
  });
});

describe('describedPrice', () => {
  it('spans title and description', () => {
    expect(describedPrice('2PN giá 12tr', 'Căn 3PN 18 triệu.')).toEqual({ min_vnd: 12 * M, max_vnd: 18 * M });
  });

  it('is null when neither quotes a rent', () => {
    expect(describedPrice('Bright 2BR', 'Great view, near the river.')).toBeNull();
    expect(describedPrice(null, null)).toBeNull();
  });
});
