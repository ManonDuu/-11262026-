import { parseImageUrl } from '../collector/imageGuard'

const MAX_ITEMS = 80
const MAX_URL_LENGTH = 2000
const MAX_NAME_LENGTH = 80

export type IncomingImage = { sourceUrl?: unknown; width?: unknown; height?: unknown; alt?: unknown }
export type IncomingOption = { optionName?: unknown; sourceUrl?: unknown }

function asCleanString(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

export function isAllowedImageUrl(raw: string): boolean {
  if (!raw || raw.length > MAX_URL_LENGTH) return false
  return parseImageUrl(raw).ok
}

export function sanitizeIncomingImport(body: unknown, path: string, now = Date.now()) {
  const input = (body && typeof body === 'object') ? body as Record<string, unknown> : {}
  const hero = Array.isArray(input.hero) ? input.hero.slice(0, MAX_ITEMS) : []
  const detail = Array.isArray(input.detail) ? input.detail.slice(0, MAX_ITEMS) : []
  const options = Array.isArray(input.options) ? input.options.slice(0, MAX_ITEMS) : []
  const notes = Array.isArray(input.notes)
    ? input.notes.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 200)).slice(0, 12)
    : []

  const images = (list: IncomingImage[]) => list.flatMap((item) => {
    const sourceUrl = asCleanString(item?.sourceUrl, MAX_URL_LENGTH)
    if (!isAllowedImageUrl(sourceUrl)) return []
    const width = typeof item.width === 'number' && Number.isFinite(item.width) ? item.width : null
    const height = typeof item.height === 'number' && Number.isFinite(item.height) ? item.height : null
    return [{ sourceUrl, width, height, alt: asCleanString(item.alt, 80) }]
  })

  const optionRows = options.flatMap((item: IncomingOption) => {
    const optionName = asCleanString(item?.optionName, MAX_NAME_LENGTH)
    if (!optionName) return []
    const sourceUrl = asCleanString(item.sourceUrl, MAX_URL_LENGTH)
    return [{ optionName, sourceUrl: sourceUrl && isAllowedImageUrl(sourceUrl) ? sourceUrl : null }]
  })

  const heroRows = images(hero)
  const detailRows = images(detail)
  return {
    receivedAt: now,
    path,
    heroCount: heroRows.length,
    detailCount: detailRows.length,
    optionCount: optionRows.length,
    optionsInspected: input.optionsInspected === true,
    optionNames: optionRows.map((item) => item.optionName),
    notes,
    hero: heroRows,
    detail: detailRows,
    options: optionRows,
  }
}
