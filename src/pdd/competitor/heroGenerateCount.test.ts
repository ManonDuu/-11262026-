import { describe, expect, it } from 'vitest'
import { COMPETITOR_HERO_GENERATE_MAX, defaultHeroGenerateCount, parseHeroGenerateCount } from './heroGenerateCount'
import type { CompetitorCard, CompetitorRefImage, CompetitorSession } from './types'

function session(partial: Partial<CompetitorSession> = {}): CompetitorSession {
  return {
    id: 's',
    createdAt: 1,
    updatedAt: 1,
    goodsId: null,
    canonicalUrl: null,
    loginLikely: false,
    captureStatus: 'idle',
    parseMessage: '',
    productName: '',
    styleMode: 'strict',
    productAssets: [],
    refs: [],
    optionSlots: [],
    cards: [],
    generationConfirmed: false,
    planningError: null,
    ...partial,
  }
}

describe('主图生成数量校验', () => {
  it('接受范围内的正整数，拒绝空值、小数、非数字和超上限且不截断', () => {
    expect(parseHeroGenerateCount('1')).toEqual({ ok: true, value: 1 })
    expect(parseHeroGenerateCount('3')).toEqual({ ok: true, value: 3 })
    expect(parseHeroGenerateCount(String(COMPETITOR_HERO_GENERATE_MAX))).toEqual({ ok: true, value: COMPETITOR_HERO_GENERATE_MAX })
    expect(parseHeroGenerateCount('')).toMatchObject({ ok: false })
    expect(parseHeroGenerateCount('0').ok).toBe(false)
    expect(parseHeroGenerateCount('-1').ok).toBe(false)
    expect(parseHeroGenerateCount('1.5').ok).toBe(false)
    expect(parseHeroGenerateCount('abc').ok).toBe(false)
    const over = parseHeroGenerateCount(String(COMPETITOR_HERO_GENERATE_MAX + 1))
    expect(over.ok).toBe(false)
    if (!over.ok) {
      expect(over.error).toMatch(String(COMPETITOR_HERO_GENERATE_MAX + 1))
      expect(over.error).toMatch(/没有改成更小的数/)
    }
  })

  it('旧会话缺字段时按已有主图卡或参考图推断，不把缺省值当成已存储', () => {
    expect(defaultHeroGenerateCount(session())).toBe(1)
    expect(defaultHeroGenerateCount(session({
      refs: [{ category: 'hero' } as CompetitorRefImage, { category: 'hero' } as CompetitorRefImage],
    }))).toBe(2)
    expect(defaultHeroGenerateCount(session({
      cards: [{ category: 'hero' } as CompetitorCard, { category: 'hero' } as CompetitorCard, { category: 'detail' } as CompetitorCard],
    }))).toBe(2)
    expect(defaultHeroGenerateCount(session({ heroGenerateCount: 3 }))).toBe(3)
  })
})
