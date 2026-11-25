export type DetailFieldSource = 'user_specified' | 'competitor_reference' | 'unconfirmed' | 'empty'

export interface ResolvedDetailField {
  text: string
  source: DetailFieldSource
}

export interface ResolveDetailDirectivesInput {
  competitorSellingPoints?: string[]
  competitorStyle?: string
  userSellingPoint?: string
  userStyle?: string
  userChangedShape?: boolean
  userChangedDimensions?: boolean
  userShapeNote?: string
  userDimensionNote?: string
}

export interface ResolvedDetailDirectives {
  sellingPoints: ResolvedDetailField
  style: ResolvedDetailField
  lockProductShape: boolean
  lockLabeledDimensions: boolean
  userChangedSellingPoints: boolean
  userChangedStyle: boolean
}

export function hasExplicitText(value?: string | null): boolean {
  return Boolean(value && value.trim())
}

/** 逐字段覆盖：用户只改风格时保留默认卖点，只改卖点时保留默认构图风格。 */
export function resolveDetailDirectives(input: ResolveDetailDirectivesInput): ResolvedDetailDirectives {
  const competitorSelling = (input.competitorSellingPoints || []).map((item) => item.trim()).filter(Boolean)
  const competitorStyle = input.competitorStyle?.trim() || ''
  const userSelling = input.userSellingPoint?.trim() || ''
  const userStyle = input.userStyle?.trim() || ''

  const sellingPoints: ResolvedDetailField = userSelling
    ? { text: userSelling, source: 'user_specified' }
    : competitorSelling.length
      ? { text: competitorSelling.join('；'), source: 'competitor_reference' }
      : { text: '', source: 'empty' }

  const style: ResolvedDetailField = userStyle
    ? { text: userStyle, source: 'user_specified' }
    : competitorStyle
      ? { text: competitorStyle, source: 'competitor_reference' }
      : { text: '', source: 'empty' }

  return {
    sellingPoints,
    style,
    lockProductShape: !input.userChangedShape,
    lockLabeledDimensions: !input.userChangedDimensions,
    userChangedSellingPoints: Boolean(userSelling),
    userChangedStyle: Boolean(userStyle),
  }
}

export const DETAIL_BASE_RULES = `详情页生成共用规则：
- 按现有模型单张尺寸和用户已选比例，根据对标卖点分张生成。不要生成一整张超长图再裁切，也不要为了凑齐竞品张数而拉伸产品或构图。
- 不要照搬竞品品牌 logo、水印或店铺标识。
- 必须区分：用户指定值、来自竞品参考的引用事实、以及待确认/不确定内容。不要凭空填补尚未提供或看不清的剩余事实。
- 如存在用户商品资料与竞品参数的冲突，不得静默套用。
- 未经授权，不要混入主图一般营销点。`

export const DETAIL_DEFAULT_SELLING_POINT_RULE = '默认卖点规则：用户未另行指定卖点时，按竞品对标卖点分张生成，完整覆盖已确认卖点，并原样保留、显示卖点词原文，不得改写成近义词或同义句，不得遗漏、替换、增加、夸大或合并到失真。'
export const DETAIL_USER_SELLING_POINT_RULE = '用户已明确修改或指定卖点，必须以用户写下的卖点词原文为准，不要改回竞品原词，也不要把“卖点词不能改变”理解成覆盖用户输入。不要凭空添加用户未写的卖点。'
export const DETAIL_DEFAULT_STYLE_RULE = '默认构图风格规则：用户未另行指定构图或风格时，借鉴竞品构图风格并重构新详情；构图风格是参考，不是锁死相同布局、相同版式或逐像素位置。保持构图风格不等于可以改卖点事实、产品外形或标注尺寸。'
export const DETAIL_USER_STYLE_RULE = '用户已明确指定构图或风格，按用户的风格要求生成；不要因为改风格而改动用户未要求修改的卖点、产品外形或标注尺寸。'
export const DETAIL_LOCK_SHAPE_RULE = '用户未要求改变产品外形：产品外形必须保持不变，以用户产品原图为准，不得换成竞品外形，也不得拉伸变形。'
export const DETAIL_LOCK_DIMENSION_RULE = '用户未要求改变标注尺寸：产品上已标注的尺寸、规格数值和单位必须保持不变；看不清或缺证据的参数不得编造或画成事实。'

export function buildDetailGenerationRules(directives: ResolvedDetailDirectives): string {
  const lines = ['详情页生成规则（必须遵守）：']
  if (directives.userChangedSellingPoints) lines.push(`1. ${DETAIL_USER_SELLING_POINT_RULE}`)
  else lines.push(`1. ${DETAIL_DEFAULT_SELLING_POINT_RULE}`)
  if (directives.userChangedStyle) lines.push(`2. ${DETAIL_USER_STYLE_RULE}`)
  else lines.push(`2. ${DETAIL_DEFAULT_STYLE_RULE}`)
  if (directives.lockProductShape) lines.push(`3. ${DETAIL_LOCK_SHAPE_RULE}`)
  if (directives.lockLabeledDimensions) lines.push(`4. ${DETAIL_LOCK_DIMENSION_RULE}`)
  lines.push(DETAIL_BASE_RULES)
  if (directives.sellingPoints.source !== 'empty') {
    const label = directives.sellingPoints.source === 'user_specified' ? '用户指定卖点' : '引用竞品卖点（默认）'
    lines.push(`${label}：${directives.sellingPoints.text}`)
  }
  if (directives.style.source !== 'empty') {
    const label = directives.style.source === 'user_specified' ? '用户指定构图/风格' : '默认借鉴的构图风格'
    lines.push(`${label}：${directives.style.text}`)
  }
  return lines.join('\n')
}

export function appendResolvedDetailConstraints(basePrompt: string, directives: ResolvedDetailDirectives): string {
  const rules = buildDetailGenerationRules(directives)
  if (basePrompt.includes(rules)) return basePrompt
  let cleaned = basePrompt.replace(/详情页生成规则（必须遵守）：[\s\S]*?(?:\n\n|$)/g, '\n')
  if (directives.userChangedSellingPoints) {
    cleaned = cleaned
      .replace(/每个卖点事实必须保持不变[^\n]*/g, '')
      .replace(/每个卖点不能改变[^\n]*/g, '')
      .replace(/克隆同样的卖点事实[^\n]*/g, '')
      .replace(/默认卖点规则：[^\n]*/g, '')
  }
  return `${cleaned.trim()}\n\n${rules}`
}

export function collectUserStyleNote(input: {
  detailStyleNote?: string
  layoutSummary?: string
  styleMode?: string
  textPrimaryColorName?: string
  layoutIsUserFilled?: boolean
}): string {
  const parts: string[] = []
  if (input.detailStyleNote?.trim()) parts.push(input.detailStyleNote.trim())
  if (input.layoutIsUserFilled && input.layoutSummary?.trim()) parts.push(input.layoutSummary.trim())
  else if (!input.detailStyleNote?.trim() && input.styleMode === 'custom' && input.layoutSummary?.trim()) {
    // custom style mode with a layout note counts as user style only when the user actually typed it via detailStyleNote or user-filled layout
  }
  if (input.detailStyleNote?.trim() && input.styleMode === 'custom' && input.textPrimaryColorName) {
    parts.push(`主色：${input.textPrimaryColorName}`)
  }
  return parts.join('；')
}

export function collectUserSellingPoint(input: {
  userSellingPoint?: string
  analysisStatus?: string
  cardSellingPoint?: string
  competitorSellingPoint?: string
  sellingPointSource?: DetailFieldSource
}): string {
  if (input.sellingPointSource === 'user_specified' && input.cardSellingPoint?.trim()) return input.cardSellingPoint.trim()
  if (input.userSellingPoint?.trim()) return input.userSellingPoint.trim()
  if (input.analysisStatus === 'user_filled' && input.cardSellingPoint?.trim()) return input.cardSellingPoint.trim()
  return ''
}


export interface DetailDirectiveSourceInput {
  detailSellingPointNote?: string
  detailStyleNote?: string
  refs?: Array<{
    category?: string
    sellingPoint?: string
    sellingPointCore?: string
    analysisStatus?: string
    layoutSummary?: string
  }>
  cards?: Array<{
    category?: string
    sellingPoint?: string
    sellingPointSource?: DetailFieldSource
    layoutSummary?: string
    styleSource?: DetailFieldSource
  }>
}

export function resolveSessionDetailDirectives(
  session: DetailDirectiveSourceInput,
  card?: {
    sellingPoint?: string
    sellingPointSource?: DetailFieldSource
    layoutSummary?: string
    styleSource?: DetailFieldSource
  },
): ResolvedDetailDirectives {
  const detailRefs = (session.refs || []).filter((ref) => !ref.category || ref.category === 'detail')
  const competitorPoints = detailRefs
    .filter((ref) => ref.analysisStatus !== 'user_filled')
    .map((ref) => (ref.sellingPointCore || ref.sellingPoint || '').trim())
    .filter(Boolean)
  const userRefPoints = detailRefs
    .filter((ref) => ref.analysisStatus === 'user_filled')
    .map((ref) => (ref.sellingPoint || '').trim())
    .filter(Boolean)
  const competitorStyle = detailRefs
    .map((ref) => (ref.layoutSummary || '').trim())
    .filter(Boolean)
    .join('；')

  let userSellingPoint = session.detailSellingPointNote?.trim() || ''
  if (!userSellingPoint && card?.sellingPointSource === 'user_specified' && card.sellingPoint?.trim()) {
    userSellingPoint = card.sellingPoint.trim()
  }
  if (!userSellingPoint && userRefPoints.length) {
    userSellingPoint = [...userRefPoints, ...competitorPoints].join('；')
  }

  let userStyle = session.detailStyleNote?.trim() || ''
  if (!userStyle && card?.styleSource === 'user_specified' && card.layoutSummary?.trim()) {
    userStyle = card.layoutSummary.trim()
  }

  return resolveDetailDirectives({
    competitorSellingPoints: competitorPoints,
    competitorStyle,
    userSellingPoint,
    userStyle,
  })
}
