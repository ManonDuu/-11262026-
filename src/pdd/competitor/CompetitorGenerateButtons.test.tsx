// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { DEFAULT_SETTINGS } from '../../lib/apiProfiles'
import { useStore } from '../../store'
import * as appStore from '../../store'
import { setSharedWorkbenchModels } from '../sharedModels'
import { usePddStore } from '../store'
import { useCompetitorStore } from './store'
import type { CompetitorCard, CompetitorRefImage } from './types'

vi.mock('../generationInputs', () => ({
  collectInputImages: vi.fn(async () => [{ id: 'img', dataUrl: 'data:image/png;base64,xx' }]),
}))

vi.mock('../../lib/db', () => ({
  getImageDimensions: vi.fn(async () => ({ width: 16, height: 16 })),
  getImage: vi.fn(),
  getImageThumbnail: vi.fn(),
  storeImageWithSize: vi.fn(),
}))

import CompetitorWorkbench from './CompetitorWorkbench'

const captured: Array<{ prompts: string[]; inputCount: number }> = []

function ref(id: string, category: CompetitorRefImage['category'], optionName = ''): CompetitorRefImage {
  return {
    id,
    category,
    asset: { id, imageId: id, name: `${id}.png` },
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

function resetStores() {
  captured.length = 0
  const current = useCompetitorStore.getState().session
  useCompetitorStore.setState({
    session: {
      ...current,
      id: 'gen-test',
      goodsId: null,
      canonicalUrl: null,
      parseMessage: '',
      captureCoverage: null,
      productName: '测试挖掘机',
      styleMode: 'strict',
      productAssets: [{ id: 'prod', imageId: 'prod', name: 'product.png' }],
      refs: [
        ref('ref-hero', 'hero'),
        ref('ref-detail', 'detail'),
        ref('ref-option', 'option', '单独一只挖掘机'),
      ],
      optionSlots: [],
      cards: [
        card({ id: 'hero-1', category: 'hero', refImageId: 'ref-hero', title: '主图 1', imagePrompt: 'hero-prompt' }),
        card({ id: 'detail-1', category: 'detail', refImageId: 'ref-detail', title: '详情 1', imagePrompt: 'detail-prompt' }),
        card({ id: 'option-1', category: 'option', refImageId: 'ref-option', optionName: '单独一只挖掘机', title: '单独一只挖掘机', imagePrompt: 'option-prompt 单独一只挖掘机' }),
      ],
      generationConfirmed: true,
      heroGenerateCount: 1,
      planningError: null,
    },
    queuePhase: 'idle',
    queuePaused: false,
    queueStopped: false,
    queueCursor: 0,
    activeCardId: null,
    lightbox: null,
  })
  usePddStore.setState({ planningModel: 'unit-planning', imageModel: 'unit-image-model', detected: null })
  setSharedWorkbenchModels('unit-planning', 'unit-image-model')
  useStore.setState({
    settings: { ...DEFAULT_SETTINGS, baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'unit-test-key-not-a-real-secret', model: 'unit-image-model' },
    tasks: [],
    params: { ...DEFAULT_PARAMS },
  })
}


async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('竞品参谋三类生图按钮（拦截本地夹具，不发真实模型请求）', () => {
  let root: Root
  let container: HTMLDivElement
  let submitSpy: ReturnType<typeof vi.spyOn>
  let waitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    resetStores()
    submitSpy = vi.spyOn(appStore, 'submitTask').mockImplementation(async (options?) => {
      const input = options?.input
      const prompts = input?.prompts || []
      captured.push({ prompts, inputCount: input?.inputImages?.length || 0 })
      const id = `task-${captured.length}`
      const tasks = appStore.useStore.getState().tasks
      appStore.useStore.setState({
        tasks: [...tasks, {
          id,
          prompt: prompts[0] || '',
          params: { ...DEFAULT_PARAMS },
          inputImageIds: [],
          outputImages: ['fixture-out'],
          status: 'done' as const,
          error: null,
          createdAt: 1,
          finishedAt: 1,
          elapsed: 1,
        }],
      })
      return [id]
    })
    waitSpy = vi.spyOn(appStore, 'waitForTaskSettled').mockResolvedValue(undefined)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    submitSpy.mockRestore()
    waitSpy.mockRestore()
    vi.unstubAllGlobals()
    useCompetitorStore.setState({ queuePhase: 'idle', queuePaused: false, queueStopped: false })
  })

  it('显示三个指定按钮，不再显示开始串行生图', async () => {
    await act(async () => { root.render(<CompetitorWorkbench />) })
    expect(container.querySelector('[data-testid="competitor-generate-hero"]')?.textContent).toBe('生成主图')
    expect(container.querySelector('[data-testid="competitor-generate-detail"]')?.textContent).toBe('生成详情页')
    expect(container.querySelector('[data-testid="competitor-generate-option"]')?.textContent).toBe('生成选项图')
    expect(container.textContent).not.toContain('开始串行生图')
    expect(container.querySelector('[data-testid="competitor-hero-count"]')).not.toBeNull()
  })

  it('主图数量 1 和 3 分别提交对应数量的主图任务，且不含详情或选项', async () => {
    await act(async () => { root.render(<CompetitorWorkbench />) })
    const countInput = container.querySelector<HTMLInputElement>('[data-testid="competitor-hero-count"]')!
    await setInputValue(countInput, '1')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-generate-hero"]')?.click()
    })
    await flush()
    await flush()
    expect(captured).toHaveLength(1)
    expect(captured[0].prompts.join('\n')).toMatch(/hero-prompt|结实/)
    expect(captured[0].prompts.join('\n')).not.toMatch(/detail-prompt/)
    expect(useCompetitorStore.getState().session.cards.filter((item) => item.category === 'detail')[0].status).not.toBe('generating')

    captured.length = 0
    useCompetitorStore.setState({
      queuePhase: 'idle',
      queuePaused: false,
      queueStopped: false,
      session: {
        ...useCompetitorStore.getState().session,
        cards: useCompetitorStore.getState().session.cards.map((item) => (
          item.category === 'hero'
            ? { ...item, status: 'idle', resultImageId: item.id === 'hero-1' ? null : item.resultImageId, taskId: null, error: null }
            : item
        )),
      },
    })
    await setInputValue(countInput, '3')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-generate-hero"]')?.click()
    })
    await flush()
    await flush()
    expect(captured).toHaveLength(3)
    const heroCards = useCompetitorStore.getState().session.cards.filter((item) => item.category === 'hero')
    expect(heroCards.length).toBeGreaterThanOrEqual(3)
    expect(useCompetitorStore.getState().session.cards.filter((item) => item.category === 'detail')).toHaveLength(1)
    expect(useCompetitorStore.getState().session.cards.filter((item) => item.category === 'option')).toHaveLength(1)
  })

  it('详情页和选项图按钮只生成对应类型，并保留套餐名称', async () => {
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-generate-detail"]')?.click()
    })
    await flush()
    await flush()
    expect(captured).toHaveLength(1)
    expect(captured[0].prompts.join('\n')).toMatch(/detail-prompt|详情/)
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBeFalsy()

    captured.length = 0
    useCompetitorStore.setState({ queuePhase: 'idle', queuePaused: false, queueStopped: false })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-generate-option"]')?.click()
    })
    await flush()
    await flush()
    expect(captured).toHaveLength(1)
    expect(captured[0].prompts.join('\n')).toMatch(/单独一只挖掘机/)
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'option-1')?.optionName).toBe('单独一只挖掘机')
  })

  it('非法数量、未确认和重复点击不会多发请求', async () => {
    useCompetitorStore.setState({
      session: { ...useCompetitorStore.getState().session, generationConfirmed: false },
    })
    await act(async () => { root.render(<CompetitorWorkbench />) })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-generate-hero"]')?.click()
    })
    await flush()
    expect(captured).toHaveLength(0)

    useCompetitorStore.setState({
      session: { ...useCompetitorStore.getState().session, generationConfirmed: true },
    })
    const countInput = container.querySelector<HTMLInputElement>('[data-testid="competitor-hero-count"]')!
    await setInputValue(countInput, '13')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-generate-hero"]')?.click()
    })
    await flush()
    expect(captured).toHaveLength(0)
    expect(container.querySelector('[data-testid="competitor-hero-count-error"]')?.textContent).toMatch(/13/)

    await setInputValue(countInput, '1')
    useCompetitorStore.setState({ queuePhase: 'running' })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-generate-hero"]')?.click()
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-generate-detail"]')?.click()
    })
    await flush()
    expect(captured).toHaveLength(0)
  })

  it('旧成品在增加主图数量后仍保留，失败后可再次提交未完成项', async () => {
    useCompetitorStore.setState({
      session: {
        ...useCompetitorStore.getState().session,
        cards: [
          card({ id: 'hero-1', category: 'hero', refImageId: 'ref-hero', status: 'done', resultImageId: 'kept-out', imagePrompt: 'hero-prompt' }),
          card({ id: 'detail-1', category: 'detail', refImageId: 'ref-detail', status: 'done', resultImageId: 'kept-detail', imagePrompt: 'detail-prompt' }),
        ],
        generationConfirmed: true,
      },
    })
    await act(async () => { root.render(<CompetitorWorkbench />) })
    const countInput = container.querySelector<HTMLInputElement>('[data-testid="competitor-hero-count"]')!
    await setInputValue(countInput, '3')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-generate-hero"]')?.click()
    })
    await flush()
    await flush()
    expect(captured).toHaveLength(2)
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBe('kept-out')
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'detail-1')?.resultImageId).toBe('kept-detail')

    submitSpy.mockImplementationOnce(async () => {
      throw new Error('simulated failure')
    })
    useCompetitorStore.setState({
      queuePhase: 'idle',
      queuePaused: false,
      queueStopped: false,
      session: {
        ...useCompetitorStore.getState().session,
        cards: useCompetitorStore.getState().session.cards.map((item) => (
          item.id === 'hero-1' ? item : item.category === 'hero' ? { ...item, status: 'error', error: 'simulated failure', resultImageId: null } : item
        )),
      },
    })
    const before = captured.length
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="competitor-generate-hero"]')?.click()
    })
    await flush()
    await flush()
    expect(captured.length).toBeGreaterThanOrEqual(before)
    expect(useCompetitorStore.getState().session.cards.find((item) => item.id === 'hero-1')?.resultImageId).toBe('kept-out')
  })
})
