const http = require('https');
http.get('https://housingsgn.com/apartment-for-rent-in-one-verandah-thu-duc/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const links = [...data.matchAll(/href=["'](https:\/\/housingsgn\.com\/[^"']+)["']/g)].map(m => m[1]);
    console.log(links.filter(l => l.includes('cal0') || l.includes('premium')));
  });
});
