import { mkdtempSync, readFileSync } from 'fs'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { AddressInfo } from 'net'
import { describe, expect, it } from 'vitest'
import { createChromePageCaptureStore } from './chromePageCapturePairing'
import { CHROME_PAGE_CAPTURE_PREFIX, createChromePageCaptureHandler } from './chromePageCapturePlugin'
import type { DownloadImageFn } from './chromePageCapturePersist'

const EXT = 'abcdefghijklmnopabcdefghijklmnop'
const OTHER_EXT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const HERO = 'https://img.pddpic.com/hero.jpg'
const DETAIL = 'https://img.pddpic.com/detail.jpg'
const OPTION = 'https://img.pddpic.com/opt.jpg'

const stubDownload: DownloadImageFn = async (raw) => {
  if (raw.includes('fail')) return { bytes: new Uint8Array(), mimeType: '', status: 'unavailable' }
  return { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg', status: 'ok' }
}

function startServer() {
  const store = createChromePageCaptureStore()
  const importRoot = mkdtempSync(join(tmpdir(), 'pdd-ext-import-'))
  const options = { expectedHost: '127.0.0.1:5173', downloadImage: stubDownload, importRoot }
  const handler = createChromePageCaptureHandler(store, options)
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handler(req, res, () => {
      res.statusCode = 204
      res.end()
    })
  })
  return new Promise<{ close: () => Promise<void>; url: string; host: string; store: typeof store; importRoot: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      const host = `127.0.0.1:${addr.port}`
      options.expectedHost = host
      resolve({
        store,
        host,
        importRoot,
        url: `http://${host}`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

async function request(
  ctx: { url: string; host: string },
  path: string,
  init: {
    method?: string
    origin?: string
    host?: string
    headers?: Record<string, string>
    body?: unknown
  } = {},
) {
  const headers: Record<string, string> = {
    Host: init.host || ctx.host,
    ...(init.origin ? { Origin: init.origin } : {}),
    ...(init.headers || {}),
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${ctx.url}${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: 'manual',
  })
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data, allowOrigin: res.headers.get('access-control-allow-origin') }
}

describe('扩展导入专用端点', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>

  it('启动本机测试端口', async () => {
    ctx = await startServer()
    expect(ctx.url.startsWith('http://127.0.0.1:')).toBe(true)
  })

  it('现有采集前缀不被该插件接管', async () => {
    const res = await request(ctx, '/__competitor-capture/start', { method: 'POST', origin: ctx.url, body: {} })
    expect(res.status).toBe(204)
  })

  it('网页 Origin 不能配对、兑换或导入，也不能用 * CORS', async () => {
    const boot = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/bootstrap`, { origin: ctx.url })
    const csrf = (boot.data as { csrf: string }).csrf
    const webArm = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/arm`, {
      method: 'POST',
      origin: 'https://mobile.yangkeduo.com',
      headers: { 'X-Capture-CSRF': csrf },
    })
    expect(webArm.status).toBe(403)
    const extArm = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/arm`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { 'X-Capture-CSRF': csrf },
    })
    expect(extArm.status).toBe(403)
    const web = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/redeem`, {
      method: 'POST',
      origin: 'https://mobile.yangkeduo.com',
      body: {},
    })
    expect(web.status).toBe(403)
    expect(web.allowOrigin).toBeNull()
    const workbench = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/redeem`, {
      method: 'POST',
      origin: ctx.url,
      body: {},
    })
    expect(workbench.status).toBe(403)
  })

  it('错误 Host 或非工作台生成请求会被拒绝', async () => {
    const badHost = await new Promise<{ status: number }>((resolve, reject) => {
      const url = new URL(ctx.url)
      const req = httpRequest({
        hostname: url.hostname,
        port: url.port,
        path: `${CHROME_PAGE_CAPTURE_PREFIX}/pair/bootstrap`,
        method: 'GET',
        headers: { Host: 'example.com', Origin: 'http://127.0.0.1:5173' },
      }, (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode || 0 }))
      })
      req.on('error', reject)
      req.end()
    })
    expect(badHost.status).toBe(403)
  })

  it('工作台一点开始配对，扩展用自身 Origin 完成后才能导入并保存图片文件', async () => {
    const boot = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/bootstrap`, { origin: ctx.url })
    expect(boot.status).toBe(200)
    const csrf = (boot.data as { csrf: string }).csrf
    const armed = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/arm`, {
      method: 'POST',
      origin: ctx.url,
      headers: { 'X-Capture-CSRF': csrf },
    })
    expect(armed.status).toBe(200)
    expect(JSON.stringify(armed.data)).not.toMatch(/"token"|"pairCode"|[a-f0-9]{64}/)
    const redeemed = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/redeem`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      body: {},
    })
    expect(redeemed.status).toBe(200)
    expect((redeemed.data as { token: string }).token).toMatch(/^[a-f0-9]{64}$/)
    expect(redeemed.allowOrigin).toBe(`chrome-extension://${EXT}`)
    const second = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/redeem`, {
      method: 'POST',
      origin: `chrome-extension://${OTHER_EXT}`,
      body: {},
    })
    expect(second.status).toBe(403)

    const expected = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/expected-goods`, {
      method: 'POST',
      origin: ctx.url,
      headers: { 'X-Capture-CSRF': csrf },
      body: { goodsId: '100000000001' },
    })
    expect(expected.status).toBe(200)
    expect((expected.data as { expectedGoodsId: string }).expectedGoodsId).toBe('100000000001')

    const token = (redeemed.data as { token: string }).token
    const empty = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { Authorization: `Bearer ${token}` },
      body: { path: '/goods2.html', hero: [], detail: [], options: [], optionsInspected: false },
    })
    expect(empty.status).toBe(400)

    const ok = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { Authorization: `Bearer ${token}` },
      body: {
        path: '/goods2.html',
        hero: [{ sourceUrl: HERO, width: 800, height: 800 }],
        detail: [{ sourceUrl: DETAIL }],
        options: [{ optionName: '套餐A', sourceUrl: OPTION }],
        optionsInspected: true,
        captureId: 'cap-testsuccess0001',
        goodsId: '100000000001',
        itemIdSource: 'og_url',
      },
    })
    expect(ok.status).toBe(200)
    const summary = ok.data as {
      heroCount: number
      heroSaved: number
      detailSaved: number
      optionSaved: number
      optionNames: string[]
      acceptedAsComplete: boolean
      message: string
      folder: string
      files: Array<{ fileName: string; kind: string; optionName?: string }>
      captureId: string
      stage: string
      identityStatus: string
      lastCapture: { captureId: string; stage: string }
    }
    expect(summary.heroCount).toBe(1)
    expect(summary.heroSaved).toBe(1)
    expect(summary.detailSaved).toBe(1)
    expect(summary.optionSaved).toBe(1)
    expect(summary.optionNames).toEqual(['套餐A'])
    expect(summary.acceptedAsComplete).toBe(true)
    expect(summary.stage).toBe('success')
    expect(summary.identityStatus).toBe('verified')
    expect(summary.captureId).toBe('cap-testsuccess0001')
    expect(summary.lastCapture.stage).toBe('success')
    expect(summary.lastCapture.captureId).toBe('cap-testsuccess0001')
    expect(summary.message).toMatch(/本地文件完成验收/)
    expect(JSON.stringify(summary)).not.toMatch(/pddpic\.com|sourceUrl|https:\/\//)
    const saved = readFileSync(join(ctx.importRoot, summary.folder, 'hero-001.jpg'))
    expect(saved.byteLength).toBe(4)
    expect(summary.files.some((item) => item.kind === 'option' && item.optionName === '套餐A')).toBe(true)
  })

  it('只收到链接但下载失败时不能算验收完成', async () => {
    const boot = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/bootstrap`, { origin: ctx.url })
    const csrf = (boot.data as { csrf: string }).csrf
    await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/arm`, {
      method: 'POST',
      origin: ctx.url,
      headers: { 'X-Capture-CSRF': csrf },
    })
    // new session needed? redeemOpenArm after previous already redeemed will fail.
    // Use leftover issue/redeem code path? Or arm again then redeem - but existing session for EXT already exists.
    // arm again + redeem with same EXT should replace session.
    const redeemed = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/redeem`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      body: {},
    })
    expect(redeemed.status).toBe(200)
    const token = (redeemed.data as { token: string }).token
    const failed = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { Authorization: `Bearer ${token}` },
      body: {
        path: '/goods2.html',
        hero: [{ sourceUrl: 'https://img.pddpic.com/fail-hero.jpg' }],
        detail: [{ sourceUrl: 'https://img.pddpic.com/fail-detail.jpg' }],
        options: [{ optionName: '套餐A', sourceUrl: 'https://img.pddpic.com/fail-opt.jpg' }],
        optionsInspected: true,
      },
    })
    expect(failed.status).toBe(200)
    const summary = failed.data as { acceptedAsComplete: boolean; bytesSaved: boolean; message: string; stage: string }
    expect(summary.acceptedAsComplete).toBe(false)
    expect(summary.bytesSaved).toBe(false)
    expect(summary.stage).toBe('download_failed')
    expect(summary.message).toMatch(/不能算取图成功/)
  })

  it('同源 GET 不带 Origin 时，可用 Sec-Fetch-Site: same-origin 读取状态；跨站或缺信号则拒绝', async () => {
    const ok = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/status`, {
      headers: {
        'Sec-Fetch-Site': 'same-origin',
        Referer: `${ctx.url}${CHROME_PAGE_CAPTURE_PREFIX}/pair`,
      },
    })
    expect(ok.status).toBe(200)
    expect((ok.data as { armed?: boolean }).armed).toBe(false)

    const refererOnly = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/status`, {
      headers: { Referer: `${ctx.url}${CHROME_PAGE_CAPTURE_PREFIX}/pair` },
    })
    expect(refererOnly.status).toBe(200)

    const bare = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/status`)
    expect(bare.status).toBe(403)

    const cross = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/status`, {
      headers: { 'Sec-Fetch-Site': 'cross-site', Referer: 'https://example.com/' },
    })
    expect(cross.status).toBe(403)
  })

  it('POST 开始配对仍然要求精确 Origin 和 CSRF，不能靠无 Origin 的请求完成', async () => {
    const boot = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/bootstrap`, {
      headers: {
        'Sec-Fetch-Site': 'same-origin',
        Referer: `${ctx.url}${CHROME_PAGE_CAPTURE_PREFIX}/pair`,
      },
    })
    expect(boot.status).toBe(200)
    const csrf = (boot.data as { csrf: string }).csrf
    const noOrigin = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/arm`, {
      method: 'POST',
      headers: {
        'X-Capture-CSRF': csrf,
        'Sec-Fetch-Site': 'same-origin',
        Referer: `${ctx.url}${CHROME_PAGE_CAPTURE_PREFIX}/pair`,
      },
    })
    expect(noOrigin.status).toBe(403)
    const armed = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/arm`, {
      method: 'POST',
      origin: ctx.url,
      headers: { 'X-Capture-CSRF': csrf },
    })
    expect(armed.status).toBe(200)
    expect(JSON.stringify(armed.data)).not.toMatch(/"token"|"pairCode"|[a-f0-9]{64}/)
  })

  async function pairToken() {
    const boot = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/bootstrap`, { origin: ctx.url })
    const csrf = (boot.data as { csrf: string }).csrf
    await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/arm`, {
      method: 'POST',
      origin: ctx.url,
      headers: { 'X-Capture-CSRF': csrf },
    })
    const redeemed = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/redeem`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      body: {},
    })
    expect(redeemed.status).toBe(200)
    return { csrf, token: (redeemed.data as { token: string }).token }
  }

  it('诊断上报能区分解析被拦、空图和敏感路径，且不把个人路径或查询参数写入记录', async () => {
    const { token } = await pairToken()
    const blocked = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { Authorization: `Bearer ${token}` },
      body: {
        captureId: 'cap-parseblocked0001',
        stage: 'parse_blocked',
        path: '/login.html?from=%2Fgoods2.html%3Fps%3Dsecret-token',
        message: '当前是登录页 https://mobile.yangkeduo.com/login.html?ps=secret-token',
      },
    })
    expect(blocked.status).toBe(200)
    const blockedData = blocked.data as { stage: string; lastCapture: { path: string | null; message: string; captureId: string }; acceptedAsComplete: boolean }
    expect(blockedData.stage).toBe('parse_blocked')
    expect(blockedData.acceptedAsComplete).toBe(false)
    expect(blockedData.lastCapture.path).toBe('/login.html')
    expect(JSON.stringify(blockedData)).not.toMatch(/ps=|secret-token/)
    expect(JSON.stringify(blockedData)).not.toMatch(/[a-f0-9]{64}/)

    const empty = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { Authorization: `Bearer ${token}` },
      body: { captureId: 'cap-parseempty0000001', stage: 'parse_empty', path: '/goods2.html', message: '没有在页面上看到主图、详情图或已选套餐图。' },
    })
    expect(empty.status).toBe(200)
    expect((empty.data as { stage: string }).stage).toBe('parse_empty')

    const sensitive = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { Authorization: `Bearer ${token}` },
      body: { captureId: 'cap-urlrejected000001', stage: 'url_rejected', path: '/personal.html?ticket=abcdef', message: '当前页不是可采集的商品页。' },
    })
    expect(sensitive.status).toBe(200)
    const sensitiveData = sensitive.data as { lastCapture: { path: string | null; pathKind: string } }
    expect(sensitiveData.lastCapture.path).toBe(null)
    expect(sensitiveData.lastCapture.pathKind).toBe('sensitive')
    expect(JSON.stringify(sensitiveData)).not.toContain('personal.html')
    expect(JSON.stringify(sensitiveData)).not.toContain('ticket=')
  })

  it('商品身份不符会拒绝导入，仅地址栏编号或未设置目标时不会认定通过', async () => {
    const { csrf, token } = await pairToken()
    const setId = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/expected-goods`, {
      method: 'POST',
      origin: ctx.url,
      headers: { 'X-Capture-CSRF': csrf },
      body: { goodsId: '100000000001' },
    })
    expect(setId.status).toBe(200)

    const mismatch = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { Authorization: `Bearer ${token}` },
      body: {
        path: '/goods2.html',
        captureId: 'cap-mismatch00000001',
        goodsId: '1022650930715',
        itemIdSource: 'og_url',
        hero: [{ sourceUrl: HERO, width: 800, height: 800 }],
        detail: [{ sourceUrl: DETAIL }],
        options: [{ optionName: '套餐A', sourceUrl: OPTION }],
        optionsInspected: true,
      },
    })
    expect(mismatch.status).toBe(409)
    expect((mismatch.data as { stage: string }).stage).toBe('goods_mismatch')
    expect((mismatch.data as { lastCapture: { identityStatus: string } }).lastCapture.identityStatus).toBe('mismatch')
    expect(JSON.stringify(mismatch.data)).not.toMatch(/pddpic\.com|sourceUrl/)

    const urlOnly = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { Authorization: `Bearer ${token}` },
      body: {
        path: '/goods2.html',
        captureId: 'cap-urlonly000000001',
        goodsId: '100000000001',
        itemIdSource: 'location_query',
        hero: [{ sourceUrl: HERO, width: 800, height: 800 }],
        detail: [{ sourceUrl: DETAIL }],
        options: [{ optionName: '套餐A', sourceUrl: OPTION }],
        optionsInspected: true,
      },
    })
    expect(urlOnly.status).toBe(200)
    const urlSummary = urlOnly.data as { acceptedAsComplete: boolean; stage: string; identityStatus: string; folder: string }
    expect(urlSummary.identityStatus).toBe('unverified')
    expect(urlSummary.acceptedAsComplete).toBe(false)
    expect(urlSummary.stage).toBe('partial')
    expect(urlSummary.folder).toBeTruthy()

    const clear = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/expected-goods`, {
      method: 'POST',
      origin: ctx.url,
      headers: { 'X-Capture-CSRF': csrf },
      body: { goodsId: '' },
    })
    expect(clear.status).toBe(200)
    const noTarget = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { Authorization: `Bearer ${token}` },
      body: {
        path: '/goods2.html',
        captureId: 'cap-notarget00000001',
        goodsId: '100000000001',
        itemIdSource: 'og_url',
        hero: [{ sourceUrl: HERO, width: 800, height: 800 }],
        detail: [{ sourceUrl: DETAIL }],
        options: [{ optionName: '套餐A', sourceUrl: OPTION }],
        optionsInspected: true,
      },
    })
    expect((noTarget.data as { identityStatus: string; acceptedAsComplete: boolean }).identityStatus).toBe('unverified')
    expect((noTarget.data as { acceptedAsComplete: boolean }).acceptedAsComplete).toBe(false)
  })

  it('错误令牌会被拒绝；保存目标编号仍要求工作台 Origin 和 CSRF', async () => {
    const { csrf, token } = await pairToken()
    const denied = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`, {
      method: 'POST',
      origin: `chrome-extension://${EXT}`,
      headers: { Authorization: `Bearer ${'ab' * 32}` },
      body: { stage: 'parse_empty', path: '/goods2.html' },
    })
    expect(denied.status).toBe(403)
    expect(JSON.stringify(denied.data)).not.toContain(token)

    const noCsrf = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/expected-goods`, {
      method: 'POST',
      origin: ctx.url,
      body: { goodsId: '100000000001' },
    })
    expect(noCsrf.status).toBe(403)
    const cross = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/pair/expected-goods`, {
      method: 'POST',
      origin: 'https://example.com',
      headers: { 'X-Capture-CSRF': csrf },
      body: { goodsId: '100000000001' },
    })
    expect(cross.status).toBe(403)
  })

  it('最近一次导入含诊断记录，且测试目录不会写到默认导入根', async () => {
    const last = await request(ctx, `${CHROME_PAGE_CAPTURE_PREFIX}/last-import`, { origin: ctx.url })
    expect(last.status).toBe(200)
    const data = last.data as { lastCapture: { captureId: string; stage: string } | null; recentCaptures: unknown[]; folder?: string }
    expect(data.lastCapture).toBeTruthy()
    expect(Array.isArray(data.recentCaptures)).toBe(true)
    expect(JSON.stringify(data)).not.toMatch(/pddpic\.com|sourceUrl|Authorization|Bearer/)
    expect(JSON.stringify(data)).not.toMatch(/[a-f0-9]{64}/)
    if (data.folder) {
      expect(data.folder.includes('chrome-page-capture-imports')).toBe(false)
    }
  })

  it('关闭测试端口', async () => {

    await ctx.close()
  })
})
