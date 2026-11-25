import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import {
  createCaptureId,
  normalizeGoodsId,
  publicCaptureEvent,
  retainCaptureEvents,
  sanitizeCaptureId,
  type CaptureEvent,
  type CaptureStage,
  type GoodsIdSource,
  type IdentityStatus,
} from '../src/pdd/competitor/chromePageCapture/diagnostics'

export const PAIR_CODE_TTL_MS = 2 * 60 * 1000
export const OPEN_ARM_TTL_MS = 15 * 60 * 1000
export const SESSION_TTL_MS = 30 * 60 * 1000

export type PairingNow = () => number

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function randomSecret(): string {
  return randomBytes(32).toString('hex')
}

function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

export type ChromePageCaptureStore = {
  csrf?: { tokenHash: string; expiresAt: number }
  pairCode?: { codeHash: string; extensionId: string; expiresAt: number; redeemed: boolean }
  openArm?: { expiresAt: number; redeemed: boolean }
  session?: { tokenHash: string; extensionId: string; expiresAt: number }
  expectedGoodsId?: string | null
  lastImport?: ChromePageCaptureImport
  recentCaptures?: CaptureEvent[]
}

export type ChromePageCaptureSavedFile = {
  kind: 'hero' | 'detail' | 'option'
  fileName: string | null
  bytesStatus: 'ok' | 'unavailable' | 'over_limit' | 'invalid_type'
  byteLength: number
  optionName?: string
}

export type ChromePageCaptureImport = {
  receivedAt: number
  path: string
  heroCount: number
  detailCount: number
  optionCount: number
  optionsInspected: boolean
  optionNames: string[]
  notes: string[]
  hero: Array<{ sourceUrl: string; width: number | null; height: number | null; alt: string }>
  detail: Array<{ sourceUrl: string; width: number | null; height: number | null; alt: string }>
  options: Array<{ optionName: string; sourceUrl: string | null }>
  folder?: string
  files?: ChromePageCaptureSavedFile[]
  heroSaved?: number
  detailSaved?: number
  optionSaved?: number
  bytesSaved?: boolean
  acceptedAsComplete?: boolean
  message?: string
  captureId?: string
  stage?: CaptureStage
  identityStatus?: IdentityStatus
  itemIdSource?: GoodsIdSource
  observedGoodsId?: string | null
  expectedGoodsId?: string | null
  identityReason?: string
}

export function createChromePageCaptureStore(): ChromePageCaptureStore {
  return {}
}

export function issueCsrfToken(store: ChromePageCaptureStore, now: PairingNow = Date.now): string {
  const token = randomSecret()
  store.csrf = { tokenHash: sha256Hex(token), expiresAt: now() + PAIR_CODE_TTL_MS }
  return token
}

export function checkCsrfToken(store: ChromePageCaptureStore, token: string | undefined, now: PairingNow = Date.now): boolean {
  if (!token || !store.csrf) return false
  if (store.csrf.expiresAt <= now()) return false
  return safeEqualHex(store.csrf.tokenHash, sha256Hex(token))
}

export function issuePairCode(store: ChromePageCaptureStore, extensionId: string, now: PairingNow = Date.now): string {
  const code = randomSecret()
  store.pairCode = {
    codeHash: sha256Hex(code),
    extensionId,
    expiresAt: now() + PAIR_CODE_TTL_MS,
    redeemed: false,
  }
  store.session = undefined
  return code
}

export function redeemPairCode(
  store: ChromePageCaptureStore,
  input: { code?: string; extensionId?: string },
  now: PairingNow = Date.now,
): { ok: true; token: string; expiresAt: number } | { ok: false; reason: string } {
  const record = store.pairCode
  if (!input.code || !input.extensionId || !record) return { ok: false, reason: '配对码无效或已过期。' }
  if (record.redeemed) return { ok: false, reason: '配对码已使用，请在工作台重新生成。' }
  if (record.expiresAt <= now()) return { ok: false, reason: '配对码无效或已过期。' }
  if (record.extensionId !== input.extensionId) return { ok: false, reason: '扩展编号与配对码不一致。' }
  if (!safeEqualHex(record.codeHash, sha256Hex(input.code))) return { ok: false, reason: '配对码无效或已过期。' }
  record.redeemed = true
  const token = randomSecret()
  const expiresAt = now() + SESSION_TTL_MS
  store.session = { tokenHash: sha256Hex(token), extensionId: input.extensionId, expiresAt }
  return { ok: true, token, expiresAt }
}

export function verifySession(
  store: ChromePageCaptureStore,
  input: { token?: string; extensionId?: string },
  now: PairingNow = Date.now,
): { ok: true } | { ok: false; reason: string } {
  const session = store.session
  if (!input.token || !input.extensionId || !session) return { ok: false, reason: '尚未配对或配对已失效。' }
  if (session.expiresAt <= now()) return { ok: false, reason: '配对已过期，请重新配对。' }
  if (session.extensionId !== input.extensionId) return { ok: false, reason: '扩展编号与当前配对不一致。' }
  if (!safeEqualHex(session.tokenHash, sha256Hex(input.token))) return { ok: false, reason: '尚未配对或配对已失效。' }
  return { ok: true }
}

export function revokePairing(store: ChromePageCaptureStore): void {
  store.pairCode = undefined
  store.openArm = undefined
  store.session = undefined
  store.csrf = undefined
  store.expectedGoodsId = undefined
}

export function setExpectedGoodsId(store: ChromePageCaptureStore, value: unknown): { ok: true; expectedGoodsId: string | null } | { ok: false; reason: string } {
  if (value == null || value === '') {
    store.expectedGoodsId = null
    return { ok: true, expectedGoodsId: null }
  }
  const goodsId = normalizeGoodsId(value)
  if (!goodsId) return { ok: false, reason: '请填写 6 到 20 位数字商品编号，不要粘贴完整链接或参数。' }
  store.expectedGoodsId = goodsId
  return { ok: true, expectedGoodsId: goodsId }
}

export function rememberCaptureEvent(store: ChromePageCaptureStore, event: CaptureEvent): CaptureEvent {
  store.recentCaptures = retainCaptureEvents(store.recentCaptures || [], event)
  return event
}

export function nextCaptureId(value?: unknown): string {
  return sanitizeCaptureId(value) || createCaptureId()
}

export function armOpenPairing(store: ChromePageCaptureStore, now: PairingNow = Date.now): { expiresAt: number } {
  store.openArm = { expiresAt: now() + OPEN_ARM_TTL_MS, redeemed: false }
  return { expiresAt: store.openArm.expiresAt }
}

export function redeemOpenArm(
  store: ChromePageCaptureStore,
  input: { extensionId?: string },
  now: PairingNow = Date.now,
): { ok: true; token: string; expiresAt: number } | { ok: false; reason: string } {
  const arm = store.openArm
  if (!input.extensionId) return { ok: false, reason: '只接受已安装的本机扩展完成配对。' }
  if (!arm) return { ok: false, reason: '工作台尚未开始配对。请先在本机工作台配对页点「开始配对」。' }
  if (arm.redeemed) return { ok: false, reason: '这次配对已完成，如需重新配对请回到工作台再点一次开始配对。' }
  if (arm.expiresAt <= now()) return { ok: false, reason: '开始配对已过期。请回到本机工作台配对页再点一次「开始配对」，然后在有效时间内点「完成配对」。' }
  arm.redeemed = true
  const token = randomSecret()
  const expiresAt = now() + SESSION_TTL_MS
  store.session = { tokenHash: sha256Hex(token), extensionId: input.extensionId, expiresAt }
  return { ok: true, token, expiresAt }
}

export function publicPairingStatus(store: ChromePageCaptureStore, now: PairingNow = Date.now) {
  const arm = store.openArm
  const session = store.session
  const armed = Boolean(arm && !arm.redeemed && arm.expiresAt > now())
  const paired = Boolean(session && session.expiresAt > now())
  return {
    armed,
    expiresAt: armed ? arm!.expiresAt : null,
    paired,
    sessionExpiresAt: paired ? session!.expiresAt : null,
    expectedGoodsId: store.expectedGoodsId || null,
    hasExpectedGoodsId: Boolean(store.expectedGoodsId),
  }
}

export function publicImportSummary(record: ChromePageCaptureImport | undefined) {
  if (!record) return null
  return {
    receivedAt: record.receivedAt,
    path: record.path,
    heroCount: record.heroCount,
    detailCount: record.detailCount,
    optionCount: record.optionCount,
    heroSaved: record.heroSaved ?? 0,
    detailSaved: record.detailSaved ?? 0,
    optionSaved: record.optionSaved ?? 0,
    optionsInspected: record.optionsInspected,
    optionNames: record.optionNames,
    notes: record.notes,
    folder: record.folder || null,
    files: record.files || [],
    bytesSaved: Boolean(record.bytesSaved),
    acceptedAsComplete: Boolean(record.acceptedAsComplete),
    message: record.message || '已收到分类后的图片链接。这还不是取图验收，工作台尚未下载并核对这些图片文件。',
    captureId: record.captureId || null,
    stage: record.stage || null,
    identityStatus: record.identityStatus || null,
    itemIdSource: record.itemIdSource || null,
    observedGoodsId: record.observedGoodsId || null,
    expectedGoodsId: record.expectedGoodsId || null,
    identityReason: record.identityReason || null,
  }
}

export function publicLastCaptureView(store: ChromePageCaptureStore) {
  const recent = (store.recentCaptures || []).map((item) => publicCaptureEvent(item))
  return {
    lastCapture: recent[0] || null,
    recentCaptures: recent,
  }
}
