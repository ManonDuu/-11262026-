// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCompetitorStore } from './store'
import type { CompetitorRefImage } from './types'
import type { DetailStripPreview } from './detailStripPreview'

const useDetailStripPreview = vi.hoisted(() => vi.fn())

vi.mock('./detailStripPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./detailStripPreview')>()
  return {
    ...actual,
    useDetailStripPreview,
  }
})

vi.mock('./generation', () => ({
  generateCompetitorCard: vi.fn(async () => {}),
}))

vi.mock('../exportSet', () => ({
  downloadOriginalPng: vi.fn(async () => {}),
  downloadCustomSizePng: vi.fn(async () => {}),
  downloadGroupedZip: vi.fn(async () => 0),
  downloadCategoryZip: vi.fn(async () => 0),
}))

vi.mock('../../lib/db', () => ({
  storeImageWithSize: vi.fn(),
  getImageThumbnail: vi.fn(),
  getImage: vi.fn(),
  getImageDimensions: vi.fn(),
  getImageThumbnailBlob: vi.fn(),
}))

vi.mock('../assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../assets')>()
  return {
    ...actual,
    loadImageDataUrl: vi.fn(async () => undefined),
  }
})

import CategoryBoard from './CategoryBoard'
import GeneratedResults from './GeneratedResults'
import { importProductFiles } from '../assets'
import { storeImageWithSize, getImageThumbnail } from '../../lib/db'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY2kAAAAASUVORK5CYII='
const PNG_BYTES = Uint8Array.from(atob(PNG_B64).split('').map((ch) => ch.charCodeAt(0)))
const STRIP_URL = 'data:image/png;base64,STRIP-DETAIL-LONG'
const HERO_URL = 'data:image/png;base64,hero-original'
const DETAIL_Z = 'data:image/png;base64,detail-z-original'
const DETAIL_A = 'data:image/png;base64,detail-a-original'
const OPTION_URL = 'data:image/png;base64,option-original'

function ref(id: string, category: CompetitorRefImage['category'], dataUrl: string): CompetitorRefImage {
  return {
    id,
    category,
    asset: { id, imageId: id, name: `${id}.png`, width: 80, height: 20, dataUrl, thumbnailDataUrl: dataUrl },
    optionName: '',
    contentsNote: '',
    sellingPoint: '',
    sceneHint: '',
    layoutSummary: '',
    analysisStatus: 'pending',
    source: 'manual_import',
  }
}

function readyStrip(): DetailStripPreview {
  return {
    layout: {
      kind: 'strip',
      width: 80,
      height: 40,
      targetWidth: 80,
      placements: [
        { refId: 'detail-z', imageId: 'detail-z', sourceWidth: 80, sourceHeight: 20, width: 80, height: 20, y: 0 },
        { refId: 'detail-a', imageId: 'detail-a', sourceWidth: 80, sourceHeight: 20, width: 80, height: 20, y: 20 },
      ],
      slices: [{ index: 1, total: 1, yStart: 0, yEnd: 40, width: 80, height: 40, sourceRefIds: ['detail-z', 'detail-a'], placements: [] }],
      skipped: [],
      notices: [],
      cacheKey: 'test-strip',
    },
    urls: [STRIP_URL],
    objectUrls: [],
    captions: [],
    summary: '详情参考长图已按上传顺序纵向拼接，共 2 张原分图，宽 80、高 40 像素。',
  }
}

function seedRefs(refs: CompetitorRefImage[]) {
  const current = useCompetitorStore.getState().session
  useCompetitorStore.setState({
    session: {
      ...current,
      id: 't183-detail-strip',
      refs,
      cards: [],
      optionSlots: [],
      productName: '测试挖掘机',
      generationConfirmed: false,
      detailSellingPointBlocks: undefined,
    },
  })
}

async function flush() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('竞品详情参考区按卖点块预览（不提供长图预览，不混入生成区）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useDetailStripPreview.mockReset()
    useDetailStripPreview.mockReturnValue({ preview: readyStrip(), status: 'ready', error: null })
    seedRefs([
      ref('hero-1', 'hero', HERO_URL),
      ref('detail-z', 'detail', DETAIL_Z),
      ref('detail-a', 'detail', DETAIL_A),
      ref('opt-1', 'option', OPTION_URL),
    ])
  })

  afterEach(async () => {
    if (root) await act(async () => { root.unmount() })
    container?.remove()
  })

  it('分析前不显示详情长图预览，只提示先分析，原分图仍可管理，且不进入生成详情框', async () => {
    await act(async () => {
      root.render(
        <>
          <CategoryBoard coverage={[]} generatingLock={false} onSupplement={() => {}} onGenerateError={() => {}} />
          <GeneratedResults cards={[]} resultUrls={{}} onOpen={() => {}} generatingLock={false} onGenerateError={() => {}} />
        </>,
      )
    })
    await flush()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-category-tab-detail"]')?.click()
    })
    await flush()

    expect(container.querySelector('[data-testid="competitor-detail-strip"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-detail-strip-preview"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-detail-strip-segments"]')).toBeNull()
    expect(container.querySelector(`img[src="${STRIP_URL}"]`)).toBeNull()
    expect(container.querySelector('[data-testid="competitor-detail-selling-point-blocks"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-detail-blocks-pending"]')?.textContent).toMatch(/请先点「分析详情页」/)
    expect(container.querySelector('[data-testid="competitor-detail-blocks-pending"]')?.textContent).toMatch(/不提供详情长图预览/)

    const zThumb = container.querySelector('[data-testid="competitor-ref-thumb-detail-z"] img') as HTMLImageElement | null
    const aThumb = container.querySelector('[data-testid="competitor-ref-thumb-detail-a"] img') as HTMLImageElement | null
    expect(zThumb?.getAttribute('src')).toBe(DETAIL_Z)
    expect(aThumb?.getAttribute('src')).toBe(DETAIL_A)

    const resultDetail = container.querySelector('[data-testid="competitor-result-board-detail"]')
    expect(resultDetail?.textContent).toMatch(/暂无生成成品/)
    expect(resultDetail?.querySelector(`img[src="${STRIP_URL}"]`)).toBeNull()
    expect(container.querySelector('[data-testid="competitor-result-board-hero"]')?.textContent).toMatch(/暂无生成成品/)
  })

  it('分析后只展示按卖点拆分的参考块，跨原图卖点标明两边原分图，仍不渲染长图预览', async () => {
    const current = useCompetitorStore.getState().session
    useCompetitorStore.setState({
      session: {
        ...current,
        detailSellingPointBlocks: [{
          id: 'sp-cross',
          sellingPointText: '加厚合金臂',
          sourceRefIds: ['detail-z', 'detail-a'],
          globalYStart: 10,
          globalYEnd: 30,
          boundSource: 'semantic_analysis',
          uncertainBounds: false,
        }],
      },
    })
    await act(async () => {
      root.render(<CategoryBoard coverage={[]} generatingLock={false} onSupplement={() => {}} onGenerateError={() => {}} />)
    })
    await flush()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-category-tab-detail"]')?.click()
    })
    await flush()

    expect(container.querySelector('[data-testid="competitor-detail-strip"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-detail-strip-preview"]')).toBeNull()
    expect(container.querySelector(`img[src="${STRIP_URL}"]`)).toBeNull()
    expect(container.querySelector('[data-testid="competitor-detail-blocks-pending"]')).toBeNull()
    const gallery = container.querySelector('[data-testid="competitor-detail-selling-point-blocks"]')
    expect(gallery).not.toBeNull()
    expect(gallery?.textContent).toMatch(/加厚合金臂/)
    expect(gallery?.textContent).toMatch(/detail-z/)
    expect(gallery?.textContent).toMatch(/detail-a/)
    expect(container.querySelector('[data-testid="competitor-ref-thumb-detail-z"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-ref-thumb-detail-a"]')).not.toBeNull()
  })

  it('无详情图时显示明确空状态，主图预览不受影响', async () => {
    seedRefs([ref('hero-1', 'hero', HERO_URL)])
    useDetailStripPreview.mockReturnValue({ preview: null, status: 'empty', error: null })
    await act(async () => {
      root.render(<CategoryBoard coverage={[]} generatingLock={false} onSupplement={() => {}} onGenerateError={() => {}} />)
    })
    await flush()
    const preview = container.querySelector('[data-testid="competitor-category-preview"]') as HTMLImageElement | null
    expect(preview?.getAttribute('src')).toBe(HERO_URL)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-category-tab-detail"]')?.click()
    })
    await flush()
    expect(container.querySelector('[data-testid="competitor-detail-strip-empty"]')?.textContent).toBe('暂无参考详情图')
    expect(container.querySelector('[data-testid="competitor-detail-strip-preview"]')).toBeNull()
  })

  it('addRefs 按批次追加，移除后剩余顺序保持上传先后', () => {
    seedRefs([])
    useCompetitorStore.getState().addRefs([ref('detail-z', 'detail', DETAIL_Z)])
    useCompetitorStore.getState().addRefs([ref('detail-a', 'detail', DETAIL_A), ref('hero-1', 'hero', HERO_URL)])
    expect(useCompetitorStore.getState().session.refs.map((item) => item.id)).toEqual(['detail-z', 'detail-a', 'hero-1'])
    useCompetitorStore.getState().removeRef('detail-z')
    expect(useCompetitorStore.getState().session.refs.filter((item) => item.category === 'detail').map((item) => item.id)).toEqual(['detail-a'])
  })
})

describe('手动上传文件列表顺序（不按文件名重排）', () => {
  it('importProductFiles 保持选择顺序，即使存储完成有先后', async () => {
    const store = vi.mocked(storeImageWithSize)
    const thumb = vi.mocked(getImageThumbnail)
    store.mockReset()
    thumb.mockReset()
    thumb.mockResolvedValue(undefined)
    let calls = 0
    store.mockImplementation(async () => {
      const index = calls
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 20 : 0))
      return { id: `img-${index}`, width: 1, height: 1 }
    })
    const files = [
      new File([PNG_BYTES], 'z-late.png', { type: 'image/png' }),
      new File([PNG_BYTES], 'a-early.png', { type: 'image/png' }),
    ]
    const assets = await importProductFiles(files)
    expect(assets.map((asset) => asset.name)).toEqual(['z-late.png', 'a-early.png'])
    expect(assets.map((asset) => asset.imageId)).toEqual(['img-0', 'img-1'])
  })
})
