var EventSource = require('..')
var es = new EventSource('http://localhost:8080/')
es.addEventListener('server-time', function (e) {
  console.log(e.data)
})

es.addEventListener('open', function (e) {
  console.log('Connection is open', e.data)
})


es.addEventListener('error', function (e) {
  console.log('connection error', e.data)
})
