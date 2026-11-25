import { createCaptureSession, type CaptureSessionState } from './captureProtocol'

export interface CaptureRequest {
  canonicalUrl: string
  goodsId: string
}

export interface CaptureWindowOpenResult {
  ok: boolean
  session: CaptureSessionState | null
  opened: boolean
  message: string
}

let activeSession: CaptureSessionState | null = null
let activeSource: unknown = null

export function getActiveCaptureSession(): CaptureSessionState | null {
  return activeSession
}

export function getActiveCaptureSource(): unknown {
  return activeSource
}

export function resetCaptureSession(): void {
  activeSession = null
  activeSource = null
}

export function beginCaptureSession(goodsId: string, now = Date.now()): CaptureSessionState {
  activeSession = createCaptureSession(goodsId, now)
  activeSource = null
  return activeSession
}

export function bindCaptureSource(source: unknown): void {
  activeSource = source
}

export function markCaptureSessionUsed(): void {
  if (activeSession) activeSession = { ...activeSession, used: true }
}

/** 在用户点击中同步打开规范化商品页，并保留 opener 以便回传。不要对原始分享链接调用。 */
export function openGoodsForCapture(canonicalUrl: string): Window | null {
  if (typeof window === 'undefined') return null
  if (!canonicalUrl.startsWith('https://mobile.yangkeduo.com/goods2.html?goods_id=')) return null
  const child = window.open(canonicalUrl, 'pdd-competitor-goods')
  bindCaptureSource(child)
  return child
}

export function openCanonicalInBrowser(canonicalUrl: string): boolean {
  return !!openGoodsForCapture(canonicalUrl)
}

/** 自动采集已改由工作台「采集图片」触发独立窗口，不再走书签主流程。此函数保留给旧调用，避免误报已取全。 */
export async function captureFromCanonicalUrl(_request: CaptureRequest): Promise<{ status: 'not_implemented'; message: string; items: never[] }> {
  return {
    status: 'not_implemented',
    message: '请在竞品参谋中粘贴商品链接，点击「采集图片」，如需登录请在独立窗口自行登录，完成后会自动继续。不要把补传或旧书签操作说成已经自动采集完成。',
    items: [],
  }
}

export function describeAutomatedCaptureAvailability(): { available: true; message: string } {
  return {
    available: true,
    message: '自动采集已接入本机工作台。请粘贴商品链接后点击「采集图片」，如需登录请在独立采集窗口自行登录，完成后会自动继续。真实商品页能否取全，仍需实际操作验证，离线测试通过不代表已经抓齐。',
  }
}
