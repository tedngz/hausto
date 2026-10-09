import { describe, it, expect } from 'vitest';
import { FakeDb } from './fake-db.ts';
import {
  areaLabel, areaLabelVi, districtCodeOf, districtLabel, districtLabelVi, isDistrictCode, placeOf,
  prioritySearchFromQuery, prioritySearchPath,
} from './place.ts';
import { CITY_DISTRICTS } from '../../../../src/utils/districts.ts';

// What vn_district_code() returns for Ho Chi Minh City
// (20260911130000_canonical_listing_fields.sql): the codes a search is matched on.
const SQL_CODES = new Set([
  'THU_DUC', 'BINH_THANH', 'GO_VAP', 'TAN_BINH', 'TAN_PHU', 'PHU_NHUAN', 'BINH_TAN', 'NHA_BE',
  'BINH_CHANH', 'HOC_MON', 'CU_CHI', 'CAN_GIO',
  ...Array.from({ length: 12 }, (_, i) => `D${i + 1}`),
]);

describe('district names and codes', () => {
  it('names a code the way the renter app does', () => {
    expect(districtLabel('D2')).toBe('District 2');
    expect(districtLabel('D10')).toBe('District 10');
    expect(districtLabel('BINH_THANH')).toBe('Binh Thanh');
  });

  it('turns every district the renter app offers into a code the database files listings under, and back', () => {
    for (const name of CITY_DISTRICTS.hcmc) {
      const code = districtCodeOf(name);
      expect(code, name).not.toBeNull();
      expect(SQL_CODES.has(code!), `${name} -> ${code}`).toBe(true);
      expect(districtLabel(code!)).toBe(name);
    }
  });

  it('refuses what is not a district', () => {
    expect(districtCodeOf('Bình Thạnh')).toBeNull();
    expect(districtCodeOf("D2'; drop")).toBeNull();
    expect(isDistrictCode('d2')).toBe(false);
  });

  it('joins an area the way a sentence does', () => {
    expect(areaLabel(['D2'])).toBe('District 2');
    expect(areaLabel(['D2', 'BINH_THANH', 'D2'])).toBe('District 2 and Binh Thanh');
    expect(areaLabel(['D2', 'BINH_THANH', 'D7'])).toBe('District 2, Binh Thanh and District 7');
  });

  it('writes it for an agent in Vietnamese', () => {
    expect(districtLabelVi('D7')).toBe('Quận 7');
    expect(districtLabelVi('PHU_NHUAN')).toBe('Phú Nhuận');
    expect(areaLabelVi(['D2', 'BINH_THANH', 'D7'])).toBe('Quận 2, Bình Thạnh và Quận 7');
  });
});

describe('placeOf', () => {
  const db = new FakeDb();
  db.tables.complexes = [{ id: 'cx-1', name: 'Empire City', district: 'Thu Duc', city: 'ho_chi_minh', slug: 'empire-city' }];

  it('reads a building from its complex', async () => {
    // deno-lint-ignore no-explicit-any
    expect(await placeOf(db as any, { complex_id: 'cx-1' })).toMatchObject({
      kind: 'BUILDING', name: 'Empire City', district: 'Thu Duc', complexId: 'cx-1', districtCodes: [], slug: 'empire-city',
    });
  });

  it('reads an area from its own row - it has no complex', async () => {
    // deno-lint-ignore no-explicit-any
    expect(await placeOf(db as any, { complex_id: null, area_district_codes: ['D2', 'BINH_THANH'], area_label: 'District 2 and Binh Thanh' }))
      .toMatchObject({ kind: 'AREA', name: 'District 2 and Binh Thanh', complexId: null, districtCodes: ['D2', 'BINH_THANH'], city: 'ho_chi_minh' });
  });

  it('is nothing for a building that is gone, or an area with no districts', async () => {
    // deno-lint-ignore no-explicit-any
    expect(await placeOf(db as any, { complex_id: 'cx-gone' })).toBeNull();
    // deno-lint-ignore no-explicit-any
    expect(await placeOf(db as any, { complex_id: null, area_district_codes: [], area_label: 'x' })).toBeNull();
  });
});

describe('the Priority search link', () => {
  it('reads back what it carries, as the form takes it', () => {
    const path = prioritySearchPath({ districtCodes: ['D7', 'TAN_PHU', 'D7'], bedrooms: 2, budgetMaxVnd: 17_000_000 });
    expect(path).toBe('/hub?priority=D7,TAN_PHU&beds=2&max=17000000');
    const back = prioritySearchFromQuery(new URL(`https://hausto.com${path}`).searchParams);
    expect(back).toEqual({ districts: ['District 7', 'Tan Phu'], bedrooms: 2, budgetMaxVnd: 17_000_000 });
    // The names the form keeps are the ones it can turn back into codes.
    expect(back!.districts.map(districtCodeOf)).toEqual(['D7', 'TAN_PHU']);
  });

  it('caps the districts at what a search may name, and drops what is not a code', () => {
    const path = prioritySearchPath({ districtCodes: ['D1', 'D2', 'D3', 'D4', 'D5', 'nope'], bedrooms: 0, budgetMaxVnd: null });
    expect(path).toBe('/hub?priority=D1,D2,D3,D4');
    expect(prioritySearchFromQuery(new URLSearchParams('priority=D1,<script>&beds=abc&max=-5')))
      .toEqual({ districts: ['District 1'], bedrooms: null, budgetMaxVnd: null });
  });

  it('is null without the parameter', () => {
    expect(prioritySearchFromQuery(new URLSearchParams('tab=viewings'))).toBeNull();
  });
});
