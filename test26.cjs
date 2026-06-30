const env = require('fs').readFileSync('.env', 'utf-8');
const url = env.match(/VITE_SUPABASE_URL="(.*?)"/)[1];
const key = env.match(/VITE_SUPABASE_PUBLISHABLE_KEY="(.*?)"/)[1];

async function checkDB() {
  const res = await fetch(`${url}/rest/v1/external_properties?source=eq.housingsgn&select=id,title,source_url,created_at&order=created_at.desc&limit=20`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
checkDB();
