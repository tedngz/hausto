const env = require('fs').readFileSync('.env', 'utf-8');
const url = env.match(/VITE_SUPABASE_URL="(.*?)"/)[1];
const key = env.match(/VITE_SUPABASE_PUBLISHABLE_KEY="(.*?)"/)[1];

async function testCrawl() {
  console.log('Invoking scrape-marketplace...');
  const res = await fetch(`${url}/functions/v1/scrape-marketplace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      marketplace: 'housingsgn',
      location: 'One Verandah',
      maxResults: 2,
      rawMode: false,
      directSave: false
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    console.error('Error:', res.status, err);
    return;
  }
  
  const data = await res.json();
  console.log('Success:', JSON.stringify(data, null, 2));
}
testCrawl();
