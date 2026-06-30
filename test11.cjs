const http = require('https');
http.get('https://housingsgn.com/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const prices = data.match(/\True[\d,.]+\s*(vnd|usd|million|tri?u|t?)/gi);
    console.log(prices ? prices.slice(0, 10) : 'No prices found');
  });
});
