const env = require('fs').readFileSync('.env', 'utf-8');
const key = env.match(/VITE_SUPABASE_PUBLISHABLE_KEY="(.*?)"/)[1];
const url = env.match(/VITE_SUPABASE_URL="(.*?)"/)[1];
async function checkFunc() {
  const res = await fetch('https://api.supabase.com/v1/projects/gbgrwjdmytaksrztcyzs/functions/scrape-marketplace', {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` }
  });
  console.log(res.status);
}
checkFunc();
