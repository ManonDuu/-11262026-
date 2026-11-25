import { cropRgba } from './detailCrop'
import type { DetailStripLayout, DetailStripPlacement } from './detailStrip'
import { scaleRgbaNearest } from './detailStrip'
import type { SellingPointClaim } from './types'

export type BlockBoundSource = 'semantic_analysis' | 'whole_source_fallback' | 'unconfirmed'

export interface SellingPointBoundSpan {
  sliceIndex?: number
  yStart: number
  yEnd: number
  global?: boolean
}

export interface DetailSellingPointBlock {
  id: string
  sellingPointText: string
  sourceRefIds: string[]
  globalYStart: number
  globalYEnd: number
  uncertainBounds: boolean
  boundSource: BlockBoundSource
  spans?: SellingPointBoundSpan[]
  note?: string
}

export function resolveStripSlice(layout: DetailStripLayout, sliceIndex: number) {
  return layout.slices.find((item) => item.index === sliceIndex)
    || (sliceIndex === 0 ? layout.slices[0] : undefined)
    || layout.slices[sliceIndex]
    || layout.slices[sliceIndex - 1]
}

export function sliceLocalToGlobal(layout: DetailStripLayout, sliceIndex: number, localY: number): number {
  const slice = resolveStripSlice(layout, sliceIndex)
  if (!slice) return localY
  return slice.yStart + localY
}

export function normalizeBoundSpan(
  layout: DetailStripLayout,
  span: SellingPointBoundSpan,
): { start: number; end: number } | null {
  const useLocal = span.global !== true && span.sliceIndex != null
  const start = useLocal && span.sliceIndex != null
    ? sliceLocalToGlobal(layout, span.sliceIndex, span.yStart)
    : span.yStart
  const end = useLocal && span.sliceIndex != null
    ? sliceLocalToGlobal(layout, span.sliceIndex, span.yEnd)
    : span.yEnd
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const clampedStart = Math.max(0, Math.min(start, layout.height))
  const clampedEnd = Math.max(clampedStart, Math.min(end, layout.height))
  if (clampedEnd <= clampedStart) return null
  return { start: Math.round(clampedStart), end: Math.round(clampedEnd) }
}

export function mergeSpans(spans: Array<{ start: number; end: number }>): { start: number; end: number } | null {
  if (!spans.length) return null
  const ordered = [...spans].sort((a, b) => a.start - b.start)
  let start = ordered[0].start
  let end = ordered[0].end
  for (const span of ordered.slice(1)) {
    if (span.start > end) {
      // keep a single logical block even if physically split; union the envelope and record later
      end = Math.max(end, span.end)
    } else {
      end = Math.max(end, span.end)
    }
  }
  return { start, end }
}

export function refsCoveredByRange(placements: DetailStripPlacement[], start: number, end: number): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const placement of placements) {
    const placementEnd = placement.y + placement.height
    if (placementEnd <= start || placement.y >= end) continue
    if (seen.has(placement.refId)) continue
    seen.add(placement.refId)
    ids.push(placement.refId)
  }
  return ids
}

export function blocksFromAnalysisPayload(
  payload: unknown,
  layout: DetailStripLayout,
): DetailSellingPointBlock[] {
  if (!payload || typeof payload !== 'object') return []
  const rec = payload as { sellingPointBlocks?: unknown; results?: unknown }
  const rawBlocks = Array.isArray(rec.sellingPointBlocks) ? rec.sellingPointBlocks : []
  const blocks: DetailSellingPointBlock[] = []

  const pushBlock = (item: Record<string, unknown>, index: number) => {
    const text = String(item.core || item.sellingPointText || item.copy || '').trim()
    if (!text) return
    const spanInputs: SellingPointBoundSpan[] = []
    if (Array.isArray(item.spans)) {
      for (const span of item.spans) {
        if (!span || typeof span !== 'object') continue
        const row = span as Record<string, unknown>
        spanInputs.push({
          sliceIndex: typeof row.sliceIndex === 'number' ? row.sliceIndex : undefined,
          yStart: Number(row.yStart),
          yEnd: Number(row.yEnd),
          global: Boolean(row.global),
        })
      }
    } else if (item.yStart != null && item.yEnd != null) {
      spanInputs.push({
        sliceIndex: typeof item.sliceIndex === 'number' ? item.sliceIndex : undefined,
        yStart: Number(item.yStart),
        yEnd: Number(item.yEnd),
        global: Boolean(item.global),
      })
    }
    const normalized = spanInputs.map((span) => normalizeBoundSpan(layout, span)).filter((span): span is { start: number; end: number } => Boolean(span))
    const merged = mergeSpans(normalized)
    if (!merged) return
    const sourceRefIds = Array.isArray(item.sourceRefIds)
      ? item.sourceRefIds.map((id) => String(id).trim()).filter(Boolean)
      : refsCoveredByRange(layout.placements, merged.start, merged.end)
    blocks.push({
      id: String(item.id || `block-${index + 1}`),
      sellingPointText: text,
      sourceRefIds: sourceRefIds.length ? sourceRefIds : refsCoveredByRange(layout.placements, merged.start, merged.end),
      globalYStart: merged.start,
      globalYEnd: merged.end,
      uncertainBounds: Boolean(item.uncertainBounds),
      boundSource: item.uncertainBounds ? 'unconfirmed' : 'semantic_analysis',
      spans: spanInputs,
      note: item.uncertainBounds ? '语义边界不确定，已标为待确认，不能当作精确切割。' : undefined,
    })
  }

  rawBlocks.forEach((item, index) => {
    if (item && typeof item === 'object') pushBlock(item as Record<string, unknown>, index)
  })

  if (!blocks.length && Array.isArray(rec.results)) {
    rec.results.forEach((row, index) => {
      if (!row || typeof row !== 'object') return
      const item = row as Record<string, unknown>
      const points = Array.isArray(item.sellingPoints) ? item.sellingPoints : []
      if (points.length) {
        points.forEach((point, pointIndex) => {
          if (point && typeof point === 'object') {
            pushBlock({ ...(point as Record<string, unknown>), sourceRefIds: item.refId ? [String(item.refId)] : undefined }, blocks.length + pointIndex)
          }
        })
      } else if (item.yStart != null && item.yEnd != null) {
        pushBlock({ ...item, core: item.sellingPointCore || item.sellingPointCopy, sourceRefIds: item.refId ? [String(item.refId)] : undefined }, index)
      }
    })
  }

  return blocks.sort((a, b) => a.globalYStart - b.globalYStart || a.globalYEnd - b.globalYEnd)
}

export function fallbackBlocksFromClaims(
  claimsByRef: Array<{ refId: string; claims: SellingPointClaim[] }>,
  layout: DetailStripLayout,
): DetailSellingPointBlock[] {
  const blocks: DetailSellingPointBlock[] = []
  for (const group of claimsByRef) {
    const placement = layout.placements.find((item) => item.refId === group.refId)
    if (!placement || !group.claims.length) continue
    group.claims.filter((claim) => claim.status !== 'unconfirmed' && claim.status !== 'conflict').forEach((claim, index) => {
      blocks.push({
        id: claim.id || `fallback-${group.refId}-${index + 1}`,
        sellingPointText: (claim.core || claim.copy || '').trim(),
        sourceRefIds: [group.refId],
        globalYStart: placement.y,
        globalYEnd: placement.y + placement.height,
        uncertainBounds: group.claims.length > 1,
        boundSource: 'whole_source_fallback',
        note: group.claims.length > 1
          ? '本次分析未给出该卖点的精确纵坐标，参考块暂时使用整张原分图，不能当作已按卖点准确切开。'
          : '未返回像素边界，参考块使用对应原分图的完整范围。',
      })
    })
  }
  return blocks.filter((block) => block.sellingPointText)
}

export function validateBlockCoverage(
  blocks: DetailSellingPointBlock[],
  layout: DetailStripLayout,
): {
  ordered: boolean
  orderedBlocks: DetailSellingPointBlock[]
  outOfRange: string[]
  overlapping: boolean
  gaps: Array<{ start: number; end: number }>
  complete: boolean
} {
  const orderedBlocks = [...blocks].sort((a, b) => a.globalYStart - b.globalYStart || a.globalYEnd - b.globalYEnd)
  const ordered = blocks.every((block, index) => index === 0 || block.globalYStart >= blocks[index - 1].globalYStart)
  const outOfRange = blocks.filter((block) => block.globalYStart < 0 || block.globalYEnd > layout.height || block.globalYEnd <= block.globalYStart).map((block) => block.id)
  const overlapping = blocks.some((block, index) => blocks.slice(index + 1).some((other) => other.globalYStart < block.globalYEnd && other.globalYEnd > block.globalYStart && other.id !== block.id))
  const marks = new Uint8Array(Math.max(0, layout.height))
  for (const block of blocks) {
    const from = Math.max(0, block.globalYStart)
    const to = Math.min(layout.height, block.globalYEnd)
    for (let y = from; y < to; y += 1) marks[y] = 1
  }
  const gaps: Array<{ start: number; end: number }> = []
  let gapStart = -1
  for (let y = 0; y < marks.length; y += 1) {
    if (marks[y] === 0) {
      if (gapStart < 0) gapStart = y
    } else if (gapStart >= 0) {
      gaps.push({ start: gapStart, end: y })
      gapStart = -1
    }
  }
  if (gapStart >= 0) gaps.push({ start: gapStart, end: marks.length })
  return { ordered, orderedBlocks, outOfRange, overlapping, gaps, complete: gaps.length === 0 && outOfRange.length === 0 && blocks.length > 0 }
}

export function cropBlockFromLayout(
  layout: DetailStripLayout,
  block: DetailSellingPointBlock,
): { width: number; height: number; pixels: Uint8ClampedArray; parts: Array<{ yStart: number; yEnd: number; pixels: Uint8ClampedArray }> } | null {
  const start = Math.max(0, block.globalYStart)
  const end = Math.min(layout.height, block.globalYEnd)
  if (end <= start || !layout.width) return null
  const width = layout.width
  const height = end - start
  const pixels = new Uint8ClampedArray(width * height * 4)
  const parts: Array<{ yStart: number; yEnd: number; pixels: Uint8ClampedArray }> = []

  if (layout.slices.some((slice) => slice.pixels)) {
    for (const slice of layout.slices) {
      if (!slice.pixels) continue
      const overlapStart = Math.max(start, slice.yStart)
      const overlapEnd = Math.min(end, slice.yEnd)
      if (overlapEnd <= overlapStart) continue
      const part = cropRgba(slice.pixels, slice.width, slice.height, {
        x: 0,
        y: overlapStart - slice.yStart,
        width: slice.width,
        height: overlapEnd - overlapStart,
      })
      const destY = overlapStart - start
      const rowWidth = width * 4
      for (let row = 0; row < overlapEnd - overlapStart; row += 1) {
        pixels.set(part.subarray(row * rowWidth, (row + 1) * rowWidth), (destY + row) * rowWidth)
      }
      parts.push({ yStart: overlapStart, yEnd: overlapEnd, pixels: part })
    }
  }
  return { width, height, pixels, parts }
}

export function cropBlockFromSources(
  placements: DetailStripPlacement[],
  sources: Array<{ refId: string; width: number; height: number; pixels: Uint8ClampedArray }>,
  block: DetailSellingPointBlock,
  targetWidth: number,
): { width: number; height: number; pixels: Uint8ClampedArray } | null {
  const start = block.globalYStart
  const end = block.globalYEnd
  const height = end - start
  if (height <= 0 || targetWidth <= 0) return null
  const pixels = new Uint8ClampedArray(targetWidth * height * 4)
  for (const placement of placements) {
    const source = sources.find((item) => item.refId === placement.refId)
    if (!source?.pixels) continue
    const overlapStart = Math.max(start, placement.y)
    const overlapEnd = Math.min(end, placement.y + placement.height)
    if (overlapEnd <= overlapStart) continue
    const scaled = (source.width === placement.width && source.height === placement.height)
      ? source.pixels
      : scaleRgbaNearest(source.pixels, source.width, source.height, placement.width, placement.height)
    const srcY = overlapStart - placement.y
    const partHeight = overlapEnd - overlapStart
    const part = cropRgba(scaled, placement.width, placement.height, { x: 0, y: srcY, width: placement.width, height: partHeight })
    const destY = overlapStart - start
    const rowWidth = targetWidth * 4
    for (let row = 0; row < partHeight; row += 1) {
      pixels.set(part.subarray(row * rowWidth, (row + 1) * rowWidth), (destY + row) * rowWidth)
    }
  }
  return { width: targetWidth, height, pixels }
}
