// Ward-level aliases → precise Nominatim queries (checked before district aliases)
const WARD_ALIASES: Record<string, string> = {
  // HCMC — District 1
  'ben nghe': 'Phường Bến Nghé, Quận 1, Hồ Chí Minh',
  'ben thanh': 'Phường Bến Thành, Quận 1, Hồ Chí Minh',
  'da kao': 'Phường Đa Kao, Quận 1, Hồ Chí Minh',
  'nguyen thai binh': 'Phường Nguyễn Thái Bình, Quận 1, Hồ Chí Minh',
  'pham ngu lao': 'Phường Phạm Ngũ Lão, Quận 1, Hồ Chí Minh',
  'tan dinh': 'Phường Tân Định, Quận 1, Hồ Chí Minh',
  'co giang': 'Phường Cô Giang, Quận 1, Hồ Chí Minh',
  'cau kho': 'Phường Cầu Kho, Quận 1, Hồ Chí Minh',
  'cau ong lanh': 'Phường Cầu Ông Lãnh, Quận 1, Hồ Chí Minh',
  'nguyen cu trinh': 'Phường Nguyễn Cư Trinh, Quận 1, Hồ Chí Minh',
  // HCMC — District 2 / Thu Duc
  'thao dien': 'Phường Thảo Điền, Thủ Đức, Hồ Chí Minh',
  'an phu': 'Phường An Phú, Thủ Đức, Hồ Chí Minh',
  'thanh my loi': 'Phường Thạnh Mỹ Lợi, Thủ Đức, Hồ Chí Minh',
  'an khanh': 'Phường An Khánh, Thủ Đức, Hồ Chí Minh',
  'binh an': 'Phường Bình An, Thủ Đức, Hồ Chí Minh',
  'cat lai': 'Phường Cát Lái, Thủ Đức, Hồ Chí Minh',
  'binh trung dong': 'Phường Bình Trưng Đông, Thủ Đức, Hồ Chí Minh',
  'binh trung tay': 'Phường Bình Trưng Tây, Thủ Đức, Hồ Chí Minh',
  // HCMC — District 3
  'vo thi sau': 'Phường Võ Thị Sáu, Quận 3, Hồ Chí Minh',
  // HCMC — District 7
  'phu my hung': 'Phú Mỹ Hưng, Quận 7, Hồ Chí Minh',
  'tan phong': 'Phường Tân Phong, Quận 7, Hồ Chí Minh',
  // HCMC — Binh Thanh
  'hang xanh': 'Hàng Xanh, Bình Thạnh, Hồ Chí Minh',
  // HCMC — Phu Nhuan
  'phan xich long': 'Phan Xích Long, Phú Nhuận, Hồ Chí Minh',
  // Hanoi — Hoan Kiem
  'hang bai': 'Phường Hàng Bài, Hoàn Kiếm, Hà Nội',
  'hang bong': 'Phường Hàng Bông, Hoàn Kiếm, Hà Nội',
  'hang gai': 'Phường Hàng Gai, Hoàn Kiếm, Hà Nội',
  'phan chu trinh': 'Phường Phan Chu Trinh, Hoàn Kiếm, Hà Nội',
  'trang tien': 'Phường Tràng Tiền, Hoàn Kiếm, Hà Nội',
  'hang trong': 'Phường Hàng Trống, Hoàn Kiếm, Hà Nội',
  'ly thai to': 'Phường Lý Thái Tổ, Hoàn Kiếm, Hà Nội',
  // Hanoi — Tay Ho
  'quang an': 'Phường Quảng An, Tây Hồ, Hà Nội',
  'xuan la': 'Phường Xuân La, Tây Hồ, Hà Nội',
  'nhat tan': 'Phường Nhật Tân, Tây Hồ, Hà Nội',
  'tu lien': 'Phường Tứ Liên, Tây Hồ, Hà Nội',
  'phu thuong': 'Phường Phú Thượng, Tây Hồ, Hà Nội',
  // Hanoi — Ba Dinh
  'lieu giai': 'Phường Liễu Giai, Ba Đình, Hà Nội',
  'kim ma': 'Phường Kim Mã, Ba Đình, Hà Nội',
  'ngoc ha': 'Phường Ngọc Hà, Ba Đình, Hà Nội',
  'truc bach': 'Phường Trúc Bạch, Ba Đình, Hà Nội',
  'cong vi': 'Phường Cống Vị, Ba Đình, Hà Nội',
  // Hanoi — Cau Giay
  'dich vong': 'Phường Dịch Vọng, Cầu Giấy, Hà Nội',
  'dich vong hau': 'Phường Dịch Vọng Hậu, Cầu Giấy, Hà Nội',
  'nghia do': 'Phường Nghĩa Đô, Cầu Giấy, Hà Nội',
  'nghia tan': 'Phường Nghĩa Tân, Cầu Giấy, Hà Nội',
  // Hanoi — Dong Da
  'cat linh': 'Phường Cát Linh, Đống Đa, Hà Nội',
  'kham thien': 'Phường Khâm Thiên, Đống Đa, Hà Nội',
  'o cho dua': 'Phường Ô Chợ Dừa, Đống Đa, Hà Nội',
  'van mieu': 'Phường Văn Miếu, Đống Đa, Hà Nội',
  // Hanoi — Hai Ba Trung
  'bach khoa': 'Phường Bách Khoa, Hai Bà Trưng, Hà Nội',
  'thanh nhan': 'Phường Thanh Nhàn, Hai Bà Trưng, Hà Nội',
  'dong nhan': 'Phường Đồng Nhân, Hai Bà Trưng, Hà Nội',
  // Hanoi — Long Bien
  'ngoc thuy': 'Phường Ngọc Thụy, Long Biên, Hà Nội',
  'phuc dong': 'Phường Phúc Đồng, Long Biên, Hà Nội',
  'viet hung': 'Phường Việt Hưng, Long Biên, Hà Nội',
  // Da Nang — Hai Chau
  'hai chau 1': 'Phường Hải Châu 1, Hải Châu, Đà Nẵng',
  'hai chau 2': 'Phường Hải Châu 2, Hải Châu, Đà Nẵng',
  'thanh binh': 'Phường Thanh Bình, Hải Châu, Đà Nẵng',
  'thuan phuoc': 'Phường Thuận Phước, Hải Châu, Đà Nẵng',
  'hoa thuan tay': 'Phường Hòa Thuận Tây, Hải Châu, Đà Nẵng',
  'hoa thuan dong': 'Phường Hòa Thuận Đông, Hải Châu, Đà Nẵng',
  // Da Nang — Son Tra
  'an hai bac': 'Phường An Hải Bắc, Sơn Trà, Đà Nẵng',
  'an hai dong': 'Phường An Hải Đông, Sơn Trà, Đà Nẵng',
  'man thai': 'Phường Mân Thái, Sơn Trà, Đà Nẵng',
  'phuoc my': 'Phường Phước Mỹ, Sơn Trà, Đà Nẵng',
  'tho quang': 'Phường Thọ Quang, Sơn Trà, Đà Nẵng',
  // Da Nang — Ngu Hanh Son
  'my an': 'Phường Mỹ An, Ngũ Hành Sơn, Đà Nẵng',
  'khue my': 'Phường Khuê Mỹ, Ngũ Hành Sơn, Đà Nẵng',
  'hoa hai': 'Phường Hòa Hải, Ngũ Hành Sơn, Đà Nẵng',
};

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
  const parts = lower.split(',').map(p => p.trim());
  
  const queries: string[] = [];

  // 1. Try ward-level aliases first (most specific)
  for (const part of parts) {
    if (WARD_ALIASES[part]) {
      queries.push(WARD_ALIASES[part]);
      break;
    }
  }
  // Also check if the full location contains a ward name (substring match)
  if (!queries.length) {
    for (const [key, val] of Object.entries(WARD_ALIASES)) {
      if (lower.includes(key)) {
        queries.push(val);
        break;
      }
    }
  }

  // 2. Try district-level aliases
  for (const part of parts) {
    if (DISTRICT_ALIASES[part]) {
      queries.push(DISTRICT_ALIASES[part]);
      break;
    }
  }

  // 3. Try district number pattern
  const districtMatch = lower.match(/district\s*(\d+)/i) || lower.match(/\bd(\d+)\b/i);
  if (districtMatch && queries.length < 2) {
    const num = districtMatch[1];
    const cityPart = lower.includes('hanoi') || lower.includes('ha noi')
      ? 'Hà Nội'
      : lower.includes('da nang')
        ? 'Đà Nẵng'
        : 'Hồ Chí Minh';
    queries.push(`Quận ${num}, ${cityPart}`);
  }

  // 4. For full addresses, build a cleaned Vietnamese query
  let cleaned = location;
  cleaned = cleaned.replace(/\bHo Chi Minh City\b/gi, 'Hồ Chí Minh');
  cleaned = cleaned.replace(/\bHo Chi Minh\b/gi, 'Hồ Chí Minh');
  cleaned = cleaned.replace(/\bDa Nang City\b/gi, 'Đà Nẵng');
  cleaned = cleaned.replace(/\bDa Nang\b/gi, 'Đà Nẵng');
  cleaned = cleaned.replace(/\bHanoi\b/gi, 'Hà Nội');
  cleaned = cleaned.replace(/\bDistrict\s*(\d+)/gi, 'Quận $1');
  cleaned = cleaned.replace(/\bWard\b/gi, 'Phường');
  cleaned = cleaned.replace(/\bStreet\b/gi, '');
  if (cleaned !== location) {
    queries.push(cleaned);
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
