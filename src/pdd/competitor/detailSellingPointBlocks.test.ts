import { describe, expect, it } from 'vitest'
import { encodePngRgba } from './detailStrip.test'
import { fillSolidRgba, stitchDetailStripPixels, type DetailStripLayout } from './detailStrip'
import {
  blocksFromAnalysisPayload,
  cropBlockFromLayout,
  cropBlockFromSources,
  fallbackBlocksFromClaims,
  normalizeBoundSpan,
  refsCoveredByRange,
  sliceLocalToGlobal,
  validateBlockCoverage,
  type DetailSellingPointBlock,
} from './detailSellingPointBlocks'
import { planDetailSellingPointPages } from './detailPages'
import type { CompetitorRefImage, SellingPointClaim } from './types'

function getNodeFs(): { mkdirSync: (path: string, opts?: { recursive?: boolean }) => void; writeFileSync: (path: string, data: Uint8Array) => void } {
  const proc = globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => unknown } }
  const fs = proc.process?.getBuiltinModule?.('node:fs')
  if (!fs) throw new Error('无法写入本机证据文件')
  return fs as ReturnType<typeof getNodeFs>
}

function evidenceDir(): string {
  const proc = globalThis as unknown as { process?: { cwd?: () => string } }
  const cwd = proc.process?.cwd?.()
  if (!cwd) throw new Error('缺少工作目录')
  return `${cwd}/var/t190-evidence`
}

function writeEvidence(name: string, width: number, height: number, pixels: Uint8ClampedArray) {
  const dir = evidenceDir()
  const fs = getNodeFs()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(`${dir}/${name}`, encodePngRgba(width, height, pixels))
}

function source(id: string, height: number, color: [number, number, number, number], width = 40) {
  return { refId: id, width, height, pixels: fillSolidRgba(width, height, color) }
}

function claim(partial: Partial<SellingPointClaim> & Pick<SellingPointClaim, 'id' | 'core'>): SellingPointClaim {
  return { origin: 'competitor_reference', status: 'confirmed', ...partial }
}

describe('卖点参考块映射与覆盖', () => {
  it('跨两张原分图的卖点合成一个逻辑块，并带上两边的 refId', () => {
    const sources = [
      source('a', 80, [10, 20, 200, 255]),
      source('b', 80, [200, 20, 10, 255]),
    ]
    const layout = stitchDetailStripPixels(sources)
    const parsed = blocksFromAnalysisPayload({
      sellingPointBlocks: [{
        id: 'sp-cross',
        sellingPointText: '加厚合金臂',
        yStart: 60,
        yEnd: 100,
        global: true,
        sourceRefIds: ['a', 'b'],
      }],
    }, layout)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].sourceRefIds).toEqual(['a', 'b'])
    expect(parsed[0].globalYStart).toBe(60)
    expect(parsed[0].globalYEnd).toBe(100)
    expect(parsed[0].boundSource).toBe('semantic_analysis')
    expect(refsCoveredByRange(layout.placements, 60, 100)).toEqual(['a', 'b'])
    const crop = cropBlockFromLayout(layout, parsed[0])
    expect(crop).not.toBeNull()
    expect(crop!.height).toBe(40)
    const top = crop!.pixels.slice(0, 40 * 20 * 4)
    const bottom = crop!.pixels.slice(40 * 20 * 4)
    expect(top[0]).toBe(10)
    expect(top[2]).toBe(200)
    expect(bottom[0]).toBe(200)
    expect(bottom[2]).toBe(10)
    const fromSources = cropBlockFromSources(layout.placements, sources, parsed[0], layout.width)
    expect(Array.from(fromSources!.pixels)).toEqual(Array.from(crop!.pixels))
    writeEvidence('cross-ref-block.png', crop!.width, crop!.height, crop!.pixels)
  })

  it('slice 局部坐标会映射到统一上传顺序纵坐标', () => {
    const layout: DetailStripLayout = {
      kind: 'sliced',
      width: 40,
      height: 160,
      targetWidth: 40,
      placements: [
        { refId: 'a', sourceWidth: 40, sourceHeight: 80, width: 40, height: 80, y: 0 },
        { refId: 'b', sourceWidth: 40, sourceHeight: 80, width: 40, height: 80, y: 80 },
      ],
      slices: [
        { index: 1, total: 2, yStart: 0, yEnd: 80, width: 40, height: 80, sourceRefIds: ['a'], placements: [] },
        { index: 2, total: 2, yStart: 80, yEnd: 160, width: 40, height: 80, sourceRefIds: ['b'], placements: [] },
      ],
      skipped: [],
      notices: [],
      cacheKey: 'test',
    }
    expect(sliceLocalToGlobal(layout, 2, 10)).toBe(90)
    expect(normalizeBoundSpan(layout, { sliceIndex: 2, yStart: 10, yEnd: 40 })).toEqual({ start: 90, end: 120 })
    const parsed = blocksFromAnalysisPayload({
      results: [{
        refId: 'b',
        sellingPoints: [{
          core: '360度旋转',
          sliceIndex: 2,
          yStart: 10,
          yEnd: 40,
        }],
      }],
    }, layout)
    expect(parsed[0].globalYStart).toBe(90)
    expect(parsed[0].globalYEnd).toBe(120)
    expect(parsed[0].sellingPointText).toBe('360度旋转')
    expect(parsed[0].sourceRefIds).toEqual(['b'])
  })

  it('完整覆盖校验会标出遗漏区间，并按纵坐标排序', () => {
    const layout = stitchDetailStripPixels([source('a', 100, [8, 8, 8, 255])])
    const blocks: DetailSellingPointBlock[] = [
      {
        id: 'late',
        sellingPointText: '后段',
        sourceRefIds: ['a'],
        globalYStart: 70,
        globalYEnd: 100,
        boundSource: 'semantic_analysis',
        uncertainBounds: false,
      },
      {
        id: 'early',
        sellingPointText: '前段',
        sourceRefIds: ['a'],
        globalYStart: 0,
        globalYEnd: 40,
        boundSource: 'semantic_analysis',
        uncertainBounds: false,
      },
    ]
    const report = validateBlockCoverage(blocks, layout)
    expect(report.ordered).toBe(false)
    expect(report.orderedBlocks.map((item) => item.id)).toEqual(['early', 'late'])
    expect(report.gaps).toEqual([{ start: 40, end: 70 }])
    expect(report.complete).toBe(false)
  })

  it('没有纵坐标时回退到整张原分图，并标明不是精确切开', () => {
    const layout = stitchDetailStripPixels([source('a', 90, [9, 9, 9, 255])])
    const blocks = fallbackBlocksFromClaims([
      {
        refId: 'a',
        claims: [
          claim({ id: 'c1', core: '卖点甲' }),
          claim({ id: 'c2', core: '卖点乙' }),
        ],
      },
    ], layout)
    expect(blocks).toHaveLength(2)
    expect(blocks.every((block) => block.globalYStart === 0 && block.globalYEnd === 90)).toBe(true)
    expect(blocks.every((block) => block.boundSource === 'whole_source_fallback')).toBe(true)
    expect(blocks.every((block) => block.uncertainBounds)).toBe(true)
    expect(blocks[0].note).toMatch(/不能当作已按卖点准确切开/)
  })

  it('不确定边界会被保留，而不伪装成精确语义切开', () => {
    const layout = stitchDetailStripPixels([source('a', 80, [1, 1, 1, 255])])
    const parsed = blocksFromAnalysisPayload({
      sellingPointBlocks: [{
        sellingPointText: '尺寸标注',
        yStart: 10,
        yEnd: 40,
        uncertainBounds: true,
        sourceRefIds: ['a'],
      }],
    }, layout)
    expect(parsed[0].uncertainBounds).toBe(true)
    expect(parsed[0].boundSource).toBe('unconfirmed')
  })

  it('默认规划按卖点块生成分张页面，不恢复整长图生成', () => {
    const refs = [
      { id: 'a', category: 'detail', sellingPoint: '旧文案' },
      { id: 'b', category: 'detail', sellingPoint: '另一张' },
    ] as CompetitorRefImage[]
    const { pages, directives } = planDetailSellingPointPages({
      refs,
      sellingPointBlocks: [
        {
          id: 'block-1',
          sellingPointText: '加厚合金臂',
          sourceRefIds: ['a', 'b'],
          globalYStart: 60,
          globalYEnd: 100,
          boundSource: 'semantic_analysis',
          uncertainBounds: false,
        },
        {
          id: 'block-2',
          sellingPointText: '360度旋转',
          sourceRefIds: ['b'],
          globalYStart: 100,
          globalYEnd: 160,
          boundSource: 'semantic_analysis',
          uncertainBounds: false,
        },
      ],
    })
    expect(directives.userChangedSellingPoints).toBe(false)
    expect(pages).toHaveLength(2)
    expect(pages[0].detailBlockId).toBe('block-1')
    expect(pages[0].sourceRefIds).toEqual(['a', 'b'])
    expect(pages[0].sellingPointText).toBe('加厚合金臂')
    expect(pages[1].refImageId).toBe('b')
  })

  it('用户改了卖点后不会被分析块覆盖', () => {
    const refs = [{ id: 'a', category: 'detail', sellingPoint: '旧卖点' }] as CompetitorRefImage[]
    const { pages } = planDetailSellingPointPages({
      refs,
      detailSellingPointNote: '我指定的卖点',
      sellingPointBlocks: [{
        id: 'block-1',
        sellingPointText: '竞品原卖点',
        sourceRefIds: ['a'],
        globalYStart: 0,
        globalYEnd: 40,
        boundSource: 'semantic_analysis',
        uncertainBounds: false,
      }],
    })
    expect(pages).toHaveLength(1)
    expect(pages[0].sellingPointText).toBe('我指定的卖点')
    expect(pages[0].detailBlockId).toBeUndefined()
  })
})

describe('真实像素裁分证据', () => {
  it('按模块边界裁出的块与原图像素一致', () => {
    const width = 48
    const height = 240
    const pixels = fillSolidRgba(width, height, [30, 30, 30, 255])
    const bands = [
      { start: 0, end: 70, color: [12, 80, 200, 255] as const },
      { start: 80, end: 150, color: [200, 40, 12, 255] as const },
      { start: 160, end: 240, color: [20, 180, 40, 255] as const },
    ]
    for (const band of bands) {
      for (let y = band.start; y < band.end; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4
          pixels[i] = band.color[0]
          pixels[i + 1] = band.color[1]
          pixels[i + 2] = band.color[2]
          pixels[i + 3] = 255
        }
      }
    }
    const sources = [{ refId: 'detail-1', width, height, pixels }]
    const layout = stitchDetailStripPixels(sources)
    const blocks = bands.map((band, index) => ({
      id: `m${index + 1}`,
      sellingPointText: `模块${index + 1}`,
      sourceRefIds: ['detail-1'],
      globalYStart: band.start,
      globalYEnd: band.end,
      boundSource: 'semantic_analysis' as const,
      uncertainBounds: false,
    }))
    writeEvidence('source-modules.png', width, height, pixels)
    const report = validateBlockCoverage(blocks, layout)
    expect(report.gaps).toEqual([
      { start: 70, end: 80 },
      { start: 150, end: 160 },
    ])
    blocks.forEach((block, index) => {
      const crop = cropBlockFromLayout(layout, block)
      expect(crop).not.toBeNull()
      expect(crop!.height).toBe(bands[index].end - bands[index].start)
      expect(crop!.pixels[0]).toBe(bands[index].color[0])
      expect(crop!.pixels[1]).toBe(bands[index].color[1])
      expect(crop!.pixels[2]).toBe(bands[index].color[2])
      writeEvidence(`module-${index + 1}.png`, crop!.width, crop!.height, crop!.pixels)
    })
  })
})
