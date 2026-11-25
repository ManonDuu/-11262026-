import { useLayoutEffect, useSyncExternalStore } from 'react'
import { applyPageColorMode, getPageColorMode, setPageColorMode, subscribePageColorMode } from '../lib/colorMode'

/** Manual app-wide preference. Reused by App and the public header/settings selector. */
export function usePageColorMode() {
  const mode = useSyncExternalStore(subscribePageColorMode, getPageColorMode, () => 'light' as const)
  return [mode, setPageColorMode] as const
}
export function useColorMode() {
  const [mode] = usePageColorMode()
  useLayoutEffect(() => { applyPageColorMode(mode) }, [mode])
}

function subscribeDarkClass(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** 当前是否为深色，随手动颜色选择更新 */
export function useIsDarkMode() {
  return useSyncExternalStore(subscribeDarkClass, () => document.documentElement.classList.contains('dark'))
}
