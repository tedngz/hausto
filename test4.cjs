const http = require('https');
http.get('https://housingsgn.com/properties/luxury-apartment-in-district-1/', (res) => {
  console.log('Status Code:', res.statusCode);
});
