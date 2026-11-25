import { describe, expect, it } from 'vitest'
import { createOptionSlot } from './optionSlots'
import { buildPreviewCards, reconcilePreviewCards } from './preview'
import type { CompetitorCard, CompetitorRefImage } from './types'

function ref(partial: Partial<CompetitorRefImage> & Pick<CompetitorRefImage, 'id' | 'category'>): CompetitorRefImage {
  return {
    asset: { id: partial.id, imageId: partial.id, name: `${partial.id}.png`, width: 800, height: 800 },
    optionName: '',
    contentsNote: '',
    sellingPoint: '耐玩',
    sceneHint: '',
    layoutSummary: '',
    analysisStatus: 'user_filled',
    source: 'manual_import',
    ...partial,
  }
}

describe('预览方案', () => {
  it('不为缺失的选项套餐生成卡片', () => {
    const bound = ref({
      id: 'ref-opt-2',
      category: 'option',
      optionName: '加10个仿真塑料石头+2人仔',
      contentsNote: '挖掘机 1 只，仿真塑料石头 10 个，人仔 2 个',
    })
    const slots = [
      createOptionSlot({ optionName: '单独一只挖掘机' }),
      createOptionSlot({ optionName: bound.optionName, contentsNote: bound.contentsNote, boundRefId: bound.id }),
    ]
    const { cards, skippedMissingOptions } = buildPreviewCards({
      refs: [ref({ id: 'ref-hero', category: 'hero' }), bound],
      optionSlots: slots,
      styleMode: 'strict',
    })
    expect(cards.map((card) => card.category)).toEqual(['hero', 'option'])
    expect(cards[1].optionName).toBe('加10个仿真塑料石头+2人仔')
    expect(cards[1].imagePrompt).toMatch(/换另一处草坪/)
    expect(skippedMissingOptions).toBe(1)
  })
})

describe('详情预览按卖点分张', () => {
  it('两张竞品详情含三个卖点时生成三张详情卡，而不是两张或一张长图', () => {
    const { cards } = buildPreviewCards({
      refs: [
        ref({
          id: 'd1',
          category: 'detail',
          sellingPoint: '加厚合金臂',
          sellingPointCore: '加厚合金臂',
          analysisStatus: 'model_suggested',
          sellingPointClaims: [
            { id: 'sp-d1-1', core: '加厚合金臂', origin: 'competitor_reference', status: 'confirmed' },
            { id: 'sp-d1-2', core: '360度旋转', origin: 'competitor_reference', status: 'confirmed' },
          ],
        }),
        ref({
          id: 'd2',
          category: 'detail',
          sellingPoint: '一键破碎',
          sellingPointCore: '一键破碎',
          analysisStatus: 'model_suggested',
          sellingPointClaims: [
            { id: 'sp-d2-1', core: '一键破碎', origin: 'competitor_reference', status: 'confirmed' },
          ],
        }),
      ],
      optionSlots: [],
      styleMode: 'strict',
    })
    const details = cards.filter((card) => card.category === 'detail')
    expect(details).toHaveLength(3)
    expect(details.map((card) => card.sellingPoint)).toEqual(['加厚合金臂', '360度旋转', '一键破碎'])
    expect(details.every((card) => card.detailRenderMode === 'selling_point_pages')).toBe(true)
    expect(details.every((card) => card.imagePrompt.includes('本张须原样显示的卖点词原文'))).toBe(true)
    expect(details.some((card) => card.imagePrompt.includes('先生成一张连续的详情长条图'))).toBe(false)
  })
})


  it('跨原图卖点会把两边的原分图带进详情预览卡', () => {
    const { cards } = buildPreviewCards({
      refs: [
        ref({ id: 'detail-z', category: 'detail', sellingPoint: '旧文案', analysisStatus: 'model_suggested' }),
        ref({ id: 'detail-a', category: 'detail', sellingPoint: '另一张', analysisStatus: 'model_suggested' }),
      ],
      optionSlots: [],
      styleMode: 'strict',
      sellingPointBlocks: [{
        id: 'sp-cross',
        sellingPointText: '加厚合金臂',
        sourceRefIds: ['detail-z', 'detail-a'],
        globalYStart: 10,
        globalYEnd: 30,
        boundSource: 'semantic_analysis',
        uncertainBounds: false,
      }],
    })
    const details = cards.filter((card) => card.category === 'detail')
    expect(details).toHaveLength(1)
    expect(details[0].detailBlockId).toBe('sp-cross')
    expect(details[0].detailBlockSourceRefIds).toEqual(['detail-z', 'detail-a'])
    expect(details[0].refImageId).toBe('detail-z')
    expect(details[0].sellingPoint).toBe('加厚合金臂')
    expect(details[0].detailRenderMode).toBe('selling_point_pages')
  })

describe('主图预览按上传顺序循环', () => {
  it('参考少于目标张数时按上传顺序循环补卡，不按文件名重排', () => {
    const { cards } = buildPreviewCards({
      refs: [
        ref({ id: 'hero-z', category: 'hero', sellingPoint: '第一张卖点', asset: { id: 'hero-z', imageId: 'hero-z', name: 'zzz.png', width: 800, height: 800 } }),
        ref({ id: 'hero-a', category: 'hero', sellingPoint: '第二张卖点', asset: { id: 'hero-a', imageId: 'hero-a', name: 'aaa.png', width: 800, height: 800 } }),
        ref({ id: 'hero-m', category: 'hero', sellingPoint: '第三张卖点', asset: { id: 'hero-m', imageId: 'hero-m', name: 'mmm.png', width: 800, height: 800 } }),
        ref({ id: 'detail-1', category: 'detail' }),
      ],
      optionSlots: [],
      styleMode: 'strict',
      heroGenerateCount: 5,
    })
    const heroes = cards.filter((card) => card.category === 'hero')
    expect(heroes.map((card) => card.refImageId)).toEqual(['hero-z', 'hero-a', 'hero-m', 'hero-z', 'hero-a'])
    expect(heroes.map((card) => card.sellingPoint)).toEqual(['第一张卖点', '第二张卖点', '第三张卖点', '第一张卖点', '第二张卖点'])
    expect(heroes[3].heroCycleRound).toBe(2)
    expect(heroes[3].imagePrompt).toMatch(/第 2 轮循环参考/)
    expect(heroes[3].imagePrompt).toMatch(/不要复用上一轮已生成的成品/)
    expect(cards.filter((card) => card.category === 'detail').length).toBeGreaterThanOrEqual(0)
  })

  it('重建预览时保留已有主图成品和手改，并补上循环新卡', () => {
    const planned = buildPreviewCards({
      refs: [
        ref({ id: 'hero-z', category: 'hero', sellingPoint: '第一张卖点' }),
        ref({ id: 'hero-a', category: 'hero', sellingPoint: '第二张卖点' }),
      ],
      optionSlots: [],
      styleMode: 'strict',
      heroGenerateCount: 3,
    }).cards
    const existing: CompetitorCard[] = [
      {
        ...planned[0],
        id: 'keep-1',
        title: '手改标题',
        status: 'done',
        resultImageId: 'out-1',
        lastStructuredEditAt: 11,
      },
      {
        ...planned[1],
        id: 'idle-2',
        status: 'idle',
        resultImageId: null,
      },
    ]
    const merged = reconcilePreviewCards(existing, planned)
    const heroes = merged.filter((card) => card.category === 'hero')
    expect(heroes).toHaveLength(3)
    expect(heroes[0].id).toBe('keep-1')
    expect(heroes[0].title).toBe('手改标题')
    expect(heroes[0].resultImageId).toBe('out-1')
    expect(heroes[1].id).toBe('idle-2')
    expect(heroes[1].refImageId).toBe('hero-a')
    expect(heroes[2].refImageId).toBe('hero-z')
    expect(heroes[2].heroCycleRound).toBe(2)
    expect(heroes[2].status).toBe('idle')
    expect(heroes[2].resultImageId).toBeNull()
  })
})

