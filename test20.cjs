const http = require('https');
http.get('https://housingsgn.com/apartment-for-rent-in-one-verandah-thu-duc/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // Strip scripts, styles
    let text = data.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // Print lines containing '$' or 'VND' or 'Bedroom'
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.includes('$') || line.includes('VND') || line.includes('Bedroom')) {
        console.log(line.replace(/<[^>]+>/g, '').trim());
      }
    }
  });
});
