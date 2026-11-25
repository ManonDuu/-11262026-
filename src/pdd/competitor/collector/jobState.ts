import type { CollectorImageMeta, CollectorJobPublic, CollectorOptionMeta, CollectorPhase, CollectorProgress } from './types'
import { createNavTrace } from './navTrace'
import type { CaptureCoverageSummary } from '../coverage'

export interface CollectorJobInternal extends CollectorJobPublic {
  imageBytes: Record<string, Uint8Array>
  continueWaiters: Array<() => void>
  cancelRequested: boolean
  navigationUrl?: string
  restoreUrl?: string
  targetRestoresUsed?: number
  unavailableFirstHitAt?: number
}

function emptyProgress(): CollectorProgress {
  return { step: 'idle', heroFound: 0, detailFound: 0, optionFound: 0, optionTotal: null, heroExpected: null }
}

export function createCollectorJob(input: { goodsId: string; canonicalUrl: string; navigationUrl?: string; restoreUrl?: string; entryKind?: CollectorJobPublic['entryKind'] }): CollectorJobInternal {
  const now = Date.now()
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `job-${now}`
  return {
    id,
    goodsId: input.goodsId,
    canonicalUrl: input.canonicalUrl,
    phase: 'launching',
    message: '正在打开专用采集窗口…',
    progress: emptyProgress(),
    images: [],
    options: [],
    canContinue: false,
    startedAt: now,
    updatedAt: now,
    imageBytes: {},
    continueWaiters: [],
    cancelRequested: false,
    navigationUrl: input.navigationUrl,
    restoreUrl: input.restoreUrl,
    entryKind: input.entryKind,
    targetRestoresUsed: 0,
    navTrace: createNavTrace({
      entryKind: input.entryKind,
      navigationUrl: input.navigationUrl,
      restoreUrl: input.restoreUrl,
      canonicalUrl: input.canonicalUrl,
    }),
  }
}

export function publicJob(job: CollectorJobInternal): CollectorJobPublic {
  const { imageBytes: _bytes, continueWaiters: _waiters, cancelRequested: _cancel, navigationUrl: _nav, restoreUrl: _restore, targetRestoresUsed: _restores, unavailableFirstHitAt: _unavail, ...rest } = job
  return rest
}

export function updateJob(
  job: CollectorJobInternal,
  patch: Partial<Pick<CollectorJobInternal, 'phase' | 'message' | 'coverage' | 'images' | 'options' | 'canContinue' | 'lastError' | 'pageSignals' | 'goodsId' | 'canonicalUrl' | 'navTrace'>> & { progress?: Partial<CollectorProgress> },
): CollectorJobInternal {
  job.updatedAt = Date.now()
  if (patch.phase) job.phase = patch.phase
  if (patch.message !== undefined) job.message = patch.message
  if (patch.coverage) job.coverage = patch.coverage
  if (patch.images) job.images = patch.images
  if (patch.options) job.options = patch.options
  if (patch.canContinue !== undefined) job.canContinue = patch.canContinue
  if (patch.progress) job.progress = { ...job.progress, ...patch.progress }
  if (patch.lastError) job.lastError = patch.lastError
  if (patch.pageSignals) job.pageSignals = patch.pageSignals
  if (patch.goodsId !== undefined) job.goodsId = patch.goodsId
  if (patch.canonicalUrl !== undefined) job.canonicalUrl = patch.canonicalUrl
  if (patch.navTrace !== undefined) job.navTrace = patch.navTrace
  return job
}

export function requestContinue(job: CollectorJobInternal): { ok: boolean; message: string } {
  if (job.cancelRequested) return { ok: false, message: '采集已取消。' }
  if (job.phase !== 'awaiting_login' && job.phase !== 'awaiting_continue' && job.phase !== 'awaiting_captcha') {
    return { ok: false, message: '当前不需要继续，采集窗口仍在处理或已结束。' }
  }
  const waiters = job.continueWaiters.splice(0)
  waiters.forEach((resolve) => resolve())
  job.canContinue = false
  job.phase = 'capturing'
  job.message = '已收到继续指令，正在采集可见图片…'
  job.updatedAt = Date.now()
  return { ok: true, message: job.message }
}

export function requestCancel(job: CollectorJobInternal): void {
  job.cancelRequested = true
  job.phase = 'cancelled'
  job.message = '已取消采集。'
  job.canContinue = false
  job.updatedAt = Date.now()
  const waiters = job.continueWaiters.splice(0)
  waiters.forEach((resolve) => resolve())
}

export function waitForContinue(job: CollectorJobInternal, timeoutMs = 15 * 60 * 1000): Promise<'continued' | 'cancelled' | 'timeout'> {
  if (job.cancelRequested) return Promise.resolve('cancelled')
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      job.continueWaiters = job.continueWaiters.filter((item) => item !== onContinue)
      if (!job.cancelRequested && (job.phase === 'awaiting_login' || job.phase === 'awaiting_continue')) {
        resolve('timeout')
      }
    }, timeoutMs)
    const onContinue = () => {
      clearTimeout(timer)
      resolve(job.cancelRequested ? 'cancelled' : 'continued')
    }
    job.continueWaiters.push(onContinue)
  })
}

export function attachImage(job: CollectorJobInternal, meta: CollectorImageMeta, bytes?: Uint8Array): void {
  const images = job.images.filter((item) => item.id !== meta.id)
  images.push(meta)
  images.sort((a, b) => a.category.localeCompare(b.category) || a.order - b.order)
  job.images = images
  if (bytes && bytes.length && meta.bytesStatus === 'ok') job.imageBytes[meta.id] = bytes
  job.updatedAt = Date.now()
}

export function setOptions(job: CollectorJobInternal, options: CollectorOptionMeta[]): void {
  job.options = options
  job.updatedAt = Date.now()
}

export function isActivePhase(phase: CollectorPhase): boolean {
  return phase === 'launching' || phase === 'awaiting_login' || phase === 'awaiting_captcha' || phase === 'capturing' || phase === 'awaiting_continue'
}
