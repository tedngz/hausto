import { describe, it, expect } from 'vitest';
import {
  buildJhouseListing, candidatesFromJhouseFeed, extractJhouseId, jhouseAdPhone, jhouseAvailability,
  jhouseDistrict, jhouseFeedUrl, jhouseGallery, jhouseListingUrl, jhouseLocation, type JhouseUnit,
} from './jhouse.ts';

// Shapes as crm.jhouse.vn/api/public/units returned them on 2026-10-15,
// trimmed to the fields the crawler reads.
const media = (id: string) => `https://media.jhouse.vn/media/units/${id}/large.webp`;

const ROME: JhouseUnit = {
  code: 'H03287',
  slug: 'can-ho-1-phong-ngu-rome-apartment-thao-dien-a603',
  slug_en: 'rome-apartment-thao-dien-1-bedroom-a603',
  title: 'Cho thuê căn hộ 1 phòng ngủ Rome Apartment Thảo Điền, free GYM, POOL',
  title_en: 'Cozy 1-Bedroom Serviced Apartment at Rome Apartment, Thao Dien',
  status: 'available',
  available_from: null,
  price: 13500000,
  currency: 'VND',
  price_vnd: 13500000,
  price_usd: 510,
  area: '40.00',
  bedrooms: 1,
  bathrooms: 1,
  type: 'apartment',
  furnishing: 'full',
  cover_image: media('a158643c'),
  images: [media('a158643c'), media('070e06d6'), media('a4cf1ab1')],
  building: {
    name: 'Rome Apartment',
    type: 'chdv',
    public_address: '/A22 Nguyễn Văn Hưởng, Quận 2',
    public_district: 'Quận 2',
    district: 'Quận 2',
  },
  description_en: '<h1 class="ql-align-justify"><strong>Cozy 1-Bedroom Serviced Apartment at Rome Apartment, Thao Dien</strong></h1><p class="ql-align-justify">Located on the sixth floor of Rome Apartment in Thao Dien, this fully furnished 40 m² apartment features wood flooring.</p><p class="ql-align-justify">Residents enjoy the rooftop pool and gym.</p>',
  amenities: ['Air Conditioner', 'Washing Machine', 'Modem Wifi'],
  building_amenities: ['Pool', 'GYM', 'Elevator', 'Washing Machine'],
  same_building_units: [{ code: 'H01467', status: 'rented', images: [media('other-unit')] }],
  similar_units: [{ code: 'H00558', status: 'rented', images: [media('similar-unit')] }],
};

const STUDIO: JhouseUnit = {
  ...ROME,
  code: 'H03289',
  slug_en: 'phu-my-apartment-furnished-studio-binh-thanh-204',
  title_en: 'Cozy Furnished Studio Apartment in Binh Thanh – Phu My Apartment',
  price: 10500000,
  price_vnd: 10500000,
  area: '30.00',
  bedrooms: 0,
  building: { name: 'Phu My Apartment', type: 'chdv', public_address: 'Phú Mỹ, Bình Thạnh', district: 'Bình Thạnh' },
};

const UPCOMING: JhouseUnit = {
  ...ROME,
  code: 'H03286',
  slug_en: 'sol-apartment-thao-dien-2-bedroom-802',
  status: 'upcoming',
  available_from: '2026-11-03',
  building: { name: 'Sol Apartment', public_address: 'Đường số 66, 2', district: '2' },
};

const RENTED: JhouseUnit = {
  ...ROME,
  code: 'H03290',
  slug_en: 'phu-my-apartment-modern-studio-balcony-binh-thanh-203',
  status: 'rented',
};

const NOW = new Date('2026-10-15T03:00:00Z');

describe('listing URLs', () => {
  it('keys a listing by its English slug, the only reference in its URL', () => {
    expect(extractJhouseId('https://jhouse.vn/property/rome-apartment-thao-dien-1-bedroom-a603')).toBe('jh-rome-apartment-thao-dien-1-bedroom-a603');
    expect(jhouseListingUrl(ROME)).toBe('https://jhouse.vn/property/rome-apartment-thao-dien-1-bedroom-a603');
  });

  it('refuses the index, filtered views and building pages', () => {
    for (const url of [
      'https://jhouse.vn/property',
      'https://jhouse.vn/property?special_layout=penthouse',
      'https://jhouse.vn/buildings/sailing-tower-apartments',
      'https://jhouse.vn/vi/bds/can-ho-1-phong-ngu-rome-apartment-thao-dien-a603',
      'https://example.com/property/rome-apartment-thao-dien-1-bedroom-a603',
    ]) expect(extractJhouseId(url)).toBeNull();
  });
});

describe('the feed', () => {
  it('asks for units on offer only, newest first, in the run\'s district', () => {
    const url = new URL(jhouseFeedUrl('Quận 1', 2));
    expect(url.origin + url.pathname).toBe('https://crm.jhouse.vn/api/public/units');
    expect(url.searchParams.get('statuses')).toBe('available,upcoming');
    expect(url.searchParams.get('sort')).toBe('newest');
    expect(url.searchParams.get('per_page')).toBe('48');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('districts')).toBe('Quận 1');
  });

  it('reads Thủ Đức as the District 2 stock the site files under Quận 2', () => {
    expect(new URL(jhouseFeedUrl('Thủ Đức')).searchParams.get('districts')).toBe('Quận 2,Thủ Đức');
  });

  it('crawls the whole feed for a district it has no filter for', () => {
    expect(new URL(jhouseFeedUrl('Hoàn Kiếm')).searchParams.has('districts')).toBe(false);
  });

  it('puts free-now units before free-soon ones, newest first within each, and drops rented', () => {
    const order = candidatesFromJhouseFeed([RENTED, STUDIO, ROME, UPCOMING], NOW).map((c) => c.url);
    expect(order).toEqual([
      'https://jhouse.vn/property/phu-my-apartment-furnished-studio-binh-thanh-204',
      'https://jhouse.vn/property/rome-apartment-thao-dien-1-bedroom-a603',
      'https://jhouse.vn/property/sol-apartment-thao-dien-2-bedroom-802',
    ]);
  });

  it('carries the rent in dong, so a run can drop units outside its band before building them', () => {
    const [c] = candidatesFromJhouseFeed([ROME], NOW);
    expect(c.priceVnd).toBe(13_500_000);
    expect(c.availability).toBe('AVAILABLE_NOW');
  });

  it('drops what is not a home before it takes a slot', () => {
    expect(candidatesFromJhouseFeed([{ ...ROME, type: 'office' }], NOW)).toEqual([]);
  });
});

describe('availability', () => {
  it('maps the CRM status', () => {
    expect(jhouseAvailability(ROME, NOW)).toBe('AVAILABLE_NOW');
    expect(jhouseAvailability(UPCOMING, NOW)).toBe('AVAILABLE_SOON');
    expect(jhouseAvailability(RENTED, NOW)).toBe('RENTED');
  });

  it('does not call a unit free today when its date is still ahead', () => {
    expect(jhouseAvailability({ ...ROME, available_from: '2026-11-07' }, NOW)).toBe('AVAILABLE_SOON');
    expect(jhouseAvailability({ ...ROME, available_from: '2026-08-15' }, NOW)).toBe('AVAILABLE_NOW');
  });
});

describe('location', () => {
  it('writes the CRM\'s three spellings of a district one way', () => {
    expect(jhouseDistrict('Quận 2')).toBe('District 2');
    expect(jhouseDistrict('3')).toBe('District 3');
    expect(jhouseDistrict('Bình Thạnh')).toBe('Binh Thanh District');
    expect(jhouseDistrict('Phú Nhuận')).toBe('Phu Nhuan District');
    expect(jhouseDistrict('Thủ Đức')).toBe('Thu Duc City');
  });

  it('falls back to the district the title or slug names, then a neighbourhood, when the CRM has none', () => {
    expect(jhouseDistrict('', 'serviced-apartment-phu-nhuan-ace-building-x01')).toBe('Phu Nhuan District');
    expect(jhouseDistrict('', 'Studio for rent in district-10')).toBe('District 10');
    expect(jhouseDistrict('', 'Nguyen Van Huong Thao Dien')).toBe('District 2');
    expect(jhouseDistrict('', 'Somewhere')).toBe('');
  });

  it('lets a building named for its own address stand alone', () => {
    expect(jhouseLocation({ ...ROME, building: { name: '251 Bạch Đằng', public_address: 'Bạch Đằng, Gò Vấp', district: 'Gò Vấp' } }))
      .toBe('251 Bach Dang, Go Vap District, Ho Chi Minh City');
  });

  it('writes the district once, not again inside the building name', () => {
    expect(jhouseLocation({ ...ROME, building: { name: 'Saigon Pavillon Quận 3', public_address: 'Bà Huyện Thanh Quan, Quận 3', district: 'Quận 3' } }))
      .toBe('Saigon Pavillon, Ba Huyen Thanh Quan, District 3, Ho Chi Minh City');
  });

  it('places the ACE building, which has no district on file', () => {
    expect(jhouseLocation({
      ...ROME,
      slug_en: 'serviced-apartment-phu-nhuan-ace-building-x01',
      title_en: 'Serviced Apartment in Phu Nhuan - ACE Building',
      building: { name: '18 Trần Cao Vân', public_address: 'Trần Cao Vân', district: '' },
    })).toBe('18 Tran Cao Van, Phu Nhuan District, Ho Chi Minh City');
  });

  it('names the building, drops the address\'s own district suffix and the house-number tail, and romanises', () => {
    expect(jhouseLocation(ROME)).toBe('Rome Apartment, A22 Nguyen Van Huong, District 2, Ho Chi Minh City');
    expect(jhouseLocation(STUDIO)).toBe('Phu My Apartment, Phu My, Binh Thanh District, Ho Chi Minh City');
    expect(jhouseLocation(UPCOMING)).toBe('Sol Apartment, Duong so 66, District 2, Ho Chi Minh City');
  });

  it('does not name the building twice', () => {
    expect(jhouseLocation({ ...ROME, building: { name: 'Harbor Point', public_address: 'Harbor Point Apartments, Quận 2', district: 'Quận 2' } }))
      .toBe('Harbor Point Apartments, District 2, Ho Chi Minh City');
  });
});

describe('building a listing', () => {
  it('builds from typed fields', () => {
    const built = buildJhouseListing(ROME, '+84901310986', NOW);
    if (!('listing' in built)) throw new Error(built.rejected);
    const l = built.listing;
    expect(l.title).toBe('Cozy 1-Bedroom Serviced Apartment at Rome Apartment, Thao Dien');
    expect(l.price).toBe(13_500_000);
    expect(l.priceDisplay).toBe('13.500.000 ₫/month');
    expect(l.size).toBe('40 m²');
    expect(l.rooms).toBe('1 Bedroom');
    expect(l.availability).toBe('AVAILABLE_NOW');
    expect(l.sourceProviderName).toBe('J.House');
    expect(l.sourceProviderPhone).toBe('+84901310986');
  });

  it('drops the heading that repeats the title from the description', () => {
    const built = buildJhouseListing(ROME, null, NOW);
    if (!('listing' in built)) throw new Error(built.rejected);
    expect(built.listing.description).toBe(
      'Located on the sixth floor of Rome Apartment in Thao Dien, this fully furnished 40 m² apartment features wood flooring.\nResidents enjoy the rooftop pool and gym.',
    );
  });

  it('merges unit and building amenities once each', () => {
    const built = buildJhouseListing(ROME, null, NOW);
    if (!('listing' in built)) throw new Error(built.rejected);
    expect(built.listing.amenities).toEqual(['Air Conditioner', 'Washing Machine', 'Modem Wifi', 'Pool', 'GYM', 'Elevator']);
  });

  it('calls zero bedrooms a studio, and keeps house style in the title', () => {
    const built = buildJhouseListing(STUDIO, null, NOW);
    if (!('listing' in built)) throw new Error(built.rejected);
    expect(built.listing.rooms).toBe('Studio');
    expect(built.listing.title).toBe('Cozy Furnished Studio Apartment in Binh Thanh - Phu My Apartment');
  });

  it('refuses rented units, non-homes and units with no rent', () => {
    expect(buildJhouseListing(RENTED, null, NOW)).toEqual({ rejected: 'source_rented' });
    expect(buildJhouseListing({ ...ROME, type: 'office' }, null, NOW)).toEqual({ rejected: 'non_residential' });
    expect(buildJhouseListing({ ...ROME, price: 0, price_vnd: 0 }, null, NOW)).toEqual({ rejected: 'no_price' });
  });
});

describe('gallery', () => {
  it('is the unit\'s own photos, cover first, never another unit\'s', () => {
    const gallery = jhouseGallery(ROME);
    expect(gallery).toEqual([media('a158643c'), media('070e06d6'), media('a4cf1ab1')]);
    expect(gallery.some((u) => /other-unit|similar-unit/.test(u))).toBe(false);
  });

  it('ignores anything off the agency\'s media host', () => {
    expect(jhouseGallery({ images: ['https://jhouse.vn/images/jhouse-logo-current.png', media('a')] })).toEqual([media('a')]);
  });
});

describe('the ad\'s phone number', () => {
  it('reads the WhatsApp link, as the page has no tel: link', () => {
    expect(jhouseAdPhone('<a href="https://wa.me/84901310986">WhatsApp</a><a href="https://zalo.me/0901310986">Zalo</a>')).toBe('+84901310986');
  });

  it('falls back to Zalo, and prefers a tel: link where one appears', () => {
    expect(jhouseAdPhone('<a href="https://zalo.me/0901310986">Zalo</a>')).toBe('0901310986');
    expect(jhouseAdPhone('<a href="tel:+84 90 131 0986">Call</a><a href="https://wa.me/84900000000">x</a>')).toBe('+84901310986');
    expect(jhouseAdPhone('<p>no number</p>')).toBeNull();
  });
});
