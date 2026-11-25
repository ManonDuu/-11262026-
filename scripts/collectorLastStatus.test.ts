import { describe, expect, it } from 'vitest'
import { formatDiagnosticText, toLastStatus } from './collectorLastStatus'
import { createCollectorJob, publicJob, updateJob } from '../src/pdd/competitor/collector/jobState'

describe('collector last status diagnostics', () => {
  it('诊断文本包含脱敏现场信号，不含完整链接或密钥', () => {
    const job = createCollectorJob({
      goodsId: '100000000001',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001',
      navigationUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001&pxq_secret_key=TEST_SECRET_DO_NOT_STORE',
    })
    updateJob(job, {
      phase: 'target_unavailable',
      message: '目标商品不可访问。页面显示售罄、下架或不存在，并可能出现相似推荐。不会采集推荐商品图片。',
      pageSignals: {
        rule: 'sold_out_similar',
        urlPath: '/goods2.html',
        itemIdMatch: true,
        elapsedMs: 16267,
      },
    })
    const status = toLastStatus(publicJob(job))
    const text = formatDiagnosticText(status, { playwrightVersion: '1.65.1', chromiumRevision: 'chromium' })
    expect(status.pageSignals).toEqual({
      rule: 'sold_out_similar',
      urlPath: '/goods2.html',
      itemIdMatch: true,
      elapsedMs: 16267,
    })
    expect(text).toMatch(/命中规则：sold_out_similar/)
    expect(text).toMatch(/页面路径：\/goods2\.html/)
    expect(text).toMatch(/商品编号核对：一致/)
    expect(text).toMatch(/已运行：16267 毫秒/)
    expect(text).not.toMatch(/TEST_SECRET_DO_NOT_STORE|pxq_secret_key|cookie=/i)
    expect(JSON.stringify(status)).not.toMatch(/TEST_SECRET_DO_NOT_STORE|pxq_secret_key|navigationUrl/)
  })

  it('诊断含入口类型，不含登录包装或跟踪参数', () => {
    const job = createCollectorJob({
      goodsId: '100000000001',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001',
      navigationUrl: 'https://mobile.yangkeduo.com/login.html?from=https%3A%2F%2Fmobile.yangkeduo.com%2Fgoods2.html%3Fgoods_id%3D100000000001%26pxq_secret_key%3DTEST_SECRET_DO_NOT_STORE',
      entryKind: 'raw_login_wrapper',
    })
    const status = toLastStatus(publicJob(job))
    const text = formatDiagnosticText(status)
    expect(status.entryKind).toBe('raw_login_wrapper')
    expect(text).toMatch(/入口类型：raw_login_wrapper/)
    expect(text).not.toMatch(/TEST_SECRET_DO_NOT_STORE|pxq_secret_key|login\.html\?from=/i)
    expect(JSON.stringify(status)).not.toMatch(/TEST_SECRET_DO_NOT_STORE|pxq_secret_key|navigationUrl|login\.html\?from=/)
  })
})
