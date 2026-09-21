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

const ADMINISTRATIVE_TERMS: [RegExp, string][] = [
  [/\bphường\b/giu, 'Ward'],
  [/\bquận\b/giu, 'District'],
  [/\bhuyện\b/giu, 'District'],
  [/\bxã\b/giu, 'Commune'],
  [/\bthị trấn\b/giu, 'Town'],
  [/\bthị xã\b/giu, 'Township'],
];

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
  for (const [pattern, replacement] of ADMINISTRATIVE_TERMS) result = result.replace(pattern, replacement);

  return romanise(result).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}
