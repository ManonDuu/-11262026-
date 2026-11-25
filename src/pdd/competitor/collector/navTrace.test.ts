import { describe, expect, it } from 'vitest'
import { createNavTrace, recordCurrent, recordGoto, recordObserve, summarizeNavUrl } from './navTrace'
import { createCollectorJob, publicJob } from './jobState'

const SECRET = 'TEST_SECRET_DO_NOT_STORE'
const SHARE = 'https://mobile.yangkeduo.com/goods2.html?ps=TEST_SHARE_TOKEN'

describe('脱敏导航摘要', () => {
  it('只保留路径和参数名，能区分实际打开与当前页，且不含参数值', () => {
    const share = summarizeNavUrl(SHARE)
    expect(share.path).toBe('/goods2.html')
    expect(share.paramNames).toEqual(['ps'])
    expect(share.hasPs).toBe(true)
    expect(share.hasGoodsId).toBe(false)
    const canonical = summarizeNavUrl('https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001')
    expect(canonical.hasGoodsId).toBe(true)
    expect(canonical.hasPs).toBe(false)
    const traced = recordCurrent(recordGoto(createNavTrace({
      entryKind: 'raw_share_link',
      navigationUrl: SHARE,
      restoreUrl: SHARE,
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html',
    }), SHARE, 'open'), 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001')
    expect(traced.lastGoto?.hasPs).toBe(true)
    expect(traced.lastGoto?.source).toBe('open')
    expect(traced.current?.hasPs).toBe(false)
    expect(traced.current?.hasGoodsId).toBe(true)
    const text = JSON.stringify(traced)
    expect(text).not.toMatch(/TEST_SHARE_TOKEN|TEST_SECRET|pxq_secret|ps=TEST/)
    expect(text).not.toMatch(/https:\/\/mobile\.yangkeduo\.com\/goods2\.html\?/)
  })

  it('公开任务含追踪但不含完整链接或跟踪参数值', () => {
    const inner = `https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001&pxq_secret_key=${SECRET}&ps=TEST_SHARE_TOKEN`
    const wrapped = `https://mobile.yangkeduo.com/login.html?from=${encodeURIComponent(inner)}`
    const job = createCollectorJob({
      goodsId: '100000000001',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001',
      navigationUrl: wrapped,
      restoreUrl: inner,
      entryKind: 'raw_login_wrapper',
    })
    const published = publicJob(job)
    expect(published.navTrace?.outer?.path).toBe('/login.html')
    expect(published.navTrace?.outer?.hasFrom).toBe(true)
    expect(published.navTrace?.inner?.hasPs).toBe(true)
    expect(published.navTrace?.inner?.hasGoodsId).toBe(true)
    expect(published).not.toHaveProperty('navigationUrl')
    expect(published).not.toHaveProperty('restoreUrl')
    expect(JSON.stringify(published)).not.toMatch(/TEST_SECRET_DO_NOT_STORE|TEST_SHARE_TOKEN|pxq_secret_key|login\.html\?from=/)
  })
})


describe('观察锚点脱敏字段', () => {
  it('记录标签数量和是否为本次打开的标签，且仍不含链接或参数值', () => {
    const traced = recordObserve(recordGoto(createNavTrace({
      entryKind: 'raw_share_link',
      navigationUrl: SHARE,
      restoreUrl: SHARE,
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html',
    }), SHARE, 'open'), 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001&pxq_secret_key=' + SECRET, {
      tabCount: 2,
      currentIsGotoTab: true,
      currentIsGotoTabReason: 'compared',
      sawLoginOnTaskTab: false,
      pageKind: 'goods',
      soldOutTextSeen: true,
      similarRecommendationTextSeen: true,
      itemIdSource: 'location_query',
    })
    expect(traced.tabCount).toBe(2)
    expect(traced.currentIsGotoTab).toBe(true)
    expect(traced.currentIsGotoTabReason).toBe('compared')
    expect(traced.sawLoginOnTaskTab).toBe(false)
    expect(traced.pageKind).toBe('goods')
    expect(traced.soldOutTextSeen).toBe(true)
    expect(traced.similarRecommendationTextSeen).toBe(true)
    const text = JSON.stringify(traced)
    expect(text).not.toMatch(/TEST_SHARE_TOKEN|TEST_SECRET|pxq_secret|ps=TEST/)
    expect(text).not.toMatch(/https:\/\/mobile\.yangkeduo\.com\/goods2\.html\?/)
  })
})
