import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCompetitorQueue, generateCompetitorCard, inspectCompetitorGenerationInput } from './generation'
import { failedCardPatch } from '../promptSync'
import { useCompetitorStore } from './store'
import type { CompetitorCard } from './types'

vi.mock('../../store', () => ({
  useStore: { getState: () => ({ settings: { model: '', apiMode: 'images' }, params: {}, setSettings: vi.fn(), setParams: vi.fn(), tasks: [], showToast: vi.fn() }) },
  submitTask: vi.fn(async () => {
    throw new Error('测试中禁止真实生图')
  }),
  waitForTaskSettled: vi.fn(),
}))

vi.mock('../generationInputs', () => ({
  collectInputImages: vi.fn(async () => [{ id: 'img', dataUrl: 'data:image/png;base64,xx' }]),
}))

function seedCard(): CompetitorCard {
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
    imagePrompt: 'test',
    status: 'idle',
    category: 'hero',
    refImageId: 'ref-1',
    optionName: '',
    contentsNote: '',
    sellingPoint: '结实',
  }
}

describe('竞品参谋生图确认门闩', () => {
  beforeEach(() => {
    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        generationConfirmed: false,
        productAssets: [{ id: 'p1', imageId: 'p1', name: 'product.png' }],
        cards: [seedCard()],
      },
      queuePhase: 'idle',
      queuePaused: false,
      queueStopped: false,
    })
  })

  it('未确认预览时拒绝进入生图队列，不发起请求', async () => {
    await expect(runCompetitorQueue(['card-1'])).rejects.toThrow(/预览确认/)
    expect(useCompetitorStore.getState().queuePhase).toBe('idle')
  })

  it('未确认时单张生成也会被拦截', async () => {
    await expect(generateCompetitorCard('card-1')).rejects.toThrow(/预览确认/)
  })
})


describe('竞品参谋真实请求构造（mock，不发请求）', () => {
  it('只把自家产品图和该张竞品参考图作为输入，并把更新后的卖点写进最终 prompt', () => {
    const product = { id: 'prod', imageId: 'prod', name: 'product.png' }
    const refMatch = {
      id: 'ref-1',
      category: 'hero' as const,
      asset: { id: 'ref-img-1', imageId: 'ref-img-1', name: 'hero.png' },
      optionName: '',
      contentsNote: '',
      sellingPoint: '结实',
      sceneHint: '草坪',
      layoutSummary: '',
      analysisStatus: 'user_filled' as const,
      source: 'manual_import' as const,
    }
    const refOther = { ...refMatch, id: 'ref-2', asset: { id: 'ref-img-2', imageId: 'ref-img-2', name: 'other.png' } }
    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        generationConfirmed: true,
        styleMode: 'strict',
        productAssets: [product],
        refs: [refMatch, refOther],
        cards: [{
          id: 'card-1',
          index: 1,
          role: 'hero',
          aspectRatio: '1:1',
          frameSpec: { inputMode: 'preset', preset: '1:1', width: 1, height: 1 },
          title: '主图 1',
          subtitle: '',
          sceneSummary: '草坪',
          layoutSummary: '',
          imagePrompt: '旧提示',
          status: 'idle',
          category: 'hero',
          refImageId: 'ref-1',
          optionName: '',
          contentsNote: '',
          sellingPoint: '结实耐玩，适合户外',
        }],
      },
    })
    const inspected = inspectCompetitorGenerationInput('card-1')
    expect(inspected.assetIds).toEqual(['prod', 'ref-img-1'])
    expect(inspected.assetIds).not.toContain('ref-img-2')
    expect(inspected.prompt).toMatch(/结实耐玩，适合户外/)
    expect(inspected.prompt).toMatch(/不要照抄原句/)
    expect(inspected.prompt).toMatch(/模仿竞品风格并重新构图/)
    expect(inspected.prompt).toMatch(/产品和赠品/)
    expect(inspected.prompt).toMatch(/不要凭空捏造或虚构产品功能/)
    expect(inspected.prompt).not.toMatch(/本张须原样显示的卖点词原文/)
  })
})

  it('若最终 prompt 的手工修改更新，生成时保留手改全文而不用结构化字段重写', () => {
    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        generationConfirmed: true,
        productAssets: [{ id: 'prod', imageId: 'prod', name: 'product.png' }],
        refs: [{
          id: 'ref-1',
          category: 'hero',
          asset: { id: 'ref-img-1', imageId: 'ref-img-1', name: 'hero.png' },
          optionName: '',
          contentsNote: '',
          sellingPoint: '结实',
          sceneHint: '',
          layoutSummary: '',
          analysisStatus: 'user_filled',
          source: 'manual_import',
        }],
        cards: [{
          id: 'card-1',
          index: 1,
          role: 'hero',
          aspectRatio: '1:1',
          frameSpec: { inputMode: 'preset', preset: '1:1', width: 1, height: 1 },
          title: '主图 1',
          subtitle: '',
          sceneSummary: '',
          layoutSummary: '',
          imagePrompt: '用户手改的最终 Prompt',
          lastPromptEditAt: 500,
          lastStructuredEditAt: 100,
          status: 'idle',
          category: 'hero',
          refImageId: 'ref-1',
          optionName: '',
          contentsNote: '',
          sellingPoint: '结实',
        }],
      },
    })
    const inspected = inspectCompetitorGenerationInput('card-1')
    expect(inspected.prompt).toMatch(/用户手改的最终 Prompt/)
    expect(inspected.prompt).toMatch(/用户已明确指定主图风格/)
    expect(inspected.prompt).toMatch(/产品和赠品/)
    expect(inspected.prompt).toMatch(/不要凭空捏造或虚构产品功能/)
    expect(inspected.prompt).not.toMatch(/默认主图风格规则：/)
    expect(inspected.prompt).not.toMatch(/本张须原样显示的卖点词原文/)
  })


describe('跨原图卖点参考输入', () => {
  it('跨原图卖点生成时把两边参考图都作为输入，而不只是其中一张', () => {
    const product = { id: 'prod', imageId: 'prod', name: 'product.png' }
    const detailZ = {
      id: 'detail-z',
      category: 'detail' as const,
      asset: { id: 'img-z', imageId: 'img-z', name: 'z.png' },
      optionName: '',
      contentsNote: '',
      sellingPoint: '加厚合金臂',
      sceneHint: '',
      layoutSummary: '',
      analysisStatus: 'model_suggested' as const,
      source: 'manual_import' as const,
    }
    const detailA = { ...detailZ, id: 'detail-a', asset: { id: 'img-a', imageId: 'img-a', name: 'a.png' } }
    const card: CompetitorCard = {
      id: 'card-detail-1',
      index: 1,
      role: 'detail',
      aspectRatio: '3:4',
      frameSpec: { inputMode: 'preset', preset: '3:4', width: 3, height: 4 },
      title: '详情 1',
      subtitle: '',
      sceneSummary: '',
      layoutSummary: '',
      imagePrompt: 'test',
      status: 'idle',
      category: 'detail',
      refImageId: 'detail-z',
      optionName: '',
      contentsNote: '',
      sellingPoint: '加厚合金臂',
      detailRenderMode: 'selling_point_pages',
      detailBlockId: 'sp-cross',
      detailBlockSourceRefIds: ['detail-z', 'detail-a'],
    }
    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        generationConfirmed: true,
        productAssets: [product],
        refs: [detailZ, detailA],
        cards: [card],
      },
    })
    const inspected = inspectCompetitorGenerationInput('card-detail-1')
    expect(inspected.assetIds).toEqual(['prod', 'img-z', 'img-a'])
  })
})

describe('单张成品字段编辑进入重绘 payload', () => {
  it('用户编辑后的标题、场景、排版进入单张重绘 payload，其他卡不变', () => {
    const baseCard = seedCard()
    const other = { ...baseCard, id: 'card-2', title: '主图 2', sceneSummary: '仓库', layoutSummary: '左侧产品', resultImageId: 'result-2' }
    const current = { ...baseCard, resultImageId: 'result-1', sceneSummary: '草坪', layoutSummary: '居中' }
    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        generationConfirmed: true,
        styleMode: 'strict',
        productAssets: [{ id: 'prod', imageId: 'prod', name: 'product.png' }],
        refs: [{
          id: 'ref-1',
          category: 'hero',
          asset: { id: 'ref-img-1', imageId: 'ref-img-1', name: 'hero.png' },
          optionName: '',
          contentsNote: '',
          sellingPoint: '结实',
          sceneHint: '草坪',
          layoutSummary: '居中',
          analysisStatus: 'user_filled',
          source: 'manual_import',
        }],
        cards: [current, other],
      },
    })
    useCompetitorStore.getState().patchCard('card-1', { title: '新主标题', sceneSummary: '棚拍白底', layoutSummary: '产品居中' })
    const inspected = inspectCompetitorGenerationInput('card-1')
    expect(inspected.prompt).toMatch(/新主标题/)
    expect(inspected.prompt).toMatch(/棚拍白底/)
    expect(inspected.prompt).toMatch(/产品居中/)
    expect(inspectCompetitorGenerationInput('card-2').prompt).not.toMatch(/新主标题/)
    expect(inspectCompetitorGenerationInput('card-2').prompt).toMatch(/主图 2/)
    const saved = useCompetitorStore.getState().session.cards.find((item) => item.id === 'card-1')
    const untouched = useCompetitorStore.getState().session.cards.find((item) => item.id === 'card-2')
    expect(saved?.resultImageId).toBe('result-1')
    expect(untouched?.title).toBe('主图 2')
    expect(untouched?.resultImageId).toBe('result-2')
  })

  it('重绘失败时保留原成品图', () => {
    const current = { ...seedCard(), resultImageId: 'result-keep', status: 'done' as const }
    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        cards: [current],
      },
    })
    useCompetitorStore.getState().patchCard('card-1', failedCardPatch(current, '模型失败'))
    const after = useCompetitorStore.getState().session.cards.find((item) => item.id === 'card-1')
    expect(after?.status).toBe('error')
    expect(after?.resultImageId).toBe('result-keep')
    expect(after?.title).toBe('主图 1')
  })
})

describe('主图按上传顺序循环的请求构造', () => {
  it('第二轮循环参考的请求只带对应上传顺序的主图，prompt 要求重新构图且不复用成品', () => {
    const product = { id: 'prod', imageId: 'prod', name: 'product.png' }
    const makeRef = (id: string, name: string) => ({
      id,
      category: 'hero' as const,
      asset: { id, imageId: id, name },
      optionName: '',
      contentsNote: '',
      sellingPoint: `${id}-卖点`,
      sceneHint: '草坪',
      layoutSummary: '居中',
      analysisStatus: 'user_filled' as const,
      source: 'manual_import' as const,
    })
    const refs = [makeRef('hero-z', 'zzz.png'), makeRef('hero-a', 'aaa.png'), makeRef('hero-m', 'mmm.png')]
    const makeCard = (id: string, refImageId: string, index: number, round: number, ordinal: number): CompetitorCard => ({
      id,
      index,
      role: 'hero',
      aspectRatio: '1:1',
      frameSpec: { inputMode: 'preset', preset: '1:1', width: 1, height: 1 },
      title: `主图 ${index}`,
      subtitle: '',
      sceneSummary: '草坪',
      layoutSummary: '居中',
      imagePrompt: 'test',
      status: 'idle',
      category: 'hero',
      refImageId,
      optionName: '',
      contentsNote: '',
      sellingPoint: `${refImageId}-卖点`,
      heroSlotIndex: index - 1,
      heroCycleRound: round,
      heroRefOrdinal: ordinal,
      resultImageId: null,
    })
    const detailCard: CompetitorCard = {
      ...makeCard('detail-1', 'ref-detail', 6, 1, 1),
      role: 'detail',
      category: 'detail',
      sellingPoint: '加厚合金臂',
    }
    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        generationConfirmed: true,
        styleMode: 'strict',
        productAssets: [product],
        refs: [...refs, {
          id: 'ref-detail',
          category: 'detail',
          asset: { id: 'ref-detail', imageId: 'ref-detail', name: 'detail.png' },
          optionName: '',
          contentsNote: '',
          sellingPoint: '加厚合金臂',
          sceneHint: '',
          layoutSummary: '',
          analysisStatus: 'model_suggested',
          source: 'manual_import',
        }],
        cards: [
          makeCard('hero-1', 'hero-z', 1, 1, 1),
          makeCard('hero-2', 'hero-a', 2, 1, 2),
          makeCard('hero-3', 'hero-m', 3, 1, 3),
          makeCard('hero-4', 'hero-z', 4, 2, 1),
          makeCard('hero-5', 'hero-a', 5, 2, 2),
          detailCard,
        ],
      },
    })
    const fourth = inspectCompetitorGenerationInput('hero-4')
    expect(fourth.assetIds).toEqual(['prod', 'hero-z'])
    expect(fourth.assetIds).not.toContain('hero-a')
    expect(fourth.assetIds).not.toContain('hero-m')
    expect(fourth.prompt).toMatch(/第 2 轮循环参考/)
    expect(fourth.prompt).toMatch(/不要复用上一轮已生成的成品/)
    expect(fourth.prompt).toMatch(/hero-z-卖点/)
    expect(fourth.prompt).toMatch(/不要凭空捏造或虚构产品功能/)
    expect(fourth.prompt).toMatch(/实际上传顺序参考第 1 张竞品主图/)

    const fifth = inspectCompetitorGenerationInput('hero-5')
    expect(fifth.assetIds).toEqual(['prod', 'hero-a'])
    expect(fifth.prompt).toMatch(/实际上传顺序参考第 2 张竞品主图/)

    const first = inspectCompetitorGenerationInput('hero-1')
    expect(first.assetIds).toEqual(['prod', 'hero-z'])
    expect(first.prompt).not.toMatch(/第 2 轮循环参考/)

    const other = inspectCompetitorGenerationInput('hero-2')
    expect(other.assetIds).toEqual(['prod', 'hero-a'])
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'detail-1')?.refImageId).toBe('ref-detail')
  })

  it('单张重绘沿用该卡已绑定的参考图，不改绑其他主图或详情卡', () => {
    const current = useCompetitorStore.getState()
    const hero2 = current.session.cards.find((item) => item.id === 'hero-2')
    expect(hero2).toBeTruthy()
    const inspected = inspectCompetitorGenerationInput('hero-2')
    expect(inspected.assetIds).toEqual(['prod', 'hero-a'])
    expect(current.session.cards.find((item) => item.id === 'hero-4')?.refImageId).toBe('hero-z')
    expect(current.session.cards.find((item) => item.id === 'detail-1')?.sellingPoint).toBe('加厚合金臂')
  })
})

