import { describe, expect, it } from 'vitest'
import { planCaptureIngest, remapOptionBindings, type IngestableImage } from './captureIngest'
import { createOptionSlot } from './optionSlots'
import type { CompetitorRefImage } from './types'

function image(partial: Partial<IngestableImage> & Pick<IngestableImage, 'id' | 'category'>): IngestableImage {
  return {
    order: 1,
    fileName: `${partial.id}.png`,
    mimeType: 'image/png',
    byteLength: 10,
    sourceKey: `https://img.example.test/${partial.id}.jpg`,
    bytesStatus: 'ok',
    longImage: 'not_long',
    asset: { id: `asset-${partial.id}`, imageId: `asset-${partial.id}`, name: `capture:https://img.example.test/${partial.id}.jpg` },
    ...partial,
  }
}

describe('planCaptureIngest', () => {
  it('将三类图片入库，并绑定选购套餐', () => {
    const plan = planCaptureIngest({
      goodsId: '100000000001',
      images: [
        image({ id: 'hero-1', category: 'hero' }),
        image({ id: 'detail-1', category: 'detail', longImage: 'kept_intact', width: 800, height: 4000 }),
        image({ id: 'option-1', category: 'option' }),
      ],
      options: [{ optionName: '单独一只挖掘机', contentsNote: '', imageId: 'option-1' }],
    }, { goodsId: '100000000001', refs: [], optionSlots: [] })
    expect(plan.refsToAdd.filter((item) => !item.skipped)).toHaveLength(3)
    expect(plan.optionSlots).toHaveLength(1)
    expect(plan.optionSlots[0].missing).toBe(false)
    expect(plan.coverage.detail.intactLong).toBe(1)
    expect(plan.coverage.detail.note).toMatch(/完整保留，未切片/)
    expect(plan.captureStatus).toBe('capture_received')
  })

  it('部分失败时保留成功项，长图失败要标明未能取得完整长图', () => {
    const plan = planCaptureIngest({
      goodsId: '100000000001',
      images: [
        image({ id: 'hero-1', category: 'hero' }),
        image({ id: 'detail-1', category: 'detail', bytesStatus: 'unavailable', longImage: 'incomplete', asset: undefined }),
      ],
      options: [],
    }, { goodsId: '100000000001', refs: [], optionSlots: [] })
    expect(plan.refsToAdd.filter((item) => item.category === 'hero' && !item.skipped)).toHaveLength(1)
    expect(plan.refsToAdd.find((item) => item.category === 'detail')?.skipped).toBe(true)
    expect(plan.coverage.detail.incompleteLong).toBe(1)
    expect(plan.coverage.detail.note).toMatch(/未能取得完整长图/)
    expect(plan.captureStatus).toBe('capture_partial')
  })

  it('重试时按来源去重，不重复添加入库项', () => {
    const existingRef = {
      id: 'ref-old',
      category: 'hero',
      asset: { id: 'a', imageId: 'a', name: 'capture:https://img.example.test/hero-1.jpg' },
      optionName: '',
      contentsNote: '',
      sellingPoint: '',
      sceneHint: '',
      layoutSummary: '',
      analysisStatus: 'pending',
      source: 'link_capture',
    } satisfies CompetitorRefImage
    const plan = planCaptureIngest({
      goodsId: '100000000001',
      images: [image({ id: 'hero-1', category: 'hero' })],
      options: [],
    }, { goodsId: '100000000001', refs: [existingRef], optionSlots: [] })
    expect(plan.refsToAdd[0].skipped).toBe(true)
    expect(plan.refsToAdd[0].skipReason).toMatch(/去重/)
  })

  it('已有手工绑定发生冲突时不覆盖，留给用户核对', () => {
    const manualSlot = createOptionSlot({ optionName: '单独一只挖掘机', boundRefId: 'manual-ref' })
    const plan = planCaptureIngest({
      goodsId: '100000000001',
      images: [image({ id: 'option-1', category: 'option' })],
      options: [{ optionName: '单独一只挖掘机', contentsNote: '', imageId: 'option-1' }],
    }, { goodsId: '100000000001', refs: [], optionSlots: [manualSlot] })
    expect(plan.conflicts.length).toBeGreaterThan(0)
    expect(plan.optionSlots[0].boundRefId).toBe('manual-ref')
  })

  it('套餐缺图时保留名称并标缺失', () => {
    const plan = planCaptureIngest({
      goodsId: '100000000001',
      images: [image({ id: 'hero-1', category: 'hero' })],
      options: [{ optionName: '单独一只挖掘机', contentsNote: '', imageId: null }],
    }, { goodsId: '100000000001', refs: [], optionSlots: [] })
    expect(plan.optionSlots[0].missing).toBe(true)
    expect(plan.optionSlots[0].boundRefId).toBeNull()
    expect(plan.captureStatus).toBe('capture_partial')
  })
})

  it('把套餐临时来源键映射成真实引用编号', () => {
    const plan = planCaptureIngest({
      goodsId: '100000000001',
      images: [image({ id: 'option-1', category: 'option' })],
      options: [{ optionName: '单独一只挖掘机', contentsNote: '', imageId: 'option-1' }],
    }, { goodsId: '100000000001', refs: [], optionSlots: [] })
    const remapped = remapOptionBindings(plan.optionSlots, new Map([[plan.optionSlots[0].boundRefId!, 'ref-real']]))
    expect(remapped[0].boundRefId).toBe('ref-real')
    expect(remapped[0].missing).toBe(false)
  })
