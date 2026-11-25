import type { CaptureDomResult } from '../captureDom'

export type CapturePageDecision =
  | 'proceed'
  | 'loading'
  | 'wait_login'
  | 'wait_captcha'
  | 'unavailable'
  | 'wrong_item'
  | 'platform'
  | 'post_login_home'

export function classifyCapturePage(
  snap: Pick<CaptureDomResult, 'blocked' | 'blockReason' | 'goodsId' | 'hero' | 'detail'>,
  expectedGoodsId?: string | null,
): CapturePageDecision {
  if (snap.blocked) {
    if (snap.blockReason === 'login') return 'wait_login'
    if (snap.blockReason === 'captcha') return 'wait_captcha'
    if (snap.blockReason === 'unavailable') return 'unavailable'
    if (snap.blockReason === 'wrong_item') return 'wrong_item'
    if (snap.blockReason === 'post_login_home') return 'post_login_home'
    return 'platform'
  }
  if (expectedGoodsId && snap.goodsId && snap.goodsId !== expectedGoodsId) return 'wrong_item'
  if (snap.hero.length === 0 && snap.detail.length === 0) return 'loading'
  return 'proceed'
}

export function decisionMessage(decision: CapturePageDecision, goodsId?: string | null): string {
  switch (decision) {
    case 'proceed':
      return goodsId ? `已打开目标商品 ${goodsId}，正在采集可见图片…` : '已打开目标商品页，正在采集可见图片…'
    case 'loading':
      return goodsId ? `正在打开商品页 ${goodsId}…` : '正在打开商品页…'
    case 'wait_login':
      return '请在采集窗口自行登录。完成后会自动继续采集，一般不必再点「继续采集」。'
    case 'wait_captcha':
      return '请在采集窗口完成安全验证。完成后会自动继续，不会绕过验证码。'
    case 'post_login_home':
      return '已离开登录页，但还没有回到商品页。将在同一窗口再打开一次原商品链接。'
    case 'unavailable':
      return goodsId
        ? `目标商品 ${goodsId} 不可访问。页面显示售罄、下架或不存在，并可能出现相似推荐。不会采集推荐商品图片。`
        : '目标商品不可访问。页面显示售罄、下架或不存在，并可能出现相似推荐。不会采集推荐商品图片。'
    case 'wrong_item':
      return goodsId ? `打开了其他商品，已停止采集目标 ${goodsId}，不会抓取当前页图片。` : '打开了其他商品，已停止采集，不会抓取当前页图片。'
    case 'platform':
      return '页面提示访问受限或系统繁忙。已停止采集，不会绕过限制。'
  }
}

export function isTerminalDecision(decision: CapturePageDecision): boolean {
  return decision === 'unavailable' || decision === 'wrong_item' || decision === 'platform'
}
