export type LinkInputKind = 'login_wrapper' | 'goods' | 'unsupported' | 'invalid'
export type CollectorEntryKind = 'raw_login_wrapper' | 'direct_goods' | 'raw_share_link'

export interface LinkNormalizeResult {
  ok: boolean
  inputKind: LinkInputKind
  entryKind: CollectorEntryKind | null
  goodsId: string | null
  canonicalUrl: string | null
  /** 仅在内存中用于本次打开页面，不写入持久化会话或公开任务。登录包装时为外层入口。 */
  navigationUrl: string | null
  /** 仅在内存中用于登录后恢复商品目标，不写入公开任务。登录包装时为内层商品地址。 */
  restoreUrl: string | null
  loginLikely: boolean
  captureStatus: 'normalized_not_fetched' | 'invalid' | 'unsupported_host'
  message: string
}

/** 外层计第一层，最多两层登录包装。 */
export const MAX_LOGIN_WRAP_DEPTH = 2

const ALLOWED_HOSTS = new Set([
  'mobile.yangkeduo.com',
  'yangkeduo.com',
  'www.yangkeduo.com',
  'pinduoduo.com',
  'www.pinduoduo.com',
  'mobile.pinduoduo.com',
])

const PRIVATE_HOSTS = new Set(['localhost', 'localhost.', '0.0.0.0', '::1', '::'])

function isIpv4(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

function isPrivateOrLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (PRIVATE_HOSTS.has(h) || h.endsWith('.localhost') || h.endsWith('.local')) return true
  if (h.endsWith('.internal') || h === 'metadata.google.internal') return true
  if (isIpv4(h)) {
    const p = h.split('.').map(Number)
    if (p.some((n) => n > 255)) return true
    const [a, b] = p
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  if (h.includes(':')) return true
  return false
}

function fail(message: string, inputKind: LinkInputKind = 'invalid', captureStatus: LinkNormalizeResult['captureStatus'] = 'invalid'): LinkNormalizeResult {
  return {
    ok: false,
    inputKind,
    entryKind: null,
    goodsId: null,
    canonicalUrl: null,
    navigationUrl: null,
    restoreUrl: null,
    loginLikely: false,
    captureStatus,
    message,
  }
}

function prepareHref(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  if (/^\s*(javascript|data|file|vbscript):/i.test(text)) return null
  if (/^https?:\/\//i.test(text)) return text
  if (text.startsWith('//')) return `https:${text}`
  if (/^[a-z0-9.-]+[.][a-z]{2,}([/?#].*)?$/i.test(text) || /^mobile\.yangkeduo\.com/i.test(text)) {
    return `https://${text}`
  }
  return null
}

function parseUrl(raw: string): URL | null {
  const href = prepareHref(raw)
  if (!href) return null
  try {
    return new URL(href)
  } catch {
    return null
  }
}

function hostAllowed(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (isPrivateOrLocalHost(host)) return false
  return ALLOWED_HOSTS.has(host)
}

export function extractGoodsId(url: URL): string | null {
  const fromQuery = url.searchParams.get('goods_id') || url.searchParams.get('goodsId')
  if (fromQuery && /^\d{6,20}$/.test(fromQuery)) return fromQuery
  const pathMatch = url.pathname.match(/\/goods(?:2)?\/(\d{6,20})(?:\/|$)/i)
  if (pathMatch) return pathMatch[1]
  return null
}

export function canonicalGoodsUrl(goodsId: string): string {
  return `https://mobile.yangkeduo.com/goods2.html?goods_id=${encodeURIComponent(goodsId)}`
}

export function canonicalGoodsLandingUrl(pathname = '/goods2.html'): string {
  const path = pathname && /^\/goods(?:2)?\.html$/i.test(pathname) ? pathname : '/goods2.html'
  return `https://mobile.yangkeduo.com${path}`
}

export function isLoginPath(url: URL): boolean {
  return /\/login\.html?$/i.test(url.pathname)
}

export function isAllowedGoodsPath(url: URL): boolean {
  if (/\/goods(?:2)?\.html$/i.test(url.pathname)) return true
  return /\/goods(?:2)?\/\d{6,20}(?:\/|$)/i.test(url.pathname)
}

function isAllowedPddPath(url: URL): boolean {
  return isLoginPath(url) || isAllowedGoodsPath(url)
}

function cycleKey(url: URL): string {
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}?${url.searchParams.toString()}`
}

function httpsAllowedPddUrl(url: URL, missingTargetMessage: string): string | null {
  if (url.protocol !== 'https:') return '登录入口及其目标地址必须使用 https。'
  if (!hostAllowed(url)) return missingTargetMessage
  if (!isAllowedPddPath(url)) return '链接路径不是允许的登录页或商品页，已拒绝打开。'
  return null
}

function resolveLoginInner(outer: URL): { ok: true; inner: URL } | { ok: false; message: string } {
  const from = outer.searchParams.get('from')
  if (!from) return { ok: false, message: '登录页中没有商品地址，请改用商品链接或手动导入图片。' }
  let decoded = from
  try {
    decoded = decodeURIComponent(from)
  } catch {
    decoded = from
  }
  if (/^\s*(javascript|data|file|vbscript):/i.test(decoded)) {
    return { ok: false, message: '登录页指向的地址不被允许，已拒绝跳转。' }
  }
  let inner: URL | null = null
  try {
    inner = new URL(decoded, outer)
  } catch {
    inner = parseUrl(decoded)
  }
  if (!inner) return { ok: false, message: '无法解析登录页中的商品地址。' }
  const blocked = httpsAllowedPddUrl(inner, '登录页指向的地址不在允许的拼多多商品域名内，已拒绝跳转。')
  if (blocked) return { ok: false, message: blocked }
  return { ok: true, inner }
}

function unwrapLoginToGoods(outer: URL): { ok: true; goods: URL } | { ok: false; message: string } {
  const seen = new Set<string>([cycleKey(outer)])
  let current = outer
  let wraps = 0
  while (isLoginPath(current)) {
    wraps += 1
    if (wraps > MAX_LOGIN_WRAP_DEPTH) {
      return { ok: false, message: '登录包装层数过多，已拒绝打开。' }
    }
    const resolved = resolveLoginInner(current)
    if (!resolved.ok) return resolved
    const key = cycleKey(resolved.inner)
    if (seen.has(key)) return { ok: false, message: '登录包装存在循环，已拒绝打开。' }
    seen.add(key)
    current = resolved.inner
  }
  if (!isAllowedGoodsPath(current)) {
    return { ok: false, message: '登录页没有指向允许的商品页，已拒绝打开。' }
  }
  return { ok: true, goods: current }
}

export function normalizeCompetitorLink(raw: string): LinkNormalizeResult {
  const text = raw.trim()
  if (!text) return fail('请先粘贴竞品商品链接。')

  const parsed = parseUrl(text)
  if (!parsed) return fail('无法识别这条链接，请检查是否完整。')
  if (!hostAllowed(parsed)) {
    return fail('目前只支持拼多多商品链接。其他网站请改用手动导入图片，不会自动抓取。', 'unsupported', 'unsupported_host')
  }

  if (isLoginPath(parsed)) {
    const outerBlocked = httpsAllowedPddUrl(parsed, '目前只支持拼多多商品链接。其他网站请改用手动导入图片，不会自动抓取。')
    if (outerBlocked) return fail(outerBlocked, 'login_wrapper')
    const unwrapped = unwrapLoginToGoods(parsed)
    if (!unwrapped.ok) return fail(unwrapped.message, 'login_wrapper')
    const goodsId = extractGoodsId(unwrapped.goods)
    if (!goodsId) {
      return {
        ok: true,
        inputKind: 'login_wrapper',
        entryKind: 'raw_login_wrapper',
        goodsId: null,
        canonicalUrl: canonicalGoodsLandingUrl(unwrapped.goods.pathname),
        navigationUrl: parsed.href,
        restoreUrl: unwrapped.goods.href,
        loginLikely: true,
        captureStatus: 'normalized_not_fetched',
        message: '已识别登录入口并保留原始商品分享入口，将从原登录入口打开，尚未抓取图片。商品编号将在打开目标页后确认。如需登录，请在采集窗口自行完成；若登录后未回到商品页，会自动再打开一次原链接。',
      }
    }
    return {
      ok: true,
      inputKind: 'login_wrapper',
      entryKind: 'raw_login_wrapper',
      goodsId,
      canonicalUrl: canonicalGoodsUrl(goodsId),
      navigationUrl: parsed.href,
      restoreUrl: unwrapped.goods.href,
      loginLikely: true,
      captureStatus: 'normalized_not_fetched',
      message: `已识别登录入口并抽出商品 ${goodsId}，将从原登录入口打开，尚未抓取图片。如需登录，请在采集窗口自行完成，完成后会自动继续，一般不必再点「继续采集」。`,
    }
  }

  if (!isAllowedGoodsPath(parsed)) {
    return fail('这是拼多多链接，但路径不是允许的商品页。')
  }
  const goodsId = extractGoodsId(parsed)
  const navigationUrl = parsed.protocol === 'https:' && hostAllowed(parsed) ? parsed.href : null
  if (!goodsId) {
    if (!navigationUrl) return fail('这是拼多多链接，但没有找到可打开的商品地址。')
    return {
      ok: true,
      inputKind: 'goods',
      entryKind: 'raw_share_link',
      goodsId: null,
      canonicalUrl: canonicalGoodsLandingUrl(parsed.pathname),
      navigationUrl,
      restoreUrl: navigationUrl,
      loginLikely: true,
      captureStatus: 'normalized_not_fetched',
      message: '已保留原始商品分享入口，尚未抓取图片。商品编号将在打开目标页后确认。如需登录，请在采集窗口完成；若登录后未回到商品页，会自动再打开一次原链接。',
    }
  }

  const canonicalUrl = canonicalGoodsUrl(goodsId)
  return {
    ok: true,
    inputKind: 'goods',
    entryKind: 'direct_goods',
    goodsId,
    canonicalUrl,
    navigationUrl: navigationUrl || canonicalUrl,
    restoreUrl: navigationUrl || canonicalUrl,
    loginLikely: false,
    captureStatus: 'normalized_not_fetched',
    message: `已规范化商品页 ${goodsId}，尚未抓取图片。若采集窗口已有可用登录状态，将直接打开并采集。`,
  }
}

export function resolveNavigationUrl(raw: string | null | undefined, expectedGoodsId: string): { ok: true; navigationUrl: string; restoreUrl: string; entryKind: CollectorEntryKind } | { ok: false; message: string } {
  const text = (raw || '').trim()
  if (!text) {
    if (!expectedGoodsId) return { ok: false, message: '无法使用空链接打开商品页。' }
    const url = canonicalGoodsUrl(expectedGoodsId)
    return { ok: true, navigationUrl: url, restoreUrl: url, entryKind: 'direct_goods' }
  }
  const parsed = normalizeCompetitorLink(text)
  if (!parsed.ok || !parsed.navigationUrl || !parsed.entryKind) {
    return { ok: false, message: parsed.message || '无法使用这条链接打开商品页。' }
  }
  if (expectedGoodsId && parsed.goodsId && parsed.goodsId !== expectedGoodsId) {
    return { ok: false, message: `链接中的商品编号是 ${parsed.goodsId}，与当前任务 ${expectedGoodsId} 不一致。` }
  }
  return { ok: true, navigationUrl: parsed.navigationUrl, restoreUrl: parsed.restoreUrl || parsed.navigationUrl, entryKind: parsed.entryKind }
}
