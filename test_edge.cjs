const fetch = require('node-fetch');

async function testCrawl() {
  console.log('Invoking scrape-marketplace...');
  const res = await fetch('https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/scrape-marketplace', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZ3J3amRteXRha3NyenRjeXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDQwNDcsImV4cCI6MjA2NzYyMDA0N30.pJnXggzvzGxHrOaF_ygThG7Ws66Y4VFH102iQtPS118'
    },
    body: JSON.stringify({
      marketplace: 'housingsgn',
      location: 'ho_chi_minh',
      maxResults: 2,
      rawMode: false,
      directSave: true
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
