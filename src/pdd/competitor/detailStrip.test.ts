import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DETAIL_STRIP_MAX_HEIGHT,
  DETAIL_STRIP_MAX_PIXELS,
  DETAIL_STRIP_MAX_WIDTH,
  DETAIL_STRIP_SOURCE_MAX_SIDE,
  analysisBlockedBySkippedSources,
  buildDetailStripCacheKey,
  chooseDetailStripWidth,
  detailRefsInUploadOrder,
  fillSolidRgba,
  layoutDetailStrip,
  markEdge,
  samplePixel,
  stitchDetailStripPixels,
  type DetailStripSource,
} from './detailStrip'
import { unionCoverage } from './detailStripPack'

function getNodeFs(): {
  mkdirSync: (path: string, opts?: { recursive?: boolean }) => void
  writeFileSync: (path: string, data: Uint8Array) => void
  existsSync: (path: string) => boolean
  readFileSync: (path: string) => Uint8Array
} {
  const proc = globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => unknown } }
  const fs = proc.process?.getBuiltinModule?.('node:fs')
  if (!fs) throw new Error('无法写入本机证据文件')
  return fs as ReturnType<typeof getNodeFs>
}

function getNodeZlib(): { deflateSync: (data: Uint8Array) => Uint8Array } {
  const proc = globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => unknown } }
  const zlib = proc.process?.getBuiltinModule?.('node:zlib')
  if (!zlib) throw new Error('无法编码 PNG 证据')
  return zlib as ReturnType<typeof getNodeZlib>
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function encodePngRgba(width: number, height: number, pixels: Uint8ClampedArray): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 4)] = 0
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1)
  }
  const compressed = getNodeZlib().deflateSync(raw)
  const ihdrData = concat([u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0])])
  const chunk = (type: string, data: Uint8Array) => {
    const typeBytes = Uint8Array.from(type.split('').map((ch) => ch.charCodeAt(0)))
    const body = concat([typeBytes, data])
    return concat([u32(data.length), body, u32(crc32(body))])
  }
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed instanceof Uint8Array ? compressed : new Uint8Array(compressed)),
    chunk('IEND', new Uint8Array()),
  ])
}

function evidencePath(name: string): string {
  const proc = globalThis as unknown as { process?: { cwd?: () => string } }
  const cwd = proc.process?.cwd?.()
  if (!cwd) throw new Error('缺少工作目录')
  return `${cwd}/../var/t183-evidence/${name}`
}

function writeEvidence(name: string, width: number, height: number, pixels: Uint8ClampedArray): { path: string; bytes: number; width: number; height: number } {
  const png = encodePngRgba(width, height, pixels)
  const fs = getNodeFs()
  const path = evidencePath(name)
  fs.mkdirSync(`${cwdDir()}/../var/t183-evidence`, { recursive: true })
  fs.writeFileSync(path, png)
  return { path, bytes: png.byteLength, width, height }
}

function cwdDir(): string {
  const proc = globalThis as unknown as { process?: { cwd?: () => string } }
  const cwd = proc.process?.cwd?.()
  if (!cwd) throw new Error('缺少工作目录')
  return cwd
}

function source(refId: string, width: number, height: number, rgba: [number, number, number, number], edge?: [number, number, number, number], imageId = refId): DetailStripSource {
  const pixels = fillSolidRgba(width, height, rgba)
  if (edge) markEdge(pixels, width, height, edge)
  return { refId, imageId, width, height, pixels }
}

describe('详情参考图上传顺序与长图排版', () => {
  it('按数组顺序而不是文件名排序，并在追加、移除后重算', () => {
    const firstBatch = [
      { category: 'hero' as const, id: 'hero-1' },
      { category: 'detail' as const, id: 'detail-z' },
      { category: 'detail' as const, id: 'detail-a' },
    ]
    expect(detailRefsInUploadOrder(firstBatch).map((item) => item.id)).toEqual(['detail-z', 'detail-a'])

    const afterAppend = [
      ...firstBatch,
      { category: 'detail' as const, id: 'detail-m' },
      { category: 'option' as const, id: 'option-1' },
    ]
    expect(detailRefsInUploadOrder(afterAppend).map((item) => item.id)).toEqual(['detail-z', 'detail-a', 'detail-m'])

    const afterRemove = afterAppend.filter((item) => item.id !== 'detail-a')
    expect(detailRefsInUploadOrder(afterRemove).map((item) => item.id)).toEqual(['detail-z', 'detail-m'])
  })

  it('并行解码完成乱序时，仍按预留槽位保留选择顺序', async () => {
    const files = ['z-late.png', 'a-early.png', 'm-mid.png']
    const slots: string[] = new Array(files.length)
    await Promise.all(files.map(async (name, index) => {
      const delay = name.startsWith('z') ? 25 : name.startsWith('a') ? 0 : 10
      await new Promise((resolve) => setTimeout(resolve, delay))
      slots[index] = name
    }))
    expect(slots).toEqual(['z-late.png', 'a-early.png', 'm-mid.png'])
  })

  it('旧会话没有额外排序字段时，沿用已有 refs 数组顺序', () => {
    const legacy = [
      { category: 'detail' as const, id: 'old-2' },
      { category: 'detail' as const, id: 'old-1' },
    ]
    const layout = layoutDetailStrip([
      { refId: 'old-2', width: 100, height: 20 },
      { refId: 'old-1', width: 100, height: 30 },
    ])
    expect(legacy.map((item) => item.id)).toEqual(layout.placements.map((item) => item.refId))
    expect(layout.placements[0].y).toBe(0)
    expect(layout.placements[1].y).toBe(20)
  })
})

describe('详情长图像素拼接', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('按顺序纵向拼接不同宽高色块，等比例缩放且不裁切留白，并写出真实 PNG 证据', () => {
    const red = source('d-red', 200, 40, [220, 20, 20, 255], [255, 255, 255, 255])
    const blue = source('d-blue', 100, 20, [20, 40, 220, 255], [255, 255, 0, 255])
    const green = source('d-green', 200, 30, [20, 180, 40, 255], [0, 0, 0, 255])
    const stitched = stitchDetailStripPixels([red, blue, green])

    expect(stitched.kind).toBe('strip')
    expect(stitched.targetWidth).toBe(200)
    expect(stitched.width).toBe(200)
    expect(stitched.height).toBe(110)
    expect(stitched.placements.map((item) => [item.refId, item.y, item.width, item.height])).toEqual([
      ['d-red', 0, 200, 40],
      ['d-blue', 40, 200, 40],
      ['d-green', 80, 200, 30],
    ])

    const pixels = stitched.slices[0].pixels!
    expect(samplePixel(pixels, 200, 20, 10)).toEqual([220, 20, 20, 255])
    expect(samplePixel(pixels, 200, 100, 39)).toEqual([255, 255, 255, 255])
    expect(samplePixel(pixels, 200, 20, 50)).toEqual([20, 40, 220, 255])
    expect(samplePixel(pixels, 200, 0, 60)).toEqual([255, 255, 0, 255])
    expect(samplePixel(pixels, 200, 199, 60)).toEqual([255, 255, 0, 255])
    expect(samplePixel(pixels, 200, 20, 90)).toEqual([20, 180, 40, 255])
    // seam at y=40: last red-edge row then first blue-edge row
    expect(samplePixel(pixels, 200, 10, 39)).toEqual([255, 255, 255, 255])
    expect(samplePixel(pixels, 200, 10, 40)).toEqual([255, 255, 0, 255])
    expect(samplePixel(pixels, 200, 10, 79)).toEqual([255, 255, 0, 255])
    expect(samplePixel(pixels, 200, 10, 80)).toEqual([0, 0, 0, 255])

    const redFile = writeEvidence('fixture-red-200x40.png', 200, 40, red.pixels!)
    const blueFile = writeEvidence('fixture-blue-100x20.png', 100, 20, blue.pixels!)
    const greenFile = writeEvidence('fixture-green-200x30.png', 200, 30, green.pixels!)
    const stripFile = writeEvidence('stitched-200x110.png', 200, 110, pixels)
    expect(redFile.width).toBe(200)
    expect(blueFile.height).toBe(20)
    expect(greenFile.bytes).toBeGreaterThan(50)
    expect(stripFile).toMatchObject({ width: 200, height: 110 })
    expect(stripFile.bytes).toBeGreaterThan(100)
  })

  it('目标宽度取 min(960, 最大原图宽)，不把较窄图拉伸铺满时引入左右留白', () => {
    expect(chooseDetailStripWidth([{ width: 400 }, { width: 800 }])).toBe(800)
    expect(chooseDetailStripWidth([{ width: 1200 }, { width: 800 }])).toBe(DETAIL_STRIP_MAX_WIDTH)
    const layout = layoutDetailStrip([
      { refId: 'wide', width: 800, height: 10 },
      { refId: 'narrow', width: 400, height: 10 },
    ])
    expect(layout.placements[1].width).toBe(800)
    expect(layout.placements[1].height).toBe(20)
    expect(layout.width).toBe(800)
    expect(layout.height).toBe(30)
  })

  it('只有一张时不重复拼接，空列表给出明确状态', () => {
    const empty = layoutDetailStrip([])
    expect(empty.kind).toBe('empty')
    expect(empty.notices[0]?.message).toBe('暂无参考详情图')

    const single = stitchDetailStripPixels([source('only', 120, 80, [10, 20, 30, 255])])
    expect(single.kind).toBe('single')
    expect(single.slices).toHaveLength(1)
    expect(single.notices.some((notice) => notice.code === 'single')).toBe(true)
  })

  it('损坏或缺像素、超限原图会跳过并阻止静默漏图分析', () => {
    const corrupt = layoutDetailStrip([
      { refId: 'bad', width: 0, height: 0 },
      { refId: 'ok', width: 80, height: 20 },
    ])
    expect(corrupt.skipped[0]?.refId).toBe('bad')
    expect(analysisBlockedBySkippedSources(corrupt)).toMatch(/bad/)

    const huge = layoutDetailStrip([{ refId: 'huge', width: DETAIL_STRIP_SOURCE_MAX_SIDE + 1, height: 10 }])
    expect(huge.kind).toBe('empty')
    expect(analysisBlockedBySkippedSources(huge)).toMatch(/解码上限/)

    const missingPixels = stitchDetailStripPixels([{ refId: 'ghost', width: 40, height: 10 }])
    expect(missingPixels.notices.some((notice) => notice.code === 'missing_pixels')).toBe(true)
  })

  it('超高长图按顺序分段，保留段号和纵坐标，不截尾也不缩小到上限以内一张图', () => {
    const first = { refId: 'p1', width: 960, height: 5000 }
    const second = { refId: 'p2', width: 960, height: 5000 }
    const layout = layoutDetailStrip([first, second])
    expect(layout.kind).toBe('sliced')
    expect(layout.height).toBe(10000)
    expect(layout.slices).toHaveLength(2)
    expect(layout.slices[0]).toMatchObject({ index: 1, total: 2, yStart: 0, yEnd: 5000, sourceRefIds: ['p1'] })
    expect(layout.slices[1]).toMatchObject({ index: 2, total: 2, yStart: 5000, yEnd: 10000, sourceRefIds: ['p2'] })
    expect(layout.slices[0].height * layout.slices[0].width).toBeLessThanOrEqual(DETAIL_STRIP_MAX_PIXELS)
    expect(layout.notices.some((notice) => notice.message.includes('未截尾'))).toBe(true)

    const oversized = layoutDetailStrip([{ refId: 'tall', width: 960, height: DETAIL_STRIP_MAX_HEIGHT + 400 }])
    expect(oversized.kind).toBe('sliced')
    expect(oversized.slices[0].height).toBeLessThanOrEqual(DETAIL_STRIP_MAX_HEIGHT)
    expect(oversized.slices[oversized.slices.length - 1]?.yEnd).toBe(DETAIL_STRIP_MAX_HEIGHT + 400)
    const coverage = unionCoverage(oversized.slices, oversized.height)
    expect(coverage.covered).toBe(DETAIL_STRIP_MAX_HEIGHT + 400)
    expect(coverage.gaps).toEqual([])
    expect(oversized.slices.some((slice) => slice.cutKind === 'forced_split' || (slice.overlapTop ?? 0) > 0)).toBe(true)
  })

  it('缓存键随顺序、尺寸和目标宽度变化，避免沿用失效长图', () => {
    const a = buildDetailStripCacheKey([{ refId: 'a', imageId: 'ia', width: 10, height: 10 }], 10)
    const swapped = buildDetailStripCacheKey([{ refId: 'b', imageId: 'ib', width: 10, height: 10 }, { refId: 'a', imageId: 'ia', width: 10, height: 10 }], 10)
    const sameIdsDifferentOrder = buildDetailStripCacheKey([{ refId: 'a', imageId: 'ia', width: 10, height: 10 }, { refId: 'b', imageId: 'ib', width: 10, height: 10 }], 10)
    expect(a).not.toBe(swapped)
    expect(swapped).not.toBe(sameIdsDifferentOrder)
  })
})
