import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { extractCompetitorDom } from './captureDom'
import {
  FIXTURE_CLOSED_OPTIONS,
  FIXTURE_FULL,
  FIXTURE_HERO_AS_OPTION,
  FIXTURE_LAZY_AND_LONG,
  FIXTURE_LOGIN_WALL,
  FIXTURE_MISSING_OPTION_IMAGE,
  FIXTURE_NORMAL_WITH_FOOTER_RECOMMEND,
  FIXTURE_SOLD_OUT_RECOMMEND,
  FIXTURE_SKU_SOLD_AND_FOOTER_RECOMMEND,
  FIXTURE_HIDDEN_SOLD_OUT_TEXT,
  FIXTURE_DELISTED_MAIN,
  FIXTURE_EIGHT_HERO_SHARED_OPTIONS,
  FIXTURE_POST_LOGIN_HOME,
  FIXTURE_SHARE_DOM_IDENTITY,
  FIXTURE_SHARE_OG_IDENTITY,
  FIXTURE_SHARE_RECOMMEND_ONLY_ID,
  FIXTURE_SHARE_WRONG_OG,
  SHARE_HREF,
} from './fixtures/captureDomFixtures'
import { evaluateGoodsIdentity } from './chromePageCapture/diagnostics'
import { classifyCapturePage } from './collector/pageStatus'

function parse(html: string, href = 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001'): Document {
  const dom = new JSDOM(html, { url: href })
  return dom.window.document
}

describe('extractCompetitorDom', () => {
  it('从合成商品页解析主图、详情图，并绑定选购套餐图', () => {
    const result = extractCompetitorDom(parse(FIXTURE_FULL))
    expect(result.blocked).toBe(false)
    expect(result.goodsId).toBe('100000000001')
    expect(result.hero.map((item) => item.sourceUrl)).toEqual([
      'https://img.example.test/hero-1.jpg',
      'https://img.example.test/hero-2.jpg',
      'https://img.example.test/hero-3.jpg',
    ])
    expect(result.heroExpectedTotal).toBe(3)
    expect(result.detail).toHaveLength(2)
    expect(result.detail[1].likelyLongImage).toBe(true)
    expect(result.optionsInspected).toBe(true)
    expect(result.options.map((item) => item.optionName)).toEqual([
      '单独一只挖掘机',
      '加10个仿真塑料石头+2人仔',
      '加10个仿真塑料石头+2人仔+6只迷你工程车',
    ])
    expect(result.options.every((item) => !item.missing && item.imageLocalId)).toBe(true)
    expect(result.optionImages).toHaveLength(3)
    expect(result.optionImages.some((item) => item.sourceUrl.includes('hero-'))).toBe(false)
  })

  it('轮播重复节点会去重，懒加载缺失会反映在覆盖不足', () => {
    const result = extractCompetitorDom(parse(FIXTURE_LAZY_AND_LONG))
    expect(result.hero.map((item) => item.sourceUrl)).toEqual([
      'https://img.example.test/hero-1.jpg',
      'https://img.example.test/hero-2.jpg',
    ])
    expect(result.heroExpectedTotal).toBe(4)
    expect(result.hero.length).toBeLessThan(result.heroExpectedTotal!)
    expect(result.detail[0].likelyLongImage).toBe(true)
    expect(result.detail[0].sourceUrl).toBe('https://img.example.test/detail-long.jpg')
  })

  it('选购弹窗关闭时不推断套餐，也不把主图当作选项图', () => {
    const result = extractCompetitorDom(parse(FIXTURE_CLOSED_OPTIONS))
    expect(result.optionsInspected).toBe(false)
    expect(result.options).toEqual([])
    expect(result.optionImages).toEqual([])
    expect(result.hero.length).toBeGreaterThan(0)
    expect(result.notes.some((note) => note.includes('未检查选项'))).toBe(true)
  })

  it('套餐缺图时保留名称并标缺失，不用主图填充', () => {
    const result = extractCompetitorDom(parse(FIXTURE_MISSING_OPTION_IMAGE))
    expect(result.optionsInspected).toBe(true)
    expect(result.options).toHaveLength(2)
    expect(result.options[0].missing).toBe(false)
    expect(result.options[1].missing).toBe(true)
    expect(result.options[1].imageLocalId).toBeNull()
    expect(result.options[1].missingReason).toMatch(/缺失/)
    expect(result.optionImages).toHaveLength(1)
  })

  it('选项图若与主图相同则拒绝绑定', () => {
    const result = extractCompetitorDom(parse(FIXTURE_HERO_AS_OPTION))
    expect(result.options[0].missing).toBe(true)
    expect(result.options[0].imageLocalId).toBeNull()
    expect(result.options[0].missingReason).toMatch(/主图/)
    expect(result.optionImages).toHaveLength(0)
  })

  it('遇到登录墙时停止采集且不返回图片', () => {
    const result = extractCompetitorDom(parse(
      FIXTURE_LOGIN_WALL,
      'https://mobile.yangkeduo.com/login.html?from=%2Fgoods2.html%3Fgoods_id%3D100000000001',
    ))
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe('login')
    expect(result.hero).toEqual([])
    expect(result.detail).toEqual([])
    expect(result.options).toEqual([])
  })
})


describe('售罄、推荐页与目标商品校验', () => {
  it('售罄并出现相似推荐时标为目标不可访问，且不提取推荐图', () => {
    const result = extractCompetitorDom(parse(
      FIXTURE_SOLD_OUT_RECOMMEND,
      'https://mobile.yangkeduo.com/goods2.html?goods_id=1022650930715',
    ), '1022650930715')
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe('unavailable')
    expect(result.blockMessage).toMatch(/目标商品不可访问/)
    expect(result.hero).toEqual([])
    expect(result.detail).toEqual([])
    expect(result.optionImages).toEqual([])
    expect(classifyCapturePage(result, '1022650930715')).toBe('unavailable')
    expect(result.pageSignals?.rule).toBe('sold_out_similar')
    expect(result.pageSignals?.confirmed).toBe(true)
    expect(result.pageSignals?.urlPath).toBe('/goods2.html')
  })

  it('规格售罄且页脚有相似推荐时，不把目标商品当不可访问，也不采推荐图', () => {
    const result = extractCompetitorDom(parse(FIXTURE_SKU_SOLD_AND_FOOTER_RECOMMEND), '100000000001')
    expect(result.blocked).toBe(false)
    expect(result.hero.map((item) => item.sourceUrl)).toEqual(['https://img.example.test/hero-1.jpg'])
    expect(result.detail).toHaveLength(1)
    expect([...result.hero, ...result.detail, ...result.optionImages].some((item) => item.sourceUrl.includes('rec-'))).toBe(false)
    expect(classifyCapturePage(result, '100000000001')).toBe('proceed')
  })

  it('隐藏节点中的售罄文案不会阻断正常商品页', () => {
    const result = extractCompetitorDom(parse(FIXTURE_HIDDEN_SOLD_OUT_TEXT), '100000000001')
    expect(result.blocked).toBe(false)
    expect(classifyCapturePage(result, '100000000001')).toBe('proceed')
    expect(result.hero).toHaveLength(1)
  })

  it('主内容明确下架时标记为已确认不可访问，不采推荐图', () => {
    const result = extractCompetitorDom(parse(
      FIXTURE_DELISTED_MAIN,
      'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001',
    ), '100000000001')
    expect(result.blocked).toBe(true)
    expect(result.pageSignals?.rule).toBe('delisted')
    expect(result.pageSignals?.confirmed).toBe(true)
    expect(result.pageSignals?.itemIdMatch).toBe(true)
    expect(result.hero).toEqual([])
    expect(result.detail).toEqual([])
  })

  it('正常商品页底部推荐不会被当成售罄，只保留目标图', () => {
    const result = extractCompetitorDom(parse(FIXTURE_NORMAL_WITH_FOOTER_RECOMMEND), '100000000001')
    expect(result.blocked).toBe(false)
    expect(result.hero.map((item) => item.sourceUrl)).toEqual(['https://img.example.test/hero-1.jpg'])
    expect(result.detail).toHaveLength(1)
    expect(result.hero.some((item) => item.sourceUrl.includes('rec-'))).toBe(false)
    expect(classifyCapturePage(result, '100000000001')).toBe('proceed')
  })

  it('页面商品编号与目标不一致时停止，不采当前页图片', () => {
    const result = extractCompetitorDom(parse(FIXTURE_FULL), '1022650930715')
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe('wrong_item')
    expect(result.hero).toEqual([])
    expect(classifyCapturePage(result, '1022650930715')).toBe('wrong_item')
  })

  it('登录墙判定为等待登录，不是售罄或成功', () => {
    const result = extractCompetitorDom(parse(
      FIXTURE_LOGIN_WALL,
      'https://mobile.yangkeduo.com/login.html?from=%2Fgoods2.html%3Fgoods_id%3D100000000001',
    ), '100000000001')
    expect(classifyCapturePage(result, '100000000001')).toBe('wait_login')
    expect(result.hero).toEqual([])
  })
})


describe('分享页图量与登录后首页', () => {
  it('读取 8 张主图、18 张详情（允许与主图重叠）以及 3 个套餐共用 2 张选项图，不混入推荐图', () => {
    const result = extractCompetitorDom(parse(FIXTURE_EIGHT_HERO_SHARED_OPTIONS))
    expect(result.blocked).toBe(false)
    expect(result.goodsId).toBe('100000000001')
    expect(result.hero).toHaveLength(8)
    expect(result.heroExpectedTotal).toBe(8)
    expect(result.detail).toHaveLength(18)
    const heroUrls = new Set(result.hero.map((item) => item.sourceUrl))
    expect(result.detail.some((item) => heroUrls.has(item.sourceUrl))).toBe(true)
    expect(result.optionsInspected).toBe(true)
    expect(result.options.map((item) => item.optionName)).toEqual([
      '单独一只挖掘机',
      '【加10个仿真塑料石头+2人仔】',
      '【加10个仿真塑料石头+2人仔+6只迷你工程车】',
    ])
    expect(result.options.every((item) => !item.missing && item.imageLocalId)).toBe(true)
    expect(result.options[0].imageLocalId).toBe(result.options[1].imageLocalId)
    expect(result.options[2].imageLocalId).not.toBe(result.options[0].imageLocalId)
    expect(result.optionImages).toHaveLength(2)
    expect([...result.hero, ...result.detail, ...result.optionImages].some((item) => item.sourceUrl.includes('rec-'))).toBe(false)
    expect(classifyCapturePage(result, '')).toBe('proceed')
    expect(classifyCapturePage(result, '100000000001')).toBe('proceed')
  })

  it('登录后落到首页时不采集推荐图，也不判为售罄', () => {
    const result = extractCompetitorDom(parse(FIXTURE_POST_LOGIN_HOME, 'https://mobile.yangkeduo.com/index.html'))
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe('post_login_home')
    expect(result.hero).toEqual([])
    expect(result.detail).toEqual([])
    expect(result.optionImages).toEqual([])
    expect(classifyCapturePage(result, '')).toBe('post_login_home')
    expect(classifyCapturePage(result, '100000000001')).toBe('post_login_home')
  })
})

describe('分享链上的商品身份证据', () => {
  it('优先采用 og 或主内容 data 编号，而不是地址参数', () => {
    const og = extractCompetitorDom(parse(FIXTURE_SHARE_OG_IDENTITY, SHARE_HREF), '100000000001')
    expect(og.blocked).toBe(false)
    expect(og.goodsId).toBe('100000000001')
    expect(og.pageSignals?.itemIdSource).toBe('og_url')
    expect(og.hero).toHaveLength(1)
    expect(evaluateGoodsIdentity({
      expectedGoodsId: '100000000001',
      observedGoodsId: og.goodsId,
      itemIdSource: og.pageSignals?.itemIdSource,
    }).status).toBe('verified')

    const dom = extractCompetitorDom(parse(FIXTURE_SHARE_DOM_IDENTITY, SHARE_HREF), '100000000001')
    expect(dom.blocked).toBe(false)
    expect(dom.goodsId).toBe('100000000001')
    expect(dom.pageSignals?.itemIdSource).toBe('dom')
    expect(evaluateGoodsIdentity({
      expectedGoodsId: '100000000001',
      observedGoodsId: dom.goodsId,
      itemIdSource: dom.pageSignals?.itemIdSource,
    }).status).toBe('verified')
  })

  it('推荐区里的编号不能当作当前商品证据，仅有地址栏编号也不能认定通过', () => {
    const rec = extractCompetitorDom(parse(FIXTURE_SHARE_RECOMMEND_ONLY_ID, SHARE_HREF), '100000000001')
    expect(rec.blocked).toBe(false)
    expect(rec.goodsId).toBe(null)
    expect(rec.pageSignals?.itemIdSource).toBe(null)
    expect(evaluateGoodsIdentity({
      expectedGoodsId: '100000000001',
      observedGoodsId: rec.goodsId,
      itemIdSource: rec.pageSignals?.itemIdSource,
    }).status).toBe('unverified')

    const urlOnly = extractCompetitorDom(parse(FIXTURE_FULL), '100000000001')
    expect(urlOnly.blocked).toBe(false)
    expect(urlOnly.goodsId).toBe('100000000001')
    expect(urlOnly.pageSignals?.itemIdSource).toBe('location_query')
    expect(evaluateGoodsIdentity({
      expectedGoodsId: '100000000001',
      observedGoodsId: urlOnly.goodsId,
      itemIdSource: urlOnly.pageSignals?.itemIdSource,
    }).status).toBe('unverified')
  })

  it('页面详情证据与目标不一致时停止，不采当前页图片', () => {
    const result = extractCompetitorDom(parse(FIXTURE_SHARE_WRONG_OG, SHARE_HREF), '100000000001')
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe('wrong_item')
    expect(result.hero).toEqual([])
    expect(result.goodsId).toBe('1022650930715')
    expect(evaluateGoodsIdentity({
      expectedGoodsId: '100000000001',
      observedGoodsId: result.goodsId,
      itemIdSource: result.pageSignals?.itemIdSource,
    }).status).toBe('mismatch')
  })
})
