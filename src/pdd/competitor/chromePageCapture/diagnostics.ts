/** 采集阶段诊断：不含凭证、查询参数或任意下载地址。 */

import { classifyPath, sanitizePath } from './pageGate'

export const MAX_CAPTURE_EVENTS = 20
export const MAX_CAPTURE_MESSAGE = 300
export const MAX_CAPTURE_ID_LENGTH = 64

export type CaptureStage =
  | 'url_rejected'
  | 'pairing_missing'
  | 'pairing_expired'
  | 'injection_error'
  | 'parse_blocked'
  | 'parse_empty'
  | 'goods_mismatch'
  | 'send_network_error'
  | 'http_rejected'
  | 'download_failed'
  | 'partial'
  | 'success'

export const CAPTURE_STAGES: readonly CaptureStage[] = [
  'url_rejected',
  'pairing_missing',
  'pairing_expired',
  'injection_error',
  'parse_blocked',
  'parse_empty',
  'goods_mismatch',
  'send_network_error',
  'http_rejected',
  'download_failed',
  'partial',
  'success',
] as const

export const DIAGNOSTIC_ONLY_STAGES: readonly CaptureStage[] = [
  'url_rejected',
  'pairing_missing',
  'pairing_expired',
  'injection_error',
  'parse_blocked',
  'parse_empty',
  'goods_mismatch',
  'send_network_error',
  'http_rejected',
] as const

export const STAGE_TITLES: Record<CaptureStage, string> = {
  url_rejected: 'URL 已拒绝',
  pairing_missing: '尚未配对',
  pairing_expired: '配对已过期',
  injection_error: '页面注入失败',
  parse_blocked: '页面解析被拦',
  parse_empty: '页面没有可采集图片',
  goods_mismatch: '商品身份不符',
  send_network_error: '发送到工作台失败',
  http_rejected: '工作台拒绝接收',
  download_failed: '图片下载失败',
  partial: '导入未完成验收',
  success: '已保存三类图片',
}

export const STAGE_BADGES: Record<CaptureStage, string> = {
  url_rejected: 'URL',
  pairing_missing: '配对',
  pairing_expired: '过期',
  injection_error: '注入',
  parse_blocked: '被拦',
  parse_empty: '空图',
  goods_mismatch: '不符',
  send_network_error: '发送',
  http_rejected: '拒绝',
  download_failed: '下载',
  partial: '部分',
  success: '完成',
}

export type GoodsIdSource = 'location_query' | 'og_url' | 'dom' | null
export type IdentityStatus = 'verified' | 'unverified' | 'mismatch' | 'not_applicable'

export type CaptureCounts = {
  hero: number
  detail: number
  options: number
}

export type CaptureEvent = {
  captureId: string
  stage: CaptureStage
  title: string
  message: string
  at: number
  path: string | null
  pathKind: 'goods' | 'sensitive' | 'other' | 'unknown'
  observedGoodsId: string | null
  expectedGoodsId: string | null
  identityStatus: IdentityStatus
  itemIdSource: GoodsIdSource
  identityReason: string
  counts: CaptureCounts
  reportDelivery: 'local_only' | 'sent' | 'send_network_error' | 'http_rejected' | 'not_applicable'
}

export function isCaptureStage(value: unknown): value is CaptureStage {
  return typeof value === 'string' && (CAPTURE_STAGES as readonly string[]).includes(value)
}

export function isDiagnosticOnlyStage(stage: CaptureStage): boolean {
  return (DIAGNOSTIC_ONLY_STAGES as readonly string[]).includes(stage)
}

export function normalizeGoodsId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  return /^\d{6,20}$/.test(text) ? text : null
}

export function isPageEvidenceSource(source: GoodsIdSource): boolean {
  return source === 'og_url' || source === 'dom'
}

export function evaluateGoodsIdentity(input: {
  expectedGoodsId?: unknown
  observedGoodsId?: unknown
  itemIdSource?: GoodsIdSource | unknown
}): { status: IdentityStatus; reason: string } {
  const expected = normalizeGoodsId(input.expectedGoodsId)
  const observed = normalizeGoodsId(input.observedGoodsId)
  const source = input.itemIdSource === 'location_query' || input.itemIdSource === 'og_url' || input.itemIdSource === 'dom'
    ? input.itemIdSource
    : null

  if (!expected) {
    return { status: 'unverified', reason: '工作台未设置目标商品编号，不能认定商品身份通过。' }
  }
  if (!observed) {
    return { status: 'unverified', reason: '页面没有可核验的商品编号证据，不能仅凭地址栏或缺失值认定通过。' }
  }
  if (observed !== expected) {
    return { status: 'mismatch', reason: '页面商品编号与目标不一致，已停止采集。' }
  }
  if (!isPageEvidenceSource(source)) {
    return { status: 'unverified', reason: '仅有地址栏商品编号，还不能代替商品详情证据。' }
  }
  return { status: 'verified', reason: '页面详情证据与目标商品编号一致。' }
}

export function sanitizeCaptureId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (text.length < 8 || text.length > MAX_CAPTURE_ID_LENGTH) return ''
  return /^[a-z0-9-]+$/i.test(text) ? text : ''
}

export function createCaptureId(randomBytes: () => Uint8Array = defaultRandomBytes): string {
  const bytes = randomBytes()
  const hex = Array.from(bytes, (item) => item.toString(16).padStart(2, '0')).join('').slice(0, 16)
  return `cap-${hex}`
}

function defaultRandomBytes(): Uint8Array {
  const bytes = new Uint8Array(8)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
    return bytes
  }
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

export function redactUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  try {
    const url = new URL(raw, 'https://mobile.yangkeduo.com/')
    const host = url.hostname || ''
    const path = (url.pathname || '').slice(0, 80)
    if (!host && !path) return '(redacted)'
    return `${host}${path}`
  } catch {
    return '(invalid-url)'
  }
}

export function clipMessage(value: unknown, max = MAX_CAPTURE_MESSAGE): string {
  if (typeof value !== 'string') return ''
  const text = value
    .replace(/https?:\/\/[^\s]+/gi, (match) => redactUrl(match) || '(redacted)')
    .replace(/[a-f0-9]{32,}/gi, '[redacted]')
    .trim()
  return text.slice(0, max)
}

export function retainCaptureEvents(events: CaptureEvent[], incoming: CaptureEvent, limit = MAX_CAPTURE_EVENTS): CaptureEvent[] {
  return [incoming, ...events.filter((item) => item.captureId !== incoming.captureId)].slice(0, limit)
}

export function publicCaptureEvent(event: CaptureEvent | undefined | null) {
  if (!event) return null
  return {
    captureId: event.captureId,
    stage: event.stage,
    title: event.title,
    message: clipMessage(event.message),
    at: event.at,
    path: event.path,
    pathKind: event.pathKind,
    observedGoodsId: event.observedGoodsId,
    expectedGoodsId: event.expectedGoodsId,
    identityStatus: event.identityStatus,
    itemIdSource: event.itemIdSource,
    identityReason: clipMessage(event.identityReason, 200),
    counts: event.counts,
    reportDelivery: event.reportDelivery,
  }
}

export function stageTitle(stage: CaptureStage): string {
  return STAGE_TITLES[stage]
}

export function formatLocalStatus(event: Pick<CaptureEvent, 'captureId' | 'stage' | 'title' | 'message'>): string {
  return `${event.title}（${event.stage}）\n采集编号：${event.captureId}\n${event.message}`
}

export function safeDiagnosticPath(pathname: unknown): { path: string | null; pathKind: CaptureEvent['pathKind'] } {
  const raw = typeof pathname === 'string' ? sanitizePath(pathname) : ''
  if (!raw) return { path: null, pathKind: 'unknown' }
  const kind = classifyPath(raw)
  if (kind === 'goods') return { path: raw, pathKind: 'goods' }
  if (/^\/login(?:\.html)?$/i.test(raw)) return { path: '/login.html', pathKind: 'sensitive' }
  if (kind === 'sensitive') return { path: null, pathKind: 'sensitive' }
  return { path: null, pathKind: 'other' }
}
