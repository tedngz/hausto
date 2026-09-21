/** Renter-facing district lists per city (matches CityDistrictSelector naming) */
export const CITY_DISTRICTS: Record<string, string[]> = {
  hcmc: [
    'District 1', 'District 2', 'District 3', 'District 4', 'District 5',
    'District 6', 'District 7', 'District 8', 'District 10', 'District 11',
    'Binh Thanh', 'Tan Binh', 'Tan Phu', 'Phu Nhuan', 'Go Vap', 'Thu Duc', 'Binh Tan',
  ],
  hanoi: ['Hoan Kiem', 'Ba Dinh', 'Cau Giay', 'Tay Ho', 'Dong Da', 'Hai Ba Trung', 'Long Bien', 'Nam Tu Liem'],
  danang: ['Hai Chau', 'Son Tra', 'Ngu Hanh Son', 'Thanh Khe', 'Lien Chieu', 'Cam Le'],
};

export const stripDiacritics = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

/**
 * Listings mix Vietnamese ("Quan Tan Binh") and English ("District 2") location
 * strings, so district matching is diacritic-stripped with a Quan/District alias.
 *
 * Shared by the browse table's district filter and the hub's new-listings
 * strip, which scopes "new" to the districts the renter actually cares about.
 */
export const locationMatchesDistrict = (location: string, district: string): boolean => {
  const loc = stripDiacritics(location).toLowerCase();
  const d = stripDiacritics(district).toLowerCase();
  if (loc.includes(d)) return true;
  const numbered = d.match(/^district (\d+)$/);
  if (numbered) return new RegExp(`quan ${numbered[1]}(?!\\d)`).test(loc);
  return false;
};

/** The renter-facing district portion of a listing's location string. */
export const districtOf = (location: string): string => {
  const parts = (location || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return location;
  // Take the last segment before the city (which is always the final part).
  // This gives us just the district name (e.g. "District 1", "Tan Binh").
  const withoutCity = parts.slice(0, -1);
  return withoutCity[withoutCity.length - 1] || location;
};
