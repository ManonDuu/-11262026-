import type { ColorMode } from '../types'

// Independent UI-only preference; never write the task/settings/draft stores.
export const COLOR_MODE_KEY = 'color-mode'
export type PageColorMode = 'light' | 'dark'
export function normalizePageColorMode(value: unknown): PageColorMode { return value === 'dark' ? 'dark' : 'light' }
export function readPageColorMode(): PageColorMode {
  try { return normalizePageColorMode(localStorage.getItem(COLOR_MODE_KEY)) } catch { return 'light' }
}
// Legacy 'system' is kept in the settings schema, but no longer overrides a manual UI choice.
export function resolveDarkMode(mode: ColorMode, _systemDark = false) { return mode === 'dark' }
let currentMode: PageColorMode = readPageColorMode()
const listeners = new Set<() => void>()
export const getPageColorMode = () => currentMode
export function applyPageColorMode(mode: PageColorMode) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.style.colorScheme = mode
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#09090b' : '#fafafa')
}
export function setPageColorMode(mode: PageColorMode) {
  currentMode = normalizePageColorMode(mode)
  try { localStorage.setItem(COLOR_MODE_KEY, currentMode) } catch { /* keep working in memory */ }
  applyPageColorMode(currentMode)
  listeners.forEach((listener) => listener())
}
export function subscribePageColorMode(listener: () => void) {
  listeners.add(listener)
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== COLOR_MODE_KEY && event.key !== null) return
    currentMode = normalizePageColorMode(event.newValue)
    applyPageColorMode(currentMode)
    listeners.forEach((notify) => notify())
  }
  window.addEventListener('storage', storageChanged)
  return () => { listeners.delete(listener); window.removeEventListener('storage', storageChanged) }
}
