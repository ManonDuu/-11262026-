import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { buildBookmarkletHref } from './captureBookmarklet'
import { captureDomRuntimeSource, extractCompetitorDom } from './captureDom'
import { FIXTURE_FULL } from './fixtures/captureDomFixtures'

describe('buildBookmarkletHref', () => {
  it('只允许指向本机工作台，并包含页面解析运行时', () => {
    const href = buildBookmarkletHref('http://127.0.0.1:5173')
    expect(href.startsWith('javascript:')).toBe(true)
    const source = decodeURIComponent(href.slice('javascript:'.length))
    expect(source).toContain('runCompetitorCapture')
    expect(source).toContain('extractCompetitorDom')
    expect(source).toContain('http://127.0.0.1:5173')
    expect(() => buildBookmarkletHref('https://example.com')).toThrow(/本机/)
  })

  it('运行时源码在合成文档上与 TypeScript 解析器结果一致', () => {
    const dom = new JSDOM(FIXTURE_FULL, { url: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001' })
    const expected = extractCompetitorDom(dom.window.document)
    const runtime = `${captureDomRuntimeSource()}; return extractCompetitorDom(document);`
    const extracted = new dom.window.Function('document', runtime)(dom.window.document)
    expect(extracted.hero.map((item: { sourceUrl: string }) => item.sourceUrl)).toEqual(expected.hero.map((item) => item.sourceUrl))
    expect(extracted.options.map((item: { optionName: string }) => item.optionName)).toEqual(expected.options.map((item) => item.optionName))
    expect(extracted.blocked).toBe(false)
  })
})
