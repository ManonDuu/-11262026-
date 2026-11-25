import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { BrowserContext, Page } from 'playwright'
import { captureDomRuntimeSource, type CaptureDomResult } from '../src/pdd/competitor/captureDom'
import { coverageFromDomResult, classifyLongImage, MAX_IMAGE_BYTES } from '../src/pdd/competitor/captureProtocol'
import { downloadAllowedImage } from './downloadAllowedImage'
import { attachImage, publicJob, setOptions, updateJob, type CollectorJobInternal } from '../src/pdd/competitor/collector/jobState'
import { classifyCapturePage, decisionMessage, isTerminalDecision, type CapturePageDecision } from '../src/pdd/competitor/collector/pageStatus'
import { buildJobPageSignals, decideUnavailableRecheck, holdWindowBeforeClose, UNAVAILABLE_RECONFIRM_POLL_MS, UNCONFIRMED_UNAVAILABLE_MESSAGE } from '../src/pdd/competitor/collector/unavailableGate'
import { classifyCollectorError, isRetryablePageError } from '../src/pdd/competitor/collector/errorClassify'
import { writeLastStatus } from './collectorLastStatus'
import { collectorOpenUrl, collectorRestoreUrl } from '../src/pdd/competitor/collector/openUrl'
import { recordGoto, recordObserve, type NavObserveMeta } from '../src/pdd/competitor/collector/navTrace'
import { canonicalGoodsUrl } from '../src/pdd/competitor/linkNormalize'
import { decidePostLoginNavigation, HOME_SETTLE_MS, RESTORE_NAV_TIMEOUT_MS, pathKind, restoreExhaustedMessage, TASK_PAGE_CLOSED_MESSAGE } from '../src/pdd/competitor/collector/postLoginRestore'
import type { CollectorImageMeta } from '../src/pdd/competitor/collector/types'

const PROFILE_DIR = join(homedir(), 'pdd-image-studio-test', 'var', 'competitor-capture-profile')

async function extractFromPage(page: Page, expectedGoodsId?: string): Promise<CaptureDomResult> {
  const runtime = captureDomRuntimeSource()
  return page.evaluate(({ source, expectedGoodsId: goodsId }) => {
    const runner = new Function('document', 'expectedGoodsId', `${source}; return extractCompetitorDom(document, expectedGoodsId);`)
    return runner(document, goodsId)
  }, { source: runtime, expectedGoodsId }) as Promise<CaptureDomResult>
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function clickText(page: Page, pattern: RegExp): Promise<boolean> {
  return page.evaluate((source) => {
    const re = new RegExp(source)
    const nodes = Array.from(document.querySelectorAll('button, a, span, div, li'))
    const target = nodes.find((el) => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      return re.test(text) && text.length <= 12
    }) as HTMLElement | undefined
    if (!target) return false
    target.click()
    return true
  }, pattern.source)
}

async function scrollDetails(page: Page): Promise<void> {
  let previous = 0
  for (let i = 0; i < 24; i += 1) {
    const height = await page.evaluate(() => {
      window.scrollBy(0, 700)
      return document.body ? document.body.scrollHeight : 0
    })
    await page.waitForTimeout(350)
    if (height <= previous) break
    previous = height
  }
}

async function cycleCarousel(page: Page): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    const moved = await page.evaluate(() => {
      const next = document.querySelector('.swiper-button-next, [class*="swiper-button-next"], [class*="arrow-right"]') as HTMLElement | null
      if (next) {
        next.click()
        return true
      }
      const swiper = document.querySelector('.swiper-container, [class*="swiper"]') as HTMLElement | null
      if (swiper) {
        swiper.scrollLeft += swiper.clientWidth || 300
        return true
      }
      return false
    })
    if (!moved) break
    await page.waitForTimeout(280)
  }
}

async function ingestSnapshot(job: CollectorJobInternal, snap: CaptureDomResult, categories: Array<'hero' | 'detail' | 'option'>): Promise<void> {
  const groups = {
    hero: snap.hero,
    detail: snap.detail,
    option: snap.optionImages,
  }
  for (const category of categories) {
    for (const item of groups[category]) {
      if (job.images.some((existing) => existing.sourceKey === item.sourceUrl && existing.category === category)) continue
      let bytesStatus: CollectorImageMeta['bytesStatus'] = 'unavailable'
      let mimeType = 'image/jpeg'
      let byteLength = 0
      let bytes: Uint8Array | undefined
      try {
        const downloaded = await downloadAllowedImage(item.sourceUrl)
        bytesStatus = downloaded.status
        mimeType = downloaded.mimeType
        byteLength = downloaded.bytes.byteLength
        bytes = downloaded.status === 'ok' ? downloaded.bytes : undefined
      } catch {
        bytesStatus = 'unavailable'
      }
      const longImage = classifyLongImage({
        width: item.width || undefined,
        height: item.height || undefined,
        bytesStatus,
        likelyLong: item.likelyLongImage,
      })
      attachImage(job, {
        id: item.id,
        category,
        order: item.order,
        fileName: `${category}-${item.order}.jpg`,
        mimeType,
        byteLength,
        width: item.width || undefined,
        height: item.height || undefined,
        sourceKey: item.sourceUrl,
        bytesStatus,
        longImage,
      }, bytes)
    }
  }
  setOptions(job, snap.options.map((option) => ({
    optionName: option.optionName,
    contentsNote: option.contentsNote,
    imageId: option.imageLocalId,
    missing: option.missing,
    missingReason: option.missingReason,
  })))
  updateJob(job, {
    coverage: coverageFromDomResult(snap, job.images),
    progress: {
      step: job.progress.step,
      heroFound: job.images.filter((item) => item.category === 'hero' && item.bytesStatus === 'ok').length,
      detailFound: job.images.filter((item) => item.category === 'detail' && item.bytesStatus === 'ok').length,
      optionFound: job.images.filter((item) => item.category === 'option' && item.bytesStatus === 'ok').length,
      optionTotal: snap.optionsInspected ? snap.options.length : null,
      heroExpected: snap.heroExpectedTotal,
    },
  })
}

function pageSignalsFor(job: CollectorJobInternal, snap: CaptureDomResult) {
  return buildJobPageSignals({ startedAt: job.startedAt, snap, expectedGoodsId: job.goodsId })
}

async function finalizeTerminalPage(job: CollectorJobInternal, snap: CaptureDomResult, decision: CapturePageDecision, messageOverride?: string): Promise<void> {
  const phase = decision === 'unavailable' ? 'target_unavailable' : 'blocked'
  updateJob(job, {
    phase,
    message: messageOverride || snap.blockMessage || decisionMessage(decision, job.goodsId),
    canContinue: false,
    pageSignals: pageSignalsFor(job, snap),
    navTrace: job.navTrace,
  })
  writeLastStatus(publicJob(job))
  if (decision === 'unavailable') await holdWindowBeforeClose(job)
}

type CollectorSession = {
  taskPage: Page
  lastGotoPage: Page
  sawLoginOnTaskTab: boolean
}

function openTabCount(context: BrowserContext): number {
  return context.pages().filter((item) => !item.isClosed()).length
}

function observeMeta(context: BrowserContext, session: CollectorSession, page: Page, snap?: CaptureDomResult): NavObserveMeta {
  const closed = page.isClosed()
  const rule = snap?.pageSignals?.rule
  const soldPair = rule === 'sold_out_similar' || rule === 'unconfirmed'
  let pageKind: NavObserveMeta['pageKind']
  if (!closed) {
    try { pageKind = pathKind(new URL(page.url()).pathname) } catch { /* 不把地址写入日志 */ }
  }
  return {
    itemIdSource: snap?.pageSignals?.itemIdSource,
    tabCount: openTabCount(context),
    currentIsGotoTab: closed ? false : page === session.lastGotoPage,
    currentIsGotoTabReason: closed ? 'task_page_closed' : 'compared',
    sawLoginOnTaskTab: session.sawLoginOnTaskTab,
    pageKind,
    soldOutTextSeen: soldPair ? true : undefined,
    similarRecommendationTextSeen: soldPair ? true : undefined,
  }
}

function taskPageOrStop(session: CollectorSession): Page | null {
  return session.taskPage.isClosed() ? null : session.taskPage
}

function bindJobIdentity(job: CollectorJobInternal, goodsId: string | null | undefined): void {
  if (!goodsId || job.goodsId) return
  updateJob(job, { goodsId, canonicalUrl: canonicalGoodsUrl(goodsId) })
}

function rememberCurrentPage(job: CollectorJobInternal, page: Page, meta?: NavObserveMeta): void {
  try {
    if (page.isClosed()) return
    job.navTrace = recordObserve(job.navTrace, page.url(), meta)
  } catch {
    // 不把地址写入日志
  }
}

function failTaskPageClosed(job: CollectorJobInternal): void {
  updateJob(job, { phase: 'failed', message: TASK_PAGE_CLOSED_MESSAGE, canContinue: false })
  writeLastStatus(publicJob(job))
}

function rememberGoto(job: CollectorJobInternal, raw: string, source: 'open' | 'restore'): void {
  job.navTrace = recordGoto(job.navTrace, raw, source, job.targetRestoresUsed || 0)
}

async function waitForTargetPage(job: CollectorJobInternal, session: CollectorSession, context: BrowserContext): Promise<{ status: 'proceed' | 'stop'; page: Page }> {
  const deadline = Date.now() + 15 * 60 * 1000
  let unavailableSince: number | null = null
  let homeSeenAt: number | null = null
  let page = session.taskPage
  while (!job.cancelRequested && Date.now() < deadline) {
    const anchored = taskPageOrStop(session)
    if (!anchored) {
      failTaskPageClosed(job)
      return { status: 'stop', page: session.taskPage }
    }
    page = anchored
    let snap
    try {
      snap = await extractFromPage(page, job.goodsId || undefined)
    } catch (error) {
      const info = classifyCollectorError(error, job.progress.step || 'navigate')
      if (isRetryablePageError(info.code)) {
        updateJob(job, { message: info.safeMessage, lastError: info, progress: { step: 'navigate' } })
        await delay(1000)
        continue
      }
      updateJob(job, { phase: 'failed', message: `${info.safeMessage} ${info.action}`, canContinue: false, lastError: info })
      writeLastStatus(publicJob(job))
      return { status: 'stop', page }
    }
    const decision = classifyCapturePage(snap, job.goodsId || undefined)
    if (decision === 'wait_login') session.sawLoginOnTaskTab = true
    rememberCurrentPage(job, page, observeMeta(context, session, page, snap))
    if (decision === 'post_login_home') {
      if (homeSeenAt == null) homeSeenAt = Date.now()
    } else {
      homeSeenAt = null
    }
    const homeStable = decision === 'post_login_home' && homeSeenAt != null && Date.now() - homeSeenAt >= HOME_SETTLE_MS
    const action = decidePostLoginNavigation({
      decision,
      restoresUsed: job.targetRestoresUsed || 0,
      homeStable,
      cancelRequested: job.cancelRequested,
    })
    if (action === 'proceed') {
      if (!snap.goodsId) {
        unavailableSince = null
        updateJob(job, {
          phase: 'launching',
          message: '已打开商品内容，正在确认商品编号…',
          canContinue: false,
          pageSignals: pageSignalsFor(job, snap),
          progress: { step: 'navigate' },
        })
        await delay(1000)
        continue
      }
      bindJobIdentity(job, snap.goodsId)
      unavailableSince = null
      updateJob(job, { phase: 'capturing', message: decisionMessage('proceed', job.goodsId), canContinue: false, pageSignals: pageSignalsFor(job, snap) })
      return { status: 'proceed', page }
    }
    if (action === 'restore_target') {
      job.targetRestoresUsed = (job.targetRestoresUsed || 0) + 1
      homeSeenAt = null
      unavailableSince = null
      updateJob(job, {
        phase: 'launching',
        canContinue: false,
        message: session.sawLoginOnTaskTab
          ? '登录后未回到商品页，正在同一窗口再打开一次原商品链接…'
          : '当前在首页或类似页面，正在同一窗口再打开一次原商品链接…',
        pageSignals: pageSignalsFor(job, snap),
        progress: { step: 'navigate' },
      })
      try {
        const anchored = taskPageOrStop(session)
        if (!anchored) {
          failTaskPageClosed(job)
          return { status: 'stop', page: session.taskPage }
        }
        page = anchored
        const restoreUrl = collectorRestoreUrl(job)
        rememberGoto(job, restoreUrl, 'restore')
        await page.goto(restoreUrl, { waitUntil: 'domcontentloaded', timeout: RESTORE_NAV_TIMEOUT_MS })
        session.lastGotoPage = page
        rememberCurrentPage(job, page, observeMeta(context, session, page))
      } catch (error) {
        const info = classifyCollectorError(error, 'navigate')
        if (isRetryablePageError(info.code)) {
          updateJob(job, { message: info.safeMessage, lastError: info, progress: { step: 'navigate' } })
          await delay(1000)
          continue
        }
        updateJob(job, { phase: 'failed', message: `${info.safeMessage} ${info.action}`, canContinue: false, lastError: info })
        writeLastStatus(publicJob(job))
        return { status: 'stop', page }
      }
      await delay(1000)
      continue
    }
    if (action === 'stop_restore_exhausted') {
      updateJob(job, {
        phase: 'failed',
        message: restoreExhaustedMessage(session.sawLoginOnTaskTab),
        canContinue: false,
        pageSignals: pageSignalsFor(job, snap),
      })
      writeLastStatus(publicJob(job))
      return { status: 'stop', page }
    }
    if (action === 'abort_cancelled') {
      updateJob(job, { phase: 'cancelled', message: '已取消采集。', canContinue: false })
      return { status: 'stop', page }
    }
    if (decision === 'unavailable') {
      if (job.unavailableFirstHitAt == null) job.unavailableFirstHitAt = Date.now()
      if (unavailableSince == null) unavailableSince = job.unavailableFirstHitAt
      const confirmed = snap.pageSignals?.confirmed === true
      const recheck = decideUnavailableRecheck({
        firstHitAt: job.unavailableFirstHitAt,
        now: Date.now(),
        decision,
        confirmed,
      })
      updateJob(job, {
        phase: 'launching',
        canContinue: false,
        message: confirmed
          ? '页面显示售罄或下架，正在短时复核，暂不采集图片。'
          : '页面疑似售罄或下架，正在短时复核，暂不采集图片，也不会采集推荐商品图片。',
        pageSignals: pageSignalsFor(job, snap),
        progress: { step: 'navigate' },
      })
      if (recheck === 'finalize' || recheck === 'finalize_unconfirmed') {
        await finalizeTerminalPage(
          job,
          snap,
          decision,
          recheck === 'finalize_unconfirmed' ? UNCONFIRMED_UNAVAILABLE_MESSAGE : undefined,
        )
        return { status: 'stop', page }
      }
      await delay(UNAVAILABLE_RECONFIRM_POLL_MS)
      continue
    }
    unavailableSince = null
    if (isTerminalDecision(decision) || action === 'stop_terminal') {
      await finalizeTerminalPage(job, snap, decision)
      return { status: 'stop', page }
    }
    if (decision === 'wait_login' || decision === 'wait_captcha') {
      updateJob(job, {
        phase: decision === 'wait_login' ? 'awaiting_login' : 'awaiting_captcha',
        canContinue: true,
        message: decisionMessage(decision, job.goodsId),
        pageSignals: pageSignalsFor(job, snap),
      })
    } else {
      updateJob(job, {
        phase: 'launching',
        message: decision === 'post_login_home'
          ? (session.sawLoginOnTaskTab
            ? '已离开登录页，当前在首页。确认稳定后会再打开一次原商品链接。'
            : '当前在首页或类似页面，确认稳定后会再打开一次原商品链接。这不能说明已经登录。')
          : decisionMessage('loading', job.goodsId),
        canContinue: false,
        progress: { step: 'navigate' },
        pageSignals: pageSignalsFor(job, snap),
      })
    }
    await delay(1000)
  }
  if (job.cancelRequested) {
    updateJob(job, { phase: 'cancelled', message: '已取消采集。', canContinue: false })
    return { status: 'stop', page }
  }
  updateJob(job, { phase: 'failed', message: job.goodsId ? `等待超时，仍无法确认目标商品页 ${job.goodsId}。已停止采集。` : '等待超时，仍无法确认目标商品页。已停止采集。', canContinue: false })
  writeLastStatus(publicJob(job))
  return { status: 'stop', page }
}

export async function runCompetitorCollector(job: CollectorJobInternal): Promise<void> {
  const playwright = await import('playwright')
  mkdirSync(PROFILE_DIR, { recursive: true })
  updateJob(job, { phase: 'launching', message: '正在打开专用采集窗口…', progress: { step: 'launch' } })
  const context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 430, height: 860 },
  })
  try {
    const taskPage = await context.newPage()
    try { await taskPage.bringToFront() } catch { /* 只为让本次标签可见，失败不中止 */ }
    const session: CollectorSession = { taskPage, lastGotoPage: taskPage, sawLoginOnTaskTab: false }
    let page = taskPage
    const openUrl = collectorOpenUrl(job)
    updateJob(job, { phase: 'launching', message: job.goodsId ? `正在打开商品页 ${job.goodsId}…` : '正在打开原始商品链接…', progress: { step: 'navigate' } })
    rememberGoto(job, openUrl, 'open')
    await page.goto(openUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    session.lastGotoPage = page
    rememberCurrentPage(job, page, observeMeta(context, session, page))

    const gate = await waitForTargetPage(job, session, context)
    if (gate.status === 'stop') return
    page = gate.page

    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (job.cancelRequested) break
      const anchored = taskPageOrStop(session)
      if (!anchored) {
        failTaskPageClosed(job)
        return
      }
      page = anchored
      const confirm = await extractFromPage(page, job.goodsId || undefined)
      const decision = classifyCapturePage(confirm, job.goodsId || undefined)
      if (decision === 'post_login_home' || decision === 'unavailable') {
        const again = await waitForTargetPage(job, session, context)
        if (again.status === 'stop') return
        page = again.page
        continue
      }
      if (isTerminalDecision(decision)) {
        await finalizeTerminalPage(job, confirm, decision)
        return
      }
      if (decision === 'wait_login' || decision === 'wait_captcha') {
        const again = await waitForTargetPage(job, session, context)
        if (again.status === 'stop') return
        page = again.page
        continue
      }
      if (decision !== 'proceed' && attempt < 5) {
        await delay(800)
        continue
      }

      updateJob(job, { phase: 'capturing', message: '正在采集主图（含轮播）…', progress: { step: 'hero' }, canContinue: false })
      await cycleCarousel(page)
      await ingestSnapshot(job, await extractFromPage(page, job.goodsId), ['hero'])

      updateJob(job, { phase: 'capturing', message: '正在向下浏览并采集详情图，长图会整张保留…', progress: { step: 'detail' } })
      await scrollDetails(page)
      await ingestSnapshot(job, await extractFromPage(page, job.goodsId), ['hero', 'detail'])

      updateJob(job, { phase: 'capturing', message: '正在打开选购并采集选项图…', progress: { step: 'option' } })
      await clickText(page, /选购|规格/)
      await page.waitForTimeout(700)
      let optionSnap = await extractFromPage(page, job.goodsId)
      if (!optionSnap.optionsInspected) {
        await clickText(page, /选购/)
        await page.waitForTimeout(700)
        optionSnap = await extractFromPage(page, job.goodsId)
      }
      if (optionSnap.optionsInspected) {
        const count = optionSnap.options.length
        for (let i = 0; i < count; i += 1) {
          await page.evaluate((index) => {
            const items = document.querySelectorAll('[data-competitor-option], [class*="sku-item" i], [class*="spec-item" i]')
            const target = items[index] as HTMLElement | undefined
            target?.click()
          }, i)
          await page.waitForTimeout(350)
        }
        optionSnap = await extractFromPage(page, job.goodsId)
      }
      await ingestSnapshot(job, optionSnap, ['hero', 'detail', 'option'])

      const heroOk = job.images.some((item) => item.category === 'hero' && item.bytesStatus === 'ok')
      const message = optionSnap.optionsInspected
        ? '采集告一段落，请在「主图、详情图、选项图」中核对数量和缺失项。这只是本次回传结果，还不能当成真实链接已经验收取全。'
        : '已尽量采集主图和详情图，但没有确认选购弹窗。请打开核对；选项图未检查，不会用主图顶替。这还不是取全验收。'
      updateJob(job, {
        phase: heroOk || job.images.length ? 'done' : 'failed',
        message: heroOk || job.images.length ? message : '没有采集到可保存的图片。若页面有限制，请稍后再试或使用补传。',
        canContinue: false,
        coverage: coverageFromDomResult(optionSnap, job.images),
      })
      return
    }
    if (job.phase === 'capturing' || job.phase === 'launching') {
      updateJob(job, { phase: 'failed', message: '多次尝试后仍无法进入商品页，已停止采集。', canContinue: false })
    }
  } catch (error) {
    if (!job.cancelRequested) {
      const info = classifyCollectorError(error, job.progress.step || 'navigate')
      updateJob(job, { phase: 'failed', message: `${info.safeMessage} ${info.action}`, canContinue: false, lastError: info })
      writeLastStatus(publicJob(job))
    }
  } finally {
    try { await context.close() } catch { /* ignore */ }
  }
}
