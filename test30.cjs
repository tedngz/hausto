const env = require('fs').readFileSync('.env', 'utf-8');
const url = env.match(/VITE_SUPABASE_URL="(.*?)"/)[1];
const key = env.match(/VITE_SUPABASE_PUBLISHABLE_KEY="(.*?)"/)[1];

async function deleteBadListings() {
  const res = await fetch(`${url}/rest/v1/external_properties?source=eq.housingsgn&source_url=not.like.*properties*`, {
    method: 'DELETE',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || key}` // The REST API requires service_role for unconditional deletes, but let's try
    }
  });
  console.log(res.status);
}
deleteBadListings();
