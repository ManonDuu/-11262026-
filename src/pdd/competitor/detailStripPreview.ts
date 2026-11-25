import { useEffect, useMemo, useState } from 'react'
import { canvasToBlob, loadImage } from '../../lib/canvasImage'
import type { CompetitorRefImage } from './types'
import {
  describeDetailStripLayout,
  describeSliceCaption,
  detailRefsInUploadOrder,
  isSourceWithinDecodeLimits,
  DETAIL_STRIP_MAX_HEIGHT,
  DETAIL_STRIP_MAX_PIXELS,
  stitchDetailStripPixels,
  type DetailStripLayout,
  type DetailStripSlice,
  type DetailStripSource,
} from './detailStrip'

export interface DetailStripPreview {
  layout: DetailStripLayout
  urls: string[]
  objectUrls: string[]
  captions: string[]
  summary: string
  sourceDataUrl?: string
}

export function revokeDetailStripPreview(preview: DetailStripPreview | null | undefined): void {
  if (!preview) return
  for (const url of preview.objectUrls) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      // ignore already-revoked URLs
    }
  }
}

export async function decodeDataUrlPixels(dataUrl: string): Promise<{ width: number; height: number; pixels: Uint8ClampedArray }> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!isSourceWithinDecodeLimits(width, height)) {
    throw new Error(`图片过大，无法安全解码（${width}×${height}）`)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前环境无法创建画布解码图片')
  context.drawImage(image, 0, 0)
  const imageData = context.getImageData(0, 0, width, height)
  return { width, height, pixels: imageData.data }
}

async function encodeRgbaPngBlob(pixels: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前环境无法创建画布编码长图')
  const data = new Uint8ClampedArray(pixels)
  context.putImageData(new ImageData(data, width, height), 0, 0)
  return canvasToBlob(canvas, 'image/png')
}

async function encodeRgbaPngDataUrl(pixels: Uint8ClampedArray, width: number, height: number): Promise<string> {
  const blob = await encodeRgbaPngBlob(pixels, width, height)
  return blobToDataUrl(blob)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取拼接图片'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

export type DecodePixelsFn = (dataUrl: string) => Promise<{ width: number; height: number; pixels: Uint8ClampedArray }>
export type EncodeSliceFn = (slice: DetailStripSlice & { pixels?: Uint8ClampedArray }) => Promise<{ blobUrl?: string; dataUrl: string }>

export interface CreateDetailStripOptions {
  decodePixels?: DecodePixelsFn
  resolveDataUrl?: (ref: CompetitorRefImage) => string | undefined
  encodeSlice?: EncodeSliceFn
}

function sourceFromRef(
  ref: CompetitorRefImage,
  decoded?: { width: number; height: number; pixels: Uint8ClampedArray },
): DetailStripSource {
  return {
    refId: ref.id,
    imageId: ref.asset.imageId,
    width: decoded?.width || ref.asset.width || 0,
    height: decoded?.height || ref.asset.height || 0,
    pixels: decoded?.pixels,
  }
}

export async function createDetailStripPreview(
  refs: CompetitorRefImage[],
  options: CreateDetailStripOptions = {},
): Promise<DetailStripPreview> {
  const detailRefs = detailRefsInUploadOrder(refs)
  const decodePixels = options.decodePixels ?? decodeDataUrlPixels
  const sources: DetailStripSource[] = []

  for (const ref of detailRefs) {
    const dataUrl = options.resolveDataUrl?.(ref) ?? ref.asset.dataUrl
    if (!dataUrl) {
      sources.push(sourceFromRef(ref))
      continue
    }
    try {
      const decoded = await decodePixels(dataUrl)
      sources.push(sourceFromRef(ref, decoded))
    } catch {
      sources.push(sourceFromRef(ref))
    }
  }

  const layout = stitchDetailStripPixels(sources)

  if (layout.kind === 'empty') {
    return {
      layout,
      urls: [],
      objectUrls: [],
      captions: [],
      summary: describeDetailStripLayout(layout),
    }
  }

  if (layout.kind === 'single') {
    const only = detailRefs[0]
    const dataUrl = options.resolveDataUrl?.(only) ?? only.asset.dataUrl
    return {
      layout,
      urls: dataUrl ? [dataUrl] : [],
      objectUrls: [],
      captions: [],
      summary: describeDetailStripLayout(layout),
      sourceDataUrl: dataUrl,
    }
  }

  if (layout.notices.some((notice) => notice.code === 'missing_pixels' || notice.code === 'decode_failed')) {
    return {
      layout,
      urls: [],
      objectUrls: [],
      captions: layout.slices.map((slice) => describeSliceCaption(slice)),
      summary: layout.notices.find((notice) => notice.code === 'missing_pixels' || notice.code === 'decode_failed')?.message || describeDetailStripLayout(layout),
    }
  }

  const urls: string[] = []
  const objectUrls: string[] = []
  const captions: string[] = []

  for (const slice of layout.slices) {
    if (!slice.pixels) continue
    captions.push(describeSliceCaption(slice))
    if (options.encodeSlice) {
      const encoded = await options.encodeSlice(slice)
      urls.push(encoded.dataUrl)
      if (encoded.blobUrl) objectUrls.push(encoded.blobUrl)
      continue
    }
    const blob = await encodeRgbaPngBlob(slice.pixels, slice.width, slice.height)
    const objectUrl = URL.createObjectURL(blob)
    objectUrls.push(objectUrl)
    urls.push(objectUrl)
  }

  return {
    layout,
    urls,
    objectUrls,
    captions,
    summary: describeDetailStripLayout(layout),
  }
}

export async function encodeDetailStripDataUrls(
  layout: DetailStripLayout,
  encode: (pixels: Uint8ClampedArray, width: number, height: number) => Promise<string> = encodeRgbaPngDataUrl,
): Promise<string[]> {
  const urls: string[] = []
  for (const slice of layout.slices) {
    if (!slice.pixels) continue
    urls.push(await encode(slice.pixels, slice.width, slice.height))
  }
  return urls
}


export function useDetailStripPreview(detailRefs: CompetitorRefImage[]) {
  const [preview, setPreview] = useState<DetailStripPreview | null>(null)
  const [status, setStatus] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty')
  const [error, setError] = useState<string | null>(null)
  const cacheKey = useMemo(
    () => detailRefs.map((ref) => `${ref.id}:${ref.asset.imageId ?? ''}:${ref.asset.width}x${ref.asset.height}:${ref.asset.dataUrl ? ref.asset.dataUrl.length : 0}`).join('|'),
    [detailRefs],
  )

  useEffect(() => {
    let cancelled = false
    let current: DetailStripPreview | null = null
    if (detailRefs.length === 0) {
      setPreview(null)
      setStatus('empty')
      setError(null)
      return
    }
    if (detailRefs.length === 1) {
      const only = detailRefs[0]
      const width = only.asset.width || 0
      const height = only.asset.height || 0
      const oversized = height > DETAIL_STRIP_MAX_HEIGHT || width * height > DETAIL_STRIP_MAX_PIXELS
      if (oversized) {
        // fall through to packing so a single oversize image is not shown or analyzed as one unreadably huge canvas
      } else {
      const dataUrl = only.asset.dataUrl || only.asset.thumbnailDataUrl
      setPreview({
        layout: {
          kind: 'single',
          width: only.asset.width || 0,
          height: only.asset.height || 0,
          targetWidth: only.asset.width || 0,
          placements: [{
            refId: only.id,
            imageId: only.asset.imageId,
            sourceWidth: only.asset.width || 0,
            sourceHeight: only.asset.height || 0,
            width: only.asset.width || 0,
            height: only.asset.height || 0,
            y: 0,
          }],
          slices: [],
          skipped: [],
          notices: [{ code: 'single', message: '仅有一张详情参考图，直接使用原图预览，不再重复拼接。', refId: only.id }],
          cacheKey: `detail-strip:single:${only.id}:${only.asset.imageId ?? ''}`,
        },
        urls: dataUrl ? [dataUrl] : [],
        objectUrls: [],
        captions: [],
        summary: '当前仅有一张详情参考图，直接显示原图。',
        sourceDataUrl: dataUrl,
      })
      setStatus('ready')
      setError(null)
      return
      }
    }
    setStatus('loading')
    setError(null)
    void createDetailStripPreview(detailRefs)
      .then((result) => {
        if (cancelled) {
          revokeDetailStripPreview(result)
          return
        }
        current = result
        setPreview(result)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPreview(null)
        setStatus('error')
        setError(err instanceof Error ? err.message : '详情参考长图拼接失败')
      })
    return () => {
      cancelled = true
      revokeDetailStripPreview(current)
    }
  }, [cacheKey, detailRefs])

  return { preview, status, error }
}
