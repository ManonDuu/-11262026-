import { describe, expect, it } from 'vitest'
import { extractCompetitorDom } from './captureDom'
import {
  CAPTURE_HELLO,
  CAPTURE_PROTOCOL_VERSION,
  CAPTURE_RESULT,
  classifyLongImage,
  createCaptureSession,
  validateIncomingCaptureEvent,
} from './captureProtocol'
import { FIXTURE_FULL } from './fixtures/captureDomFixtures'

function pngBlob(): Blob {
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
  return new Blob([bytes], { type: 'image/png' })
}

describe('captureProtocol', () => {
  it('拒绝错误来源和错误窗口', () => {
    const session = createCaptureSession('100000000001')
    const source = { id: 'goods-window' }
    expect(validateIncomingCaptureEvent(
      { origin: 'https://evil.example', source, data: { version: 1, type: CAPTURE_HELLO, goodsId: '100000000001' } },
      { expectedSource: source, session },
    ).ok).toBe(false)
    expect(validateIncomingCaptureEvent(
      { origin: 'https://mobile.yangkeduo.com', source: { id: 'other' }, data: { version: 1, type: CAPTURE_HELLO, goodsId: '100000000001' } },
      { expectedSource: source, session },
    ).ok).toBe(false)
  })

  it('商品编号或会话不匹配、过期、重复使用时拒绝回传', () => {
    const session = createCaptureSession('100000000001', 1_000)
    const source = { id: 'goods-window' }
    const body = {
      version: CAPTURE_PROTOCOL_VERSION,
      type: CAPTURE_RESULT,
      sessionId: session.sessionId,
      goodsId: '100000000001',
      images: [],
      options: [],
    }
    expect(validateIncomingCaptureEvent(
      { origin: 'https://mobile.yangkeduo.com', source, data: { ...body, goodsId: '111111111111' } },
      { expectedSource: source, session, now: 1_100 },
    ).ok).toBe(false)
    expect(validateIncomingCaptureEvent(
      { origin: 'https://mobile.yangkeduo.com', source, data: body },
      { expectedSource: source, session, now: 1_000 + 31 * 60 * 1000 },
    ).ok).toBe(false)
    const used = { ...session, used: true }
    expect(validateIncomingCaptureEvent(
      { origin: 'https://mobile.yangkeduo.com', source, data: body },
      { expectedSource: source, session: used, now: 1_100 },
    ).ok).toBe(false)
  })

  it('拒绝非法格式、超限文件和悬空套餐引用', () => {
    const session = createCaptureSession('100000000001')
    const source = { id: 'goods-window' }
    const base = {
      version: CAPTURE_PROTOCOL_VERSION,
      type: CAPTURE_RESULT,
      sessionId: session.sessionId,
      goodsId: '100000000001',
    }
    expect(validateIncomingCaptureEvent(
      { origin: 'https://mobile.yangkeduo.com', source, data: { ...base, images: [{ id: 'x', category: 'hero', bytesStatus: 'ok', mimeType: 'application/pdf', byteLength: 10, sourceKey: 'a' }] } },
      { expectedSource: source, session },
    ).ok).toBe(false)
    expect(validateIncomingCaptureEvent(
      { origin: 'https://mobile.yangkeduo.com', source, data: { ...base, images: [{ id: 'x', category: 'hero', bytesStatus: 'ok', mimeType: 'image/png', byteLength: 20 * 1024 * 1024, sourceKey: 'a' }] } },
      { expectedSource: source, session },
    ).ok).toBe(false)
    expect(validateIncomingCaptureEvent(
      { origin: 'https://mobile.yangkeduo.com', source, data: { ...base, images: [], options: [{ optionName: '单独一只挖掘机', imageId: 'missing' }] } },
      { expectedSource: source, session },
    ).ok).toBe(false)
  })

  it('合法回传通过，并且不会把主图引用成选项图', () => {
    const session = createCaptureSession('100000000001')
    const source = { id: 'goods-window' }
    const blob = pngBlob()
    const accepted = validateIncomingCaptureEvent(
      {
        origin: 'https://mobile.yangkeduo.com',
        source,
        data: {
          version: CAPTURE_PROTOCOL_VERSION,
          type: CAPTURE_RESULT,
          sessionId: session.sessionId,
          goodsId: '100000000001',
          images: [{
            id: 'option-1',
            category: 'option',
            order: 1,
            fileName: 'opt.png',
            mimeType: 'image/png',
            byteLength: blob.size,
            sourceKey: 'https://img.example.test/opt-a.jpg?pxq_secret_key=TEST_SECRET_DO_NOT_STORE',
            bytesStatus: 'ok',
            longImage: 'not_long',
            blob,
          }],
          options: [{ optionName: '单独一只挖掘机', imageId: 'option-1' }],
        },
      },
      { expectedSource: source, session },
    )
    expect(accepted.ok).toBe(true)
    if (accepted.ok) {
      expect(accepted.payload.images?.[0].sourceKey).not.toContain('pxq_secret_key')
      expect(accepted.payload.images?.[0].blob).toBe(blob)
    }

    const rejected = validateIncomingCaptureEvent(
      {
        origin: 'https://mobile.yangkeduo.com',
        source,
        data: {
          version: CAPTURE_PROTOCOL_VERSION,
          type: CAPTURE_RESULT,
          sessionId: session.sessionId,
          goodsId: '100000000001',
          images: [{ id: 'hero-1', category: 'hero', bytesStatus: 'unavailable', mimeType: '', byteLength: 0, sourceKey: 'h' }],
          options: [{ optionName: '单独一只挖掘机', imageId: 'hero-1' }],
        },
      },
      { expectedSource: source, session },
    )
    expect(rejected.ok).toBe(false)
  })

  it('超长图在字节完整时标为完整保留，否则标为未能取得完整长图', () => {
    expect(classifyLongImage({ width: 800, height: 4000, bytesStatus: 'ok', likelyLong: true })).toBe('kept_intact')
    expect(classifyLongImage({ width: 800, height: 4000, bytesStatus: 'unavailable', likelyLong: true })).toBe('incomplete')
    expect(classifyLongImage({ width: 800, height: 800, bytesStatus: 'ok' })).toBe('not_long')
  })

  it('握手消息只需合法来源和商品编号', () => {
    const source = { id: 'goods-window' }
    const result = validateIncomingCaptureEvent(
      { origin: 'https://mobile.yangkeduo.com', source, data: { version: 1, type: CAPTURE_HELLO, goodsId: '100000000001' } },
      { expectedSource: source, session: null },
    )
    expect(result.ok).toBe(true)
  })
})

describe('extractCompetitorDom fixture still isolated from protocol', () => {
  it('合成页面不是线上结果', () => {
    expect(FIXTURE_FULL).toContain('img.example.test')
    expect(extractCompetitorDom).toBeTypeOf('function')
  })
})
