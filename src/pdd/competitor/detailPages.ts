import { claimsFromLegacySellingPoint } from './detailPlan'
import { resolveSessionDetailDirectives, type DetailFieldSource, type ResolvedDetailDirectives } from './detailOverrides'
import type { CompetitorRefImage } from './types'
import type { DetailSellingPointBlock } from './detailSellingPointBlocks'

export interface DetailPagePlan {
  sellingPointText: string
  source: DetailFieldSource
  claimIds: string[]
  refImageId: string
  sourceRefIds?: string[]
  detailBlockId?: string
  layoutSummary: string
  unconfirmedFacts: string[]
  conflictNotes: string[]
  analysisWarnings: string[]
}

/** 按换行或分号拆出卖点词，保留原文，不把一句里的逗号当作新卖点。 */
export function splitSellingPointItems(text: string): string[] {
  return text
    .split(/\r?\n+|；|;/)
    .map((item) => item.replace(/^\s*(?:\d+[\.、.)]\s*|[-•*]\s*)/, '').trim())
    .filter(Boolean)
}

export function planDetailSellingPointPages(input: {
  refs: CompetitorRefImage[]
  detailSellingPointNote?: string
  detailStyleNote?: string
  sellingPointBlocks?: DetailSellingPointBlock[]
}): { pages: DetailPagePlan[]; directives: ResolvedDetailDirectives } {
  const detailRefs = input.refs.filter((ref) => ref.category === 'detail')
  const directives = resolveSessionDetailDirectives({
    detailSellingPointNote: input.detailSellingPointNote,
    detailStyleNote: input.detailStyleNote,
    refs: input.refs,
  })
  const fallbackRefId = detailRefs[0]?.id || ''
  const layoutFromRefs = directives.style.text || detailRefs.map((ref) => ref.layoutSummary).filter(Boolean).join('；')
  const allUnconfirmed = detailRefs.flatMap((ref) => claimsFromLegacySellingPoint(ref).filter((claim) => claim.status === 'unconfirmed').map((claim) => claim.core))
  const allConflicts = detailRefs.flatMap((ref) => claimsFromLegacySellingPoint(ref).map((claim) => claim.conflictNote).filter((item): item is string => Boolean(item)))
  const allWarnings = detailRefs.flatMap((ref) => ref.analysisWarnings || [])

  const semanticBlocks = (input.sellingPointBlocks || []).filter((block) => block.sellingPointText.trim())
  if (semanticBlocks.length && !directives.userChangedSellingPoints) {
    const pages = semanticBlocks.map((block) => ({
      sellingPointText: block.sellingPointText,
      source: 'competitor_reference' as const,
      claimIds: [block.id],
      refImageId: block.sourceRefIds[0] || fallbackRefId,
      sourceRefIds: block.sourceRefIds,
      detailBlockId: block.id,
      layoutSummary: layoutFromRefs,
      unconfirmedFacts: allUnconfirmed,
      conflictNotes: allConflicts,
      analysisWarnings: allWarnings,
    }))
    return { pages, directives }
  }

  if (directives.userChangedSellingPoints) {
    const items = splitSellingPointItems(directives.sellingPoints.text)
    const pages = (items.length ? items : [directives.sellingPoints.text].filter(Boolean)).map((text, index) => ({
      sellingPointText: text,
      source: 'user_specified' as const,
      claimIds: [],
      refImageId: detailRefs[Math.min(index, Math.max(detailRefs.length - 1, 0))]?.id || fallbackRefId,
      layoutSummary: layoutFromRefs,
      unconfirmedFacts: allUnconfirmed,
      conflictNotes: allConflicts,
      analysisWarnings: allWarnings,
    }))
    return { pages, directives }
  }

  const pages: DetailPagePlan[] = []
  for (const ref of detailRefs) {
    const claims = claimsFromLegacySellingPoint(ref)
    const hasStructuredClaims = Boolean(ref.sellingPointClaims && ref.sellingPointClaims.length)
    const usable = hasStructuredClaims
      ? claims.filter((claim) => claim.status !== 'unconfirmed' && claim.status !== 'conflict')
      : []
    if (usable.length) {
      for (const claim of usable) {
        const wording = (claim.core || claim.copy || '').trim()
        if (!wording) continue
        pages.push({
          sellingPointText: wording,
          source: 'competitor_reference',
          claimIds: [claim.id],
          refImageId: ref.id,
          layoutSummary: directives.style.text || ref.layoutSummary || '',
          unconfirmedFacts: claims.filter((item) => item.status === 'unconfirmed').map((item) => item.core),
          conflictNotes: claims.map((item) => item.conflictNote).filter((item): item is string => Boolean(item)),
          analysisWarnings: ref.analysisWarnings || [],
        })
      }
      continue
    }
    const fallbackItems = splitSellingPointItems(ref.sellingPointCore || ref.sellingPoint || '')
    for (const wording of fallbackItems) {
      pages.push({
        sellingPointText: wording,
        source: ref.analysisStatus === 'user_filled' ? 'user_specified' : 'competitor_reference',
        claimIds: [],
        refImageId: ref.id,
        layoutSummary: directives.style.text || ref.layoutSummary || '',
        unconfirmedFacts: [],
        conflictNotes: [],
        analysisWarnings: ref.analysisWarnings || [],
      })
    }
  }

  // 若全部详情参考都还没有卖点，不按竞品张数硬凑生成卡；交给用户先分析或填写。
  return { pages, directives }
}
