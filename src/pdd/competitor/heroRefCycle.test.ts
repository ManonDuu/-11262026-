import { describe, expect, it } from 'vitest'
import {
  assessHeroMappingCompatibility,
  describeHeroCycleBinding,
  describeHeroReferenceForPrompt,
  expectedHeroRefForSlot,
  heroRefsInUploadOrder,
  heroSlotBindings,
} from './heroRefCycle'
import type { CompetitorCard } from './types'

describe('主图上传顺序循环映射', () => {
  it('按数组中的实际上传顺序取主图，不按文件名排序', () => {
    const refs = [
      { id: 'hero-z', category: 'hero' as const, assetName: 'hero-1.png' },
      { id: 'detail-1', category: 'detail' as const, assetName: 'a.png' },
      { id: 'hero-a', category: 'hero' as const, assetName: 'aaa.png' },
      { id: 'hero-m', category: 'hero' as const, assetName: 'hero-2.png' },
    ]
    expect(heroRefsInUploadOrder(refs).map((item) => item.id)).toEqual(['hero-z', 'hero-a', 'hero-m'])
  })

  it('3 张参考生成 5 张时按 1,2,3,1,2 循环', () => {
    const refs = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]
    expect(heroSlotBindings(refs, 5).map((item) => item.ref.id)).toEqual(['r1', 'r2', 'r3', 'r1', 'r2'])
    expect(heroSlotBindings(refs, 5).map((item) => item.round)).toEqual([1, 1, 1, 2, 2])
    expect(expectedHeroRefForSlot(refs, 3)?.id).toBe('r1')
    expect(heroSlotBindings(refs, 3).map((item) => item.ref.id)).toEqual(['r1', 'r2', 'r3'])
    expect(heroSlotBindings(refs, 1).map((item) => item.ref.id)).toEqual(['r1'])
    expect(heroSlotBindings(refs, 0)).toEqual([])
  })

  it('第二轮说明要求重新构图且不复用成品', () => {
    const text = describeHeroCycleBinding({ slotIndex: 3, round: 2, refOrdinal: 1, refCount: 3 })
    expect(text).toMatch(/第 4 张主图/)
    expect(text).toMatch(/第 1 张竞品主图/)
    expect(text).toMatch(/第 2 轮循环参考/)
    expect(text).toMatch(/不要复用上一轮已生成的成品/)
    expect(text).toMatch(/不要凭空捏造或虚构产品功能/)
  })

  it('已有成品绑定不一致时不会宣称已按新规则对位', () => {
    const refs = [{ id: 'hero-z', category: 'hero' as const }, { id: 'hero-a', category: 'hero' as const }]
    const cards = [
      { id: 'hero-1', category: 'hero' as const, refImageId: 'hero-a', status: 'done' as const, resultImageId: 'out-1' },
    ] as CompetitorCard[]
    const assessed = assessHeroMappingCompatibility(cards, refs, 2)
    expect(assessed.aligned).toBe(false)
    expect(assessed.note).toMatch(/不会按最新循环规则改写/)
    expect(assessed.note).toMatch(/不会按最新循环规则改写或宣称它们已按新顺序对位/)
    expect(assessed.note).not.toMatch(/已经按最新循环规则对位/)
    const prompt = describeHeroReferenceForPrompt(refs, cards[0], 0)
    expect(prompt).toMatch(/仍使用已绑定的参考图重绘/)
  })
})
