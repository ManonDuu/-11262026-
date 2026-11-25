import { categoryConfirmed } from './categoryScope'
import { CATEGORY_LABELS, type CompetitorCategory } from './categories'
import { assessSessionDetailPlan, shouldBlockDetailGeneration } from './detailPlan'
import { assessHeroMappingCompatibility, heroRefsInUploadOrder, heroSlotBindings, isProtectedHeroCard } from './heroRefCycle'
import { buildHeroCardFromRef } from './preview'
import type { CompetitorCard, CompetitorSession } from './types'

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `card-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isFinished(card: CompetitorCard): boolean {
  return card.status === 'done' && Boolean(card.resultImageId)
}

function isBusy(card: CompetitorCard): boolean {
  return card.status === 'generating' || card.status === 'queued'
}

export function cloneHeroCard(source: CompetitorCard, index: number): CompetitorCard {
  return {
    ...source,
    id: newId(),
    index,
    status: 'idle',
    error: null,
    taskId: null,
    resultImageId: null,
    resultWidth: undefined,
    resultHeight: undefined,
    resultQuality: undefined,
    resultSizeLabel: undefined,
    generatedAt: undefined,
    lastPromptEditAt: source.lastPromptEditAt,
    lastStructuredEditAt: source.lastStructuredEditAt,
  }
}

export type PrepareCategoryGenerationResult =
  | { ok: true; category: CompetitorCategory; cardIds: string[]; cardsToAdd: CompetitorCard[]; cardsToReplace?: CompetitorCard[]; message?: string }
  | { ok: false; error: string }

function nextIndex(cards: CompetitorCard[]): number {
  return cards.reduce((max, card) => Math.max(max, card.index || 0), 0) + 1
}

/** 按类别准备本次要入队的卡片。主图数量决定任务数；已完成成品默认跳过且不会被删除。 */
export function prepareCategoryGeneration(
  session: CompetitorSession,
  category: CompetitorCategory,
  heroCount?: number,
): PrepareCategoryGenerationResult {
  const labeled = CATEGORY_LABELS[category]
  if (!categoryConfirmed(session, category)) {
    return { ok: false, error: '请先勾选预览确认，再开始生图。预览本身不扣生图费。' }
  }
  if (!session.productAssets.length) {
    return { ok: false, error: '请先上传自己的产品原图，用于锁定产品外形。' }
  }

  if (category === 'hero') {
    const count = heroCount
    if (count == null) return { ok: false, error: '请填写主图生成数量。' }
    const heroRefs = heroRefsInUploadOrder(session.refs)
    const existing = session.cards.filter((card) => card.category === 'hero')
    if (!heroRefs.length && !existing.length) {
      return { ok: false, error: '请先上传主图，并用已填内容生成本地预览。' }
    }
    if (!existing.length) {
      return { ok: false, error: '请先用已填内容生成本地预览，再生成主图。不会额外调用策划模型。' }
    }
    if (!heroRefs.length) {
      return { ok: false, error: '请先上传竞品主图，再按上传顺序生成。当前预览没有可用的主图参考。' }
    }
    const finished = existing.filter(isFinished)
    const busy = existing.filter(isBusy)
    if (finished.length >= count) {
      return {
        ok: true,
        category,
        cardIds: [],
        cardsToAdd: [],
        cardsToReplace: [],
        message: `已有 ${finished.length} 张主图成品，本次未重复生成。如需重做，请用单张「重绘这张」。已有成品不会按新的循环规则改写。`,
      }
    }
    if (busy.length) {
      return { ok: false, error: '已有主图正在生成，请等待完成后再开始新的一批，以免重复计费。' }
    }
    const bindings = heroSlotBindings(heroRefs, count)
    const cardsToAdd: CompetitorCard[] = []
    const cardsToReplace: CompetitorCard[] = []
    const cardIds: string[] = []
    let index = nextIndex(session.cards)
    for (const binding of bindings) {
      const current = existing[binding.slotIndex]
      if (!current) {
        const added = buildHeroCardFromRef({
          ref: binding.ref,
          index,
          slotIndex: binding.slotIndex,
          round: binding.round,
          refOrdinal: binding.refOrdinal,
          refCount: binding.refCount,
          styleMode: session.styleMode,
          textPrimaryColor: session.textPrimaryColor ?? null,
        })
        index += 1
        cardsToAdd.push(added)
        cardIds.push(added.id)
        continue
      }
      if (isFinished(current) || isBusy(current)) continue
      if (current.refImageId !== binding.ref.id && !isProtectedHeroCard(current)) {
        const replaced = buildHeroCardFromRef({
          ref: binding.ref,
          index: current.index,
          slotIndex: binding.slotIndex,
          round: binding.round,
          refOrdinal: binding.refOrdinal,
          refCount: binding.refCount,
          styleMode: session.styleMode,
          textPrimaryColor: session.textPrimaryColor ?? null,
          id: current.id,
        })
        cardsToReplace.push(replaced)
        cardIds.push(current.id)
        continue
      }
      cardIds.push(current.id)
    }
    if (!cardIds.length) {
      return {
        ok: true,
        category,
        cardIds: [],
        cardsToAdd: [],
        cardsToReplace: [],
        message: `没有需要新生成的主图。已有成品不会被覆盖。如需重做，请用单张「重绘这张」。`,
      }
    }
    const compatibility = assessHeroMappingCompatibility([...existing, ...cardsToAdd], session.refs, count)
    return {
      ok: true,
      category,
      cardIds,
      cardsToAdd,
      cardsToReplace,
      message: compatibility.note || undefined,
    }
  }

  const existing = session.cards.filter((card) => card.category === category)
  const refs = session.refs.filter((ref) => ref.category === category)
  if (!existing.length) {
    const hint = refs.length
      ? `请先用已填内容生成本地预览，再生成${labeled}。`
      : `请先上传${labeled}，并用已填内容生成本地预览。`
    return { ok: false, error: hint }
  }
  const busy = existing.filter(isBusy)
  if (busy.length) {
    return { ok: false, error: `已有${labeled}正在生成，请等待完成后再开始，以免重复计费。` }
  }
  const selected = existing.filter((card) => !isFinished(card))
  if (!selected.length) {
    return {
      ok: true,
      category,
      cardIds: [],
      cardsToAdd: [],
      message: `${labeled}已全部生成完成，本次未重复生成。如需重做，请用单张「重绘这张」。`,
    }
  }
  const cardIds = selected.map((card) => card.id)
  if (category === 'detail') {
    const detailCards = session.cards.filter((card) => card.category === 'detail')
    const hasLongStrip = detailCards.some((card) => card.detailRenderMode === 'long_strip')
    if (hasLongStrip) {
      return {
        ok: false,
        error: '当前详情方案仍是“先生成一张整长图再裁切”，工作台已改为按卖点分张、按现有单张尺寸生成。已有方案和成品不会自动改写或重生成。请先点击“用已填内容生成本地预览”，再生成详情页。',
      }
    }
    const assessment = assessSessionDetailPlan(session)
    const blocked = cardIds
      .map((cardId) => shouldBlockDetailGeneration(assessment, cardId))
      .filter((message): message is string => Boolean(message))
    if (blocked.length) {
      return { ok: false, error: blocked[0] }
    }
  }
  return { ok: true, category, cardIds, cardsToAdd: [] }
}
