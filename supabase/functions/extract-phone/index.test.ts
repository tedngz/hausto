import "https://deno.land/std@0.224.0/dotenv/load.ts";

Deno.test("BQL evaluate: using variables", async () => {
  const BROWSERLESS_API_KEY = Deno.env.get("BROWSERLESS_API_KEY");
  if (!BROWSERLESS_API_KEY) { console.log("skip"); return; }

  const jsCode = `(async () => { 
    await new Promise(r => setTimeout(r, 1000));
    var links = document.querySelectorAll('a[href^="tel:"]');
    var phones = [];
    for (var i = 0; i < links.length; i++) { phones.push(links[i].getAttribute('href')); }
    var bodyMatch = document.body.innerText.match(/0[3-9]\\d\\d[\\s.-]?\\d{3}[\\s.-]?\\d{4}/);
    return JSON.stringify({ telLinks: phones, bodyMatch: bodyMatch ? bodyMatch[0] : null });
  })()`;

  const query = `mutation Test($url: String!, $js: String!) {
  goto(url: $url, waitUntil: networkIdle) {
    status
  }
  result: evaluate(content: $js, timeout: 10000) {
    value
  }
}`;

  const res = await fetch(`https://production-sfo.browserless.io/chromium/bql?token=${BROWSERLESS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      query,
      variables: {
        url: "https://batdongsan.com.vn/cho-thue-can-ho-chung-cu-vinhomes-ocean-park-gia-lam-xa-gia-lam-tp-ha-noi/cho-tot-tai-studio-1n-2n-3n-pr45177341",
        js: jsCode,
      }
    }),
  });
  const body = await res.text();
  console.log(`Variables style - Status: ${res.status}, Body: ${body.substring(0, 800)}`);
});
