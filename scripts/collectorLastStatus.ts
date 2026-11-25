import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { CollectorJobPublic } from '../src/pdd/competitor/collector/types'

const DEFAULT_STATUS_PATH = join(homedir(), 'pdd-image-studio-test', 'var', 'competitor-capture-last-status.json')

export function lastStatusPath(): string {
  return process.env.PDD_COLLECTOR_LAST_STATUS_PATH || DEFAULT_STATUS_PATH
}

export interface CollectorLastStatus {
  jobId: string
  goodsId: string
  phase: string
  message: string
  step: string
  heroFound: number
  detailFound: number
  optionFound: number
  lastError?: CollectorJobPublic['lastError']
  pageSignals?: CollectorJobPublic['pageSignals']
  entryKind?: CollectorJobPublic['entryKind']
  navTrace?: CollectorJobPublic['navTrace']
  startedAt: number
  updatedAt: number
}

export function toLastStatus(job: CollectorJobPublic): CollectorLastStatus {
  return {
    jobId: job.id,
    goodsId: job.goodsId,
    phase: job.phase,
    message: job.message,
    step: job.progress.step,
    heroFound: job.progress.heroFound,
    detailFound: job.progress.detailFound,
    optionFound: job.progress.optionFound,
    lastError: job.lastError,
    pageSignals: job.pageSignals,
    entryKind: job.entryKind,
    navTrace: job.navTrace,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
  }
}

export function writeLastStatus(job: CollectorJobPublic): void {
  const payload = toLastStatus(job)
  mkdirSync(dirname(lastStatusPath()), { recursive: true })
  writeFileSync(lastStatusPath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

export function readLastStatus(): CollectorLastStatus | null {
  try {
    if (!existsSync(lastStatusPath())) return null
    return JSON.parse(readFileSync(lastStatusPath(), 'utf8')) as CollectorLastStatus
  } catch {
    return null
  }
}

export function formatDiagnosticText(status: CollectorLastStatus, runtime?: { playwrightVersion?: string; chromiumRevision?: string }): string {
  const err = status.lastError
  const when = (value: number) => `${new Date(value).toLocaleString('zh-CN', { timeZone: 'America/Los_Angeles' })} America/Los_Angeles`
  const lines = [
    '拼多多工作台采集诊断（不含链接和登录信息）',
    `商品编号：${status.goodsId}`,
    `任务状态：${status.phase}`,
    `阶段：${status.step}`,
    `数量：主图 ${status.heroFound}，详情图 ${status.detailFound}，选项图 ${status.optionFound}`,
    `说明：${status.message}`,
  ]
  if (status.entryKind) lines.push(`入口类型：${status.entryKind}`)
  if (status.pageSignals) {
    const signals = status.pageSignals
    const matchLabel = signals.itemIdMatch === true ? '一致' : signals.itemIdMatch === false ? '不一致' : '未能读取'
    const sourceLabel = signals.itemIdSource === 'location_query' ? '地址查询' : signals.itemIdSource === 'og_url' ? '页面摘要地址' : signals.itemIdSource === 'dom' ? '页面内容' : '未能读取'
    lines.push(`命中规则：${signals.rule || '无'}`)
    lines.push(`页面路径：${signals.urlPath || '未能记录'}`)
    lines.push(`商品编号核对：${matchLabel}`)
    lines.push(`商品编号来源：${sourceLabel}`)
    lines.push(`已运行：${signals.elapsedMs} 毫秒`)
  }
  const trace = status.navTrace
  if (trace) {
    const fmtNames = (names?: string[]) => (names && names.length ? names.join(',') : '无')
    const fmtSum = (label: string, sum?: { path?: string | null; paramNames?: string[]; otherParamCount?: number; hasPs?: boolean; hasGoodsId?: boolean; hasFrom?: boolean; hasOtherQuery?: boolean; source?: string }) => {
      if (!sum) return
      lines.push(`${label}：路径 ${sum.path || '未能记录'} · 公开参数名 ${fmtNames(sum.paramNames)} · 其他参数 ${sum.otherParamCount || 0} 个 · 含ps ${sum.hasPs ? '是' : '否'} · 含商品编号参数 ${sum.hasGoodsId ? '是' : '否'}${sum.hasFrom ? ' · 含外层from' : ''}${sum.source ? ` · 来源 ${sum.source}` : ''}`)
    }
    lines.push(`导航触发：${trace.triggerEvent || '无'} · 恢复次数 ${trace.restoreCount}`)
    fmtSum('外层入口', trace.outer)
    fmtSum('内层目标', trace.inner)
    fmtSum('实际打开', trace.lastGoto)
    fmtSum('当前页面', trace.current)
    if (trace.tabCount != null) lines.push(`标签数量：${trace.tabCount}`)
    if (trace.currentIsGotoTab !== undefined) {
      const same = trace.currentIsGotoTab === true ? '是' : trace.currentIsGotoTab === false ? '否' : '未能比较'
      const reason = trace.currentIsGotoTabReason === 'task_page_closed' ? ' · 采集页已关闭' : trace.currentIsGotoTabReason === 'no_goto_page' ? ' · 没有可比较的打开页' : ''
      lines.push(`当前是否为本次打开的标签：${same}${reason}`)
    }
    if (trace.sawLoginOnTaskTab !== undefined) lines.push(`本次在采集页见过登录页：${trace.sawLoginOnTaskTab ? '是' : '否'}`)
    if (trace.pageKind) lines.push(`页面种类：${trace.pageKind}`)
    if (trace.soldOutTextSeen !== undefined || trace.similarRecommendationTextSeen !== undefined) {
      lines.push(`售罄文案：${trace.soldOutTextSeen ? '见到' : '未见'} · 相似推荐文案：${trace.similarRecommendationTextSeen ? '见到' : '未见'}`)
    }
    if (trace.itemIdSource) {
      const src = trace.itemIdSource === 'location_query' ? '地址查询' : trace.itemIdSource === 'og_url' ? '页面摘要地址' : '页面内容'
      lines.push(`导航中的编号来源：${src}`)
    }
  }
  if (err) {
    lines.push(`错误类别：${err.code}`)
    lines.push(`错误名称：${err.errorName}`)
    lines.push(`建议：${err.action}`)
    lines.push(`出错时间：${when(err.occurredAt)}`)
  }
  if (runtime?.playwrightVersion) lines.push(`Playwright：${runtime.playwrightVersion}`)
  if (runtime?.chromiumRevision) lines.push(`Chromium：${runtime.chromiumRevision}`)
  lines.push(`任务更新时间：${when(status.updatedAt)}`)
  return lines.join('\n')
}
