import { describe, expect, it } from 'vitest'
import { isRetryablePageError } from './errorClassify'
import { decidePostLoginNavigation, decideTaskPageObservation, isHomePath, MAX_TARGET_RESTORES, pathKind, preferredPathIndex, restoreExhaustedMessage, selectTaskPageIndex, TASK_PAGE_CLOSED_MESSAGE } from './postLoginRestore'

describe('登录后恢复原链状态机', () => {
  it('仍在登录或验证页时不恢复导航', () => {
    expect(decidePostLoginNavigation({
      decision: 'wait_login',
      restoresUsed: 0,
      homeStable: true,
      cancelRequested: false,
    })).toBe('wait_login')
    expect(decidePostLoginNavigation({
      decision: 'wait_captcha',
      restoresUsed: 0,
      homeStable: true,
      cancelRequested: false,
    })).toBe('wait_captcha')
  })

  it('登录后落到首页，稳定前等待，稳定后只恢复一次原链', () => {
    expect(isHomePath('/index.html')).toBe(true)
    expect(isHomePath('/')).toBe(true)
    expect(isHomePath('/home.html')).toBe(true)
    expect(isHomePath('/goods2.html')).toBe(false)
    expect(isHomePath('/login.html')).toBe(false)
    expect(MAX_TARGET_RESTORES).toBe(1)
    expect(decidePostLoginNavigation({
      decision: 'post_login_home',
      restoresUsed: 0,
      homeStable: false,
      cancelRequested: false,
    })).toBe('wait_home_settle')
    expect(decidePostLoginNavigation({
      decision: 'post_login_home',
      restoresUsed: 0,
      homeStable: true,
      cancelRequested: false,
    })).toBe('restore_target')
  })

  it('恢复次数用尽或取消时停止，不循环打开', () => {
    expect(decidePostLoginNavigation({
      decision: 'post_login_home',
      restoresUsed: 1,
      homeStable: true,
      cancelRequested: false,
    })).toBe('stop_restore_exhausted')
    expect(decidePostLoginNavigation({
      decision: 'post_login_home',
      restoresUsed: 0,
      homeStable: true,
      cancelRequested: true,
    })).toBe('abort_cancelled')
  })

  it('已进入目标商品则继续，售罄等终态不走恢复', () => {
    expect(decidePostLoginNavigation({
      decision: 'proceed',
      restoresUsed: 0,
      homeStable: true,
      cancelRequested: false,
    })).toBe('proceed')
    expect(decidePostLoginNavigation({
      decision: 'unavailable',
      restoresUsed: 0,
      homeStable: false,
      cancelRequested: false,
    })).toBe('stop_terminal')
    expect(decidePostLoginNavigation({
      decision: 'loading',
      restoresUsed: 0,
      homeStable: false,
      cancelRequested: false,
    })).toBe('wait_loading')
  })

  it('上下文短暂销毁仍视为可重试，页面关闭不可重试', () => {
    expect(isRetryablePageError('context_destroyed')).toBe(true)
    expect(isRetryablePageError('target_closed')).toBe(false)
  })
})


describe('多页面观察顺序（对应本机登录后仍读登录页）', () => {
  it('登录页仍在、同时已有首页时，优先观察首页并允许恢复原链，不会继续只等登录', () => {
    const paths = ['/login.html', '/index.html']
    expect(pathKind('/login.html')).toBe('login')
    expect(pathKind('/index.html')).toBe('home')
    expect(preferredPathIndex(paths)).toBe(1)
    expect(pathKind(paths[preferredPathIndex(paths)])).toBe('home')
    expect(decidePostLoginNavigation({
      decision: 'post_login_home',
      restoresUsed: 0,
      homeStable: true,
      cancelRequested: false,
    })).toBe('restore_target')
  })

  it('只有登录页时仍等待登录，不恢复导航', () => {
    expect(preferredPathIndex(['/login.html'])).toBe(0)
    expect(decidePostLoginNavigation({
      decision: 'wait_login',
      restoresUsed: 0,
      homeStable: true,
      cancelRequested: false,
    })).toBe('wait_login')
  })

  it('同时有商品页时优先商品页，不误走首页恢复', () => {
    const paths = ['/login.html', '/index.html', '/goods2.html']
    expect(preferredPathIndex(paths)).toBe(2)
    expect(pathKind(paths[2])).toBe('goods')
  })
})


describe('任务页锚定观察（避免残留商品页冒充本次结果）', () => {
  it('首个标签是残留售罄商品页，本次分享链在另一页打开时，只观察任务页', () => {
    const pages = [
      { isTaskPage: false, isClosed: false, path: '/goods2.html' },
      { isTaskPage: true, isClosed: false, path: '/goods2.html' },
    ]
    // 旧排序会选中第一个 goods 页，也就是残留标签
    expect(preferredPathIndex(pages.map((item) => item.path))).toBe(0)
    const choice = selectTaskPageIndex(pages)
    expect(choice).toEqual({ action: 'use_task_page', index: 1 })
    expect(pages[choice.index!].isTaskPage).toBe(true)
  })

  it('任务页关闭后，即使残留商品页还在，也不改用其他标签', () => {
    const pages = [
      { isTaskPage: false, isClosed: false, path: '/goods2.html' },
      { isTaskPage: true, isClosed: true, path: '/goods2.html' },
    ]
    expect(selectTaskPageIndex(pages)).toEqual({ action: 'stop_task_page_closed', index: null })
    expect(decideTaskPageObservation({ taskPageOpen: false })).toBe('stop_task_page_closed')
    expect(TASK_PAGE_CLOSED_MESSAGE).toMatch(/不会改用其他标签/)
  })

  it('任务页直接落到首页且旁边有登录页或商品页时，仍只以任务页为准，并标明未见登录页', () => {
    const pages = [
      { isTaskPage: false, isClosed: false, path: '/login.html' },
      { isTaskPage: false, isClosed: false, path: '/goods2.html' },
      { isTaskPage: true, isClosed: false, path: '/' },
    ]
    expect(selectTaskPageIndex(pages)).toEqual({ action: 'use_task_page', index: 2 })
    expect(restoreExhaustedMessage(false)).toMatch(/恢复后仍停在首页/)
    expect(restoreExhaustedMessage(false)).toMatch(/不能说明已经登录/)
    expect(restoreExhaustedMessage(true)).toMatch(/登录后仍未回到商品页/)
  })

  it('任务页仍打开时继续使用任务页', () => {
    expect(decideTaskPageObservation({ taskPageOpen: true })).toBe('use_task_page')
  })
})
