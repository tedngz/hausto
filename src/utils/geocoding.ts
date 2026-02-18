// Vietnamese district name mappings for accurate geocoding
const DISTRICT_ALIASES: Record<string, string> = {
  // Ho Chi Minh City districts
  'd1': 'Quận 1, Hồ Chí Minh',
  'd2': 'Quận 2, Thủ Đức, Hồ Chí Minh',
  'd3': 'Quận 3, Hồ Chí Minh',
  'd4': 'Quận 4, Hồ Chí Minh',
  'd5': 'Quận 5, Hồ Chí Minh',
  'd6': 'Quận 6, Hồ Chí Minh',
  'd7': 'Quận 7, Hồ Chí Minh',
  'd8': 'Quận 8, Hồ Chí Minh',
  'd9': 'Quận 9, Thủ Đức, Hồ Chí Minh',
  'd10': 'Quận 10, Hồ Chí Minh',
  'd11': 'Quận 11, Hồ Chí Minh',
  'd12': 'Quận 12, Hồ Chí Minh',
  'district 1': 'Quận 1, Hồ Chí Minh',
  'district 2': 'Quận 2, Thủ Đức, Hồ Chí Minh',
  'district 3': 'Quận 3, Hồ Chí Minh',
  'district 4': 'Quận 4, Hồ Chí Minh',
  'district 5': 'Quận 5, Hồ Chí Minh',
  'district 6': 'Quận 6, Hồ Chí Minh',
  'district 7': 'Quận 7, Hồ Chí Minh',
  'district 8': 'Quận 8, Hồ Chí Minh',
  'district 9': 'Quận 9, Thủ Đức, Hồ Chí Minh',
  'district 10': 'Quận 10, Hồ Chí Minh',
  'district 11': 'Quận 11, Hồ Chí Minh',
  'district 12': 'Quận 12, Hồ Chí Minh',
  'binh thanh': 'Quận Bình Thạnh, Hồ Chí Minh',
  'phu nhuan': 'Quận Phú Nhuận, Hồ Chí Minh',
  'tan binh': 'Quận Tân Bình, Hồ Chí Minh',
  'tan phu': 'Quận Tân Phú, Hồ Chí Minh',
  'go vap': 'Quận Gò Vấp, Hồ Chí Minh',
  'thu duc': 'Thành phố Thủ Đức, Hồ Chí Minh',
  'binh tan': 'Quận Bình Tân, Hồ Chí Minh',
  'binh chanh': 'Huyện Bình Chánh, Hồ Chí Minh',
  'nha be': 'Huyện Nhà Bè, Hồ Chí Minh',
  'can gio': 'Huyện Cần Giờ, Hồ Chí Minh',
  'cu chi': 'Huyện Củ Chi, Hồ Chí Minh',
  'hoc mon': 'Huyện Hóc Môn, Hồ Chí Minh',
  // Hanoi districts
  'ba dinh': 'Quận Ba Đình, Hà Nội',
  'hoan kiem': 'Quận Hoàn Kiếm, Hà Nội',
  'dong da': 'Quận Đống Đa, Hà Nội',
  'cau giay': 'Quận Cầu Giấy, Hà Nội',
  'hai ba trung': 'Quận Hai Bà Trưng, Hà Nội',
  'tay ho': 'Quận Tây Hồ, Hà Nội',
  'long bien': 'Quận Long Biên, Hà Nội',
  'thanh xuan': 'Quận Thanh Xuân, Hà Nội',
  'hoang mai': 'Quận Hoàng Mai, Hà Nội',
  // Da Nang districts
  'hai chau': 'Quận Hải Châu, Đà Nẵng',
  'thanh khe': 'Quận Thanh Khê, Đà Nẵng',
  'son tra': 'Quận Sơn Trà, Đà Nẵng',
  'ngu hanh son': 'Quận Ngũ Hành Sơn, Đà Nẵng',
};

/**
 * Normalize a location string and find its Vietnamese equivalent for better geocoding.
 * Returns the best query string to use with Nominatim.
 */
function resolveLocationQuery(location: string): string[] {
  const lower = location.toLowerCase().trim();

  // Try to match district aliases from the location text
  // Extract the district part (before any comma or the whole string)
  const parts = lower.split(',').map(p => p.trim());
  
  const queries: string[] = [];

  // Check each part against aliases
  for (const part of parts) {
    if (DISTRICT_ALIASES[part]) {
      queries.push(DISTRICT_ALIASES[part]);
      break;
    }
  }

  // Also try the full location with "Quận" prefix for district numbers
  const districtMatch = lower.match(/district\s*(\d+)/i) || lower.match(/\bd(\d+)\b/i);
  if (districtMatch && !queries.length) {
    const num = districtMatch[1];
    const cityPart = lower.includes('hanoi') || lower.includes('ha noi')
      ? 'Hà Nội'
      : lower.includes('da nang')
        ? 'Đà Nẵng'
        : 'Hồ Chí Minh';
    queries.push(`Quận ${num}, ${cityPart}`);
  }

  // Always include the original as fallback
  queries.push(location);

  return queries;
}

/**
 * Geocode a location string to coordinates using Nominatim.
 * Uses Vietnamese district name mappings for precise results.
 */
export async function geocodeLocation(location: string): Promise<{ lat: number; lng: number } | null> {
  const queryStrings = resolveLocationQuery(location);

  for (const q of queryStrings) {
    const encoded = encodeURIComponent(q);
    // Try with countrycodes=vn first, then without
    const urls = [
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=vn&limit=3&addressdetails=1`,
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=3&addressdetails=1`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.length > 0) {
          // Prefer boundary/administrative results over random POIs
          const best = data.find((r: any) =>
            r.class === 'boundary' || r.class === 'place' && r.type === 'suburb'
          ) || data.find((r: any) =>
            r.addresstype === 'suburb' || r.addresstype === 'city_district'
          ) || data[0];

          return { lat: parseFloat(best.lat), lng: parseFloat(best.lon) };
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}
