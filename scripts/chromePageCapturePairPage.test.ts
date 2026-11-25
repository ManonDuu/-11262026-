import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { AddressInfo } from 'net'
import { JSDOM, VirtualConsole } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createChromePageCaptureStore } from './chromePageCapturePairing'
import { CHROME_PAGE_CAPTURE_PREFIX, createChromePageCaptureHandler } from './chromePageCapturePlugin'

function startServer() {
  const store = createChromePageCaptureStore()
  const options = { expectedHost: '127.0.0.1:5173' }
  const handler = createChromePageCaptureHandler(store, options)
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handler(req, res, () => {
      res.statusCode = 204
      res.end()
    })
  })
  return new Promise<{ close: () => Promise<void>; url: string; host: string; store: typeof store }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      const host = `127.0.0.1:${addr.port}`
      options.expectedHost = host
      resolve({
        store,
        host,
        url: `http://${host}`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

describe('工作台配对页按钮', () => {
  it('点击开始配对会立即反馈，并向本机服务完成开始配对', async () => {
    const ctx = await startServer()
    try {
      const pageRes = await fetch(`${ctx.url}${CHROME_PAGE_CAPTURE_PREFIX}/pair`)
      const html = await pageRes.text()
      expect(pageRes.status).toBe(200)
      expect(html).toContain(`${CHROME_PAGE_CAPTURE_PREFIX}/pair.js`)
      expect(html).not.toMatch(/<script>(?:\s|\n)*async function/)
      expect(html).toContain('id="arm"')

      const jsRes = await fetch(`${ctx.url}${CHROME_PAGE_CAPTURE_PREFIX}/pair.js`)
      const script = await jsRes.text()
      expect(jsRes.status).toBe(200)
      expect(jsRes.headers.get('content-type')).toMatch(/javascript/)
      expect(script).toContain('正在开始配对')

      const blocked = await fetch(`${ctx.url}${CHROME_PAGE_CAPTURE_PREFIX}/pair.js`, {
        headers: { Origin: 'https://mobile.yangkeduo.com' },
      })
      expect(blocked.status).toBe(403)

      const htmlWithoutSrc = html.replace(/<script src="\/__pdd-extension\/pair\.js"><\/script>/, '')
      const dom = new JSDOM(htmlWithoutSrc, {
        url: `${ctx.url}${CHROME_PAGE_CAPTURE_PREFIX}/pair`,
        runScripts: 'dangerously',
        beforeParse(window) {
          window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
            const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            const target = raw.startsWith('/') ? `${ctx.url}${raw}` : raw
            const headers = new Headers(init?.headers)
            const method = String(init?.method || 'GET').toUpperCase()
            // 模拟常见浏览器：同源 GET 不带 Origin，POST 自动带 Origin；并带上 Sec-Fetch-Site。
            if (method !== 'GET' && method !== 'HEAD' && !headers.has('Origin')) headers.set('Origin', ctx.url)
            if (!headers.has('Sec-Fetch-Site')) headers.set('Sec-Fetch-Site', 'same-origin')
            if (!headers.has('Referer')) headers.set('Referer', `${ctx.url}${CHROME_PAGE_CAPTURE_PREFIX}/pair`)
            return fetch(target, { ...init, headers })
          }) as typeof fetch
        },
      })
      const errors: string[] = []
      const { window } = dom
      window.addEventListener('error', (event) => errors.push(String(event.error || event.message)))
      try {
        window.eval(script)
      } catch (error) {
        errors.push(String(error))
      }
      if (!window.document.getElementById('arm')?.onclick && window.document.readyState === 'loading') {
        window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
      }
      const out = window.document.getElementById('out')
      const arm = window.document.getElementById('arm') as HTMLButtonElement
      expect(arm).toBeTruthy()
      expect(errors, errors.join('\n')).toEqual([])
      arm.click()
      const started = await new Promise<string>((resolve, reject) => {
        const start = Date.now()
        const timer = setInterval(() => {
          const text = out?.textContent || ''
          if (text.includes('已开始配对') || text.includes('失败')) {
            clearInterval(timer)
            resolve(text)
          } else if (Date.now() - start > 2000) {
            clearInterval(timer)
            reject(new Error(`配对页未给出结果：${text}`))
          }
        }, 20)
      })
      expect(started).toMatch(/已开始配对/)
      expect(out?.textContent).toMatch(/已开始配对/)
      expect(JSON.stringify(out?.textContent)).not.toMatch(/[a-f0-9]{64}/)

      const statusRes = await fetch(`${ctx.url}${CHROME_PAGE_CAPTURE_PREFIX}/pair/status`, {
        headers: { Origin: ctx.url },
      })
      const status = await statusRes.json() as { armed: boolean; paired: boolean }
      expect(status.armed).toBe(true)
      expect(status.paired).toBe(false)
    } finally {
      await ctx.close()
    }
  })
})
