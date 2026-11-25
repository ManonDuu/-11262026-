/** 脱敏导航摘要：只保留路径和参数名，不含参数值或完整链接。 */

export type NavTriggerEvent = 'start' | 'restore_target' | 'observe'

const PUBLIC_PARAM_NAMES = new Set(['ps', 'goods_id', 'goodsId', 'from'])

export type NavUrlSummary = {
  path: string | null
  paramNames: string[]
  otherParamCount: number
  hasPs: boolean
  hasGoodsId: boolean
  hasFrom: boolean
  hasOtherQuery: boolean
}

export type NavPageKind = 'goods' | 'home' | 'login' | 'other'

export type CollectorNavTrace = {
  entryKind?: string
  triggerEvent?: NavTriggerEvent
  restoreCount: number
  openSource?: 'navigation' | 'canonical' | 'restore'
  outer?: NavUrlSummary
  inner?: NavUrlSummary
  lastGoto?: NavUrlSummary & { source: 'open' | 'restore' }
  current?: NavUrlSummary
  itemIdSource?: 'location_query' | 'og_url' | 'dom' | null
  tabCount?: number
  currentIsGotoTab?: boolean | null
  currentIsGotoTabReason?: 'compared' | 'no_goto_page' | 'task_page_closed'
  sawLoginOnTaskTab?: boolean
  pageKind?: NavPageKind
  soldOutTextSeen?: boolean
  similarRecommendationTextSeen?: boolean
}

export type NavObserveMeta = {
  itemIdSource?: CollectorNavTrace['itemIdSource']
  tabCount?: number
  currentIsGotoTab?: boolean | null
  currentIsGotoTabReason?: CollectorNavTrace['currentIsGotoTabReason']
  sawLoginOnTaskTab?: boolean
  pageKind?: NavPageKind
  soldOutTextSeen?: boolean
  similarRecommendationTextSeen?: boolean
}

export function summarizeNavUrl(raw: string | null | undefined): NavUrlSummary {
  const empty: NavUrlSummary = { path: null, paramNames: [], otherParamCount: 0, hasPs: false, hasGoodsId: false, hasFrom: false, hasOtherQuery: false }
  if (!raw) return empty
  try {
    const url = new URL(raw, 'https://mobile.yangkeduo.com/')
    const allNames = Array.from(url.searchParams.keys()).filter((name, index, list) => list.indexOf(name) === index)
    const paramNames = allNames.filter((name) => PUBLIC_PARAM_NAMES.has(name)).sort()
    const otherParamCount = allNames.length - paramNames.length
    const path = url.pathname && url.pathname.length <= 80 ? url.pathname : null
    return {
      path,
      paramNames,
      otherParamCount,
      hasPs: allNames.includes('ps'),
      hasGoodsId: allNames.includes('goods_id') || allNames.includes('goodsId'),
      hasFrom: allNames.includes('from'),
      hasOtherQuery: otherParamCount > 0,
    }
  } catch {
    return empty
  }
}

export function createNavTrace(input: {
  entryKind?: string
  navigationUrl?: string
  restoreUrl?: string
  canonicalUrl?: string
}): CollectorNavTrace {
  const outer = summarizeNavUrl(input.navigationUrl || input.canonicalUrl)
  const innerSource = input.restoreUrl && input.restoreUrl !== input.navigationUrl ? input.restoreUrl : null
  return {
    entryKind: input.entryKind,
    triggerEvent: 'start',
    restoreCount: 0,
    openSource: input.navigationUrl ? 'navigation' : 'canonical',
    outer,
    inner: innerSource ? summarizeNavUrl(innerSource) : undefined,
  }
}

export function recordGoto(trace: CollectorNavTrace | undefined, raw: string, source: 'open' | 'restore', restoreCount?: number): CollectorNavTrace {
  const next: CollectorNavTrace = { ...(trace || { restoreCount: 0 }), triggerEvent: source === 'restore' ? 'restore_target' : 'start' }
  if (restoreCount != null) next.restoreCount = restoreCount
  next.lastGoto = { ...summarizeNavUrl(raw), source }
  if (source === 'open') next.openSource = next.openSource || 'navigation'
  if (source === 'restore') next.openSource = 'restore'
  return next
}

export function recordCurrent(trace: CollectorNavTrace | undefined, raw: string, itemIdSource?: CollectorNavTrace['itemIdSource']): CollectorNavTrace {
  const next: CollectorNavTrace = { ...(trace || { restoreCount: 0 }), triggerEvent: 'observe' }
  next.current = summarizeNavUrl(raw)
  if (itemIdSource !== undefined) next.itemIdSource = itemIdSource
  return next
}

export function recordObserve(trace: CollectorNavTrace | undefined, raw: string, meta: NavObserveMeta = {}): CollectorNavTrace {
  const next = recordCurrent(trace, raw, meta.itemIdSource)
  if (meta.tabCount != null) next.tabCount = meta.tabCount
  if (meta.currentIsGotoTab !== undefined) next.currentIsGotoTab = meta.currentIsGotoTab
  if (meta.currentIsGotoTabReason) next.currentIsGotoTabReason = meta.currentIsGotoTabReason
  if (meta.sawLoginOnTaskTab !== undefined) next.sawLoginOnTaskTab = meta.sawLoginOnTaskTab
  if (meta.pageKind) next.pageKind = meta.pageKind
  if (meta.soldOutTextSeen !== undefined) next.soldOutTextSeen = meta.soldOutTextSeen
  if (meta.similarRecommendationTextSeen !== undefined) next.similarRecommendationTextSeen = meta.similarRecommendationTextSeen
  return next
}

