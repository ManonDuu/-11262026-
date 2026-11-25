import type { CaptureBlockReason, CaptureDomResult } from './captureDom'
import { describeDetailCoverage, describeHeroCoverage, describeOptionCoverage, type CaptureCoverageSummary } from './coverage'

export const CAPTURE_PROTOCOL_VERSION = 1
export const CAPTURE_HELLO = 'pdd-competitor-capture-hello'
export const CAPTURE_ACK = 'pdd-competitor-capture-ack'
export const CAPTURE_RESULT = 'pdd-competitor-capture-result'
export const CAPTURE_BLOCKED = 'pdd-competitor-capture-blocked'

export const ALLOWED_PAGE_ORIGINS = [
  'https://mobile.yangkeduo.com',
  'https://yangkeduo.com',
  'https://www.yangkeduo.com',
] as const

export const MAX_CAPTURE_IMAGES = 60
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024
export const CAPTURE_SESSION_TTL_MS = 30 * 60 * 1000
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export type CaptureMessageType = typeof CAPTURE_HELLO | typeof CAPTURE_ACK | typeof CAPTURE_RESULT | typeof CAPTURE_BLOCKED

export interface CaptureSessionState {
  sessionId: string
  goodsId: string
  createdAt: number
  expiresAt: number
  used: boolean
}

export interface CaptureImagePayload {
  id: string
  category: 'hero' | 'detail' | 'option'
  order: number
  fileName: string
  mimeType: string
  byteLength: number
  width?: number
  height?: number
  sourceKey: string
  bytesStatus: 'ok' | 'unavailable' | 'over_limit' | 'preview_only' | 'invalid_type'
  longImage: 'kept_intact' | 'incomplete' | 'not_long'
  blob?: Blob | null
}

export interface CaptureOptionPayload {
  optionName: string
  contentsNote: string
  imageId: string | null
}

export interface CapturePayload {
  version: number
  type: CaptureMessageType
  sessionId?: string
  goodsId?: string
  reason?: CaptureBlockReason
  message?: string
  images?: CaptureImagePayload[]
  options?: CaptureOptionPayload[]
  coverage?: CaptureCoverageSummary
}

export interface IncomingMessageLike {
  origin: string
  source: unknown
  data: unknown
}

export function isAllowedPageOrigin(origin: string): boolean {
  return (ALLOWED_PAGE_ORIGINS as readonly string[]).includes(origin)
}

export function isAllowedWorkbenchOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:') return false
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  } catch {
    return false
  }
}

export function createCaptureSession(goodsId: string, now = Date.now()): CaptureSessionState {
  const sessionId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `cap-${now}-${Math.random().toString(16).slice(2)}`
  return {
    sessionId,
    goodsId,
    createdAt: now,
    expiresAt: now + CAPTURE_SESSION_TTL_MS,
    used: false,
  }
}

export function isSessionActive(session: CaptureSessionState | null, goodsId: string, sessionId: string, now = Date.now()): boolean {
  if (!session || session.used) return false
  if (session.sessionId !== sessionId || session.goodsId !== goodsId) return false
  return now <= session.expiresAt
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function sanitizeSourceKey(raw: string): string {
  const value = String(raw || '').trim()
  if (!value) return ''
  try {
    const url = new URL(value, 'https://img.example.test/')
    url.hash = ''
    ;[
      'pxq_secret_key',
      'share_uin',
      'refer_share_uin',
      'share_oak_rcto',
      '_oak_share_ticket',
      'refer_share_id',
      '_x_share_id',
    ].forEach((key) => url.searchParams.delete(key))
    return url.toString()
  } catch {
    return value.split('#')[0]
  }
}

export function validateIncomingCaptureEvent(
  event: IncomingMessageLike,
  context: { expectedSource?: unknown; session: CaptureSessionState | null; now?: number },
): { ok: true; payload: CapturePayload } | { ok: false; error: string } {
  if (!isAllowedPageOrigin(event.origin)) {
    return { ok: false, error: '消息来源不是允许的拼多多商品域名，已忽略。' }
  }
  if (context.expectedSource !== undefined && event.source !== context.expectedSource) {
    return { ok: false, error: '消息不是来自本次打开的商品窗口，已忽略。' }
  }
  if (!isObject(event.data)) return { ok: false, error: '采集消息格式无效。' }
  const data = event.data
  if (data.version !== CAPTURE_PROTOCOL_VERSION) return { ok: false, error: '采集协议版本不匹配。' }
  const type = data.type
  if (type !== CAPTURE_HELLO && type !== CAPTURE_RESULT && type !== CAPTURE_BLOCKED) {
    return { ok: false, error: '未知的采集消息类型。' }
  }
  const goodsId = typeof data.goodsId === 'string' ? data.goodsId : ''
  if (!/^\d{6,20}$/.test(goodsId)) return { ok: false, error: '采集消息没有有效的商品编号。' }

  if (type === CAPTURE_HELLO) {
    return {
      ok: true,
      payload: { version: CAPTURE_PROTOCOL_VERSION, type, goodsId },
    }
  }

  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
  if (!isSessionActive(context.session, goodsId, sessionId, context.now)) {
    return { ok: false, error: '采集会话无效、不匹配或已过期。' }
  }

  if (type === CAPTURE_BLOCKED) {
    const reason = data.reason === 'login' || data.reason === 'captcha' || data.reason === 'platform' || data.reason === 'unavailable' || data.reason === 'wrong_item' ? data.reason : 'platform'
    return {
      ok: true,
      payload: {
        version: CAPTURE_PROTOCOL_VERSION,
        type,
        sessionId,
        goodsId,
        reason,
        message: typeof data.message === 'string' ? data.message : '采集已停止。',
      },
    }
  }

  const rawImages = Array.isArray(data.images) ? data.images : []
  if (rawImages.length > MAX_CAPTURE_IMAGES) {
    return { ok: false, error: `图片数量超过 ${MAX_CAPTURE_IMAGES} 张上限。` }
  }

  const images: CaptureImagePayload[] = []
  let totalBytes = 0
  for (const item of rawImages) {
    if (!isObject(item)) return { ok: false, error: '图片项格式无效。' }
    const id = typeof item.id === 'string' ? item.id : ''
    const category = item.category
    if (!id) return { ok: false, error: '图片缺少编号。' }
    if (category !== 'hero' && category !== 'detail' && category !== 'option') {
      return { ok: false, error: '图片分类无效。' }
    }
    const mimeType = typeof item.mimeType === 'string' ? item.mimeType : ''
    const byteLength = Number(item.byteLength || 0)
    const bytesStatus = item.bytesStatus
    if (bytesStatus !== 'ok' && bytesStatus !== 'unavailable' && bytesStatus !== 'over_limit' && bytesStatus !== 'preview_only' && bytesStatus !== 'invalid_type') {
      return { ok: false, error: '图片字节状态无效。' }
    }
    if (bytesStatus === 'ok') {
      if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType)) {
        return { ok: false, error: '存在不支持的图片格式。' }
      }
      if (!Number.isFinite(byteLength) || byteLength <= 0) return { ok: false, error: '图片大小无效。' }
      if (byteLength > MAX_IMAGE_BYTES) return { ok: false, error: '单张图片超过大小上限。' }
      totalBytes += byteLength
      if (item.blob != null && !(item.blob instanceof Blob)) return { ok: false, error: '图片数据不是有效的文件。' }
      if (item.blob && item.blob.size > MAX_IMAGE_BYTES) return { ok: false, error: '单张图片超过大小上限。' }
    }
    images.push({
      id,
      category,
      order: Number(item.order || images.length + 1),
      fileName: typeof item.fileName === 'string' && item.fileName ? item.fileName : `${category}-${id}`,
      mimeType,
      byteLength,
      width: typeof item.width === 'number' ? item.width : undefined,
      height: typeof item.height === 'number' ? item.height : undefined,
      sourceKey: sanitizeSourceKey(typeof item.sourceKey === 'string' ? item.sourceKey : id),
      bytesStatus,
      longImage: item.longImage === 'kept_intact' || item.longImage === 'incomplete' || item.longImage === 'not_long' ? item.longImage : 'not_long',
      blob: item.blob instanceof Blob ? item.blob : null,
    })
  }
  if (totalBytes > MAX_TOTAL_BYTES) return { ok: false, error: '图片总大小超过上限。' }

  const options: CaptureOptionPayload[] = []
  const imageIds = new Set(images.map((image) => image.id))
  const rawOptions = Array.isArray(data.options) ? data.options : []
  for (const item of rawOptions) {
    if (!isObject(item)) return { ok: false, error: '套餐项格式无效。' }
    const optionName = typeof item.optionName === 'string' ? item.optionName.trim() : ''
    if (!optionName) continue
    const imageId = typeof item.imageId === 'string' && item.imageId ? item.imageId : null
    if (imageId && !imageIds.has(imageId)) {
      return { ok: false, error: '套餐引用了不存在的选项图。' }
    }
    if (imageId) {
      const target = images.find((image) => image.id === imageId)
      if (target && target.category !== 'option') {
        return { ok: false, error: '选项图必须来自选购项，不能引用主图或详情图。' }
      }
    }
    options.push({
      optionName,
      contentsNote: typeof item.contentsNote === 'string' ? item.contentsNote : '',
      imageId,
    })
  }

  return {
    ok: true,
    payload: {
      version: CAPTURE_PROTOCOL_VERSION,
      type,
      sessionId,
      goodsId,
      images,
      options,
      message: typeof data.message === 'string' ? data.message : undefined,
    },
  }
}

export function coverageFromDomResult(result: CaptureDomResult, images: CaptureImagePayload[] = []): CaptureCoverageSummary {
  const heroImages = images.filter((image) => image.category === 'hero' && image.bytesStatus === 'ok')
  const detailImages = images.filter((image) => image.category === 'detail')
  const heroFound = heroImages.length || result.hero.length
  const hero = { found: heroFound, expected: result.heroExpectedTotal, ...describeHeroCoverage(heroFound, result.heroExpectedTotal) }
  const intactLong = detailImages.filter((image) => image.longImage === 'kept_intact').length
    || result.detail.filter((item) => item.likelyLongImage).length
  const incompleteLong = detailImages.filter((image) => image.longImage === 'incomplete').length
  const bound = result.options.filter((item) => !item.missing && item.imageLocalId).length
  const missing = result.options.filter((item) => item.missing || !item.imageLocalId).length
  return {
    attempted: true,
    blocked: result.blocked ? result.blockReason || undefined : undefined,
    blockedMessage: result.blockMessage || undefined,
    hero,
    detail: {
      found: detailImages.length || result.detail.length,
      intactLong,
      incompleteLong,
      note: describeDetailCoverage(detailImages.length || result.detail.length, intactLong, incompleteLong),
    },
    option: {
      inspected: result.optionsInspected,
      total: result.options.length,
      bound,
      missing,
      note: describeOptionCoverage(result.optionsInspected, result.options.length, bound, missing),
    },
  }
}

export function classifyLongImage(input: {
  width?: number
  height?: number
  bytesStatus: CaptureImagePayload['bytesStatus']
  likelyLong?: boolean
}): CaptureImagePayload['longImage'] {
  const long = input.likelyLong || (!!input.width && !!input.height && input.height / input.width >= 3)
  if (!long) return 'not_long'
  if (input.bytesStatus === 'ok') return 'kept_intact'
  return 'incomplete'
}
