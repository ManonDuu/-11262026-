export interface HeroDirectiveOptions {
  userChangedStyle?: boolean
}

export const HERO_DEFAULT_STYLE_RULE =
  '默认主图风格规则：模仿竞品的整体风格（如色彩气质、信息层次、视觉调性），但必须重新构图，生成一张新的主图，不要做成逐像素临摹或只改局部细节的复制图。风格必须适合该产品类目，不要套用与类目不符的视觉风格。'

export const HERO_USER_STYLE_RULE =
  '用户已明确指定主图风格或排版配色，按用户的风格要求生成；不要因此改变产品和赠品外形，也不要虚构功能。'

export const HERO_LOCK_SHAPE_RULE =
  '产品和赠品（含套餐内可见配件/赠品）的外形、结构和数量必须保持不变，以用户产品原图为准，不得换成竞品外形，也不得拉伸变形或增减赠品。'

export const HERO_NO_INVENT_RULE =
  '不要凭空捏造或虚构产品功能、参数、效果承诺、认证，或参考中没有的配件与卖点。'

export const HERO_BASE_RULES =
  '不要照搬竞品品牌 logo、水印或店铺标识。主图不要把价格、预计送达等购买界面画进图里。主图规则不要混入详情页的卖点词原文逐字照搬，也不要按详情长图或分张裁切来生成主图。'

export function buildHeroGenerationRules(options: HeroDirectiveOptions = {}): string {
  const lines = ['主图生成规则（必须遵守）：']
  if (options.userChangedStyle) lines.push(`1. ${HERO_USER_STYLE_RULE}`)
  else lines.push(`1. ${HERO_DEFAULT_STYLE_RULE}`)
  lines.push(`2. ${HERO_LOCK_SHAPE_RULE}`)
  lines.push(`3. ${HERO_NO_INVENT_RULE}`)
  lines.push(HERO_BASE_RULES)
  return lines.join('\n')
}

export function appendHeroConstraints(basePrompt: string, options: HeroDirectiveOptions = {}): string {
  const rules = buildHeroGenerationRules(options)
  if (basePrompt.includes(rules) || basePrompt.includes('主图生成规则（必须遵守）')) {
    if (options.userChangedStyle && basePrompt.includes('默认主图风格规则：')) {
      const cleaned = basePrompt.replace(/默认主图风格规则：[^\n]*/g, '')
      return `${cleaned.trim()}\n\n${rules}`
    }
    if (!basePrompt.includes('主图生成规则（必须遵守）')) {
      return `${basePrompt.trim()}\n\n${rules}`
    }
    return basePrompt
  }
  return `${basePrompt.trim()}\n\n${rules}`
}

export function heroUserChangedStyle(input: {
  styleMode?: string
  styleSource?: string
  heroStyleNote?: string
  userEditedPrompt?: boolean
}): boolean {
  return Boolean(
    input.styleMode === 'custom'
    || input.styleSource === 'user_specified'
    || input.heroStyleNote?.trim()
    || input.userEditedPrompt,
  )
}
