const http = require('https');
http.get('https://housingsgn.com/d1mension-for-rent/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // Remove scripts and styles
    let text = data.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // Strip tags
    text = text.replace(/<[^>]+>/g, ' ');
    // Remove extra whitespace
    text = text.replace(/\s+/g, ' ').trim();
    // Print around occurrences of "USD" or "VND"
    const regex = /.{0,50}(usd|vnd).{0,50}/gi;
    const matches = [...text.matchAll(regex)];
    console.log('Price mentions:');
    matches.slice(0, 5).forEach(m => console.log(m[0]));
    
    // Also print first 1000 chars of actual text
    console.log('\nText start:', text.substring(0, 1000));
  });
});
