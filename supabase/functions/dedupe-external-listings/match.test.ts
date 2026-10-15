import { describe, expect, it } from 'vitest';
import { hammingHex, looseLocationKey, projectKey, samePlace, scanImagePairs, type MatchListing } from './match.ts';

// Three photos, shared by every listing below unless a test says otherwise.
const PHOTOS = ['f0f0f0f0f0f0f0f0', '0f0f0f0f0f0f0f0f', 'ff00ff00ff00ff00'];
const OTHER_PHOTOS = ['123456789abcdef0', 'fedcba9876543210', '0123456789abcdef'];

let n = 0;
const listing = (location: string, over: Partial<MatchListing> = {}): MatchListing => ({
  id: `l${++n}`,
  location,
  city: 'ho_chi_minh',
  district_code: 'D1',
  rooms: '1 Bedroom',
  created_at: '2026-10-01T00:00:00+00:00',
  image_hashes: PHOTOS,
  image_conflict_dismissed_at: null,
  ...over,
});

// The four listings flagged in production on 2026-10-15: one Grand Marina 1BR,
// reposted with the street spelled four ways, plus the "So 2" posting that
// shares its photos.
const GRAND_MARINA = [
  'Duong Ton Duc Thang, Ward Ben Nghe, District 1, Ho Chi Minh City',
  'Street Ton Duc Thang, Ward Ben Nghe, District 1, Ho Chi Minh City',
  'Ton Duc Thang, Ward Ben Nghe, District 1, Ho Chi Minh City',
  'Số 2 Tôn Đức Thắng, Phường Bến Nghé, Quận 1',
  'Đường Tôn Đức Thắng, Quận 1',
  'Ton Duc Thang Street, Ben Nghe Ward, District 1',
];

describe('looseLocationKey', () => {
  it('spells every form of one street the same', () => {
    const keys = GRAND_MARINA.map((l) => looseLocationKey(projectKey(l)));
    expect(new Set(keys)).toEqual(new Set(['ton duc thang']));
  });

  it('strips Pho and Dai Lo', () => {
    expect(looseLocationKey(projectKey('Phố Huế, Hai Bà Trưng'))).toBe('hue');
    expect(looseLocationKey(projectKey('Đại lộ Võ Văn Kiệt'))).toBe('vo van kiet');
  });

  it('leaves a building name alone', () => {
    expect(looseLocationKey(projectKey('Vinhomes Central Park, Binh Thanh'))).toBe('vinhomes central park');
  });

  it('does not reduce a numbered street to nothing', () => {
    expect(looseLocationKey(projectKey('Đường số 5, Quận 7'))).toBe('duong so 5');
    expect(looseLocationKey(projectKey('Đường số 5'))).not.toBe(looseLocationKey(projectKey('Đường số 7')));
  });
});

describe('samePlace', () => {
  it('treats the Grand Marina spellings as one place', () => {
    for (const a of GRAND_MARINA) {
      for (const b of GRAND_MARINA) expect(samePlace(listing(a), listing(b))).toBe(true);
    }
  });

  it('treats two street addresses in one district as one place', () => {
    expect(samePlace(listing('Duong Ton Duc Thang, D1'), listing('Quan 1, Ho Chi Minh City'))).toBe(true);
    expect(samePlace(listing('Street Le Loi'), listing('Duong Nguyen Hue'))).toBe(true);
  });

  it('does not stretch to a street address without a district', () => {
    const a = listing('Duong Le Loi', { district_code: null });
    expect(samePlace(a, listing('Duong Nguyen Hue'))).toBe(false);
  });

  it('keeps a street address apart from a named building', () => {
    expect(samePlace(listing('Pho Ton Duc Thang'), listing('Vinhomes Golden River Ba Son, Ton Duc Thang Street'))).toBe(false);
  });

  it('keeps one street name in two districts apart', () => {
    expect(samePlace(listing('Duong Nguyen Van Linh', { district_code: 'D7' }), listing('Nguyen Van Linh', { district_code: 'D8' })))
      .toBe(false);
  });

  it('still requires the same city and the same room count', () => {
    expect(samePlace(listing('Ton Duc Thang'), listing('Duong Ton Duc Thang', { rooms: '2 Bedrooms' }))).toBe(false);
    expect(samePlace(listing('Ton Duc Thang'), listing('Duong Ton Duc Thang', { city: 'hanoi' }))).toBe(false);
  });
});

describe('scanImagePairs', () => {
  it('merges the Grand Marina reposts and flags none of them', () => {
    const all = GRAND_MARINA.map((l) => listing(l));
    const { merges, conflictIds } = scanImagePairs(all);
    expect(conflictIds.size).toBe(0);
    expect(merges).toHaveLength((all.length * (all.length - 1)) / 2);
  });

  it('still flags the same photos at a different building', () => {
    const a = listing('Masteri Thao Dien', { district_code: 'D2' });
    const b = listing('Vinhomes Central Park', { district_code: 'BINH_THANH' });
    expect([...scanImagePairs([a, b]).conflictIds].sort()).toEqual([a.id, b.id].sort());
  });

  it('ignores listings that share no photos', () => {
    const a = listing('Masteri Thao Dien', { district_code: 'D2' });
    const b = listing('Vinhomes Central Park', { district_code: 'BINH_THANH', image_hashes: OTHER_PHOTOS });
    expect(scanImagePairs([a, b]).conflictIds.size).toBe(0);
  });

  describe('a "Legit" dismissal', () => {
    const dismissedAt = '2026-10-15T03:00:00.000Z';

    it('survives a rerun against the listings it was given against', () => {
      const a = listing('Masteri Thao Dien', { district_code: 'D2', image_conflict_dismissed_at: dismissedAt });
      const b = listing('Vinhomes Central Park', { district_code: 'BINH_THANH' });
      const { conflictIds, dismissedSkips } = scanImagePairs([a, b]);
      expect(conflictIds.has(a.id)).toBe(false);
      expect(dismissedSkips).toBe(1);
      // Only the listing ops dismissed is cleared; the other waits for its own review.
      expect(conflictIds.has(b.id)).toBe(true);
    });

    it('gives way to a listing posted after it', () => {
      const a = listing('Masteri Thao Dien', { district_code: 'D2', image_conflict_dismissed_at: dismissedAt });
      const later = listing('Vinhomes Central Park', { district_code: 'BINH_THANH', created_at: '2026-10-16T01:00:00+00:00' });
      expect(scanImagePairs([a, later]).conflictIds.has(a.id)).toBe(true);
    });

    it('compares Postgres and JS timestamp formats as instants', () => {
      const a = listing('Masteri Thao Dien', { district_code: 'D2', image_conflict_dismissed_at: '2026-10-15T10:00:00+07:00' });
      const same = listing('Vinhomes Central Park', { district_code: 'BINH_THANH', created_at: '2026-10-15T03:00:00.000Z' });
      expect(scanImagePairs([a, same]).conflictIds.has(a.id)).toBe(false);
    });
  });
});

// The old comparison, kept here as the reference the fast one must equal.
function referenceHamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let count = 0;
  while (x) { count += Number(x & 1n); x >>= 1n; }
  return count;
}

const randomHex = (digits: number) =>
  Array.from({ length: digits }, () => Math.floor(Math.random() * 16).toString(16)).join('');

describe('hammingHex', () => {
  it('equals the BigInt bit count for 64-bit dHashes', () => {
    const edge = ['0000000000000000', 'ffffffffffffffff', '8000000000000001', '7fffffff80000000'];
    for (const a of edge) for (const b of edge) expect(hammingHex(a, b)).toBe(referenceHamming(a, b));
    for (let i = 0; i < 2000; i++) {
      const a = randomHex(16), b = randomHex(16);
      expect(hammingHex(a, b)).toBe(referenceHamming(a, b));
    }
  });

  it('falls back to the exact path for hashes of another length', () => {
    expect(hammingHex('ff', '0f')).toBe(4);
    expect(hammingHex('ffffffffffffffffff', '000000000000000000')).toBe(72);
    expect(hammingHex('FFFFFFFFFFFFFFFF', 'ffffffffffffffff')).toBe(0);
  });
});

describe('scanImagePairs at production volume', () => {
  // 2026-10-15: 772 listings in the window, 403 hashed at ~3 each. The BigInt
  // version took the edge worker past its CPU budget on this.
  it('scans 800 listings, 450 hashed, well inside the CPU budget', () => {
    const all: MatchListing[] = Array.from({ length: 800 }, (_, i) => ({
      id: String(i), location: `Building ${i % 50}, District 1`, city: 'ho_chi_minh', district_code: 'Q1',
      rooms: '1 Bedroom', created_at: '2026-10-01T00:00:00Z', image_conflict_dismissed_at: null,
      image_hashes: i < 450 ? [randomHex(16), randomHex(16), randomHex(16)] : null,
    }));
    const t = performance.now();
    scanImagePairs(all);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
