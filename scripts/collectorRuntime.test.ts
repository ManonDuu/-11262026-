// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getCollectorRuntimeInfo } from './collectorRuntime'

describe('collector runtime install check', () => {
  it('检查已安装的 Playwright 和 Chromium，但不打开采集窗口', async () => {
    const info = await getCollectorRuntimeInfo()
    expect(info.ready).toBe(true)
    expect(info.playwrightVersion).toMatch(/^\d+\.\d+/)
    expect(info.message).toMatch(/采集浏览器已就绪/)
  })
})
