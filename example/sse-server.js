const express = require('express')
const serveStatic = require('serve-static')
const SseStream = require('ssestream')

const app = express()
app.use(serveStatic(__dirname))
app.get('/sse', (req, res) => {
  console.log('new connection')

  const sseStream = new SseStream(req)
  sseStream.pipe(res)
  const pusher = setInterval(() => {
    sseStream.write({
      event: 'server-time',
      data: new Date().toTimeString(),
    })
  }, 1000)

  res.on('close', () => {
    console.log('lost connection')
    clearInterval(pusher)
    sseStream.unpipe(res)
  })
})

app.get('/sse-403', (req, res) => {
  res.status(403)
    .send()
})

app.listen(8080, (err) => {
  if (err) throw err
  console.log('server ready on http://localhost:8080')
})
