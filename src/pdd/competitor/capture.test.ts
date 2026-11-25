import { describe, expect, it } from 'vitest'
import { beginCaptureSession, describeAutomatedCaptureAvailability, getActiveCaptureSession, markCaptureSessionUsed, resetCaptureSession } from './capture'
import { isSessionActive } from './captureProtocol'

describe('capture session', () => {
  it('会话使用一次后失效，且不会保存跟踪参数', () => {
    resetCaptureSession()
    const session = beginCaptureSession('100000000001', 1000)
    expect(session.goodsId).toBe('100000000001')
    expect(getActiveCaptureSession()?.sessionId).toBe(session.sessionId)
    expect(isSessionActive(session, '100000000001', session.sessionId, 1100)).toBe(true)
    markCaptureSessionUsed()
    expect(isSessionActive(getActiveCaptureSession(), '100000000001', session.sessionId, 1100)).toBe(false)
    resetCaptureSession()
  })
})

describe('automated capture availability', () => {
  it('说明自动采集已接入，且不能把离线测试当成真实抓齐', () => {
    const result = describeAutomatedCaptureAvailability()
    expect(result.available).toBe(true)
    expect(result.message).toMatch(/采集图片/)
    expect(result.message).toMatch(/自行登录/)
    expect(result.message).toMatch(/取全|抓齐/)
  })
})
