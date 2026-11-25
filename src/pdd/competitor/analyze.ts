import { parseOptionInventory } from './optionRules'
import { getActiveApiProfile } from '../../lib/apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../lib/devProxy'
import { useStore } from '../../store'
import { prepareReferenceAssets, ReferenceImageError } from '../referenceImage'
import type { CompetitorCategory } from './categories'
import { ANALYSIS_CATEGORY_LABELS, CATEGORY_LABELS } from './categories'
import {
  analysisBlockedBySkippedSources,
  DETAIL_STRIP_MAX_HEIGHT,
  DETAIL_STRIP_MAX_PIXELS,
  detailRefsInUploadOrder,
  layoutDetailStrip,
  type DetailStripLayout,
} from './detailStrip'
import { claimsFromLegacySellingPoint, parseClaimsFromAnalysisRow } from './detailPlan'
import { blocksFromAnalysisPayload, fallbackBlocksFromClaims, type DetailSellingPointBlock } from './detailSellingPointBlocks'
import { createDetailStripPreview, type DecodePixelsFn, type EncodeSliceFn } from './detailStripPreview'
import type { CompetitorRefImage } from './types'

export const ANALYSIS_TIMEOUT_MS = 300_000

export const ANALYSIS_SYSTEM_PROMPT = `你是电商图片卖点分析编辑。根据用户给出的竞品参考图，提取已经出现的核心卖点，并归纳可借鉴的构图风格。构图风格不是相同布局或逐像素位置。只输出一个 JSON 对象，不要 markdown 围栏，不要解释。

规则：
- 选项图须逐图识别可见的主商品、赠品、配件，输出 optionInventory:[{role:"main"|"gift"|"accessory",name:"物品名",quantity:整数或null,appearance:"图中可见形状结构"}]。数量/角色看不清须注明，不能猜测。该清单只记录图中观察，不把用户要求但图中没有的东西伪称已看见。默认逐图一对一重构、保留实物形状结构数量、不编造物品或功能。用户套餐搭配要求仅作用于对应 refId，不要用原清单否决用户明确改搭配；新物缺外形依据则提示补实拍，不虚构细节。
- 主图和选项图仍是每张输入图对应 results 中的一项，id 必须使用输入中给出的 refId。
- 详情参考图可能以一张按上传先后顺序从上到下纵向拼接的长图提供；若因尺寸上限分段，会按顺序标注第 i/N 段及纵坐标范围。不要把整张长图只写成一项，也不要按散图或文件名顺序重排。必须按从上到下的原分图顺序，为每个列出的详情 refId 各输出一项；分段时要衔接各段，不要重复或遗漏。
- sellingPointCore 写该图已经表达的核心卖点语义，不要发明参考图中没有的功能、参数、效果或认证。
- sellingPointCopy 在同一语义下改写成更清楚、更好读、更有吸引力的中文，不要照抄图上原句。
- sceneCategory 写场景类别（如草坪、白底、室内），不要改成其他类别。
- layoutSummary 概括排版结构与信息层次。
- 选项图须填写 optionName 和 contentsNote（产品/配件/数量），看不清就留空并在 warnings 说明，不要编造数量。
- 价格、预计送达、购买按钮不是卖点，不要写入 sellingPointCore。
- 不确定就留空字符串，并在 warnings 说明，不要用假数据填满。
- 详情图额外规则：优先依据有序完整长图或分段长图梳理各段核心卖点（长图仅用于分析参考，不是要求后续生成整张长图），并归纳可借鉴的构图风格；构图风格只是参考，不要锁死相同布局或逐像素位置，也不要把保持风格当成可以改卖点词。产品外形和已标注尺寸必须如实记录。sellingPointCore 必须逐字摘录参考图已写出的卖点词原文，不得改成近义词或同义句，不得遗漏、替换、增加、夸大，也不得把不同卖点合并到含义失真。sellingPointCopy 只能作为备注，不能代替原文。多个独立卖点须在可选字段 sellingPoints 中分别列出。看不清或缺证据的参数、尺寸、材质、认证、性能不得编造，也不要把疑似 OCR 写成既定事实，应列入 warnings 或 unconfirmedFacts。若输入中的用户商品资料与竞品参数冲突，必须写入 warnings，不得静默套用。区分参考图确证卖点与用户补充卖点；未经授权不要把主图一般营销点写入详情结果。
- 另外按从上到下的阅读顺序，在 JSON 顶层给出 sellingPointBlocks：每个卖点一项，包含 id、core（卖点词原文）、sourceRefIds、sliceIndex（所属分析段的序号，从 1 计）、yStart、yEnd（该段内从上到下的像素坐标，0 为该段顶）、uncertainBounds。一个卖点如跨段或跨原分图，把各段范围放进 spans 数组，仍只算一个卖点。坐标必须落在已提供的段内，看不清边界时把 uncertainBounds 设为 true，不要编造。这些边界用于按卖点裁出参考块，不是要求生成整张长图。`

export interface AnalysisStripMeta {
  index: number
  total: number
  yStart: number
  yEnd: number
  width: number
  height: number
  sourceRefIds: string[]
}

export interface AnalysisImageInput {
  refId: string
  category: CompetitorCategory
  optionName?: string
  contentsNote?: string
  dataUrl?: string
  role?: 'reference' | 'detail-strip'
  strip?: AnalysisStripMeta
}

export interface AnalysisSuggestion {
  optionInventory?: import('./optionRules').OptionInventoryItem[]
  refId: string
  sellingPointCore: string
  sellingPointCopy: string
  sceneCategory: string
  layoutSummary: string
  optionName: string
  contentsNote: string
  warnings: string[]
  sellingPoints?: import('./types').SellingPointClaim[]
  unconfirmedFacts?: string[]
}

export function filterRefsForAnalysis(refs: CompetitorRefImage[], category?: CompetitorCategory): CompetitorRefImage[] {
  if (!category) return [...refs]
  return refs.filter((ref) => ref.category === category)
}

export function analysisCategoryLabel(category?: CompetitorCategory): string {
  return category ? ANALYSIS_CATEGORY_LABELS[category] : '参考图'
}

export function buildAnalysisUserPrompt(images: AnalysisImageInput[], productName = '', productFactsNote = '', detailNotes?: { sellingPoint?: string; style?: string }, category?: CompetitorCategory): string {
  const userSelling = category === 'hero' || category === 'option' ? '' : (detailNotes?.sellingPoint?.trim() || '')
  const userStyle = category === 'hero' || category === 'option' ? '' : (detailNotes?.style?.trim() || '')
  const scope = category
    ? `本次只分析「${ANALYSIS_CATEGORY_LABELS[category]}」，只为这一类已提供的参考图输出 results。不要编造未发送的其他类别，也不要改写用户未提供的商品要点。`
    : '请分析下面这些竞品参考图。'
  const lines = [
    productName ? `用户产品名称：${productName}` : '用户产品名称未填。',
    productFactsNote.trim() ? `用户确认的自家商品要点：${productFactsNote.trim()}` : '未提供额外的自家商品要点。不要用主图一般营销点填补详情卖点。',
    category === 'detail' || !category
      ? (userSelling ? `用户已指定详情卖点（以此为准，不要改回竞品原卖点，也不要用“卖点不能改变”覆盖用户输入）：${userSelling}` : '用户未指定详情卖点，请按竞品详情参考梳理卖点事实。')
      : '本次不要求分析详情卖点词。',
    category === 'detail' || !category
      ? (userStyle ? `用户已指定详情构图/风格（按用户要求归纳，不要覆盖未修改的卖点）：${userStyle}` : '用户未指定构图或风格，请归纳可借鉴的竞品构图风格。')
      : '本次不要求改写详情构图说明。',
    `${scope}主图和选项图仍按单张列出；详情图若已纵向拼接，会以长图或分段长图提供。详情图请先按从上到下的顺序梳理各段核心卖点词原文，并归纳可借鉴的构图风格（不是相同版式或锁定位置）。这些卖点将用于按点分张生成，而不是再生成一张整长图。用户未填写的字段才按竞品参考；用户已填写的卖点或风格优先。未要求修改的产品外形和标注尺寸不得自由发挥改写。`,
    ...images.map((image, index) => describeAnalysisImage(image, index)),
    ...buildDetailStripPromptLines(images),
    '输出 JSON：{"results":[{"refId":"","sellingPointCore":"","sellingPointCopy":"","sceneCategory":"","layoutSummary":"","optionName":"","contentsNote":"","warnings":[],"unconfirmedFacts":[],"sellingPoints":[{"id":"","core":"","copy":"","origin":"competitor_reference","status":"confirmed","evidenceNote":"","conflictNote":""}]}]}。sellingPoints 用于分别列出同一详情段中的多个独立卖点；请同时给出 sellingPointBlocks（按阅读顺序的卖点词原文、sourceRefIds、sliceIndex 与段内 yStart/yEnd）；旧的 results 字段仍必填。',
  ]
  return lines.join('\n')
}

export function describeAnalysisImage(image: AnalysisImageInput, index: number): string {
  if (image.role === 'detail-strip' && image.strip) {
    return `${index + 1}. 详情参考长图第 ${image.strip.index}/${image.strip.total} 段（纵坐标 ${image.strip.yStart}–${image.strip.yEnd}，${image.strip.width}×${image.strip.height}），覆盖原分图 refId=${image.strip.sourceRefIds.join('、')}。不要把这一段本身当作一个 refId 结果。`
  }
  const option = image.optionName ? `，已填套餐：${image.optionName}` : ''
  const contents = image.contentsNote ? `，已填配件数量：${image.contentsNote}` : ''
  return `${index + 1}. refId=${image.refId}，类别=${CATEGORY_LABELS[image.category]}${option}${contents}`
}

export function buildDetailStripPromptLines(images: AnalysisImageInput[]): string[] {
  const strips = images.filter((image) => image.role === 'detail-strip' && image.strip)
  if (strips.length === 0) return []
  const order = strips[0].strip?.sourceRefIds ?? []
  if (strips.length > 1) {
    const seen = new Set<string>()
    const all: string[] = []
    for (const image of strips) {
      for (const refId of image.strip?.sourceRefIds ?? []) {
        if (seen.has(refId)) continue
        seen.add(refId)
        all.push(refId)
      }
    }
    return [
      `详情参考图已按用户上传先后顺序从上到下纵向拼接，因尺寸上限分成 ${strips.length} 段，保留全部内容，未截尾。原分图自上而下依次为：${all.map((refId, index) => `${index + 1}. ${refId}`).join('；')}。请为每个原分图 refId 各输出一项结果。`,
    ]
  }
  return [
    `详情参考图已按用户上传先后顺序从上到下纵向拼接成一张长图，不是互不相关的散图。原分图自上而下依次为：${order.map((refId, index) => `${index + 1}. ${refId}`).join('；')}。请为每个原分图 refId 各输出一项结果。`,
  ]
}

export function buildAnalysisChatMessages(images: AnalysisImageInput[], productName = '', productFactsNote = '', detailNotes?: { sellingPoint?: string; style?: string }, category?: CompetitorCategory) {
  const text = buildAnalysisUserPrompt(images, productName, productFactsNote, detailNotes, category)
  const content: unknown[] = [
    { type: 'text', text },
    ...images.filter((image) => image.dataUrl).map((image) => ({
      type: 'image_url',
      image_url: { url: image.dataUrl },
      refId: image.refId,
    })),
  ]
  return {
    system: ANALYSIS_SYSTEM_PROMPT,
    userContent: content,
    imageCount: images.filter((image) => image.dataUrl).length,
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asString(item)).filter(Boolean)
}

export function parseAnalysisResponse(text: string, expectedRefIds: string[]): { ok: true; results: AnalysisSuggestion[]; raw: unknown } | { ok: false; error: string } {
  const raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return { ok: false, error: '分析结果不是有效 JSON，未写入任何卖点。' }
    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch {
      return { ok: false, error: '分析结果不是有效 JSON，未写入任何卖点。' }
    }
  }
  const rec = parsed as { results?: unknown }
  if (!Array.isArray(rec.results)) return { ok: false, error: '分析结果缺少 results 数组，未写入任何卖点。' }
  const allowed = new Set(expectedRefIds)
  const results: AnalysisSuggestion[] = []
  for (const item of rec.results) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const refId = asString(row.refId)
    if (!refId || !allowed.has(refId)) continue
    const warnings = asWarnings(row.warnings)
    const unconfirmedFacts = asWarnings(row.unconfirmedFacts)
    results.push({
      refId,
      sellingPointCore: asString(row.sellingPointCore),
      sellingPointCopy: asString(row.sellingPointCopy),
      sceneCategory: asString(row.sceneCategory),
      layoutSummary: asString(row.layoutSummary),
      optionName: asString(row.optionName),
      contentsNote: asString(row.contentsNote),
      warnings,
      optionInventory: parseOptionInventory(row.optionInventory),
      unconfirmedFacts,
      sellingPoints: parseClaimsFromAnalysisRow(refId, {
        sellingPointCore: asString(row.sellingPointCore),
        sellingPointCopy: asString(row.sellingPointCopy),
        sellingPoints: row.sellingPoints,
        unconfirmedFacts,
      }),
    })
  }
  if (!results.length) return { ok: false, error: '分析结果没有对应到现有参考图，未写入任何卖点。' }
  return { ok: true, results, raw: parsed }
}

export function applyAnalysisSuggestions(refs: CompetitorRefImage[], suggestions: AnalysisSuggestion[]): CompetitorRefImage[] {
  const byId = new Map(suggestions.map((item) => [item.refId, item]))
  return refs.map((ref) => {
    const suggestion = byId.get(ref.id)
    if (!suggestion) return ref
    const sellingPoint = suggestion.sellingPointCopy || suggestion.sellingPointCore
    const preserveUserEdits = ref.analysisStatus === 'user_filled'
    const next: CompetitorRefImage = { ...ref }
    if (ref.category === 'option' && suggestion.optionInventory?.length) next.optionInventory = suggestion.optionInventory
    if (suggestion.sellingPoints?.length && !ref.sellingPointClaims?.length) next.sellingPointClaims = suggestion.sellingPoints
    if (suggestion.sellingPointCore && !ref.sellingPointCore) next.sellingPointCore = suggestion.sellingPointCore
    const warningParts = [...(ref.analysisWarnings || []), ...suggestion.warnings, ...(suggestion.unconfirmedFacts || []).map((item) => `待确认：${item}`)]
    if (warningParts.length) next.analysisWarnings = Array.from(new Set(warningParts))
    if (preserveUserEdits) {
      return next
    }
    next.analysisStatus = sellingPoint || suggestion.sceneCategory || suggestion.layoutSummary ? 'model_suggested' : ref.analysisStatus
    if (sellingPoint) next.sellingPoint = sellingPoint
    if (suggestion.sceneCategory) next.sceneHint = suggestion.sceneCategory
    if (suggestion.layoutSummary) next.layoutSummary = suggestion.layoutSummary
    if (ref.category === 'option') {
      if (suggestion.optionName && !ref.optionName.trim()) next.optionName = suggestion.optionName
      if (suggestion.contentsNote && !ref.contentsNote.trim()) next.contentsNote = suggestion.contentsNote
    }
    return next
  })
}


export interface ComposeAnalysisImagesOptions {
  decodePixels?: DecodePixelsFn
  encodeSlice?: EncodeSliceFn
}


function layoutFromDetailAssets(refs: CompetitorRefImage[]): DetailStripLayout | null {
  const details = detailRefsInUploadOrder(refs)
  if (!details.length) return null
  const sources = details.map((ref) => ({
    refId: ref.id,
    imageId: ref.asset.imageId,
    width: ref.asset.width || 0,
    height: ref.asset.height || 0,
  }))
  if (sources.some((source) => source.width <= 0 || source.height <= 0)) return null
  return layoutDetailStrip(sources)
}

export async function composeCompetitorAnalysisImages(
  refs: CompetitorRefImage[],
  preparedDataUrls: Map<string | undefined, string>,
  options: ComposeAnalysisImagesOptions = {},
): Promise<
  | { ok: true; images: AnalysisImageInput[]; expectedRefIds: string[]; layout: DetailStripLayout | null }
  | { ok: false; error: string }
> {
  const expectedRefIds = refs.map((ref) => ref.id)
  const resolveDataUrl = (ref: CompetitorRefImage) => preparedDataUrls.get(ref.asset.imageId || ref.asset.id) || ref.asset.dataUrl
  const images: AnalysisImageInput[] = []
  const detailRefs = detailRefsInUploadOrder(refs)
  let layout: DetailStripLayout | null = null
  let detailImages: AnalysisImageInput[] = []

  const detailFitsAsWhole = (width: number, height: number) => width > 0 && height > 0
    ? height <= DETAIL_STRIP_MAX_HEIGHT && width * height <= DETAIL_STRIP_MAX_PIXELS
    : true
  if (detailRefs.length === 1 && detailFitsAsWhole(detailRefs[0].asset.width || 0, detailRefs[0].asset.height || 0) && resolveDataUrl(detailRefs[0])) {
    const ref = detailRefs[0]
    layout = layoutFromDetailAssets(refs)
    detailImages = [{
      refId: ref.id,
      category: 'detail',
      optionName: ref.optionName,
      contentsNote: ref.contentsNote,
      dataUrl: resolveDataUrl(ref),
      role: 'reference',
    }]
  } else if (detailRefs.length >= 1) {
    try {
      const preview = await createDetailStripPreview(detailRefs, {
        decodePixels: options.decodePixels,
        resolveDataUrl,
        encodeSlice: options.encodeSlice,
      })
      layout = preview.layout
      const blocked = analysisBlockedBySkippedSources(layout) || analysisBlockedByMissingPixels(layout)
      if (blocked) {
        revokePreviewSafely(preview)
        return { ok: false, error: blocked }
      }
      if (preview.urls.length === 0) {
        revokePreviewSafely(preview)
        return { ok: false, error: '详情参考长图未能生成，已中止分析，避免漏图。' }
      }
      const dataUrls = await dataUrlsFromPreview(preview)
      revokePreviewSafely(preview)
      if (layout.kind === 'single' && dataUrls[0] && detailRefs[0]) {
        const ref = detailRefs[0]
        detailImages = [{
          refId: ref.id,
          category: 'detail',
          optionName: ref.optionName,
          contentsNote: ref.contentsNote,
          dataUrl: dataUrls[0],
          role: 'reference',
        }]
      } else {
        detailImages = layout.slices.flatMap((slice, index) => {
          const dataUrl = dataUrls[index]
          if (!dataUrl) return []
          return [{
            refId: `detail-strip-${slice.index}`,
            category: 'detail',
            dataUrl,
            role: 'detail-strip' as const,
            strip: {
              index: slice.index,
              total: slice.total,
              yStart: slice.yStart,
              yEnd: slice.yEnd,
              width: slice.width,
              height: slice.height,
              sourceRefIds: slice.sourceRefIds,
            },
          }]
        })
        if (detailImages.length !== layout.slices.length) {
          return { ok: false, error: '详情参考图分段后未能完整发送给分析，已中止，避免漏图。' }
        }
      }
    } catch (error) {
      return { ok: false, error: `详情参考长图生成失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  let detailsEmitted = false
  for (const ref of refs) {
    if (ref.category === 'detail') {
      if (!detailsEmitted) {
        images.push(...detailImages)
        detailsEmitted = true
      }
      continue
    }
    images.push({
      refId: ref.id,
      category: ref.category,
      optionName: ref.optionName,
      contentsNote: ref.contentsNote,
      dataUrl: resolveDataUrl(ref),
      role: 'reference',
    })
  }

  return { ok: true, images, expectedRefIds, layout }
}

function analysisBlockedByMissingPixels(layout: DetailStripLayout): string | null {
  const missing = layout.notices.find((notice) => notice.code === 'missing_pixels' || notice.code === 'decode_failed')
  if (!missing) return null
  return `详情参考长图未能完整生成：${missing.message} 请重新上传或稍后重试，避免漏图分析。`
}

async function dataUrlsFromPreview(preview: { urls: string[]; objectUrls: string[] }): Promise<string[]> {
  const result: string[] = []
  for (const url of preview.urls) {
    if (url.startsWith('data:')) {
      result.push(url)
      continue
    }
    const response = await fetch(url)
    const blob = await response.blob()
    result.push(await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('无法读取详情长图'))
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(blob)
    }))
  }
  return result
}

function revokePreviewSafely(preview: { objectUrls: string[] }): void {
  for (const url of preview.objectUrls) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      // ignore
    }
  }
}

function collectMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text
      }
      return ''
    }).join('')
  }
  return ''
}

export interface AnalysisCallResult {
  ok: boolean
  results?: AnalysisSuggestion[]
  sellingPointBlocks?: DetailSellingPointBlock[]
  error?: string
  category?: CompetitorCategory
}

/** 仅在用户点击后调用。本模块测试不得执行该函数发起真实请求。 */
export function inspectCompetitorAnalysisInput(input: {
  refs: CompetitorRefImage[]
  category?: CompetitorCategory
}): { category?: CompetitorCategory; refIds: string[]; missing: boolean } {
  const scoped = filterRefsForAnalysis(input.refs, input.category)
  return { category: input.category, refIds: scoped.map((ref) => ref.id), missing: scoped.length === 0 }
}

export async function requestCompetitorAnalysis(input: {
  planningModel: string
  productName: string
  productFactsNote?: string
  detailSellingPointNote?: string
  detailStyleNote?: string
  refs: CompetitorRefImage[]
  category?: CompetitorCategory
  optionSlots?: import('./types').CompetitorSession['optionSlots']
}, options: ComposeAnalysisImagesOptions = {}): Promise<AnalysisCallResult> {
  const profile = getActiveApiProfile(useStore.getState().settings)
  const label = analysisCategoryLabel(input.category)
  if (!input.planningModel.trim()) return { ok: false, error: '请先检测连接并选择规划模型。分析会发出一次模型请求，但不会自动生图。', category: input.category }
  if (!profile.baseUrl?.trim()) return { ok: false, error: '请先在设置中填写 Base URL', category: input.category }
  if (!profile.apiKey?.trim()) return { ok: false, error: '请先在设置中填写本机 API Key', category: input.category }
  const scopedRefs = filterRefsForAnalysis(input.refs, input.category)
  if (!scopedRefs.length) {
    return { ok: false, error: `请先上传${label}再分析。`, category: input.category }
  }
  const assets = scopedRefs.map((ref) => ref.asset).filter(Boolean)
  let ready
  try {
    ready = await prepareReferenceAssets(assets)
  } catch (error) {
    const message = error instanceof ReferenceImageError || error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
  const byImageId = new Map(ready.map((item, index) => [assets[index]?.imageId || assets[index]?.id, item.dataUrl]))
  const composed = await composeCompetitorAnalysisImages(scopedRefs, byImageId, options)
  if (!composed.ok) return composed
  const images = composed.images
  if (!images.some((image) => image.dataUrl)) return { ok: false, error: '没有可发送的参考图，无法分析' }
  const messages = buildAnalysisChatMessages(images, input.productName, input.productFactsNote || '', { sellingPoint: input.detailSellingPointNote, style: input.detailStyleNote }, input.category)
  const optionNotes = (input.optionSlots || []).filter((slot) => slot.contentsNote.trim() && scopedRefs.some((ref) => ref.category === 'option' && ref.id === slot.boundRefId))
  if (optionNotes.length) (messages.userContent[0] as {text: string}).text += '\n用户指定套餐搭配（仅对应参考；不得伪称参考图已出现未见物品）：\n' + optionNotes.map((slot) => `refId=${slot.boundRefId}：${slot.contentsNote}`).join('\n')
  const proxy = readClientDevProxyConfig()
  const url = buildApiUrl(profile.baseUrl, 'chat/completions', proxy, shouldUseApiProxy(profile.apiProxy, proxy))
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: input.planningModel,
        temperature: 0.3,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.userContent },
        ],
      }),
    })
    if (!response.ok) return { ok: false, error: `分析${label}失败：HTTP ${response.status}`, category: input.category }
    const payload = await response.json()
    const text = collectMessageText(payload?.choices?.[0]?.message?.content).trim()
    if (!text) return { ok: false, error: `分析${label}时接口没有返回文本内容，未写入任何卖点。`, category: input.category }
    const parsed = parseAnalysisResponse(text, composed.expectedRefIds)
    if (!parsed.ok) return { ...parsed, category: input.category }
    const layout = composed.layout || layoutFromDetailAssets(scopedRefs)
    let sellingPointBlocks: DetailSellingPointBlock[] = []
    if (layout && layout.height > 0) {
      sellingPointBlocks = blocksFromAnalysisPayload(parsed.raw, layout)
      if (!sellingPointBlocks.length) {
        sellingPointBlocks = fallbackBlocksFromClaims(
          scopedRefs.filter((ref) => ref.category === 'detail').map((ref) => ({
            refId: ref.id,
            claims: parsed.results.filter((item) => item.refId === ref.id).flatMap((item) => item.sellingPoints || (item.sellingPointCore ? [{ id: `sp-${ref.id}`, core: item.sellingPointCore, origin: 'competitor_reference' as const, status: 'confirmed' as const }] : [])),
          })),
          layout,
        )
      }
    }
    return { ok: true, results: parsed.results, sellingPointBlocks, category: input.category }
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError'
    const seconds = Math.round(ANALYSIS_TIMEOUT_MS / 1000)
    return { ok: false, error: aborted
      ? `分析${label}超时（${seconds}秒内模型未完成，请求已取消，没有写入新的卖点）。参考图较多或详情长图较大时更容易超时。可稍后再试，或只分析当前这一类。系统不会自动重试或生图。`
      : `分析${label}失败：${err instanceof Error ? err.message : String(err)}`, category: input.category }
  } finally {
    window.clearTimeout(timer)
  }
}
