import type { CaptureDomResult } from '../captureDom'
import type { CapturePageDecision } from './pageStatus'
import type { CollectorPageSignals } from './types'

export const UNAVAILABLE_RECONFIRM_INITIAL_MS = 1500
export const UNAVAILABLE_RECONFIRM_POLL_MS = 500
export const UNAVAILABLE_RECONFIRM_MAX_MS = 3000
export const UNAVAILABLE_HOLD_WINDOW_MS = 5000
/** 自首次疑似售罄起的最长复核时间。到期必须进入终态，禁止重置计时后继续空等。 */
export const UNAVAILABLE_UNCONFIRMED_DEADLINE_MS = 15_000

export type UnavailableRecheckAction = 'finalize' | 'finalize_unconfirmed' | 'wait_more' | 'abort_to_other'

export const UNCONFIRMED_UNAVAILABLE_MESSAGE = '仍无法确认页面是否可采集，已停止。页面出现售罄或相似推荐，但未能确认，不会采集推荐商品图片。这不能说明商品已经下架。'

export function decideUnavailableRecheck(input: {
  firstHitAt: number
  now: number
  decision: CapturePageDecision
  confirmed: boolean
}): UnavailableRecheckAction {
  if (input.decision !== 'unavailable') return 'abort_to_other'
  const elapsed = input.now - input.firstHitAt
  if (elapsed >= UNAVAILABLE_UNCONFIRMED_DEADLINE_MS && !input.confirmed) return 'finalize_unconfirmed'
  if (elapsed < UNAVAILABLE_RECONFIRM_INITIAL_MS) return 'wait_more'
  if (input.confirmed) return 'finalize'
  if (elapsed < UNAVAILABLE_UNCONFIRMED_DEADLINE_MS) return 'wait_more'
  return 'finalize_unconfirmed'
}

export function matchItemId(pageGoodsId: string | null | undefined, expectedGoodsId: string | null | undefined): boolean | null {
  if (!pageGoodsId || !expectedGoodsId) return null
  return pageGoodsId === expectedGoodsId
}

export function buildJobPageSignals(input: {
  startedAt: number
  now?: number
  snap: Pick<CaptureDomResult, 'goodsId' | 'pageSignals'>
  expectedGoodsId?: string | null
}): CollectorPageSignals {
  const now = input.now ?? Date.now()
  const signals = input.snap.pageSignals
  const itemIdMatch = signals?.itemIdMatch ?? matchItemId(input.snap.goodsId, input.expectedGoodsId)
  return {
    rule: signals?.rule ?? null,
    urlPath: signals?.urlPath ?? null,
    itemIdMatch,
    itemIdSource: signals?.itemIdSource ?? null,
    elapsedMs: Math.max(0, now - input.startedAt),
  }
}

export async function holdWindowBeforeClose(
  job: { cancelRequested: boolean },
  ms: number = UNAVAILABLE_HOLD_WINDOW_MS,
  sleep: (ms: number) => Promise<void> = (n) => new Promise((resolve) => setTimeout(resolve, n)),
): Promise<void> {
  const end = Date.now() + ms
  while (!job.cancelRequested && Date.now() < end) {
    const remain = end - Date.now()
    if (remain <= 0) break
    await sleep(Math.min(200, remain))
  }
}
