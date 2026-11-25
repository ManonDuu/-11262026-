import { existsSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import type { CollectorRuntimeInfo } from '../src/pdd/competitor/collector/types'

function readPlaywrightVersion(): string {
  try {
    const req = createRequire(import.meta.url)
    const pkg = JSON.parse(readFileSync(req.resolve('playwright/package.json'), 'utf-8')) as { version?: string }
    return pkg.version || ''
  } catch {
    return ''
  }
}

export async function getCollectorRuntimeInfo(): Promise<CollectorRuntimeInfo> {
  try {
    const playwright = await import('playwright')
    const executable = playwright.chromium.executablePath()
    const ready = Boolean(executable && existsSync(executable))
    return {
      ready,
      playwrightVersion: readPlaywrightVersion(),
      chromiumRevision: ready ? 'chromium' : '',
      message: ready
        ? '本机采集浏览器已就绪。点击「开始采集」会打开同一专用窗口；若登录仍有效将直接采集，只有需要登录或验证时才要在窗口中操作，完成后会自动继续。'
        : '已安装 Playwright，但还没有找到配套 Chromium。请在项目目录执行 npx playwright install chromium。',
    }
  } catch {
    return {
      ready: false,
      playwrightVersion: '',
      chromiumRevision: '',
      message: '尚未安装 Playwright。请先在项目中安装后再启动采集。',
    }
  }
}

export function isLoopbackAddress(address?: string | null): boolean {
  if (!address) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export function isAllowedWorkbenchOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}
