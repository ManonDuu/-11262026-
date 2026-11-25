export const COMPETITOR_CATEGORIES = ['hero', 'detail', 'option'] as const
export type CompetitorCategory = (typeof COMPETITOR_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<CompetitorCategory, string> = {
  hero: '主图',
  detail: '详情图',
  option: '选项图',
}

/** 分析按钮与分析状态用语。详情分析入口按用户要求称为「详情页」，上传分类仍叫「详情图」。 */
export const ANALYSIS_CATEGORY_LABELS: Record<CompetitorCategory, string> = {
  hero: '主图',
  detail: '详情页',
  option: '选项图',
}

/** 三类按用途划分，不按视觉风格划分。主图包含首图及全部商品轮播。 */
export const CATEGORY_HINTS: Record<CompetitorCategory, string> = {
  hero: '包含第一张主图和后面的商品轮播图。多张竞品主图按实际上传顺序依次模仿生成；若要生成的张数多于参考主图，会从第一张再循环并重新构图，不会复用已有成品，也不按文件名排序。风格跟随竞品，不强制换背景。',
  detail: '商品详情页中的图片。分析后按每个卖点拆成参考块，便于对标；原分图仍在左侧保留，可单独管理。不提供整条详情长图预览。内部仍按上传顺序做分析分包，跨原图的卖点会关联两边内容。',
  option: '选购弹窗里每个套餐/规格对应的图，须与选项名称绑定。按对应关系分类，不限定白底或场景；缺的标成缺失，不要用主图顶替，也不要凭空补图或改配件数量。',
}

export const CATEGORY_PRESETS: Record<CompetitorCategory, readonly string[]> = {
  hero: ['1:1', '3:4'],
  detail: ['3:4', '9:16'],
  option: ['1:1', '3:4'],
}

export const CATEGORY_DEFAULT_PRESET: Record<CompetitorCategory, string> = {
  hero: '1:1',
  detail: '3:4',
  option: '1:1',
}

export const STYLE_MODE_LABELS = {
  strict: '接近竞品（默认）',
  custom: '自定义排版颜色',
} as const

export const STYLE_MODE_HINTS = {
  strict: '主图默认模仿竞品风格并重新构图，做成适合该产品类目的新图；产品和赠品外形不变，不虚构功能。详情页另有按卖点分张、默认保留卖点词原文的规则。你未填写风格时走默认；填写了就按你的风格，外形和不编造仍然适用。',
  custom: '可自行调整排版和配色，以你写的风格为准。产品和赠品外形、配件、数量仍然不能改，也不要凭空虚构功能或认证。',
} as const

export function isCompetitorCategory(value: unknown): value is CompetitorCategory {
  return value === 'hero' || value === 'detail' || value === 'option'
}
