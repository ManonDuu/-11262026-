// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => new Map<string, string>())

vi.mock('../../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db')>()
  return {
    ...actual,
    storeImageWithSize: vi.fn(async (dataUrl: string) => {
      const id = `mem-${memory.size + 1}`
      memory.set(id, dataUrl)
      return { id, width: 16, height: 16 }
    }),
    getImage: vi.fn(async (id: string) => {
      const dataUrl = memory.get(id)
      return dataUrl ? { id, dataUrl, createdAt: 1, source: 'upload' as const } : undefined
    }),
    getImageThumbnail: vi.fn(async (id: string) => {
      const dataUrl = memory.get(id)
      return dataUrl ? { id, thumbnailDataUrl: dataUrl, width: 16, height: 16, thumbnailVersion: 1 } : undefined
    }),
    getImageDimensions: vi.fn(async () => ({ width: 16, height: 16 })),
  }
})

import { DEFAULT_SETTINGS } from '../../lib/apiProfiles'
import { useStore } from '../../store'
import { setSharedWorkbenchModels } from '../sharedModels'
import { usePddStore } from '../store'
import { filterRefsForAnalysis, inspectCompetitorAnalysisInput, requestCompetitorAnalysis } from './analyze'
import type { DetailSellingPointBlock } from './detailSellingPointBlocks'
import { useCompetitorStore } from './store'
import type { CompetitorCard, CompetitorRefImage } from './types'
import CompetitorWorkbench from './CompetitorWorkbench'

const PERSIST_KEY = 'pdd-competitor-advisor-session'
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY2kAAAAASUVORK5CYII='

function ref(id: string, category: CompetitorRefImage['category'], optionName = ''): CompetitorRefImage {
  return {
    id,
    category,
    asset: { id, imageId: id, name: `${id}.png`, width: 64, height: 64, dataUrl: PNG_DATA_URL },
    optionName,
    contentsNote: optionName ? '配件说明' : '',
    sellingPoint: category === 'detail' ? '加厚合金臂' : '结实',
    sceneHint: '草坪',
    layoutSummary: '居中',
    analysisStatus: category === 'detail' ? 'model_suggested' : 'pending',
    source: 'manual_import',
    sellingPointCore: category === 'detail' ? '加厚合金臂' : '',
  }
}

function card(partial: Partial<CompetitorCard> & Pick<CompetitorCard, 'id' | 'category'>): CompetitorCard {
  return {
    index: 1,
    role: partial.category === 'hero' ? 'hero' : partial.category === 'detail' ? 'detail' : 'selling_point',
    aspectRatio: '1:1',
    frameSpec: { inputMode: 'preset', preset: '1:1', width: 1, height: 1 },
    title: partial.title ?? partial.id,
    subtitle: '',
    sceneSummary: '草坪',
    layoutSummary: '居中',
    imagePrompt: `prompt-${partial.id}`,
    status: 'done',
    error: null,
    taskId: `task-${partial.id}`,
    resultImageId: `result-${partial.id}`,
    refImageId: partial.refImageId ?? `ref-${partial.category}`,
    optionName: partial.optionName ?? '',
    contentsNote: '',
    sellingPoint: '结实',
    lastStructuredEditAt: 9,
    ...partial,
  }
}

const detailBlock: DetailSellingPointBlock = {
  id: 'block-1',
  sellingPointText: '加厚合金臂',
  sourceRefIds: ['detail-1'],
  globalYStart: 0,
  globalYEnd: 64,
  uncertainBounds: false,
  boundSource: 'semantic_analysis',
}

function seed() {
  const current = useCompetitorStore.getState().session
  useCompetitorStore.setState({
    session: {
      ...current,
      id: 't196-analyze-split',
      productName: '测试挖掘机',
      productFactsNote: '自家外形以产品图为准',
      generationConfirmed: true,
      productAssets: [{ id: 'prod', imageId: 'prod', name: 'product.png', dataUrl: PNG_DATA_URL }],
      refs: [
        ref('hero-z', 'hero'),
        ref('hero-a', 'hero'),
        ref('detail-1', 'detail'),
        ref('option-1', 'option', '单独一只挖掘机'),
      ],
      optionSlots: [{ id: 'slot-1', optionName: '单独一只挖掘机', contentsNote: '配件说明', boundRefId: 'option-1', missing: false }],
      detailSellingPointBlocks: [detailBlock],
      cards: [
        card({ id: 'hero-1', category: 'hero', refImageId: 'hero-z', title: '手改主图标题' }),
        card({ id: 'detail-1', category: 'detail', refImageId: 'detail-1', sellingPoint: '加厚合金臂' }),
        card({ id: 'option-1', category: 'option', refImageId: 'option-1', optionName: '单独一只挖掘机' }),
      ],
      lastAnalysisError: null,
    },
  })
  usePddStore.setState({ planningModel: 'unit-planning', imageModel: 'unit-image-model', detected: null })
  setSharedWorkbenchModels('unit-planning', 'unit-image-model')
  useStore.setState({
    settings: { ...DEFAULT_SETTINGS, baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'unit-test-key-not-a-real-secret', model: 'unit-planning' },
  })
  memory.clear()
  for (const item of useCompetitorStore.getState().session.refs) {
    const dataUrl = item.asset.dataUrl
    if (dataUrl) memory.set(item.asset.imageId || item.asset.id, dataUrl)
  }
  const product = useCompetitorStore.getState().session.productAssets[0]
  if (product?.dataUrl) memory.set(product.imageId || product.id, product.dataUrl)
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function waitUntil(predicate: () => boolean, tries = 50) {
  for (let index = 0; index < tries; index += 1) {
    if (predicate()) return
    await flush()
  }
  throw new Error('等待条件超时')
}

function parseRequest(init?: RequestInit) {
  const body = init?.body ? JSON.parse(String(init.body)) as { model?: string; messages?: Array<{ content?: unknown }> } : {}
  const userContent = body.messages?.find((item) => Array.isArray(item.content))?.content
  const parts = Array.isArray(userContent) ? userContent : []
  const prompt = String((parts.find((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text') as { text?: string } | undefined)?.text || '')
  const imageRefIdsFromParts = parts
    .filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'image_url')
    .map((part) => (part as { refId?: string }).refId)
    .filter((id): id is string => Boolean(id))
  const imageRefIdsFromPrompt = [...prompt.matchAll(/refId=([^\s，。；]+)/g)].map((match) => match[1])
  return {
    model: body.model,
    prompt,
    imageRefIds: imageRefIdsFromParts.length ? imageRefIdsFromParts : imageRefIdsFromPrompt,
    imageCount: parts.filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'image_url').length,
  }
}

function mockAnalysisFetch(onBody: (body: ReturnType<typeof parseRequest>) => void, ok = true) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const parsed = parseRequest(init)
    onBody(parsed)
    if (!ok) return new Response(JSON.stringify({ error: 'upstream' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    const refIds = parsed.imageRefIds.length ? parsed.imageRefIds : parsed.prompt.match(/refId=([^\s，。；]+)/g)?.map((item) => item.replace('refId=', '')) || []
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ results: refIds.map((refId) => ({ refId, sellingPointCopy: `新卖点-${refId}`, sceneCategory: '棚拍', layoutSummary: '新排版', warnings: [] })) }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

describe('按类别分析按钮与合并', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.removeItem(PERSIST_KEY)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    seed()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (root) await act(async () => { root.unmount() })
    container?.remove()
    localStorage.removeItem(PERSIST_KEY)
  })

  it('store 合并主图分析时保留详情卖点块、选项绑定、手改和成品', () => {
    useCompetitorStore.getState().applyAnalysisSuggestions([
      { refId: 'hero-z', sellingPointCore: '新卖点-hero-z', sellingPointCopy: '新卖点-hero-z', sceneCategory: '棚拍', layoutSummary: '新排版', optionName: '', contentsNote: '', warnings: [] },
      { refId: 'detail-1', sellingPointCore: '不应写入详情', sellingPointCopy: '不应写入详情', sceneCategory: '棚拍', layoutSummary: '新排版', optionName: '', contentsNote: '', warnings: [] },
    ], {
      category: 'hero',
      sellingPointBlocks: [{
        id: 'should-not',
        sellingPointText: '不应替换',
        sourceRefIds: ['detail-1'],
        globalYStart: 0,
        globalYEnd: 10,
        uncertainBounds: false,
        boundSource: 'semantic_analysis',
      }],
    })
    const after = useCompetitorStore.getState().session
    expect(after.refs.find((item) => item.id === 'hero-z')?.sellingPoint).toBe('新卖点-hero-z')
    expect(after.refs.find((item) => item.id === 'detail-1')?.sellingPoint).toBe('加厚合金臂')
    expect(after.detailSellingPointBlocks?.[0]?.sellingPointText).toBe('加厚合金臂')
    expect(after.optionSlots[0].boundRefId).toBe('option-1')
    expect(after.cards.find((item) => item.id === 'hero-1')?.title).toBe('手改主图标题')
    expect(after.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBe('result-hero-1')
    expect(after.cards).toHaveLength(3)
  })

  it('三个按钮分别只发送对应类别图片和任务', async () => {
    const captured: Array<ReturnType<typeof parseRequest>> = []
    vi.stubGlobal('fetch', mockAnalysisFetch((body) => captured.push(body)))
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()
    expect(container.querySelector('[data-testid="competitor-analyze-hero"]')?.textContent).toMatch(/分析主图/)
    expect(container.querySelector('[data-testid="competitor-analyze-detail"]')?.textContent).toMatch(/分析详情页/)
    expect(container.querySelector('[data-testid="competitor-analyze-option"]')?.textContent).toMatch(/分析选项图/)

    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-hero"]')?.click() })
    await waitUntil(() => captured.length === 1)
    expect(captured[0].imageCount).toBe(2)
    expect(captured[0].imageRefIds).toEqual(['hero-z', 'hero-a'])
    expect(captured[0].prompt).toMatch(/本次只分析「主图」/)
    expect(captured[0].prompt).not.toMatch(/refId=detail-1/)
    expect(captured[0].prompt).not.toMatch(/类别=详情图/)
    expect(inspectCompetitorAnalysisInput({ refs: useCompetitorStore.getState().session.refs, category: 'hero' }).refIds).toEqual(['hero-z', 'hero-a'])
    await waitUntil(() => Boolean(useCompetitorStore.getState().session.refs.find((item) => item.id === 'hero-z')?.sellingPoint?.includes('新卖点-hero-z')))

    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-option"]')?.click() })
    await waitUntil(() => captured.length === 2)
    expect(captured[1].imageRefIds).toEqual(['option-1'])
    expect(captured[1].prompt).toMatch(/本次只分析「选项图」/)
    expect(useCompetitorStore.getState().session.optionSlots[0].boundRefId).toBe('option-1')
  })

  it('只分析主图时保留详情卖点块、选项绑定、手改和成品，刷新后仍在', async () => {
    const captured: Array<ReturnType<typeof parseRequest>> = []
    vi.stubGlobal('fetch', mockAnalysisFetch((body) => captured.push(body)))
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()
    const before = useCompetitorStore.getState().session
    const detailPoint = before.refs.find((item) => item.id === 'detail-1')?.sellingPoint
    const optionName = before.refs.find((item) => item.id === 'option-1')?.optionName
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-hero"]')?.click() })
    await waitUntil(() => Boolean(useCompetitorStore.getState().session.refs.find((item) => item.id === 'hero-z')?.sellingPoint?.includes('新卖点-hero-z')))
    const after = useCompetitorStore.getState().session
    expect(after.refs.find((item) => item.id === 'detail-1')?.sellingPoint).toBe(detailPoint)
    expect(after.refs.find((item) => item.id === 'option-1')?.optionName).toBe(optionName)
    expect(after.detailSellingPointBlocks?.[0]?.sellingPointText).toBe('加厚合金臂')
    expect(after.optionSlots[0].boundRefId).toBe('option-1')
    expect(after.cards.find((item) => item.id === 'hero-1')?.title).toBe('手改主图标题')
    expect(after.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBe('result-hero-1')
    expect(after.cards.find((item) => item.id === 'detail-1')?.resultImageId).toBe('result-detail-1')
    expect(filterRefsForAnalysis(after.refs, 'hero').map((item) => item.id)).toEqual(['hero-z', 'hero-a'])

    const snapshot = localStorage.getItem(PERSIST_KEY)
    expect(snapshot).toBeTruthy()
    const persisted = JSON.parse(snapshot || '{}')
    expect(persisted.state.session.refs.find((item: CompetitorRefImage) => item.id === 'hero-z')?.sellingPoint).toMatch(/新卖点-hero-z/)
    expect(persisted.state.session.detailSellingPointBlocks[0].sellingPointText).toBe('加厚合金臂')
    expect(persisted.state.session.cards.find((item: CompetitorCard) => item.id === 'hero-1')?.title).toBe('手改主图标题')

    useCompetitorStore.setState({
      session: { ...after, refs: after.refs.map((item) => ({ ...item, sellingPoint: '被清空' })), cards: [], detailSellingPointBlocks: [] },
    })
    localStorage.setItem(PERSIST_KEY, snapshot!)
    await act(async () => { await useCompetitorStore.persist.rehydrate() })
    const restored = useCompetitorStore.getState().session
    expect(restored.refs.find((item) => item.id === 'hero-z')?.sellingPoint).toMatch(/新卖点-hero-z/)
    expect(restored.refs.find((item) => item.id === 'detail-1')?.sellingPoint).toBe('加厚合金臂')
    expect(restored.cards.find((item) => item.id === 'hero-1')?.title).toBe('手改主图标题')
    expect(restored.detailSellingPointBlocks?.[0]?.sellingPointText).toBe('加厚合金臂')
  })

  it('分析失败时保留已有分析、成品和手改，错误标明当前类别；进行中不能串扰', async () => {
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => { release = resolve })
    const fetchMock = vi.fn(async () => {
      await pending
      return new Response(JSON.stringify({ error: 'upstream' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-hero"]')?.click() })
    await waitUntil(() => Boolean(container.querySelector('[data-testid="competitor-analyze-progress"]')?.textContent?.includes('正在分析主图')))
    expect((container.querySelector('[data-testid="competitor-analyze-detail"]') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-detail"]')?.click() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release()
    await waitUntil(() => Boolean(container.querySelector('[data-testid="competitor-analyze-error"]')))
    expect(container.querySelector('[data-testid="competitor-analyze-error"]')?.textContent).toMatch(/主图/)
    const after = useCompetitorStore.getState().session
    expect(after.refs.find((item) => item.id === 'detail-1')?.sellingPoint).toBe('加厚合金臂')
    expect(after.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBe('result-hero-1')
    expect(after.cards.find((item) => item.id === 'hero-1')?.title).toBe('手改主图标题')
    expect(after.lastAnalysisError?.category).toBe('hero')
    expect(after.lastAnalysisError?.message).toMatch(/主图/)
  })

  it('无对应图时按钮禁用且不发请求；先分析一类后仍可本地预览', async () => {
    const state = useCompetitorStore.getState()
    useCompetitorStore.setState({
      session: {
        ...state.session,
        refs: state.session.refs.filter((item) => item.category !== 'option'),
        optionSlots: [],
      },
    })
    const fetchMock = mockAnalysisFetch(() => {})
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()
    expect((container.querySelector('[data-testid="competitor-analyze-option"]') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-option"]')?.click() })
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-hero"]')?.click() })
    await waitUntil(() => fetchMock.mock.calls.length === 1)
    const previewBtn = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('用已填内容生成本地预览'))
    expect(previewBtn).toBeTruthy()
    expect(previewBtn?.disabled).toBe(false)
    await act(async () => { previewBtn?.click() })
    await flush()
    expect(useCompetitorStore.getState().session.cards.some((item) => item.category === 'hero')).toBe(true)
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')?.title).toBe('手改主图标题')
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBe('result-hero-1')
  })
})

describe('按类别请求隔离（拦截 fetch，不发真实模型）', () => {
  it('选项分析仅发送本类图与对应套餐要求，观察清单不冒充用户新物真实外形', async () => {
    useStore.setState({settings:{...DEFAULT_SETTINGS,baseUrl:'http://127.0.0.1:9/v1',apiKey:'unit-test-key-not-a-real-secret'}})
    const captured: Array<ReturnType<typeof parseRequest>> = []
    vi.stubGlobal('fetch',mockAnalysisFetch(body=>captured.push(body)))
    try {
      const result=await requestCompetitorAnalysis({planningModel:'unit-planning',productName:'测试产品',category:'option',
        refs:[ref('hero-x','hero'),ref('detail-x','detail'),ref('opt-z','option'),ref('opt-a','option')],
        optionSlots:[{id:'s1',optionName:'甲',contentsNote:'车两辆并加收纳箱',boundRefId:'opt-z',missing:false},
          {id:'s2',optionName:'乙',contentsNote:'',boundRefId:'opt-a',missing:false},
          {id:'s3',optionName:'不可发送',contentsNote:'绝不可串入',boundRefId:'hero-x',missing:false}]})
      expect(result.ok).toBe(true)
      expect(captured[0].imageRefIds).toEqual(['opt-z','opt-a'])
      expect(captured[0].prompt).toContain('refId=opt-z：车两辆并加收纳箱')
      expect(captured[0].prompt).not.toContain('绝不可串入')
      expect(captured[0].prompt).not.toContain('refId=detail-x')
      expect(captured[0].prompt).toContain('不得伪称参考图已出现未见物品')
    } finally {vi.unstubAllGlobals()}
  })

  it('requestCompetitorAnalysis({category:hero}) 不把详情或选项图送出', async () => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'unit-test-key-not-a-real-secret', model: 'unit-planning' },
    })
    const refs = [
      ref('hero-z', 'hero'),
      ref('detail-1', 'detail'),
      ref('option-1', 'option', '单独一只挖掘机'),
    ]
    const captured: string[][] = []
    vi.stubGlobal('fetch', mockAnalysisFetch((body) => captured.push(body.imageRefIds)))
    const result = await requestCompetitorAnalysis({
      planningModel: 'unit-planning',
      productName: '测试挖掘机',
      refs,
      category: 'hero',
    })
    expect(result.ok).toBe(true)
    expect(captured[0]).toEqual(['hero-z'])
    if (!result.ok || !result.results) throw new Error('分析请求应成功')
    expect(result.results.every((item) => item.refId === 'hero-z')).toBe(true)
    vi.unstubAllGlobals()
  })
})
