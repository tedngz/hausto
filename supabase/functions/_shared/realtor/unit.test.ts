import { describe, expect, it } from 'vitest';
import { agentUnit, type UnitListing } from './unit.ts';
import { clashDraft, confirmDraft, draftForRealtor, nudgeDraft, releaseDraft } from './drafts.ts';

const name = (title: string, location: string | null, districtCode: string | null, bedrooms: number | null) =>
  agentUnit({ title, location, districtCode, bedrooms, url: null }).name;

// Every case is a live listing's title and location, as crawled (2026-10-08).
describe('naming a unit to its agent', () => {
  it('uses the building the title names, never the title', () => {
    // The listing an agent asked about: "Căn chic urban là gì z ạ".
    expect(name('Chic Urban Retreat in Lavida Plus with Modern Elegance',
      'Street Nguyen Van Linh, Ward Tan Phong, District 7, Ho Chi Minh City', 'D7', 1))
      .toBe('căn 1PN ở Lavida Plus, Quận 7');
    expect(name('Pool-View 2-Bedroom at Saigon Riverside', 'District 7', 'D7', 2))
      .toBe('căn 2PN ở Saigon Riverside, Quận 7');
    expect(name('Stylish City-View 2BR Apartment in Vibrant Vinhomes Central Park',
      'Street Dien Bien Phu, Ward 22, District Binh Thanh, Ho Chi Minh City', 'BINH_THANH', 2))
      .toBe('căn 2PN ở Vinhomes Central Park, Bình Thạnh');
  });

  it('prefers the building the location names', () => {
    expect(name('Bright and Airy 1BR Apartment in Lush City Garden',
      'City Garden, Thanh My Tay Ward, Binh Thanh District, Ho Chi Minh City', 'BINH_THANH', 1))
      .toBe('căn 1PN ở City Garden, Bình Thạnh');
    expect(name('Charming Riverside Retreat with Expansive Views',
      'De La Sol, Street Ton That Thuyet, Ward 1, District 4, Ho Chi Minh City', 'D4', 2))
      .toBe('căn 2PN ở De La Sol, Quận 4');
    expect(name('Chic Urban Retreat with Pool View in Saigon Royal',
      '34-35, Saigon Royal Residence, Street Ben Van Don, Ward 12, District 4, Ho Chi Minh City', 'D4', 1))
      .toBe('căn 1PN ở Saigon Royal Residence, Quận 4');
  });

  it('falls back to the street, ward and district - and a district in the title is not a building', () => {
    // district_code says TAN_PHU (the ward); the location's District 7 is right.
    expect(name('Chic Duplex Retreat in Quận 7',
      'Street Nguyen Thi Thap, Ward Tan Phu, District 7, Ho Chi Minh City', 'TAN_PHU', 0))
      .toBe('căn hộ ở đường Nguyen Thi Thap, phường Tan Phu, Quận 7');
    expect(name('Chic Modern Retreat with Urban Vibes',
      'Nguyen Huu Canh Street, Thanh My Tay Ward, Binh Thanh District, Ho Chi Minh City', 'BINH_THANH', 1))
      .toBe('căn 1PN ở đường Nguyen Huu Canh, phường Thanh My Tay, Bình Thạnh');
    expect(name('Charming Urban Retreat in Tan Binh District',
      'Pho Quang Street, Tan Binh District, Ho Chi Minh City', 'TAN_BINH', 1))
      .toBe('căn 1PN ở đường Pho Quang, Tân Bình');
    expect(name('Contemporary Urban Retreat in the Heart of Tan Binh',
      'Tan Son Hoa, Tan Binh District, Ho Chi Minh City', 'TAN_BINH', 1))
      .toBe('căn 1PN ở Tân Bình');
  });

  it('does not call a street with no marker a building', () => {
    expect(name('Stylish 3-Bedroom Apartment with Parking in Garden Gate',
      'Hoang Minh Giam, Ward 9, District Phu Nhuan, Ho Chi Minh City', 'PHU_NHUAN', 3))
      .toBe('căn 3PN ở Garden Gate, Phú Nhuận');
    expect(name('Luxurious 3-Bedroom Haven with Resort-Style Amenities',
      'Street Phan Van Dang, Ward Thanh My Loi, District 2, Ho Chi Minh City', 'D2', 3))
      .toBe('căn 3PN ở đường Phan Van Dang, phường Thanh My Loi, Quận 2');
  });

  it('says studio only when the listing does', () => {
    expect(name('Tranquil Studio with Inviting Balcony in Quận 2',
      'Ward An Khanh, District 2, Ho Chi Minh City', 'D2', 0)).toBe('căn studio ở phường An Khanh, Quận 2');
  });

  it('still says something with nothing to go on', () => {
    expect(name('Stylish Four-Bedroom Townhouse with Elegant Interiors', 'District 10', 'D10', 4)).toBe('căn 4PN ở Quận 10');
    expect(name('Lovely flat', null, null, null)).toBe('căn hộ');
  });
});

describe('every message to an agent', () => {
  const listing: UnitListing = {
    title: 'Chic Urban Retreat in Lavida Plus with Modern Elegance',
    location: 'Street Nguyen Van Linh, Ward Tan Phong, District 7, Ho Chi Minh City',
    districtCode: 'D7', bedrooms: 1,
    url: 'https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-duong-nguyen-van-linh-pr41234567',
  };
  const unit = agentUnit(listing);
  const drafts = [
    draftForRealtor({ unit, priceVnd: 15_000_000, availability: [{ date: '2026-10-12', part: 'MORNING' }] }),
    draftForRealtor({ unit, priceVnd: 15_000_000, availability: [], rescheduled: true }),
    nudgeDraft({ unit }),
    confirmDraft({ unit, startsAt: '2026-10-12T03:30:00.000Z' }),
    confirmDraft({ unit, startsAt: null }),
    releaseDraft({ unit }),
    clashDraft({
      unit, offered: '2026-10-12T02:30:00.000Z',
      taken: [{ startsAt: '2026-10-12T02:00:00.000Z', durationMinutes: 60 }],
      availability: [{ date: '2026-10-12', part: 'MORNING' }],
    }),
  ];

  it('carries the link to the ad and names the building', () => {
    for (const d of drafts) {
      expect(d).toContain(`Tin đăng: ${listing.url}`);
      expect(d).toContain('căn 1PN ở Lavida Plus, Quận 7');
    }
  });

  it('never carries our English title', () => {
    for (const d of drafts) expect(d).not.toMatch(/Chic|Retreat|Elegance/);
  });

  it('leaves the link line out rather than print an empty one', () => {
    expect(nudgeDraft({ unit: { ...unit, url: null } })).not.toContain('Tin đăng');
  });

  it('tells the agent when the renter moves in, day first, only when we know', () => {
    const availability = [{ date: '2026-10-15', part: 'MORNING' }];
    expect(draftForRealtor({ unit, priceVnd: 15_000_000, availability, moveInDate: '2026-11-01' }))
      .toContain('Khách dự kiến vào ở khoảng 01/11.');
    expect(draftForRealtor({ unit, priceVnd: 15_000_000, availability, moveInDate: null }))
      .not.toContain('vào ở');
    expect(draftForRealtor({ unit, priceVnd: 15_000_000, availability })).not.toContain('vào ở');
  });
});
