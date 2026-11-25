// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failedCardPatch } from '../promptSync'
import { inspectCompetitorGenerationInput } from './generation'
import GeneratedResults, {
  draftFromCompetitorResult,
  resultFieldPatchFromDraft,
} from './GeneratedResults'
import { useCompetitorStore } from './store'
import type { CompetitorCard, CompetitorRefImage } from './types'

// These are synthetic test images, not real paid-generation evidence.
import { syntheticResultPng as readEvidenceBytes } from './fixtures/syntheticPng'

function toPngDataUrl(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

function parsePng(bytes: Uint8Array) {
  expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = String.fromCharCode(...bytes.subarray(12, 16))
  expect(ihdr).toBe('IHDR')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    bytes: bytes.byteLength,
    width: view.getUint32(16),
    height: view.getUint32(20),
    contentType: 'image/png' as const,
    dataUrl: toPngDataUrl(bytes),
  }
}

const resultUrlById: Record<string, string> = {}
const loadImageDataUrl = vi.fn(async (id: string) => resultUrlById[id])
const { generateCompetitorCard } = vi.hoisted(() => ({
  generateCompetitorCard: vi.fn(async () => {}),
}))

vi.mock('../assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../assets')>()
  return {
    ...actual,
    loadImageDataUrl: (id: string) => loadImageDataUrl(id),
  }
})

vi.mock('../../lib/db', () => ({
  getImageDimensions: vi.fn(async () => ({ width: 1254, height: 1254 })),
  getImage: vi.fn(),
  getImageThumbnail: vi.fn(),
  storeImageWithSize: vi.fn(),
}))

vi.mock('./generation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generation')>()
  return {
    ...actual,
    generateCompetitorCard,
  }
})

vi.mock('../exportSet', () => ({
  downloadOriginalPng: vi.fn(async () => {}),
  downloadCustomSizePng: vi.fn(async () => {}),
  downloadGroupedZip: vi.fn(async () => 0),
  downloadCategoryZip: vi.fn(async () => 0),
}))

import CompetitorWorkbench from './CompetitorWorkbench'

const PERSIST_KEY = 'pdd-competitor-advisor-session'
const REF_HERO = 'data:image/png;base64,ref-hero-original'
const REF_DETAIL = 'data:image/png;base64,ref-detail-original'
const REF_OPTION = 'data:image/png;base64,ref-option-original'
const FIXTURE_DETAIL = 'data:image/png;base64,isolated-detail-fixture'
const FIXTURE_OPTION = 'data:image/png;base64,isolated-option-fixture'

function ref(id: string, category: CompetitorRefImage['category'], dataUrl: string, optionName = ''): CompetitorRefImage {
  return {
    id,
    category,
    asset: { id, imageId: id, name: `${id}.png`, dataUrl, thumbnailDataUrl: dataUrl },
    optionName,
    contentsNote: '',
    sellingPoint: category === 'detail' ? '加厚合金臂' : '结实',
    sceneHint: '草坪',
    layoutSummary: '居中',
    analysisStatus: 'model_suggested',
    source: 'manual_import',
  }
}

function card(partial: Partial<CompetitorCard> & Pick<CompetitorCard, 'id' | 'category'>): CompetitorCard {
  return {
    index: 1,
    role: partial.category === 'hero' ? 'hero' : partial.category === 'detail' ? 'detail' : 'selling_point',
    aspectRatio: '1:1',
    frameSpec: { inputMode: 'preset', preset: '1:1', width: 1, height: 1 },
    title: partial.title ?? `${partial.category} ${partial.index ?? 1}`,
    subtitle: '',
    sceneSummary: partial.sceneSummary ?? '草坪',
    layoutSummary: partial.layoutSummary ?? '居中',
    imagePrompt: `prompt-${partial.id}`,
    status: 'done',
    error: null,
    taskId: `task-${partial.id}`,
    resultImageId: `result-${partial.id}`,
    resultWidth: 1254,
    resultHeight: 1254,
    refImageId: `ref-${partial.category}`,
    optionName: partial.optionName ?? '',
    contentsNote: '',
    sellingPoint: partial.sellingPoint ?? (partial.category === 'detail' ? '加厚合金臂' : '结实'),
    sellingPointSource: 'competitor_reference',
    styleSource: 'competitor_reference',
    detailRenderMode: partial.category === 'detail' ? 'selling_point_pages' : undefined,
    ...partial,
  }
}

function seedSession(heroUrl: string, extras: CompetitorCard[] = []) {
  const current = useCompetitorStore.getState().session
  useCompetitorStore.setState({
    session: {
      ...current,
      id: 't194-result-field-edit',
      goodsId: null,
      canonicalUrl: null,
      parseMessage: '',
      captureCoverage: null,
      productName: '测试挖掘机',
      styleMode: 'strict',
      generationConfirmed: true,
      productAssets: [{ id: 'prod', imageId: 'prod', name: 'product.png' }],
      refs: [
        ref('ref-hero', 'hero', REF_HERO),
        ref('ref-detail', 'detail', REF_DETAIL),
        ref('ref-option', 'option', REF_OPTION, '单独一只挖掘机'),
      ],
      optionSlots: [],
      cards: [
        card({ id: 'hero-1', category: 'hero', index: 1, resultImageId: 'result-hero-1' }),
        card({ id: 'hero-2', category: 'hero', index: 2, title: '主图 2', resultImageId: 'result-hero-2', sceneSummary: '仓库', layoutSummary: '左侧产品' }),
        card({ id: 'detail-1', category: 'detail', index: 3, title: '详情 1', sellingPoint: '加厚合金臂' }),
        card({ id: 'option-1', category: 'option', index: 4, title: '选项 1', optionName: '单独一只挖掘机' }),
        card({
          id: 'legacy-1',
          category: 'hero',
          index: 5,
          title: '',
          sceneSummary: '',
          layoutSummary: '',
          sellingPoint: '',
          sellingPointSource: undefined,
          styleSource: undefined,
          lastStructuredEditAt: undefined,
          lastPromptEditAt: undefined,
          resultImageId: 'result-legacy-1',
        }),
        ...extras,
      ],
      heroGenerateCount: 2,
      planningError: null,
    },
    queuePhase: 'idle',
    queuePaused: false,
    queueStopped: false,
    queueCursor: 0,
    activeCardId: null,
    lightbox: null,
  })
  const urls = {
    'result-hero-1': heroUrl,
    'result-hero-2': heroUrl,
    'result-detail-1': FIXTURE_DETAIL,
    'result-option-1': FIXTURE_OPTION,
    'result-legacy-1': heroUrl,
  }
  Object.keys(resultUrlById).forEach((key) => { delete resultUrlById[key] })
  Object.assign(resultUrlById, urls)
  return urls
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function setFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = element instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function click(el: Element | null) {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('生成成品字段编辑', () => {
  let container: HTMLDivElement
  let root: Root
  let heroUrl: string
  let resultUrls: Record<string, string>

  beforeEach(() => {
    const png = parsePng(readEvidenceBytes('hero-result-1.png'))
    expect(png.bytes).toBeGreaterThan(0)
    expect(png.contentType).toBe('image/png')
    heroUrl = png.dataUrl
    generateCompetitorCard.mockReset()
    generateCompetitorCard.mockImplementation(async () => {})
    localStorage.removeItem(PERSIST_KEY)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    resultUrls = seedSession(heroUrl)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => { root.unmount() })
    }
    container?.remove()
    localStorage.removeItem(PERSIST_KEY)
  })

  it('仅提交实际改动的字段，避免误标卖点或风格来源', () => {
    const existing = card({ id: 'hero-1', category: 'hero', title: '主图 1', sellingPoint: '结实', sceneSummary: '草坪', layoutSummary: '居中' })
    expect(resultFieldPatchFromDraft(existing, { ...draftFromCompetitorResult(existing), sceneSummary: '棚拍' })).toEqual({ sceneSummary: '棚拍' })
    expect(resultFieldPatchFromDraft(existing, { ...draftFromCompetitorResult(existing), title: '新标题' })).toEqual({ title: '新标题' })
  })

  it('竞品参谋主图/详情/选项成品都有文案编辑入口，旧数据也可改', async () => {
    await act(async () => {
      root.render(<GeneratedResults cards={useCompetitorStore.getState().session.cards} resultUrls={resultUrls} onOpen={() => {}} />)
    })
    await flush()

    expect(container.querySelector('[data-testid="competitor-result-edit-hero-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-edit-title-hero-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-edit-text-hero-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-edit-scene-hero-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-edit-layout-hero-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-edit-hint-hero-1"]')?.textContent).toMatch(/不会改已生成图片的像素/)
    expect(container.querySelector('[data-testid="competitor-result-edit-hint-hero-1"]')?.textContent).toMatch(/重绘这张/)

    await click(container.querySelector('[data-testid="competitor-result-card-detail-1"]'))
    expect(container.querySelector('[data-testid="competitor-result-edit-detail-1"]')).not.toBeNull()
    expect((container.querySelector('[data-testid="competitor-result-edit-text-detail-1"]') as HTMLTextAreaElement).value).toBe('加厚合金臂')

    await click(container.querySelector('[data-testid="competitor-result-card-option-1"]'))
    expect(container.querySelector('[data-testid="competitor-result-edit-option-1"]')).not.toBeNull()

    await click(container.querySelector('[data-testid="competitor-result-card-legacy-1"]'))
    expect((container.querySelector('[data-testid="competitor-result-edit-title-legacy-1"]') as HTMLInputElement).value).toBe('')
    expect((container.querySelector('[data-testid="competitor-result-edit-scene-legacy-1"]') as HTMLTextAreaElement).value).toBe('')
    expect((container.querySelector('[data-testid="competitor-result-edit-layout-legacy-1"]') as HTMLTextAreaElement).value).toBe('')
  })

  it('工作台生成区也能找到当前成品的编辑入口', async () => {
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()
    expect(container.querySelector('[data-testid="competitor-result-edit-hero-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('src')).toBe(heroUrl)
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('src')).not.toBe(REF_HERO)
  })

  it('保存标题、图片文字、场景和排版后刷新可恢复，且不改其他卡或成品像素', async () => {
    function BoundResults() {
      const cards = useCompetitorStore((state) => state.session.cards)
      return <GeneratedResults cards={cards} resultUrls={resultUrls} onOpen={() => {}} />
    }
    await act(async () => { root.render(<BoundResults />) })
    await flush()

    await setFieldValue(container.querySelector('[data-testid="competitor-result-edit-title-hero-1"]') as HTMLInputElement, '新主标题')
    await setFieldValue(container.querySelector('[data-testid="competitor-result-edit-text-hero-1"]') as HTMLTextAreaElement, '结实耐摔')
    await setFieldValue(container.querySelector('[data-testid="competitor-result-edit-scene-hero-1"]') as HTMLTextAreaElement, '棚拍白底')
    await setFieldValue(container.querySelector('[data-testid="competitor-result-edit-layout-hero-1"]') as HTMLTextAreaElement, '产品居中，标题在上')
    expect(generateCompetitorCard).not.toHaveBeenCalled()
    const previewBefore = container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('src')
    expect(previewBefore).toBe(heroUrl)

    await click(container.querySelector('[data-testid="competitor-result-edit-save-hero-1"]'))
    await flush()
    expect(generateCompetitorCard).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="competitor-result-edit-saved-hero-1"]')?.textContent).toMatch(/图片尚未改动/)
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('src')).toBe(heroUrl)

    const hero1 = useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')
    const hero2 = useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-2')
    expect(hero1?.title).toBe('新主标题')
    expect(hero1?.sellingPoint).toBe('结实耐摔')
    expect(hero1?.sceneSummary).toBe('棚拍白底')
    expect(hero1?.layoutSummary).toBe('产品居中，标题在上')
    expect(hero1?.sellingPointSource).toBe('user_specified')
    expect(hero1?.styleSource).toBe('user_specified')
    expect(hero1?.resultImageId).toBe('result-hero-1')
    expect(hero1?.imagePrompt).toMatch(/新主标题/)
    expect(hero1?.imagePrompt).toMatch(/结实耐摔/)
    expect(hero1?.imagePrompt).toMatch(/棚拍白底/)
    expect(hero1?.imagePrompt).toMatch(/产品居中，标题在上/)
    expect(hero2?.title).toBe('主图 2')
    expect(hero2?.sceneSummary).toBe('仓库')
    expect(hero2?.layoutSummary).toBe('左侧产品')
    expect(hero2?.sellingPoint).toBe('结实')
    expect(hero2?.resultImageId).toBe('result-hero-2')

    const snapshot = localStorage.getItem(PERSIST_KEY)
    expect(snapshot).toBeTruthy()
    const persisted = JSON.parse(snapshot || '{}')
    const persistedHero = persisted.state.session.cards.find((item: CompetitorCard) => item.id === 'hero-1')
    expect(persistedHero.title).toBe('新主标题')
    expect(persistedHero.sceneSummary).toBe('棚拍白底')
    expect(persistedHero.layoutSummary).toBe('产品居中，标题在上')
    expect(persistedHero.sellingPoint).toBe('结实耐摔')
    expect(persistedHero.resultImageId).toBe('result-hero-1')

    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        cards: useCompetitorStore.getState().session.cards.map((item) => (
          item.id === 'hero-1' ? { ...item, title: '被清空', sellingPoint: '被清空', sceneSummary: '', layoutSummary: '' } : item
        )),
      },
    })
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')?.title).toBe('被清空')
    localStorage.setItem(PERSIST_KEY, snapshot!)
    await act(async () => { await useCompetitorStore.persist.rehydrate() })
    const restored = useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')
    expect(restored?.title).toBe('新主标题')
    expect(restored?.sellingPoint).toBe('结实耐摔')
    expect(restored?.sceneSummary).toBe('棚拍白底')
    expect(restored?.layoutSummary).toBe('产品居中，标题在上')
    expect(restored?.resultImageId).toBe('result-hero-1')
  })

  it('仅改场景和排版时不改卖点，单张重绘拦截请求包含新文案且不改其他图', async () => {
    function BoundResults() {
      const cards = useCompetitorStore((state) => state.session.cards)
      return <GeneratedResults cards={cards} resultUrls={resultUrls} onOpen={() => {}} />
    }
    await act(async () => { root.render(<BoundResults />) })
    await flush()

    await click(container.querySelector('[data-testid="competitor-result-card-detail-1"]'))
    await setFieldValue(container.querySelector('[data-testid="competitor-result-edit-scene-detail-1"]') as HTMLTextAreaElement, '车间特写')
    await setFieldValue(container.querySelector('[data-testid="competitor-result-edit-layout-detail-1"]') as HTMLTextAreaElement, '卖点在上，产品在下')
    await click(container.querySelector('[data-testid="competitor-result-edit-save-detail-1"]'))
    await flush()

    const detail = useCompetitorStore.getState().session.cards.find((item) => item.id === 'detail-1')
    const hero = useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')
    expect(detail?.sellingPoint).toBe('加厚合金臂')
    expect(detail?.sellingPointSource).toBe('competitor_reference')
    expect(detail?.styleSource).toBe('user_specified')
    expect(detail?.resultImageId).toBe('result-detail-1')
    expect(hero?.sceneSummary).toBe('草坪')
    expect(hero?.layoutSummary).toBe('居中')

    const inspected = inspectCompetitorGenerationInput('detail-1')
    expect(inspected.prompt).toMatch(/车间特写/)
    expect(inspected.prompt).toMatch(/卖点在上，产品在下/)
    expect(inspected.prompt).toMatch(/本张须原样显示的卖点词原文/)
    expect(inspected.prompt).toMatch(/加厚合金臂/)
    expect(inspected.prompt).not.toMatch(/不要改回竞品原词/)
    expect(inspectCompetitorGenerationInput('hero-1').prompt).not.toMatch(/车间特写/)

    await click(container.querySelector('[data-testid="competitor-result-redraw-detail-1"]'))
    expect(generateCompetitorCard).toHaveBeenCalledTimes(1)
    expect(generateCompetitorCard).toHaveBeenCalledWith('detail-1')
    expect(generateCompetitorCard).not.toHaveBeenCalledWith('hero-1')
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBe('result-hero-1')
  })

  it('用户改过的详情卖点词进入最终 prompt，不会被默认原文保真改回', async () => {
    function BoundResults() {
      const cards = useCompetitorStore((state) => state.session.cards)
      return <GeneratedResults cards={cards} resultUrls={resultUrls} onOpen={() => {}} />
    }
    await act(async () => { root.render(<BoundResults />) })
    await flush()
    await click(container.querySelector('[data-testid="competitor-result-card-detail-1"]'))
    await setFieldValue(container.querySelector('[data-testid="competitor-result-edit-title-detail-1"]') as HTMLInputElement, '详情新标题')
    await setFieldValue(container.querySelector('[data-testid="competitor-result-edit-text-detail-1"]') as HTMLTextAreaElement, '升级加厚合金臂')
    await click(container.querySelector('[data-testid="competitor-result-edit-save-detail-1"]'))
    await flush()

    const inspected = inspectCompetitorGenerationInput('detail-1')
    expect(inspected.prompt).toMatch(/详情新标题/)
    expect(inspected.prompt).toMatch(/升级加厚合金臂/)
    expect(inspected.prompt).toMatch(/用户指定卖点词原文（必须原样显示，不要改回竞品原词）/)
    expect(inspected.prompt).not.toMatch(/本张须原样显示的卖点词原文：加厚合金臂/)
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'detail-1')?.sellingPointSource).toBe('user_specified')
  })

  it('保存失败重绘时保留原成品；生成锁和进行中会阻止重复重绘', async () => {
    const existing = useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')!
    useCompetitorStore.getState().patchCard('hero-1', failedCardPatch(existing, '模型失败'))
    const afterFail = useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')
    expect(afterFail?.status).toBe('error')
    expect(afterFail?.resultImageId).toBe('result-hero-1')
    expect(afterFail?.title).toBe(existing.title)

    let release: () => void = () => {}
    generateCompetitorCard.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))

    function BoundResults({ lock }: { lock: boolean }) {
      const cards = useCompetitorStore((state) => state.session.cards)
      return <GeneratedResults cards={cards} resultUrls={resultUrls} generatingLock={lock} onOpen={() => {}} />
    }
    await act(async () => { root.render(<BoundResults lock={false} />) })
    await flush()
    await click(container.querySelector('[data-testid="competitor-result-redraw-hero-1"]'))
    await click(container.querySelector('[data-testid="competitor-result-redraw-hero-1"]'))
    expect(generateCompetitorCard).toHaveBeenCalledTimes(1)
    release()
    await flush()

    await act(async () => { root.render(<BoundResults lock={true} />) })
    await flush()
    generateCompetitorCard.mockClear()
    expect((container.querySelector('[data-testid="competitor-result-redraw-hero-1"]') as HTMLButtonElement).disabled).toBe(true)
    await click(container.querySelector('[data-testid="competitor-result-redraw-hero-1"]'))
    expect(generateCompetitorCard).not.toHaveBeenCalled()
    expect((container.querySelector('[data-testid="competitor-result-edit-save-hero-1"]') as HTMLButtonElement)).not.toBeNull()
    await setFieldValue(container.querySelector('[data-testid="competitor-result-edit-title-hero-1"]') as HTMLInputElement, '锁下也可改标题')
    await click(container.querySelector('[data-testid="competitor-result-edit-save-hero-1"]'))
    await flush()
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')?.title).toBe('锁下也可改标题')
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBe('result-hero-1')
    expect(generateCompetitorCard).not.toHaveBeenCalled()
  })
})
