import "https://deno.land/std@0.224.0/dotenv/load.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

Deno.test("extract-phone: batdongsan listing", async () => {
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

Deno.test("extract-phone: debug BQL evaluate directly", async () => {
  // Test BQL evaluate with a simple script to isolate the issue
  const BROWSERLESS_API_KEY = Deno.env.get("BROWSERLESS_API_KEY");
  if (!BROWSERLESS_API_KEY) {
    console.log("No BROWSERLESS_API_KEY - skipping direct test");
    return;
  }

  // Test 1: Simple inline evaluate (no variables)
  const simpleQuery = `mutation Test {
  goto(url: "https://batdongsan.com.vn", waitUntil: networkIdle) {
    status
  }
  result: evaluate(content: "return document.title") {
    value
  }
}`;

  const res = await fetch(`https://production-sfo.browserless.io/chromium/bql?token=${BROWSERLESS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: simpleQuery }),
  });
  const body = await res.text();
  console.log(`Simple evaluate - Status: ${res.status}, Body: ${body}`);
});
