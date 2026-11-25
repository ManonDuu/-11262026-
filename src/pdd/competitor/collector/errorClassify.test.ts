import { describe, expect, it } from 'vitest'
import { classifyCollectorError } from './errorClassify'

describe('classifyCollectorError', () => {
  it('把超时、窗口关闭、地址非法和网络错误分成不同类别，且不回传原始 URL', () => {
    const timeout = classifyCollectorError(Object.assign(new Error('page.goto: Timeout 45000ms exceeded.\nCall log:\n  - navigating to "https://mobile.yangkeduo.com/goods2.html?goods_id=100000000001&pxq_secret_key=TEST_SECRET_DO_NOT_STORE"'), { name: 'TimeoutError' }), 'navigate')
    expect(timeout.code).toBe('nav_timeout')
    expect(timeout.stage).toBe('navigate')
    expect(timeout.safeMessage).toMatch(/超时/)
    expect(JSON.stringify(timeout)).not.toMatch(/TEST_SECRET|yangkeduo|100000000001|https?:/)

    const closed = classifyCollectorError(new Error('Target page, context or browser has been closed'), 'navigate')
    expect(closed.code).toBe('target_closed')

    const destroyed = classifyCollectorError(new Error('Execution context was destroyed, most likely because of a navigation.'), 'navigate')
    expect(destroyed.code).toBe('context_destroyed')

    const invalid = classifyCollectorError(new Error('Cannot navigate to invalid URL'), 'navigate')
    expect(invalid.code).toBe('invalid_url')

    const net = classifyCollectorError(new Error('net::ERR_NAME_NOT_RESOLVED at https://mobile.yangkeduo.com/goods2.html?goods_id=1'), 'navigate')
    expect(net.code).toBe('net_error')
    expect(JSON.stringify(net)).not.toMatch(/yangkeduo|https?:/)

    const busy = classifyCollectorError(new Error('Browser context profile is already in use: ProcessSingleton / SingletonLock'), 'launch')
    expect(busy.code).toBe('profile_in_use')
    expect(busy.safeMessage).not.toMatch(/限制/)

    const unknown = classifyCollectorError(new Error('weird failure with https://evil.example/secret?pxq_secret_key=TEST_SECRET_DO_NOT_STORE'), 'navigate')
    expect(unknown.code).toBe('unknown')
    expect(JSON.stringify(unknown)).not.toMatch(/TEST_SECRET|evil\.example|https?:/)
    expect(unknown.safeMessage).toMatch(/不能说明是平台限制/)
  })
})
