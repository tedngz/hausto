const http = require('https');
http.get('https://housingsgn.com/advanced-search?q=district-1', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const links = [...data.matchAll(/href=["'](\/[^"']+|https:\/\/housingsgn\.com[^"']+)["']/g)].map(m => m[1]);
    console.log([...new Set(links)]);
  });
});
