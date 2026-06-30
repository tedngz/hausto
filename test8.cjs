const http = require('https');
http.get('https://housingsgn.com/d1mension-for-rent/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // Print a snippet of the text content
    const text = data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(text.substring(0, 1500));
  });
});
