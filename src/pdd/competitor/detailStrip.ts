import { packPlacements, unionCoverage, type PackCutKind } from './detailStripPack'
export const DETAIL_STRIP_MAX_WIDTH = 960
export const DETAIL_STRIP_MAX_HEIGHT = 8192
export const DETAIL_STRIP_MAX_PIXELS = 8_000_000
export const DETAIL_STRIP_SOURCE_MAX_SIDE = 16_384
export const DETAIL_STRIP_SOURCE_MAX_PIXELS = 24_000_000

export interface DetailStripSource {
  refId: string
  imageId?: string
  width: number
  height: number
  pixels?: Uint8ClampedArray
}

export interface DetailStripPlacement {
  refId: string
  imageId?: string
  sourceWidth: number
  sourceHeight: number
  width: number
  height: number
  y: number
}

export interface DetailStripSlice {
  index: number
  total: number
  yStart: number
  yEnd: number
  width: number
  height: number
  sourceRefIds: string[]
  placements: DetailStripPlacement[]
  pixels?: Uint8ClampedArray
  /** whole=整张原分图装入；heuristic_gap=在低复杂度横带切开（不是卖点识别）；forced_split=超大模块重叠硬切。 */
  cutKind?: PackCutKind
  overlapTop?: number
}

export interface DetailStripNotice {
  code:
    | 'empty'
    | 'single'
    | 'sliced'
    | 'skipped_source'
    | 'corrupt_source'
    | 'missing_pixels'
    | 'decode_failed'
  message: string
  refId?: string
}

export interface DetailStripLayout {
  kind: 'empty' | 'single' | 'strip' | 'sliced'
  width: number
  height: number
  targetWidth: number
  placements: DetailStripPlacement[]
  slices: DetailStripSlice[]
  skipped: Array<{ refId: string; reason: string }>
  notices: DetailStripNotice[]
  cacheKey: string
}

export function detailRefsInUploadOrder<T extends { category: string }>(refs: T[]): T[] {
  return refs.filter((ref) => ref.category === 'detail')
}

export function isSourceWithinDecodeLimits(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
  if (width > DETAIL_STRIP_SOURCE_MAX_SIDE || height > DETAIL_STRIP_SOURCE_MAX_SIDE) return false
  return width * height <= DETAIL_STRIP_SOURCE_MAX_PIXELS
}

export function chooseDetailStripWidth(sources: Array<{ width: number }>): number {
  const maxSourceWidth = Math.max(0, ...sources.map((source) => source.width))
  if (maxSourceWidth <= 0) return 0
  return Math.min(DETAIL_STRIP_MAX_WIDTH, maxSourceWidth)
}

export function scaledPlacementSize(sourceWidth: number, sourceHeight: number, targetWidth: number): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0) return { width: 0, height: 0 }
  const height = Math.max(1, Math.round((sourceHeight * targetWidth) / sourceWidth))
  return { width: targetWidth, height }
}

function canAllocate(width: number, height: number): boolean {
  return width > 0 && height > 0 && height <= DETAIL_STRIP_MAX_HEIGHT && width * height <= DETAIL_STRIP_MAX_PIXELS
}

export function inspectSource(source: DetailStripSource): { ok: true } | { ok: false; reason: string; notice: DetailStripNotice } {
  if (!Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0) {
    return {
      ok: false,
      reason: '尺寸无效或文件损坏',
      notice: { code: 'corrupt_source', message: `详情参考图无法读取有效尺寸，已跳过并保留原文件。`, refId: source.refId },
    }
  }
  if (!isSourceWithinDecodeLimits(source.width, source.height)) {
    return {
      ok: false,
      reason: `超过解码上限（边长 ${DETAIL_STRIP_SOURCE_MAX_SIDE} 或 ${DETAIL_STRIP_SOURCE_MAX_PIXELS.toLocaleString('zh-CN')} 像素）`,
      notice: {
        code: 'skipped_source',
        message: `单张详情参考图过大（超过 ${DETAIL_STRIP_SOURCE_MAX_SIDE} 边长或 ${DETAIL_STRIP_SOURCE_MAX_PIXELS.toLocaleString('zh-CN')} 像素），已跳过并保留原文件，请缩小后重新上传。`,
        refId: source.refId,
      },
    }
  }
  return { ok: true }
}

export function buildDetailStripCacheKey(
  sources: Array<{ refId: string; imageId?: string; width: number; height: number }>,
  targetWidth: number,
): string {
  const body = sources.map((source) => `${source.refId}:${source.imageId ?? ''}:${source.width}x${source.height}`).join('|')
  return `detail-strip:v2:w${targetWidth}:${body}`
}

export function layoutDetailStrip(inputSources: DetailStripSource[], options: { usePixels?: boolean } = {}): DetailStripLayout {
  const notices: DetailStripNotice[] = []
  const skipped: Array<{ refId: string; reason: string }> = []
  const usable: DetailStripSource[] = []

  for (const source of inputSources) {
    const check = inspectSource(source)
    if (!check.ok) {
      skipped.push({ refId: source.refId, reason: check.reason })
      notices.push(check.notice)
      continue
    }
    usable.push(source)
  }

  if (usable.length === 0) {
    return {
      kind: 'empty',
      width: 0,
      height: 0,
      targetWidth: 0,
      placements: [],
      slices: [],
      skipped,
      notices: notices.length > 0 ? notices : [{ code: 'empty', message: '暂无参考详情图' }],
      cacheKey: buildDetailStripCacheKey([], 0),
    }
  }

  const targetWidth = chooseDetailStripWidth(usable)
  const placements: DetailStripPlacement[] = []
  let y = 0
  for (const source of usable) {
    const size = scaledPlacementSize(source.width, source.height, targetWidth)
    placements.push({
      refId: source.refId,
      imageId: source.imageId,
      sourceWidth: source.width,
      sourceHeight: source.height,
      width: size.width,
      height: size.height,
      y,
    })
    y += size.height
  }

  const width = targetWidth
  const height = y
  const cacheKey = buildDetailStripCacheKey(usable, targetWidth)

  if (usable.length === 1 && canAllocate(width, height)) {
    notices.push({ code: 'single', message: '仅有一张详情参考图，直接使用原图预览，不再重复拼接。', refId: usable[0].refId })
    return {
      kind: 'single',
      width,
      height,
      targetWidth,
      placements,
      slices: [
        {
          index: 1,
          total: 1,
          yStart: 0,
          yEnd: height,
          width,
          height,
          sourceRefIds: [usable[0].refId],
          placements: [...placements],
        },
      ],
      skipped,
      notices,
      cacheKey,
    }
  }

  if (canAllocate(width, height)) {
    return {
      kind: 'strip',
      width,
      height,
      targetWidth,
      placements,
      slices: [
        {
          index: 1,
          total: 1,
          yStart: 0,
          yEnd: height,
          width,
          height,
          sourceRefIds: placements.map((placement) => placement.refId),
          placements: [...placements],
        },
      ],
      skipped,
      notices,
      cacheKey,
    }
  }

  const slices = slicePlacements(placements, width, options.usePixels ? inputSources : undefined)
  const forced = slices.some((slice) => slice.cutKind === 'forced_split')
  const heuristic = slices.some((slice) => slice.cutKind === 'heuristic_gap')
  notices.push({
    code: 'sliced',
    message: forced
      ? `详情图较长，已分成 ${slices.length} 段用于预览和分析，保留上传顺序和全部内容，未缩成看不清的小图。部分超大模块找不到安全空白分隔，已做互相重叠的连续分段，不能保证绝对无切断。`
      : heuristic
        ? `详情图较长，已分成 ${slices.length} 段用于预览和分析，保留上传顺序和全部内容。切口优先选低复杂度分隔带，这只是为了避免固定高度切断，不是已经识别出卖点。`
        : `详情图较长，已分段预览和分析（共 ${slices.length} 段），保留全部内容及上传顺序，未截尾或缩成看不清的小图。`,
  })
  return {
    kind: 'sliced',
    width,
    height,
    targetWidth,
    placements,
    slices,
    skipped,
    notices,
    cacheKey,
  }
}

function slicePlacements(placements: DetailStripPlacement[], width: number, sources?: DetailStripSource[]): DetailStripSlice[] {
  const scaledCache = new Map<string, Uint8ClampedArray>()
  return packPlacements(placements, width, {
    pixelsForPlacement: sources
      ? (placement) => {
          const source = sources.find((item) => item.refId === placement.refId)
          if (!source?.pixels) return null
          const key = `${placement.refId}:${placement.width}x${placement.height}`
          const cached = scaledCache.get(key)
          if (cached) return cached
          const scaled = scaleRgbaNearest(source.pixels, source.width, source.height, placement.width, placement.height)
          scaledCache.set(key, scaled)
          return scaled
        }
      : undefined,
  })
}

export function scaleRgbaNearest(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
): Uint8ClampedArray {
  if (sourceWidth === destWidth && sourceHeight === destHeight) return source
  const dest = new Uint8ClampedArray(destWidth * destHeight * 4)
  for (let y = 0; y < destHeight; y += 1) {
    const srcY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / destHeight))
    for (let x = 0; x < destWidth; x += 1) {
      const srcX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / destWidth))
      const srcIndex = (srcY * sourceWidth + srcX) * 4
      const destIndex = (y * destWidth + x) * 4
      dest[destIndex] = source[srcIndex]
      dest[destIndex + 1] = source[srcIndex + 1]
      dest[destIndex + 2] = source[srcIndex + 2]
      dest[destIndex + 3] = source[srcIndex + 3]
    }
  }
  return dest
}

export function fillSolidRgba(width: number, height: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgba[0]
    pixels[i + 1] = rgba[1]
    pixels[i + 2] = rgba[2]
    pixels[i + 3] = rgba[3]
  }
  return pixels
}

export function markEdge(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  rgba: [number, number, number, number],
): void {
  const paint = (x: number, y: number) => {
    const index = (y * width + x) * 4
    pixels[index] = rgba[0]
    pixels[index + 1] = rgba[1]
    pixels[index + 2] = rgba[2]
    pixels[index + 3] = rgba[3]
  }
  for (let x = 0; x < width; x += 1) {
    paint(x, 0)
    paint(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    paint(0, y)
    paint(width - 1, y)
  }
}

export function samplePixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const index = (y * width + x) * 4
  return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]]
}

export function stitchDetailStripPixels(
  sources: DetailStripSource[],
  layout = layoutDetailStrip(sources, { usePixels: true }),
): DetailStripLayout {
  const byId = new Map(sources.map((source) => [source.refId, source]))
  const originalById = new Map(layout.placements.map((placement) => [placement.refId, placement]))
  const scaledCache = new Map<string, Uint8ClampedArray>()
  const notices = [...layout.notices]
  const missing: string[] = []

  const scaledFor = (placement: DetailStripPlacement): Uint8ClampedArray | null => {
    const source = byId.get(placement.refId)
    const original = originalById.get(placement.refId)
    if (!source?.pixels || !original) return null
    const cached = scaledCache.get(placement.refId)
    if (cached) return cached
    const scaled = scaleRgbaNearest(source.pixels, source.width, source.height, original.width, original.height)
    scaledCache.set(placement.refId, scaled)
    return scaled
  }

  const slices = layout.slices.map((slice) => {
    const pixels = new Uint8ClampedArray(slice.width * slice.height * 4)
    for (const placement of slice.placements) {
      const original = originalById.get(placement.refId)
      const scaled = scaledFor(placement)
      if (!original || !scaled) {
        missing.push(placement.refId)
        continue
      }
      const sourceStartY = slice.yStart + placement.y - original.y
      const rowWidth = placement.width * 4
      for (let row = 0; row < placement.height; row += 1) {
        const srcRow = Math.min(original.height - 1, Math.max(0, sourceStartY + row))
        const srcStart = srcRow * rowWidth
        const destStart = (placement.y + row) * slice.width * 4
        pixels.set(scaled.subarray(srcStart, srcStart + rowWidth), destStart)
      }
    }
    return { ...slice, pixels }
  })

  if (missing.length > 0) {
    notices.push({
      code: 'missing_pixels',
      message: `有 ${new Set(missing).size} 张详情参考图缺少像素数据，拼接结果不完整。`,
    })
  }

  return { ...layout, slices, notices }
}

export function describeDetailStripLayout(layout: DetailStripLayout): string {
  if (layout.kind === 'empty') return '暂无参考详情图'
  if (layout.kind === 'single') return '当前仅有一张详情参考图，直接显示原图。'
  if (layout.kind === 'sliced') {
    return `详情参考长图已按上传顺序纵向拼接，因尺寸上限分成 ${layout.slices.length} 段，共 ${layout.placements.length} 张原分图，宽 ${layout.width}、高 ${layout.height} 像素。`
  }
  return `详情参考长图已按上传顺序纵向拼接，共 ${layout.placements.length} 张原分图，宽 ${layout.width}、高 ${layout.height} 像素。`
}

export function describeSliceCaption(slice: DetailStripSlice): string {
  const overlap = slice.overlapTop ? `，与上段重叠 ${slice.overlapTop} 像素` : ''
  const kind = slice.cutKind === 'forced_split'
    ? '。该段含超大模块的重叠硬切，不能保证绝对无切断'
    : slice.cutKind === 'heuristic_gap'
      ? '。切口选在低复杂度分隔带，这不是卖点识别结果'
      : ''
  return `第 ${slice.index}/${slice.total} 段（纵坐标 ${slice.yStart}–${slice.yEnd}），对应原分图 ${slice.sourceRefIds.join('、')}${overlap}${kind}。`
}

export function analysisBlockedBySkippedSources(layout: DetailStripLayout): string | null {
  if (layout.skipped.length === 0) return null
  const details = layout.skipped.map((item) => `${item.refId}：${item.reason}`).join('；')
  return `有详情参考图无法纳入长图分析（${details}）。请处理后再分析，避免漏图。`
}
