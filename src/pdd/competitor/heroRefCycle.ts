import type { CompetitorCard, CompetitorRefImage } from './types'

export interface HeroSlotBinding<TRef = CompetitorRefImage> {
  slotIndex: number
  ref: TRef
  round: number
  refOrdinal: number
  refCount: number
}

/** 按会话中的实际上传顺序取主图参考，不按文件名或模型返回顺序排序。 */
export function heroRefsInUploadOrder<T extends { category: string }>(refs: T[]): T[] {
  return refs.filter((ref) => ref.category === 'hero')
}

export function heroSlotBindings<TRef>(heroRefs: TRef[], count: number): Array<HeroSlotBinding<TRef>> {
  if (!heroRefs.length || !Number.isInteger(count) || count <= 0) return []
  return Array.from({ length: count }, (_, slotIndex) => ({
    slotIndex,
    ref: heroRefs[slotIndex % heroRefs.length],
    round: Math.floor(slotIndex / heroRefs.length) + 1,
    refOrdinal: (slotIndex % heroRefs.length) + 1,
    refCount: heroRefs.length,
  }))
}

export function expectedHeroRefForSlot<TRef>(heroRefs: TRef[], slotIndex: number): TRef | undefined {
  if (!heroRefs.length || slotIndex < 0) return undefined
  return heroRefs[slotIndex % heroRefs.length]
}

export function heroCardSlotIndex(cards: CompetitorCard[], cardId: string): number {
  return cards.filter((card) => card.category === 'hero').findIndex((card) => card.id === cardId)
}

export function isProtectedHeroCard(card: Pick<CompetitorCard, 'resultImageId' | 'status' | 'lastStructuredEditAt' | 'lastPromptEditAt' | 'sellingPointSource' | 'styleSource'>): boolean {
  return Boolean(
    card.resultImageId
    || card.status === 'done'
    || card.status === 'generating'
    || card.status === 'queued'
    || card.lastStructuredEditAt
    || card.lastPromptEditAt
    || card.sellingPointSource === 'user_specified'
    || card.styleSource === 'user_specified',
  )
}

export function describeHeroCycleBinding(binding: Pick<HeroSlotBinding, 'slotIndex' | 'round' | 'refOrdinal' | 'refCount'>): string {
  const base = `本张是第 ${binding.slotIndex + 1} 张主图，按实际上传顺序参考第 ${binding.refOrdinal} 张竞品主图（共 ${binding.refCount} 张），只模仿这一张并重新构图，不要按文件名或模型返回顺序另选参考图。`
  if (binding.round > 1) {
    return `${base} 这是第 ${binding.round} 轮循环参考，必须重新构图生成新图，不要复用上一轮已生成的成品，也不要凭空捏造或虚构产品功能。`
  }
  return `${base} 不要凭空捏造或虚构产品功能。`
}

export function describeHeroReferenceForPrompt(
  refs: Array<{ id: string; category: string }>,
  card: Pick<CompetitorCard, 'id' | 'refImageId'>,
  slotIndex: number,
): string {
  const heroRefs = heroRefsInUploadOrder(refs)
  if (!heroRefs.length) return '本张只参考已绑定的这一张竞品主图，必须重新构图，不要凭空捏造或虚构产品功能。'
  const boundIndex = heroRefs.findIndex((ref) => ref.id === card.refImageId)
  const expected = expectedHeroRefForSlot(heroRefs, slotIndex)
  const mismatch = Boolean(expected && boundIndex >= 0 && heroRefs[boundIndex].id !== (expected as { id: string }).id)
  if (boundIndex >= 0) {
    const binding: HeroSlotBinding = {
      slotIndex: Math.max(0, slotIndex),
      ref: heroRefs[boundIndex] as CompetitorRefImage,
      round: Math.floor(Math.max(0, slotIndex) / heroRefs.length) + 1,
      refOrdinal: boundIndex + 1,
      refCount: heroRefs.length,
    }
    const text = describeHeroCycleBinding(binding)
    if (mismatch) {
      return `${text} 本张仍使用已绑定的参考图重绘，不是按最新循环规则重新对位后的结果。`
    }
    return text
  }
  return '本张只参考已绑定的这一张竞品主图，必须重新构图，不要凭空捏造或虚构产品功能。'
}

export function assessHeroMappingCompatibility(
  cards: CompetitorCard[],
  refs: Array<{ id: string; category: string }>,
  count: number,
): { aligned: boolean; mismatchedProtected: number; note: string | null } {
  const heroRefs = heroRefsInUploadOrder(refs)
  const heroCards = cards.filter((card) => card.category === 'hero')
  if (!heroRefs.length || !heroCards.length) return { aligned: true, mismatchedProtected: 0, note: null }
  const bindings = heroSlotBindings(heroRefs, Math.max(count, heroCards.length))
  let mismatchedProtected = 0
  heroCards.slice(0, Math.max(count, heroCards.length)).forEach((card, slotIndex) => {
    const expected = bindings[slotIndex]?.ref as { id: string } | undefined
    if (expected && card.refImageId !== expected.id && isProtectedHeroCard(card)) mismatchedProtected += 1
  })
  if (mismatchedProtected) {
    return {
      aligned: false,
      mismatchedProtected,
      note: `已有 ${mismatchedProtected} 张主图成品或手改文案仍使用原来的参考绑定，不会按最新循环规则改写或宣称它们已按新顺序对位。新增或未锁定的主图会按实际上传顺序循环对位。如需给未完成的空卡更新对位，请再点「用已填内容生成本地预览」。`,
    }
  }
  if (heroCards.length < count && heroRefs.length < count) {
    return {
      aligned: true,
      mismatchedProtected: 0,
      note: `将按实际上传顺序循环参考 ${heroRefs.length} 张竞品主图，生成 ${count} 张主图；第二轮起重新构图，不会复用已有成品。`,
    }
  }
  return { aligned: true, mismatchedProtected: 0, note: null }
}
