import type { TextPrimaryColor } from '../colors'
import type { DetectedModels, FrameSpec, ProductAsset, QueuePhase, StoryboardCard } from '../types'
import type { CompetitorCategory } from './categories'

export type StyleMode = 'strict' | 'custom'
export type AnalysisStatus = 'pending' | 'user_filled' | 'model_suggested'
export type ImageSource = 'manual_import' | 'link_capture'
export type SellingPointOrigin = 'competitor_reference' | 'user_supplied'
export type SellingPointClaimStatus = 'confirmed' | 'unconfirmed' | 'conflict'

/** 详情段落中的一条可追溯卖点。旧会话可缺省。 */
export interface SellingPointClaim {
  id: string
  core: string
  copy?: string
  origin: SellingPointOrigin
  status: SellingPointClaimStatus
  evidenceNote?: string
  conflictNote?: string
  yStart?: number
  yEnd?: number
  sliceIndex?: number
  uncertainBounds?: boolean
}
export type CaptureStatus = 'idle' | 'normalized_not_fetched' | 'invalid' | 'unsupported_host' | 'not_implemented' | 'awaiting_user_capture' | 'capture_received' | 'capture_partial' | 'capture_blocked' | 'capture_failed' | 'automation_unavailable' | 'awaiting_login' | 'awaiting_captcha' | 'capturing' | 'target_unavailable'

/** 选购弹窗中的一个套餐/规格。未绑图时标为缺失，不自动造图。 */
export interface OptionSlot {
  id: string
  optionName: string
  contentsNote: string
  boundRefId: string | null
  missing: boolean
}

export interface CompetitorRefImage {
  optionInventory?: import('./optionRules').OptionInventoryItem[];
  id: string
  category: CompetitorCategory
  asset: ProductAsset
  /** 选项图必须绑定的套餐/规格名称；主图、详情图可为空。 */
  optionName: string
  /** 该选项的产品、配件与数量差异，供生成时锁定，不得臆造。 */
  contentsNote: string
  sellingPoint: string
  sceneHint: string
  layoutSummary: string
  analysisStatus: AnalysisStatus
  source: ImageSource
  /** 参考图已表达的核心事实；旧会话可缺省。 */
  sellingPointCore?: string
  sellingPointClaims?: SellingPointClaim[]
  analysisWarnings?: string[]
}

export interface CompetitorCard extends StoryboardCard {
  optionRulesVersion?: 1
  optionSlotId?: string
  optionCompositionNote?: string
  category: CompetitorCategory
  refImageId: string
  optionName: string
  contentsNote: string
  sellingPoint: string
  sellingPointCore?: string
  sellingPointIds?: string[]
  sellingPointSource?: 'user_specified' | 'competitor_reference' | 'unconfirmed' | 'empty'
  styleSource?: 'user_specified' | 'competitor_reference' | 'unconfirmed' | 'empty'
  analysisWarnings?: string[]
  detailSetIndex?: number
  detailSetTotal?: number
  /** selling_point_pages：按卖点分张。long_strip 仅兼容旧预览，生成前需手动重建。缺省视为旧的逐张卡片。 */
  detailRenderMode?: 'long_strip' | 'legacy_pages' | 'selling_point_pages'
  detailBlockId?: string
  detailBlockSourceRefIds?: string[]
  detailCropSlices?: Array<{
    index: number
    total: number
    y: number
    width: number
    height: number
    isRemainder: boolean
    imageId?: string
  }>
  detailCropNote?: string
  /** 主图在上传顺序循环中的 0-based 张次；旧卡可缺省。 */
  heroSlotIndex?: number
  /** 循环轮次，从 1 起；超过参考主图数量后为第 2 轮起。 */
  heroCycleRound?: number
  /** 绑定的竞品主图在实际上传顺序中的 1-based 序号。 */
  heroRefOrdinal?: number
}


export interface CoverageRow {
  category: CompetitorCategory
  imported: number
  captured: number
  missing: number
  note: string
}

export interface CompetitorSession {
  id: string
  createdAt: number
  updatedAt: number
  goodsId: string | null
  canonicalUrl: string | null
  loginLikely: boolean
  captureStatus: CaptureStatus
  parseMessage: string
  captureCoverage?: import('./coverage').CaptureCoverageSummary | null
  productName: string
  /** 用户确认的自家商品要点，选填。不把主图营销点自动算作商品资料。 */
  productFactsNote?: string
  /** 用户主动填写的详情卖点要求。未填时按竞品参考默认。 */
  detailSellingPointNote?: string
  /** 用户主动填写的详情构图/风格要求。未填时按竞品构图风格默认。 */
  detailStyleNote?: string
  /** 分析后按卖点拆出的参考块几何，缺省表示尚未分析或无法可靠分段。 */
  detailSellingPointBlocks?: import('./detailSellingPointBlocks').DetailSellingPointBlock[]
  detailCropRatioWidth?: number
  detailCropRatioHeight?: number
  detailCropRatioSource?: 'user_selected' | 'default_suggestion'
  styleMode: StyleMode
  textPrimaryColor?: TextPrimaryColor | null
  productAssets: ProductAsset[]
  refs: CompetitorRefImage[]
  optionSlots: OptionSlot[]
  cards: CompetitorCard[]
  /** 主图每次点击「生成主图」要生成的数量。旧会话可缺省。 */
  heroGenerateCount?: number
  categoryConfirmations?: Partial<Record<CompetitorCategory, boolean>>
  generationConfirmed: boolean
  confirmedAt?: number
  planningError: string | null
  heroMappingNote?: string | null
  lastAnalysisError?: {
    at: number
    category: 'hero' | 'detail' | 'option' | 'all'
    message: string
    durationMs?: number
  } | null
  planningModel?: string
  imageModel?: string
}

export interface CompetitorStateSlice {
  session: CompetitorSession
  planningModel: string
  imageModel: string
  detected: DetectedModels | null
  queuePhase: QueuePhase
  queueCursor: number
  queuePaused: boolean
  queueStopped: boolean
  activeCardId: string | null
  lightbox: { cardId: string } | null
}
