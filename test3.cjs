const https = require('https');
https.get('https://housingsgn.com/properties/123', (res) => {
  console.log('Status Code:', res.statusCode);
});
