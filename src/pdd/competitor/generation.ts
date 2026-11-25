import { categoryConfirmed } from './categoryScope'
import { resolveOptionCardRules } from './optionRules'
import { getImageDimensions } from '../../lib/db'
import { submitTask, useStore, waitForTaskSettled } from '../../store'
import { frameFromPreset } from '../frameSpec'
import { collectInputImages } from '../generationInputs'
import { buildImageTaskParams } from '../imageParams'
import { failedCardPatch, shouldSyncFieldsIntoPrompt, succeededCardPatch } from '../promptSync'
import { assembleImagePrompt } from '../prompts'
import type { ProductAsset } from '../types'
import { assessSessionDetailPlan, appendDetailConstraints, claimsFromLegacySellingPoint, describeDetailSetContext, shouldBlockDetailGeneration } from './detailPlan'
import { resolveSessionDetailDirectives } from './detailOverrides'
import { describeHeroReferenceForPrompt, heroCardSlotIndex } from './heroRefCycle'
import { appendHeroConstraints, heroUserChangedStyle } from './heroRules'
import { buildCompetitorImagePrompt } from './promptBuild'
import { resolveSharedImageModel } from '../sharedModels'
import { useCompetitorStore } from './store'
import type { CompetitorCard, CompetitorSession } from './types'

function snapshotGenerationSettings() {
  const { settings, params } = useStore.getState()
  return { model: settings.model, apiMode: settings.apiMode, params }
}

function applyGenerationSettings(imageModel?: string) {
  const store = useStore.getState()
  if (imageModel) store.setSettings({ model: imageModel, apiMode: 'images' })
}

function restoreGenerationSettings(snapshot: ReturnType<typeof snapshotGenerationSettings>) {
  const store = useStore.getState()
  store.setSettings({ model: snapshot.model, apiMode: snapshot.apiMode })
  store.setParams(snapshot.params)
}

export function collectCompetitorInputAssets(cardId: string): ProductAsset[] {
  const session = useCompetitorStore.getState().session
  const card = session.cards.find((item) => item.id === cardId)
  if (!card) throw new Error('找不到对应卡片')
  if (card.category === 'option' && !session.refs.some((ref) => ref.id === card.refImageId && ref.category === 'option')) throw new Error('该选项缺少对应竞品参考，请重新绑定并更新本地预览；不会借用其他套餐或自动重做成品。')
  if (card.category === 'option') {
    const slot = session.optionSlots.find((item) => item.boundRefId === card.refImageId)
    if ((slot?.contentsNote.trim() || '') !== (card.optionCompositionNote?.trim() || '')) throw new Error('该套餐搭配要求与当前预览不一致，请先更新本地预览；已有成品和逐张编辑会保留，不会自动重做。')
  }
  const assets: ProductAsset[] = [...session.productAssets]
  const blockRefIds = card.detailBlockSourceRefIds?.length ? card.detailBlockSourceRefIds : [card.refImageId]
  for (const refId of blockRefIds) {
    const ref = session.refs.find((item) => item.id === refId)
    if (ref?.asset && !assets.some((asset) => (asset.imageId || asset.id) === (ref.asset.imageId || ref.asset.id))) {
      assets.push(ref.asset)
    }
  }
  return assets
}


function detailPromptExtras(session: CompetitorSession, card: CompetitorCard) {
  const directives = resolveSessionDetailDirectives(session, card)
  const ref = session.refs.find((item) => item.id === card.refImageId)
  const claims = ref ? claimsFromLegacySellingPoint(ref) : []
  const confirmedFacts = directives.userChangedSellingPoints
    ? [card.sellingPoint].filter(Boolean)
    : [card.sellingPoint].filter(Boolean)
  const unconfirmedFacts = claims.filter((claim) => claim.status === 'unconfirmed').map((claim) => claim.core)
  const conflictNotes = [
    ...claims.map((claim) => claim.conflictNote).filter((item): item is string => Boolean(item)),
    ...(card.analysisWarnings || []),
  ]
  const detailCores = session.refs.filter((item) => item.category === 'detail').flatMap((item) => claimsFromLegacySellingPoint(item))
  const forbiddenHeroPoints = session.refs
    .filter((item) => item.category === 'hero')
    .map((item) => item.sellingPoint.trim())
    .filter((point) => point && !detailCores.some((claim) => claim.core.includes(point) || (claim.copy || '').includes(point)))
  return {
    confirmedFacts,
    unconfirmedFacts,
    conflictNotes,
    forbiddenHeroPoints,
    detailDirectives: directives,
    sellingPointOverride: directives.userChangedSellingPoints ? (card.sellingPoint.trim() || directives.sellingPoints.text) : undefined,
    detailSetContext: describeDetailSetContext({
      cards: session.cards.filter((item) => item.category === 'detail'),
      currentCardId: card.id,
      refs: session.refs,
    }),
  }
}


export function resolveCompetitorCardPrompt(cardId: string): string {
  const session = useCompetitorStore.getState().session
  const card = session.cards.find((item) => item.id === cardId)
  const prompt = resolveBaseCompetitorCardPrompt(cardId)
  return card?.category === 'option' ? `${prompt}\n最终套餐规则（如与旧预览默认清单冲突，以本张明确搭配为准）：\n${resolveOptionCardRules(session, card)}` : prompt
}

function resolveBaseCompetitorCardPrompt(cardId: string): string {
  const session = useCompetitorStore.getState().session
  const card = session.cards.find((item) => item.id === cardId)
  if (!card) throw new Error('找不到对应卡片')
  const frameSpec = card.frameSpec || frameFromPreset(card.aspectRatio)
  const extras = card.category === 'detail' ? detailPromptExtras(session, card) : undefined
  const heroCycleNote = card.category === 'hero'
    ? describeHeroReferenceForPrompt(session.refs, card, heroCardSlotIndex(session.cards, card.id))
    : ''
  if (shouldSyncFieldsIntoPrompt(card)) {
    const built = buildCompetitorImagePrompt({
      category: card.category,
      styleMode: session.styleMode,
      sellingPoint: extras?.sellingPointOverride || card.sellingPoint,
      optionName: card.optionName,
      contentsNote: card.contentsNote,
      optionCompositionNote: card.optionCompositionNote,
      optionInventory: session.refs.find((ref) => ref.id === card.refImageId)?.optionInventory,
      optionRefId: card.refImageId,
      sceneHint: card.sceneSummary,
      layoutSummary: extras?.detailDirectives?.userChangedStyle ? extras.detailDirectives.style.text : card.layoutSummary,
      styleSource: card.styleSource,
      title: card.title,
      subtitle: card.subtitle,
      frameSpec,
      textPrimaryColor: session.textPrimaryColor ?? null,
      ...extras,
    })
    return heroCycleNote && !built.includes(heroCycleNote) ? `${built}\n${heroCycleNote}` : built
  }
  const assembled = assembleImagePrompt({
    imagePrompt: card.imagePrompt,
    title: card.title,
    subtitle: card.subtitle,
    role: card.category === 'hero' ? 'hero' : card.category === 'detail' ? 'detail' : undefined,
    frameSpec,
    textPrimaryColor: session.styleMode === 'custom' ? session.textPrimaryColor ?? null : null,
  })
  if (card.category === 'hero') {
    const constrained = appendHeroConstraints(assembled, {
      userChangedStyle: heroUserChangedStyle({
        styleMode: session.styleMode,
        styleSource: card.styleSource,
        userEditedPrompt: true,
      }),
    })
    return heroCycleNote && !constrained.includes(heroCycleNote) ? `${constrained}\n${heroCycleNote}` : constrained
  }
  if (card.category !== 'detail' || !extras) return assembled
  const parts = [appendDetailConstraints(assembled, { directives: extras.detailDirectives })]
  if (extras.detailDirectives.userChangedSellingPoints) {
    parts.push(`用户指定卖点词原文（必须原样显示，不要改回竞品原词）：${extras.sellingPointOverride || card.sellingPoint}。不要凭空添加用户未写的卖点。`)
  } else if (extras.confirmedFacts.length) {
    parts.push(`本张须原样显示的卖点词原文：${extras.confirmedFacts.join('；')}。不得改写或改成别的词。`)
  }
  if (extras.detailDirectives.userChangedStyle) {
    parts.push(`用户指定构图/风格：${extras.detailDirectives.style.text}`)
  }
  if (extras.unconfirmedFacts.length) parts.push(`待确认、不得画成事实：${extras.unconfirmedFacts.join('；')}`)
  if (extras.conflictNotes.length) parts.push(`冲突提示，不得静默套用不适用参数：${extras.conflictNotes.join('；')}`)
  if (extras.forbiddenHeroPoints.length) parts.push(`未经授权，不要混入这些主图营销点：${extras.forbiddenHeroPoints.join('；')}`)
  if (extras.detailSetContext) parts.push(extras.detailSetContext)
  return parts.join('\n')
}

/** 只检查将要发送的构造，不调用 submitTask。 */
export function inspectCompetitorGenerationInput(cardId: string) {
  return {
    prompt: resolveCompetitorCardPrompt(cardId),
    assetIds: collectCompetitorInputAssets(cardId).map((asset) => asset.imageId || asset.id),
  }
}

export async function generateCompetitorCard(cardId: string, options?: { imageModel?: string; requireConfirm?: boolean }): Promise<void> {
  const state = useCompetitorStore.getState()
  if (state.generationInFlight) return
  if (state.analysisInFlight) throw new Error('正在分析参考图，请等当前分析结束。')
  // Acquire before decoding/storage awaits; ephemeral, never infer a live operation
  // from stale persisted card statuses after a page reload.
  useCompetitorStore.setState({ generationInFlight: cardId })
  try { await generateCompetitorCardUnlocked(cardId, options) }
  finally { useCompetitorStore.setState({ generationInFlight: null }) }
}

async function generateCompetitorCardUnlocked(cardId: string, options?: { imageModel?: string; requireConfirm?: boolean }): Promise<void> {
  const initial = useCompetitorStore.getState()
  const existing = initial.session.cards.find((item) => item.id === cardId)
  if (!existing) throw new Error('找不到对应卡片')
  if (initial.analysisInFlight) throw new Error('正在分析参考图，请等当前分析结束，避免同时提交模型任务。')
  if (existing.status === 'generating') return
  if ((options?.requireConfirm ?? true) && !categoryConfirmed(initial.session, existing.category)) {
    throw new Error('请先预览确认后再开始生图。分析或预览不会扣生图费。')
  }
  if (!initial.session.productAssets.length) {
    throw new Error('请先上传自己的产品原图，用于锁定产品外形。')
  }

  const inputImages = await collectInputImages(collectCompetitorInputAssets(cardId))
  if (!inputImages.length) throw new Error('缺少参考图，无法生图')

  const store = useCompetitorStore.getState()
  const card = store.session.cards.find((item) => item.id === cardId)
  if (!card) throw new Error('找不到对应卡片')
  if (card.category === 'detail' && card.detailRenderMode === 'long_strip') {
    throw new Error('当前详情方案仍是“先生成一张整长图再裁切”，工作台已改为按卖点分张、按现有单张尺寸生成。已有方案和成品不会自动改写或重生成。请先点击“用已填内容生成本地预览”，再生成详情页。')
  }
  if (card.category === 'detail') {
    const blocked = shouldBlockDetailGeneration(assessSessionDetailPlan(store.session), cardId)
    if (blocked) throw new Error(blocked)
  }
  if (store.analysisInFlight) throw new Error('正在分析参考图，请等当前分析结束后再主动生成。')
  const prompt = resolveCompetitorCardPrompt(cardId)
  const frameSpec = card.frameSpec || frameFromPreset(card.aspectRatio)
  const keepUserPrompt = !shouldSyncFieldsIntoPrompt(card)
  store.patchCard(cardId, {
    status: 'generating',
    error: null,
    imagePrompt: keepUserPrompt ? card.imagePrompt : prompt,
    lastStructuredEditAt: card.lastStructuredEditAt ?? Date.now(),
  })

  const snapshot = snapshotGenerationSettings()
  let taskId: string | undefined
  try {
    applyGenerationSettings(options?.imageModel || resolveSharedImageModel(store.session.imageModel))
    useStore.getState().setParams(buildImageTaskParams(useStore.getState().params, frameSpec))
    const ids = await submitTask({ input: { prompts: [prompt], inputImages } })
    taskId = ids[0]
    if (!taskId) throw new Error('任务没有启动（可能被校验拦截）。请检查设置后手动重试，系统不会自动重试。')
    store.patchCard(cardId, { taskId })
    await waitForTaskSettled(taskId, () => false)
    const task = useStore.getState().tasks.find((item) => item.id === taskId)
    if (!task) throw new Error('任务记录丢失')
    if (task.status === 'error') throw new Error(task.error || '生图失败')
    const resultImageId = task.outputImages?.[0]
    if (!resultImageId) throw new Error('生图完成但没有返回图片')
    const dims = await getImageDimensions(resultImageId)
    const actual = task.actualParamsByImage?.[resultImageId] ?? task.actualParams
    store.patchCard(cardId, succeededCardPatch({
      taskId,
      resultImageId,
      width: dims?.width,
      height: dims?.height,
      quality: actual?.quality ?? null,
      sizeLabel: actual?.size ?? null,
    }))
  } catch (err) {
    const latest = useCompetitorStore.getState().session.cards.find((item) => item.id === cardId)
    store.patchCard(cardId, failedCardPatch(latest ?? existing, err instanceof Error ? err.message : String(err), taskId))
    throw err
  } finally {
    restoreGenerationSettings(snapshot)
  }
}

export async function runCompetitorQueue(cardIds: string[], imageModel?: string): Promise<void> {
  const state = useCompetitorStore.getState()
  if (state.queuePhase === 'running' || state.queuePhase === 'planning' || state.generationInFlight) return
  if (state.analysisInFlight) throw new Error('正在分析参考图，请等当前分析结束。')
  if (cardIds.some((id) => { const card = state.session.cards.find((item) => item.id === id); return !card || !categoryConfirmed(state.session, card.category) })) throw new Error('请先预览确认后再开始生图。分析或预览不会扣生图费。')
  state.setQueue({ phase: 'running', cursor: 0, stopped: false, paused: false, activeCardId: null })
  for (let i = 0; i < cardIds.length; i += 1) {
    const current = useCompetitorStore.getState()
    if (current.queueStopped) {
      current.setQueue({ phase: 'stopped', activeCardId: null })
      return
    }
    while (useCompetitorStore.getState().queuePaused && !useCompetitorStore.getState().queueStopped) {
      useCompetitorStore.getState().setQueue({ phase: 'paused' })
      await new Promise((resolve) => window.setTimeout(resolve, 200))
    }
    const latest = useCompetitorStore.getState()
    if (latest.queueStopped) {
      latest.setQueue({ phase: 'stopped', activeCardId: null })
      return
    }
    const cardId = cardIds[i]
    latest.setQueue({ phase: 'running', cursor: i, activeCardId: cardId })
    latest.patchCard(cardId, { status: 'queued', error: null })
    try {
      await generateCompetitorCard(cardId, { imageModel, requireConfirm: true })
    } catch {
      useCompetitorStore.getState().setQueue({ phase: 'stopped', activeCardId: null })
      return
    }
  }
  useCompetitorStore.getState().setQueue({ phase: 'idle', activeCardId: null, paused: false, stopped: false })
}

export function pauseCompetitorQueue() {
  const state = useCompetitorStore.getState()
  if (state.queuePhase === 'running') state.setQueue({ paused: true, phase: 'paused' })
}

export function resumeCompetitorQueue() {
  const state = useCompetitorStore.getState()
  if (state.queuePhase === 'paused') state.setQueue({ paused: false, phase: 'running' })
}

export function stopCompetitorQueue() {
  useCompetitorStore.getState().setQueue({ stopped: true, paused: false, phase: 'stopped', activeCardId: null })
}
