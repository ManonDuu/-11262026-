import { CATEGORY_LABELS, COMPETITOR_CATEGORIES, type CompetitorCategory } from './categories'
import { coverageForOptions, type OptionSlotDraft } from './optionSlots'
import type { CompetitorRefImage, CoverageRow } from './types'

export type HeroCoverageStatus = 'ok' | 'partial' | 'unknown_total' | 'none'
export type LongImageStatus = 'kept_intact' | 'incomplete' | 'not_long'

export interface CaptureCoverageSummary {
  attempted: boolean
  blocked?: 'login' | 'captcha' | 'platform' | 'unavailable' | 'wrong_item' | 'post_login_home'
  blockedMessage?: string
  hero: { found: number; expected: number | null; status: HeroCoverageStatus; note: string }
  detail: { found: number; intactLong: number; incompleteLong: number; note: string }
  option: { inspected: boolean; total: number; bound: number; missing: number; note: string }
}

export function emptyCaptureCoverage(): CaptureCoverageSummary {
  return {
    attempted: false,
    hero: { found: 0, expected: null, status: 'none', note: '尚未上传主图。' },
    detail: { found: 0, intactLong: 0, incompleteLong: 0, note: '尚未上传详情图。' },
    option: { inspected: false, total: 0, bound: 0, missing: 0, note: '尚未添加套餐或绑定选项图。' },
  }
}

export function describeHeroCoverage(found: number, expected: number | null): { status: HeroCoverageStatus; note: string } {
  if (found <= 0) {
    return { status: 'none', note: '未采集到主图。请在商品页看完轮播后再采集，或手动导入。' }
  }
  if (expected != null && expected > found) {
    return { status: 'partial', note: `主图部分覆盖：页面显示 ${expected} 张，已取得 ${found} 张。缺的请补传，不用其他类图片顶替。` }
  }
  if (expected != null && expected > 0 && expected <= found) {
    return { status: 'ok', note: `主图已取得 ${found} 张，与页面显示的 ${expected} 张相符。` }
  }
  return { status: 'unknown_total', note: `已取得 ${found} 张主图，页面未显示总数，是否齐全未知。` }
}

export function describeDetailCoverage(found: number, intactLong: number, incompleteLong: number): string {
  if (found <= 0 && incompleteLong) return '未能取得完整长图，请手动补传，避免漏掉卖点。'
  if (found <= 0) return '未采集到详情图。请向下浏览详情后再采集，或手动导入完整图片。'
  const parts = [`详情图已取得 ${found} 张，按原顺序完整保留，不会自动切片。`]
  if (intactLong) parts.push(`其中 ${intactLong} 张超长图已完整保留，未切片。`)
  if (incompleteLong) parts.push(`有 ${incompleteLong} 张超长图未能取得完整长图，请手动补传，避免漏掉卖点。`)
  return parts.join('')
}

export function describeOptionCoverage(inspected: boolean, total: number, bound: number, missing: number): string {
  if (!inspected) return '未检查选项：请先在商品页打开「选购」弹窗后再点采集。未打开时不会推断套餐数量，也不会用主图充当选项图。'
  if (total <= 0) return '已打开选购弹窗，但没有识别到套餐项。请核对后手动添加套餐并绑图。'
  return `已绑定 ${bound} 个选购套餐，缺失 ${missing} 个。缺失项不会自动造图，也不会用主图顶替。`
}

export function describeUploadedCategory(category: CompetitorCategory, imported: number, captured: number): string {
  const label = CATEGORY_LABELS[category]
  const total = imported + captured
  if (total <= 0) return `${label}尚未上传。请在对应分类中上传图片。`
  if (captured > 0) return `${label}已有 ${total} 张（其中手动上传 ${imported} 张，历史采集 ${captured} 张）。`
  return `${label}已上传 ${imported} 张。`
}

export function describeManualOptionCoverage(total: number, bound: number, missing: number): string {
  if (total <= 0) return '还没有套餐记录。可添加套餐名称并绑定已上传的选项图。没有自动映射时请手工填写。'
  return `已绑定 ${bound} 个选购套餐，缺失 ${missing} 个。缺失项不会自动造图，也不会用主图顶替。`
}

export function buildCoverageRows(
  refs: CompetitorRefImage[],
  optionSlots: OptionSlotDraft[] = [],
  _captureAttempted = false,
  capture?: CaptureCoverageSummary | null,
): CoverageRow[] {
  return COMPETITOR_CATEGORIES.map((category) => {
    const imported = refs.filter((ref) => ref.category === category && ref.source === 'manual_import').length
    const captured = refs.filter((ref) => ref.category === category && ref.source === 'link_capture').length
    if (category === 'option') {
      const optionCoverage = coverageForOptions(optionSlots)
      const total = optionCoverage.total
      const missing = total > 0 ? optionCoverage.missing : 0
      return {
        category,
        imported,
        captured,
        missing,
        note: describeManualOptionCoverage(total, optionCoverage.bound, missing),
      }
    }
    const missing = category === 'hero'
      ? (capture?.hero.status === 'partial' && capture.hero.expected != null
        ? Math.max(0, capture.hero.expected - capture.hero.found)
        : 0)
      : (capture?.detail.incompleteLong ?? 0)
    return {
      category,
      imported,
      captured,
      missing: captured || capture?.attempted ? missing : 0,
      note: describeUploadedCategory(category, imported, captured),
    }
  })
}

export function describeCoverage(rows: CoverageRow[]): string {
  return rows.map((row) => {
    const total = row.imported + row.captured
    const history = row.captured ? `，其中历史采集 ${row.captured}` : ''
    const missing = row.missing ? `，待处理 ${row.missing}` : ''
    return `${CATEGORY_LABELS[row.category]}：已上传 ${total}${history}${missing}`
  }).join('；')
}
