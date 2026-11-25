import { registerImageReferenceSource, structuredWorkbenchImageIds } from '../../lib/imageReferences'
import { categoryConfirmed, invalidateCategory } from './categoryScope'
import type { DetailSellingPointBlock } from './detailSellingPointBlocks'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { hydrateAssets } from '../assets'
import type { TextPrimaryColor } from '../colors'
import type { DetectedModels, ProductAsset, QueuePhase } from '../types'
import { applyCompetitorCardPatch } from './cardPatch'
import { applyAnalysisSuggestions, type AnalysisSuggestion } from './analyze'
import type { CompetitorCategory } from './categories'
import type { LinkNormalizeResult } from './linkNormalize'
import { bindOptionImage, createOptionSlot, updateOptionRelationship, type OptionSlotDraft } from './optionSlots'
import { remapOptionBindings, type CaptureIngestPlan } from './captureIngest'
import type { CaptureCoverageSummary } from './coverage'
import { defaultHeroGenerateCount } from './heroGenerateCount'
import { assessHeroMappingCompatibility } from './heroRefCycle'
import { buildPreviewCards, reconcilePreviewCards } from './preview'
import type { CompetitorCard, CompetitorRefImage, CompetitorSession, StyleMode } from './types'

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `cmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createSession(): CompetitorSession {
  return {
    id: newId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    goodsId: null,
    canonicalUrl: null,
    loginLikely: false,
    captureStatus: 'idle',
    parseMessage: '',
    captureCoverage: null,
    productName: '',
    styleMode: 'strict',
    textPrimaryColor: null,
    productAssets: [],
    refs: [],
    optionSlots: [],
    cards: [],
    generationConfirmed: false,
    planningError: null,
    heroMappingNote: null,
    lastAnalysisError: null,
  }
}

function touch(session: CompetitorSession, patch: Partial<CompetitorSession>): CompetitorSession {
  return { ...session, ...(patch.generationConfirmed === false && !('categoryConfirmations' in patch) ? { categoryConfirmations: undefined } : {}), ...patch, updatedAt: Date.now() }
}

export interface CompetitorState {
  generationInFlight: string | null
  analysisInFlight: CompetitorCategory | null
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
  applyLinkResult: (result: LinkNormalizeResult) => void
  bindGoodsIdentity: (goodsId: string, canonicalUrl?: string | null) => void
  setProductName: (value: string) => void
  setProductFactsNote: (value: string) => void
  setDetailSellingPointNote: (value: string) => void
  setDetailStyleNote: (value: string) => void
  setDetailCropRatio: (width: number, height: number, source?: 'user_selected' | 'default_suggestion') => void
  setStyleMode: (value: StyleMode) => void
  setTextPrimaryColor: (value: TextPrimaryColor | null) => void
  setProductAssets: (value: ProductAsset[]) => void
  addRefs: (refs: CompetitorRefImage[]) => void
  patchRef: (id: string, patch: Partial<CompetitorRefImage>) => void
  removeRef: (id: string) => void
  addOptionSlot: (optionName: string, contentsNote?: string) => void
  updateOptionSlot: (id: string, patch: { optionName?: string; contentsNote?: string }) => void
  bindOptionSlot: (id: string, refId: string | null) => void
  removeOptionSlot: (id: string) => void
  setModels: (planning?: string, image?: string) => void
  setDetected: (value: DetectedModels | null) => void
  applyAnalysisSuggestions: (suggestions: AnalysisSuggestion[], extras?: { sellingPointBlocks?: DetailSellingPointBlock[]; category?: CompetitorCategory }) => void
  setAnalysisError: (error: CompetitorSession['lastAnalysisError']) => void
  patchCard: (id: string, patch: Partial<CompetitorCard>) => void
  removeCard: (id: string) => void
  setQueue: (patch: Partial<Pick<CompetitorState, 'queuePhase' | 'queueCursor' | 'queuePaused' | 'queueStopped' | 'activeCardId'>> & { phase?: QueuePhase; cursor?: number; paused?: boolean; stopped?: boolean }) => void
  setLightbox: (cardId: string | null) => void
  setPlanningError: (error: string | null) => void
  setHeroGenerateCount: (heroGenerateCount: number) => void
  appendCards: (cards: CompetitorCard[]) => void
  replaceCardsById: (cards: CompetitorCard[]) => void
  buildPreview: (category?: CompetitorCategory) => { count: number; skippedMissingOptions: number; heroMappingNote?: string | null; preservedCount?: number }
  confirmGeneration: (confirmed: boolean, category?: CompetitorCategory) => void
  setCaptureStatus: (captureStatus: CompetitorSession['captureStatus'], parseMessage: string, captureCoverage?: CaptureCoverageSummary | null) => void
  commitCapturePlan: (plan: CaptureIngestPlan, importedRefs: CompetitorRefImage[]) => void
}

export const useCompetitorStore = create<CompetitorState>()(
  persist(
    (set, get) => ({
      session: createSession(),
      analysisInFlight: null,
      generationInFlight: null,
      planningModel: '',
      imageModel: '',
      detected: null,
      queuePhase: 'idle',
      queueCursor: 0,
      queuePaused: false,
      queueStopped: false,
      activeCardId: null,
      lightbox: null,
      applyLinkResult: (result) => set((s) => ({
        session: touch(s.session, {
          goodsId: result.ok ? result.goodsId : null,
          canonicalUrl: result.ok ? result.canonicalUrl : null,
          loginLikely: result.ok ? result.loginLikely : false,
          captureStatus: result.captureStatus,
          parseMessage: result.message,
          captureCoverage: null,
        }),
      })),
      bindGoodsIdentity: (goodsId, canonicalUrl) => set((s) => ({
        session: touch(s.session, {
          goodsId,
          canonicalUrl: canonicalUrl || s.session.canonicalUrl,
        }),
      })),
      setProductName: (productName) => set((s) => ({ session: touch(s.session, { productName }) })),
      setProductFactsNote: (productFactsNote) => set((s) => ({ session: touch(s.session, { productFactsNote }) })),
      setDetailSellingPointNote: (detailSellingPointNote) => set((s) => ({ session: touch(s.session, { detailSellingPointNote, generationConfirmed: false, categoryConfirmations: invalidateCategory(s.session, 'detail') }) })),
      setDetailStyleNote: (detailStyleNote) => set((s) => ({ session: touch(s.session, { detailStyleNote, generationConfirmed: false, categoryConfirmations: invalidateCategory(s.session, 'detail') }) })),
      setDetailCropRatio: (width, height, source = 'user_selected') => set((s) => ({ session: touch(s.session, { detailCropRatioWidth: width, detailCropRatioHeight: height, detailCropRatioSource: source }) })),
      setStyleMode: (styleMode) => set((s) => ({ session: touch(s.session, { styleMode, generationConfirmed: false }) })),
      setTextPrimaryColor: (textPrimaryColor) => set((s) => ({ session: touch(s.session, { textPrimaryColor, generationConfirmed: false }) })),
      setProductAssets: (productAssets) => set((s) => ({ session: touch(s.session, { productAssets }) })),
      addRefs: (refs) => set((s) => ({
        session: touch(s.session, { refs: [...s.session.refs, ...refs], generationConfirmed: false, categoryConfirmations: Object.fromEntries(['hero','detail','option'].map((category) => [category, refs.some((ref) => ref.category === category) ? false : categoryConfirmed(s.session, category as CompetitorCategory)])) }),
      })),
      patchRef: (id, patch) => set((s) => ({
        session: touch(s.session, {
          generationConfirmed: false,
          categoryConfirmations: invalidateCategory(s.session, s.session.refs.find((ref) => ref.id === id)?.category || 'hero'),
          refs: s.session.refs.map((ref) => (ref.id === id ? { ...ref, ...patch } : ref)),
        }),
      })),
      removeRef: (id) => set((s) => ({
        session: touch(s.session, {
          generationConfirmed: false,
          categoryConfirmations: invalidateCategory(s.session, s.session.refs.find((ref) => ref.id === id)?.category || 'hero'),
          refs: s.session.refs.filter((ref) => ref.id !== id),
          optionSlots: s.session.optionSlots.map((slot) => (slot.boundRefId === id ? bindOptionImage(slot, null) : slot)),
          cards: s.session.cards.filter((card) => card.refImageId !== id),
        }),
      })),
      addOptionSlot: (optionName, contentsNote) => set((s) => ({
        session: touch(s.session, {
          optionSlots: [...s.session.optionSlots, createOptionSlot({ optionName, contentsNote })],
          generationConfirmed: false,
          categoryConfirmations: invalidateCategory(s.session, 'option'),
        }),
      })),
      updateOptionSlot: (id, patch) => set((s) => ({
        session: touch(s.session, {
          generationConfirmed: false,
          categoryConfirmations: invalidateCategory(s.session, 'option'),
          optionSlots: s.session.optionSlots.map((slot) => (slot.id === id ? updateOptionRelationship(slot, patch) : slot)),
        }),
      })),
      bindOptionSlot: (id, refId) => set((s) => ({
        session: touch(s.session, {
          generationConfirmed: false,
          categoryConfirmations: invalidateCategory(s.session, 'option'),
          optionSlots: s.session.optionSlots.map((slot) => (slot.id === id ? bindOptionImage(slot, refId) : slot)),
        }),
      })),
      removeOptionSlot: (id) => set((s) => ({
        session: touch(s.session, {
          generationConfirmed: false,
          categoryConfirmations: invalidateCategory(s.session, 'option'),
          optionSlots: s.session.optionSlots.filter((slot) => slot.id !== id),
        }),
      })),
      setModels: (planning, image) => set((s) => ({
        planningModel: planning ?? s.planningModel,
        imageModel: image ?? s.imageModel,
        session: touch(s.session, { planningModel: planning ?? s.planningModel, imageModel: image ?? s.imageModel }),
      })),
      setDetected: (detected) => set({ detected }),
      applyAnalysisSuggestions: (suggestions: AnalysisSuggestion[], extras) => set((s) => {
        const category = extras?.category
        const allowedIds = new Set(
          s.session.refs
            .filter((ref) => !category || ref.category === category)
            .map((ref) => ref.id),
        )
        const scoped = suggestions.filter((item) => allowedIds.has(item.refId))
        const keepBlocks = category === 'hero' || category === 'option'
        const nextBlocks = keepBlocks
          ? s.session.detailSellingPointBlocks
          : (extras && Object.prototype.hasOwnProperty.call(extras, 'sellingPointBlocks')
            ? extras.sellingPointBlocks
            : s.session.detailSellingPointBlocks)
        return {
          session: touch(s.session, {
            refs: applyAnalysisSuggestions(s.session.refs, scoped),
            detailSellingPointBlocks: nextBlocks,
            generationConfirmed: false,
            categoryConfirmations: extras?.category ? invalidateCategory(s.session, extras.category) : undefined,
            lastAnalysisError: null,
          }),
        }
      }),
      setAnalysisError: (error) => set((s) => ({
        session: touch(s.session, { lastAnalysisError: error ?? null }),
      })),
      patchCard: (id, patch) => set((s) => ({
        session: touch(s.session, {
          cards: s.session.cards.map((card) => (card.id === id
            ? applyCompetitorCardPatch(card, {
                ...patch,
                ...(Object.prototype.hasOwnProperty.call(patch, 'sellingPoint') ? { sellingPointSource: patch.sellingPointSource ?? 'user_specified' } : {}),
                ...(Object.prototype.hasOwnProperty.call(patch, 'layoutSummary') || Object.prototype.hasOwnProperty.call(patch, 'sceneSummary') ? { styleSource: patch.styleSource ?? 'user_specified' } : {}),
              }, { styleMode: s.session.styleMode, textPrimaryColor: s.session.textPrimaryColor ?? null })
            : card)),
        }),
      })),
      removeCard: (id) => set((s) => ({
        session: touch(s.session, {
          cards: s.session.cards.filter((card) => card.id !== id).map((card, index) => ({ ...card, index: index + 1 })),
        }),
      })),
      setQueue: (patch) => set((s) => ({
        queuePhase: patch.phase ?? patch.queuePhase ?? s.queuePhase,
        queueCursor: patch.cursor ?? patch.queueCursor ?? s.queueCursor,
        queuePaused: patch.paused ?? patch.queuePaused ?? s.queuePaused,
        queueStopped: patch.stopped ?? patch.queueStopped ?? s.queueStopped,
        activeCardId: patch.activeCardId === undefined ? s.activeCardId : patch.activeCardId,
      })),
      setLightbox: (cardId) => set({ lightbox: cardId ? { cardId } : null }),
      setPlanningError: (planningError) => set((s) => ({ session: touch(s.session, { planningError }) })),
      setHeroGenerateCount: (heroGenerateCount) => set((s) => ({ session: touch(s.session, { heroGenerateCount }) })),
      appendCards: (cards) => set((s) => {
        if (!cards.length) return s
        return { session: touch(s.session, { cards: [...s.session.cards, ...cards] }) }
      }),
      replaceCardsById: (cards) => set((s) => {
        if (!cards.length) return s
        const byId = new Map(cards.map((card) => [card.id, card]))
        return { session: touch(s.session, { cards: s.session.cards.map((card) => byId.get(card.id) || card) }) }
      }),
      buildPreview: (category?: CompetitorCategory) => {
        const state = get()
        const scopedRefs = state.session.refs.filter((ref) => !category || ref.category === category)
        if (category && !scopedRefs.length) return { count: 0, skippedMissingOptions: 0 }
        const heroGenerateCount = defaultHeroGenerateCount(state.session)
        const built = buildPreviewCards({
          refs: scopedRefs,
          optionSlots: !category || category === 'option' ? state.session.optionSlots : [],
          styleMode: state.session.styleMode,
          textPrimaryColor: state.session.textPrimaryColor ?? null,
          detailSellingPointNote: !category || category === 'detail' ? state.session.detailSellingPointNote : undefined,
          detailStyleNote: !category || category === 'detail' ? state.session.detailStyleNote : undefined,
          sellingPointBlocks: !category || category === 'detail' ? state.session.detailSellingPointBlocks : undefined,
          heroGenerateCount,
        })
        const scopedExisting = state.session.cards.filter((card) => !category || card.category === category)
        const scopedReconciled = reconcilePreviewCards(scopedExisting, built.cards)
        // Leave unrelated cards byte-for-byte intact; never re-plan or drop them.
        const reconciled = category ? [...state.session.cards.filter((card) => card.category !== category), ...scopedReconciled] : scopedReconciled
        const compatibility = assessHeroMappingCompatibility(reconciled, state.session.refs, heroGenerateCount)
        const preservedCount = state.session.cards.filter((card) => reconciled.some((item) => item.id === card.id && (card.resultImageId || card.lastStructuredEditAt || card.lastPromptEditAt))).length
        const planningError = !scopedReconciled.length
          ? '请先导入参考图。选项图需按选购套餐绑定后才会进入预览，缺失项不会自动造图。'
          : built.missingDetailSellingPoints
            ? '已导入详情参考图，但还没有可生成的卖点。请先点「分析详情页」，或在“详情卖点要求”中填写卖点词后再生成本地预览。不必三类都分析。不会按竞品张数硬凑卡片。'
            : null
        const heroMappingNote = !category || category === 'hero' ? compatibility.note : state.session.heroMappingNote
        set({
          session: touch(state.session, {
            cards: reconciled,
            generationConfirmed: false,
            categoryConfirmations: category ? invalidateCategory(state.session, category) : undefined,
            planningError,
            heroMappingNote,
          }),
        })
        return { count: scopedReconciled.length, skippedMissingOptions: built.skippedMissingOptions, heroMappingNote, preservedCount }
      },
      confirmGeneration: (generationConfirmed, category) => set((s) => ({
        session: touch(s.session, {
          generationConfirmed,
          categoryConfirmations: category ? { ...Object.fromEntries(['hero', 'detail', 'option'].map((item) => [item, categoryConfirmed(s.session, item as CompetitorCategory)])), [category]: generationConfirmed } : undefined,
          confirmedAt: generationConfirmed ? Date.now() : undefined,
        }),
      })),
      setCaptureStatus: (captureStatus, parseMessage, captureCoverage) => set((s) => ({
        session: touch(s.session, {
          captureStatus,
          parseMessage,
          captureCoverage: captureCoverage === undefined ? s.session.captureCoverage : captureCoverage,
        }),
      })),
      commitCapturePlan: (plan, importedRefs) => set((s) => {
        const keyToRefId = new Map<string, string>()
        for (const ref of [...s.session.refs, ...importedRefs]) {
          const key = ref.asset.name.startsWith('capture:') ? ref.asset.name.slice('capture:'.length) : ref.id
          keyToRefId.set(key, ref.id)
          keyToRefId.set(ref.id, ref.id)
        }
        for (const item of plan.refsToAdd) {
          if (item.sourceKey) keyToRefId.set(item.sourceKey, keyToRefId.get(item.sourceKey) || importedRefs.find((ref) => ref.asset.name === `capture:${item.sourceKey}`)?.id || '')
        }
        const optionSlots = remapOptionBindings(plan.optionSlots, keyToRefId)
        return {
          session: touch(s.session, {
            refs: [...s.session.refs, ...importedRefs],
            optionSlots,
            cards: [],
            generationConfirmed: false,
            captureStatus: plan.captureStatus,
            parseMessage: [plan.message, ...plan.conflicts].filter(Boolean).join(' '),
            captureCoverage: plan.coverage,
          }),
        }
      }),
    }),
    {
      name: 'pdd-competitor-advisor-session',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        planningModel: state.planningModel,
        imageModel: state.imageModel,
        session: {
          ...state.session,
          productAssets: state.session.productAssets.map(({ dataUrl: _d, thumbnailDataUrl: _t, ...rest }) => rest),
          refs: state.session.refs.map((ref) => ({
            ...ref,
            asset: { ...ref.asset, dataUrl: undefined, thumbnailDataUrl: undefined },
          })),
        },
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        useCompetitorStore.setState({ analysisInFlight: null, generationInFlight: null })
        state.setQueue({ phase: 'idle', paused: false, stopped: false, activeCardId: null })
        const session = state.session
        const optionSlots: OptionSlotDraft[] = (session.optionSlots || []).map((slot) => ({
          ...slot,
          missing: !slot.boundRefId,
        }))
        useCompetitorStore.setState({ session: { ...session, optionSlots, styleMode: session.styleMode || 'strict', captureCoverage: session.captureCoverage || null } })
        const { productAssets, refs } = useCompetitorStore.getState().session
        if (productAssets.length) {
          void hydrateAssets(productAssets).then((hydrated) => {
            useCompetitorStore.getState().setProductAssets(hydrated)
          }).catch(() => { /* keep metadata */ })
        }
        if (refs.length) {
          void hydrateAssets(refs.map((ref) => ref.asset)).then((hydrated) => {
            const byId = new Map(hydrated.map((asset) => [asset.imageId || asset.id, asset]))
            const next = useCompetitorStore.getState()
            useCompetitorStore.setState({
              session: {
                ...next.session,
                refs: next.session.refs.map((ref) => ({
                  ...ref,
                  asset: byId.get(ref.asset.imageId || ref.asset.id) || ref.asset,
                })),
              },
            })
          }).catch(() => { /* keep metadata */ })
        }
      },
    },
  ),
)

export function makeRefImage(input: {
  category: CompetitorCategory
  asset: ProductAsset
  optionName?: string
  contentsNote?: string
  source?: CompetitorRefImage['source']
}): CompetitorRefImage {
  return {
    id: newId(),
    category: input.category,
    asset: input.asset,
    optionName: input.optionName || '',
    contentsNote: input.contentsNote || '',
    sellingPoint: '',
    sceneHint: '',
    layoutSummary: '',
    analysisStatus: 'pending',
    source: input.source || 'manual_import',
  }
}

// Metadata hydrates synchronously from localStorage; blob hydration is not required for ownership.
registerImageReferenceSource('pdd-competitor', () => structuredWorkbenchImageIds(useCompetitorStore.getState().session))
