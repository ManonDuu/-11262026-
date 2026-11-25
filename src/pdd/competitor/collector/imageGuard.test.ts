import { describe, expect, it } from 'vitest'
import { isAllowedImageHost, isDisallowedIp, parseImageUrl, sanitizeImageLogUrl } from './imageGuard'

describe('imageGuard', () => {
  it('允许常见拼多多商品图域名，拒绝任意站点和本机地址', () => {
    expect(isAllowedImageHost('img.yangkeduo.com')).toBe(true)
    expect(isAllowedImageHost('t00img.yangkeduo.com')).toBe(true)
    expect(isAllowedImageHost('commimg.pddpic.com')).toBe(true)
    expect(isAllowedImageHost('yangkeduo.com')).toBe(true)
    expect(isAllowedImageHost('evil.com')).toBe(false)
    expect(isAllowedImageHost('yangkeduo.com.evil.com')).toBe(false)
    expect(isAllowedImageHost('127.0.0.1')).toBe(false)
    expect(isAllowedImageHost('localhost')).toBe(false)
  })

  it('拦截内网 IP，避免把下载当成任意代理', () => {
    expect(isDisallowedIp('127.0.0.1')).toBe(true)
    expect(isDisallowedIp('10.0.0.2')).toBe(true)
    expect(isDisallowedIp('192.168.1.8')).toBe(true)
    expect(isDisallowedIp('169.254.1.1')).toBe(true)
    expect(isDisallowedIp('::1')).toBe(true)
    expect(isDisallowedIp('8.8.8.8')).toBe(false)
  })

  it('只接受 https 商品图地址，并在日志中去掉查询参数', () => {
    expect(parseImageUrl('http://img.yangkeduo.com/a.jpg').ok).toBe(false)
    expect(parseImageUrl('https://img.yangkeduo.com/a.jpg?token=secret-token').ok).toBe(true)
    expect(sanitizeImageLogUrl('https://img.yangkeduo.com/a.jpg?pxq_secret_key=TEST_SECRET_DO_NOT_STORE')).toBe('https://img.yangkeduo.com/a.jpg')
    expect(sanitizeImageLogUrl('https://evil.com/a.jpg')).toBe('[rejected-image-url]')
    expect(parseImageUrl('file:///etc/passwd').ok).toBe(false)
  })
})

import { isAllowedWorkbenchOrigin, isLoopbackAddress } from './accessGuard'

describe('collector access guard', () => {
  it('只接受本机回环访问和工作台来源', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('8.8.8.8')).toBe(false)
    expect(isAllowedWorkbenchOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isAllowedWorkbenchOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedWorkbenchOrigin('https://example.com')).toBe(false)
  })
})
