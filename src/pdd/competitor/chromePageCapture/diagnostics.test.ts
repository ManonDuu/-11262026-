import { describe, expect, it } from 'vitest'
import {
  clipMessage,
  createCaptureId,
  evaluateGoodsIdentity,
  isDiagnosticOnlyStage,
  normalizeGoodsId,
  publicCaptureEvent,
  redactUrl,
  retainCaptureEvents,
  safeDiagnosticPath,
  sanitizeCaptureId,
  STAGE_TITLES,
  type CaptureEvent,
} from './diagnostics'

function event(partial: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    captureId: 'cap-aaaaaaaaaaaaaaaa',
    stage: 'parse_empty',
    title: '页面没有可采集图片',
    message: '没有在页面上看到主图、详情图或已选套餐图。',
    at: 1,
    path: '/goods2.html',
    pathKind: 'goods',
    observedGoodsId: null,
    expectedGoodsId: null,
    identityStatus: 'unverified',
    itemIdSource: null,
    identityReason: '工作台未设置目标商品编号，不能认定商品身份通过。',
    counts: { hero: 0, detail: 0, options: 0 },
    reportDelivery: 'local_only',
    ...partial,
  }
}

describe('采集诊断与商品身份', () => {
  it('未设置目标编号、仅有地址栏编号或缺少页面证据时都不能认定通过', () => {
    expect(evaluateGoodsIdentity({}).status).toBe('unverified')
    expect(evaluateGoodsIdentity({ expectedGoodsId: '100000000001' }).status).toBe('unverified')
    expect(evaluateGoodsIdentity({
      expectedGoodsId: '100000000001',
      observedGoodsId: '100000000001',
      itemIdSource: 'location_query',
    })).toMatchObject({ status: 'unverified' })
    expect(evaluateGoodsIdentity({
      expectedGoodsId: '100000000001',
      observedGoodsId: '100000000001',
      itemIdSource: 'og_url',
    }).status).toBe('verified')
    expect(evaluateGoodsIdentity({
      expectedGoodsId: '100000000001',
      observedGoodsId: '100000000001',
      itemIdSource: 'dom',
    }).status).toBe('verified')
  })

  it('页面证据与目标不一致时判定为不符', () => {
    expect(evaluateGoodsIdentity({
      expectedGoodsId: '100000000001',
      observedGoodsId: '1022650930715',
      itemIdSource: 'dom',
    }).status).toBe('mismatch')
  })

  it('采集编号、商品编号与 URL 查询都会被消毒，公开事件不含链接或密钥形态', () => {
    expect(normalizeGoodsId('100000000001')).toBe('100000000001')
    expect(normalizeGoodsId(' not-an-id ')).toBe(null)
    expect(sanitizeCaptureId('cap-abcdef1234567890')).toBe('cap-abcdef1234567890')
    expect(sanitizeCaptureId('cap/../../../etc')).toBe('')
    expect(createCaptureId(() => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBe('cap-0102030405060708')
    expect(redactUrl('https://mobile.yangkeduo.com/goods2.html?ps=secret-token&goods_id=100000000001')).toBe('mobile.yangkeduo.com/goods2.html')
    const published = publicCaptureEvent(event({
      message: '失败 https://mobile.yangkeduo.com/goods2.html?ps=leak token=abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    }))
    const text = JSON.stringify(published)
    expect(text).toContain('mobile.yangkeduo.com/goods2.html')
    expect(text).not.toContain('ps=')
    expect(text).not.toMatch(/[a-f0-9]{64}/)
    expect(clipMessage('x'.repeat(400)).length).toBe(300)
  })

  it('诊断记录有保留上限，同编号覆盖而不是无限追加', () => {
    const first = event({ captureId: 'cap-one', at: 1 })
    const updated = event({ captureId: 'cap-one', at: 2, stage: 'send_network_error', title: STAGE_TITLES.send_network_error })
    const other = event({ captureId: 'cap-two', at: 3 })
    const list = retainCaptureEvents(retainCaptureEvents([first], other, 2), updated, 2)
    expect(list).toHaveLength(2)
    expect(list[0]?.captureId).toBe('cap-one')
    expect(list[0]?.stage).toBe('send_network_error')
    expect(isDiagnosticOnlyStage('parse_blocked')).toBe(true)
    expect(isDiagnosticOnlyStage('success')).toBe(false)
  })

  it('诊断路径只保留商品页和登录页，个人页与查询参数不会出现在记录里', () => {
    expect(safeDiagnosticPath('/goods2.html?ps=secret')).toEqual({ path: '/goods2.html', pathKind: 'goods' })
    expect(safeDiagnosticPath('/login.html?from=%2Fgoods2.html')).toEqual({ path: '/login.html', pathKind: 'sensitive' })
    expect(safeDiagnosticPath('/personal.html?ticket=abc')).toEqual({ path: null, pathKind: 'sensitive' })
    expect(safeDiagnosticPath('/some/other')).toEqual({ path: null, pathKind: 'other' })
  })
})
