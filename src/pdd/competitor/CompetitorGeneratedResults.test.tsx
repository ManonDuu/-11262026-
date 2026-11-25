// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { DEFAULT_SETTINGS } from '../../lib/apiProfiles'
import { useStore } from '../../store'
import { setSharedWorkbenchModels } from '../sharedModels'
import { usePddStore } from '../store'
import { useCompetitorStore } from './store'
import type { CompetitorCard, CompetitorRefImage } from './types'
import { cardsWithVisibleResults, visibleResultsInCategory } from './GeneratedResults'

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

function loadEvidence(name: string) {
  return parsePng(readEvidenceBytes(name))
}

const loadImageDataUrl = vi.fn(async (id: string) => resultUrlById[id])
const resultUrlById: Record<string, string> = {}
const { generateCompetitorCard, downloadOriginalPng } = vi.hoisted(() => ({
  generateCompetitorCard: vi.fn(async () => {}),
  downloadOriginalPng: vi.fn(async () => {}),
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
  downloadOriginalPng,
  downloadCustomSizePng: vi.fn(async () => {}),
  downloadGroupedZip: vi.fn(async () => 0),
  downloadCategoryZip: vi.fn(async () => 0),
}))

import CompetitorWorkbench from './CompetitorWorkbench'
import CategoryBoard from './CategoryBoard'
import GeneratedResults from './GeneratedResults'

const REF_HERO_1 = 'data:image/png;base64,ref-hero-1-original'
const REF_HERO_2 = 'data:image/png;base64,ref-hero-2-original'
const REF_DETAIL = 'data:image/png;base64,ref-detail-original'
const FIXTURE_DETAIL = 'data:image/png;base64,isolated-detail-fixture'
const FIXTURE_OPTION = 'data:image/png;base64,isolated-option-fixture'

function ref(id: string, category: CompetitorRefImage['category'], dataUrl: string, optionName = ''): CompetitorRefImage {
  return {
    id,
    category,
    asset: { id, imageId: id, name: `${id}.png`, dataUrl, thumbnailDataUrl: dataUrl },
    optionName,
    contentsNote: '',
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

function seedSession(resultA: string, resultB: string, extras: CompetitorCard[] = []) {
  const current = useCompetitorStore.getState().session
  useCompetitorStore.setState({
    session: {
      ...current,
      id: 't182-separate-results',
      goodsId: null,
      canonicalUrl: null,
      parseMessage: '',
      captureCoverage: null,
      productName: '测试挖掘机',
      styleMode: 'strict',
      productAssets: [{ id: 'prod', imageId: 'prod', name: 'product.png' }],
      refs: [
        ref('ref-hero-1', 'hero', REF_HERO_1),
        ref('ref-hero-2', 'hero', REF_HERO_2),
        ref('ref-detail', 'detail', REF_DETAIL),
        ref('ref-option', 'option', 'data:image/png;base64,ref-option-original', '单独一只挖掘机'),
      ],
      optionSlots: [],
      cards: [
        card({
          id: 'hero-1',
          category: 'hero',
          index: 1,
          refImageId: 'ref-hero-1',
          status: 'done',
          taskId: 'task-hero-1',
          resultImageId: 'result-hero-1',
          resultWidth: 1254,
          resultHeight: 1254,
        }),
        card({
          id: 'hero-2',
          category: 'hero',
          index: 2,
          refImageId: 'ref-hero-2',
          status: 'done',
          taskId: 'task-hero-2',
          resultImageId: 'result-hero-2',
          resultWidth: 1254,
          resultHeight: 1254,
        }),
        card({ id: 'hero-3', category: 'hero', index: 3, refImageId: 'ref-hero-1', status: 'idle' }),
        card({ id: 'detail-idle', category: 'detail', index: 4, refImageId: 'ref-detail', status: 'idle' }),
        ...extras,
      ],
      generationConfirmed: true,
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
  Object.keys(resultUrlById).forEach((key) => { delete resultUrlById[key] })
  resultUrlById['result-hero-1'] = resultA
  resultUrlById['result-hero-2'] = resultB
  usePddStore.setState({ planningModel: 'unit-planning', imageModel: 'unit-image-model', detected: null })
  setSharedWorkbenchModels('unit-planning', 'unit-image-model')
  useStore.setState({
    settings: { ...DEFAULT_SETTINGS, baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'unit-test-key-not-a-real-secret', model: 'unit-image-model' },
    tasks: [],
    params: { ...DEFAULT_PARAMS },
  })
}

async function flush() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('竞品参考图与生成结果分离', () => {
  let container: HTMLDivElement
  let root: Root
  let pngA: ReturnType<typeof loadEvidence>
  let pngB: ReturnType<typeof loadEvidence>

  beforeEach(() => {
    pngA = loadEvidence('hero-result-1.png')
    pngB = loadEvidence('hero-result-2.png')
    loadImageDataUrl.mockClear()
    generateCompetitorCard.mockClear()
    downloadOriginalPng.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    seedSession(pngA.dataUrl, pngB.dataUrl)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => { root.unmount() })
    }
    container?.remove()
  })

  it('合成主图PNG非空且尺寸元数据正确，并只归入生成区主图框', () => {
    expect(pngA.bytes).toBeGreaterThan(0)
    expect(pngB.bytes).toBeGreaterThan(0)
    expect(pngA.contentType).toBe('image/png')
    expect(pngB.contentType).toBe('image/png')
    expect(pngA.width).toBe(1254)
    expect(pngA.height).toBe(1254)
    expect(pngB.width).toBe(1254)
    expect(pngB.height).toBe(1254)
    const cards = useCompetitorStore.getState().session.cards
    expect(visibleResultsInCategory(cards, 'hero').map((item) => item.id)).toEqual(['hero-1', 'hero-2'])
    expect(visibleResultsInCategory(cards, 'detail')).toEqual([])
    expect(visibleResultsInCategory(cards, 'option')).toEqual([])
    expect(cardsWithVisibleResults(cards).every((item) => item.category === 'hero')).toBe(true)
  })

  it('工作台生成后：上方只显示参考原图，下方主图框绑定两张合成成品，详情和选项为空', async () => {
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()

    const board = container.querySelector('[data-testid="competitor-category-board"]')
    expect(board).not.toBeNull()
    const referencePreview = container.querySelector('[data-testid="competitor-category-preview"]') as HTMLImageElement | null
    expect(referencePreview?.getAttribute('data-preview-source')).toBe('reference')
    expect(referencePreview?.getAttribute('data-image-id')).toBe('ref-hero-1')
    expect(referencePreview?.getAttribute('src')).toBe(REF_HERO_1)
    expect(referencePreview?.getAttribute('src')).not.toBe(pngA.dataUrl)
    expect(referencePreview?.getAttribute('src')).not.toBe(pngB.dataUrl)
    expect(board?.querySelectorAll('img[data-preview-source="result"]').length).toBe(0)
    expect(Array.from(board?.querySelectorAll('img') || []).every((img) => img.getAttribute('src') !== pngA.dataUrl && img.getAttribute('src') !== pngB.dataUrl)).toBe(true)
    expect(container.querySelector('[data-testid="competitor-ref-generated-badge-ref-hero-1"]')).toBeNull()

    const heroBoard = container.querySelector('[data-testid="competitor-result-board-hero"]')
    const detailBoard = container.querySelector('[data-testid="competitor-result-board-detail"]')
    const optionBoard = container.querySelector('[data-testid="competitor-result-board-option"]')
    expect(heroBoard).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-image-hero-1"]')?.getAttribute('src')).toBe(pngA.dataUrl)
    expect(container.querySelector('[data-testid="competitor-result-image-hero-2"]')?.getAttribute('src')).toBe(pngB.dataUrl)
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('src')).toBe(pngA.dataUrl)
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('data-preview-source')).toBe('result')
    expect(container.querySelector('[data-testid="competitor-result-image-hero-3"]')).toBeNull()
    expect(detailBoard?.querySelector('[data-testid="competitor-result-empty-detail"]')?.textContent).toContain('暂无生成成品')
    expect(optionBoard?.querySelector('[data-testid="competitor-result-empty-option"]')?.textContent).toContain('暂无生成成品')
    expect(container.querySelector('[data-testid="competitor-generate-hero"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-generate-detail"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-generate-option"]')).not.toBeNull()
    expect((container.querySelector('[data-testid="competitor-hero-count"]') as HTMLInputElement | null)?.value).toBe('2')
  })

  it('切参考分类和缩略图时，上方始终是参考原图，下方成品选择保持独立', async () => {
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()

    await act(async () => {
      container.querySelector('[data-testid="competitor-result-card-hero-2"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('src')).toBe(pngB.dataUrl)
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('data-card-id')).toBe('hero-2')

    await act(async () => {
      container.querySelector('[data-testid="competitor-ref-thumb-ref-hero-2"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const referencePreview = container.querySelector('[data-testid="competitor-category-preview"]') as HTMLImageElement | null
    expect(referencePreview?.getAttribute('src')).toBe(REF_HERO_2)
    expect(referencePreview?.getAttribute('data-image-id')).toBe('ref-hero-2')
    expect(referencePreview?.getAttribute('data-preview-source')).toBe('reference')
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('src')).toBe(pngB.dataUrl)
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('data-card-id')).toBe('hero-2')

    await act(async () => {
      container.querySelector('[data-testid="competitor-category-tab-detail"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="competitor-category-preview"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-detail-strip-preview"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-detail-blocks-pending"]')?.textContent).toMatch(/请先点「分析详情页」/)
    const detailThumb = container.querySelector('[data-testid="competitor-ref-thumb-ref-detail"] img') as HTMLImageElement | null
    expect(detailThumb?.getAttribute('src')).toBe(REF_DETAIL)
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('src')).toBe(pngB.dataUrl)
    expect(container.querySelector('[data-testid="competitor-result-empty-detail"]')).not.toBeNull()
  })

  it('分类预览即使传入成品 URL 也不会改成生成图', async () => {
    await act(async () => { root.render(<CategoryBoard coverage={[]} generatingLock={false} onSupplement={() => {}} onGenerateError={() => {}} />) })
    const preview = container.querySelector('[data-testid="competitor-category-preview"]') as HTMLImageElement | null
    expect(preview?.getAttribute('data-preview-source')).toBe('reference')
    expect(preview?.getAttribute('src')).toBe(REF_HERO_1)
    expect(container.querySelector('[data-testid="competitor-preview-caption"]')?.textContent).toContain('参考图')
    expect(container.querySelector('[data-testid="competitor-ref-generated-badge-ref-hero-1"]')).toBeNull()
  })

  it('隔离 fixture：详情/选项成品、套餐标签和失败状态只出现在对应分类框', async () => {
    const extras: CompetitorCard[] = [
      card({
        id: 'detail-done',
        category: 'detail',
        index: 5,
        refImageId: 'ref-detail',
        status: 'done',
        resultImageId: 'result-detail-fixture',
        resultWidth: 16,
        resultHeight: 16,
      }),
      card({
        id: 'option-done',
        category: 'option',
        index: 6,
        refImageId: 'ref-option',
        optionName: '单独一只挖掘机',
        status: 'done',
        resultImageId: 'result-option-fixture',
        resultWidth: 16,
        resultHeight: 16,
      }),
      card({
        id: 'option-failed',
        category: 'option',
        index: 7,
        refImageId: 'ref-option',
        optionName: '加石头套餐',
        status: 'error',
        error: '生成失败：测试夹具',
      }),
    ]
    seedSession(pngA.dataUrl, pngB.dataUrl, extras)
    resultUrlById['result-detail-fixture'] = FIXTURE_DETAIL
    resultUrlById['result-option-fixture'] = FIXTURE_OPTION

    await act(async () => {
      root.render(
        <GeneratedResults
          cards={useCompetitorStore.getState().session.cards}
          resultUrls={{ ...resultUrlById }}
          onOpen={() => {}}
        />,
      )
    })

    expect(container.querySelector('[data-testid="competitor-result-board-hero"] [data-testid="competitor-result-image-hero-1"]')?.getAttribute('src')).toBe(pngA.dataUrl)
    expect(container.querySelector('[data-testid="competitor-result-board-hero"] [data-testid="competitor-result-image-detail-done"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-board-detail"] [data-testid="competitor-result-image-detail-done"]')?.getAttribute('src')).toBe(FIXTURE_DETAIL)
    expect(container.querySelector('[data-testid="competitor-result-board-option"] [data-testid="competitor-result-image-option-done"]')?.getAttribute('src')).toBe(FIXTURE_OPTION)
    expect(container.querySelector('[data-testid="competitor-result-board-detail"] [data-testid="competitor-result-image-option-done"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-empty-detail"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-preview-option"]')?.nextElementSibling?.textContent).toContain('单独一只挖掘机')
    expect(container.querySelector('[data-testid="competitor-result-pending-option-failed"]')?.textContent).toContain('生成失败：测试夹具')

    await act(async () => {
      container.querySelector('[data-testid="competitor-result-card-option-failed"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="competitor-result-error-option-failed"]')?.textContent).toBe('生成失败：测试夹具')
    expect(container.querySelector('[data-testid="competitor-result-preview-hero"]')?.getAttribute('src')).toBe(pngA.dataUrl)
  })

  it('生成区预览、下载和重绘入口针对当前成品，不发真实请求', async () => {
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()
    await act(async () => {
      container.querySelector('[data-testid="competitor-result-download-hero-1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('[data-testid="competitor-result-redraw-hero-1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(downloadOriginalPng).toHaveBeenCalledWith('result-hero-1', '主图-1')
    expect(generateCompetitorCard).toHaveBeenCalledWith('hero-1')
  })
})
