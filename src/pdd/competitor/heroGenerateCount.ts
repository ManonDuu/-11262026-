import type { CompetitorSession } from './types'

/** 与套图工作台每批张数上限相同。提交时明确校验，不静默截断。 */
export const COMPETITOR_HERO_GENERATE_MAX = 12

export type ParsedHeroGenerateCount =
  | { ok: true; value: number }
  | { ok: false; error: string }

export function parseHeroGenerateCount(raw: string): ParsedHeroGenerateCount {
  const text = raw.trim()
  if (!text) return { ok: false, error: '请填写主图生成数量。' }
  if (!/^\d+$/.test(text)) return { ok: false, error: '主图生成数量须为正整数，不能是小数、负数或文字。' }
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1) return { ok: false, error: '主图生成数量至少为 1。' }
  if (value > COMPETITOR_HERO_GENERATE_MAX) {
    return {
      ok: false,
      error: `主图生成数量不能超过 ${COMPETITOR_HERO_GENERATE_MAX}（与套图每批上限相同）。当前输入是 ${value}，没有改成更小的数。`,
    }
  }
  return { ok: true, value }
}

/** 只读兼容：旧会话没有该字段时，按已有主图卡或主图参考图数量显示，默认 1。不回写存储。 */
export function defaultHeroGenerateCount(session: Pick<CompetitorSession, 'heroGenerateCount' | 'cards' | 'refs'>): number {
  const stored = session.heroGenerateCount
  if (typeof stored === 'number' && Number.isInteger(stored) && stored >= 1 && stored <= COMPETITOR_HERO_GENERATE_MAX) {
    return stored
  }
  const cardCount = (session.cards || []).filter((card) => card.category === 'hero').length
  const refCount = (session.refs || []).filter((ref) => ref.category === 'hero').length
  const inferred = cardCount || refCount || 1
  return Math.min(COMPETITOR_HERO_GENERATE_MAX, Math.max(1, inferred))
}
