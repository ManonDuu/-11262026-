import { optionSlotForRef, OPTION_APPEARANCE_WARNING } from './optionRules'
import type { FrameSpec } from '../types'
import { CATEGORY_LABELS, type CompetitorCategory } from './categories'
import { defaultFrameForCategory } from './frames'
import { slotsReadyForGeneration, type OptionSlotDraft } from './optionSlots'
import { planDetailSellingPointPages } from './detailPages'
import type { DetailSellingPointBlock } from './detailSellingPointBlocks'
import { buildCompetitorImagePrompt } from './promptBuild'
import { describeHeroCycleBinding, heroRefsInUploadOrder, heroSlotBindings, isProtectedHeroCard } from './heroRefCycle'
import type { CompetitorCard, CompetitorRefImage, StyleMode } from './types'
import type { TextPrimaryColor } from '../colors'

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `card-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export interface BuildPreviewInput {
  refs: CompetitorRefImage[]
  optionSlots: OptionSlotDraft[]
  styleMode: StyleMode
  textPrimaryColor?: TextPrimaryColor | null
  detailSellingPointNote?: string
  detailStyleNote?: string
  detailFrameSpec?: FrameSpec
  sellingPointBlocks?: DetailSellingPointBlock[]
  /** 主图生成张数。缺省时一张参考对应一张预览卡，以兼容旧调用。 */
  heroGenerateCount?: number
}

export function frameForRef(ref: CompetitorRefImage, category: CompetitorCategory): FrameSpec {
  return defaultFrameForCategory(category, ref.asset.width, ref.asset.height)
}


export function buildHeroCardFromRef(input: {
  ref: CompetitorRefImage
  index: number
  slotIndex: number
  round: number
  refOrdinal: number
  refCount: number
  styleMode: StyleMode
  textPrimaryColor?: TextPrimaryColor | null
  id?: string
}): CompetitorCard {
  const { ref } = input
  const frameSpec = frameForRef(ref, 'hero')
  const title = `主图 ${input.slotIndex + 1}`
  const cycleNote = describeHeroCycleBinding({
    slotIndex: input.slotIndex,
    round: input.round,
    refOrdinal: input.refOrdinal,
    refCount: input.refCount,
  })
  const imagePrompt = [
    buildCompetitorImagePrompt({
      category: 'hero',
      styleMode: input.styleMode,
      sellingPoint: ref.sellingPoint,
      optionName: ref.optionName,
      contentsNote: ref.contentsNote,
      sceneHint: ref.sceneHint,
      layoutSummary: ref.layoutSummary,
      title,
      frameSpec,
      textPrimaryColor: input.textPrimaryColor,
    }),
    cycleNote,
  ].filter(Boolean).join('\n')
  return {
    id: input.id || newId(),
    index: input.index,
    role: 'hero',
    aspectRatio: frameSpec.preset || '1:1',
    frameSpec,
    title,
    subtitle: ref.contentsNote || '',
    sceneSummary: ref.sceneHint || '',
    layoutSummary: ref.layoutSummary || '',
    imagePrompt,
    status: 'idle',
    error: null,
    taskId: null,
    resultImageId: null,
    category: 'hero',
    refImageId: ref.id,
    optionName: ref.optionName,
    contentsNote: ref.contentsNote,
    sellingPoint: ref.sellingPoint,
    sellingPointCore: ref.sellingPointCore,
    heroSlotIndex: input.slotIndex,
    heroCycleRound: input.round,
    heroRefOrdinal: input.refOrdinal,
  }
}

export function isProtectedPreviewCard(card: CompetitorCard): boolean {
  return isProtectedHeroCard(card)
}

/** 用新预览方案更新未锁定卡片，保留已有成品和手动编辑，避免静默清空。 */
export function reconcilePreviewCards(existing: CompetitorCard[], planned: CompetitorCard[]): CompetitorCard[] {
  if (!existing.length) return planned
  const used = new Set<string>()
  const next: CompetitorCard[] = []
  for (const plannedCard of planned) {
    const match = existing.find((card) => card.category === plannedCard.category && !used.has(card.id) && (plannedCard.category !== 'option' || card.refImageId === plannedCard.refImageId))
    if (match && isProtectedPreviewCard(match)) {
      used.add(match.id)
      next.push({
        ...match,
        // Explicit local preview applies only the package directive metadata. Keep pixels,
        // edited title/text/scene/layout and identity intact.
        ...(plannedCard.category === 'option' ? {
          optionCompositionNote: plannedCard.optionCompositionNote,
          optionRulesVersion: plannedCard.optionRulesVersion,
          optionSlotId: plannedCard.optionSlotId,
        } : {}),
        index: plannedCard.index,
      })
    } else if (match) {
      used.add(match.id)
      next.push({
        ...plannedCard,
        id: match.id,
        index: plannedCard.index,
      })
    } else {
      next.push(plannedCard)
    }
  }
  for (const card of existing) {
    if (!used.has(card.id) && isProtectedPreviewCard(card)) next.push(card)
  }
  return next.map((card, index) => ({ ...card, index: index + 1 }))
}

export function buildPreviewCards(input: BuildPreviewInput): { cards: CompetitorCard[]; skippedMissingOptions: number; missingDetailSellingPoints?: boolean } {
  const missingCount = slotsReadyForGeneration(input.optionSlots).missing.length
  const cards: CompetitorCard[] = []
  let index = 0
  const detailRefs = input.refs.filter((ref) => ref.category === 'detail')
  const heroRefs = heroRefsInUploadOrder(input.refs)
  const heroCount = input.heroGenerateCount ?? heroRefs.length

  for (const binding of heroSlotBindings(heroRefs, heroCount)) {
    index += 1
    cards.push(buildHeroCardFromRef({
      ref: binding.ref,
      index,
      slotIndex: binding.slotIndex,
      round: binding.round,
      refOrdinal: binding.refOrdinal,
      refCount: binding.refCount,
      styleMode: input.styleMode,
      textPrimaryColor: input.textPrimaryColor,
    }))
  }

  for (const ref of input.refs) {
    if (ref.category !== 'option') continue
    const slot = optionSlotForRef(input.optionSlots, ref)
    const userComposition = slot?.contentsNote.trim() || ''
    const optionName = slot?.optionName.trim() || ref.optionName
    const contentsNote = userComposition || ref.contentsNote
    index += 1
    const frameSpec = frameForRef(ref, ref.category)
    const title = optionName || `${CATEGORY_LABELS[ref.category]} ${index}`
    const imagePrompt = buildCompetitorImagePrompt({
      category: ref.category,
      styleMode: input.styleMode,
      sellingPoint: ref.sellingPoint,
      optionName,
      contentsNote,
      sceneHint: ref.sceneHint,
      layoutSummary: ref.layoutSummary,
      title,
      frameSpec,
      textPrimaryColor: input.textPrimaryColor,
      optionCompositionNote: userComposition,
      optionInventory: ref.optionInventory,
      optionRefId: ref.id,
    })
    cards.push({
      id: newId(),
      index,
      role: 'selling_point',
      aspectRatio: frameSpec.preset || '1:1',
      frameSpec,
      title,
      subtitle: contentsNote || '',
      sceneSummary: ref.sceneHint || '',
      layoutSummary: ref.layoutSummary || '',
      imagePrompt,
      status: 'idle',
      error: null,
      taskId: null,
      resultImageId: null,
      optionRulesVersion: 1,
      optionSlotId: slot?.id,
      optionCompositionNote: userComposition,
      analysisWarnings: userComposition ? [OPTION_APPEARANCE_WARNING] : ref.analysisWarnings,
      category: ref.category,
      refImageId: ref.id,
      optionName,
      contentsNote,
      sellingPoint: ref.sellingPoint,
      sellingPointCore: ref.sellingPointCore,
    })
  }

  const planned = planDetailSellingPointPages({
    refs: input.refs,
    detailSellingPointNote: input.detailSellingPointNote,
    detailStyleNote: input.detailStyleNote,
    sellingPointBlocks: input.sellingPointBlocks,
  })
  const detailTotal = planned.pages.length
  const detailFrame = input.detailFrameSpec || defaultFrameForCategory('detail')
  planned.pages.forEach((page, pageIndex) => {
    index += 1
    const title = `详情 ${pageIndex + 1}`
    const detailSetContext = [
      `这是按卖点分张生成的详情页第 ${pageIndex + 1}/${detailTotal} 张。本请求只生成这一张，使用现有单张画幅，不是整张长条图，也不先裁切。`,
      planned.directives.userChangedSellingPoints
        ? '本张须原样显示用户指定的卖点词，不要改回竞品原词，也不要改写成近义词。'
        : '本张须原样显示对应的卖点词原文，不要改写成近义词或同义句。',
      planned.directives.userChangedStyle
        ? '构图和风格按用户指定生成；不要因改风格而改动用户未要求修改的卖点词、产品外形或标注尺寸。'
        : '借鉴竞品构图风格，可以重新布局，不要锁死相同位置、相同版式或逐像素临摹。不要为了凑齐竞品张数而拉伸产品或构图。',
      `整套卖点词（须完整覆盖，每张对应其中一项）：${planned.pages.map((item, itemIndex) => `${itemIndex + 1}. ${item.sellingPointText}`).join('；')}`,
    ].join('\n')
    const imagePrompt = buildCompetitorImagePrompt({
      category: 'detail',
      styleMode: input.styleMode,
      sellingPoint: page.sellingPointText,
      layoutSummary: page.layoutSummary,
      title,
      frameSpec: detailFrame,
      textPrimaryColor: input.textPrimaryColor,
      confirmedFacts: [page.sellingPointText],
      unconfirmedFacts: page.unconfirmedFacts,
      conflictNotes: page.conflictNotes,
      detailSetContext,
      detailDirectives: planned.directives,
    })
    cards.push({
      id: newId(),
      index,
      role: 'detail',
      aspectRatio: detailFrame.preset || '3:4',
      frameSpec: detailFrame,
      title,
      subtitle: '',
      sceneSummary: '',
      layoutSummary: page.layoutSummary,
      imagePrompt,
      status: 'idle',
      error: null,
      taskId: null,
      resultImageId: null,
      category: 'detail',
      refImageId: page.refImageId,
      optionName: '',
      contentsNote: '',
      sellingPoint: page.sellingPointText,
      sellingPointCore: page.sellingPointText,
      sellingPointIds: page.claimIds,
      sellingPointSource: page.source,
      styleSource: planned.directives.style.source,
      analysisWarnings: page.analysisWarnings,
      detailSetIndex: pageIndex + 1,
      detailSetTotal: detailTotal,
      detailRenderMode: 'selling_point_pages',
      detailBlockId: page.detailBlockId,
      detailBlockSourceRefIds: page.sourceRefIds,
    })
  })

  return {
    cards,
    skippedMissingOptions: missingCount,
    missingDetailSellingPoints: Boolean(detailRefs.length) && planned.pages.length === 0,
  }
}
