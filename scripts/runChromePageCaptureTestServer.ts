import { createServer } from 'http'
import { createChromePageCaptureHandler } from './chromePageCapturePlugin'
import { createChromePageCaptureStore } from './chromePageCapturePairing'

const port = Number(process.env.PDD_TEST_PORT || 5173)
const host = `127.0.0.1:${port}`
const store = createChromePageCaptureStore()
const handler = createChromePageCaptureHandler(store, { expectedHost: host })

const server = createServer((req, res) => {
  handler(req, res, () => {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('not found')
  })
})

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`listening http://${host}/__pdd-extension/pair`)
})
