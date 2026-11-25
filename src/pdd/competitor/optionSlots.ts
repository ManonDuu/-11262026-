export interface OptionSlotDraft {
  id: string
  optionName: string
  contentsNote: string
  boundRefId: string | null
  missing: boolean
}

export function newOptionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `opt-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createOptionSlot(input: { optionName: string; contentsNote?: string; boundRefId?: string | null }): OptionSlotDraft {
  const optionName = input.optionName.trim()
  const boundRefId = input.boundRefId ?? null
  return {
    id: newOptionId(),
    optionName,
    contentsNote: (input.contentsNote || '').trim(),
    boundRefId,
    missing: !boundRefId,
  }
}

export function bindOptionImage(slot: OptionSlotDraft, refId: string | null): OptionSlotDraft {
  const boundRefId = refId && refId.trim() ? refId : null
  return { ...slot, boundRefId, missing: !boundRefId }
}

export function updateOptionRelationship(slot: OptionSlotDraft, patch: { optionName?: string; contentsNote?: string }): OptionSlotDraft {
  return {
    ...slot,
    optionName: patch.optionName !== undefined ? patch.optionName.trim() : slot.optionName,
    contentsNote: patch.contentsNote !== undefined ? patch.contentsNote.trim() : slot.contentsNote,
  }
}

/** 未绑图的套餐保持缺失，不得据此凭空生成卡片或编造配件数量。 */
export function slotsReadyForGeneration(slots: OptionSlotDraft[]): { ready: OptionSlotDraft[]; missing: OptionSlotDraft[] } {
  const ready: OptionSlotDraft[] = []
  const missing: OptionSlotDraft[] = []
  for (const slot of slots) {
    if (!slot.optionName.trim()) continue
    if (slot.boundRefId && !slot.missing) ready.push(slot)
    else missing.push({ ...slot, missing: true, boundRefId: null })
  }
  return { ready, missing }
}

export function coverageForOptions(slots: OptionSlotDraft[]): { total: number; bound: number; missing: number } {
  const named = slots.filter((slot) => slot.optionName.trim())
  const bound = named.filter((slot) => slot.boundRefId && !slot.missing).length
  return { total: named.length, bound, missing: named.length - bound }
}

export const PURCHASE_UI_EXCLUSIONS = ['价格', '预计送达', '购买按钮', '运费', '促销倒计时'] as const

export function isPurchaseUiText(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  return /价格|预计送达|¥|￥|券后|马上抢|立即购买|加入购物车/.test(value)
}
