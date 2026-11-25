import { describe, expect, it } from 'vitest'
import { fillSolidRgba } from './detailStrip'
import { findQuietBand, packPlacements, unionCoverage, type PackPlacement } from './detailStripPack'

function placement(partial: Partial<PackPlacement> & Pick<PackPlacement, 'refId' | 'height' | 'y'>): PackPlacement {
  return {
    sourceWidth: 40,
    sourceHeight: partial.height,
    width: 40,
    ...partial,
  }
}

function noisyPixels(width: number, height: number, gap?: { start: number; end: number }): Uint8ClampedArray {
  const pixels = fillSolidRgba(width, height, [220, 40, 40, 255])
  for (let y = 0; y < height; y += 1) {
    if (gap && y >= gap.start && y < gap.end) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4
        pixels[i] = 250
        pixels[i + 1] = 250
        pixels[i + 2] = 250
        pixels[i + 3] = 255
      }
      continue
    }
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      pixels[i] = (x * 17 + y * 13) % 255
      pixels[i + 1] = (x * 9 + y * 29) % 255
      pixels[i + 2] = (x * 5 + y * 7) % 255
      pixels[i + 3] = 255
    }
  }
  return pixels
}

describe('分析前安全分包', () => {
  it('整张原分图能装下时不切开', () => {
    const slices = packPlacements([
      placement({ refId: 'a', y: 0, height: 100 }),
      placement({ refId: 'b', y: 100, height: 120 }),
    ], 40, { maxHeight: 300, maxPixels: 40 * 300 })
    expect(slices).toHaveLength(1)
    expect(slices[0].sourceRefIds).toEqual(['a', 'b'])
    expect(slices[0].cutKind).toBe('whole')
    expect(unionCoverage(slices, 220).gaps).toEqual([])
  })

  it('有明显空白分隔时，在分隔带切开，而不是固定高度切断内容', () => {
    const height = 500
    const pixels = noisyPixels(40, height, { start: 180, end: 210 })
    expect(findQuietBand(pixels, 40, height, 150, 200, 6)?.center).toBeGreaterThanOrEqual(180)
    const slices = packPlacements([
      placement({ refId: 'tall', y: 0, height }),
    ], 40, {
      maxHeight: 200,
      maxPixels: 40 * 200,
      overlap: 20,
      searchWindow: 60,
      minBand: 6,
      pixelsForPlacement: () => pixels,
    })
    expect(slices.length).toBeGreaterThan(1)
    expect(slices.some((slice) => slice.cutKind === 'heuristic_gap')).toBe(true)
    expect(slices[0].yEnd).toBeGreaterThanOrEqual(180)
    expect(slices[0].yEnd).toBeLessThanOrEqual(210)
    const coverage = unionCoverage(slices, height)
    expect(coverage.covered).toBe(height)
    expect(coverage.gaps).toEqual([])
  })

  it('找不到安全分隔的超高模块会重叠硬切，覆盖全部行且不丢尾', () => {
    const height = 450
    const pixels = fillSolidRgba(40, height, [12, 200, 40, 255])
    // noisy rows so no quiet band
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        const i = (y * 40 + x) * 4
        pixels[i] = (x * 17 + y * 13) % 255
        pixels[i + 1] = (x * 9 + y * 29) % 255
        pixels[i + 2] = (x * 5 + y * 7) % 255
      }
    }
    const slices = packPlacements([
      placement({ refId: 'busy', y: 0, height }),
    ], 40, {
      maxHeight: 200,
      maxPixels: 40 * 200,
      overlap: 20,
      searchWindow: 40,
      minBand: 6,
      pixelsForPlacement: () => pixels,
    })
    expect(slices.some((slice) => slice.cutKind === 'forced_split')).toBe(true)
    expect(slices[slices.length - 1].yEnd).toBe(height)
    const coverage = unionCoverage(slices, height)
    expect(coverage.covered).toBe(height)
    expect(coverage.gaps).toEqual([])
    expect(coverage.overlapRows).toBeGreaterThan(0)
    expect(slices.every((slice) => slice.height <= 200)).toBe(true)
  })
})
