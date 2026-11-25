import { describe, expect, it } from 'vitest'
import { bindOptionImage, coverageForOptions, createOptionSlot, isPurchaseUiText, slotsReadyForGeneration, updateOptionRelationship } from './optionSlots'

describe('选项套餐绑定', () => {
  it('按选购弹窗套餐逐项对应，未绑图标为缺失且不进入可生成列表', () => {
    const excavator = createOptionSlot({ optionName: '单独一只挖掘机', contentsNote: '挖掘机 1 只' })
    const stones = createOptionSlot({
      optionName: '加10个仿真塑料石头+2人仔',
      contentsNote: '挖掘机 1 只，仿真塑料石头 10 个，人仔 2 个',
      boundRefId: 'ref-stones',
    })
    const bundle = createOptionSlot({
      optionName: '加10个仿真塑料石头+2人仔+6只迷你工程车',
      contentsNote: '挖掘机 1 只，仿真塑料石头 10 个，人仔 2 个，迷你工程车 6 只',
    })

    expect(excavator.missing).toBe(true)
    expect(stones.missing).toBe(false)
    expect(bundle.missing).toBe(true)

    const named = [excavator, stones, bundle]
    const { ready, missing } = slotsReadyForGeneration(named)
    expect(ready.map((s) => s.optionName)).toEqual(['加10个仿真塑料石头+2人仔'])
    expect(missing).toHaveLength(2)
    expect(coverageForOptions(named)).toEqual({ total: 3, bound: 1, missing: 2 })
  })

  it('允许用户编辑套餐名称与配件数量关系，解绑后重新标为缺失', () => {
    const slot = createOptionSlot({ optionName: '套餐 A', boundRefId: 'ref-a' })
    const renamed = updateOptionRelationship(slot, { optionName: '单独一只挖掘机', contentsNote: '挖掘机 1 只' })
    expect(renamed.optionName).toBe('单独一只挖掘机')
    expect(renamed.contentsNote).toBe('挖掘机 1 只')
    expect(bindOptionImage(renamed, null).missing).toBe(true)
  })

  it('价格和预计送达属于购买界面，不当作卖点文本', () => {
    expect(isPurchaseUiText('价格 ¥29.9')).toBe(true)
    expect(isPurchaseUiText('预计送达 明天')).toBe(true)
    expect(isPurchaseUiText('单独一只挖掘机')).toBe(false)
  })
})
