// Pure matching rules for dedupe-external-listings: no Deno APIs, so vitest
// can run them (match.test.ts).

export type MatchListing = {
  id: string;
  location: string;
  city: string | null;
  district_code: string | null;
  rooms: string | null;
  created_at: string | null;
  image_hashes: string[] | null;
  image_conflict_dismissed_at: string | null;
};

// Two image dHashes match when their Hamming distance is small (survives
// recompression and resizing of the same source photo).
const HAMMING_MAX = 6;
const IMAGE_MATCHES_REQUIRED = 2; // shared photos needed to call it the same unit

// The pair scan compares every hashed listing with every other, about nine
// hash pairs each, so this is the job's hot loop. It used to parse both hex
// strings into BigInts and count bits one shift at a time on every
// comparison; past ~400 hashed listings that blew the edge runtime's CPU
// budget ("CPU Time exceeded", 546 every night from about 2026-10-08), and no
// flag, merge or relist was recomputed for a week. A 64-bit dHash is now
// parsed once into two 32-bit halves and compared with a constant-time
// popcount. Hashes that are not 16 hex digits keep the exact BigInt path.

type ParsedHash = { hi: number; lo: number } | { big: bigint };

const parsed = new Map<string, ParsedHash>();

function parseHash(h: string): ParsedHash {
  let v = parsed.get(h);
  if (!v) {
    v = /^[0-9a-f]{16}$/i.test(h)
      ? { hi: parseInt(h.slice(0, 8), 16) >>> 0, lo: parseInt(h.slice(8), 16) >>> 0 }
      : { big: BigInt('0x' + h) };
    parsed.set(h, v);
  }
  return v;
}

function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

function bigPopcount(x: bigint): number {
  let count = 0;
  while (x) { count += Number(x & 1n); x >>= 1n; }
  return count;
}

function toBig(h: ParsedHash): bigint {
  return 'big' in h ? h.big : (BigInt(h.hi) << 32n) | BigInt(h.lo);
}

export function hammingHex(a: string, b: string): number {
  const pa = parseHash(a), pb = parseHash(b);
  if ('hi' in pa && 'hi' in pb) return popcount32(pa.hi ^ pb.hi) + popcount32(pa.lo ^ pb.lo);
  return bigPopcount(toBig(pa) ^ toBig(pb));
}

export function imageOverlap(a: MatchListing, b: MatchListing): number {
  const ha = a.image_hashes || [], hb = b.image_hashes || [];
  if (ha.length === 0 || hb.length === 0) return 0;
  let matches = 0;
  for (const x of ha) {
    for (const y of hb) {
      if (hammingHex(x, y) <= HAMMING_MAX) { matches++; break; }
    }
  }
  return matches;
}

const stripDiacritics = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

// Project key: the first comma-segment of the location, which for VN rental
// listings is almost always the building/complex name ("Feliz en Vista, ...").
export function projectKey(location: string): string {
  const seg = (location || '').split(',')[0] || '';
  return stripDiacritics(seg).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// The project key is only trustworthy when that first segment is a building
// name. VN listings just as often lead with a street address, ward, or district
// ("334 To Hien Thanh", "Quan 7", "Duong Vo Thi Sau"), and bucketing on those
// merges genuinely different apartments that happen to share a street and a
// price band. Such keys are excluded from the text-heuristic pass; only shared
// image fingerprints - much stronger evidence - can group them.
const GENERIC_KEY_RE =
  /^(?:\d|so\s+\d|quan\b|phuong\b|duong\b|pho\b|ngo\b|hem\b|xa\b|dai lo\b|tp\b|thanh pho\b|khu pho\b)/;

export function isGenericLocationKey(pk: string): boolean {
  if (!pk) return true;
  if (GENERIC_KEY_RE.test(pk)) return true;
  if (/\bstreet$/.test(pk)) return true;
  return false;
}

export function normalizeRooms(rooms: string | null): string {
  const r = (rooms || '').toLowerCase();
  if (r.includes('studio')) return 'studio';
  const m = r.match(/(\d+)/);
  return m ? `${m[1]}br` : 'unknown';
}

// A key that names a street rather than a building. Wider than
// isGenericLocationKey, which the text pass relies on and which does not know
// the English "Street Ton Duc Thang" that translated listings lead with.
function isStreetKey(pk: string): boolean {
  return isGenericLocationKey(pk) || /^(?:street|st|road)\b/.test(pk) || /\broad$/.test(pk);
}

const LEADING_NOISE_RE = /^(?:so\s+(?=\d)|\d+[a-z]?\s+|duong\s+|pho\s+|street\s+|st\s+|road\s+|dai lo\s+)/;
const TRAILING_NOISE_RE = /\s+(?:street|st|road)$/;

// The street name alone: the house number and the word for "street" removed,
// in whichever language the crawler handed over. "Duong Ton Duc Thang",
// "Street Ton Duc Thang", "So 2 Ton Duc Thang" and "Ton Duc Thang" are all
// "ton duc thang". A key with nothing left but numbers is returned unchanged,
// so "Duong So 5" never collapses to an empty string that matches another.
export function looseLocationKey(pk: string): string {
  let k = pk;
  for (let prev = ''; prev !== k;) {
    prev = k;
    k = k.replace(LEADING_NOISE_RE, '').replace(TRAILING_NOISE_RE, '');
  }
  return /[a-z]{2,}/.test(k) ? k : pk;
}

// Do two listings that share photos claim the same place? Only a "no" is a
// suspected bait flag, so a spelling difference in the address must not be
// one. Same city and room count are always required. Beyond the exact project
// key, the place is the same when the street names agree once spelled loosely,
// or when neither address names a building and both sit in the same district -
// two street addresses in one district carry no evidence of a different place
// strong enough to outweigh the same photos.
export function samePlace(a: MatchListing, b: MatchListing): boolean {
  if ((a.city || '') !== (b.city || '')) return false;
  if (normalizeRooms(a.rooms) !== normalizeRooms(b.rooms)) return false;
  const ka = projectKey(a.location), kb = projectKey(b.location);
  if (ka === kb) return true;
  const da = a.district_code, db = b.district_code;
  if (da && db && da !== db) return false;
  if (looseLocationKey(ka) === looseLocationKey(kb)) return true;
  return !!da && da === db && isStreetKey(ka) && isStreetKey(kb);
}

// An ops "Legit" on a listing holds against every listing that already
// existed when it was given. Only a listing posted after it reopens the
// question, since that is photo reuse nobody has looked at yet.
export function dismissalCovers(dismissed: MatchListing, other: MatchListing): boolean {
  if (!dismissed.image_conflict_dismissed_at) return false;
  const at = Date.parse(dismissed.image_conflict_dismissed_at);
  const created = other.created_at ? Date.parse(other.created_at) : NaN;
  // A partner with no creation time cannot be shown to be newer.
  return Number.isNaN(created) || created <= at;
}

// Image-fingerprint pass: agents repost the landlord's photo set, so shared
// photos identify the same unit regardless of listing text. Policy: same
// photos but materially different claimed location (or different room count)
// is bait or stolen photos - flag both listings for ops review, never merge
// them. Returns the index pairs to merge and the ids to flag.
export function scanImagePairs(all: MatchListing[]) {
  const merges: [number, number][] = [];
  const conflictIds = new Set<string>();
  let dismissedSkips = 0;
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (!a.image_hashes || a.image_hashes.length === 0) continue;
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      if (!b.image_hashes || b.image_hashes.length === 0) continue;
      const needed = Math.min(IMAGE_MATCHES_REQUIRED, a.image_hashes.length, b.image_hashes.length);
      if (imageOverlap(a, b) < needed) continue;
      if (samePlace(a, b)) {
        merges.push([i, j]);
        continue;
      }
      for (const [x, y] of [[a, b], [b, a]]) {
        if (dismissalCovers(x, y)) dismissedSkips++;
        else conflictIds.add(x.id);
      }
    }
  }
  return { merges, conflictIds, dismissedSkips };
}
