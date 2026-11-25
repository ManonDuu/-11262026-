import { describe, expect, it } from 'vitest'
import { applyCompetitorCardPatch } from './cardPatch'
import type { CompetitorCard } from './types'

function card(partial?: Partial<CompetitorCard>): CompetitorCard {
  return {
    id: 'card-1',
    index: 1,
    role: 'hero',
    aspectRatio: '1:1',
    frameSpec: { inputMode: 'preset', preset: '1:1', width: 1, height: 1 },
    title: '主图 1',
    subtitle: '',
    sceneSummary: '',
    layoutSummary: '',
    imagePrompt: '旧提示词，核心卖点语义：结实',
    status: 'idle',
    category: 'hero',
    refImageId: 'ref-1',
    optionName: '',
    contentsNote: '',
    sellingPoint: '结实',
    ...partial,
  }
}

describe('竞品卡片结构化编辑同步', () => {
  it('修改卖点后会重写最终 prompt，并带上文案优化规则', () => {
    const next = applyCompetitorCardPatch(card(), { sellingPoint: '结实耐玩，适合户外' }, { styleMode: 'strict' })
    expect(next.sellingPoint).toBe('结实耐玩，适合户外')
    expect(next.imagePrompt).toMatch(/结实耐玩，适合户外/)
    expect(next.imagePrompt).toMatch(/不要照抄原句/)
    expect(next.imagePrompt).not.toMatch(/^旧提示词/)
  })

  it('再次修改结构化卖点时，以这次修改为准并重写最终 prompt', () => {
    const existing = card({ lastPromptEditAt: 200, lastStructuredEditAt: 100, imagePrompt: '用户手改的全文' })
    const next = applyCompetitorCardPatch(existing, { sellingPoint: '新的卖点' }, { styleMode: 'strict' })
    expect(next.sellingPoint).toBe('新的卖点')
    expect(next.imagePrompt).toMatch(/新的卖点/)
    expect(next.imagePrompt).not.toBe('用户手改的全文')
  })
})

  it('仅改场景和排版时同步 prompt，但不改卖点', () => {
    const existing = card({ sellingPoint: '结实', sceneSummary: '草坪', layoutSummary: '居中', imagePrompt: '旧提示词，核心卖点语义：结实' })
    const next = applyCompetitorCardPatch(existing, { sceneSummary: '棚拍', layoutSummary: '标题在上' }, { styleMode: 'strict' })
    expect(next.sellingPoint).toBe('结实')
    expect(next.sceneSummary).toBe('棚拍')
    expect(next.layoutSummary).toBe('标题在上')
    expect(next.imagePrompt).toMatch(/棚拍/)
    expect(next.imagePrompt).toMatch(/标题在上/)
    expect(next.imagePrompt).toMatch(/结实/)
    expect(next.resultImageId).toBe(existing.resultImageId)
  })

  it('修改标题后会把新标题写进最终 prompt', () => {
    const next = applyCompetitorCardPatch(card(), { title: '新主标题' }, { styleMode: 'strict' })
    expect(next.title).toBe('新主标题')
    expect(next.imagePrompt).toMatch(/新主标题/)
    expect(next.sellingPoint).toBe('结实')
  })

