// Renter-facing location labels are English, while Vietnamese place names are
// romanised rather than translated. This keeps a source address recognisable
// and readable without exposing Vietnamese administrative labels in the UI.

const CITY_PATTERNS: [RegExp, string][] = [
  [/(?:thành phố|tp\.?)\s+hồ chí minh/giu, 'Ho Chi Minh City'],
  [/hồ chí minh/giu, 'Ho Chi Minh City'],
  [/(?:thành phố|tp\.?)\s+hà nội/giu, 'Hanoi'],
  [/hà nội/giu, 'Hanoi'],
  [/(?:thành phố|tp\.?)\s+đà nẵng/giu, 'Da Nang'],
  [/đà nẵng/giu, 'Da Nang'],
];

// A term only counts where an administrative label stands: opening a comma
// segment, or straight after a ward number ("Phường 10 Quận 3"). These words
// are also parts of street names - Huyền Quang, Bà Huyện Thanh Quan - and
// matching them anywhere turned those into "District Quang Street" and
// "Ba District Thanh Quan".
const ADMINISTRATIVE_TERMS: [RegExp, string][] = [
  [/(^|\d\s+)phường(?=\s)/giu, '$1Ward'],
  [/(^|\d\s+)quận(?=\s)/giu, '$1District'],
  [/(^|\d\s+)huyện(?=\s)/giu, '$1District'],
  [/(^|\d\s+)xã(?=\s)/giu, '$1Commune'],
  [/(^|\d\s+)thị trấn(?=\s)/giu, '$1Town'],
  [/(^|\d\s+)thị xã(?=\s)/giu, '$1Township'],
];

// A segment that names a street is a street, whatever its first word.
const STREET_WORDS = /(^|\s)(đường|phố|hẻm|ngõ|ngách|street|alley|road)(\s|$)/iu;

function translateAdministrativeTerms(segment: string): string {
  let s = segment.trim();
  if (STREET_WORDS.test(s)) return s;
  for (const [pattern, replacement] of ADMINISTRATIVE_TERMS) s = s.replace(pattern, replacement);
  return s;
}

function romanise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Convert a source location into the English label stored and shown to renters. */
export function normalizeLocationForEnglishDisplay(location: string | null | undefined): string {
  if (!location) return '';

  let result = location.trim();
  for (const [pattern, replacement] of CITY_PATTERNS) result = result.replace(pattern, replacement);
  result = result.split(',').map(translateAdministrativeTerms).join(', ');

  return romanise(result).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}
