// Apply UI-only manual preference before first paint; default light, never OS-driven.
// Keep key/normalization aligned with src/lib/colorMode.ts. No settings/history reads.
(() => {
  let mode = 'light'
  try { mode = localStorage.getItem('color-mode') === 'dark' ? 'dark' : 'light' } catch {}
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  if (root.style) root.style.colorScheme = mode
  document.querySelector?.('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#09090b' : '#fafafa')
})()
