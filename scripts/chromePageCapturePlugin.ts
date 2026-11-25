import type { IncomingMessage, ServerResponse } from 'http'
import type { Plugin } from 'vite'
import { canExportDom, classifyPath, sanitizePath } from '../src/pdd/competitor/chromePageCapture/pageGate'
import {
  armOpenPairing,
  checkCsrfToken,
  createChromePageCaptureStore,
  issueCsrfToken,
  issuePairCode,
  nextCaptureId,
  publicImportSummary,
  publicLastCaptureView,
  publicPairingStatus,
  redeemOpenArm,
  redeemPairCode,
  rememberCaptureEvent,
  revokePairing,
  setExpectedGoodsId,
  verifySession,
  type ChromePageCaptureStore,
} from './chromePageCapturePairing'
import { canReadWorkbenchPairingGet, isChromeExtensionOrigin, isExactWorkbenchOrigin, isLoopbackPeer, parseChromeExtensionOrigin } from '../src/pdd/competitor/chromePageCapture/access'
import { sanitizeIncomingImport } from '../src/pdd/competitor/chromePageCapture/payload'
import { persistCapturedImages, type DownloadImageFn } from './chromePageCapturePersist'
import {
  clipMessage,
  evaluateGoodsIdentity,
  isCaptureStage,
  isDiagnosticOnlyStage,
  normalizeGoodsId,
  publicCaptureEvent,
  safeDiagnosticPath,
  stageTitle,
  type CaptureEvent,
  type CaptureStage,
  type GoodsIdSource,
} from '../src/pdd/competitor/chromePageCapture/diagnostics'

export const CHROME_PAGE_CAPTURE_PREFIX = '/__pdd-extension'
const MAX_BODY = 96 * 1024
const WORKBENCH_PORT = '5173'

function clientAddress(req: IncomingMessage): string | null {
  return req.socket.remoteAddress || null
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return typeof value === 'string' ? value : ''
}

function json(res: ServerResponse, status: number, body: unknown, corsOrigin?: string | null) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin)
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Capture-CSRF')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Vary', 'Origin')
  }
  res.end(JSON.stringify(body))
}

function html(res: ServerResponse, status: number, body: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      if (chunks.reduce((sum, item) => sum + item.length, 0) > MAX_BODY) {
        reject(new Error('请求过大'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function bearerToken(req: IncomingMessage): string {
  const raw = header(req, 'authorization')
  const match = raw.match(/^Bearer\s+([a-f0-9]{64})$/i)
  return match ? match[1] : ''
}


function asItemIdSource(value: unknown): GoodsIdSource {
  return value === 'location_query' || value === 'og_url' || value === 'dom' ? value : null
}

function countsFromUnknown(body: Record<string, unknown> | null): CaptureEvent['counts'] {
  const hero = Array.isArray(body?.hero) ? body!.hero.length : 0
  const detail = Array.isArray(body?.detail) ? body!.detail.length : 0
  const options = Array.isArray(body?.options) ? body!.options.filter((item) => item && typeof item === 'object' && (item as { sourceUrl?: unknown }).sourceUrl).length : 0
  return { hero, detail, options }
}

function makeCaptureEvent(input: {
  captureId?: unknown
  stage: CaptureStage
  message: string
  path?: unknown
  observedGoodsId?: unknown
  expectedGoodsId?: string | null
  itemIdSource?: unknown
  identityStatus?: CaptureEvent['identityStatus']
  identityReason?: string
  counts?: CaptureEvent['counts']
  reportDelivery?: CaptureEvent['reportDelivery']
  at?: number
}): CaptureEvent {
  const pathInfo = safeDiagnosticPath(input.path)
  const identity = evaluateGoodsIdentity({
    expectedGoodsId: input.expectedGoodsId,
    observedGoodsId: input.observedGoodsId,
    itemIdSource: asItemIdSource(input.itemIdSource),
  })
  return {
    captureId: nextCaptureId(input.captureId),
    stage: input.stage,
    title: stageTitle(input.stage),
    message: clipMessage(input.message) || stageTitle(input.stage),
    at: input.at || Date.now(),
    path: pathInfo.path,
    pathKind: pathInfo.pathKind,
    observedGoodsId: normalizeGoodsId(input.observedGoodsId),
    expectedGoodsId: input.expectedGoodsId || null,
    identityStatus: input.identityStatus || identity.status,
    itemIdSource: asItemIdSource(input.itemIdSource),
    identityReason: clipMessage(input.identityReason || identity.reason, 200),
    counts: input.counts || { hero: 0, detail: 0, options: 0 },
    reportDelivery: input.reportDelivery || 'sent',
  }
}

function pairPageScript(): string {
  return `function setBox(id, value) {
  const el = document.getElementById(id)
  if (el) el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

async function loadCsrf() {
  const res = await fetch('/__pdd-extension/pair/bootstrap', { credentials: 'same-origin' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '无法开始配对')
  return data.csrf
}

async function refresh() {
  try {
    const statusRes = await fetch('/__pdd-extension/pair/status', { credentials: 'same-origin' })
    const status = await statusRes.json()
    if (!statusRes.ok) {
      setBox('status', status.error || '无法读取配对状态')
    } else {
      setBox('status', status)
      const expected = document.getElementById('expectedGoodsId')
      if (expected && status.expectedGoodsId && !expected.value) expected.value = status.expectedGoodsId
    }
    const res = await fetch('/__pdd-extension/last-import', { credentials: 'same-origin' })
    const last = await res.json()
    setBox('last', last)
    const capture = last && last.lastCapture ? last.lastCapture : null
    setBox('capture', capture
      ? [capture.title + '（' + capture.stage + '）', '采集编号：' + capture.captureId, capture.message || '', capture.identityStatus ? ('身份：' + capture.identityStatus) : ''].filter(Boolean).join(String.fromCharCode(10))
      : '还没有采集诊断记录。')
  } catch (error) {
    setBox('status', String(error))
  }
}

async function startPairing() {
  setBox('out', '正在开始配对…')
  try {
    const csrf = await loadCsrf()
    const res = await fetch('/__pdd-extension/pair/arm', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Capture-CSRF': csrf },
    })
    const data = await res.json()
    setBox('out', data.message || data.error || JSON.stringify(data))
    await refresh()
  } catch (error) {
    setBox('out', '开始配对失败：' + String(error))
  }
}

async function revokePairing() {
  setBox('out', '正在撤销配对…')
  try {
    const csrf = await loadCsrf()
    const res = await fetch('/__pdd-extension/pair/revoke', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Capture-CSRF': csrf },
    })
    const data = await res.json()
    setBox('out', data.message || data.error || JSON.stringify(data))
    await refresh()
  } catch (error) {
    setBox('out', '撤销失败：' + String(error))
  }
}

async function saveExpected() {
  setBox('out', '正在保存目标商品编号…')
  try {
    const csrf = await loadCsrf()
    const input = document.getElementById('expectedGoodsId')
    const res = await fetch('/__pdd-extension/pair/expected-goods', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Capture-CSRF': csrf },
      body: JSON.stringify({ goodsId: input && 'value' in input ? String(input.value || '') : '' }),
    })
    const data = await res.json()
    setBox('out', data.message || data.error || JSON.stringify(data))
    await refresh()
  } catch (error) {
    setBox('out', '保存目标编号失败：' + String(error))
  }
}

function bind() {
  const arm = document.getElementById('arm')
  const revoke = document.getElementById('revoke')
  const save = document.getElementById('saveExpected')
  if (arm) arm.addEventListener('click', startPairing)
  if (revoke) revoke.addEventListener('click', revokePairing)
  if (save) save.addEventListener('click', saveExpected)
  refresh()
}

if (document.getElementById('arm')) {
  bind()
} else {
  document.addEventListener('DOMContentLoaded', bind)
}
`
}

function pairPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>本机扩展导入配对</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; line-height: 1.5; padding: 0 1rem; }
    code { background: #f3f3f3; padding: 0.1em 0.3em; }
    button { font: inherit; margin-right: 0.5rem; padding: 0.4rem 0.8rem; }
    .note { color: #444; }
    #out { min-height: 2.4em; padding: 0.6rem 0.8rem; background: #fff8d6; border: 1px solid #e6d889; }
    pre { background: #f6f6f6; padding: 0.6rem 0.8rem; overflow: auto; }
  </style>
</head>
<body>
  <h1>本机扩展导入</h1>
  <p>扩展已经装好后，在本页点「开始配对」，再到扩展选项页点一次「完成配对」。如弹出本机访问许可，请允许。本页不会显示密钥。</p>
  <p class="note">开始配对后大约 15 分钟内有效，方便你切到扩展页完成。配对成功后，打开商品详情页再点扩展图标。如规格图不全，先点开规格（不要点购买或确认），再点一次图标。本页会显示最近一次采集的阶段和编号，不会显示密钥。</p>
  <button type="button" id="arm">开始配对</button>
  <button type="button" id="revoke">撤销配对</button>
  <p><strong>操作结果</strong></p>
  <pre id="out">正在读取配对状态…</pre>
  <h2>目标商品编号</h2>
  <p class="note">可选。只填 6 到 20 位数字编号，不要粘贴完整链接或参数。未设置时不会把商品身份计为通过。</p>
  <p><input id="expectedGoodsId" inputmode="numeric" maxlength="20" placeholder="例如仅数字编号" /> <button type="button" id="saveExpected">保存目标编号</button></p>
  <h2>最近一次采集诊断</h2>
  <pre id="capture">还没有采集诊断记录。</pre>
  <h2>配对状态</h2>
  <pre id="status"></pre>
  <h2>最近一次导入</h2>
  <pre id="last"></pre>
  <script src="/__pdd-extension/pair.js"></script>
</body>
</html>`
}

export type ChromePageCaptureHandlerOptions = {
  expectedHost?: string
  downloadImage?: DownloadImageFn
  importRoot?: string
}

export function createChromePageCaptureHandler(store: ChromePageCaptureStore = createChromePageCaptureStore(), options?: ChromePageCaptureHandlerOptions) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const expectedHost = options?.expectedHost || `127.0.0.1:${WORKBENCH_PORT}`
    const rawUrl = req.url || ''
    const url = rawUrl.split('?')[0] || ''
    if (!url.startsWith(CHROME_PAGE_CAPTURE_PREFIX)) {
      next()
      return
    }

    const method = (req.method || 'GET').toUpperCase()
    const origin = header(req, 'origin')
    const host = header(req, 'host')
    const address = clientAddress(req)
    const extensionId = parseChromeExtensionOrigin(origin)

    const allowExtensionCors = Boolean(extensionId) && (url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair/redeem` || url === `${CHROME_PAGE_CAPTURE_PREFIX}/ingest`)
    const corsOrigin = allowExtensionCors ? origin : null

    void (async () => {
      try {
        if (!isLoopbackPeer(address) || host !== expectedHost) {
          json(res, 403, { error: '只接受本机工作台地址上的访问。' })
          return
        }

        if (method === 'OPTIONS' && corsOrigin && isChromeExtensionOrigin(origin)) {
          json(res, 204, {}, corsOrigin)
          return
        }

        if ((url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair` || url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair/`) && method === 'GET') {
          if (origin && !isExactWorkbenchOrigin(origin, expectedHost)) {
            json(res, 403, { error: '配对页只接受本机工作台打开。' })
            return
          }
          html(res, 200, pairPage())
          return
        }

        if (url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair.js` && method === 'GET') {
          if (origin && !isExactWorkbenchOrigin(origin, expectedHost)) {
            json(res, 403, { error: '配对脚本只接受本机工作台打开。' })
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(pairPageScript())
          return
        }

        if (url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair/bootstrap` && method === 'GET') {
          if (!canReadWorkbenchPairingGet({
            expectedHost,
            host,
            origin,
            referer: header(req, 'referer'),
            secFetchSite: header(req, 'sec-fetch-site'),
          }).ok) {
            json(res, 403, { error: '只接受本机工作台访问。' })
            return
          }
          json(res, 200, { csrf: issueCsrfToken(store) })
          return
        }

        if (url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair/status` && method === 'GET') {
          if (!canReadWorkbenchPairingGet({
            expectedHost,
            host,
            origin,
            referer: header(req, 'referer'),
            secFetchSite: header(req, 'sec-fetch-site'),
          }).ok) {
            json(res, 403, { error: '只接受本机工作台访问。' })
            return
          }
          json(res, 200, publicPairingStatus(store))
          return
        }

        if (url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair/arm` && method === 'POST') {
          if (!isExactWorkbenchOrigin(origin, expectedHost) || !checkCsrfToken(store, header(req, 'x-capture-csrf'))) {
            json(res, 403, { error: '只接受本机工作台的明确配对操作。' })
            return
          }
          const armed = armOpenPairing(store)
          json(res, 200, {
            ok: true,
            expiresAt: armed.expiresAt,
            expiresInSeconds: 15 * 60,
            message: '已开始配对。请到扩展选项页点一次「完成配对」，大约 15 分钟内有效。本页不会显示密钥。',
          })
          return
        }

        if (url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair/issue` && method === 'POST') {
          if (!isExactWorkbenchOrigin(origin, expectedHost) || !checkCsrfToken(store, header(req, 'x-capture-csrf'))) {
            json(res, 403, { error: '只接受本机工作台的明确配对操作。' })
            return
          }
          const body = JSON.parse((await readBody(req)) || '{}') as { extensionId?: string }
          const id = String(body.extensionId || '').trim().toLowerCase()
          if (!/^[a-p]{32}$/.test(id)) {
            json(res, 400, { error: '请填写 chrome://extensions 页面显示的 32 位扩展编号。' })
            return
          }
          const code = issuePairCode(store, id)
          json(res, 200, {
            pairCode: code,
            expiresInSeconds: 120,
            message: '请在两分钟内把配对码粘贴到扩展选项页。配对码只能使用一次。',
          })
          return
        }

        if (url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair/revoke` && method === 'POST') {
          if (!isExactWorkbenchOrigin(origin, expectedHost) || !checkCsrfToken(store, header(req, 'x-capture-csrf'))) {
            json(res, 403, { error: '只接受本机工作台的明确撤销操作。' })
            return
          }
          revokePairing(store)
          json(res, 200, { ok: true, message: '已撤销配对。' })
          return
        }

        if (url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair/expected-goods` && method === 'POST') {
          if (!isExactWorkbenchOrigin(origin, expectedHost) || !checkCsrfToken(store, header(req, 'x-capture-csrf'))) {
            json(res, 403, { error: '只接受本机工作台的明确配对操作。' })
            return
          }
          const body = JSON.parse((await readBody(req)) || '{}') as { goodsId?: unknown }
          const result = setExpectedGoodsId(store, body.goodsId)
          if (!result.ok) {
            json(res, 400, { error: result.reason })
            return
          }
          json(res, 200, {
            ok: true,
            expectedGoodsId: result.expectedGoodsId,
            message: result.expectedGoodsId ? '已保存目标商品编号，将用于核对页面身份。' : '已清除目标商品编号。未设置时不会把商品身份计为通过。',
          })
          return
        }

        if (url === `${CHROME_PAGE_CAPTURE_PREFIX}/last-import` && method === 'GET') {
          if (!canReadWorkbenchPairingGet({
            expectedHost,
            host,
            origin,
            referer: header(req, 'referer'),
            secFetchSite: header(req, 'sec-fetch-site'),
          }).ok) {
            json(res, 403, { error: '只接受本机工作台访问。' })
            return
          }
          const summary = publicImportSummary(store.lastImport)
          const captureView = publicLastCaptureView(store)
          json(res, 200, {
            ...(summary || { lastImport: null }),
            lastCapture: captureView.lastCapture,
            recentCaptures: captureView.recentCaptures,
            message: (summary && summary.message) || (captureView.lastCapture && captureView.lastCapture.message) || '还没有收到扩展导入。',
          })
          return
        }

        if (url === `${CHROME_PAGE_CAPTURE_PREFIX}/pair/redeem` && method === 'POST') {
          if (!extensionId) {
            json(res, 403, { error: '只接受已安装的本机扩展完成配对。' }, null)
            return
          }
          const body = JSON.parse((await readBody(req)) || '{}') as { pairCode?: string }
          const result = body.pairCode
            ? redeemPairCode(store, { code: body.pairCode, extensionId })
            : redeemOpenArm(store, { extensionId })
          if (!result.ok) {
            json(res, 403, { error: result.reason }, corsOrigin)
            return
          }
          json(res, 200, { token: result.token, expiresAt: result.expiresAt, expectedGoodsId: store.expectedGoodsId || null, message: '配对成功。请在已打开的商品页点击扩展图标。' }, corsOrigin)
          return
        }

        if (url === `${CHROME_PAGE_CAPTURE_PREFIX}/ingest` && method === 'POST') {
          if (!extensionId) {
            json(res, 403, { error: '只接受已配对的本机扩展导入。' })
            return
          }
          const verified = verifySession(store, { token: bearerToken(req), extensionId })
          if (!verified.ok) {
            json(res, 403, { error: verified.reason }, corsOrigin)
            return
          }
          const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
          const clientStage = isCaptureStage(body.stage) ? body.stage : null
          const observedGoodsId = body.goodsId ?? body.observedGoodsId
          const itemIdSource = body.itemIdSource
          const identity = evaluateGoodsIdentity({
            expectedGoodsId: store.expectedGoodsId,
            observedGoodsId,
            itemIdSource,
          })

          if (clientStage && isDiagnosticOnlyStage(clientStage)) {
            const stage = identity.status === 'mismatch' ? 'goods_mismatch' : clientStage
            const event = rememberCaptureEvent(store, makeCaptureEvent({
              captureId: body.captureId,
              stage,
              message: typeof body.message === 'string' && body.message ? body.message : stageTitle(stage),
              path: body.path,
              observedGoodsId,
              expectedGoodsId: store.expectedGoodsId || null,
              itemIdSource,
              identityStatus: identity.status,
              identityReason: identity.reason,
              counts: countsFromUnknown(body),
              reportDelivery: 'sent',
            }))
            json(res, 200, {
              ok: true,
              acceptedAsComplete: false,
              stage: event.stage,
              captureId: event.captureId,
              lastCapture: publicCaptureEvent(event),
              message: event.message,
              identityStatus: event.identityStatus,
            }, corsOrigin)
            return
          }

          if (identity.status === 'mismatch') {
            const event = rememberCaptureEvent(store, makeCaptureEvent({
              captureId: body.captureId,
              stage: 'goods_mismatch',
              message: identity.reason,
              path: body.path,
              observedGoodsId,
              expectedGoodsId: store.expectedGoodsId || null,
              itemIdSource,
              identityStatus: 'mismatch',
              identityReason: identity.reason,
              counts: countsFromUnknown(body),
              reportDelivery: 'sent',
            }))
            json(res, 409, {
              error: identity.reason,
              stage: 'goods_mismatch',
              captureId: event.captureId,
              lastCapture: publicCaptureEvent(event),
            }, corsOrigin)
            return
          }

          const path = sanitizePath(String(body.path || ''))
          if (classifyPath(path) !== 'goods') {
            json(res, 400, { error: '只接收商品详情页的分类结果。' }, corsOrigin)
            return
          }
          const record = sanitizeIncomingImport(body, path)
          const gate = canExportDom({
            pathname: record.path,
            blocked: false,
            heroCount: record.heroCount,
            detailCount: record.detailCount,
            optionImageCount: record.options.filter((item) => item.sourceUrl).length,
            optionsInspected: record.optionsInspected,
          })
          if (!gate.ok) {
            const event = rememberCaptureEvent(store, makeCaptureEvent({
              captureId: body.captureId,
              stage: 'http_rejected',
              message: gate.reason,
              path,
              observedGoodsId,
              expectedGoodsId: store.expectedGoodsId || null,
              itemIdSource,
              counts: { hero: record.heroCount, detail: record.detailCount, options: record.options.filter((item) => item.sourceUrl).length },
              reportDelivery: 'sent',
            }))
            json(res, 400, { error: gate.reason, stage: 'http_rejected', captureId: event.captureId, lastCapture: publicCaptureEvent(event) }, corsOrigin)
            return
          }
          const captureId = nextCaptureId(body.captureId)
          store.lastImport = await persistCapturedImages({
            record: {
              ...record,
              captureId,
              observedGoodsId: normalizeGoodsId(observedGoodsId),
              expectedGoodsId: store.expectedGoodsId || null,
              itemIdSource: asItemIdSource(itemIdSource),
              identityStatus: identity.status,
              identityReason: identity.reason,
            },
            downloadImage: options?.downloadImage,
            importRoot: options?.importRoot,
          })
          const filesComplete = Boolean(store.lastImport.acceptedAsComplete)
          const identityVerified = identity.status === 'verified'
          let stage: CaptureStage = 'partial'
          let message = store.lastImport.message || ''
          if ((store.lastImport.heroSaved || 0) + (store.lastImport.detailSaved || 0) + (store.lastImport.optionSaved || 0) === 0) {
            stage = 'download_failed'
          } else if (filesComplete && identityVerified) {
            stage = 'success'
          } else if (filesComplete && !identityVerified) {
            stage = 'partial'
            message = `${identity.reason} 三类图片文件已保存，但商品身份尚未核验通过，不能算目标商品验收完成。`
            store.lastImport.acceptedAsComplete = false
            store.lastImport.message = message
          } else {
            stage = store.lastImport.bytesSaved ? 'partial' : 'download_failed'
          }
          store.lastImport.captureId = captureId
          store.lastImport.stage = stage
          store.lastImport.identityStatus = identity.status
          store.lastImport.identityReason = identity.reason
          const event = rememberCaptureEvent(store, makeCaptureEvent({
            captureId,
            stage,
            message,
            path,
            observedGoodsId,
            expectedGoodsId: store.expectedGoodsId || null,
            itemIdSource,
            identityStatus: identity.status,
            identityReason: identity.reason,
            counts: { hero: store.lastImport.heroCount, detail: store.lastImport.detailCount, options: store.lastImport.optionCount },
            reportDelivery: 'sent',
          }))
          json(res, 200, { ...publicImportSummary(store.lastImport), lastCapture: publicCaptureEvent(event) }, corsOrigin)
          return
        }

        json(res, 404, { error: '未知的扩展导入接口。' })
      } catch {
        json(res, 400, { error: '请求无法处理。' }, corsOrigin)
      }
    })()
  }
}

export function chromePageCapturePlugin(): Plugin {
  const store = createChromePageCaptureStore()
  const handler = createChromePageCaptureHandler(store)
  return {
    name: 'pdd-chrome-page-capture',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handler(req as IncomingMessage, res as ServerResponse, next)
      })
    },
  }
}
