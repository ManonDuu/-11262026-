export const PACK_MAX_HEIGHT = 8192
export const PACK_MAX_PIXELS = 8_000_000

export interface PackPlacement {
  refId: string
  imageId?: string
  sourceWidth: number
  sourceHeight: number
  width: number
  height: number
  y: number
}

export interface PackedSlice {
  index: number
  total: number
  yStart: number
  yEnd: number
  width: number
  height: number
  sourceRefIds: string[]
  placements: PackPlacement[]
  cutKind: PackCutKind
  overlapTop: number
}

export type PackCutKind = 'whole' | 'heuristic_gap' | 'forced_split'

export interface PackLimits {
  maxHeight: number
  maxPixels: number
  overlap: number
  searchWindow: number
  minBand: number
}

export const DEFAULT_PACK_OVERLAP = 240

export function defaultPackLimits(width: number, overrides: Partial<PackLimits> = {}): PackLimits {
  const maxHeight = Math.max(1, overrides.maxHeight ?? PACK_MAX_HEIGHT)
  const maxPixels = Math.max(width, overrides.maxPixels ?? PACK_MAX_PIXELS)
  const heightByPixels = Math.max(1, Math.floor(maxPixels / Math.max(width, 1)))
  const packHeight = Math.min(maxHeight, heightByPixels)
  const overlap = Math.min(overrides.overlap ?? DEFAULT_PACK_OVERLAP, Math.max(0, Math.floor(packHeight * 0.1)), Math.max(0, packHeight - 16))
  const searchWindow = overrides.searchWindow ?? Math.min(480, Math.max(64, Math.floor(packHeight * 0.2)))
  const minBand = overrides.minBand ?? 6
  return { maxHeight: packHeight, maxPixels, overlap, searchWindow, minBand }
}

export function rowLumaRange(pixels: Uint8ClampedArray, width: number, y: number): { range: number; meanAbsDiff: number } {
  const start = y * width * 4
  let min = 255
  let max = 0
  let diffSum = 0
  let prev = -1
  for (let x = 0; x < width; x += 1) {
    const i = start + x * 4
    const luma = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2])
    if (luma < min) min = luma
    if (luma > max) max = luma
    if (prev >= 0) diffSum += Math.abs(luma - prev)
    prev = luma
  }
  return { range: max - min, meanAbsDiff: width > 1 ? diffSum / (width - 1) : 0 }
}

export function isQuietRow(pixels: Uint8ClampedArray, width: number, y: number): boolean {
  const stats = rowLumaRange(pixels, width, y)
  return stats.range <= 18 && stats.meanAbsDiff <= 8
}

/** 在 [from, to) 内寻找最长的低复杂度横带。这是启发式切口，不是卖点识别。 */
export function findQuietBand(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  from: number,
  to: number,
  minBand: number,
): { start: number; end: number; center: number } | null {
  const start = Math.max(0, Math.min(from, height))
  const end = Math.max(start, Math.min(to, height))
  let best: { start: number; end: number; center: number } | null = null
  let runStart = -1
  const flush = (runEnd: number) => {
    if (runStart < 0) return
    const length = runEnd - runStart
    if (length < minBand) return
    if (!best || length > best.end - best.start) {
      best = { start: runStart, end: runEnd, center: runStart + Math.floor(length / 2) }
    }
  }
  for (let y = start; y < end; y += 1) {
    if (isQuietRow(pixels, width, y)) {
      if (runStart < 0) runStart = y
    } else {
      flush(y)
      runStart = -1
    }
  }
  flush(end)
  return best
}

export interface PackOptions extends Partial<PackLimits> {
  pixelsForPlacement?: (placement: PackPlacement) => Uint8ClampedArray | null | undefined
}

export function packPlacements(
  placements: PackPlacement[],
  width: number,
  options: PackOptions = {},
): PackedSlice[] {
  const limits = defaultPackLimits(width, options)
  const groups: Array<{ placements: PackPlacement[]; cutKind: PackCutKind; overlapTop: number }> = []
  let current: PackPlacement[] = []
  let currentHeight = 0

  const flush = (cutKind: PackCutKind = 'whole', overlapTop = 0) => {
    if (current.length === 0) return
    groups.push({ placements: current, cutKind, overlapTop })
    current = []
    currentHeight = 0
  }

  const canFit = (height: number) => height <= limits.maxHeight && height * width <= limits.maxPixels

  for (const placement of placements) {
    if (canFit(placement.height) && currentHeight + placement.height <= limits.maxHeight && (currentHeight + placement.height) * width <= limits.maxPixels) {
      current.push(placement)
      currentHeight += placement.height
      continue
    }

    flush('whole')

    if (canFit(placement.height)) {
      current.push(placement)
      currentHeight = placement.height
      continue
    }

    const pixels = options.pixelsForPlacement?.(placement) ?? null
    let offset = 0
    let previousForced = false
    while (offset < placement.height) {
      const remaining = placement.height - offset
      if (canFit(remaining)) {
        groups.push({
          placements: [{ ...placement, y: placement.y + offset, height: remaining }],
          cutKind: previousForced ? 'forced_split' : pixels ? 'heuristic_gap' : 'forced_split',
          overlapTop: 0,
        })
        break
      }
      const idealEnd = offset + limits.maxHeight
      const searchFrom = Math.max(offset + 16, idealEnd - limits.searchWindow)
      const band = pixels
        ? findQuietBand(pixels, placement.width, placement.height, searchFrom, idealEnd, limits.minBand)
        : null
      if (band && band.center > offset + 16) {
        groups.push({
          placements: [{ ...placement, y: placement.y + offset, height: band.center - offset }],
          cutKind: 'heuristic_gap',
          overlapTop: 0,
        })
        offset = band.center
        previousForced = false
        continue
      }
      const chunkHeight = Math.min(remaining, limits.maxHeight)
      groups.push({
        placements: [{ ...placement, y: placement.y + offset, height: chunkHeight }],
        cutKind: 'forced_split',
        overlapTop: 0,
      })
      previousForced = true
      const step = Math.max(16, chunkHeight - limits.overlap)
      offset += step
    }
  }
  flush('whole')

  return groups.map((group, index, all) => {
    const yStart = group.placements[0].y
    const yEnd = group.placements[group.placements.length - 1].y + group.placements[group.placements.length - 1].height
    const overlapTop = index > 0 && all[index - 1].cutKind === 'forced_split' && yStart < all[index - 1].placements[all[index - 1].placements.length - 1].y + all[index - 1].placements[all[index - 1].placements.length - 1].height
      ? (all[index - 1].placements[all[index - 1].placements.length - 1].y + all[index - 1].placements[all[index - 1].placements.length - 1].height) - yStart
      : 0
    return {
      index: index + 1,
      total: all.length,
      yStart,
      yEnd,
      width,
      height: yEnd - yStart,
      sourceRefIds: uniqueIds(group.placements.map((item) => item.refId)),
      placements: group.placements.map((item) => ({ ...item, y: item.y - yStart })),
      cutKind: group.cutKind,
      overlapTop,
    }
  })
}

export function unionCoverage(slices: Array<{ yStart: number; yEnd: number }>, totalHeight: number): { covered: number; gaps: Array<{ start: number; end: number }>; overlapRows: number } {
  const marks = new Uint8Array(Math.max(0, totalHeight))
  for (const slice of slices) {
    const from = Math.max(0, slice.yStart)
    const to = Math.min(totalHeight, slice.yEnd)
    for (let y = from; y < to; y += 1) marks[y] += 1
  }
  let covered = 0
  let overlapRows = 0
  const gaps: Array<{ start: number; end: number }> = []
  let gapStart = -1
  for (let y = 0; y < marks.length; y += 1) {
    if (marks[y] > 0) covered += 1
    if (marks[y] > 1) overlapRows += 1
    if (marks[y] === 0) {
      if (gapStart < 0) gapStart = y
    } else if (gapStart >= 0) {
      gaps.push({ start: gapStart, end: y })
      gapStart = -1
    }
  }
  if (gapStart >= 0) gaps.push({ start: gapStart, end: marks.length })
  return { covered, gaps, overlapRows }
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}
