import type { CompetitorCard, CompetitorRefImage, CompetitorSession } from './types'

export interface OptionInventoryItem {
  role: 'main' | 'gift' | 'accessory'
  name: string
  quantity: number | null
  appearance: string
}

export const OPTION_APPEARANCE_WARNING = '搭配中未在本套餐参考图或自家产品图出现的物品，真实外形未知；请补充该物品实拍参考。不得凭名称想象形状、结构或细节，也不得擅自换成别的物品。'

export function parseOptionInventory(value: unknown): OptionInventoryItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const row = raw as Record<string, unknown>
    if (!['main', 'gift', 'accessory'].includes(String(row.role)) || typeof row.name !== 'string' || !row.name.trim()) return []
    return [{ role: row.role as OptionInventoryItem['role'], name: row.name.trim(),
      quantity: typeof row.quantity === 'number' && Number.isInteger(row.quantity) && row.quantity > 0 ? row.quantity : null,
      appearance: typeof row.appearance === 'string' ? row.appearance.trim() : '' }]
  })
}

export function buildOptionGenerationRules(input: {
  refId?: string; userComposition?: string; inventory?: OptionInventoryItem[]
} = {}): string {
  const custom = input.userComposition?.trim()
  const inventory = input.inventory || []
  return [
    '选项图独立规则：按上传顺序一对一重构，每张只绑定自己的竞品选项参考及套餐，不套用主图循环，不自动增张、删组合或借用其他套餐。',
    input.refId ? `本张竞品参考 refId=${input.refId}。` : '',
    custom
      ? `本套餐用户指定搭配（仅本张优先）：${custom}。按用户明确要求组合主商品、赠品与配件及数量，不要用竞品默认清单否决用户增减搭配；未要求改变的物品外形仍须保真。其他套餐不受影响。`
      : '未填写本套餐搭配要求：以对应竞品选项图的原搭配一对一重构；识别主商品、赠品、配件，逐一保留各自形状、结构与可确认数量，不擅自增减或凭空添加物品/功能。',
    inventory.length ? `该竞品图可见物品（模型识别，须核对；不是用户修改后的强制清单）：${inventory.map((item) => `${{main:'主商品',gift:'赠品',accessory:'配件'}[item.role]}：${item.name}；数量=${item.quantity ?? '未确认，不猜测'}；外形依据=${item.appearance || '以原图可见部分为准'}`).join(' | ')}` : '尚无可靠物品清单：直接以绑定参考图可见实物为依据，不把未识别当作没有，也不凭空补清单或猜数量。',
    OPTION_APPEARANCE_WARNING,
    '自家产品外形以自家实拍为准；赠品和配件以已提供的对应实物参考为准。只重构构图，不改变实物形状、结构，不虚构功能。用户允许的搭配变更不是允许编造外形。',
  ].filter(Boolean).join('\n')
}

export function resolveOptionCardRules(session: CompetitorSession, card: CompetitorCard): string {
  const ref = session.refs.find((item) => item.id === card.refImageId && item.category === 'option')
  // Per-card composition is a preview snapshot. Package changes require an explicit local preview;
  // never silently replace an edited card or finished output with a newer package draft.
  const composition = card.optionCompositionNote || ''
  return buildOptionGenerationRules({refId: card.refImageId, userComposition: composition, inventory: ref?.optionInventory})
}

export function optionSlotForRef(slots: CompetitorSession['optionSlots'], ref: CompetitorRefImage) {
  return slots.find((slot) => slot.boundRefId === ref.id)
}
