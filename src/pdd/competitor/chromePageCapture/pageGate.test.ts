import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { extractCompetitorDom } from '../captureDom'
import { FIXTURE_EIGHT_HERO_SHARED_OPTIONS, FIXTURE_SOLD_OUT_RECOMMEND } from '../fixtures/captureDomFixtures'
import { canExportDom, classifyPath } from './pageGate'

function parse(html: string, href = 'https://mobile.yangkeduo.com/goods2.html') {
  return new JSDOM(html, { url: href }).window.document
}

describe('扩展导入页面门禁', () => {
  it('拒绝个人、订单、首页等敏感路径，即使页面里已有图也不采集', () => {
    expect(classifyPath('/orders.html')).toBe('sensitive')
    expect(classifyPath('/personal.html')).toBe('sensitive')
    expect(classifyPath('/')).toBe('sensitive')
    expect(canExportDom({
      pathname: '/orders.html',
      blocked: false,
      heroCount: 8,
      detailCount: 18,
      optionImageCount: 2,
      optionsInspected: true,
    }).ok).toBe(false)
  })

  it('仅有商品路径但没有可见主图、详情图或套餐图时拒绝，不靠地址编号放行', () => {
    expect(classifyPath('/goods2.html')).toBe('goods')
    const decision = canExportDom({
      pathname: '/goods2.html',
      blocked: false,
      heroCount: 0,
      detailCount: 0,
      optionImageCount: 0,
      optionsInspected: false,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toMatch(/仅有地址编号不能当作详情页/)
  })

  it('售罄推荐页和登录页拒绝导出', () => {
    const sold = extractCompetitorDom(parse(FIXTURE_SOLD_OUT_RECOMMEND))
    expect(sold.blocked).toBe(true)
    expect(canExportDom({
      pathname: '/goods2.html',
      blocked: sold.blocked,
      blockReason: sold.blockReason,
      heroCount: sold.hero.length,
      detailCount: sold.detail.length,
      optionImageCount: sold.optionImages.length,
      optionsInspected: sold.optionsInspected,
    }).ok).toBe(false)
  })

  it('可见商品 DOM 可通过，并复用现有提取结果', () => {
    const snap = extractCompetitorDom(parse(FIXTURE_EIGHT_HERO_SHARED_OPTIONS))
    const decision = canExportDom({
      pathname: '/goods2.html',
      blocked: snap.blocked,
      blockReason: snap.blockReason,
      heroCount: snap.hero.length,
      detailCount: snap.detail.length,
      optionImageCount: snap.optionImages.length,
      optionsInspected: snap.optionsInspected,
    })
    expect(snap.blocked).toBe(false)
    expect(decision).toEqual({ ok: true })
    expect(snap.hero.length).toBeGreaterThan(0)
    expect(snap.detail.length).toBeGreaterThan(0)
  })
})
