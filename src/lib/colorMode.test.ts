import { describe, expect, it } from 'vitest'
import type { ColorMode } from '../types'
import { COLOR_MODE_KEY, resolveDarkMode } from './colorMode'
import SCRIPT from '../../public/color-mode.js?raw'

// 在模拟的浏览器环境中运行 public/color-mode.js，返回它是否加上了 dark 类
function runEarlyScript(stored: string | null, systemDark: boolean) {
  const classes = new Set<string>()
  const localStorage = { getItem: (key: string) => (key === COLOR_MODE_KEY ? stored : null) }
  const matchMedia = (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark })
  const document = {
    documentElement: {
      classList: { toggle: (name: string, force: boolean) => (force ? classes.add(name) : classes.delete(name)) },
    },
  }
  new Function('localStorage', 'matchMedia', 'document', SCRIPT)(localStorage, matchMedia, document)
  return classes.has('dark')
}

describe('color mode', () => {
  it.each<[ColorMode, boolean]>([
    ['system', false],
    ['system', true],
    ['light', false],
    ['light', true],
    ['dark', false],
    ['dark', true],
  ])('early script matches the app for %s mode (system dark: %s)', (mode, systemDark) => {
    expect(runEarlyScript(mode, systemDark)).toBe(resolveDarkMode(mode, systemDark))
  })

  it('early script defaults to light without a cached mode, independent of OS', () => {
    expect(runEarlyScript(null, true)).toBe(false)
    expect(runEarlyScript(null, false)).toBe(false)
  })
  it.each(['bogus', '', 'system'])('invalid/legacy automatic mode %s falls back to light', (stored) => {
    expect(runEarlyScript(stored, true)).toBe(false)
  })
  it('early bootstrap handles blocked storage without touching other keys', () => {
    let dark = true
    const storage = {getItem: () => { throw new Error('blocked') }}
    const document = {documentElement: {classList:{toggle: (_name: string, value: boolean) => {dark=value}}}}
    expect(() => new Function('localStorage','matchMedia','document',SCRIPT)(storage,()=>{throw new Error('must not use OS')},document)).not.toThrow()
    expect(dark).toBe(false)
  })

})
