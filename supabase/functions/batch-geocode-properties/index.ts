import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const encoded = encodeURIComponent(address);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=vn&limit=1`,
      { headers: { "User-Agent": "Hausto-App/1.0" } }
    );
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get properties without coordinates
    const { data: properties, error } = await supabase
      .from("properties")
      .select("id, location")
      .or("latitude.is.null,longitude.is.null")
      .limit(50);

    if (error) throw error;

    const results: { id: string; status: string; lat?: number; lon?: number }[] = [];

    for (const prop of properties || []) {
      // Rate limit: Nominatim allows 1 req/sec
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
      .or("latitude.is.null,longitude.is.null")
      .limit(50);

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
