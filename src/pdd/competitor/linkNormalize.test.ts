import { describe, expect, it } from 'vitest'
import { canonicalGoodsUrl, MAX_LOGIN_WRAP_DEPTH, normalizeCompetitorLink, resolveNavigationUrl } from './linkNormalize'
import { collectorOpenUrl, collectorRestoreUrl } from './collector/openUrl'
import { createCollectorJob, publicJob } from './collector/jobState'

const SAMPLE_GOODS_ID = '100000000001'
const SAMPLE_CANONICAL = 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001'
const SECRET = 'TEST_SECRET_DO_NOT_STORE'
const TICKET = 'TEST_TICKET'

describe('竞品链接规范化', () => {
  it('规范化无跟踪参数的商品页，并声明尚未抓图', () => {
    const result = normalizeCompetitorLink(SAMPLE_CANONICAL)
    expect(result.ok).toBe(true)
    expect(result.goodsId).toBe(SAMPLE_GOODS_ID)
    expect(result.canonicalUrl).toBe(SAMPLE_CANONICAL)
    expect(result.entryKind).toBe('direct_goods')
    expect(result.loginLikely).toBe(false)
    expect(result.captureStatus).toBe('normalized_not_fetched')
    expect(result.navigationUrl).toBe(SAMPLE_CANONICAL)
    expect(result.message).toMatch(/尚未抓取/)
  })

  it('登录包装页从原外层入口打开，目标编号来自内层，短链不含跟踪字段', () => {
    const inner = `${SAMPLE_CANONICAL}&pxq_secret_key=${SECRET}&share_ticket=${TICKET}`
    const wrapped = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent(inner)}`
    const result = normalizeCompetitorLink(wrapped)
    expect(result.ok).toBe(true)
    expect(result.inputKind).toBe('login_wrapper')
    expect(result.entryKind).toBe('raw_login_wrapper')
    expect(result.goodsId).toBe(SAMPLE_GOODS_ID)
    expect(result.canonicalUrl).toBe(SAMPLE_CANONICAL)
    expect(result.loginLikely).toBe(true)
    expect(result.canonicalUrl).not.toMatch(/pxq_secret_key|share_ticket|share_uin|TEST_SECRET|TEST_TICKET/)
    expect(result.message).not.toMatch(/TEST_SECRET_DO_NOT_STORE|TEST_TICKET/)
    expect(result.navigationUrl).toBe(wrapped)
    expect(result.navigationUrl).toContain('/login.html')
    expect(result.navigationUrl).toContain(encodeURIComponent(inner))
    expect(result.message).toMatch(/登录入口/)
    expect(result.message).toMatch(/尚未抓取/)
    const job = createCollectorJob({
      goodsId: result.goodsId!,
      canonicalUrl: result.canonicalUrl!,
      navigationUrl: result.navigationUrl || undefined,
      entryKind: result.entryKind || undefined,
    })
    expect(collectorOpenUrl(job)).toBe(wrapped)
    expect(collectorOpenUrl(job)).toContain('/login.html')
    expect(job.goodsId).toBe(SAMPLE_GOODS_ID)
  })

  it('直链带内层跟踪参数时，完整参数只留在内存导航地址', () => {
    const direct = `${SAMPLE_CANONICAL}&pxq_secret_key=${SECRET}`
    const result = normalizeCompetitorLink(direct)
    expect(result.ok).toBe(true)
    expect(result.entryKind).toBe('direct_goods')
    expect(result.navigationUrl).toContain(`pxq_secret_key=${SECRET}`)
    expect(result.canonicalUrl).toBe(SAMPLE_CANONICAL)
    expect(result.message).not.toMatch(/TEST_SECRET_DO_NOT_STORE/)
  })

  it('拒绝非拼多多域名和内网地址', () => {
    expect(normalizeCompetitorLink('https://example.com/goods?goods_id=100000000001').ok).toBe(false)
    expect(normalizeCompetitorLink('https://example.com/goods?goods_id=100000000001').captureStatus).toBe('unsupported_host')
    expect(normalizeCompetitorLink('http://127.0.0.1/goods2.html?goods_id=100000000001').ok).toBe(false)
    expect(normalizeCompetitorLink('http://192.168.1.8/goods2.html?goods_id=100000000001').ok).toBe(false)
    expect(normalizeCompetitorLink('file:///tmp/goods.html').ok).toBe(false)
    expect(canonicalGoodsUrl(SAMPLE_GOODS_ID)).toBe(SAMPLE_CANONICAL)
  })

  it('拒绝登录包装指向恶意域名、非 https 或异常嵌套', () => {
    const hidden = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent('https://example.com/goods2.html?goods_id=100000000001')}`
    expect(normalizeCompetitorLink(hidden).ok).toBe(false)
    expect(normalizeCompetitorLink(hidden).navigationUrl).toBe(null)
    expect(normalizeCompetitorLink(hidden).message).not.toMatch(/example\.com/)

    const localInner = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent('http://127.0.0.1/goods2.html?goods_id=100000000001')}`
    expect(normalizeCompetitorLink(localInner).ok).toBe(false)
    expect(normalizeCompetitorLink(localInner).navigationUrl).toBe(null)

    const httpInner = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent('http://mobile.yangkeduo.com/goods2.html?goods_id=100000000001')}`
    expect(normalizeCompetitorLink(httpInner).ok).toBe(false)

    const jsInner = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent('javascript:alert(1)')}`
    expect(normalizeCompetitorLink(jsInner).ok).toBe(false)

    const innerLoginNoGoods = 'https://mobile.yangkeduo.com/login.html?from=%2Flogin.html'
    expect(normalizeCompetitorLink(innerLoginNoGoods).ok).toBe(false)
    expect(normalizeCompetitorLink(innerLoginNoGoods).navigationUrl).toBe(null)

    const relativeInner = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent('/goods2.html?goods_id=100000000001')}`
    const relative = normalizeCompetitorLink(relativeInner)
    expect(relative.ok).toBe(true)
    expect(relative.entryKind).toBe('raw_login_wrapper')
    expect(relative.goodsId).toBe(SAMPLE_GOODS_ID)
    expect(relative.canonicalUrl).toBe(SAMPLE_CANONICAL)
    expect(relative.navigationUrl).toBe(relativeInner)
    expect(relative.navigationUrl).toContain('/login.html')

    const tooDeepGoods = SAMPLE_CANONICAL
    const layer3 = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent(tooDeepGoods)}`
    const layer2 = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent(layer3)}`
    const layer1 = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent(layer2)}`
    const deep = normalizeCompetitorLink(layer1)
    expect(deep.ok).toBe(false)
    expect(deep.navigationUrl).toBe(null)
    expect(MAX_LOGIN_WRAP_DEPTH).toBe(2)

    const twoLayer = normalizeCompetitorLink(layer2)
    expect(twoLayer.ok).toBe(true)
    expect(twoLayer.entryKind).toBe('raw_login_wrapper')
    expect(twoLayer.goodsId).toBe(SAMPLE_GOODS_ID)
    expect(twoLayer.navigationUrl).toBe(layer2)
  })
})

describe('navigation url vs canonical url', () => {
  it('空输入回退到短链，商品编号不一致时拒绝', () => {
    const fallback = resolveNavigationUrl('', '100000000001')
    expect(fallback.ok).toBe(true)
    if (fallback.ok) {
      expect(fallback.navigationUrl).toBe(SAMPLE_CANONICAL)
      expect(fallback.entryKind).toBe('direct_goods')
    }
    const mismatch = resolveNavigationUrl(SAMPLE_CANONICAL, '1022650930715')
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.message).not.toMatch(/TEST_SECRET|pxq_secret/)
  })

  it('resolveNavigationUrl 对登录包装保留外层入口', () => {
    const inner = `${SAMPLE_CANONICAL}&pxq_secret_key=${SECRET}`
    const wrapped = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent(inner)}`
    const resolved = resolveNavigationUrl(wrapped, SAMPLE_GOODS_ID)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(resolved.entryKind).toBe('raw_login_wrapper')
      expect(resolved.navigationUrl).toBe(wrapped)
      expect(resolved.navigationUrl).toContain('/login.html')
    }
  })
})

describe('公开任务与打开地址隔离', () => {
  it('公开任务含入口类型，不含内存导航或跟踪参数', () => {
    const inner = `${SAMPLE_CANONICAL}&pxq_secret_key=${SECRET}`
    const wrapped = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent(inner)}`
    const parsed = normalizeCompetitorLink(wrapped)
    const job = createCollectorJob({
      goodsId: parsed.goodsId!,
      canonicalUrl: parsed.canonicalUrl!,
      navigationUrl: parsed.navigationUrl || undefined,
      entryKind: parsed.entryKind || undefined,
    })
    const published = publicJob(job)
    expect(published.entryKind).toBe('raw_login_wrapper')
    expect(published).not.toHaveProperty('navigationUrl')
    expect(JSON.stringify(published)).not.toMatch(/TEST_SECRET_DO_NOT_STORE|pxq_secret_key|login\.html\?from=/)
    expect(collectorOpenUrl(job)).toBe(wrapped)
  })
})


const TEST_SHARE_TOKEN = 'TEST_SHARE_TOKEN'
const SHARE_LINK = `https://mobile.yangkeduo.com/goods2.html?ps=${TEST_SHARE_TOKEN}`

describe('无编号分享入口', () => {
  it('原始分享链接可打开，查询只留在内存导航，商品编号延后确认', () => {
    const result = normalizeCompetitorLink(SHARE_LINK)
    expect(result.ok).toBe(true)
    expect(result.entryKind).toBe('raw_share_link')
    expect(result.goodsId).toBe(null)
    expect(result.canonicalUrl).toBe('https://mobile.yangkeduo.com/goods2.html')
    expect(result.canonicalUrl).not.toMatch(/ps=|TEST_SHARE_TOKEN/)
    expect(result.navigationUrl).toBe(SHARE_LINK)
    expect(result.loginLikely).toBe(true)
    expect(result.message).toMatch(/分享入口|原/)
    expect(result.message).not.toMatch(/TEST_SHARE_TOKEN/)
    const job = createCollectorJob({
      goodsId: result.goodsId || '',
      canonicalUrl: result.canonicalUrl!,
      navigationUrl: result.navigationUrl || undefined,
      entryKind: result.entryKind || undefined,
    })
    expect(collectorOpenUrl(job)).toBe(SHARE_LINK)
    const published = publicJob(job)
    expect(published.entryKind).toBe('raw_share_link')
    expect(published.goodsId).toBe('')
    expect(published).not.toHaveProperty('navigationUrl')
    expect(published).not.toHaveProperty('targetRestoresUsed')
    expect(JSON.stringify(published)).not.toMatch(/TEST_SHARE_TOKEN|ps=/)
  })

  it('登录包装内层无编号时仍从原登录入口打开', () => {
    const wrapped = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent(SHARE_LINK)}`
    const result = normalizeCompetitorLink(wrapped)
    expect(result.ok).toBe(true)
    expect(result.entryKind).toBe('raw_login_wrapper')
    expect(result.goodsId).toBe(null)
    expect(result.canonicalUrl).toBe('https://mobile.yangkeduo.com/goods2.html')
    expect(result.navigationUrl).toBe(wrapped)
    expect(result.navigationUrl).toContain('/login.html')
    expect(result.message).not.toMatch(/TEST_SHARE_TOKEN/)
    const resolved = resolveNavigationUrl(wrapped, '')
    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(resolved.entryKind).toBe('raw_login_wrapper')
      expect(resolved.navigationUrl).toBe(wrapped)
    }
  })

  it('空输入且没有已知编号时拒绝，有编号的空输入仍回退短链', () => {
    const empty = resolveNavigationUrl('', '')
    expect(empty.ok).toBe(false)
    const withId = resolveNavigationUrl(SHARE_LINK, '')
    expect(withId.ok).toBe(true)
    if (withId.ok) {
      expect(withId.entryKind).toBe('raw_share_link')
      expect(withId.navigationUrl).toBe(SHARE_LINK)
    }
  })
})


describe('登录后恢复商品目标', () => {
  it('登录包装首次打开外层入口，恢复时使用内层商品地址，且公开任务不含这些地址', () => {
    const inner = `${SAMPLE_CANONICAL}&pxq_secret_key=${SECRET}`
    const wrapped = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent(inner)}`
    const result = normalizeCompetitorLink(wrapped)
    expect(result.ok).toBe(true)
    expect(result.navigationUrl).toBe(wrapped)
    expect(result.restoreUrl).toBe(inner)
    expect(result.restoreUrl).not.toContain('/login.html')
    const job = createCollectorJob({
      goodsId: result.goodsId || '',
      canonicalUrl: result.canonicalUrl!,
      navigationUrl: result.navigationUrl || undefined,
      restoreUrl: result.restoreUrl || undefined,
      entryKind: result.entryKind || undefined,
    })
    expect(collectorOpenUrl(job)).toBe(wrapped)
    expect(collectorRestoreUrl(job)).toBe(inner)
    const published = publicJob(job)
    expect(published).not.toHaveProperty('navigationUrl')
    expect(published).not.toHaveProperty('restoreUrl')
    expect(JSON.stringify(published)).not.toMatch(/TEST_SECRET_DO_NOT_STORE|pxq_secret_key|login\.html\?from=/)
  })
})
