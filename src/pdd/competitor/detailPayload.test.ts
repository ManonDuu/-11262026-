import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectCompetitorGenerationInput } from './generation'
import { buildPreviewCards } from './preview'
import { buildCompetitorImagePrompt } from './promptBuild'
import { useCompetitorStore } from './store'
import type { CompetitorRefImage } from './types'
import { appendResolvedDetailConstraints, resolveDetailDirectives } from './detailOverrides'
import { DETAIL_GENERATION_RULES } from './detailPlan'

vi.mock('../../store', () => ({
  useStore: { getState: () => ({ settings: { model: '', apiMode: 'images' }, params: {}, setSettings: vi.fn(), setParams: vi.fn(), tasks: [], showToast: vi.fn() }) },
  submitTask: vi.fn(async () => {
    throw new Error('测试中禁止真实生图')
  }),
  waitForTaskSettled: vi.fn(),
}))

function detailRef(partial: Partial<CompetitorRefImage> & Pick<CompetitorRefImage, 'id'>): CompetitorRefImage {
  return {
    category: 'detail',
    asset: { id: partial.id, imageId: partial.id, name: `${partial.id}.png`, width: 800, height: 1000 },
    optionName: '',
    contentsNote: '',
    sellingPoint: '加厚合金臂',
    sellingPointCore: '加厚合金臂',
    sceneHint: '',
    layoutSummary: '上图下文',
    analysisStatus: 'model_suggested',
    source: 'manual_import',
    sellingPointClaims: [
      { id: `sp-${partial.id}-1`, core: '加厚合金臂', origin: 'competitor_reference', status: 'confirmed' },
    ],
    ...partial,
  }
}

function defaultRefs(): CompetitorRefImage[] {
  return [
    detailRef({ id: 'd1' }),
    detailRef({
      id: 'd2',
      sellingPoint: '360度旋转',
      sellingPointCore: '360度旋转',
      sellingPointClaims: [
        { id: 'sp-d2-1', core: '360度旋转', origin: 'competitor_reference', status: 'confirmed' },
      ],
    }),
  ]
}

function seedInspect(partial: {
  refs?: CompetitorRefImage[]
  detailSellingPointNote?: string
  detailStyleNote?: string
} = {}) {
  const refs = partial.refs || defaultRefs()
  const built = buildPreviewCards({
    refs,
    optionSlots: [],
    styleMode: 'strict',
    detailSellingPointNote: partial.detailSellingPointNote,
    detailStyleNote: partial.detailStyleNote,
  })
  useCompetitorStore.setState({
    session: {
      ...useCompetitorStore.getState().session,
      generationConfirmed: true,
      productAssets: [{ id: 'p1', imageId: 'p1', name: 'product.png' }],
      detailSellingPointNote: partial.detailSellingPointNote,
      detailStyleNote: partial.detailStyleNote,
      refs,
      cards: built.cards,
    },
  })
  return built
}

describe('详情页最终请求 payload', () => {
  beforeEach(() => {
    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        cards: [],
        refs: [],
        detailSellingPointNote: undefined,
        detailStyleNote: undefined,
        generationConfirmed: true,
        productAssets: [{ id: 'p1', imageId: 'p1', name: 'product.png' }],
      },
    })
  })

  it('全空默认：按卖点分张，payload 含卖点词原文、外形尺寸约束，且不是整长图', () => {
    const built = seedInspect()
    expect(built.cards.filter((card) => card.category === 'detail')).toHaveLength(2)
    expect(built.cards.every((card) => card.detailRenderMode !== 'long_strip')).toBe(true)
    const first = inspectCompetitorGenerationInput(built.cards[0].id).prompt
    const second = inspectCompetitorGenerationInput(built.cards[1].id).prompt
    expect(first).toContain('加厚合金臂')
    expect(first).toContain('本张须原样显示的卖点词原文')
    expect(first).not.toContain('不要照抄原句')
    expect(first).toMatch(/产品外形必须保持不变/)
    expect(first).toMatch(/已标注的尺寸、规格数值和单位必须保持不变/)
    expect(first).toMatch(/不要凭空/)
    expect(first).not.toMatch(/先生成一张连续的详情长条图/)
    expect(first).not.toMatch(/1280\s*[×x]\s*3840/)
    expect(second).toContain('360度旋转')
    expect(second).toContain('本张须原样显示的卖点词原文')
    expect(built.cards[0].frameSpec?.preset || built.cards[0].aspectRatio).toMatch(/3:4|9:16/)
  })

  it('仅风格覆盖：保留默认卖点词原文', () => {
    const built = seedInspect({ detailStyleNote: '留白多、大标题在上' })
    const prompt = inspectCompetitorGenerationInput(built.cards[0].id).prompt
    expect(prompt).toContain('加厚合金臂')
    expect(prompt).toContain('本张须原样显示的卖点词原文')
    expect(prompt).toContain('留白多、大标题在上')
    expect(prompt).toContain('用户已明确指定构图或风格')
    expect(prompt).not.toContain('用户已明确修改或指定卖点')
  })

  it('仅卖点覆盖：以用户原文为准，不把原卖点锁追加到尾部，并保留默认风格约束', () => {
    const built = seedInspect({ detailSellingPointNote: '强化钢臂' })
    expect(built.cards.filter((card) => card.category === 'detail').map((card) => card.sellingPoint)).toEqual(['强化钢臂'])
    const prompt = inspectCompetitorGenerationInput(built.cards[0].id).prompt
    expect(prompt).toContain('强化钢臂')
    expect(prompt).toContain('用户指定卖点词原文')
    expect(prompt).toContain('用户已明确修改或指定卖点')
    expect(prompt).not.toContain('本张须原样显示的卖点词原文（不得改写、近义替换或同义句改写）：加厚合金臂')
    expect(prompt).not.toMatch(/每个卖点事实必须保持不变/)
    expect(prompt).toMatch(/产品外形必须保持不变/)
    expect(prompt).toContain('默认构图风格规则')
  })

  it('两者都覆盖时互不吞掉，旧提示词尾部也不会再追加冲突的原卖点锁', () => {
    const built = seedInspect({
      detailSellingPointNote: '强化钢臂',
      detailStyleNote: '红黑配色',
    })
    const card = built.cards[0]
    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        cards: [{
          ...card,
          imagePrompt: '请按我改的强化钢臂来画，红黑配色',
          lastPromptEditAt: 200,
          lastStructuredEditAt: 100,
        }],
        detailSellingPointNote: '强化钢臂',
        detailStyleNote: '红黑配色',
      },
    })
    const prompt = inspectCompetitorGenerationInput(card.id).prompt
    expect(prompt).toContain('请按我改的强化钢臂来画，红黑配色')
    expect(prompt).toContain('强化钢臂')
    expect(prompt).toContain('红黑配色')
    expect(prompt).not.toMatch(/每个卖点事实必须保持不变/)
    expect(prompt).not.toMatch(/不要改回竞品原卖点.*加厚合金臂|本张须原样显示的卖点词原文（不得改写、近义替换或同义句改写）：加厚合金臂/)
    const stale = appendResolvedDetailConstraints(
      `旧稿\n${DETAIL_GENERATION_RULES}\n每个卖点事实必须保持不变`,
      resolveDetailDirectives({ userSellingPoint: '强化钢臂', userStyle: '红黑配色', competitorSellingPoints: ['加厚合金臂'] }),
    )
    expect(stale).toContain('强化钢臂')
    expect(stale).toContain('红黑配色')
    expect(stale).toContain('用户已明确修改或指定卖点')
    expect(stale).not.toMatch(/每个卖点事实必须保持不变/)
  })

  it('旧数据没有新字段时，仍按竞品卖点词原文进入 payload', () => {
    const refs = [detailRef({
      id: 'old',
      sellingPoint: '一键破碎',
      sellingPointCore: undefined,
      sellingPointClaims: undefined,
      analysisStatus: undefined,
    })]
    const built = seedInspect({ refs })
    expect(built.cards[0].sellingPoint).toBe('一键破碎')
    const prompt = inspectCompetitorGenerationInput(built.cards[0].id).prompt
    expect(prompt).toContain('一键破碎')
    expect(prompt).toContain('本张须原样显示的卖点词原文')
  })
})

describe('详情提示词直出', () => {
  it('默认详情请求要求原文，不走主图那套改写规则', () => {
    const prompt = buildCompetitorImagePrompt({
      category: 'detail',
      styleMode: 'strict',
      sellingPoint: '加厚合金臂',
      detailDirectives: resolveDetailDirectives({ competitorSellingPoints: ['加厚合金臂'], competitorStyle: '上图下文' }),
    })
    expect(prompt).toContain('加厚合金臂')
    expect(prompt).toContain('本张须原样显示的卖点词原文')
    expect(prompt).not.toContain('不要照抄原句')
    expect(prompt).toMatch(/不要生成一整张超长图再裁切/)
  })
})
