import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../lib/apiProfiles'
import { getSharedApiConnectionStatus } from './sharedModels'

describe('getSharedApiConnectionStatus', () => {
  it('在已填写本机反代时报告已配置，且返回值不含密钥字段', () => {
    const status = getSharedApiConnectionStatus({
      ...DEFAULT_SETTINGS,
      baseUrl: 'http://127.0.0.1:62037/v1',
      apiKey: 'unit-test-key-not-a-real-secret',
    })
    expect(status.configured).toBe(true)
    expect(status.hasBaseUrl).toBe(true)
    expect(status.hasKey).toBe(true)
    expect(status.baseUrlHost).toBe('127.0.0.1:62037')
    expect(JSON.stringify(status)).not.toContain('unit-test-key')
    expect(status).not.toHaveProperty('apiKey')
    expect(status).not.toHaveProperty('baseUrl')
  })

  it('缺少地址或密钥时不视为已配置', () => {
    expect(getSharedApiConnectionStatus({ ...DEFAULT_SETTINGS, baseUrl: '', apiKey: '' }).configured).toBe(false)
    expect(getSharedApiConnectionStatus({ ...DEFAULT_SETTINGS, baseUrl: 'http://127.0.0.1:62037/v1', apiKey: '' }).hasKey).toBe(false)
  })
})
