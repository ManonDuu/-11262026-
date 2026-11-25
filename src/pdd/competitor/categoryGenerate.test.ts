import { describe, expect, it } from 'vitest'
import { prepareCategoryGeneration } from './categoryGenerate'
import type { CompetitorCard, CompetitorRefImage, CompetitorSession } from './types'

function ref(id: string, category: CompetitorRefImage['category'], optionName = ''): CompetitorRefImage {
  return {
    id,
    category,
    asset: { id, imageId: id, name: `${id}.png` },
    optionName,
    contentsNote: optionName ? '配件说明' : '',
    sellingPoint: '结实',
    sceneHint: '草坪',
    layoutSummary: '居中',
    analysisStatus: 'user_filled',
    source: 'manual_import',
  }
}

function card(partial: Partial<CompetitorCard> & Pick<CompetitorCard, 'id' | 'category'>): CompetitorCard {
  return {
    index: 1,
    role: partial.category === 'hero' ? 'hero' : partial.category === 'detail' ? 'detail' : 'selling_point',
    aspectRatio: '1:1',
    frameSpec: { inputMode: 'preset', preset: '1:1', width: 1, height: 1 },
    title: partial.title || partial.id,
    subtitle: '',
    sceneSummary: '草坪',
    layoutSummary: '居中',
    imagePrompt: `prompt-${partial.id}`,
    status: 'idle',
    error: null,
    taskId: null,
    resultImageId: null,
    refImageId: `ref-${partial.category}`,
    optionName: '',
    contentsNote: '',
    sellingPoint: '结实',
    ...partial,
  }
}

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
    productName: '挖掘机',
    styleMode: 'strict',
    productAssets: [{ id: 'prod', imageId: 'prod', name: 'product.png' }],
    refs: [ref('ref-hero', 'hero'), ref('ref-detail', 'detail'), ref('ref-option', 'option', '单独一只挖掘机')],
    optionSlots: [],
    cards: [
      card({ id: 'hero-1', category: 'hero', refImageId: 'ref-hero' }),
      card({ id: 'detail-1', category: 'detail', refImageId: 'ref-detail', title: '详情 1' }),
      card({ id: 'option-1', category: 'option', refImageId: 'ref-option', optionName: '单独一只挖掘机', title: '单独一只挖掘机' }),
    ],
    generationConfirmed: true,
    planningError: null,
    ...partial,
  }
}

describe('按类别准备生图任务', () => {
  it('主图数量 1 和 3 只入队主图，单张参考循环补卡并重新构图', () => {
    const one = prepareCategoryGeneration(session(), 'hero', 1)
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(one.cardIds).toEqual(['hero-1'])
    expect(one.cardsToAdd).toEqual([])

    const three = prepareCategoryGeneration(session(), 'hero', 3)
    expect(three.ok).toBe(true)
    if (!three.ok) return
    expect(three.cardIds).toHaveLength(3)
    expect(three.cardIds[0]).toBe('hero-1')
    expect(three.cardsToAdd).toHaveLength(2)
    expect(three.cardsToAdd.every((item) => item.category === 'hero')).toBe(true)
    expect(three.cardsToAdd.every((item) => item.refImageId === 'ref-hero')).toBe(true)
    expect(three.cardsToAdd.every((item) => item.status === 'idle' && !item.resultImageId)).toBe(true)
    expect(three.cardsToAdd[0].imagePrompt).toMatch(/第 2 轮循环参考/)
    expect(three.cardsToAdd[1].imagePrompt).toMatch(/第 3 轮循环参考/)
    expect(three.cardsToAdd.every((item) => item.imagePrompt !== 'prompt-hero-1')).toBe(true)
    expect(three.cardsToAdd.every((item) => !item.resultImageId)).toBe(true)
    expect(new Set(three.cardIds).size).toBe(3)
  })

  it('多张竞品主图按上传顺序循环绑定，3 张参考生成 5 张为 1,2,3,1,2，且不按文件名排序', () => {
    const refs = [
      ref('hero-z', 'hero'),
      ref('hero-a', 'hero'),
      ref('hero-m', 'hero'),
      ref('ref-detail', 'detail'),
      ref('ref-option', 'option', '单独一只挖掘机'),
    ]
    const current = session({
      refs,
      cards: [
        card({ id: 'hero-1', category: 'hero', index: 1, refImageId: 'hero-z', title: '主图 1' }),
        card({ id: 'hero-2', category: 'hero', index: 2, refImageId: 'hero-a', title: '主图 2' }),
        card({ id: 'hero-3', category: 'hero', index: 3, refImageId: 'hero-m', title: '主图 3' }),
        card({ id: 'detail-1', category: 'detail', refImageId: 'ref-detail', title: '详情 1' }),
        card({ id: 'option-1', category: 'option', refImageId: 'ref-option', optionName: '单独一只挖掘机', title: '单独一只挖掘机' }),
      ],
    })
    const result = prepareCategoryGeneration(current, 'hero', 5)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cardIds.slice(0, 3)).toEqual(['hero-1', 'hero-2', 'hero-3'])
    expect(result.cardsToAdd).toHaveLength(2)
    expect(result.cardsToAdd.map((item) => item.refImageId)).toEqual(['hero-z', 'hero-a'])
    expect(result.cardsToAdd[0].heroCycleRound).toBe(2)
    expect(result.cardsToAdd[0].heroRefOrdinal).toBe(1)
    expect(result.cardsToAdd[1].heroRefOrdinal).toBe(2)
    expect(result.cardsToAdd[0].imagePrompt).toMatch(/第 2 轮循环参考/)
    expect(result.cardsToAdd[0].imagePrompt).toMatch(/不要复用上一轮已生成的成品/)
    expect(current.cards.find((item) => item.id === 'detail-1')?.refImageId).toBe('ref-detail')
    expect(current.cards.find((item) => item.id === 'option-1')?.optionName).toBe('单独一只挖掘机')
  })

  it('增加主图数量时保留已有成品和手改，只补后续循环卡', () => {
    const refs = [ref('hero-z', 'hero'), ref('hero-a', 'hero'), ref('hero-m', 'hero')]
    const current = session({
      refs,
      cards: [
        card({ id: 'hero-1', category: 'hero', index: 1, refImageId: 'hero-z', status: 'done', resultImageId: 'out-1', title: '已改标题', lastStructuredEditAt: 9, sellingPoint: '手改卖点', sellingPointSource: 'user_specified' }),
        card({ id: 'hero-2', category: 'hero', index: 2, refImageId: 'hero-a' }),
        card({ id: 'hero-3', category: 'hero', index: 3, refImageId: 'hero-m' }),
        card({ id: 'detail-1', category: 'detail', refImageId: 'ref-detail', title: '详情 1' }),
      ],
    })
    const result = prepareCategoryGeneration(current, 'hero', 5)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cardIds).not.toContain('hero-1')
    expect(result.cardIds).toEqual(expect.arrayContaining(['hero-2', 'hero-3']))
    expect(result.cardsToAdd).toHaveLength(2)
    expect(result.cardsToAdd.map((item) => item.refImageId)).toEqual(['hero-z', 'hero-a'])
    expect(current.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBe('out-1')
    expect(current.cards.find((item) => item.id === 'hero-1')?.title).toBe('已改标题')
    expect(current.cards.find((item) => item.id === 'hero-1')?.sellingPoint).toBe('手改卖点')
    expect(current.cards.find((item) => item.id === 'detail-1')?.refImageId).toBe('ref-detail')
  })

  it('详情页和选项图只选择各自类型，并保留套餐映射', () => {
    const detail = prepareCategoryGeneration(session(), 'detail')
    const option = prepareCategoryGeneration(session(), 'option')
    expect(detail.ok).toBe(true)
    expect(option.ok).toBe(true)
    if (!detail.ok || !option.ok) return
    expect(detail.cardIds).toEqual(['detail-1'])
    expect(option.cardIds).toEqual(['option-1'])
    expect(session().cards.find((item) => item.id === 'option-1')?.optionName).toBe('单独一只挖掘机')
  })

  it('已完成主图默认跳过且不会被删除；数量足够时不再入队', () => {
    const done = session({
      cards: [
        card({ id: 'hero-1', category: 'hero', status: 'done', resultImageId: 'out-1', imagePrompt: 'prompt-hero-1' }),
        card({ id: 'detail-1', category: 'detail', status: 'done', resultImageId: 'out-d' }),
      ],
    })
    const result = prepareCategoryGeneration(done, 'hero', 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cardIds).toEqual([])
    expect(result.cardsToAdd).toEqual([])
    expect(result.message).toMatch(/未重复生成/)
    expect(done.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBe('out-1')

    const more = prepareCategoryGeneration(done, 'hero', 3)
    expect(more.ok).toBe(true)
    if (!more.ok) return
    expect(more.cardIds).toHaveLength(2)
    expect(more.cardsToAdd).toHaveLength(2)
    expect(more.cardIds).not.toContain('hero-1')
  })

  it('缺少确认、产品图或预览时阻止提交', () => {
    expect(prepareCategoryGeneration(session({ generationConfirmed: false }), 'hero', 1).ok).toBe(false)
    expect(prepareCategoryGeneration(session({ productAssets: [] }), 'detail').ok).toBe(false)
    expect(prepareCategoryGeneration(session({ cards: [] }), 'detail').ok).toBe(false)
    expect(prepareCategoryGeneration(session({ cards: [], refs: [] }), 'hero', 1).ok).toBe(false)
  })

  it('旧的整长图详情方案会拒绝生成，避免误发超长图请求', () => {
    const result = prepareCategoryGeneration(session({
      cards: [
        card({ id: 'detail-1', category: 'detail', refImageId: 'ref-detail', title: '详情长图', detailRenderMode: 'long_strip' }),
      ],
    }), 'detail')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/按卖点分张/)
    expect(result.error).toMatch(/生成本地预览/)
  })

  it('按卖点分张的详情卡全部入队，不会合并成一次长图请求', () => {
    const result = prepareCategoryGeneration(session({
      cards: [
        card({ id: 'detail-a', category: 'detail', refImageId: 'ref-detail', title: '详情 1', detailRenderMode: 'selling_point_pages', sellingPoint: '加厚合金臂' }),
        card({ id: 'detail-b', category: 'detail', refImageId: 'ref-detail', title: '详情 2', detailRenderMode: 'selling_point_pages', sellingPoint: '360度旋转' }),
      ],
    }), 'detail')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cardIds).toEqual(['detail-a', 'detail-b'])
  })
})
