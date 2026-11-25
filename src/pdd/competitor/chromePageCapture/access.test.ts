import { describe, expect, it } from 'vitest'
import { canReadWorkbenchPairingGet, isExactWorkbenchOrigin } from './access'

const HOST = '127.0.0.1:5173'
const ORIGIN = 'http://127.0.0.1:5173'

describe('工作台同源 GET 信任', () => {
  it('有精确 Origin 时允许读取', () => {
    expect(canReadWorkbenchPairingGet({ expectedHost: HOST, host: HOST, origin: ORIGIN }).ok).toBe(true)
  })

  it('真实浏览器同源 GET 常不带 Origin，可凭 Sec-Fetch-Site: same-origin 允许', () => {
    const decision = canReadWorkbenchPairingGet({
      expectedHost: HOST,
      host: HOST,
      secFetchSite: 'same-origin',
      referer: `${ORIGIN}/__pdd-extension/pair`,
    })
    expect(decision).toEqual({ ok: true, via: 'sec-fetch-site' })
  })

  it('没有 Origin 时，若只有精确 Referer 也可以读取', () => {
    const decision = canReadWorkbenchPairingGet({
      expectedHost: HOST,
      host: HOST,
      referer: `${ORIGIN}/__pdd-extension/pair`,
    })
    expect(decision).toEqual({ ok: true, via: 'referer' })
  })

  it('跨站、错误 Host、localhost Origin、缺信号的 GET 都拒绝', () => {
    expect(canReadWorkbenchPairingGet({
      expectedHost: HOST,
      host: HOST,
      origin: 'https://mobile.yangkeduo.com',
    }).ok).toBe(false)
    expect(canReadWorkbenchPairingGet({
      expectedHost: HOST,
      host: HOST,
      secFetchSite: 'cross-site',
      referer: 'https://example.com/',
    }).ok).toBe(false)
    expect(canReadWorkbenchPairingGet({
      expectedHost: HOST,
      host: HOST,
      origin: 'http://localhost:5173',
    }).ok).toBe(false)
    expect(canReadWorkbenchPairingGet({
      expectedHost: HOST,
      host: HOST,
    }).ok).toBe(false)
    expect(canReadWorkbenchPairingGet({
      expectedHost: HOST,
      host: 'example.com',
      origin: ORIGIN,
    }).ok).toBe(false)
    expect(canReadWorkbenchPairingGet({
      expectedHost: HOST,
      host: HOST,
      secFetchSite: 'same-origin',
      referer: 'http://127.0.0.1:9999/__pdd-extension/pair',
    }).ok).toBe(false)
  })

  it('变更请求仍必须是精确工作台 Origin，不能只靠缺 Origin', () => {
    expect(isExactWorkbenchOrigin(undefined, HOST)).toBe(false)
    expect(isExactWorkbenchOrigin('http://localhost:5173', HOST)).toBe(false)
    expect(isExactWorkbenchOrigin(ORIGIN, HOST)).toBe(true)
  })
})
