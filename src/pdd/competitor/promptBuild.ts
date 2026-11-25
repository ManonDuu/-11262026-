import { buildOptionGenerationRules, type OptionInventoryItem } from './optionRules'
import type { TextPrimaryColor } from '../colors'
import { describeFrame, frameFromPreset } from '../frameSpec'
import { APPEARANCE_LOCK, assembleImagePrompt } from '../prompts'
import type { FrameSpec } from '../types'
import { CATEGORY_LABELS, type CompetitorCategory } from './categories'
import { buildDetailGenerationRules, type ResolvedDetailDirectives } from './detailOverrides'
import { buildHeroGenerationRules, heroUserChangedStyle } from './heroRules'
import type { StyleMode } from './types'

export interface CompetitorPromptInput {
  optionCompositionNote?: string
  optionInventory?: OptionInventoryItem[]
  optionRefId?: string
  category: CompetitorCategory
  styleMode: StyleMode
  sellingPoint: string
  optionName?: string
  contentsNote?: string
  sceneHint?: string
  layoutSummary?: string
  title?: string
  subtitle?: string
  frameSpec?: FrameSpec
  textPrimaryColor?: TextPrimaryColor | null
  detailSetContext?: string
  confirmedFacts?: string[]
  unconfirmedFacts?: string[]
  conflictNotes?: string[]
  forbiddenHeroPoints?: string[]
  detailDirectives?: ResolvedDetailDirectives
  styleSource?: 'user_specified' | 'competitor_reference' | 'unconfirmed' | 'empty'
  heroStyleNote?: string
}

const QUALITY_LIFT =
  '在贴近参考的前提下，提高清晰度、构图完整性、配色和谐度和信息层次，使整张图比参考图更好看、更好读。不要为了“更好”而编造参考中没有的卖点、功能、配件、赠品或数量。'

const STYLE_FOLLOW =
  '默认优先模仿竞对的排版结构、卖点信息层次和场景类别，同时让画面不要看起来像逐像素复制。保留同一类场景，只调整同类背景细节、拍摄角度或局部摆放：例如参考是草坪，就换另一处草坪，而不是改成沙滩、室内或其他场景。不要另起一套完全不同的设计，也不要为了求变化而改产品外形、配件或数量。'

const TRADEMARK_RULE =
  '不要照搬竞对商标、水印、店铺标识或无法确认适用于自家产品的认证/奖项。产品外观必须以用户提供的产品原图为准，外形、配件、赠品和数量不得改变。'

const PURCHASE_UI_RULE =
  '不要把价格、预计送达、优惠券、倒计时或购买按钮等动态购买界面画进图里，也不要把它们当作卖点。'

const OPTION_STYLE_RULE =
  '选项图按选购套餐/规格的对应关系分类，不限定必须是白底或必须有场景。风格跟随该选项自己的参考图。'

export const COPY_RULE =
  '文案须保持竞品核心卖点的语义，不要照抄原句；改写成更清楚、更好读、更有吸引力的表达。画面和文案一起优化。不要添加参考图或已确认卖点中没有出现、也未经用户证实的参数、功能、效果承诺或认证。'

export function buildCompetitorImagePrompt(input: CompetitorPromptInput): string {
  const categoryLabel = CATEGORY_LABELS[input.category]
  const sellingPoint = input.sellingPoint.trim()
  const optionName = input.optionName?.trim() || ''
  const contentsNote = input.contentsNote?.trim() || ''
  const parts: string[] = []

  const directives = input.detailDirectives
  if (input.category === 'detail') {
    const sellingGuide = directives?.userChangedSellingPoints
      ? '卖点以用户写下的卖点词原文为准，不要改回竞品原词，也不要凭空添加用户未写的卖点。'
      : '用户未另行指定卖点时，按竞品对标卖点分张生成，本张必须原样显示对应卖点词原文，不得改写成近义词或同义句。'
    const styleGuide = directives?.userChangedStyle
      ? '构图和风格按用户指定生成。'
      : '用户未另行指定构图或风格时，借鉴竞品构图风格；构图风格是参考，可以重新布局，不要锁死相同位置。不要生成一整张超长图再裁切，也不要为凑齐竞品张数而拉伸产品。'
    parts.push(`这是一张拼多多「${categoryLabel}」。${sellingGuide}${styleGuide}未要求修改的产品外形和标注尺寸必须保持不变。`)
    parts.push(buildDetailGenerationRules(directives ?? {
      sellingPoints: { text: input.sellingPoint.trim(), source: input.sellingPoint.trim() ? 'competitor_reference' : 'empty' },
      style: { text: input.layoutSummary?.trim() || '', source: 'competitor_reference' },
      lockProductShape: true,
      lockLabeledDimensions: true,
      userChangedSellingPoints: false,
      userChangedStyle: false,
    }))
  } else if (input.category === 'hero') {
    const userChangedStyle = heroUserChangedStyle({
      styleMode: input.styleMode,
      styleSource: input.styleSource,
      heroStyleNote: input.heroStyleNote,
    })
    parts.push(`这是一张拼多多「${categoryLabel}」。默认模仿竞品风格并重新构图，生成一张适合该产品类目的新主图；产品和赠品外形不能改变，也不要凭空捏造虚构功能。`)
    parts.push(buildHeroGenerationRules({ userChangedStyle }))
  } else {
    parts.push(`这是一张拼多多「${categoryLabel}」。目标是做跟竞品差不多的模仿，并在画质和信息表达上更好，而不是另做一套完全不同的风格。`)
    parts.push(STYLE_FOLLOW)
  }
  if (input.category === 'option') parts.push(buildOptionGenerationRules({refId: input.optionRefId, userComposition: input.optionCompositionNote, inventory: input.optionInventory}))
  parts.push(QUALITY_LIFT)
  parts.push(TRADEMARK_RULE)
  parts.push(PURCHASE_UI_RULE)
  if (input.category === 'detail' && directives?.userChangedSellingPoints) {
    parts.push('文案须原样使用用户写下的卖点词，不要改回竞品原词，不要改写成近义词，也不要添加用户未写的能力、参数或效果承诺。')
  } else if (input.category === 'detail') {
    parts.push('文案须原样保留并显示本张对应的卖点词原文，不要改写成近义词或同义句，也不要添加参考图中没有、也未经用户证实的参数、功能、效果承诺或认证。')
  } else {
    parts.push(COPY_RULE)
  }

  if (input.category === 'option') {
    parts.push(OPTION_STYLE_RULE)
    if (optionName) parts.push(`当前选项名称：${optionName}。必须与该套餐/规格一一对应，不得改成其他选项，也不得用主图或其他套餐的图顶替。`)
    if (contentsNote) parts.push(`该选项的搭配说明：${contentsNote}。如有本套餐用户指定搭配则以其为准，否则不得增减或编造。`)
    else parts.push('该选项若未写明配件与数量，不要臆造配件或数量差异。')
  }

  if (sellingPoint) {
    if (input.category === 'detail' && directives?.userChangedSellingPoints) {
      parts.push(`用户指定卖点词原文（必须原样显示，不要改回竞品原词）：${sellingPoint}。不要凭空添加用户未写的卖点。`)
    } else if (input.category === 'detail') {
      parts.push(`本张须原样显示的卖点词原文（不得改写、近义替换或同义句改写）：${sellingPoint}`)
    } else {
      parts.push(`核心卖点语义（须保持，不得增加未经证实的能力）：${sellingPoint}。文案不要照抄原句，要用更好的表达说出同一个卖点。`)
    }
  } else {
    parts.push('卖点尚未确认，不要编造新卖点；只根据已给出的选项名称和产品约束构图。')
  }
  if (input.category === 'detail') {
    if (directives?.userChangedSellingPoints) {
      parts.push(`用户指定卖点词：${sellingPoint}。这是用户明确修改，不是模型擅自改点。`)
    } else if (input.confirmedFacts?.length) {
      parts.push(`本张须原样显示的卖点词原文：${input.confirmedFacts.join('；')}。不得改写或改成别的词。`)
    }
    if (input.unconfirmedFacts?.length) {
      parts.push(`待确认、不得画成事实：${input.unconfirmedFacts.join('；')}`)
    }
    if (input.conflictNotes?.length) {
      parts.push(`冲突提示，不得静默套用不适用参数：${input.conflictNotes.join('；')}`)
    }
    if (input.forbiddenHeroPoints?.length) {
      parts.push(`未经授权，不要混入这些主图营销点：${input.forbiddenHeroPoints.join('；')}`)
    }
    if (input.detailSetContext?.trim()) parts.push(input.detailSetContext.trim())
  }

  const layout = input.layoutSummary?.trim() || ''
  const includeUserLayout = Boolean(
    layout
    && (
      input.styleMode === 'custom'
      || input.styleSource === 'user_specified'
      || directives?.userChangedStyle
    ),
  )

  if (input.styleMode === 'strict') {
    if (input.category === 'hero') {
      parts.push('风格模式：接近竞品。模仿竞品风格并重新构图成为新的主图，风格须适合产品类目，不要逐像素复制。')
    } else {
      parts.push('风格模式：接近竞品。优先模仿竞对排版，画面相似但不要一模一样；同类场景只做细节变化，不更换场景类别。')
    }
  } else if (input.category === 'detail' && directives?.userChangedSellingPoints) {
    parts.push('风格模式：自定义排版颜色。可按用户指定调整排版和配色；卖点以用户指定为准，未要求修改的产品外形、配件、数量和标注尺寸保持不变。')
  } else {
    parts.push('风格模式：自定义排版颜色。可按用户指定调整排版和配色，但仍须保持产品、配件、数量和卖点不变，也不要无故丢掉参考中的必要信息结构。')
  }
  if (includeUserLayout) parts.push(`用户指定排版：${layout}`)

  if (input.sceneHint?.trim()) parts.push(`场景提示：${input.sceneHint.trim()}`)
  if (input.title?.trim()) parts.push(`主标题：${input.title.trim()}`)
  if (input.subtitle?.trim()) parts.push(`副标题：${input.subtitle.trim()}`)

  if (input.category === 'option' && input.optionCompositionNote?.trim()) parts.push('优先级澄清：上面的默认保留配件/赠品/数量或竞品文案限制，不得用于否决本套餐用户指定的搭配变更；外形保真与禁止编造功能仍适用。')
  const frame = input.frameSpec || frameFromPreset('1:1')
  const draft = parts.filter(Boolean).join('\n')
  return assembleImagePrompt({
    imagePrompt: draft.includes('绝对指令') ? draft : `${APPEARANCE_LOCK}\n${draft}`,
    title: input.title,
    subtitle: input.subtitle,
    role: input.category === 'hero' ? 'hero' : input.category === 'detail' ? 'detail' : undefined,
    frameSpec: frame,
    textPrimaryColor: input.styleMode === 'custom' ? input.textPrimaryColor ?? null : null,
  }) + `\n画幅：${describeFrame(frame)}`
}
