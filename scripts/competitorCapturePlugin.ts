import type { IncomingMessage, ServerResponse } from 'http'
import type { Plugin } from 'vite'
import { normalizeCompetitorLink, resolveNavigationUrl } from '../src/pdd/competitor/linkNormalize'
import { createCollectorJob, isActivePhase, publicJob, requestCancel, requestContinue, type CollectorJobInternal } from '../src/pdd/competitor/collector/jobState'
import { isAllowedWorkbenchOrigin, isLoopbackAddress } from '../src/pdd/competitor/collector/accessGuard'
import type { CollectorJobPublic } from '../src/pdd/competitor/collector/types'
import { getCollectorRuntimeInfo } from './collectorRuntime'
import { runCompetitorCollector } from './competitorCollector'
import { classifyCollectorError } from '../src/pdd/competitor/collector/errorClassify'
import { formatDiagnosticText, readLastStatus, toLastStatus, writeLastStatus } from './collectorLastStatus'

const PREFIX = '/__competitor-capture'

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function forbid(res: ServerResponse, message: string) {
  json(res, 403, { error: message })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      if (chunks.reduce((sum, item) => sum + item.length, 0) > 64 * 1024) {
        reject(new Error('请求过大'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function clientAddress(req: IncomingMessage): string | null {
  return req.socket.remoteAddress || null
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  if (origin) return isAllowedWorkbenchOrigin(origin)
  const host = typeof req.headers.host === 'string' ? req.headers.host : ''
  return host.startsWith('127.0.0.1:') || host.startsWith('localhost:')
}

export function createCaptureRequestHandler(options?: {
  startCollector?: (job: CollectorJobInternal) => Promise<void>
}): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  const startCollector = options?.startCollector || runCompetitorCollector
  let activeJob: CollectorJobInternal | null = null
  return (req, res, next) => {
    const rawUrl = req.url || ''
    const url = rawUrl.split('?')[0] || ''
    if (!url.startsWith(PREFIX)) {
      next()
      return
    }
    if (!isLoopbackAddress(clientAddress(req)) || !originAllowed(req)) {
      forbid(res, '采集接口只接受本机工作台访问。')
      return
    }

    const method = (req.method || 'GET').toUpperCase()
    void (async () => {
      try {
        if (url === `${PREFIX}/runtime` && method === 'GET') {
          const runtime = await getCollectorRuntimeInfo()
          json(res, 200, { ...runtime, lastStatus: readLastStatus() })
          return
        }
        if (url === `${PREFIX}/last-status` && method === 'GET') {
          const status = activeJob ? toLastStatus(publicJob(activeJob)) : readLastStatus()
          if (!status) {
            json(res, 404, { error: '还没有可复制的采集诊断。请先在工作台启动一次采集。' })
            return
          }
          const runtime = await getCollectorRuntimeInfo()
          json(res, 200, { ...status, diagnosticText: formatDiagnosticText(status, runtime) })
          return
        }
        if (url === `${PREFIX}/start` && method === 'POST') {
          const raw = await readBody(req)
          const body = raw ? JSON.parse(raw) as { goodsId?: string; canonicalUrl?: string; navigationUrl?: string } : {}
          const navSource = (body.navigationUrl || body.canonicalUrl || '').trim()
          const parsed = normalizeCompetitorLink(navSource)
          if (!parsed.ok || !parsed.canonicalUrl || !parsed.navigationUrl) {
            json(res, 400, { error: parsed.message || '请先提供可打开的商品链接。' })
            return
          }
          if (body.goodsId && parsed.goodsId && body.goodsId !== parsed.goodsId) {
            json(res, 400, { error: '商品编号与链接不一致。' })
            return
          }
          const nav = resolveNavigationUrl(body.navigationUrl || parsed.navigationUrl || parsed.canonicalUrl, parsed.goodsId || body.goodsId || '')
          if (!nav.ok) {
            json(res, 400, { error: nav.message })
            return
          }
          if (activeJob && isActivePhase(activeJob.phase)) {
            json(res, 409, { error: '已有采集正在进行。请先继续或取消当前采集。', ...publicJob(activeJob) })
            return
          }
          const job = createCollectorJob({ goodsId: parsed.goodsId || '', canonicalUrl: parsed.canonicalUrl, navigationUrl: nav.navigationUrl, restoreUrl: nav.restoreUrl, entryKind: nav.entryKind })
          activeJob = job
          void startCollector(job).catch((error) => {
            const info = classifyCollectorError(error, job.progress.step || 'launch')
            job.phase = 'failed'
            job.message = `${info.safeMessage} ${info.action}`
            job.lastError = info
            job.canContinue = false
            job.updatedAt = Date.now()
            writeLastStatus(publicJob(job))
          })
          json(res, 202, publicJob(job))
          return
        }

        const jobMatch = url.match(new RegExp(`^${PREFIX}/job/([^/]+)(?:/(continue|cancel|image/([^/]+)))?$`))
        if (jobMatch) {
          const jobId = decodeURIComponent(jobMatch[1])
          const action = jobMatch[2] || ''
          const imageId = jobMatch[3] ? decodeURIComponent(jobMatch[3]) : ''
          if (!activeJob || activeJob.id !== jobId) {
            json(res, 404, { error: '没有找到这个采集任务。' })
            return
          }
          if (action === 'continue' && method === 'POST') {
            const result = requestContinue(activeJob)
            json(res, result.ok ? 200 : 400, { ...publicJob(activeJob), error: result.ok ? undefined : result.message })
            return
          }
          if (action === 'cancel' && method === 'POST') {
            requestCancel(activeJob)
            json(res, 200, publicJob(activeJob))
            return
          }
          if (action.startsWith('image/') && method === 'GET') {
            const bytes = activeJob.imageBytes[imageId]
            const meta = activeJob.images.find((item) => item.id === imageId)
            if (!bytes || !meta) {
              json(res, 404, { error: '没有找到这张采集图片。' })
              return
            }
            res.statusCode = 200
            res.setHeader('Content-Type', meta.mimeType || 'image/jpeg')
            res.setHeader('Cache-Control', 'no-store')
            res.end(Buffer.from(bytes))
            return
          }
          if (!action && method === 'GET') {
            json(res, 200, publicJob(activeJob))
            return
          }
        }
        json(res, 404, { error: '未知的采集接口。' })
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : '采集接口出错' })
      }
    })()
  }
}

export function competitorCapturePlugin(): Plugin {
  return {
    name: 'competitor-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(createCaptureRequestHandler())
    },
  }
}

export type { CollectorJobPublic }
