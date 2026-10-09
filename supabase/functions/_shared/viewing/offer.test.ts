import { describe, it, expect } from 'vitest';
import {
  offerLink, renderOffer, renderOfferSections, unitPhotoPath, unitRow, unitStale, validateUnit, UNIT_FRESH_DAYS, type UnitInput,
  briefOf, misfit, priceCeiling, validateBriefChange,
} from './offer.ts';

const INQ = '11111111-2222-4333-8444-555555555555';
const AGENT = '99999999-2222-4333-8444-555555555555';
const PHOTO = `https://gbgrwjdmytaksrztcyzs.supabase.co${unitPhotoPath(INQ)}a.jpg`;
const unit = { realtorId: AGENT, bedrooms: 2, areaSqm: 80, priceVnd: 24_000_000 };

describe('what an operator may capture', () => {
  it('takes what intake needs, and the extras renters ask about', () => {
    const r = validateUnit({ ...unit, floor: '18', tower: 'Tower Linden', furnishing: 'full', petsOk: true, availableFrom: '2026-11-15', photos: [PHOTO] }, unitPhotoPath(INQ));
    expect(r.ok && r.value).toMatchObject({ bedrooms: 2, priceVnd: 24_000_000, furnishing: 'FULL', petsOk: true, photos: [PHOTO] });
  });

  it('refuses what intake would refuse', () => {
    expect(validateUnit({ ...unit, bedrooms: 0 }, unitPhotoPath(INQ)).ok).toBe(false);
    expect(validateUnit({ ...unit, areaSqm: 8 }, unitPhotoPath(INQ)).ok).toBe(false);
    expect(validateUnit({ ...unit, priceVnd: 24 }, unitPhotoPath(INQ)).ok).toBe(false);
    expect(validateUnit({ ...unit, realtorId: 'Harry' }, unitPhotoPath(INQ)).ok).toBe(false);
  });

  it('only takes photos uploaded for this request - renters see them', () => {
    expect(validateUnit({ ...unit, photos: ['https://evil.example/a.jpg'] }, unitPhotoPath(INQ)).ok).toBe(false);
    const other = `https://x.supabase.co${unitPhotoPath('22222222-2222-4333-8444-555555555555')}a.jpg`;
    expect(validateUnit({ ...unit, photos: [other] }, unitPhotoPath(INQ)).ok).toBe(false);
  });
});

describe('the listing row', () => {
  const value = validateUnit({ ...unit, floor: '18', furnishing: 'FULL', availableFrom: '2026-11-15' }, unitPhotoPath(INQ));
  const row = unitRow({
    id: 'u-1', inquiryId: INQ, complex: { name: 'Empire City', district: 'Thu Duc', city: 'ho_chi_minh' },
    unit: (value as { ok: true; value: UnitInput }).value, now: new Date('2026-09-29T03:00:00Z'),
  });

  it('is written raw, in the shapes the canonical trigger parses', () => {
    expect(row).toMatchObject({
      source: 'concierge', rooms: '2 Bedrooms', size: '80 m²', location: 'Empire City, Thu Duc',
      city: 'ho_chi_minh', price: 24_000_000, is_active: true, raw_only: false, realtor_id: AGENT,
    });
    expect(row.external_id).toBe(`concierge:${INQ}:u-1`);
  });

  it('carries no agent contact - renters are served this row (invariant 4)', () => {
    expect(row).not.toHaveProperty('contact_phone');
    expect(row).not.toHaveProperty('contact_name');
    expect(JSON.stringify(row)).not.toContain('+849');
  });

  it('reads well as a listing, and says it was confirmed', () => {
    expect(row.title).toBe('2BR at Empire City, floor 18, furnished');
    expect(row.description).toContain('Available from 15 Nov.');
    // en-GB writes September as Sept in current ICU.
    expect(row.description).toMatch(/Confirmed available on 29 Sept?./);
    expect(String(row.description)).not.toMatch(/[—–]/);
  });

  it('writes 4+ the way the parser reads a minimum', () => {
    const big = unitRow({
      id: 'u-2', inquiryId: INQ, complex: { name: 'Empire City', district: 'Thu Duc', city: 'ho_chi_minh' },
      unit: { ...(value as { ok: true; value: UnitInput }).value, bedrooms: 4 }, now: new Date(),
    });
    expect(big.rooms).toBe('4+ Bedrooms');
  });
});

describe('the offer message', () => {
  const body = renderOffer({
    firstName: 'Mai', complexName: 'Empire City', inquiryId: INQ, now: new Date('2026-09-29T09:00:00Z'),
    message: 'The first is the one I would see.',
    units: [
      { id: 'u-1', title: '2BR at Empire City, floor 18, furnished', priceVnd: 24_000_000, bedrooms: 2, areaSqm: 80, confirmedAt: '2026-09-29T03:00:00Z' },
      { id: 'l-9', title: 'Sunny 2BR, Empire City tower 2', priceVnd: 22_500_000, bedrooms: 2, areaSqm: 75, confirmedAt: null },
    ],
  });

  it('greets them, numbers the units, and links each back to the request', () => {
    expect(body.startsWith('Hi Mai, here is what we found at Empire City:')).toBe(true);
    expect(body).toContain('1. 2BR at Empire City, floor 18, furnished');
    // The title leads with 2BR, so the facts line does not repeat it...
    expect(body).toContain('\n24.000.000 ₫ a month · 80 m²');
    // ...but an advertised title that does not say gets it.
    expect(body).toContain('2BR · 22.500.000 ₫ a month · 75 m²');
    expect(body).toContain(offerLink('u-1', INQ));
    expect(offerLink('u-1', INQ)).toBe(`https://hausto.com/property/u-1?inq=${INQ}`);
    expect(body).toContain('The first is the one I would see.');
  });

  it('is honest about which are confirmed and which only advertised', () => {
    expect(body).toMatch(/The agent confirmed it is free on 29 Sept?./);
    expect(body).toContain('Advertised - we confirm with the agent when you ask to see it.');
  });

  it('ends by inviting a reply, and books nothing', () => {
    expect(body).toMatch(/reply here with a question\.$/);
    expect(body).not.toMatch(/\bbook(ed|ing)?\b/i);
    expect(body).not.toMatch(/[—–]/);
  });
});

describe('the offer for a Priority search', () => {
  const units = [
    { id: 'u-1', title: '2BR at Masteri Thao Dien, floor 12', priceVnd: 24_000_000, bedrooms: 2, areaSqm: 80, confirmedAt: '2026-10-06T06:00:00Z' },
  ];
  const now = new Date('2026-10-06T08:00:00Z');

  it('says where it looked, and that the Pass covers the viewings', () => {
    const body = renderOfferSections({
      firstName: 'Mai', now, sections: [{ complexName: 'District 2 and Binh Thanh', inquiryId: INQ, units, kind: 'AREA' }],
    });
    expect(body.startsWith('Hi Mai, here is what we found in District 2 and Binh Thanh:')).toBe(true);
    expect(body).toContain('your Pass covers the viewings');
    expect(body).not.toContain('first viewing is free');
  });

  it('heads each part by where, and keeps the free viewing when a building is in it too', () => {
    const body = renderOfferSections({
      firstName: 'Mai', now, sections: [
        { complexName: 'Empire City', inquiryId: INQ, units, kind: 'BUILDING' },
        { complexName: 'District 2', inquiryId: '22222222-2222-4333-8444-555555555555', units: [{ ...units[0], id: 'u-2' }], kind: 'AREA' },
      ],
    });
    expect(body).toContain('\n\nAt Empire City:\n\n');
    expect(body).toContain('\n\nIn District 2:\n\n');
    expect(body).toContain('your first viewing is free');
  });

  it('says what is true for this renter when the sender knows - a building is the Pass\'s since 2026-10-07', () => {
    const building = { complexName: 'Empire City', inquiryId: INQ, units, kind: 'BUILDING' as const };
    const withPass = renderOfferSections({ firstName: 'Mai', now, sections: [building], hasPass: true });
    expect(withPass).toContain('your Pass covers the viewings');
    expect(withPass).not.toContain('first viewing is free');
    const lapsed = renderOfferSections({
      firstName: 'Mai', now, hasPass: false,
      sections: [{ complexName: 'District 2', inquiryId: INQ, units, kind: 'AREA' }],
    });
    expect(lapsed).toContain('your first viewing is free');
  });
});

it(`calls a unit stale ${UNIT_FRESH_DAYS} days after its agent last confirmed it`, () => {
  const now = new Date('2026-10-20T00:00:00Z');
  expect(unitStale('2026-10-10T00:00:00Z', now)).toBe(false);
  expect(unitStale('2026-10-01T00:00:00Z', now)).toBe(true);
  expect(unitStale(null, now)).toBe(true);
});

describe('what may be offered', () => {
  const form = { bedrooms: 2, budgetMaxVnd: 20_000_000 };

  it('is the form until the renter changes it', () => {
    expect(briefOf(form, null)).toEqual({ bedrooms: [2], budgetMaxVnd: 20_000_000 });
    expect(briefOf({ bedrooms: 5, budgetMaxVnd: null }, null)).toEqual({ bedrooms: [4], budgetMaxVnd: null });
    expect(briefOf(form, { bedrooms: [2, 3], budgetMaxVnd: null })).toEqual({ bedrooms: [2, 3], budgetMaxVnd: null });
  });

  it('refuses other bedroom counts, and more than 10% over budget', () => {
    const brief = briefOf(form, null);
    expect(misfit({ bedrooms: 2, priceVnd: 20_000_000 }, brief)).toBeNull();
    expect(misfit({ bedrooms: 2, priceVnd: 22_000_000 }, brief)).toBeNull();
    expect(misfit({ bedrooms: 2, priceVnd: 22_000_001 }, brief)).toBe('22.000.001 ₫ - over their 20.000.000 ₫ budget');
    expect(misfit({ bedrooms: 3, priceVnd: 18_000_000 }, brief)).toBe('3BR - they asked for 2 bedrooms');
    expect(misfit({ bedrooms: 1, priceVnd: 18_000_000 }, brief)).not.toBeNull();
  });

  it('counts five bedrooms as four-plus', () => {
    expect(misfit({ bedrooms: 5, priceVnd: 90_000_000 }, { bedrooms: [4], budgetMaxVnd: null })).toBeNull();
    expect(misfit({ bedrooms: 5, priceVnd: 1 }, { bedrooms: [3], budgetMaxVnd: null })).toBe('4+BR - they asked for 3 bedrooms');
  });

  it('validates a change as the renter put it', () => {
    const current = briefOf(form, null);
    expect(validateBriefChange({ bedrooms: [3, 2] }, current)).toEqual({ ok: true, value: { bedrooms: [2, 3], budgetMaxVnd: 20_000_000 } });
    expect(validateBriefChange({ budgetMaxVnd: null }, current)).toEqual({ ok: true, value: { bedrooms: [2], budgetMaxVnd: null } });
    expect(validateBriefChange({ budgetMaxVnd: 25_000_000 }, current)).toMatchObject({ ok: true });
    expect(validateBriefChange({ bedrooms: [] }, current).ok).toBe(false);
    expect(validateBriefChange({ bedrooms: [7] }, current).ok).toBe(false);
    expect(validateBriefChange({ budgetMaxVnd: 12.5 }, current).ok).toBe(false);
    expect(validateBriefChange({ bedrooms: [2], budgetMaxVnd: 20_000_000 }, current)).toEqual({
      ok: false, error: 'That is what they asked for already.',
    });
    expect(priceCeiling(current)).toBe(22_000_000);
  });
});
