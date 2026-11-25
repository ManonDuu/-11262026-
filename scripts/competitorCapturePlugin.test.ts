// @vitest-environment node
import { EventEmitter } from 'events'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createCaptureRequestHandler } from './competitorCapturePlugin'
import type { CollectorJobInternal } from '../src/pdd/competitor/collector/jobState'

function mockReq(method: string, url: string, body = '', origin = 'http://127.0.0.1:5173', remote = '127.0.0.1') {
  const req = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string>; socket: { remoteAddress: string } }
  req.method = method
  req.url = url
  req.headers = { origin, host: '127.0.0.1:5173' }
  req.socket = { remoteAddress: remote }
  queueMicrotask(() => {
    if (body) req.emit('data', Buffer.from(body))
    req.emit('end')
  })
  return req
}

function mockRes() {
  let statusCode = 200
  const headers: Record<string, string> = {}
  let raw = ''
  const res = {
    set statusCode(value: number) { statusCode = value },
    get statusCode() { return statusCode },
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value },
    end(chunk?: unknown) { raw = chunk == null ? '' : String(chunk) },
  }
  return {
    res: res as unknown as import('http').ServerResponse,
    result: () => ({ statusCode, headers, raw, json: raw ? JSON.parse(raw) : null }),
  }
}

async function invoke(handler: ReturnType<typeof createCaptureRequestHandler>, req: ReturnType<typeof mockReq>, resHolder: ReturnType<typeof mockRes>) {
  await new Promise<void>((resolve) => {
    const originalEnd = resHolder.res.end.bind(resHolder.res)
    resHolder.res.end = ((chunk?: unknown) => {
      originalEnd(chunk as never)
      resolve()
    }) as typeof resHolder.res.end
    handler(req as never, resHolder.res, () => resolve())
  })
  return resHolder.result()
}

describe('competitor capture HTTP handler', () => {
  it('拒绝非本机来源，并只接受规范化商品页', async () => {
    const handler = createCaptureRequestHandler({ startCollector: async () => {} })
    const remote = mockRes()
    await invoke(handler, mockReq('POST', '/__competitor-capture/start', '{}', 'http://127.0.0.1:5173', '8.8.8.8'), remote)
    expect(remote.result().statusCode).toBe(403)

    const bad = mockRes()
    await invoke(handler, mockReq('POST', '/__competitor-capture/start', JSON.stringify({ canonicalUrl: 'https://example.com/' })), bad)
    expect(bad.result().statusCode).toBe(400)
    expect(bad.result().json.error).toMatch(/拼多多|规范化|商品/)
  })

  it('用户点击开始后才启动采集，不会把未完成任务说成已取全', async () => {
    const started: string[] = []
    const handler = createCaptureRequestHandler({
      startCollector: async (job: CollectorJobInternal) => {
        started.push(job.canonicalUrl)
      },
    })
    const ok = mockRes()
    await invoke(handler, mockReq('POST', '/__competitor-capture/start', JSON.stringify({
      goodsId: '100000000001',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001',
    })), ok)
    expect(ok.result().statusCode).toBe(202)
    expect(ok.result().json.phase).toBe('launching')
    expect(ok.result().json.images).toEqual([])
    expect(started).toEqual(['https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001'])
  })
})


  it('开始采集的公开任务不含导航链接中的跟踪字段', async () => {
    const handler = createCaptureRequestHandler({ startCollector: async () => {} })
    const res = mockRes()
    const navigationUrl = 'https://mobile.yangkeduo.com/goods2.html?goods_id=1022650930715&pxq_secret_key=TEST_SECRET_DO_NOT_STORE'
    await invoke(handler, mockReq('POST', '/__competitor-capture/start', JSON.stringify({
      goodsId: '1022650930715',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=1022650930715',
      navigationUrl,
    })), res)
    const body = res.result()
    expect(body.statusCode).toBe(202)
    expect(body.raw).not.toMatch(/TEST_SECRET_DO_NOT_STORE|navigationUrl|pxq_secret_key/)
    expect(body.json.goodsId).toBe('1022650930715')
    expect(body.json.canonicalUrl).toBe('https://mobile.yangkeduo.com/goods2.html?goods_id=1022650930715')
    expect(body.json.phase).toBe('launching')
    expect(body.json).not.toHaveProperty('navigationUrl')
  })


describe('采集失败诊断', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdd-collector-status-'))
  const prev = process.env.PDD_COLLECTOR_LAST_STATUS_PATH

  it('启动失败时记录脱敏错误类别，不把原始异常或链接写进接口', async () => {
    process.env.PDD_COLLECTOR_LAST_STATUS_PATH = join(dir, 'last-status.json')
    const handler = createCaptureRequestHandler({
      startCollector: async () => {
        throw Object.assign(new Error('page.goto: Timeout 45000ms exceeded. navigating to "https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001&pxq_secret_key=TEST_SECRET_DO_NOT_STORE"'), { name: 'TimeoutError' })
      },
    })
    const started = mockRes()
    await invoke(handler, mockReq('POST', '/__competitor-capture/start', JSON.stringify({
      goodsId: '100000000001',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001',
    })), started)
    await new Promise((resolve) => setTimeout(resolve, 40))
    const statusRes = mockRes()
    await invoke(handler, mockReq('GET', '/__competitor-capture/last-status'), statusRes)
    const body = statusRes.result()
    expect(body.statusCode).toBe(200)
    expect(body.json.lastError.code).toBe('nav_timeout')
    expect(body.json.diagnosticText).toMatch(/nav_timeout/)
    expect(body.raw).not.toMatch(/TEST_SECRET_DO_NOT_STORE|pxq_secret_key/)
    if (prev === undefined) delete process.env.PDD_COLLECTOR_LAST_STATUS_PATH
    else process.env.PDD_COLLECTOR_LAST_STATUS_PATH = prev
    rmSync(dir, { recursive: true, force: true })
  })
})


describe('无编号分享链接启动', () => {
  it('无编号分享链接可以开始采集，公开响应不含分享查询', async () => {
    const opened: Array<{ goodsId: string; navigationUrl?: string; entryKind?: string }> = []
    const handler = createCaptureRequestHandler({
      startCollector: async (job: CollectorJobInternal) => {
        opened.push({ goodsId: job.goodsId, navigationUrl: job.navigationUrl, entryKind: job.entryKind })
      },
    })
    const res = mockRes()
    const navigationUrl = 'https://mobile.yangkeduo.com/goods2.html?ps=TEST_SHARE_TOKEN'
    await invoke(handler, mockReq('POST', '/__competitor-capture/start', JSON.stringify({
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html',
      navigationUrl,
    })), res)
    const body = res.result()
    expect(body.statusCode).toBe(202)
    expect(body.json.phase).toBe('launching')
    expect(body.json.goodsId).toBe('')
    expect(body.json.entryKind).toBe('raw_share_link')
    expect(body.json.canonicalUrl).toBe('https://mobile.yangkeduo.com/goods2.html')
    expect(body.json).not.toHaveProperty('navigationUrl')
    expect(body.raw).not.toMatch(/TEST_SHARE_TOKEN|navigationUrl|ps=TEST/)
    expect(opened).toEqual([{ goodsId: '', navigationUrl, entryKind: 'raw_share_link' }])
  })
})


describe('启动时保留用户原始导航地址', () => {
  it('同时提供短规范化地址和原始 ps 分享时，首次打开与恢复都保留 ps，不改用短地址', async () => {
    const opened: Array<{ entryKind?: string; navigationHasPs: boolean; restoreHasPs: boolean; navigationIsCanonical: boolean }> = []
    const handler = createCaptureRequestHandler({
      startCollector: async (job: CollectorJobInternal) => {
        const navigationUrl = job.navigationUrl || ''
        const restoreUrl = job.restoreUrl || job.navigationUrl || ''
        opened.push({
          entryKind: job.entryKind,
          navigationHasPs: /(?:^|[?&])ps=/.test(navigationUrl),
          restoreHasPs: /(?:^|[?&])ps=/.test(restoreUrl),
          navigationIsCanonical: navigationUrl === 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001',
        })
      },
    })
    const res = mockRes()
    await invoke(handler, mockReq('POST', '/__competitor-capture/start', JSON.stringify({
      goodsId: '100000000001',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001',
      navigationUrl: 'https://mobile.yangkeduo.com/goods2.html?ps=TEST_SHARE_TOKEN',
    })), res)
    const body = res.result()
    expect(body.statusCode).toBe(202)
    expect(body.json.entryKind).toBe('raw_share_link')
    expect(body.json.navTrace?.lastGoto).toBeUndefined()
    expect(body.json.navTrace?.outer?.hasPs).toBe(true)
    expect(body.json.navTrace?.outer?.hasGoodsId).toBe(false)
    expect(body.raw).not.toMatch(/TEST_SHARE_TOKEN|navigationUrl|ps=TEST/)
    expect(opened).toEqual([{ entryKind: 'raw_share_link', navigationHasPs: true, restoreHasPs: true, navigationIsCanonical: false }])
  })

  it('登录包装同时带短规范化地址时，首次打开外层，恢复保留内层查询名（含 ps 则不去掉）', async () => {
    const inner = 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001&ps=TEST_SHARE_TOKEN'
    const wrapped = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent(inner)}`
    const opened: Array<{ openIsLogin: boolean; restoreHasPs: boolean; restoreIsCanonical: boolean }> = []
    const handler = createCaptureRequestHandler({
      startCollector: async (job: CollectorJobInternal) => {
        opened.push({
          openIsLogin: /\/login\.html/.test(job.navigationUrl || ''),
          restoreHasPs: /(?:^|[?&])ps=/.test(job.restoreUrl || ''),
          restoreIsCanonical: job.restoreUrl === 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001',
        })
      },
    })
    const res = mockRes()
    await invoke(handler, mockReq('POST', '/__competitor-capture/start', JSON.stringify({
      goodsId: '100000000001',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001',
      navigationUrl: wrapped,
    })), res)
    const body = res.result()
    expect(body.statusCode).toBe(202)
    expect(body.json.entryKind).toBe('raw_login_wrapper')
    expect(body.json.navTrace?.outer?.hasFrom).toBe(true)
    expect(body.json.navTrace?.inner?.hasPs).toBe(true)
    expect(body.raw).not.toMatch(/TEST_SHARE_TOKEN|navigationUrl|ps=TEST/)
    expect(opened).toEqual([{ openIsLogin: true, restoreHasPs: true, restoreIsCanonical: false }])
  })
})
