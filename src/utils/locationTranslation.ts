/**
 * Translates Vietnamese location names to English for display purposes.
 * Keeps the original Vietnamese version for geocoding (which works better with Vietnamese).
 */

// Administrative divisions. A term only counts where a label stands: opening a
// comma segment, or straight after a ward number ("Phường 10 Quận 3"). These
// words are also parts of street names - Huyền Quang, Bà Huyện Thanh Quan - and
// matching them anywhere read those as "District Quang" and "Ba District Thanh
// Quan". Mirrors `_shared/location-language.ts`, which labels what is stored.
const ADMINISTRATIVE_TERMS: [RegExp, string][] = [
  [/(^|\d\s+)Thành phố(?=\s)/giu, '$1City'],
  [/(^|\d\s+)Quận(?=\s)/giu, '$1District'],
  [/(^|\d\s+)Huyện(?=\s)/giu, '$1District'],
  [/(^|\d\s+)Phường(?=\s)/giu, '$1Ward'],
  [/(^|\d\s+)Xã(?=\s)/giu, '$1Commune'],
  [/(^|\d\s+)Thị trấn(?=\s)/giu, '$1Town'],
  [/(^|\d\s+)Thị xã(?=\s)/giu, '$1Township'],
];

// A segment that names a street is a street, whatever its first word.
const STREET_WORDS = /(^|\s)(đường|phố|hẻm|ngõ|ngách|street|alley|road)(\s|$)/iu;

// Street types. Directions (Bắc, Nam, Đông, Tây) are left alone: they are
// parts of names far more often than not - Nam Kỳ Khởi Nghĩa is not "South Ky
// Khoi Nghia".
const TERM_TRANSLATIONS: [RegExp, string][] = [
  [/(^|\s)Đường(?=\s)/giu, '$1Street'],
  [/(^|\s)Phố(?=\s)/giu, '$1Street'],
  [/(^|\s)Hẻm(?=\s)/giu, '$1Alley'],
  [/(^|\s)Ngõ(?=\s)/giu, '$1Alley'],
  [/(^|\s)Ngách(?=\s)/giu, '$1Lane'],
  [/(^|\s)Đại lộ(?=\s)/giu, '$1Boulevard'],
];

function translateAdministrativeTerms(segment: string): string {
  let s = segment.trim();
  if (STREET_WORDS.test(s)) return s;
  for (const [pattern, replacement] of ADMINISTRATIVE_TERMS) s = s.replace(pattern, replacement);
  return s;
}

// Well-known city name translations
const CITY_TRANSLATIONS: Record<string, string> = {
  'hồ chí minh': 'Ho Chi Minh City',
  'hà nội': 'Hanoi',
  'đà nẵng': 'Da Nang',
  'hải phòng': 'Hai Phong',
  'cần thơ': 'Can Tho',
  'nha trang': 'Nha Trang',
  'vũng tàu': 'Vung Tau',
  'đà lạt': 'Da Lat',
  'huế': 'Hue',
  'biên hòa': 'Bien Hoa',
  'tp. hồ chí minh': 'Ho Chi Minh City',
  'tp.hồ chí minh': 'Ho Chi Minh City',
  'tp hồ chí minh': 'Ho Chi Minh City',
  'tp.hcm': 'Ho Chi Minh City',
  'tphcm': 'Ho Chi Minh City',
};

// Well-known district name translations (with diacritics)
const DISTRICT_TRANSLATIONS: Record<string, string> = {
  'bình thạnh': 'Binh Thanh',
  'phú nhuận': 'Phu Nhuan',
  'tân bình': 'Tan Binh',
  'tân phú': 'Tan Phu',
  'gò vấp': 'Go Vap',
  'thủ đức': 'Thu Duc',
  'bình tân': 'Binh Tan',
  'bình chánh': 'Binh Chanh',
  'nhà bè': 'Nha Be',
  'cần giờ': 'Can Gio',
  'củ chi': 'Cu Chi',
  'hóc môn': 'Hoc Mon',
  'ba đình': 'Ba Dinh',
  'hoàn kiếm': 'Hoan Kiem',
  'đống đa': 'Dong Da',
  'cầu giấy': 'Cau Giay',
  'hai bà trưng': 'Hai Ba Trung',
  'tây hồ': 'Tay Ho',
  'long biên': 'Long Bien',
  'thanh xuân': 'Thanh Xuan',
  'hoàng mai': 'Hoang Mai',
  'hải châu': 'Hai Chau',
  'thanh khê': 'Thanh Khe',
  'sơn trà': 'Son Tra',
  'ngũ hành sơn': 'Ngu Hanh Son',
  'liên chiểu': 'Lien Chieu',
  'cẩm lệ': 'Cam Le',
};

// Well-known ward/area name translations
const WARD_TRANSLATIONS: Record<string, string> = {
  'bến nghé': 'Ben Nghe',
  'bến thành': 'Ben Thanh',
  'đa kao': 'Da Kao',
  'nguyễn thái bình': 'Nguyen Thai Binh',
  'phạm ngũ lão': 'Pham Ngu Lao',
  'tân định': 'Tan Dinh',
  'cô giang': 'Co Giang',
  'cầu kho': 'Cau Kho',
  'thảo điền': 'Thao Dien',
  'an phú': 'An Phu',
  'thạnh mỹ lợi': 'Thanh My Loi',
  'phú mỹ hưng': 'Phu My Hung',
  'võ thị sáu': 'Vo Thi Sau',
  'phan xích long': 'Phan Xich Long',
};

/**
 * Remove Vietnamese diacritics from a string.
 */
function removeDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Translate a Vietnamese location string to English for display.
 * The original Vietnamese string should still be used for geocoding.
 */
export function translateLocationToEnglish(location: string): string {
  if (!location) return location;

  let result = location;

  // 1. Replace known city names (case-insensitive)
  for (const [vn, en] of Object.entries(CITY_TRANSLATIONS)) {
    const regex = new RegExp(vn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, en);
  }

  // 2. Replace known district names
  for (const [vn, en] of Object.entries(DISTRICT_TRANSLATIONS)) {
    const regex = new RegExp(vn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, en);
  }

  // 3. Replace known ward names
  for (const [vn, en] of Object.entries(WARD_TRANSLATIONS)) {
    const regex = new RegExp(vn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, en);
  }

  // 4. Replace Vietnamese administrative labels, then street types
  result = result.split(',').map(translateAdministrativeTerms).join(', ');
  for (const [regex, replacement] of TERM_TRANSLATIONS) {
    result = result.replace(regex, replacement);
  }

  // 5. Remove remaining diacritics from any untranslated Vietnamese words
  result = removeDiacritics(result);

  // 6. Clean up any double spaces
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}
