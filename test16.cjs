const http = require('https');
http.get('https://housingsgn.com/apartment-for-rent-in-tan-dinh-ward-ho-chi-minh-city/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    let text = data.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(text.substring(0, 500));
  });
});
