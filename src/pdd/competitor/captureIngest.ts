import { importProductFiles } from '../assets'
import type { ProductAsset } from '../types'
import { bindOptionImage, createOptionSlot, type OptionSlotDraft } from './optionSlots'
import type { CaptureImagePayload, CaptureOptionPayload, CapturePayload } from './captureProtocol'
import type { CompetitorRefImage } from './types'
import type { CompetitorCategory } from './categories'
import { describeDetailCoverage, describeHeroCoverage, describeOptionCoverage, type CaptureCoverageSummary } from './coverage'

export interface ExistingCaptureState {
  goodsId: string | null
  refs: CompetitorRefImage[]
  optionSlots: OptionSlotDraft[]
}

export interface IngestableImage extends CaptureImagePayload {
  asset?: ProductAsset
}

export interface CaptureIngestPlan {
  refsToAdd: Array<{
    category: CompetitorCategory
    sourceKey: string
    payloadId: string
    optionName: string
    contentsNote: string
    asset?: ProductAsset
    bytesStatus: CaptureImagePayload['bytesStatus']
    longImage: CaptureImagePayload['longImage']
    skipped: boolean
    skipReason?: string
  }>
  optionSlots: OptionSlotDraft[]
  conflicts: string[]
  coverage: CaptureCoverageSummary
  captureStatus: 'capture_received' | 'capture_partial' | 'capture_blocked' | 'capture_failed'
  message: string
}

function sourceKeyOf(ref: CompetitorRefImage): string {
  return (ref.asset.name && ref.asset.name.startsWith('capture:') ? ref.asset.name.slice('capture:'.length) : '') || ref.id
}

export function planCaptureIngest(
  payload: Pick<CapturePayload, 'goodsId' | 'options' | 'reason' | 'message'> & { type?: CapturePayload['type']; images?: IngestableImage[] },
  existing: ExistingCaptureState,
): CaptureIngestPlan {
  if (payload.reason === 'login' || payload.reason === 'captcha' || payload.reason === 'platform' || payload.reason === 'unavailable' || payload.reason === 'wrong_item') {
    const message = payload.message || '采集已停止。'
    return {
      refsToAdd: [],
      optionSlots: existing.optionSlots,
      conflicts: [],
      coverage: {
        attempted: true,
        blocked: payload.reason,
        blockedMessage: message,
        hero: { found: 0, expected: null, status: 'none', note: message },
        detail: { found: 0, intactLong: 0, incompleteLong: 0, note: message },
        option: { inspected: false, total: 0, bound: 0, missing: 0, note: message },
      },
      captureStatus: 'capture_blocked',
      message,
    }
  }

  const images = payload.images || []
  const options = payload.options || []
  const existingKeys = new Set(existing.refs.filter((ref) => ref.source === 'link_capture').map((ref) => sourceKeyOf(ref) || ref.asset.name))
  const refsToAdd: CaptureIngestPlan['refsToAdd'] = []
  const addedKeyToTempId = new Map<string, string>()

  for (const image of images) {
    const sourceKey = image.sourceKey || image.id
    if (image.category === 'option' && image.bytesStatus !== 'ok') {
      refsToAdd.push({
        category: 'option',
        sourceKey,
        payloadId: image.id,
        optionName: '',
        contentsNote: '',
        bytesStatus: image.bytesStatus,
        longImage: image.longImage,
        skipped: true,
        skipReason: image.bytesStatus === 'preview_only' || image.bytesStatus === 'over_limit'
          ? '未能取得完整选项图，请手动补传。'
          : '无法读取该选项图字节，请手动补传。',
      })
      continue
    }
    if (image.bytesStatus !== 'ok' || !image.asset) {
      refsToAdd.push({
        category: image.category,
        sourceKey,
        payloadId: image.id,
        optionName: '',
        contentsNote: '',
        bytesStatus: image.bytesStatus,
        longImage: image.longImage,
        skipped: true,
        skipReason: image.longImage === 'incomplete'
          ? '未能取得完整长图，请手动补传，避免漏掉卖点。'
          : '未能读取图片字节，请手动补传。',
      })
      continue
    }
    if (existingKeys.has(sourceKey) || addedKeyToTempId.has(sourceKey)) {
      refsToAdd.push({
        category: image.category,
        sourceKey,
        payloadId: image.id,
        optionName: '',
        contentsNote: '',
        asset: image.asset,
        bytesStatus: image.bytesStatus,
        longImage: image.longImage,
        skipped: true,
        skipReason: '已存在相同来源的采集图片，已去重。',
      })
      continue
    }
    addedKeyToTempId.set(sourceKey, image.id)
    refsToAdd.push({
      category: image.category,
      sourceKey,
      payloadId: image.id,
      optionName: '',
      contentsNote: '',
      asset: image.asset,
      bytesStatus: image.bytesStatus,
      longImage: image.longImage,
      skipped: false,
    })
  }

  const payloadIdToRefHint = new Map<string, string>()
  for (const item of refsToAdd) {
    if (!item.skipped) payloadIdToRefHint.set(item.payloadId, item.sourceKey)
  }

  const optionSlots: OptionSlotDraft[] = existing.optionSlots.map((slot) => ({ ...slot }))
  const conflicts: string[] = []

  function findSlot(name: string): OptionSlotDraft | undefined {
    return optionSlots.find((slot) => slot.optionName === name)
  }

  for (const option of options) {
    const boundPayloadId = option.imageId
    let boundSourceKey: string | null = null
    if (boundPayloadId) {
      const planned = refsToAdd.find((item) => item.payloadId === boundPayloadId && item.category === 'option' && !item.skipped)
      boundSourceKey = planned?.sourceKey || payloadIdToRefHint.get(boundPayloadId) || null
      const existingRef = existing.refs.find((ref) => ref.category === 'option' && (sourceKeyOf(ref) === boundSourceKey || ref.id === boundPayloadId))
      if (!boundSourceKey && existingRef) boundSourceKey = existingRef.id
    }

    const existingSlot = findSlot(option.optionName)
    if (existingSlot) {
      if (existingSlot.boundRefId && boundSourceKey && existingSlot.boundRefId !== boundSourceKey) {
        conflicts.push(`套餐「${option.optionName}」已有手工绑定，采集结果未覆盖，请自行核对。`)
        continue
      }
      if (!existingSlot.boundRefId && boundSourceKey) {
        const next = bindOptionImage(existingSlot, boundSourceKey)
        const index = optionSlots.findIndex((slot) => slot.id === existingSlot.id)
        optionSlots[index] = { ...next, contentsNote: option.contentsNote || existingSlot.contentsNote }
      }
      continue
    }
    optionSlots.push(createOptionSlot({
      optionName: option.optionName,
      contentsNote: option.contentsNote,
      boundRefId: boundSourceKey,
    }))
  }

  const heroAdded = refsToAdd.filter((item) => item.category === 'hero' && !item.skipped)
  const heroFailed = refsToAdd.filter((item) => item.category === 'hero' && item.skipped && !item.skipReason?.includes('去重'))
  const detailAdded = refsToAdd.filter((item) => item.category === 'detail' && !item.skipped)
  const detailIncomplete = refsToAdd.filter((item) => item.category === 'detail' && item.longImage === 'incomplete')
  const detailIntact = refsToAdd.filter((item) => item.category === 'detail' && item.longImage === 'kept_intact' && !item.skipped)
  const optionCoverage = {
    inspected: true,
    total: optionSlots.filter((slot) => slot.optionName.trim()).length,
    bound: optionSlots.filter((slot) => slot.boundRefId && !slot.missing).length,
    missing: optionSlots.filter((slot) => slot.optionName.trim() && (!slot.boundRefId || slot.missing)).length,
  }
  const heroInfo = describeHeroCoverage(heroAdded.length, images.filter((image) => image.category === 'hero').length || null)
  const coverage: CaptureCoverageSummary = {
    attempted: true,
    hero: { found: heroAdded.length, expected: images.filter((image) => image.category === 'hero').length || null, status: heroInfo.status, note: heroInfo.note },
    detail: {
      found: detailAdded.length,
      intactLong: detailIntact.length,
      incompleteLong: detailIncomplete.length,
      note: describeDetailCoverage(detailAdded.length, detailIntact.length, detailIncomplete.length),
    },
    option: { ...optionCoverage, note: describeOptionCoverage(true, optionCoverage.total, optionCoverage.bound, optionCoverage.missing) },
  }

  const hasPartial = heroFailed.length > 0 || detailIncomplete.length > 0 || optionCoverage.missing > 0 || refsToAdd.some((item) => item.skipped && item.longImage === 'incomplete')
  const addedCount = refsToAdd.filter((item) => !item.skipped).length
  const captureStatus = addedCount === 0 && optionCoverage.total === 0
    ? 'capture_failed'
    : hasPartial
      ? 'capture_partial'
      : 'capture_received'
  const message = payload.message
    || (captureStatus === 'capture_partial'
      ? '已收到部分采集结果。请查看覆盖情况，缺的请手动补传。这不是真实登录验收完成。'
      : '已收到采集结果。请核对三类图片和套餐绑定。这还不是真实登录后的验收完成。')

  return { refsToAdd, optionSlots, conflicts, coverage, captureStatus, message }
}

export function attachImportedAssets(
  images: CaptureImagePayload[],
  assetsByPayloadId: Record<string, ProductAsset>,
): IngestableImage[] {
  return images.map((image) => ({ ...image, asset: assetsByPayloadId[image.id] }))
}

export function captureAssetName(sourceKey: string, fileName: string): string {
  return sourceKey ? `capture:${sourceKey}` : fileName
}

export function remapOptionBindings(slots: OptionSlotDraft[], keyToRefId: Map<string, string>): OptionSlotDraft[] {
  return slots.map((slot) => {
    if (!slot.boundRefId) return slot
    const mapped = keyToRefId.get(slot.boundRefId)
    return mapped ? bindOptionImage(slot, mapped) : slot
  })
}

export async function importCaptureImageAssets(
  images: IngestableImage[],
  importer: (files: File[]) => Promise<ProductAsset[]> = importProductFiles,
): Promise<{ assetsByPayloadId: Record<string, ProductAsset>; failures: string[] }> {
  const assetsByPayloadId: Record<string, ProductAsset> = {}
  const failures: string[] = []
  for (const image of images) {
    if (image.bytesStatus !== 'ok' || !image.blob) continue
    const file = new File([image.blob], image.fileName || `${image.category}-${image.id}.png`, { type: image.mimeType || 'image/png' })
    try {
      const assets = await importer([file])
      if (assets[0]) {
        assetsByPayloadId[image.id] = { ...assets[0], name: captureAssetName(image.sourceKey, assets[0].name) }
      } else {
        failures.push(image.id)
      }
    } catch {
      failures.push(image.id)
    }
  }
  return { assetsByPayloadId, failures }
}
