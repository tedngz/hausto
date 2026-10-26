import { describe, it, expect } from 'vitest';
import {
  askAgentVi, depositFromField, describeTerms, mergeTerms, petsFromField, readTermsFromText,
  termsColumns, termsForPrompt, termsFromModel, termsFromRow, unknownTerms, NO_TERMS,
} from './lease-terms.ts';
import { jhouseTerms } from './jhouse.ts';
import { rentapartmentTerms } from './rentapartment.ts';
import { vnrenthomeTerms } from './vnrenthome.ts';
import { nhatotTerms } from './nhatot.ts';

const NOW = new Date('2026-10-26T08:00:00Z');
const read = (text: string) => readTermsFromText(text, NOW);

// Phrasings taken from the sources' own listings, 2026-10-26.
describe('deposit', () => {
  it.each([
    ['Giá thuê: 16tr5/th, hợp đồng 2 năm giá 16tr, cọc 2 tháng', [2, 2]],
    ['Gía : 7.5tr/tháng. cọc 2 tháng.', [2, 2]],
    ['( hợp đồng 01 năm, coc 02 tháng và thanh toán hàng tháng )', [2, 2]],
    ['Đặt cọc 1,5 tháng', [1.5, 1.5]],
    ['Cọc 1-2 tháng tùy căn', null],
    ['Cọc 1 đóng 3', [1, 1]],
    ['Deposit: 2 months', [2, 2]],
    ['Deposit is 1.5 months', [1.5, 1.5]],
    ['Two months deposit required', [2, 2]],
    ['A 2-month security deposit', [2, 2]],
    ['Deposit 1-2 months', [1, 2]],
  ])('%s', (text, want) => {
    const t = read(text);
    expect(t.depositMonthsMin === null ? null : [t.depositMonthsMin, t.depositMonthsMax]).toEqual(want);
  });

  it.each([
    'Cọc 30 triệu',               // an amount, not months
    'Deposit 20,000,000 VND',
    'Deposit negotiable, about 2 months',
    'Cọc 12 tháng',               // out of range: a misread
  ])('reads nothing from %s', (text) => {
    expect(read(text).depositMonthsMin).toBeNull();
  });

  it.each([
    ['2', [2, 2]], ['1.5', [1.5, 1.5]], ['1-2', [1, 2]], ['1 month', [1, 1]], ['2 months', [2, 2]], ['1 months', [1, 1]],
    ['', null], ['12', null], ['ask', null],
  ])('a deposit field of %j', (raw, want) => {
    expect(depositFromField(raw)).toEqual(want);
  });
});

describe('minimum lease', () => {
  it.each([
    ['Minimum lease: 12 months', 12],
    ['Minimum lease:\n12 months', 12],
    ['Minimum lease term is 12 months.', 12],
    ['Minimum lease is 12 months, standard for HCMC.', 12],
    ['Min. lease 6 months', 6],
    ['Lease term: minimum 1 year', 12],
    ['6-month minimum', 6],
    ['Nhà trống, ưu tiên vào liền, hợp đồng ít nhất 1 năm', 12],
    ['Thuê tối thiểu 6 tháng', 6],
    ['HĐ tối thiểu 1 năm', 12],
    ['Thuê từ 6 tháng trở lên', 6],
  ])('%s', (text, want) => {
    expect(read(text).minLeaseMonths).toBe(want);
  });

  it.each([
    'Hợp đồng 2 năm giá 16tr',    // a discount for a longer contract, not a minimum
    'Full NT, cho thuê hđ 1 năm',
    'Long-term lease available',
    'Minimum lease is flexible, depending on the owner: 6 or 12 months',
  ])('reads nothing from %s', (text) => {
    expect(read(text).minLeaseMonths).toBeNull();
  });
});

describe('pets', () => {
  it.each([
    ['No pets', false],
    ['Pets are not allowed', false],
    ['Không cho nuôi thú cưng', false],
    ['Không nuôi thú cưng', false],
    ['Cho phép nuôi thú cưng', true],
    ['- Pet-friendly building', true],
    ['Pets allowed', true],
    ['Note: Staircase building, pet-friendly, electricity at government rates', true],
  ])('%s', (text, want) => {
    expect(read(text).petsAllowed).toBe(want);
  });

  it.each([
    'Pets are subject to building approval.',
    'Pets are allowed but subject to building approval, so confirm that directly.',
    'Pet policy varies, so mention any pets when you contact me.',
    'Pets under 5kg are welcome',
    'The building is pet-friendly with advance notice',
    'Pets: Check with building management; some restrictions typically apply',
    'Cho nuôi thú cưng nhỏ',
    'Carpet floors and a competitive price',     // "pet" inside other words
  ])('reads nothing from %s', (text) => {
    expect(read(text).petsAllowed).toBeNull();
  });

  it('reads a pet-policy field as the sentence it is', () => {
    expect(petsFromField('Không cho nuôi thú cưng')).toBe(false);
    expect(petsFromField('Cho phép nuôi thú cưng')).toBe(true);
    expect(petsFromField(null)).toBeNull();
  });
});

describe('availability', () => {
  it.each([
    ['Available:\nImmediately', 'AVAILABLE_NOW', null],
    ['The apartment is available immediately.', 'AVAILABLE_NOW', null],
    ['Máy giặt riêng – sẵn sàng dọn vào ở ngay!', 'AVAILABLE_NOW', null],
    ['Nhà mới vào ở được liền', 'AVAILABLE_NOW', null],
    ['Available from 15/11/2026', 'AVAILABLE_SOON', '2026-11-15'],
    ['Available from 1 December', 'AVAILABLE_SOON', '2026-12-01'],
    ['Available from November 20th', 'AVAILABLE_SOON', '2026-11-20'],
    ['Trống từ ngày 5/11', 'AVAILABLE_SOON', '2026-11-05'],
    // A date already past is free now: the ad was written before it.
    ['Available from 1/10', 'AVAILABLE_NOW', null],
  ])('%s', (text, availability, from) => {
    const t = read(text);
    expect([t.availability, t.availableFrom]).toEqual([availability, from]);
  });

  it.each([
    'Check Availability',
    'Chỉ việc xách vali vào ở',
    'Nằm ngay trung tâm, ở ngay cạnh chợ',
    'Cho thuê full nội thất hoặc nhà trống',  // "nhà trống" is unfurnished, not vacant
    'Available Layouts',
  ])('reads nothing from %s', (text) => {
    expect(read(text).availability).toBeNull();
  });
});

describe('fees', () => {
  const fees = (text: string) => read(text).fees.map((f) => [f.label, f.included, f.amount]);

  it('reads an agency fee list line by line', () => {
    expect(fees('Services:\n- Electricity: 3,900 vnd/kWh\n- Water: 100,000 vnd/person/month\n- Management fee: 200,000 vnd/room\n- Free 2 motorbikes')).toEqual([
      ['Electricity', false, '3,900 VND/kWh'],
      ['Water', false, '100,000 VND/person/month'],
      ['Management fee', false, '200,000 VND/room'],
      ['Motorbike parking', true, null],
    ]);
  });

  it('keeps a price in brackets with its fee', () => {
    expect(fees('Monthly pay: electricity (4000 vnd/kwh), water usage (150,000 vnd/person), management fee 200,000 vnd/room.')).toEqual([
      ['Electricity', false, '4000 VND/kWh'],
      ['Water', false, '150,000 VND/person'],
      ['Management fee', false, '200,000 VND/room'],
    ]);
  });

  it('reads what a management fee covers as the fee\'s, not the rent\'s', () => {
    expect(fees('- Management fee (includes trash, wifi, motorbike parking, cleaning 2times/week): 200,000 vnd/month')).toEqual([
      ['Management fee', false, '200,000 VND/month'],
    ]);
    expect(fees('Management fee: 200,000 vnd/month; it covers wifi and trash collection, room cleaning 2-time/week.')).toEqual([
      ['Management fee', false, '200,000 VND/month'],
    ]);
  });

  it('reads what the rent includes, up to "except"', () => {
    expect(fees('The rental price includes: management fee, garbage, internet, cleaning the room 2 time/week')).toEqual([
      ['Management fee', true, null],
      ['Internet', true, null],
      ['Cleaning', true, null],
    ]);
    expect(fees('All utilities are included in the monthly rent payment, except for electricity, which is free up to 300 kWh first, then 4,500 vnd/kWh.')).toEqual([
      ['Utilities', true, null],
      ['Electricity', false, null],
    ]);
  });

  it('shares a government rate across a pair', () => {
    expect(fees('Điện nước giá nhà nước')).toEqual([
      ['Electricity', false, 'government rate'],
      ['Water', false, 'government rate'],
    ]);
    expect(fees('Electricity at government rates')).toEqual([['Electricity', false, 'government rate']]);
  });

  it('reads Vietnamese shorthand prices', () => {
    expect(fees('- Phí xe hơi: 1tr650 /tháng.\n- Phí xe máy: 200.000đ/tháng.')).toEqual([
      ['Car parking', false, '1,650,000 VND/month'],
      ['Motorbike parking', false, '200,000 VND/month'],
    ]);
    expect(fees('Giá thuê: 16triệu/tháng ( Bao phí QL).')).toEqual([['Management fee', true, null]]);
    expect(fees('Điện 4k/số, nước 100k/người')).toEqual([
      ['Electricity', false, '4,000 VND/kWh'],
      ['Water', false, '100,000 VND/person'],
    ]);
  });

  it.each([
    'Khu vực an ninh, yên tĩnh, có bảo vệ/giữ xe đầy đủ',            // a guard, not "covers"
    'Tiện ích miễn phí: Hồ bơi, phòng GYM và khu BBQ.',               // amenities, not utilities
    'Grand Marina Saigon includes standard luxury features: security 24/7, a gym, and parking.',
    'If you prefer, an all-in property management model with housekeeping included.',
    'Utilities and building fees are typically separate from rent and run approximately $200-300 monthly.',
    'Xe buýt điện nội khu miễn phí 5 phút một chuyến.',
    'Phù hợp người nước ngoài, có máy nước nóng',
    'Liên hệ điện thoại 0909 123 456',
    'Drinking water: 50,000 VND/19L bottle',
  ])('reads nothing from %s', (text) => {
    expect(read(text).fees).toEqual([]);
  });
});

describe('the sources\' own fields', () => {
  const unit = {
    status: 'upcoming',
    available_from: '2026-11-05',
    minimum_lease_months: 6,
    deposit_months: '1-2',
    pet_policy: 'Không cho nuôi thú cưng',
    included_services: ['Internet', 'Management fees', 'Motorbike parking', 'Room cleaning 1 time/week'],
    excluded_fees: [
      { label: 'Electricity fee', value: '4,000 VND/kWh' },
      { label: 'Running water fee', value: 'Government price' },
      { label: 'Service fee', value: null },
    ],
    description_en: '<p>Bright studio. Pets allowed.</p>',
  };

  it('jhouse: every term from the CRM, its fields over its description', () => {
    const t = jhouseTerms(unit, NOW);
    expect(t).toMatchObject({
      availability: 'AVAILABLE_SOON', availableFrom: '2026-11-05', minLeaseMonths: 6,
      depositMonthsMin: 1, depositMonthsMax: 2, petsAllowed: false,
    });
    expect(t.fees.map((f) => [f.kind, f.label, f.included, f.amount])).toEqual([
      ['INTERNET', 'Internet', true, null],
      ['MANAGEMENT', 'Management fees', true, null],
      ['PARKING', 'Motorbike parking', true, null],
      ['CLEANING', 'Room cleaning 1 time/week', true, null],
      ['ELECTRICITY', 'Electricity fee', false, '4,000 VND/kWh'],
      ['WATER', 'Running water fee', false, 'government rate'],
      ['SERVICE', 'Service fee', false, null],
    ]);
  });

  it('jhouse: an "upcoming" unit whose date has passed is soon, undated', () => {
    expect(jhouseTerms({ ...unit, available_from: '2026-10-01' }, NOW)).toMatchObject({ availability: 'AVAILABLE_SOON', availableFrom: null });
    expect(jhouseTerms({ ...unit, status: 'available', available_from: null }, NOW)).toMatchObject({ availability: 'AVAILABLE_NOW' });
  });

  it('rentapartment: the deposit field, the Pet Allowed tag, fees from the description', () => {
    const t = rentapartmentTerms({
      property_label: [50],
      property_feature: [15, 23],
      property_meta: { fave_property_garage_size: ['1.5 month'] },
      content: { rendered: '<ul><li>Electricity: 4,000 vnd/kWh</li><li>Free 1 bike</li></ul>' },
    }, NOW);
    expect(t).toMatchObject({ availability: 'AVAILABLE_NOW', depositMonthsMin: 1.5, depositMonthsMax: 1.5, petsAllowed: true, minLeaseMonths: null });
    expect(t.fees.map((f) => [f.label, f.included, f.amount])).toEqual([
      ['Electricity', false, '4,000 VND/kWh'],
      ['Motorbike parking', true, null],
    ]);
  });

  it('rentapartment: no tag says nothing about pets, and a dated description beats the label', () => {
    const t = rentapartmentTerms({
      property_label: [50], property_feature: [15], property_meta: {},
      content: { rendered: '<p>Available from 1 December.</p>' },
    }, NOW);
    expect(t).toMatchObject({ availability: 'AVAILABLE_SOON', availableFrom: '2026-12-01', petsAllowed: null, depositMonthsMin: null });
  });

  it('vnrenthome: the offer\'s availability, the rest from the closing lines', () => {
    expect(vnrenthomeTerms('AVAILABLE_NOW', 'Lovely flat.\nAvailable:\nImmediately\nMinimum lease:\n12 months\nPrice:\n$900 USD/month', NOW))
      .toMatchObject({ availability: 'AVAILABLE_NOW', minLeaseMonths: 12, petsAllowed: null, depositMonthsMin: null });
    expect(vnrenthomeTerms('UNCONFIRMED', 'Nice.', NOW).availability).toBeNull();
  });

  it('nhatot: the headline and the advert', () => {
    expect(nhatotTerms({ subject: 'Cho thuê 2PN Botanica', body: '- Giá thuê: 17tr/tháng, cọc 2 tháng\n- Nhà trống, ưu tiên vào liền, hợp đồng ít nhất 1 năm' }, NOW))
      .toMatchObject({ availability: 'AVAILABLE_NOW', depositMonthsMin: 2, minLeaseMonths: 12 });
  });
});

describe('what an extraction model read', () => {
  it('keeps what is in range and drops what is not', () => {
    expect(termsFromModel({
      available_from: '2026-12-01', min_lease_months: 12, deposit_months: [1, 2], pets: 'NOT_ALLOWED',
      fees: [{ name: 'Electricity', included: false, amount: 'Government price' }, { name: 'Management fee', included: true, amount: '200,000' }],
    }, NOW)).toEqual({
      availability: 'AVAILABLE_SOON', availableFrom: '2026-12-01', minLeaseMonths: 12,
      depositMonthsMin: 1, depositMonthsMax: 2, petsAllowed: false,
      fees: [
        { kind: 'ELECTRICITY', label: 'Electricity', included: false, amount: 'government rate' },
        { kind: 'MANAGEMENT', label: 'Management fee', included: true, amount: null },
      ],
    });
    expect(termsFromModel({ available_from: 'now', deposit_months: 30, min_lease_months: 0.5, pets: 'maybe' }, NOW))
      .toEqual({ ...NO_TERMS, availability: 'AVAILABLE_NOW', fees: [] });
    expect(termsFromModel(null, NOW)).toEqual({ ...NO_TERMS, fees: [] });
  });
});

describe('combining, storing and saying', () => {
  const stated = mergeTerms({ depositMonthsMin: 2, depositMonthsMax: 2, petsAllowed: false }, read('Minimum lease: 12 months. Pets allowed.'));

  it('typed fields win, text fills the gaps', () => {
    expect(stated).toMatchObject({ depositMonthsMin: 2, minLeaseMonths: 12, petsAllowed: false });
  });

  it('round-trips through the columns', () => {
    const row = termsColumns(stated, '2026-10-26T08:00:00.000Z');
    expect(row.fees).toBeNull();
    expect(termsFromRow(row)).toEqual({ ...stated, readAt: '2026-10-26T08:00:00.000Z' });
    expect(termsFromRow({ ...row, terms_read_at: null })).toBeNull();
  });

  it('says what is stated, and what is not', () => {
    const row = termsFromRow(termsColumns(stated, '2026-10-26T08:00:00.000Z'));
    expect(describeTerms(row)).toEqual(["deposit 2 months' rent", 'minimum lease 1 year', 'no pets']);
    expect(unknownTerms(row)).toEqual(['FEES']);
    expect(termsForPrompt(row)).toBe(
      "Terms the ad states (read 26 Oct 2026): deposit 2 months' rent; minimum lease 1 year; no pets. Not stated in the ad: fees and utilities.",
    );
    // A listing never read for terms: nothing is known, and nothing is claimed.
    expect(termsForPrompt(null)).toBe('Not stated in the ad: the deposit, the minimum lease, the pet policy, fees and utilities.');
  });

  it('asks the agent only what the ad left out', () => {
    expect(askAgentVi(['PETS'])).toBe('Anh/chị cho em hỏi thêm: có cho nuôi thú cưng không ạ?');
    expect(askAgentVi(['FEES', 'DEPOSIT'])).toBe('Anh/chị cho em hỏi thêm: cọc mấy tháng và phí quản lý, điện nước tính thế nào ạ?');
    expect(askAgentVi([])).toBeNull();
  });
});
