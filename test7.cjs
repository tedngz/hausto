const http = require('https');
http.get('https://housingsgn.com/d1mension-for-rent/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // Extract property links from inside the project page
    const links = [...data.matchAll(/href=["'](https:\/\/housingsgn\.com\/[^\/]+)\/?["']/g)].map(m => m[1]);
    console.log([...new Set(links)]);
  });
});
