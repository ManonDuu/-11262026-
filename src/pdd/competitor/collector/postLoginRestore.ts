import type { CapturePageDecision } from './pageStatus'

export const MAX_TARGET_RESTORES = 1
export const HOME_SETTLE_MS = 1000
export const RESTORE_NAV_TIMEOUT_MS = 15000

export type PostLoginAction =
  | 'wait_login'
  | 'wait_captcha'
  | 'proceed'
  | 'restore_target'
  | 'wait_home_settle'
  | 'stop_restore_exhausted'
  | 'stop_terminal'
  | 'wait_loading'
  | 'abort_cancelled'

export function isHomePath(pathname: string): boolean {
  const path = String(pathname || '')
  return /\/(?:index|home)\.html?$/i.test(path) || path === '/'
}

export function decidePostLoginNavigation(input: {
  decision: CapturePageDecision
  restoresUsed: number
  homeStable: boolean
  cancelRequested: boolean
  maxRestores?: number
}): PostLoginAction {
  if (input.cancelRequested) return 'abort_cancelled'
  if (input.decision === 'proceed') return 'proceed'
  if (input.decision === 'wait_login') return 'wait_login'
  if (input.decision === 'wait_captcha') return 'wait_captcha'
  if (input.decision === 'post_login_home') {
    const max = input.maxRestores ?? MAX_TARGET_RESTORES
    if (input.restoresUsed >= max) return 'stop_restore_exhausted'
    if (!input.homeStable) return 'wait_home_settle'
    return 'restore_target'
  }
  if (input.decision === 'unavailable' || input.decision === 'wrong_item' || input.decision === 'platform') {
    return 'stop_terminal'
  }
  return 'wait_loading'
}

export type ObservedPathKind = 'goods' | 'home' | 'login' | 'other'

export function pathKind(pathname: string): ObservedPathKind {
  const path = String(pathname || '')
  if (/\/login\.html?$/i.test(path)) return 'login'
  if (isHomePath(path)) return 'home'
  if (/^\/goods(?:2)?\.html$/i.test(path)) return 'goods'
  return 'other'
}

/** Prefer an already-open goods page, then a post-login home page, over a leftover login tab. */
export function preferredPathIndex(pathnames: string[]): number {
  if (!pathnames.length) return 0
  const kinds = pathnames.map(pathKind)
  const order: ObservedPathKind[] = ['goods', 'home', 'other', 'login']
  for (const want of order) {
    const index = kinds.indexOf(want)
    if (index >= 0) return index
  }
  return 0
}

/** Observe only the page this job navigated, never a leftover tab. */
export type TaskPageObservation = 'use_task_page' | 'stop_task_page_closed'

export function decideTaskPageObservation(input: { taskPageOpen: boolean }): TaskPageObservation {
  return input.taskPageOpen ? 'use_task_page' : 'stop_task_page_closed'
}

export function selectTaskPageIndex(pages: Array<{ isTaskPage: boolean; isClosed?: boolean }>): {
  action: TaskPageObservation
  index: number | null
} {
  const index = pages.findIndex((item) => item.isTaskPage && !item.isClosed)
  if (index >= 0) return { action: 'use_task_page', index }
  return { action: 'stop_task_page_closed', index: null }
}

export function restoreExhaustedMessage(sawLoginOnTaskTab: boolean): string {
  if (sawLoginOnTaskTab) {
    return '登录后仍未回到商品页，已停止自动恢复原链接，不会反复打开。请对照采集窗口后取消，或再试一次。'
  }
  return '恢复后仍停在首页，已停止自动打开原链接，不会反复打开。这不能说明已经登录。'
}

export const TASK_PAGE_CLOSED_MESSAGE = '采集页已关闭，已停止，不会改用其他标签继续。'

