import { shouldSyncFieldsIntoPrompt } from '../promptSync'
import { frameFromPreset } from '../frameSpec'
import type { StyleMode, CompetitorCard } from './types'
import type { TextPrimaryColor } from '../colors'
import { buildCompetitorImagePrompt } from './promptBuild'

export const COMPETITOR_STRUCTURED_KEYS = [
  'title',
  'subtitle',
  'sceneSummary',
  'layoutSummary',
  'sellingPoint',
  'optionName',
  'contentsNote',
] as const

export function applyCompetitorCardPatch(
  card: CompetitorCard,
  patch: Partial<CompetitorCard>,
  options: { styleMode: StyleMode; textPrimaryColor?: TextPrimaryColor | null },
): CompetitorCard {
  const next: CompetitorCard = { ...card, ...patch }
  if ('sellingPoint' in patch && patch.sellingPoint !== card.sellingPoint) {
    next.sellingPointSource = patch.sellingPointSource ?? 'user_specified'
  }
  if (('layoutSummary' in patch && patch.layoutSummary !== card.layoutSummary)
    || ('sceneSummary' in patch && patch.sceneSummary !== card.sceneSummary)) {
    next.styleSource = patch.styleSource ?? 'user_specified'
  }
  const fieldsChanged = COMPETITOR_STRUCTURED_KEYS.some((key) => key in patch && patch[key] !== card[key])
  const promptFromUser = 'imagePrompt' in patch && !fieldsChanged && !('lastStructuredEditAt' in patch)
  if (fieldsChanged) {
    next.lastStructuredEditAt = Date.now()
    if (shouldSyncFieldsIntoPrompt(next)) {
      next.imagePrompt = buildCompetitorImagePrompt({
        category: next.category,
        styleMode: options.styleMode,
        sellingPoint: next.sellingPoint,
        optionName: next.optionName,
        contentsNote: next.contentsNote,
        sceneHint: next.sceneSummary,
        layoutSummary: next.layoutSummary,
        styleSource: next.styleSource,
        title: next.title,
        subtitle: next.subtitle,
        frameSpec: next.frameSpec || frameFromPreset(next.aspectRatio),
        textPrimaryColor: options.textPrimaryColor ?? null,
      })
    }
  }
  if (promptFromUser) next.lastPromptEditAt = Date.now()
  return next
}
