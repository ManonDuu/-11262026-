import { useEffect, useMemo, useState } from 'react'
import { downloadCustomSizePng, downloadOriginalPng } from '../exportSet'
import { customPixelTarget } from '../frameSpec'
import { formatPixelSize } from '../imageParams'
import { CATEGORY_LABELS, COMPETITOR_CATEGORIES, type CompetitorCategory } from './categories'
import { generateCompetitorCard } from './generation'
import { useCompetitorStore } from './store'
import type { CompetitorCard } from './types'

export function visibleResultsInCategory(cards: CompetitorCard[], category: CompetitorCategory): CompetitorCard[] {
  return cards.filter((card) => (
    card.category === category
    && Boolean(card.resultImageId || card.status === 'generating' || card.status === 'queued' || card.status === 'error')
  ))
}

export function cardsWithVisibleResults(cards: CompetitorCard[]): CompetitorCard[] {
  return COMPETITOR_CATEGORIES.flatMap((category) => visibleResultsInCategory(cards, category))
}

export interface ResultFieldDraft {
  title: string
  sellingPoint: string
  sceneSummary: string
  layoutSummary: string
}

export function draftFromCompetitorResult(card: Pick<CompetitorCard, 'title' | 'sellingPoint' | 'sceneSummary' | 'layoutSummary'>): ResultFieldDraft {
  return {
    title: card.title ?? '',
    sellingPoint: card.sellingPoint ?? '',
    sceneSummary: card.sceneSummary ?? '',
    layoutSummary: card.layoutSummary ?? '',
  }
}

/** 只提交实际改动的字段，避免仅改标题/文字时误标风格来源，或仅改场景/排版时误标卖点被用户改过。 */
export function resultFieldPatchFromDraft(card: CompetitorCard, draft: ResultFieldDraft): Partial<CompetitorCard> {
  const current = draftFromCompetitorResult(card)
  const patch: Partial<CompetitorCard> = {}
  if (draft.title !== current.title) patch.title = draft.title
  if (draft.sellingPoint !== current.sellingPoint) patch.sellingPoint = draft.sellingPoint
  if (draft.sceneSummary !== current.sceneSummary) patch.sceneSummary = draft.sceneSummary
  if (draft.layoutSummary !== current.layoutSummary) patch.layoutSummary = draft.layoutSummary
  return patch
}

export function resultFieldDraftChanged(card: CompetitorCard, draft: ResultFieldDraft): boolean {
  return Object.keys(resultFieldPatchFromDraft(card, draft)).length > 0
}

function resultStatusText(card: CompetitorCard, url?: string): string {
  if (card.status === 'done' && url) {
    const size = formatPixelSize(card.resultWidth, card.resultHeight)
    return size ? `已生成 · ${size}` : '已生成'
  }
  if (card.status === 'error') return card.error || '生成失败'
  if (card.status === 'generating' || card.status === 'queued') return '正在生成…'
  return '正在载入生成结果…'
}

interface GeneratedResultsProps {
  cards: CompetitorCard[]
  resultUrls: Record<string, string>
  generatingLock?: boolean
  onOpen: (cardId: string) => void
  onGenerateError?: (message: string) => void
}

function ResultFieldEditor({ cardId }: { cardId: string }) {
  const card = useCompetitorStore((state) => state.session.cards.find((item) => item.id === cardId))
  const patchCard = useCompetitorStore((state) => state.patchCard)
  const [drafts, setDrafts] = useState<Record<string, ResultFieldDraft>>({})
  const [savedId, setSavedId] = useState<string | null>(null)

  useEffect(() => {
    setSavedId(null)
  }, [cardId])

  if (!card) return null
  const draft = drafts[card.id] ?? draftFromCompetitorResult(card)
  const dirty = resultFieldDraftChanged(card, draft)

  const updateDraft = (patch: Partial<ResultFieldDraft>) => {
    setSavedId(null)
    setDrafts((current) => ({
      ...current,
      [card.id]: { ...(current[card.id] ?? draftFromCompetitorResult(card)), ...patch },
    }))
  }

  const onSave = () => {
    const nextDraft = drafts[card.id] ?? draftFromCompetitorResult(card)
    const patch = resultFieldPatchFromDraft(card, nextDraft)
    if (!Object.keys(patch).length) return
    patchCard(card.id, patch)
    const latest = useCompetitorStore.getState().session.cards.find((item) => item.id === card.id)
    setDrafts((current) => ({
      ...current,
      [card.id]: draftFromCompetitorResult(latest ?? { ...card, ...patch }),
    }))
    setSavedId(card.id)
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700" data-testid={`competitor-result-edit-${card.id}`}>
      <div>
        <h4 className="text-sm font-medium">编辑这张成品文案</h4>
        <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300" data-testid={`competitor-result-edit-hint-${card.id}`}>
          可改本张的标题/图片文字、场景摘要和排版摘要。点「保存编辑」只保存这张卡的文案并同步到重绘提示，不会改已生成图片的像素，也不会自动生图。图上的文字或构图要按新文案生效，请再点「重绘这张」（可能产生费用）。只改场景或排版时，不会改卖点词，也不会改产品和赠品的外形、尺寸。
        </p>
      </div>
      <label className="block workbench-help">标题 / 图片文字
        <input
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
          data-testid={`competitor-result-edit-title-${card.id}`}
          value={draft.title}
          onChange={(event) => updateDraft({ title: event.target.value })}
        />
      </label>
      <label className="block workbench-help">图片文字 / 卖点词
        <textarea
          rows={2}
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
          data-testid={`competitor-result-edit-text-${card.id}`}
          value={draft.sellingPoint}
          onChange={(event) => updateDraft({ sellingPoint: event.target.value })}
        />
      </label>
      <label className="block workbench-help">场景摘要
        <textarea
          rows={2}
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
          data-testid={`competitor-result-edit-scene-${card.id}`}
          value={draft.sceneSummary}
          onChange={(event) => updateDraft({ sceneSummary: event.target.value })}
        />
      </label>
      <label className="block workbench-help">排版摘要
        <textarea
          rows={2}
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
          data-testid={`competitor-result-edit-layout-${card.id}`}
          value={draft.layoutSummary}
          onChange={(event) => updateDraft({ layoutSummary: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid={`competitor-result-edit-save-${card.id}`}
          disabled={!dirty}
          onClick={onSave}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
        >
          保存编辑
        </button>
        {savedId === card.id ? (
          <p className="workbench-help" data-testid={`competitor-result-edit-saved-${card.id}`}>已保存本张文案，图片尚未改动。</p>
        ) : null}
      </div>
    </div>
  )
}

function ResultCategoryBox({
  category,
  cards,
  resultUrls,
  generatingLock,
  onOpen,
  onGenerateError,
}: {
  category: CompetitorCategory
  cards: CompetitorCard[]
  resultUrls: Record<string, string>
  generatingLock?: boolean
  onOpen: (cardId: string) => void
  onGenerateError?: (message: string) => void
}) {
  const items = useMemo(() => visibleResultsInCategory(cards, category), [cards, category])
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null)
  const [redrawingIds, setRedrawingIds] = useState<Record<string, true>>({})

  useEffect(() => {
    if (!items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null)
    }
  }, [items, selectedId])

  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null
  const previewUrl = selected?.resultImageId ? resultUrls[selected.resultImageId] : undefined
  const target = selected ? customPixelTarget(selected.frameSpec) : null
  const redrawLocked = Boolean(
    generatingLock
    || selected?.status === 'generating'
    || selected?.status === 'queued'
    || (selected && redrawingIds[selected.id]),
  )

  return (
    <section
      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900"
      data-testid={`competitor-result-board-${category}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{CATEGORY_LABELS[category]}</h3>
        <span className="workbench-help">{items.filter((item) => item.resultImageId).length} 张成品</span>
      </div>

      {items.length === 0 ? (
        <div data-testid={`competitor-result-empty-${category}`} className="mt-3 flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-200 workbench-help text-sm dark:border-gray-700">
          暂无生成成品
        </div>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-[7.5rem_minmax(0,1fr)]">
          <div className="flex gap-2 overflow-x-auto md:flex-col md:max-h-[28rem] md:overflow-y-auto">
            {items.map((card) => {
              const url = card.resultImageId ? resultUrls[card.resultImageId] : undefined
              const active = selected?.id === card.id
              return (
                <button
                  key={card.id}
                  type="button"
                  data-testid={`competitor-result-card-${card.id}`}
                  onClick={() => setSelectedId(card.id)}
                  className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${active ? 'border-orange-500' : 'border-transparent bg-gray-100 dark:bg-gray-800'}`}
                >
                  {url ? (
                    <img
                      src={url}
                      alt={`${CATEGORY_LABELS[category]}生成结果 ${card.index}`}
                      data-testid={`competitor-result-image-${card.id}`}
                      data-preview-source="result"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span data-testid={`competitor-result-pending-${card.id}`} className="flex h-full items-center justify-center px-1 text-center text-[10px] text-gray-600 dark:text-gray-300">
                      {resultStatusText(card)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="min-w-0 space-y-3">
            <div className="overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-800">
              {previewUrl ? (
                <>
                  <img
                    src={previewUrl}
                    alt={`${CATEGORY_LABELS[category]}生成结果 ${selected?.index ?? ''}`}
                    data-testid={`competitor-result-preview-${category}`}
                    data-preview-source="result"
                    data-card-id={selected?.id}
                    className="max-h-[28rem] w-full object-contain"
                  />
                  <p className="px-3 py-1.5 workbench-help">
                    {CATEGORY_LABELS[category]} {selected?.index}
                    {formatPixelSize(selected?.resultWidth, selected?.resultHeight) ? ` · ${formatPixelSize(selected?.resultWidth, selected?.resultHeight)}` : ''}
                    {selected?.optionName ? ` · ${selected.optionName}` : ''}
                    {selected?.category === 'detail' && selected.sellingPoint ? ` · ${selected.sellingPoint}` : ''}
                  </p>
                </>
              ) : (
                <div data-testid={`competitor-result-preview-empty-${category}`} className="flex h-40 items-center justify-center px-3 text-center workbench-help text-sm">
                  {selected ? resultStatusText(selected) : '暂无生成成品'}
                </div>
              )}
            </div>

            {selected ? <ResultFieldEditor cardId={selected.id} /> : null}

            {selected ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid={`competitor-result-open-${selected.id}`}
                  onClick={() => onOpen(selected.id)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700"
                >
                  预览
                </button>
                {selected.resultImageId ? (
                  <button
                    type="button"
                    data-testid={`competitor-result-download-${selected.id}`}
                    onClick={() => void downloadOriginalPng(selected.resultImageId!, `${CATEGORY_LABELS[category]}-${selected.index}`).catch((err) => onGenerateError?.(err instanceof Error ? err.message : '下载失败'))}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700"
                  >
                    下载原图
                  </button>
                ) : null}
                {selected.resultImageId && target ? (
                  <button
                    type="button"
                    data-testid={`competitor-result-export-${selected.id}`}
                    onClick={() => void downloadCustomSizePng(selected.resultImageId!, target.width, target.height, `${CATEGORY_LABELS[category]}-${selected.index}-${target.width}x${target.height}`).catch((err) => onGenerateError?.(err instanceof Error ? err.message : '导出失败'))}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700"
                  >
                    按自定义尺寸导出
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid={`competitor-result-redraw-${selected.id}`}
                  disabled={redrawLocked}
                  onClick={() => {
                    if (redrawLocked || redrawingIds[selected.id]) return
                    setRedrawingIds((current) => ({ ...current, [selected.id]: true }))
                    void generateCompetitorCard(selected.id)
                      .catch((err) => onGenerateError?.(err instanceof Error ? err.message : '生成失败'))
                      .finally(() => {
                        setRedrawingIds((current) => {
                          const next = { ...current }
                          delete next[selected.id]
                          return next
                        })
                      })
                  }}
                  className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  重绘这张
                </button>
                {selected.error ? <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" data-testid={`competitor-result-error-${selected.id}`}>{selected.error}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

export default function GeneratedResults({ cards, resultUrls, generatingLock, onOpen, onGenerateError }: GeneratedResultsProps) {
  return (
    <div className="mt-4 space-y-4" data-testid="competitor-result-gallery">
      {COMPETITOR_CATEGORIES.map((category) => (
        <ResultCategoryBox
          key={category}
          category={category}
          cards={cards}
          resultUrls={resultUrls}
          generatingLock={generatingLock}
          onOpen={onOpen}
          onGenerateError={onGenerateError}
        />
      ))}
    </div>
  )
}
