import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { captureDomRuntimeSource } from '../src/pdd/competitor/captureDom'

describe('扩展 DOM 解析包', () => {
  it('与 captureDomRuntimeSource 同步，且不含 cookie 读取或网络请求', () => {
    const bundle = readFileSync(join(process.cwd(), 'prototypes/chrome-page-capture/extract-bundle.js'), 'utf8')
    expect(bundle).toContain('__pddExtractCompetitorDom')
    expect(bundle).toContain('extractCompetitorDom')
    expect(bundle).toContain('detectBlock')
    expect(bundle).not.toMatch(/document\.cookie|localStorage|sessionStorage|fetch\(|XMLHttpRequest/)
    expect(bundle).not.toMatch(/^export /m)
    const source = captureDomRuntimeSource().replace(/^export\s+/gm, '')
    expect(bundle).toContain(source.slice(0, 80))
  })
})
