import { describe, expect, it } from 'vitest'
import { createCollectorJob, publicJob, requestCancel, requestContinue, updateJob, waitForContinue } from './jobState'

describe('collector job state', () => {
  it('对外状态不含图片字节，继续指令只在等待登录时生效', () => {
    const job = createCollectorJob({ goodsId: '100000000001', canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001' })
    job.imageBytes.demo = new Uint8Array([1, 2, 3])
    expect(publicJob(job)).not.toHaveProperty('imageBytes')
    expect(requestContinue(job).ok).toBe(false)
    updateJob(job, { phase: 'awaiting_login', canContinue: true, message: '请登录' })
    const pending = waitForContinue(job, 1000)
    const result = requestContinue(job)
    expect(result.ok).toBe(true)
    return expect(pending).resolves.toBe('continued')
  })

  it('取消会结束等待，且不把主图伪造成已完成采集', () => {
    const job = createCollectorJob({ goodsId: '100000000001', canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001' })
    updateJob(job, { phase: 'awaiting_login', canContinue: true })
    const pending = waitForContinue(job, 1000)
    requestCancel(job)
    expect(job.phase).toBe('cancelled')
    expect(job.images).toEqual([])
    return expect(pending).resolves.toBe('cancelled')
  })
})


describe('public job 脱敏', () => {
  it('公开任务不含内存导航地址和跟踪参数', () => {
    const job = createCollectorJob({
      goodsId: '1022650930715',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=1022650930715',
      navigationUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=1022650930715&pxq_secret_key=TEST_SECRET_DO_NOT_STORE',
    })
    const published = publicJob(job)
    expect(published).not.toHaveProperty('navigationUrl')
    expect(JSON.stringify(published)).not.toMatch(/TEST_SECRET_DO_NOT_STORE|pxq_secret_key/)
    expect(published.canonicalUrl).toBe('https://mobile.yangkeduo.com/goods2.html?goods_id=1022650930715')
  })

  it('打开目标页后可回填商品编号，公开任务不含恢复次数', () => {
    const job = createCollectorJob({
      goodsId: '',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html',
    })
    updateJob(job, { goodsId: '100000000001', canonicalUrl: 'https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001' })
    job.targetRestoresUsed = 1
    expect(job.goodsId).toBe('100000000001')
    expect(publicJob(job).goodsId).toBe('100000000001')
    expect(publicJob(job)).not.toHaveProperty('targetRestoresUsed')
    expect(publicJob(job)).not.toHaveProperty('navigationUrl')
    expect(publicJob(job)).not.toHaveProperty('restoreUrl')
  })
})
