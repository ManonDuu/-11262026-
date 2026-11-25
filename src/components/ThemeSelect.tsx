import { usePageColorMode } from '../hooks/useColorMode'

/** Shared header and settings use the same independent UI preference. Native select is keyboard accessible. */
export default function ThemeSelect() {
  const [mode, setMode] = usePageColorMode()
  return <label className="inline-flex shrink-0 items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
    <span className="hidden lg:inline">页面颜色</span>
    <select aria-label="页面颜色" value={mode} onChange={(event) => setMode(event.target.value === 'dark' ? 'dark' : 'light')}
      className="min-h-8 rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800" >
      <option value="light">浅色</option><option value="dark">深色</option>
    </select>
  </label>
}
