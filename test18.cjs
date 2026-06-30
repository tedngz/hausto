const http = require('https');
http.get('https://housingsgn.com/?s=vinhomes', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const links = [...data.matchAll(/href=["'](https:\/\/housingsgn\.com\/properties\/[^\/]+)\/?["']/g)].map(m => m[1]);
    console.log([...new Set(links)]);
  });
});
