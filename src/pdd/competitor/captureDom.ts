/** 从合成或页面 Document 解析可见商品图。不发网络请求，不读 cookie。 */

export type CaptureBlockReason = 'login' | 'captcha' | 'platform' | 'unavailable' | 'wrong_item' | 'post_login_home' | null
export type CapturePageSignalRule =
  | 'sold_out_similar'
  | 'delisted'
  | 'wrong_item'
  | 'login'
  | 'captcha'
  | 'platform'
  | 'unconfirmed'
  | 'post_login_home'
  | null

export interface CapturePageSignals {
  rule: CapturePageSignalRule
  urlPath: string | null
  itemIdMatch: boolean | null
  itemIdSource?: 'location_query' | 'og_url' | 'dom' | null
  confirmed: boolean
}

export type CaptureCategory = 'hero' | 'detail' | 'option'

export interface DomImageCandidate {
  id: string
  category: CaptureCategory
  order: number
  sourceUrl: string
  alt: string
  width: number | null
  height: number | null
  likelyLongImage: boolean
  lazyUnloaded: boolean
}

export interface DomOptionCandidate {
  id: string
  optionName: string
  contentsNote: string
  imageLocalId: string | null
  missing: boolean
  missingReason: string
}

export interface CaptureDomResult {
  goodsId: string | null
  blocked: boolean
  blockReason: CaptureBlockReason
  blockMessage: string
  hero: DomImageCandidate[]
  detail: DomImageCandidate[]
  options: DomOptionCandidate[]
  optionImages: DomImageCandidate[]
  optionsInspected: boolean
  heroExpectedTotal: number | null
  notes: string[]
  pageSignals?: CapturePageSignals
}

var PLACEHOLDER_RE = /(?:data:image\/(?:gif|png|svg\+xml)|placeholder|spacer|blank|transparent|1x1|lazy-loading)/i
var IMAGE_URL_RE = /\.(?:jpg|jpeg|png|webp|gif|bmp|avif)(?:$|\?)/i
var PURCHASE_RE = /价格|预计送达|¥|￥|券后|马上抢|立即购买|加入购物车|运费|促销倒计时/

export function isPurchaseUiText(text: string): boolean {
  var value = String(text || '').trim()
  if (!value) return false
  return PURCHASE_RE.test(value)
}

export function readGoodsIdFromLocation(href: string): string | null {
  try {
    var url = new URL(href, 'https://mobile.yangkeduo.com/')
    var id = url.searchParams.get('goods_id') || url.searchParams.get('goodsId')
    if (id && /^\d{6,20}$/.test(id)) return id
  } catch (_err) {
    /* ignore */
  }
  return null
}

export function readGoodsIdFromDom(doc: Document): string | null {
  var metas = doc.querySelectorAll('meta[property="og:url"], meta[property="product:retailer_item_id"], meta[itemprop="productID"], meta[itemprop="sku"], meta[name="goods_id"], meta[name="product_id"]')
  for (var i = 0; i < metas.length; i++) {
    var meta = metas[i]
    var content = meta.getAttribute('content') || ''
    var fromMeta = readGoodsIdFromLocation(content)
    if (fromMeta) return fromMeta
    if (/^\d{6,20}$/.test(content.trim())) return content.trim()
  }
  var nodes = doc.querySelectorAll('[data-goods-id], [data-goodsid], [data-goods_id], [data-product-id]')
  for (var j = 0; j < nodes.length; j++) {
    var el = nodes[j]
    if (isRecommendOrFooterNode(el)) continue
    var raw = el.getAttribute('data-goods-id') || el.getAttribute('data-goodsid') || el.getAttribute('data-goods_id') || el.getAttribute('data-product-id') || ''
    if (/^\d{6,20}$/.test(raw.trim())) return raw.trim()
  }
  return null
}

export function normalizeImageUrl(raw: string): string {
  var value = String(raw || '').trim()
  if (!value) return ''
  value = value.split('#')[0]
  if (value.indexOf('//') === 0) value = 'https:' + value
  return value
}

export function isLikelyLongImage(width: number | null, height: number | null): boolean {
  if (!width || !height || width <= 0 || height <= 0) return false
  return height / width >= 3
}

export function attrNumber(el: Element, names: string[]): number | null {
  for (var i = 0; i < names.length; i += 1) {
    var raw = el.getAttribute(names[i])
    if (!raw) continue
    var n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

export function isElementVisible(el: Element | null): boolean {
  var cur: Element | null = el
  while (cur && cur.nodeType === 1) {
    if (cur.hasAttribute('hidden') || cur.getAttribute('aria-hidden') === 'true') return false
    var styleAttr = cur.getAttribute('style') || ''
    if (/display\s*:\s*none/i.test(styleAttr) || /visibility\s*:\s*hidden/i.test(styleAttr)) return false
    if (typeof window !== 'undefined' && window.getComputedStyle) {
      try {
        var cs = window.getComputedStyle(cur)
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false
      } catch (_err) {
        /* jsdom may not compute all styles */
      }
    }
    cur = cur.parentElement
  }
  return !!el
}

export function pickImageUrl(img: Element): { url: string; lazyUnloaded: boolean } {
  var candidates = [
    img.getAttribute('data-competitor-src'),
    img.getAttribute('currentSrc'),
    typeof (img as HTMLImageElement).currentSrc === 'string' ? (img as HTMLImageElement).currentSrc : '',
    img.getAttribute('src'),
    img.getAttribute('data-src'),
    img.getAttribute('data-original'),
    img.getAttribute('data-lazy'),
    img.getAttribute('data-url'),
  ]
  var srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || ''
  if (srcset) {
    var last = srcset.split(',').pop()
    if (last) candidates.push(last.trim().split(/\s+/)[0])
  }
  var placeholder = ''
  for (var i = 0; i < candidates.length; i += 1) {
    var url = normalizeImageUrl(candidates[i] || '')
    if (!url) continue
    if (PLACEHOLDER_RE.test(url) && !IMAGE_URL_RE.test(url)) {
      placeholder = placeholder || url
      continue
    }
    var lazyUnloaded = !img.getAttribute('src') && !!(img.getAttribute('data-src') || img.getAttribute('data-original'))
    return { url: url, lazyUnloaded: lazyUnloaded }
  }
  return { url: placeholder, lazyUnloaded: !!placeholder }
}

export function makeImage(category: CaptureCategory, order: number, img: Element, url: string, lazyUnloaded: boolean): DomImageCandidate {
  var width = attrNumber(img, ['width', 'data-width'])
  var height = attrNumber(img, ['height', 'data-height'])
  var maybeImage = img as HTMLImageElement
  if (!width && maybeImage.naturalWidth) width = maybeImage.naturalWidth
  if (!height && maybeImage.naturalHeight) height = maybeImage.naturalHeight
  return {
    id: category + '-' + order,
    category: category,
    order: order,
    sourceUrl: url,
    alt: (img.getAttribute('alt') || '').trim(),
    width: width,
    height: height,
    likelyLongImage: isLikelyLongImage(width, height),
    lazyUnloaded: lazyUnloaded,
  }
}

export function dedupeImages(images: DomImageCandidate[]): DomImageCandidate[] {
  var seen: Record<string, true> = {}
  var out: DomImageCandidate[] = []
  for (var i = 0; i < images.length; i += 1) {
    var key = images[i].sourceUrl
    if (!key || seen[key]) continue
    seen[key] = true
    out.push(images[i])
  }
  return out.map(function (item, index) {
    return { ...item, order: index + 1, id: item.category + '-' + (index + 1) }
  })
}

export function collectFromRegion(root: ParentNode, category: CaptureCategory): DomImageCandidate[] {
  var images: DomImageCandidate[] = []
  var nodes = root.querySelectorAll('img, source, [data-competitor-image]')
  for (var i = 0; i < nodes.length; i += 1) {
    var el = nodes[i]
    var marked = el.getAttribute('data-competitor-image')
    if (marked && marked !== category && marked !== 'auto') continue
    if (isRecommendOrFooterNode(el)) continue
    if (!isElementVisible(el) && !el.getAttribute('data-src') && !el.getAttribute('data-original')) continue
    var picked = pickImageUrl(el)
    if (!picked.url) continue
    images.push(makeImage(category, images.length + 1, el, picked.url, picked.lazyUnloaded))
  }
  return dedupeImages(images)
}

export function firstVisible(doc: Document, selector: string): Element | null {
  var nodes = doc.querySelectorAll(selector)
  for (var i = 0; i < nodes.length; i += 1) {
    if (isElementVisible(nodes[i])) return nodes[i]
  }
  return nodes[0] || null
}

export function isRecommendOrFooterNode(el: Element | null): boolean {
  var cur: Element | null = el
  while (cur && cur.nodeType === 1) {
    var tag = (cur.tagName || '').toLowerCase()
    if (tag === 'footer' || tag === 'aside') return true
    var cls = ((cur.getAttribute('class') || '') + ' ' + (cur.getAttribute('id') || '')).toLowerCase()
    if (/recommend|guess-like|similar|rec-list|hot-sale|shop-rec/.test(cls)) return true
    if (cur.getAttribute('data-competitor-region') === 'recommend') return true
    cur = cur.parentElement
  }
  return false
}

export function sanitizeUrlPath(href: string): string | null {
  if (!href) return null
  try {
    var url = new URL(href, 'https://mobile.yangkeduo.com/')
    var path = url.pathname || ''
    if (!path) return null
    if (path.length > 80 || /%/.test(path)) return null
    if (/[A-Fa-f0-9]{32,}|token|secret|ticket/i.test(path)) return null
    if (!/^\/(?:[A-Za-z0-9._-]+(?:\.html)?|goods\/\d+|)$/i.test(path)) return null
    return path
  } catch (_err) {
    return null
  }
}

export function visibleTextExcludingRecommend(root: Element | null): string {
  if (!root) return ''
  var parts: string[] = []
  function walk(node: Node): void {
    if (node.nodeType === 3) {
      parts.push(node.textContent || '')
      return
    }
    if (node.nodeType !== 1) return
    var el = node as Element
    if (!isElementVisible(el)) return
    if (el !== root && isRecommendOrFooterNode(el)) return
    var children = el.childNodes
    for (var i = 0; i < children.length; i += 1) walk(children[i])
  }
  walk(root)
  return parts.join(' ')
}

export function findStatusContainers(doc: Document): Element[] {
  var found: Element[] = []
  function add(el: Element | null): void {
    if (!el || !isElementVisible(el)) return
    if (isRecommendOrFooterNode(el) && (el.tagName || '').toLowerCase() !== 'body') return
    for (var i = 0; i < found.length; i += 1) {
      if (found[i] === el) return
    }
    found.push(el)
  }
  var marked = doc.querySelectorAll('[data-competitor-status], [role="status"]')
  for (var m = 0; m < marked.length; m += 1) add(marked[m])
  var headings = doc.querySelectorAll('h1, h2')
  for (var h = 0; h < headings.length; h += 1) {
    var heading = headings[h]
    if (!isElementVisible(heading) || isRecommendOrFooterNode(heading)) continue
    add(heading.closest('section, article, main, [role="main"]') || heading.parentElement || heading)
  }
  add(firstVisible(doc, 'main, [role="main"]'))
  var regions = doc.querySelectorAll('[data-competitor-region]')
  for (var r = 0; r < regions.length; r += 1) {
    if (regions[r].getAttribute('data-competitor-region') === 'recommend') continue
    add(regions[r])
  }
  return found
}

export function isHomePath(pathname: string): boolean {
  var path = String(pathname || '')
  return /\/(?:index|home)\.html?$/i.test(path) || path === '/'
}

export function detectBlock(doc: Document, expectedGoodsId?: string | null): { reason: CaptureBlockReason; message: string } & CapturePageSignals | null {
  var href = ''
  try {
    href = doc.location && doc.location.href ? doc.location.href : ''
  } catch (_err) {
    href = ''
  }
  var urlPath = sanitizeUrlPath(href)
  var resolved = resolvePageGoodsIdentity(doc, href)
  var pageGoodsId = resolved.goodsId
  var urlGoodsId = readGoodsIdFromLocation(href)
  var itemIdMatch: boolean | null = null
  if (expectedGoodsId && pageGoodsId) itemIdMatch = pageGoodsId === expectedGoodsId
  else if (!expectedGoodsId && !pageGoodsId) itemIdMatch = null
  else if (!pageGoodsId || !expectedGoodsId) itemIdMatch = null

  function withSignals(reason: CaptureBlockReason, message: string, rule: CapturePageSignalRule, confirmed: boolean): { reason: CaptureBlockReason; message: string } & CapturePageSignals {
    return { reason: reason, message: message, rule: rule, urlPath: urlPath, itemIdMatch: itemIdMatch, confirmed: confirmed }
  }

  if (/\/login\.html?(?:\?|$)/i.test(href)) {
    return withSignals('login', '当前是登录页。请在采集窗口自行登录，完成后会自动继续，一般不必再点「继续采集」。工作台不会代为登录，也不会读取账号。', 'login', true)
  }
  var bodyText = (doc.body && doc.body.textContent) || ''
  if (/滑动验证|安全验证|图形验证码|recaptcha|captcha/i.test(bodyText) && /验证/.test(bodyText)) {
    return withSignals('captcha', '页面正在进行安全验证。请在采集窗口完成验证，完成后会自动继续，不会绕过验证码。', 'captcha', true)
  }

  var pathOnly = ''
  try {
    pathOnly = href ? new URL(href, 'https://mobile.yangkeduo.com/').pathname : ''
  } catch (_err) {
    pathOnly = ''
  }
  if (isHomePath(pathOnly)) {
    return withSignals('post_login_home', '已离开登录页，当前在首页或类似页面，尚未打开目标商品。将在同一窗口再打开一次原商品链接。', 'post_login_home', true)
  }

  var soldConfirmed = false
  var delistedConfirmed = false
  var containers = findStatusContainers(doc)
  for (var i = 0; i < containers.length; i += 1) {
    var statusText = visibleTextExcludingRecommend(containers[i])
    if (/商品已售罄/.test(statusText) && /推荐以下相似商品/.test(statusText)) soldConfirmed = true
    if (/该商品已下架|商品已下架|商品不存在|找不到该商品/.test(statusText)) delistedConfirmed = true
  }
  var bodySansRecommend = visibleTextExcludingRecommend(doc.body)
  var soldPending = !soldConfirmed && /商品已售罄/.test(bodySansRecommend) && /推荐以下相似商品/.test(bodySansRecommend)
  var delistedPending = !delistedConfirmed && /该商品已下架|商品已下架|商品不存在|找不到该商品/.test(bodySansRecommend)
  var unavailableMessage = '目标商品不可访问。页面显示售罄、下架或不存在，并可能出现相似推荐。不会采集推荐商品图片。请核对商品编号，或在普通浏览器对照同一条链接后再试。'
  if (soldConfirmed) return withSignals('unavailable', unavailableMessage, 'sold_out_similar', true)
  if (delistedConfirmed) return withSignals('unavailable', unavailableMessage, 'delisted', true)
  if (soldPending || delistedPending) return withSignals('unavailable', unavailableMessage, 'unconfirmed', false)

  var hasPassword = !!doc.querySelector('input[type="password"], input[name*="password" i]')
  var loginHeading = /请先登录|请登录|手机号登录|短信登录/.test(bodyText)
  var hasGoodsChrome = !!doc.querySelector('[data-competitor-region], [class*="swiper" i], [class*="goods-detail" i]')
  if (hasGoodsChrome) {
    var chrome = doc.querySelector('[data-competitor-region], [class*="swiper" i], [class*="goods-detail" i]')
    if (chrome && isRecommendOrFooterNode(chrome) && !doc.querySelector('[data-competitor-region]:not([data-competitor-region="recommend"])')) {
      hasGoodsChrome = false
    }
  }
  if ((hasPassword || loginHeading) && !hasGoodsChrome) {
    return withSignals('login', '页面提示需要登录。请在采集窗口自行登录，完成后会自动继续。', 'login', true)
  }
  if (expectedGoodsId && ((pageGoodsId && pageGoodsId !== expectedGoodsId) || (urlGoodsId && urlGoodsId !== expectedGoodsId))) {
    return withSignals('wrong_item', '打开了其他商品，已停止采集，不会抓取当前页图片。请核对商品编号后重试。', 'wrong_item', true)
  }
  if (/访问过于频繁|系统繁忙|请稍后重试/.test(bodyText) && !hasGoodsChrome) {
    return withSignals('platform', '页面提示访问受限或系统繁忙。已停止采集，请稍后再试或改为补传，不会绕过限制。', 'platform', true)
  }
  return null
}

export function parseHeroTotal(region: Element | null, doc: Document): number | null {
  if (region) {
    var marked = region.getAttribute('data-hero-total')
    if (marked && /^\d+$/.test(marked)) return Number(marked)
  }
  var text = ((region && region.textContent) || '') + ' ' + ((doc.body && doc.body.textContent) || '')
  var match = text.match(/(\d+)\s*\/\s*(\d+)/)
  if (match) return Number(match[2])
  match = text.match(/共\s*(\d+)\s*张/)
  if (match) return Number(match[1])
  return null
}

export function findHeroRegion(doc: Document): Element | null {
  var marked = firstVisible(doc, '[data-competitor-region="hero"]')
  if (marked && !isRecommendOrFooterNode(marked)) return marked
  var nodes = doc.querySelectorAll('[class*="swiper" i], [class*="carousel" i], [class*="gallery" i], [class*="goods-top" i], [class*="banner" i]')
  for (var i = 0; i < nodes.length; i += 1) {
    if (isElementVisible(nodes[i]) && !isRecommendOrFooterNode(nodes[i])) return nodes[i]
  }
  return null
}

export function findDetailRegion(doc: Document): Element | null {
  var marked = firstVisible(doc, '[data-competitor-region="detail"]')
  if (marked && !isRecommendOrFooterNode(marked)) return marked
  var headings = doc.querySelectorAll('h1,h2,h3,h4,h5,p,div,section')
  for (var i = 0; i < headings.length; i += 1) {
    var text = (headings[i].textContent || '').trim()
    if (text === '商品详情' || text === '详情' || text === '图文详情') {
      return headings[i].closest('section, article, .goods-detail, [class*="detail"]') || headings[i].parentElement || headings[i]
    }
  }
  return firstVisible(doc, '[class*="goods-detail" i], [class*="detail-img" i], [id*="detail" i]')
}

export function findOptionPanel(doc: Document): { panel: Element | null; inspected: boolean } {
  var marked = doc.querySelector('[data-competitor-region="option-panel"]')
  if (marked) return { panel: isElementVisible(marked) ? marked : null, inspected: isElementVisible(marked) }
  var dialogs = doc.querySelectorAll('[role="dialog"], [class*="sku" i], [class*="spec" i], [class*="sku-panel" i]')
  for (var i = 0; i < dialogs.length; i += 1) {
    if (isElementVisible(dialogs[i])) return { panel: dialogs[i], inspected: true }
  }
  var all = doc.querySelectorAll('div,section,aside')
  for (var j = 0; j < all.length; j += 1) {
    var el = all[j]
    if (!isElementVisible(el)) continue
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (text.indexOf('选购') >= 0 && el.querySelector('img') && text.length < 800) {
      return { panel: el, inspected: true }
    }
  }
  return { panel: null, inspected: false }
}

export function optionNameFromItem(item: Element): string {
  var marked = item.querySelector('[data-competitor-option-name]')
  if (marked && marked.textContent) return marked.textContent.replace(/\s+/g, ' ').trim()
  var nodes = item.querySelectorAll('span, div, p, strong, em, label')
  for (var i = 0; i < nodes.length; i += 1) {
    var text = (nodes[i].textContent || '').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 80) continue
    if (isPurchaseUiText(text)) continue
    if (/^\d+(\.\d+)?$/.test(text)) continue
    if (text === '选购' || text === '规格' || text === '套餐') continue
    return text
  }
  var fallback = (item.textContent || '').replace(/\s+/g, ' ').trim()
  if (fallback && !isPurchaseUiText(fallback) && fallback.length <= 80) return fallback
  return ''
}

export function collectOptions(panel: Element, images: DomImageCandidate[]): DomOptionCandidate[] {
  var items = panel.querySelectorAll('[data-competitor-option], [class*="sku-item" i], [class*="spec-item" i], li, [role="option"]')
  var nodes: Element[] = []
  if (items.length) {
    for (var i = 0; i < items.length; i += 1) nodes.push(items[i])
  } else {
    for (var c = 0; c < panel.children.length; c += 1) nodes.push(panel.children[c])
  }
  var options: DomOptionCandidate[] = []
  var used: Record<string, true> = {}
  for (var j = 0; j < nodes.length; j += 1) {
    var item = nodes[j]
    if (!isElementVisible(item)) continue
    var name = optionNameFromItem(item)
    if (!name) continue
    if (isPurchaseUiText(name)) continue
    var img = item.querySelector('img, [data-competitor-image="option"]')
    var imageLocalId: string | null = null
    var missingReason = ''
    if (img) {
      var picked = pickImageUrl(img)
      if (picked.url) {
        var existing = images.find(function (candidate) { return candidate.sourceUrl === picked.url })
        if (!existing) {
          var next = makeImage('option', images.length + 1, img, picked.url, picked.lazyUnloaded)
          images.push(next)
          existing = next
        }
        imageLocalId = existing.id
        used[existing.id] = true
      } else {
        missingReason = '该套餐可见，但没有可采集的选项图。'
      }
    } else {
      missingReason = '该套餐没有对应图片，已标为缺失，不会用主图顶替。'
    }
    var contentsEl = item.querySelector('[data-competitor-option-contents]')
    options.push({
      id: 'opt-' + (options.length + 1),
      optionName: name,
      contentsNote: contentsEl && contentsEl.textContent ? contentsEl.textContent.replace(/\s+/g, ' ').trim() : '',
      imageLocalId: imageLocalId,
      missing: !imageLocalId,
      missingReason: imageLocalId ? '' : missingReason,
    })
  }
  return options
}

export function resolvePageGoodsIdentity(doc: Document, href: string): { goodsId: string | null; itemIdSource: 'location_query' | 'og_url' | 'dom' | null } {
  var urlGoodsId = readGoodsIdFromLocation(href)
  var og = doc.querySelector('meta[property="og:url"]')
  var ogGoodsId = readGoodsIdFromLocation(og ? og.getAttribute('content') || '' : '')
  var domGoodsId = readGoodsIdFromDom(doc)
  if (ogGoodsId) return { goodsId: ogGoodsId, itemIdSource: 'og_url' }
  if (domGoodsId) return { goodsId: domGoodsId, itemIdSource: 'dom' }
  if (urlGoodsId) return { goodsId: urlGoodsId, itemIdSource: 'location_query' }
  return { goodsId: null, itemIdSource: null }
}

export function extractCompetitorDom(doc: Document, expectedGoodsId?: string | null): CaptureDomResult {
  var notes: string[] = []
  var href = ''
  try {
    href = doc.location && doc.location.href ? doc.location.href : ''
  } catch (_err) {
    href = ''
  }
  if (!href) {
    var canonical = doc.querySelector('link[rel="canonical"]')
    href = canonical ? canonical.getAttribute('href') || '' : ''
  }
  var resolved = resolvePageGoodsIdentity(doc, href)
  var itemIdSource: 'location_query' | 'og_url' | 'dom' | null = resolved.itemIdSource
  var goodsId = resolved.goodsId

  var blocked = detectBlock(doc, expectedGoodsId)
  var fallbackSignals: CapturePageSignals = {
    rule: null,
    urlPath: sanitizeUrlPath(href),
    itemIdMatch: expectedGoodsId && goodsId ? goodsId === expectedGoodsId : null,
    itemIdSource: itemIdSource,
    confirmed: true,
  }
  if (blocked) {
    return {
      goodsId: goodsId,
      blocked: true,
      blockReason: blocked.reason,
      blockMessage: blocked.message,
      hero: [],
      detail: [],
      options: [],
      optionImages: [],
      optionsInspected: false,
      heroExpectedTotal: null,
      notes: [blocked.message],
      pageSignals: {
        rule: blocked.rule,
        urlPath: blocked.urlPath,
        itemIdMatch: blocked.itemIdMatch,
        itemIdSource: itemIdSource,
        confirmed: blocked.confirmed,
      },
    }
  }

  var heroRegion = findHeroRegion(doc)
  var detailRegion = findDetailRegion(doc)
  var optionInfo = findOptionPanel(doc)

  var hero = heroRegion ? collectFromRegion(heroRegion, 'hero') : []
  var detail = detailRegion ? collectFromRegion(detailRegion, 'detail') : []
  var optionImages: DomImageCandidate[] = []
  var options: DomOptionCandidate[] = []
  if (optionInfo.inspected && optionInfo.panel) {
    options = collectOptions(optionInfo.panel, optionImages)
  } else {
    notes.push('未检查选项：选购弹窗未打开，不会推断套餐数量，也不会用主图充当选项图。')
  }

  var heroUrls: Record<string, true> = {}
  hero.forEach(function (item) { heroUrls[item.sourceUrl] = true })
  options = options.map(function (opt) {
    if (!opt.imageLocalId) return opt
    var img = optionImages.find(function (item) { return item.id === opt.imageLocalId })
    if (img && heroUrls[img.sourceUrl]) {
      return { ...opt, imageLocalId: null, missing: true, missingReason: '该图来自主图区域，不能充当选项图，已标为缺失。' }
    }
    return opt
  })
  optionImages = optionImages.filter(function (item) {
    return !heroUrls[item.sourceUrl] && options.some(function (opt) { return opt.imageLocalId === item.id })
  })

  var heroExpectedTotal = parseHeroTotal(heroRegion, doc)
  if (!hero.length) notes.push('未在页面中识别到主图或轮播图。')
  if (!detail.length) notes.push('未在页面中识别到详情图。')

  return {
    goodsId: goodsId,
    blocked: false,
    blockReason: null,
    blockMessage: '',
    hero: hero,
    detail: detail,
    options: options,
    optionImages: optionImages,
    optionsInspected: optionInfo.inspected,
    heroExpectedTotal: heroExpectedTotal,
    notes: notes,
    pageSignals: fallbackSignals,
  }
}

export function captureDomRuntimeSource(): string {
  return [
    'var PLACEHOLDER_RE = /(?:data:image\\/(?:gif|png|svg\\+xml)|placeholder|spacer|blank|transparent|1x1|lazy-loading)/i;',
    'var IMAGE_URL_RE = /\\.(?:jpg|jpeg|png|webp|gif|bmp|avif)(?:$|\\?)/i;',
    'var PURCHASE_RE = /价格|预计送达|¥|￥|券后|马上抢|立即购买|加入购物车|运费|促销倒计时/;',
    isPurchaseUiText.toString(),
    readGoodsIdFromLocation.toString(),
    normalizeImageUrl.toString(),
    isLikelyLongImage.toString(),
    attrNumber.toString(),
    isElementVisible.toString(),
    pickImageUrl.toString(),
    makeImage.toString(),
    dedupeImages.toString(),
    collectFromRegion.toString(),
    firstVisible.toString(),
    isRecommendOrFooterNode.toString(),
    readGoodsIdFromDom.toString(),
    resolvePageGoodsIdentity.toString(),
    sanitizeUrlPath.toString(),
    visibleTextExcludingRecommend.toString(),
    findStatusContainers.toString(),
    isHomePath.toString(),
    detectBlock.toString(),
    parseHeroTotal.toString(),
    findHeroRegion.toString(),
    findDetailRegion.toString(),
    findOptionPanel.toString(),
    optionNameFromItem.toString(),
    collectOptions.toString(),
    extractCompetitorDom.toString(),
  ].join('\n')
}
