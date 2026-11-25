import { COMPETITOR_CATEGORIES, type CompetitorCategory } from './categories'
import type { CompetitorSession } from './types'

export function categoryConfirmed(session: CompetitorSession, category: CompetitorCategory): boolean {
  return session.categoryConfirmations ? Boolean(session.categoryConfirmations[category]) : session.generationConfirmed
}

export function invalidateCategory(session: CompetitorSession, category: CompetitorCategory) {
  return Object.fromEntries(COMPETITOR_CATEGORIES.map((item) => [item, item === category ? false : categoryConfirmed(session, item)]))
}
