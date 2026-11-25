import { useSyncExternalStore } from 'react'

export type WorkbenchView = 'pdd' | 'free' | 'competitor'

const KEY = 'pdd-workbench-view'
const listeners = new Set<() => void>()

function read(): WorkbenchView {
  try {
    const value = localStorage.getItem(KEY)
    if (value === 'free' || value === 'competitor' || value === 'pdd') return value
    return 'pdd'
  } catch {
    return 'pdd'
  }
}

export function isStructuredWorkbench(view: WorkbenchView): boolean {
  return view === 'pdd' || view === 'competitor'
}

export function getWorkbenchView(): WorkbenchView {
  return read()
}

export function setWorkbenchView(view: WorkbenchView) {
  try {
    localStorage.setItem(KEY, view)
  } catch {
    /* ignore quota */
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

export function useWorkbenchView(): [WorkbenchView, (view: WorkbenchView) => void] {
  const view = useSyncExternalStore(subscribe, read, () => 'pdd' as const)
  return [view, setWorkbenchView]
}
