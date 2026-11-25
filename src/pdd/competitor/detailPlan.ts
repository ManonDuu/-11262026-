import { appendResolvedDetailConstraints, type ResolvedDetailDirectives } from './detailOverrides'
import type { CompetitorCard, CompetitorRefImage, SellingPointClaim, SellingPointClaimStatus, SellingPointOrigin } from './types'

/** 这些文案必须进入详情分析与最终生图请求。只能约束模型输入，不能证明模型百分百遵从。 */
export const DETAIL_ANALYSIS_RULES = `详情图须优先依据有序完整长图或分段长图（仅用于分析参考，不是要求生成整张长图），从上到下梳理各段核心卖点，并归纳可借鉴的构图风格（例如信息密度、图文主次、节奏）。
构图风格只是参考，不是要求相同布局、相同版式或逐像素位置；整理构图风格时不要把位置锁死，也不要把“保持风格”理解成可以改卖点词。
sellingPointCore 必须逐字摘录参考图已经写出的卖点词原文，不得改成近义词或同义句，不得遗漏、替换、增加、夸大，也不得把不同卖点合并到含义失真。
sellingPointCopy 如需另写，只能作为备注，不能代替原文，也不得改变含义。
产品外形和已标注的尺寸、规格数值与单位必须如实记录，看不清或缺证据时不得编造，也不要把疑似 OCR 文本直接写成既定事实，应列入 unconfirmed 或 warnings。
多个独立卖点必须分别列出，不要合成一条含糊的新卖点。
若提供了用户商品资料，并与竞品卖点中的具体参数冲突，必须在 warnings/conflicts 中写明，不得静默套用竞品上不适用于用户商品的参数。
区分参考图确证卖点与用户补充卖点：用户补充仅在输入中明确给出时采用。未经授权，不要把主图一般营销点写入详情结果。`

export const DETAIL_GENERATION_RULES = `详情页生成规则（必须遵守）：
1. 根据竞品对标卖点分张生成，克隆一样的卖点词。构图风格是参考，可以重新布局，不要锁死相同位置或版式。保持构图风格不等于可以改卖点词、产品外形或标注尺寸。
2. 用户未另行指定卖点时，必须原样保留并显示卖点词原文，不得改写成近义词或同义句，不得遗漏、替换、增加、夸大或合并到失真。
3. 产品外形不能改变，必须以用户产品原图为准，不得换成竞品外形，也不得拉伸变形。
4. 产品上已标注的尺寸、规格数值和单位不能改变；看不清或缺证据的参数不得编造或画成事实。
5. 不要凭空添加卖点或参数。不要照搬竞品品牌 logo、水印或店铺标识。
6. 按现有模型单张尺寸和用户已选比例逐张生成，不要生成一整张超长图再裁切，也不要为了凑齐竞品张数而拉伸产品或构图。
7. 如存在用户商品资料与竞品卖点的参数冲突，不得静默采用不适用于用户商品的参数。
8. 未经授权，不要混入主图一般营销点或用户未确认的补充卖点。用户已明确修改的卖点或风格以用户输入为准。`

export function createClaimId(refId: string, index: number, hint = ''): string {
  const normalized = hint.replace(/\s+/g, '').slice(0, 12)
  return `sp-${refId}-${index}${normalized ? `-${normalized}` : ''}`
}

export function normalizeClaimText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function claimsFromLegacySellingPoint(ref: Pick<CompetitorRefImage, 'id' | 'sellingPoint' | 'sellingPointCore' | 'sellingPointClaims'>): SellingPointClaim[] {
  if (ref.sellingPointClaims && ref.sellingPointClaims.length > 0) return ref.sellingPointClaims
  const core = (ref.sellingPointCore || ref.sellingPoint || '').trim()
  if (!core) return []
  return [{
    id: createClaimId(ref.id, 1),
    core: ref.sellingPointCore?.trim() || core,
    copy: ref.sellingPoint.trim() || undefined,
    origin: 'competitor_reference',
    status: 'confirmed',
  }]
}

export function parseClaimsFromAnalysisRow(
  refId: string,
  row: {
    sellingPointCore?: string
    sellingPointCopy?: string
    sellingPoints?: unknown
    unconfirmedFacts?: unknown
  },
): SellingPointClaim[] {
  if (Array.isArray(row.sellingPoints) && row.sellingPoints.length > 0) {
    return row.sellingPoints.flatMap((item, index) => {
      if (!item || typeof item !== 'object') return []
      const rec = item as Record<string, unknown>
      const core = typeof rec.core === 'string' ? rec.core.trim() : ''
      if (!core) return []
      const origin: SellingPointOrigin = rec.origin === 'user_supplied' ? 'user_supplied' : 'competitor_reference'
      const status: SellingPointClaimStatus = rec.status === 'unconfirmed' || rec.status === 'conflict' ? rec.status : 'confirmed'
      return [{
        id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : createClaimId(refId, index + 1, core),
        core,
        copy: typeof rec.copy === 'string' ? rec.copy.trim() : undefined,
        origin,
        status,
        evidenceNote: typeof rec.evidenceNote === 'string' ? rec.evidenceNote.trim() : undefined,
        conflictNote: typeof rec.conflictNote === 'string' ? rec.conflictNote.trim() : undefined,
      }]
    })
  }
  const core = (row.sellingPointCore || '').trim()
  const copy = (row.sellingPointCopy || '').trim()
  if (!core && !copy) return []
  const unconfirmed = Array.isArray(row.unconfirmedFacts) && row.unconfirmedFacts.length > 0
  return [{
    id: createClaimId(refId, 1, core || copy),
    core: core || copy,
    copy: copy || undefined,
    origin: 'competitor_reference',
    status: unconfirmed ? 'unconfirmed' : 'confirmed',
  }]
}

export interface UserProductFact {
  text: string
  label?: string
}

const PARAM_PATTERN = /([\u4e00-\u9fffA-Za-z]{1,12})\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z\u4e00-\u9fff]+)?/g

export function extractLabeledQuantities(text: string): Array<{ label: string; value: string; unit: string }> {
  const results: Array<{ label: string; value: string; unit: string }> = []
  const copied = String(text)
  copied.replace(PARAM_PATTERN, (full, label: string, value: string, unit = '') => {
    results.push({ label: label.trim(), value, unit: unit.trim() })
    return full
  })
  return results
}

export function detectParamConflicts(competitorText: string, userFacts: UserProductFact[]): string[] {
  const competitorParams = extractLabeledQuantities(competitorText)
  const conflicts: string[] = []
  for (const fact of userFacts) {
    const userParams = extractLabeledQuantities(fact.text)
    for (const userParam of userParams) {
      const match = competitorParams.find((item) => item.label === userParam.label && item.unit.toLowerCase() === userParam.unit.toLowerCase())
      if (match && match.value !== userParam.value) {
        conflicts.push(`用户商品资料中的「${userParam.label} ${userParam.value}${userParam.unit}」与竞品卖点「${match.label} ${match.value}${match.unit}」冲突，不得静默套用竞品参数。`)
      }
    }
  }
  return conflicts
}

export interface DetailPlanIssue {
  code: 'missing_claim' | 'unsourced_claim' | 'fact_changed' | 'param_conflict' | 'unconfirmed_as_fact' | 'unauthorized_hero_point' | 'merged_claims'
  message: string
  claimId?: string
  cardId?: string
}

export interface DetailPlanAssessment {
  checkable: boolean
  reason?: string
  issues: DetailPlanIssue[]
  confirmedClaimIds: string[]
  cardClaimIds: Record<string, string[]>
}

export function collectUserProductFacts(input: { productName?: string; productFactsNote?: string }): UserProductFact[] {
  const facts: UserProductFact[] = []
  if (input.productFactsNote?.trim()) {
    for (const line of input.productFactsNote.split(/[\n；;]/)) {
      if (line.trim()) facts.push({ text: line.trim() })
    }
  }
  if (input.productName?.trim() && extractLabeledQuantities(input.productName).length > 0) {
    facts.push({ text: input.productName.trim(), label: 'productName' })
  }
  return facts
}

export function assessDetailPlan(input: {
  detailRefs: CompetitorRefImage[]
  detailCards: CompetitorCard[]
  userFacts?: UserProductFact[]
  heroSellingPoints?: string[]
  userSpecifiedSellingPoints?: boolean
}): DetailPlanAssessment {
  const structured = input.detailRefs.some((ref) => (ref.sellingPointClaims && ref.sellingPointClaims.length > 0) || Boolean(ref.sellingPointCore))
  if (!structured && input.detailCards.every((card) => !card.sellingPointIds?.length && !card.sellingPointCore)) {
    return {
      checkable: false,
      reason: '当前详情方案缺少段落卖点映射，无法自动校验整套覆盖。不会自动重新分析或生图；如需按新规则校验，请手动重新分析并预览确认。',
      issues: [],
      confirmedClaimIds: [],
      cardClaimIds: {},
    }
  }

  const sourceClaims = input.detailRefs.flatMap((ref) => claimsFromLegacySellingPoint(ref))
  const confirmed = sourceClaims.filter((claim) => claim.origin === 'competitor_reference' && claim.status === 'confirmed')
  const confirmedIds = new Set(confirmed.map((claim) => claim.id))
  const sourceById = new Map(sourceClaims.map((claim) => [claim.id, claim]))
  const issues: DetailPlanIssue[] = []
  const cardClaimIds: Record<string, string[]> = {}
  const usedIds = new Set<string>()

  for (const card of input.detailCards) {
    const ids = card.sellingPointIds?.length
      ? card.sellingPointIds
      : claimsFromLegacySellingPoint({
        id: card.refImageId || card.id,
        sellingPoint: card.sellingPoint,
        sellingPointCore: card.sellingPointCore,
      }).map((claim) => claim.id)
    cardClaimIds[card.id] = ids
    for (const id of ids) {
      usedIds.add(id)
      const source = sourceById.get(id)
      if (!source) {
        issues.push({ code: 'unsourced_claim', message: `详情卡新增了无来源卖点（${id}），不得写入生成事实。`, claimId: id, cardId: card.id })
        continue
      }
      const plannedCore = normalizeClaimText(card.sellingPointCore || (ids.length === 1 ? card.sellingPoint : source.core))
      if (source.status === 'confirmed' && plannedCore && plannedCore !== normalizeClaimText(source.core)) {
        issues.push({ code: 'fact_changed', message: `卖点「${source.core}」被改写成「${card.sellingPointCore || card.sellingPoint}」，事实含义已改变。`, claimId: id, cardId: card.id })
      }
      if (source.status === 'unconfirmed') {
        const rendered = `${card.sellingPoint} ${card.imagePrompt || ''}`
        if (normalizeClaimText(rendered).includes(normalizeClaimText(source.core))) {
          issues.push({ code: 'unconfirmed_as_fact', message: `待确认内容「${source.core}」被当作既定事实写入方案，不得用于生图。`, claimId: id, cardId: card.id })
        }
      }
    }
    const userFacts = input.userFacts || []
    const inspectText = [card.sellingPointCore, card.sellingPoint, sourceById.get(ids[0] || '')?.core].filter(Boolean).join(' ')
    for (const conflict of detectParamConflicts(inspectText, userFacts)) {
      issues.push({ code: 'param_conflict', message: conflict, cardId: card.id, claimId: ids[0] })
    }
  }

  for (const claim of confirmed) {
    if (!usedIds.has(claim.id)) {
      issues.push({ code: 'missing_claim', message: `整套详情页遗漏了参考卖点「${claim.core}」。`, claimId: claim.id })
    }
  }

  const unauthorized = (input.heroSellingPoints || []).map((text) => text.trim()).filter(Boolean)
  for (const card of input.detailCards) {
    const haystack = `${card.sellingPoint}\n${card.imagePrompt || ''}`
    for (const point of unauthorized) {
      if (point.length >= 2 && haystack.includes(point) && !sourceClaims.some((claim) => claim.core.includes(point) || (claim.copy && claim.copy.includes(point)))) {
        issues.push({ code: 'unauthorized_hero_point', message: `未经授权，不得把主图营销点「${point}」混入详情页。`, cardId: card.id })
      }
    }
  }

  const filtered = input.userSpecifiedSellingPoints
    ? issues.filter((issue) => issue.code !== 'missing_claim' && issue.code !== 'fact_changed' && issue.code !== 'unsourced_claim')
    : issues

  return {
    checkable: true,
    issues: filtered,
    confirmedClaimIds: confirmed.map((claim) => claim.id),
    cardClaimIds,
  }
}

export function blockingIssuesForCard(assessment: DetailPlanAssessment, cardId: string): DetailPlanIssue[] {
  return assessment.issues.filter((issue) => (
    (issue.cardId === cardId || issue.code === 'missing_claim')
    && (issue.code === 'param_conflict' || issue.code === 'missing_claim' || issue.code === 'unsourced_claim' || issue.code === 'fact_changed' || issue.code === 'unconfirmed_as_fact')
  ))
}

export function shouldBlockDetailGeneration(assessment: DetailPlanAssessment, cardId: string): string | null {
  if (!assessment.checkable) return null
  const blocking = blockingIssuesForCard(assessment, cardId)
  if (!blocking.length) return null
  return `详情页存在未解决的卖点或参数问题，已中止该卡生图，避免套用不真实内容：${blocking.map((issue) => issue.message).join(' ')}`
}

export function describeDetailSetContext(input: {
  cards: CompetitorCard[]
  currentCardId: string
  refs?: CompetitorRefImage[]
}): string {
  const ordered = [...input.cards].sort((a, b) => (a.detailSetIndex ?? a.index) - (b.detailSetIndex ?? b.index))
  const currentIndex = ordered.findIndex((card) => card.id === input.currentCardId)
  const total = ordered.length
  const lines = [
    `这是按卖点分张生成的详情页第 ${currentIndex >= 0 ? currentIndex + 1 : 1}/${Math.max(total, 1)} 张。请借鉴竞品构图风格并与整套其他详情图保持风格连贯，但可以重新布局，不要锁死相同位置。本请求只生成这一张，使用现有单张画幅，不是整张长条图。`,
    '整套卖点词（须完整覆盖；未由用户改写的项目须原样显示原文）：',
  ]
  ordered.forEach((card, index) => {
    const text = card.sellingPoint.trim() || '（该张卖点未填写）'
    const mark = card.id === input.currentCardId ? '（当前屏）' : ''
    lines.push(`${index + 1}. ${text}${mark}`)
  })
  const unconfirmed = (input.refs || []).flatMap((ref) => claimsFromLegacySellingPoint(ref)).filter((claim) => claim.status === 'unconfirmed')
  if (unconfirmed.length) {
    lines.push(`待确认、不得画成事实：${unconfirmed.map((claim) => claim.core).join('；')}`)
  }
  const conflicts = (input.refs || []).flatMap((ref) => claimsFromLegacySellingPoint(ref)).filter((claim) => claim.status === 'conflict' || claim.conflictNote)
  if (conflicts.length) {
    lines.push(`冲突提示（不得静默套用）：${conflicts.map((claim) => claim.conflictNote || claim.core).join('；')}`)
  }
  return lines.join('\n')
}

export function appendDetailConstraints(basePrompt: string, options?: { alreadyIncludes?: boolean; directives?: ResolvedDetailDirectives }): string {
  if (options?.alreadyIncludes) return basePrompt
  if (options?.directives) return appendResolvedDetailConstraints(basePrompt, options.directives)
  if (basePrompt.includes('用户已明确修改或指定卖点') || basePrompt.includes('默认卖点规则：')) return basePrompt
  return appendResolvedDetailConstraints(basePrompt, { sellingPoints: { text: '', source: 'empty' }, style: { text: '', source: 'empty' }, lockProductShape: true, lockLabeledDimensions: true, userChangedSellingPoints: false, userChangedStyle: false })
}

export function oldPlanCoverageHint(assessment: DetailPlanAssessment): string | null {
  if (assessment.checkable) {
    const conflicts = assessment.issues.filter((issue) => issue.code === 'param_conflict' || issue.code === 'fact_changed' || issue.code === 'missing_claim' || issue.code === 'unsourced_claim')
    if (conflicts.length) return conflicts.map((issue) => issue.message).join(' ')
    return null
  }
  return assessment.reason || null
}

export function assessSessionDetailPlan(session: {
  productName?: string
  productFactsNote?: string
  detailSellingPointNote?: string
  refs: CompetitorRefImage[]
  cards: CompetitorCard[]
}): DetailPlanAssessment {
  const userSpecifiedSellingPoints = Boolean(session.detailSellingPointNote?.trim())
    || session.refs.some((ref) => ref.category === 'detail' && ref.analysisStatus === 'user_filled' && ref.sellingPoint.trim())
    || session.cards.some((card) => card.category === 'detail' && card.sellingPointSource === 'user_specified')
  return assessDetailPlan({
    detailRefs: session.refs.filter((item) => item.category === 'detail'),
    detailCards: session.cards.filter((item) => item.category === 'detail'),
    userFacts: collectUserProductFacts({ productName: session.productName, productFactsNote: session.productFactsNote }),
    heroSellingPoints: session.refs.filter((item) => item.category === 'hero').map((item) => item.sellingPoint),
    userSpecifiedSellingPoints,
  })
}
