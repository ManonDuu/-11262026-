import { describe, expect, it } from 'vitest'
import { armOpenPairing, checkCsrfToken, createChromePageCaptureStore, issueCsrfToken, issuePairCode, publicImportSummary, redeemOpenArm, redeemPairCode, revokePairing, verifySession } from './chromePageCapturePairing'
import { isAllowedImageUrl, sanitizeIncomingImport } from '../src/pdd/competitor/chromePageCapture/payload'
import { isChromeExtensionOrigin, isExactWorkbenchHost, parseChromeExtensionOrigin } from '../src/pdd/competitor/chromePageCapture/access'

const EXT = 'abcdefghijklmnopabcdefghijklmnop'

describe('扩展配对与载荷', () => {
  it('配对码两分钟内只能兑换一次，令牌绑定扩展编号', () => {
    const store = createChromePageCaptureStore()
    let now = 1_000_000
    const code = issuePairCode(store, EXT, () => now)
    const once = redeemPairCode(store, { code, extensionId: EXT }, () => now)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(redeemPairCode(store, { code, extensionId: EXT }, () => now).ok).toBe(false)
    expect(verifySession(store, { token: once.token, extensionId: EXT }, () => now).ok).toBe(true)
    expect(verifySession(store, { token: once.token, extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, () => now).ok).toBe(false)
    now += 31 * 60 * 1000
    expect(verifySession(store, { token: once.token, extensionId: EXT }, () => now).ok).toBe(false)
  })

  it('过期或撤销后不能再用', () => {
    const store = createChromePageCaptureStore()
    let now = 1_000_000
    const code = issuePairCode(store, EXT, () => now)
    now += 3 * 60 * 1000
    expect(redeemPairCode(store, { code, extensionId: EXT }, () => now).ok).toBe(false)
    now = 1_000_000
    const fresh = issuePairCode(store, EXT, () => now)
    revokePairing(store)
    expect(redeemPairCode(store, { code: fresh, extensionId: EXT }, () => now).ok).toBe(false)
  })

  it('未开始与过期返回不同说明，且不把两者写成同一句话', () => {
    const store = createChromePageCaptureStore()
    let now = 1_000_000
    const notStarted = redeemOpenArm(store, { extensionId: EXT }, () => now)
    expect(notStarted.ok).toBe(false)
    if (notStarted.ok) return
    expect(notStarted.reason).toMatch(/尚未开始配对/)
    expect(notStarted.reason).not.toMatch(/已过期/)
    armOpenPairing(store, () => now)
    now += 16 * 60 * 1000
    const expired = redeemOpenArm(store, { extensionId: EXT }, () => now)
    expect(expired.ok).toBe(false)
    if (expired.ok) return
    expect(expired.reason).toMatch(/已过期/)
    expect(expired.reason).not.toMatch(/尚未开始配对/)
  })

  it('工作台 CSRF 校验有效，扩展 Origin 只接受 32 位 a-p 编号', () => {
    const store = createChromePageCaptureStore()
    const csrf = issueCsrfToken(store, () => 10)
    expect(checkCsrfToken(store, csrf, () => 10)).toBe(true)
    expect(checkCsrfToken(store, 'nope', () => 10)).toBe(false)
    expect(parseChromeExtensionOrigin(`chrome-extension://${EXT}`)).toBe(EXT)
    expect(isChromeExtensionOrigin('https://mobile.yangkeduo.com')).toBe(false)
    expect(isChromeExtensionOrigin('http://127.0.0.1:5173')).toBe(false)
    expect(isExactWorkbenchHost('127.0.0.1:5173')).toBe(true)
    expect(isExactWorkbenchHost('localhost:5173')).toBe(false)
  })

  it('开始配对后，两分钟内只能由一个扩展完成一次，过期或撤销后无效', () => {
    const store = createChromePageCaptureStore()
    let now = 1_000_000
    armOpenPairing(store, () => now)
    const once = redeemOpenArm(store, { extensionId: EXT }, () => now)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    expect(redeemOpenArm(store, { extensionId: EXT }, () => now).ok).toBe(false)
    expect(verifySession(store, { token: once.token, extensionId: EXT }, () => now).ok).toBe(true)
    now = 1_000_000
    armOpenPairing(store, () => now)
    now += 16 * 60 * 1000
    expect(redeemOpenArm(store, { extensionId: EXT }, () => now).ok).toBe(false)
    now = 1_000_000
    armOpenPairing(store, () => now)
    revokePairing(store)
    expect(redeemOpenArm(store, { extensionId: EXT }, () => now).ok).toBe(false)
  })

  it('只接受允许的商品 CDN 图片链接，拒绝本机地址和其他域名', () => {
    expect(isAllowedImageUrl('https://img.pddpic.com/a.jpg')).toBe(true)
    expect(isAllowedImageUrl('https://img.example.com/a.jpg')).toBe(false)
    expect(isAllowedImageUrl('http://img.pddpic.com/a.jpg')).toBe(false)
    expect(isAllowedImageUrl('http://127.0.0.1:5173/secret.png')).toBe(false)
    expect(isAllowedImageUrl('javascript:alert(1)')).toBe(false)
    const cleaned = sanitizeIncomingImport({
      hero: [{ sourceUrl: 'https://img.pddpic.com/hero.jpg', width: 800, height: 800, alt: '主图' }],
      detail: [{ sourceUrl: 'http://127.0.0.1/x.png' }],
      options: [{ optionName: '套餐A', sourceUrl: 'https://img.pddpic.com/opt.jpg' }],
      optionsInspected: true,
      notes: ['ok'],
      cookie: 'steal',
    }, '/goods2.html', 1)
    expect(cleaned.hero).toHaveLength(1)
    expect(cleaned.detail).toHaveLength(0)
    expect(cleaned.optionNames).toEqual(['套餐A'])
    expect(JSON.stringify(cleaned)).not.toMatch(/cookie|steal/)
    const published = publicImportSummary({
      ...cleaned,
      folder: '2026-11-23',
      files: [{ kind: 'hero', fileName: 'hero-001.jpg', bytesStatus: 'ok', byteLength: 12 }],
      heroSaved: 1,
      detailSaved: 0,
      optionSaved: 1,
      bytesSaved: true,
      acceptedAsComplete: false,
      message: '部分文件已保存',
    })
    expect(JSON.stringify(published)).not.toMatch(/pddpic\.com|sourceUrl|https:\/\//)
  })
})
