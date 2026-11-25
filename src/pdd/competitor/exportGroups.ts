import { downloadSetZip } from '../exportSet'
import { CATEGORY_LABELS, COMPETITOR_CATEGORIES, type CompetitorCategory } from './categories'
import type { CompetitorCard } from './types'

export async function downloadGroupedZip(cards: CompetitorCard[], zipName = 'pdd-competitor-set.zip'): Promise<number> {
  const named = cards.map((card) => ({
    ...card,
    role: `${CATEGORY_LABELS[card.category]}${card.optionName ? `-${card.optionName}` : ''}` as typeof card.role,
  }))
  return downloadSetZip(named, zipName)
}

export function groupCards(cards: CompetitorCard[]): Record<CompetitorCategory, CompetitorCard[]> {
  const groups: Record<CompetitorCategory, CompetitorCard[]> = { hero: [], detail: [], option: [] }
  for (const category of COMPETITOR_CATEGORIES) {
    groups[category] = cards.filter((card) => card.category === category)
  }
  return groups
}

export async function downloadCategoryZip(cards: CompetitorCard[], category: CompetitorCategory): Promise<number> {
  const subset = groupCards(cards)[category] || []
  const label = CATEGORY_LABELS[category]
  return downloadGroupedZip(subset, `pdd-competitor-${label}.zip`)
}
