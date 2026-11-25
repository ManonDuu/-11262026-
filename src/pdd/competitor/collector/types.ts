import type { CaptureCoverageSummary } from '../coverage'
import type { CollectorNavTrace } from './navTrace'
import type { CollectorEntryKind } from '../linkNormalize'
import type { CollectorLastError } from './errorClassify'

export type { CollectorEntryKind }

export type CollectorPhase =
  | 'idle'
  | 'launching'
  | 'awaiting_login'
  | 'awaiting_captcha'
  | 'capturing'
  | 'awaiting_continue'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'runtime_missing'
  | 'target_unavailable'

export interface CollectorProgress {
  step: string
  heroFound: number
  detailFound: number
  optionFound: number
  optionTotal: number | null
  heroExpected: number | null
}

export interface CollectorImageMeta {
  id: string
  category: 'hero' | 'detail' | 'option'
  order: number
  fileName: string
  mimeType: string
  byteLength: number
  width?: number
  height?: number
  sourceKey: string
  bytesStatus: 'ok' | 'unavailable' | 'over_limit' | 'preview_only' | 'invalid_type'
  longImage: 'kept_intact' | 'incomplete' | 'not_long'
  optionName?: string
  contentsNote?: string
}

export interface CollectorOptionMeta {
  optionName: string
  contentsNote: string
  imageId: string | null
  missing: boolean
  missingReason: string
}

export interface CollectorJobPublic {
  id: string
  goodsId: string
  canonicalUrl: string
  phase: CollectorPhase
  message: string
  progress: CollectorProgress
  coverage?: CaptureCoverageSummary
  images: CollectorImageMeta[]
  options: CollectorOptionMeta[]
  canContinue: boolean
  startedAt: number
  updatedAt: number
  lastError?: CollectorLastError
  pageSignals?: CollectorPageSignals
  entryKind?: CollectorEntryKind
  navTrace?: CollectorNavTrace
}

export type CollectorPageSignalRule =
  | 'sold_out_similar'
  | 'delisted'
  | 'wrong_item'
  | 'login'
  | 'captcha'
  | 'platform'
  | 'unconfirmed'
  | 'post_login_home'

export interface CollectorPageSignals {
  rule: CollectorPageSignalRule | null
  urlPath: string | null
  itemIdMatch: boolean | null
  itemIdSource?: 'location_query' | 'og_url' | 'dom' | null
  elapsedMs: number
}

export type { CollectorLastError }

export interface CollectorRuntimeInfo {
  ready: boolean
  playwrightVersion: string
  chromiumRevision: string
  message: string
}
