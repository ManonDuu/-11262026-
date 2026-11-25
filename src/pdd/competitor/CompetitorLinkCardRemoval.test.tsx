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
import HelpModal from '../../components/HelpModal'
import { setSharedWorkbenchModels } from '../sharedModels'
import { usePddStore } from '../store'
import CompetitorWorkbench from './CompetitorWorkbench'
import { useCompetitorStore } from './store'
import type { CompetitorRefImage } from './types'
import { COMPETITOR_CATEGORIES, type CompetitorCategory } from './categories'

const PERSIST_KEY = 'pdd-competitor-advisor-session'
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY2kAAAAASUVORK5CYII='
const LINK_TESTIDS = [
  'competitor-link-input',
  'competitor-save-link',
  'competitor-goods-id',
  'competitor-saved-link',
  'competitor-link-status',
  'competitor-input-entry-kind',
] as const

function ref(category: CompetitorCategory): CompetitorRefImage {
  const id = `ref-${category}`
  return {
    id,
    category,
    asset: { id, imageId: id, name: `${id}.png`, width: 64, height: 64, dataUrl: PNG_DATA_URL },
    optionName: category === 'option' ? '套餐甲' : '',
    contentsNote: '',
    sellingPoint: '',
    sceneHint: '',
    layoutSummary: '',
    analysisStatus: 'pending',
    source: 'manual_import',
  }
}

function seed(sessionPatch: Partial<ReturnType<typeof useCompetitorStore.getState>['session']> = {}) {
  memory.clear()
  const refs = COMPETITOR_CATEGORIES.map(ref)
  for (const item of refs) memory.set(item.id, PNG_DATA_URL)
  memory.set('product', PNG_DATA_URL)
  const current = useCompetitorStore.getState().session
  useCompetitorStore.setState({
    session: {
      ...current,
      productName: '测试挖掘机',
      productAssets: [{ id: 'product', imageId: 'product', name: 'own.png', dataUrl: PNG_DATA_URL }],
      refs,
      cards: [],
      optionSlots: [{ id: 'slot-1', optionName: '套餐甲', contentsNote: '', boundRefId: 'ref-option', missing: false }],
      generationConfirmed: false,
      categoryConfirmations: undefined,
      lastAnalysisError: null,
      planningError: null,
      ...sessionPatch,
    },
    analysisInFlight: null,
    generationInFlight: null,
    queuePhase: 'idle',
    queuePaused: false,
    queueStopped: false,
    lightbox: null,
  })
  usePddStore.setState({ planningModel: 'unit-plan', imageModel: 'unit-image', detected: null })
  setSharedWorkbenchModels('unit-plan', 'unit-image')
  useStore.setState({
    settings: { ...DEFAULT_SETTINGS, baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'unit-test-key-not-a-real-secret' },
    tasks: [],
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return
    await flush()
  }
  throw new Error('等待条件超时')
}

function mockAnalysisFetch() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as { messages?: Array<{ content?: unknown }> } : {}
    const parts = Array.isArray(body.messages?.[1]?.content) ? body.messages[1].content as Array<{ type?: string; refId?: string; text?: string }> : []
    const prompt = parts.find((part) => part.type === 'text')?.text || ''
    const ids = parts.filter((part) => part.type === 'image_url').map((part) => part.refId).filter(Boolean)
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ results: ids.map((refId) => ({ refId, sellingPointCopy: `卖点-${refId}`, sceneCategory: '棚拍', layoutSummary: '居中', warnings: [] })) }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

describe('竞品参谋已移除商品链接卡片', () => {
  let root: Root
  let container: HTMLDivElement
  const toasts: string[] = []
  let originalToast: (typeof useStore.getState extends () => infer S ? S : never)['showToast'] | undefined

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    memory.clear()
    toasts.length = 0
    originalToast = useStore.getState().showToast
    useStore.setState({ showToast: (message: string) => { toasts.push(message) } } as never)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    seed({ goodsId: null, canonicalUrl: null, parseMessage: '' })
  })

  afterEach(async () => {
    if (originalToast) useStore.setState({ showToast: originalToast } as never)
    vi.unstubAllGlobals()
    await act(async () => { root.unmount() })
    container.remove()
    localStorage.clear()
  })

  it('不再渲染商品链接整块入口、输入框、商品编号和相关说明', async () => {
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()
    const text = container.textContent || ''
    expect(text).not.toContain('商品链接')
    expect(text).not.toContain('已记录商品编号')
    expect(text).not.toContain('保存链接')
    expect(text).not.toContain('已保存参考地址')
    expect(text).not.toContain('链接只作为备注')
    expect(text).not.toContain('不会自动打开或采集')
    for (const id of LINK_TESTIDS) expect(container.querySelector(`[data-testid="${id}"]`)).toBeNull()
    expect(container.querySelector('[data-testid="competitor-upload-hero"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-analyze-hero"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="competitor-generate-hero"]')).not.toBeNull()
  })

  it('帮助说明不再把商品链接当作流程步骤', async () => {
    await act(async () => { root.render(<HelpModal appMode="gallery" workbenchView="competitor" onClose={() => {}} />) })
    const text = document.body.textContent || ''
    expect(text).toContain('请自行准备并按类别上传')
    expect(text).not.toContain('商品链接')
  })

  it('旧会话里已有商品编号和链接仍可打开，字段保留但不展示，也不阻断无链接分析预览', async () => {
    seed({
      goodsId: '100000000001',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=100000000001',
      parseMessage: '已保存参考链接。这只是备注，不会自动打开或采集商品页。',
    })
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      state: {
        planningModel: 'unit-plan',
        imageModel: 'unit-image',
        session: useCompetitorStore.getState().session,
      },
      version: 0,
    }))
    await act(async () => { await useCompetitorStore.persist.rehydrate() })
    const fetchMock = mockAnalysisFetch()
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()
    const restored = useCompetitorStore.getState().session
    expect(restored.goodsId).toBe('100000000001')
    expect(restored.canonicalUrl).toContain('goods_id=100000000001')
    expect(container.textContent).not.toContain('已记录商品编号')
    expect(container.textContent).not.toContain('100000000001')
    expect(container.textContent).not.toContain('已保存参考地址')
    for (const id of LINK_TESTIDS) expect(container.querySelector(`[data-testid="${id}"]`)).toBeNull()

    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-hero"]')?.click() })
    await until(() => fetchMock.mock.calls.length === 1)
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>('[data-testid="competitor-preview-category"]')
      if (select) {
        select.value = 'hero'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="competitor-build-preview"]')?.click() })
    await flush()
    expect(useCompetitorStore.getState().session.cards.some((card) => card.category === 'hero')).toBe(true)
    expect(useCompetitorStore.getState().session.goodsId).toBe('100000000001')
    expect(toasts.join('\n')).not.toMatch(/请.*链接|缺少商品链接|商品链接必填/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('无链接时三类分析和本地预览仍可独立完成，不发额外付费请求', async () => {
    seed({ goodsId: null, canonicalUrl: null, parseMessage: '' })
    const fetchMock = mockAnalysisFetch()
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await flush()
    for (const category of COMPETITOR_CATEGORIES) {
      const before = fetchMock.mock.calls.length
      await act(async () => { container.querySelector<HTMLButtonElement>(`[data-testid="competitor-analyze-${category}"]`)?.click() })
      await until(() => fetchMock.mock.calls.length === before + 1)
      const body = JSON.parse(String(fetchMock.mock.calls[before][1]?.body)) as { messages: Array<{ content?: unknown }> }
      const parts = body.messages[1].content as Array<{ type?: string; refId?: string; text?: string }>
      const prompt = parts.find((part) => part.type === 'text')?.text || ''
      const ids = parts.filter((part) => part.type === 'image_url').map((part) => part.refId)
      expect(ids).toEqual([`ref-${category}`])
      expect(prompt).not.toMatch(/商品链接|canonicalUrl|请先填写链接/)
      await act(async () => {
        const select = container.querySelector<HTMLSelectElement>('[data-testid="competitor-preview-category"]')
        if (select) {
          select.value = category
          select.dispatchEvent(new Event('change', { bubbles: true }))
        }
      })
      await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="competitor-build-preview"]')?.click() })
      await flush()
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const session = useCompetitorStore.getState().session
    expect(session.canonicalUrl).toBeNull()
    expect(session.cards.some((card) => card.category === 'hero')).toBe(true)
    expect(session.cards.some((card) => card.category === 'detail')).toBe(true)
    expect(session.cards.some((card) => card.category === 'option')).toBe(true)
    expect(toasts.join('\n')).not.toMatch(/请.*链接|缺少商品链接|商品链接必填/)
    expect(toasts.some((message) => message.includes('分析失败'))).toBe(false)
  })
})
