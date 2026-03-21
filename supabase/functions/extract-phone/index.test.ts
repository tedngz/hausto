import "https://deno.land/std@0.224.0/dotenv/load.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

Deno.test("extract-phone: full test with JS evaluate", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-phone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      propertyId: "test-id",
      sourceUrl: "https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-vinhomes-ocean-park-gia-lam-xa-gia-lam-tp-ha-noi/cho-tot-tai-studio-1n-2n-3n-pr45177341",
      marketplace: "batdongsan",
    }),
  });

  const body = await response.text();
  console.log(`Status: ${response.status}`);
  console.log(`Body: ${body}`);
});
