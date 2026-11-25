import { normalizeImageSize } from '../../lib/size'
import type { FrameSpec } from '../types'

/** 与 src/lib/size.ts 中当前工作台模型约束一致：边长 16 倍数、最长边 3840、宽高比不超过 3:1、总像素 655360–8294400。未经付费实测。 */
export const DETAIL_LONG_STRIP_MAX_EDGE = 3840
export const DETAIL_LONG_STRIP_MAX_ASPECT = 3
export const DETAIL_LONG_STRIP_MAX_PIXELS = 8_294_400
export const DETAIL_LONG_STRIP_MIN_PIXELS = 655_360

export type CropRatioSource = 'user_selected' | 'default_suggestion'

export interface CropRatio {
  width: number
  height: number
  source: CropRatioSource
  label: string
}

/** 建议默认裁切比例。仅在用户尚未选择或输入时使用，不能称为“用户提供的比例”。 */
export const DEFAULT_DETAIL_CROP_RATIO: CropRatio = {
  width: 3,
  height: 4,
  source: 'default_suggestion',
  label: '3:4',
}

export function ratioLabel(width: number, height: number): string {
  return `${width}:${height}`
}

export function cropRatioFromParts(width: number, height: number, source: CropRatioSource): CropRatio {
  return { width, height, source, label: ratioLabel(width, height) }
}

export function cropRatioFromFrameSpec(spec: FrameSpec | null | undefined): CropRatio | null {
  if (!spec) return null
  if (!Number.isFinite(spec.width) || !Number.isFinite(spec.height) || spec.width <= 0 || spec.height <= 0) return null
  return cropRatioFromParts(spec.width, spec.height, 'user_selected')
}

export function resolveDetailCropRatio(input: {
  saved?: { width?: number; height?: number; source?: CropRatioSource } | null
  frameSpec?: FrameSpec | null
}): { ratio: CropRatio; usedDefault: boolean } {
  if (input.saved?.width && input.saved.height && input.saved.source === 'user_selected') {
    return { ratio: cropRatioFromParts(input.saved.width, input.saved.height, 'user_selected'), usedDefault: false }
  }
  const fromFrame = cropRatioFromFrameSpec(input.frameSpec)
  if (fromFrame) return { ratio: fromFrame, usedDefault: false }
  if (input.saved?.width && input.saved.height) {
    return { ratio: cropRatioFromParts(input.saved.width, input.saved.height, input.saved.source || 'default_suggestion'), usedDefault: input.saved.source !== 'user_selected' }
  }
  return { ratio: DEFAULT_DETAIL_CROP_RATIO, usedDefault: true }
}

export function describeCropRatio(ratio: CropRatio): string {
  if (ratio.source === 'user_selected') return `裁切比例 ${ratio.label}（你选择或输入的比例）`
  return `裁切比例 ${ratio.label}（建议默认，尚未作为你提供的比例。可改成其他宽:高后再裁切）`
}

export interface LongStripSizeLimit {
  width: number
  height: number
  requestSize: string
  aspectRatio: string
  pixels: number
  note: string
}

export function maxOneShotLongStripSize(preferredWidth = 1280): LongStripSizeLimit {
  const width = Math.max(16, Math.round(preferredWidth / 16) * 16)
  const byAspect = width * DETAIL_LONG_STRIP_MAX_ASPECT
  const byPixels = Math.floor(DETAIL_LONG_STRIP_MAX_PIXELS / width)
  let height = Math.min(DETAIL_LONG_STRIP_MAX_EDGE, byAspect, byPixels)
  height = Math.floor(height / 16) * 16
  const requestSize = normalizeImageSize(`${width}x${height}`)
  const [rw, rh] = requestSize.split('x').map(Number)
  return {
    width: rw,
    height: rh,
    requestSize,
    aspectRatio: `${(rh / rw).toFixed(3)}:1`,
    pixels: rw * rh,
    note: `当前工作台模型一次最多生成约 ${rw}×${rh} 的连续长图（边长不超过 ${DETAIL_LONG_STRIP_MAX_EDGE}、宽高比不超过 ${DETAIL_LONG_STRIP_MAX_ASPECT}:1、总像素不超过 ${DETAIL_LONG_STRIP_MAX_PIXELS.toLocaleString('zh-CN')}）。这是现有配置中的上限，不是任意高度长图。超出部分不能靠多次独立生图再拼接来冒充“一张完整长图再裁切”；若要分段生成，需另行确认费用和效果差异。`,
  }
}

export interface CropSlicePlan {
  index: number
  total: number
  x: number
  y: number
  width: number
  height: number
  isRemainder: boolean
}

export interface CropPlan {
  sourceWidth: number
  sourceHeight: number
  ratio: CropRatio
  fullSliceHeight: number
  fullSliceCount: number
  remainderHeight: number
  slices: CropSlicePlan[]
}

export function planDetailCrops(sourceWidth: number, sourceHeight: number, ratio: CropRatio): CropPlan {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('长图尺寸无效，无法裁切')
  }
  if (ratio.width <= 0 || ratio.height <= 0) throw new Error('裁切比例无效')
  const fullSliceHeight = Math.max(1, Math.round((sourceWidth * ratio.height) / ratio.width))
  const slices: CropSlicePlan[] = []
  if (sourceHeight <= fullSliceHeight) {
    slices.push({ index: 1, total: 1, x: 0, y: 0, width: sourceWidth, height: sourceHeight, isRemainder: sourceHeight !== fullSliceHeight })
  } else {
    const fullSliceCount = Math.floor(sourceHeight / fullSliceHeight)
    for (let i = 0; i < fullSliceCount; i += 1) {
      slices.push({
        index: i + 1,
        total: 0,
        x: 0,
        y: i * fullSliceHeight,
        width: sourceWidth,
        height: fullSliceHeight,
        isRemainder: false,
      })
    }
    const remainderHeight = sourceHeight - fullSliceCount * fullSliceHeight
    if (remainderHeight > 0) {
      slices.push({
        index: slices.length + 1,
        total: 0,
        x: 0,
        y: fullSliceCount * fullSliceHeight,
        width: sourceWidth,
        height: remainderHeight,
        isRemainder: true,
      })
    }
    for (const slice of slices) slice.total = slices.length
  }
  const remainderHeight = slices.some((slice) => slice.isRemainder) ? slices[slices.length - 1].height : 0
  return {
    sourceWidth,
    sourceHeight,
    ratio,
    fullSliceHeight,
    fullSliceCount: slices.filter((slice) => !slice.isRemainder).length,
    remainderHeight,
    slices,
  }
}

export function describeCropPlan(plan: CropPlan): string {
  const ratioText = describeCropRatio(plan.ratio)
  if (plan.slices.length === 1 && plan.slices[0].isRemainder) {
    return `${ratioText}。长图 ${plan.sourceWidth}×${plan.sourceHeight} 不足一个完整切片高度 ${plan.fullSliceHeight}，保留真实高度 ${plan.slices[0].height}，不拉伸铺满。`
  }
  if (plan.remainderHeight > 0) {
    return `${ratioText}。按长图真实尺寸得到 ${plan.fullSliceCount} 张完整 ${plan.sourceWidth}×${plan.fullSliceHeight} 切片，另有余尾 ${plan.sourceWidth}×${plan.remainderHeight}，保留真实高度，不丢内容、不拉伸。张数由长图和比例计算，不是竞品张数。`
  }
  return `${ratioText}。按长图真实尺寸得到 ${plan.fullSliceCount} 张 ${plan.sourceWidth}×${plan.fullSliceHeight} 切片。张数由长图和比例计算，不是竞品张数。`
}

export function cropRgba(
  pixels: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  slice: Pick<CropSlicePlan, 'x' | 'y' | 'width' | 'height'>,
): Uint8ClampedArray {
  if (slice.x !== 0 || slice.width !== sourceWidth) {
    throw new Error('详情长图裁切只沿高度方向切分，不得横向拉伸或改宽度')
  }
  if (slice.y < 0 || slice.height <= 0 || slice.y + slice.height > sourceHeight) {
    throw new Error('裁切范围超出长图，已中止以免变形')
  }
  const out = new Uint8ClampedArray(slice.width * slice.height * 4)
  const rowWidth = sourceWidth * 4
  for (let row = 0; row < slice.height; row += 1) {
    const srcStart = (slice.y + row) * rowWidth + slice.x * 4
    out.set(pixels.subarray(srcStart, srcStart + slice.width * 4), row * slice.width * 4)
  }
  return out
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

export function fillBand(
  pixels: Uint8ClampedArray,
  width: number,
  yStart: number,
  height: number,
  rgba: [number, number, number, number],
): void {
  for (let y = yStart; y < yStart + height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      pixels[index] = rgba[0]
      pixels[index + 1] = rgba[1]
      pixels[index + 2] = rgba[2]
      pixels[index + 3] = rgba[3]
    }
  }
}
