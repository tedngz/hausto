const http = require('https');
http.get('https://housingsgn.com/d1mension-for-rent/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // try to find prices in the page
    const matches = data.match(/\True[\d,.]+\s*(vnd|usd|million|tri?u|t?)/gi);
    console.log(matches ? matches.slice(0, 10) : 'No prices found');
  });
});
