const http = require('https');
http.get('https://housingsgn.com/d1mension-for-rent/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(data.substring(0, 5000));
  });
});
