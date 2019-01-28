const https = require('https')

let n = 1;

const req = https.request('https://www.google.ba', (res) => {

  res.on('data', (chunk => {
    console.log(typeof chunk, n++)
  }))

})


req.end();
