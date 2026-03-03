import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Ward-level aliases for precise geocoding (most specific)
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
  'phu my': 'Phường Phú Mỹ, Quận 7, Hồ Chí Minh',
  // HCMC — Binh Thanh
  'hang xanh': 'Hàng Xanh, Bình Thạnh, Hồ Chí Minh',
  'ward 22': 'Phường 22, Bình Thạnh, Hồ Chí Minh',
  // HCMC — Phu Nhuan
  'phan xich long': 'Phan Xích Long, Phú Nhuận, Hồ Chí Minh',
  // Hanoi — Hoan Kiem
  'hang bai': 'Phường Hàng Bài, Hoàn Kiếm, Hà Nội',
  'hang bong': 'Phường Hàng Bông, Hoàn Kiếm, Hà Nội',
  'phan chu trinh': 'Phường Phan Chu Trinh, Hoàn Kiếm, Hà Nội',
  'trang tien': 'Phường Tràng Tiền, Hoàn Kiếm, Hà Nội',
  // Hanoi — Tay Ho
  'quang an': 'Phường Quảng An, Tây Hồ, Hà Nội',
  'xuan la': 'Phường Xuân La, Tây Hồ, Hà Nội',
  // Hanoi — Ba Dinh
  'lieu giai': 'Phường Liễu Giai, Ba Đình, Hà Nội',
  'kim ma': 'Phường Kim Mã, Ba Đình, Hà Nội',
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
  // Da Nang — Thanh Khe
  'thac gian': 'Phường Thạc Gián, Thanh Khê, Đà Nẵng',
  'an khe': 'Phường An Khê, Thanh Khê, Đà Nẵng',
  // Da Nang — Cam Le
  'hoa an': 'Phường Hòa An, Cẩm Lệ, Đà Nẵng',
  'hoa tho dong': 'Phường Hòa Thọ Đông, Cẩm Lệ, Đà Nẵng',
  // Da Nang — Lien Chieu
  'hoa minh': 'Phường Hòa Minh, Liên Chiểu, Đà Nẵng',
  'hoa hiep nam': 'Phường Hòa Hiệp Nam, Liên Chiểu, Đà Nẵng',
};

// Vietnamese district aliases for geocoding
const DISTRICT_ALIASES: Record<string, string> = {
  'd1': 'Quận 1, Hồ Chí Minh', 'd2': 'Quận 2, Thủ Đức, Hồ Chí Minh',
  'd3': 'Quận 3, Hồ Chí Minh', 'd4': 'Quận 4, Hồ Chí Minh',
  'd5': 'Quận 5, Hồ Chí Minh', 'd6': 'Quận 6, Hồ Chí Minh',
  'd7': 'Quận 7, Hồ Chí Minh', 'd8': 'Quận 8, Hồ Chí Minh',
  'd9': 'Quận 9, Thủ Đức, Hồ Chí Minh', 'd10': 'Quận 10, Hồ Chí Minh',
  'd11': 'Quận 11, Hồ Chí Minh', 'd12': 'Quận 12, Hồ Chí Minh',
  'district 1': 'Quận 1, Hồ Chí Minh', 'district 2': 'Quận 2, Thủ Đức, Hồ Chí Minh',
  'district 3': 'Quận 3, Hồ Chí Minh', 'district 4': 'Quận 4, Hồ Chí Minh',
  'district 5': 'Quận 5, Hồ Chí Minh', 'district 6': 'Quận 6, Hồ Chí Minh',
  'district 7': 'Quận 7, Hồ Chí Minh', 'district 8': 'Quận 8, Hồ Chí Minh',
  'district 9': 'Quận 9, Thủ Đức, Hồ Chí Minh', 'district 10': 'Quận 10, Hồ Chí Minh',
  'district 11': 'Quận 11, Hồ Chí Minh', 'district 12': 'Quận 12, Hồ Chí Minh',
  'binh thanh': 'Quận Bình Thạnh, Hồ Chí Minh',
  'phu nhuan': 'Quận Phú Nhuận, Hồ Chí Minh',
  'tan binh': 'Quận Tân Bình, Hồ Chí Minh',
  'tan phu': 'Quận Tân Phú, Hồ Chí Minh',
  'go vap': 'Quận Gò Vấp, Hồ Chí Minh',
  'thu duc': 'Thành phố Thủ Đức, Hồ Chí Minh',
  'binh tan': 'Quận Bình Tân, Hồ Chí Minh',
  'binh chanh': 'Huyện Bình Chánh, Hồ Chí Minh',
  'nha be': 'Huyện Nhà Bè, Hồ Chí Minh',
  'ba dinh': 'Quận Ba Đình, Hà Nội',
  'hoan kiem': 'Quận Hoàn Kiếm, Hà Nội',
  'dong da': 'Quận Đống Đa, Hà Nội',
  'cau giay': 'Quận Cầu Giấy, Hà Nội',
  'hai ba trung': 'Quận Hai Bà Trưng, Hà Nội',
  'tay ho': 'Quận Tây Hồ, Hà Nội',
  'long bien': 'Quận Long Biên, Hà Nội',
  'thanh xuan': 'Quận Thanh Xuân, Hà Nội',
  'hoang mai': 'Quận Hoàng Mai, Hà Nội',
  // Da Nang
  'hai chau': 'Quận Hải Châu, Đà Nẵng',
  'thanh khe': 'Quận Thanh Khê, Đà Nẵng',
  'son tra': 'Quận Sơn Trà, Đà Nẵng',
  'ngu hanh son': 'Quận Ngũ Hành Sơn, Đà Nẵng',
  'lien chieu': 'Quận Liên Chiểu, Đà Nẵng',
  'cam le': 'Quận Cẩm Lệ, Đà Nẵng',
};

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
  // Also try substring match on wards
  if (!queries.length) {
    for (const [key, val] of Object.entries(WARD_ALIASES)) {
      if (lower.includes(key)) {
        queries.push(val);
        break;
      }
    }
  }

  // 2. Try district-level aliases (exact part match)
  for (const part of parts) {
    if (DISTRICT_ALIASES[part]) {
      queries.push(DISTRICT_ALIASES[part]);
      break;
    }
  }
  // Also try substring match for districts
  if (queries.length < 2) {
    for (const [key, val] of Object.entries(DISTRICT_ALIASES)) {
      if (lower.includes(key) && !queries.includes(val)) {
        queries.push(val);
        break;
      }
    }
  }

  // 3. Try district number pattern
  const districtMatch = lower.match(/district\s*(\d+)/i) || lower.match(/\bd(\d+)\b/i);
  if (districtMatch && queries.length < 2) {
    const num = districtMatch[1];
    const cityPart = lower.includes('hanoi') || lower.includes('ha noi')
      ? 'Hà Nội'
      : lower.includes('da nang') || lower.includes('đà nẵng')
        ? 'Đà Nẵng'
        : 'Hồ Chí Minh';
    queries.push(`Quận ${num}, ${cityPart}`);
  }

  // 4. For full addresses, build a cleaned Vietnamese query
  // Replace English district/ward names with Vietnamese equivalents
  let cleaned = location;
  cleaned = cleaned.replace(/\bHo Chi Minh City\b/gi, 'Hồ Chí Minh');
  cleaned = cleaned.replace(/\bHo Chi Minh\b/gi, 'Hồ Chí Minh');
  cleaned = cleaned.replace(/\bDa Nang City\b/gi, 'Đà Nẵng');
  cleaned = cleaned.replace(/\bDa Nang\b/gi, 'Đà Nẵng');
  cleaned = cleaned.replace(/\bHanoi\b/gi, 'Hà Nội');
  cleaned = cleaned.replace(/\bDistrict\s*(\d+)/gi, 'Quận $1');
  cleaned = cleaned.replace(/\bWard\s*/gi, 'Phường ');
  cleaned = cleaned.replace(/\bStreet\b/gi, '');
  if (cleaned !== location) {
    queries.push(cleaned);
  }

  // Always include the original as fallback
  queries.push(location);

  return queries;
}

async function geocodeAddress(location: string): Promise<{ lat: number; lon: number } | null> {
  const queryStrings = resolveLocationQuery(location);

  for (const q of queryStrings) {
    const encoded = encodeURIComponent(q);
    for (const url of [
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=vn&limit=3&addressdetails=1`,
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=3&addressdetails=1`,
    ]) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Hausto-App/1.0" } });
        const data = await res.json();
        if (data && data.length > 0) {
          // Prefer boundary/administrative results
          const best = data.find((r: any) =>
            r.class === 'boundary' || (r.class === 'place' && r.type === 'suburb')
          ) || data.find((r: any) =>
            r.addresstype === 'suburb' || r.addresstype === 'city_district'
          ) || data[0];
          return { lat: parseFloat(best.lat), lon: parseFloat(best.lon) };
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Parse offset from request body
    let offset = 0;
    try {
      const body = await req.json();
      offset = body?.offset || 0;
    } catch { /* no body is fine */ }

    // Get properties without coordinates in smaller batches
    const { data: properties, error } = await supabase
      .from("properties")
      .select("id, location")
      .is("latitude", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + 19);

    if (error) throw error;

    const results: { id: string; status: string; lat?: number; lon?: number }[] = [];

    for (const prop of properties || []) {
      await new Promise((r) => setTimeout(r, 1100));

      const coords = await geocodeAddress(prop.location);
      if (coords) {
        const { error: updateErr } = await supabase
          .from("properties")
          .update({ latitude: coords.lat, longitude: coords.lon })
          .eq("id", prop.id);

        results.push({
          id: prop.id,
          status: updateErr ? "update_failed" : "geocoded",
          lat: coords.lat,
          lon: coords.lon,
        });
      } else {
        results.push({ id: prop.id, status: "not_found" });
      }
    }

    // Also geocode external_properties without coordinates
    const { data: extProps } = await supabase
      .from("external_properties")
      .select("id, location")
      .is("latitude", null)
      .limit(20);

    for (const prop of extProps || []) {
      await new Promise((r) => setTimeout(r, 1100));
      const coords = await geocodeAddress(prop.location);
      if (coords) {
        await supabase
          .from("external_properties")
          .update({ latitude: coords.lat, longitude: coords.lon })
          .eq("id", prop.id);
        results.push({ id: prop.id, status: "geocoded_external", lat: coords.lat, lon: coords.lon });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
