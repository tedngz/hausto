import { describe, it, expect } from 'vitest';
import {
  LABEL_AVAILABLE, LABEL_RENTED, buildRentapartmentListing, candidatesFromFeed,
  extractRentapartmentId, galleryIds, multiUnitPrices, rentapartmentFeedUrl,
  type RentapartmentRecord,
} from './rentapartment.ts';

// Shapes as /wp-json/wp/v2/properties returned them on 2026-10-14, trimmed to
// the fields the crawler asks for.
const XI_RIVERVIEW: RentapartmentRecord = {
  id: 34297,
  date_gmt: '2026-09-15T08:05:09',
  link: 'https://rentapartment.vn/indochine-3-bedroom-on-xi-riverview-palace-id-2247/',
  slug: 'indochine-3-bedroom-on-xi-riverview-palace-id-2247',
  title: { rendered: 'Indochine 3-Bedroom On XI Riverview Palace &#8211; ID: 2247' },
  content: { rendered: '\n<p class="wp-block-paragraph">Indochine-style living with river views &amp; a private garden.</p>\n' },
  property_label: [LABEL_AVAILABLE],
  property_type: [8],
  property_state: [27, 58],
  property_meta: {
    fave_property_id: ['2247'],
    fave_property_price: ['3900'],
    fave_property_price_postfix: ['Month'],
    fave_property_size: ['180'],
    fave_property_size_prefix: ['Sqm'],
    fave_property_bedrooms: ['3'],
    fave_property_bathrooms: ['2'],
    fave_property_address: ['Nguyen Van Huong'],
    fave_property_map_address: ['Xi Riverview Palace, Nguyen Van Huong Street, Thao Dien Ward, District 2, Ho Chi Minh'],
    houzez_geolocation_lat: ['10.8169627'],
    houzez_geolocation_long: ['106.7304208'],
    fave_property_images: ['34311', '34313', '34309'],
  },
};

// A building ad quoting two unit types at two rents.
const TRAN_CAO_VAN: RentapartmentRecord = {
  ...XI_RIVERVIEW,
  id: 34369,
  link: 'https://rentapartment.vn/charming-serviced-apartment-on-tran-cao-van-street-id-2249/',
  property_state: [61],
  property_meta: {
    ...XI_RIVERVIEW.property_meta,
    fave_property_price: ['540'],
    fave_multi_units: ['a:2:{i:0;a:6:{s:13:"fave_mu_title";s:7:"Studio ";s:13:"fave_mu_price";s:3:"350";s:12:"fave_mu_beds";s:1:"1";}i:1;a:6:{s:13:"fave_mu_title";s:13:"Studio 50 sqm";s:13:"fave_mu_price";s:3:"540";s:12:"fave_mu_beds";s:1:"1";}}'],
  },
};

const IMAGES = ['https://rentapartment.vn/wp-content/uploads/2026/09/ID-2247-living-room.jpg'];

describe('listing URLs', () => {
  it("reads the agency's reference off a permalink, with or without 'id-'", () => {
    expect(extractRentapartmentId('https://rentapartment.vn/charming-serviced-apartment-on-tran-cao-van-street-id-2249/')).toBe('ra2249');
    expect(extractRentapartmentId('https://rentapartment.vn/cozy-serviced-apartment-on-nguyen-van-troi-2059/')).toBe('ra2059');
  });

  it('refuses the archives, which list many units', () => {
    for (const url of [
      'https://rentapartment.vn/apartment-for-rent-district-3/',
      'https://rentapartment.vn/apartment-for-rent-district-10/',
      'https://rentapartment.vn/the-gold-view-for-rent/',
      'https://rentapartment.vn/landmark-81-apartment-for-rent/',
      'https://rentapartment.vn/vietnam-public-holiday/',
      'https://housingsgn.com/properties/khh0219-x-2249/',
    ]) {
      expect(extractRentapartmentId(url)).toBeNull();
    }
  });
});

describe('the feed', () => {
  it('asks for available units, newest first', () => {
    const url = new URL(rentapartmentFeedUrl());
    expect(url.pathname).toBe('/wp-json/wp/v2/properties');
    expect(url.searchParams.get('property_label')).toBe(String(LABEL_AVAILABLE));
    expect(url.searchParams.get('orderby')).toBe('date');
    expect(url.searchParams.get('order')).toBe('desc');
    expect(url.searchParams.get('property_state')).toBeNull();
  });

  it("narrows to the rotation's district, accents and all", () => {
    expect(new URL(rentapartmentFeedUrl('Quận 1')).searchParams.get('property_state')).toBe('26');
    expect(new URL(rentapartmentFeedUrl('Thủ Đức')).searchParams.get('property_state')).toBe('27,58,6036');
    expect(new URL(rentapartmentFeedUrl('Bình Thạnh')).searchParams.get('property_state')).toBe('33');
    // Unknown to the site: the whole feed, not an empty one.
    expect(new URL(rentapartmentFeedUrl('Quận 12')).searchParams.get('property_state')).toBeNull();
  });

  it('turns feed rows into candidates, newest first, rented and archives dropped', () => {
    const candidates = candidatesFromFeed([
      { link: 'https://rentapartment.vn/breezy-2-bedroom-on-empire-city-id-2215/', date_gmt: '2026-06-29T05:59:48', property_label: [LABEL_AVAILABLE] },
      { link: XI_RIVERVIEW.link, date_gmt: '2026-09-15T08:05:09', property_label: [LABEL_AVAILABLE], title: XI_RIVERVIEW.title },
      { link: 'https://rentapartment.vn/river-view-karta-serviced-apartment-id-1560/', date_gmt: '2026-10-01T00:00:00', property_label: [LABEL_RENTED] },
      { link: 'https://rentapartment.vn/the-gold-view-for-rent/', date_gmt: '2026-10-10T00:00:00', property_label: [LABEL_AVAILABLE] },
    ]);
    expect(candidates.map((c) => c.url)).toEqual([
      XI_RIVERVIEW.link,
      'https://rentapartment.vn/breezy-2-bedroom-on-empire-city-id-2215/',
    ]);
    expect(candidates[0].title).toBe('Indochine 3-Bedroom On XI Riverview Palace - ID: 2247');
  });
});

describe('building a listing', () => {
  it('reads every fact from typed fields', () => {
    const built = buildRentapartmentListing(XI_RIVERVIEW, IMAGES, '+84903044551');
    expect('listing' in built).toBe(true);
    if (!('listing' in built)) return;
    expect(built.listing).toMatchObject({
      title: 'Indochine 3-Bedroom On XI Riverview Palace',
      location: 'Xi Riverview Palace, Nguyen Van Huong Street, Thao Dien Ward, District 2, Ho Chi Minh City',
      price: 97_500_000,
      priceDisplay: '$3,900/month',
      size: '180 m²',
      rooms: '3 Bedrooms',
      images: IMAGES,
      description: 'Indochine-style living with river views & a private garden.',
      availability: 'AVAILABLE_NOW',
      sourceProviderPhone: '+84903044551',
      latitude: 10.8169627,
      longitude: 106.7304208,
    });
  });

  it("supplies the district from the agency's own term when the address names only a ward", () => {
    // Addresses from the live feed, 2026-10-14, with the terms they carried.
    const at = (address: string, terms: number[], short = '') => {
      const record = {
        ...XI_RIVERVIEW,
        property_state: terms,
        property_meta: { ...XI_RIVERVIEW.property_meta, fave_property_map_address: address ? [address] : [], fave_property_address: [short] },
      };
      const built = buildRentapartmentListing(record, IMAGES);
      return 'listing' in built ? built.listing.location : built.rejected;
    };
    expect(at('Pham Ngoc Thach Street, Xuan Hoa Ward, Ho Chi Minh', [28]))
      .toBe('Pham Ngoc Thach Street, Xuan Hoa Ward, District 3, Ho Chi Minh City');
    expect(at('Nguyen Van Huong Street, Thao Dien Ward, Ho Chi Minh City, Vietnam', [27]))
      .toBe('Nguyen Van Huong Street, Thao Dien Ward, District 2, Ho Chi Minh City');
    expect(at('Midtown Phu My Hung, Street No.16, Phu My Hung, Distrct 7', [32, 59]))
      .toBe('Midtown Phu My Hung, Street No.16, Phu My Hung, Distrct 7, District 7, Ho Chi Minh City');
    expect(at('Le Thi Rieng Street, Ben Thanh Ward, (District 1), HCM', [26]))
      .toBe('Le Thi Rieng Street, Ben Thanh Ward, (District 1), Ho Chi Minh City');
    expect(at('', [61], 'Tran Cao Van')).toBe('Tran Cao Van, Phu Nhuan District, Ho Chi Minh City');
  });

  it('calls a one-bed studio a studio', () => {
    const record = { ...XI_RIVERVIEW, title: { rendered: 'White Tone Studio On Le Van Sy Street &#8211; ID: 2211' }, property_meta: { ...XI_RIVERVIEW.property_meta, fave_property_bedrooms: ['1'] } };
    const built = buildRentapartmentListing(record, IMAGES);
    expect('listing' in built && built.listing.rooms).toBe('Studio');
  });

  it('refuses a rented unit, an office, a multi-unit ad and a missing rent', () => {
    expect(buildRentapartmentListing({ ...XI_RIVERVIEW, property_label: [LABEL_RENTED] }, IMAGES)).toEqual({ rejected: 'source_rented' });
    expect(buildRentapartmentListing({ ...XI_RIVERVIEW, property_type: [5] }, IMAGES)).toEqual({ rejected: 'non_residential' });
    expect(buildRentapartmentListing(TRAN_CAO_VAN, IMAGES)).toEqual({ rejected: 'multi_unit_ad' });
    expect(buildRentapartmentListing({ ...XI_RIVERVIEW, property_meta: { ...XI_RIVERVIEW.property_meta, fave_property_price: [''] } }, IMAGES)).toEqual({ rejected: 'no_price' });
  });

  it('reads the unit table and the gallery order', () => {
    expect(multiUnitPrices(TRAN_CAO_VAN)).toEqual([350, 540]);
    expect(multiUnitPrices(XI_RIVERVIEW)).toEqual([]);
    expect(galleryIds(XI_RIVERVIEW)).toEqual([34311, 34313, 34309]);
  });
});
