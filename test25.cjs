const http = require('https');
http.get('https://housingsgn.com/properties/td02369-2br-river-view-apartment-for-rent-in-one-verandah-thu-duc-city/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const links = [...data.matchAll(/<img[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
    console.log(links.filter(l => l.includes('uploads')));
  });
});
