// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../lib/apiProfiles'
import { useStore } from '../../store'
import { setSharedWorkbenchModels } from '../sharedModels'
import { usePddStore } from '../store'
import { useCompetitorStore } from './store'

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

import CompetitorWorkbench from './CompetitorWorkbench'
import HelpModal from '../../components/HelpModal'
import { importProductFiles } from '../assets'
import { requestCompetitorAnalysis } from './analyze'
import { makeRefImage, useCompetitorStore as competitorStore } from './store'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY2kAAAAASUVORK5CYII='
const PNG_BYTES = Uint8Array.from(atob(PNG_B64).split('').map((c) => c.charCodeAt(0)))

function pngFile(name: string) {
  return new File([PNG_BYTES], name, { type: 'image/png' })
}

function resetStores() {
  memory.clear()
  localStorage.clear()
  const session = useCompetitorStore.getState().session
  useCompetitorStore.setState({
    session: {
      ...session,
      id: 'test-competitor-session',
      goodsId: null,
      canonicalUrl: null,
      loginLikely: false,
      captureStatus: 'idle',
      parseMessage: '',
      captureCoverage: null,
      productName: '测试挖掘机',
      styleMode: 'strict',
      textPrimaryColor: null,
      productAssets: [],
      refs: [],
      optionSlots: [],
      cards: [],
      generationConfirmed: false,
      planningError: null,
    },
    queuePhase: 'idle',
    queuePaused: false,
    queueStopped: false,
    queueCursor: 0,
    activeCardId: null,
    lightbox: null,
  })
  usePddStore.setState({ planningModel: '', imageModel: '', detected: null })
  useStore.setState({ settings: { ...DEFAULT_SETTINGS, baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'unit-test-key-not-a-real-secret' } })
  setSharedWorkbenchModels('unit-test-planning-model', '')
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function assignFiles(input: HTMLInputElement, file: File) {
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
}

describe('竞品参谋手动上传主流程', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    resetStores()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    vi.unstubAllGlobals()
    resetStores()
  })

  it('主流程不再出现采集、配对或补传入口', async () => {
    await act(async () => { root.render(<CompetitorWorkbench />) })
    const text = container.textContent || ''
    expect(container.querySelector('[data-testid="competitor-start-capture"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-cancel-capture"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-copy-diagnostics"]')).toBeNull()
    expect(text).not.toContain('采集图片')
    expect(text).not.toContain('补传')
    expect(text).not.toContain('开始配对')
    expect(text).not.toContain('粘贴链接并采集')
    expect(text).not.toContain('商品链接')
    expect(container.querySelector('[data-testid="competitor-link-input"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-save-link"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-goods-id"]')).toBeNull()
    expect(text).toContain('上传主图')
    expect(container.querySelector('[data-testid="competitor-upload-hero"]')).not.toBeNull()
  })

  it('帮助文案改为自行上传，不再要求采集窗口登录', async () => {
    await act(async () => { root.render(<HelpModal appMode="gallery" workbenchView="competitor" onClose={() => {}} />) })
    const text = document.body.textContent || ''
    expect(text).toContain('请自行准备并按类别上传')
    expect(text).not.toContain('采集图片')
    expect(text).not.toContain('采集窗口')
    expect(text).not.toContain('补传')
  })

  it('可分别上传三类图、移除其中一张，并在空链接下构造分析请求（不调用真实模型）', async () => {
    const captured: Array<{ url: string; model?: string; imageCount: number; prompt: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as { model?: string; messages?: Array<{ content?: unknown }> } : {}
      const userContent = body.messages?.find((item) => Array.isArray(item.content))?.content
      const imageCount = Array.isArray(userContent) ? userContent.filter((part) => part && typeof part === 'object' && 'type' in part && part.type === 'image_url').length : 0
      const prompt = Array.isArray(userContent)
        ? String((userContent.find((part) => part && typeof part === 'object' && 'type' in part && part.type === 'text') as { text?: string } | undefined)?.text || '')
        : ''
      captured.push({ url, model: body.model, imageCount, prompt })
      const refIds = [...prompt.matchAll(/refId=([^\s，。]+)/g)].map((match) => match[1])
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              results: refIds.map((refId) => ({
                refId,
                sellingPointCore: '结实耐玩',
                sellingPointCopy: '结实耐用',
                sceneCategory: '户外',
                layoutSummary: '产品居中',
                warnings: [],
              })),
            }),
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    await act(async () => { root.render(<CompetitorWorkbench />) })

    const heroInput = container.querySelector<HTMLInputElement>('[data-testid="competitor-category-hero"]')
    expect(heroInput).not.toBeNull()
    await assignFiles(heroInput!, pngFile('hero.png'))

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-category-tab-detail"]')?.click()
    })
    const detailInput = container.querySelector<HTMLInputElement>('[data-testid="competitor-category-detail"]')
    await assignFiles(detailInput!, pngFile('detail.png'))

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-category-tab-option"]')?.click()
    })
    const optionInput = container.querySelector<HTMLInputElement>('[data-testid="competitor-category-option"]')
    await assignFiles(optionInput!, pngFile('option.png'))

    const refsAfterUpload = useCompetitorStore.getState().session.refs
    expect(refsAfterUpload.map((ref) => ref.category).sort()).toEqual(['detail', 'hero', 'option'])
    expect(refsAfterUpload.every((ref) => ref.source === 'manual_import')).toBe(true)
    expect(memory.size).toBe(3)

    const optionRef = refsAfterUpload.find((ref) => ref.category === 'option')
    await act(async () => {
      useCompetitorStore.getState().patchRef(optionRef!.id, { optionName: '单独一只挖掘机' })
    })
    await flush()

    const removeButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '移除参考图')
    expect(removeButton).not.toBeNull()
    const optionId = optionRef!.id
    await act(async () => { removeButton?.click() })
    await flush()

    const refsAfterRemove = useCompetitorStore.getState().session.refs
    expect(refsAfterRemove.some((ref) => ref.id === optionId)).toBe(false)
    expect(refsAfterRemove.map((ref) => ref.category).sort()).toEqual(['detail', 'hero'])
    expect(memory.size).toBe(3)

    expect(container.querySelector('[data-testid="competitor-link-input"]')).toBeNull()
    expect(container.querySelector('[data-testid="competitor-analyze-option"]')?.hasAttribute('disabled')).toBe(true)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-hero"]')?.click()
    })
    await flush()
    await flush()

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toContain('/chat/completions')
    expect(captured[0].model).toBe('unit-test-planning-model')
    expect(captured[0].imageCount).toBe(1)
    expect(captured[0].prompt).toMatch(/本次只分析「主图」/)
    expect(captured[0].prompt).toMatch(/refId=/)
    expect(captured[0].prompt).not.toMatch(/单独一只挖掘机/)
    expect(captured[0].prompt).not.toMatch(/类别=详情图/)
    expect(JSON.stringify(captured[0])).not.toContain('unit-test-key-not-a-real-secret')
    expect(useCompetitorStore.getState().session.canonicalUrl).toBeNull()
  })

  it('没有参考图时不能开始分析，提示改为上传而不是采集', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const toasts: string[] = []
    const original = useStore.getState().showToast
    useStore.setState({ showToast: (message: string) => { toasts.push(message) } } as never)

    await act(async () => { root.render(<CompetitorWorkbench />) })
    expect(container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-hero"]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-detail"]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-option"]')?.disabled).toBe(true)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-analyze-hero"]')?.click()
    })
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(toasts.join('\n')).not.toContain('采集')
    useStore.setState({ showToast: original })
  })
})

describe('手动上传存储与分析请求构造（不发真实模型请求）', () => {
  beforeEach(() => {
    resetStores()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetStores()
  })

  it('导入文件写入隔离存储后可读回，并据此构造分析请求', async () => {
    const stored = await importProductFiles([pngFile('hero-store.png'), pngFile('detail-store.png')])
    expect(stored).toHaveLength(2)
    expect(stored[0].dataUrl).toMatch(/^data:image\/png/)
    expect(memory.get(stored[0].id || stored[0].imageId)).toMatch(/^data:image\/png/)

    const refs = [
      makeRefImage({ category: 'hero', asset: stored[0] }),
      makeRefImage({ category: 'detail', asset: stored[1] }),
    ]
    competitorStore.getState().addRefs(refs)

    const captured: Array<{ imageCount: number; model?: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { model?: string; messages?: Array<{ content?: unknown }> } : {}
      const userContent = body.messages?.find((item) => Array.isArray(item.content))?.content
      const imageCount = Array.isArray(userContent) ? userContent.filter((part) => part && typeof part === 'object' && 'type' in part && part.type === 'image_url').length : 0
      captured.push({ imageCount, model: body.model })
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ results: refs.map((ref) => ({ refId: ref.id, sellingPointCopy: '测试卖点', sceneCategory: '', layoutSummary: '', warnings: [] })) }) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    const result = await requestCompetitorAnalysis({
      planningModel: 'unit-test-planning-model',
      productName: '测试挖掘机',
      refs: competitorStore.getState().session.refs,
    })
    expect(result.ok).toBe(true)
    expect(captured).toHaveLength(1)
    expect(captured[0].imageCount).toBe(2)
    expect(captured[0].model).toBe('unit-test-planning-model')
  })
})
