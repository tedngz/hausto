const http = require('https');
http.get('https://housingsgn.com/d1mension-for-rent/', (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
});
