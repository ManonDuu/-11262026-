import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { evaluateGoodsIdentity, STAGE_TITLES } from '../src/pdd/competitor/chromePageCapture/diagnostics'
import vm from 'vm'

describe('扩展本地诊断脚本', () => {
  const source = readFileSync(join(process.cwd(), 'prototypes/chrome-page-capture/diagnostics.js'), 'utf8')
  const scope: { self?: unknown; URL: typeof URL; __pddCaptureDiagnostics?: unknown } = { URL }
  scope.self = scope
  vm.runInNewContext(source, scope)
  const d = scope.__pddCaptureDiagnostics as {
    evaluateGoodsIdentity: typeof evaluateGoodsIdentity
    clipMessage: (value: string) => string
    redactUrl: (value: string) => string
    STAGES: Record<string, { title: string }>
    formatLocalStatus: (event: { captureId: string; stage: string; message: string }) => string
  }

  it('与工作台身份判定和阶段名称保持一致，并且会脱敏查询参数和长十六进制', () => {
    expect(Object.keys(d.STAGES).sort()).toEqual(Object.keys(STAGE_TITLES).sort())
    for (const [stage, title] of Object.entries(STAGE_TITLES)) {
      expect(d.STAGES[stage]?.title).toBe(title)
    }
    const cases = [
      {},
      { expectedGoodsId: '100000000001' },
      { expectedGoodsId: '100000000001', observedGoodsId: '100000000001', itemIdSource: 'location_query' as const },
      { expectedGoodsId: '100000000001', observedGoodsId: '100000000001', itemIdSource: 'og_url' as const },
      { expectedGoodsId: '100000000001', observedGoodsId: '1022650930715', itemIdSource: 'dom' as const },
    ]
    for (const input of cases) {
      expect(d.evaluateGoodsIdentity(input)).toEqual(evaluateGoodsIdentity(input))
    }
    expect(d.redactUrl('https://mobile.yangkeduo.com/goods2.html?ps=secret-token')).toBe('mobile.yangkeduo.com/goods2.html')
    const text = d.clipMessage('失败 https://mobile.yangkeduo.com/goods2.html?ps=leak abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    expect(text).not.toContain('ps=')
    expect(text).not.toMatch(/[a-f0-9]{64}/)
    const status = d.formatLocalStatus({ captureId: 'cap-aaaaaaaaaaaaaaaa', stage: 'send_network_error', message: '未能发送到本机工作台。' })
    expect(status).toContain('cap-aaaaaaaaaaaaaaaa')
    expect(status).toContain('send_network_error')
    expect(source).not.toMatch(/document\.cookie|localStorage|sessionStorage/)
  })
})
