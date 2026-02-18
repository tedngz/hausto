import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Vietnamese district aliases for precise geocoding
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
  'ba dinh': 'Quận Ba Đình, Hà Nội',
  'hoan kiem': 'Quận Hoàn Kiếm, Hà Nội',
  'dong da': 'Quận Đống Đa, Hà Nội',
  'cau giay': 'Quận Cầu Giấy, Hà Nội',
  'hai ba trung': 'Quận Hai Bà Trưng, Hà Nội',
  'tay ho': 'Quận Tây Hồ, Hà Nội',
  'hai chau': 'Quận Hải Châu, Đà Nẵng',
  'son tra': 'Quận Sơn Trà, Đà Nẵng',
};

function resolveLocationQuery(location: string): string[] {
  const lower = location.toLowerCase().trim();
  const parts = lower.split(',').map(p => p.trim());
  const queries: string[] = [];

  for (const part of parts) {
    if (DISTRICT_ALIASES[part]) {
      queries.push(DISTRICT_ALIASES[part]);
      break;
    }
  }

  const districtMatch = lower.match(/district\s*(\d+)/i) || lower.match(/\bd(\d+)\b/i);
  if (districtMatch && !queries.length) {
    const num = districtMatch[1];
    const cityPart = lower.includes('hanoi') || lower.includes('ha noi')
      ? 'Hà Nội' : lower.includes('da nang') ? 'Đà Nẵng' : 'Hồ Chí Minh';
    queries.push(`Quận ${num}, ${cityPart}`);
  }

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

    // Get properties in smaller batches to avoid timeout
    const { data: properties, error } = await supabase
      .from("properties")
      .select("id, location")
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

    // Also geocode external_properties
    const { data: extProps } = await supabase
      .from("external_properties")
      .select("id, location")
      .limit(20);

    for (const prop of extProps || []) {
      await new Promise((r) => setTimeout(r, 1100));
      const coords = await geocodeAddress(prop.location);
      if (coords) {
        await supabase
          .from("external_properties")
          .update({ latitude: coords.lat, longitude: coords.lon })
          .eq("id", prop.id);
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
