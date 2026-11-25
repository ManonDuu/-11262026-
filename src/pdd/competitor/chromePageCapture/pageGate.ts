/** 扩展导入前的页面门禁：不用地址中的商品编号证明页面正确。 */

export type PagePathKind = 'goods' | 'sensitive' | 'other'

export function sanitizePath(pathname: string): string {
  const path = String(pathname || '').split('?')[0] || ''
  return path.length <= 80 ? path : path.slice(0, 80)
}

export function classifyPath(pathname: string): PagePathKind {
  const path = sanitizePath(pathname)
  if (/^\/goods(?:2)?\.html$/i.test(path)) return 'goods'
  if (path === '/' || /^\/(?:index|home)\.html?$/i.test(path)) return 'sensitive'
  if (/^\/(?:login|personal|person|orders?|user(?:info)?|wallet|chat|favorite|collect|address(?:es)?|coupon|bill|settings?|account|member|profile)(?:\.html)?$/i.test(path)) {
    return 'sensitive'
  }
  return 'other'
}

export type DomExportEvidence = {
  pathname: string
  blocked: boolean
  blockReason?: string | null
  heroCount: number
  detailCount: number
  optionImageCount: number
  optionsInspected: boolean
}

export type DomExportDecision = { ok: true } | { ok: false; reason: string }

export function canExportDom(input: DomExportEvidence): DomExportDecision {
  const kind = classifyPath(input.pathname)
  if (kind === 'sensitive') return { ok: false, reason: '当前页不是可采集的商品页，不会读取个人、订单或首页内容。' }
  if (kind !== 'goods') return { ok: false, reason: '当前页不是商品详情入口，已停止，不会扫描其他页面。' }
  if (input.blocked) {
    if (input.blockReason === 'login') return { ok: false, reason: '当前是登录页，不会采集。请先在普通 Chrome 打开已登录的商品详情再点扩展。' }
    if (input.blockReason === 'captcha') return { ok: false, reason: '当前页需要安全验证，不会绕过，已停止。' }
    if (input.blockReason === 'unavailable') return { ok: false, reason: '当前页显示售罄、下架或相似推荐，不会采集推荐图。' }
    if (input.blockReason === 'post_login_home') return { ok: false, reason: '当前是首页或类似页面，不是商品详情。' }
    return { ok: false, reason: '当前页不能采集，已停止。' }
  }
  const hasVisibleGoods = input.heroCount > 0 || input.detailCount > 0 || (input.optionsInspected && input.optionImageCount > 0)
  if (!hasVisibleGoods) {
    return { ok: false, reason: '没有在页面上看到主图、详情图或已选套餐图，仅有地址编号不能当作详情页，已停止。' }
  }
  return { ok: true }
}
