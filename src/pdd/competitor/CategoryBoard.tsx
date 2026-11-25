import { useEffect, useMemo, useState } from 'react'
import { CATEGORY_HINTS, CATEGORY_LABELS, COMPETITOR_CATEGORIES, type CompetitorCategory } from './categories'
import CategoryFramePicker from './CategoryFramePicker'
import { useDetailStripPreview } from './detailStripPreview'
import { cropBlockFromLayout } from './detailSellingPointBlocks'
import type { DetailStripLayout } from './detailStrip'
import { generateCompetitorCard } from './generation'
import { useCompetitorStore } from './store'
import type { CompetitorCard, CompetitorRefImage, CoverageRow } from './types'

interface CategoryBoardProps {
  coverage: CoverageRow[]
  generatingLock: boolean
  onSupplement: (category: CompetitorCategory, files: FileList | File[]) => void
  onGenerateError: (message: string) => void
}

export default function CategoryBoard({ coverage, generatingLock, onSupplement, onGenerateError }: CategoryBoardProps) {
  const refs = useCompetitorStore((s) => s.session.refs)
  const cards = useCompetitorStore((s) => s.session.cards)
  const optionSlots = useCompetitorStore((s) => s.session.optionSlots)
  const [category, setCategory] = useState<CompetitorCategory>('hero')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const inCategory = useMemo(() => refs.filter((ref) => ref.category === category), [refs, category])
  const detailRefs = useMemo(() => refs.filter((ref) => ref.category === 'detail'), [refs])
  const detailStrip = useDetailStripPreview(detailRefs)
  useEffect(() => {
    if (!inCategory.some((ref) => ref.id === selectedId)) {
      setSelectedId(inCategory[0]?.id ?? null)
    }
  }, [inCategory, selectedId])

  const selected = inCategory.find((ref) => ref.id === selectedId) ?? inCategory[0] ?? null
  const matchedCards = selected ? cards.filter((item) => item.refImageId === selected.id) : []
  const card = matchedCards[0]
  const row = coverage.find((item) => item.category === category)
  const previewUrl = selected?.asset.dataUrl || selected?.asset.thumbnailDataUrl
  const missingOptions = optionSlots.filter((slot) => slot.optionName.trim() && (!slot.boundRefId || slot.missing))

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900" data-testid="competitor-category-board">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
          {COMPETITOR_CATEGORIES.map((item) => {
            const count = refs.filter((ref) => ref.category === item).length
            const missing = coverage.find((rowItem) => rowItem.category === item)?.missing ?? 0
            const active = category === item
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`competitor-category-tab-${item}`}
                onClick={() => setCategory(item)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-50' : 'text-gray-600 dark:text-gray-300'}`}
              >
                {CATEGORY_LABELS[item]}
                <span className="ml-1 workbench-help">{count}</span>
                {missing > 0 ? <span className="ml-1 text-xs text-orange-600">缺{missing}</span> : null}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          data-testid={`competitor-upload-${category}`}
          onClick={() => document.getElementById(`competitor-supplement-${category}`)?.click()}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700"
        >
          上传{CATEGORY_LABELS[category]}
        </button>
        <input
          id={`competitor-supplement-${category}`}
          data-testid={`competitor-category-${category}`}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) void onSupplement(category, e.target.files); e.target.value = '' }}
        />
      </div>
      <p className="mt-3 workbench-help text-sm">{CATEGORY_HINTS[category]} {row?.note || ''}</p>

      {category === 'option' ? (
        <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
          {optionSlots.length
            ? `已记录 ${optionSlots.length} 个选购套餐，已绑图 ${optionSlots.length - missingOptions.length} 个，缺失 ${missingOptions.length} 个。缺失不会用主图顶替。`
            : '还没有选购套餐。可在下方添加套餐名称，并绑定对应的选项图。'}
          {missingOptions.length ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-orange-700 dark:text-orange-300">
              {missingOptions.map((slot) => <li key={slot.id}>{slot.optionName || '未命名套餐'}：缺失选项图</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-[7.5rem_minmax(0,1fr)]">
        <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-y-auto md:max-h-[28rem]">
          {inCategory.map((ref, index) => {
            const active = selected?.id === ref.id
            const refUrl = ref.asset.thumbnailDataUrl || ref.asset.dataUrl
            return (
              <button
                key={ref.id}
                type="button"
                data-testid={`competitor-ref-thumb-${ref.id}`}
                onClick={() => setSelectedId(ref.id)}
                className={`h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${active ? 'border-orange-500' : 'border-transparent bg-gray-100 dark:bg-gray-800'}`}
              >
                {refUrl
                  ? <img src={refUrl} alt={`${CATEGORY_LABELS[category]}参考图 ${index + 1}`} data-preview-source="reference" data-image-id={ref.asset.imageId || ref.id} className="h-full w-full object-cover" />
                  : <span className="flex h-full items-center justify-center text-[10px] text-gray-400">{index + 1}</span>}
              </button>
            )
          })}
          {inCategory.length === 0 ? (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-gray-300 text-[10px] text-gray-400">暂无</div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-800">
            {category === 'detail' ? (
              <DetailReferencePreview
                previewUrl={previewUrl}
                selected={selected}
                strip={detailStrip}
              />
            ) : previewUrl ? (
              <>
                <img
                  src={previewUrl}
                  alt={selected ? `${CATEGORY_LABELS[category]}参考图` : ''}
                  data-testid="competitor-category-preview"
                  data-preview-source="reference"
                  data-image-id={selected?.asset.imageId || selected?.id}
                  className="max-h-[28rem] w-full object-contain"
                />
                <p className="px-3 py-1.5 workbench-help" data-testid="competitor-preview-caption">
                  当前显示的是竞品参考图，生成结果在下方分框中查看。
                </p>
              </>
            ) : (
              <div className="flex h-64 items-center justify-center workbench-help text-sm">请上传该类参考图，这里会显示大图。</div>
            )}
          </div>
          {selected ? (
            <div className="space-y-2">
              <p className="workbench-help">
                {selected.analysisStatus === 'model_suggested' ? '卖点来自模型建议，请核对' : selected.analysisStatus === 'user_filled' ? '卖点已手工填写' : '尚未分析或填写卖点'}
              </p>
              <label className="block workbench-help">卖点
                <input className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-950" value={selected.sellingPoint} onChange={(e) => useCompetitorStore.getState().patchRef(selected.id, { sellingPoint: e.target.value, analysisStatus: 'user_filled' })} />
              </label>
              {category === 'option' ? (
                <>
                  <label className="block workbench-help">对应套餐/规格
                    <input className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-950" value={selected.optionName} onChange={(e) => useCompetitorStore.getState().patchRef(selected.id, { optionName: e.target.value })} />
                  </label>
                  <label className="block workbench-help">配件与数量
                    <input className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-950" value={selected.contentsNote} onChange={(e) => useCompetitorStore.getState().patchRef(selected.id, { contentsNote: e.target.value })} />
                  </label>
                </>
              ) : null}
              {card ? (
                <>
                  <CategoryFramePicker category={category} value={card.frameSpec} onChange={(frameSpec) => useCompetitorStore.getState().patchCard(card.id, { frameSpec, aspectRatio: frameSpec.preset || card.aspectRatio })} />
                  <label className="block workbench-help">生成提示词
                    <textarea className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-950" rows={4} value={card.imagePrompt} onChange={(e) => useCompetitorStore.getState().patchCard(card.id, { imagePrompt: e.target.value })} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={generatingLock}
                      onClick={() => void generateCompetitorCard(card.id).catch((err) => onGenerateError(err instanceof Error ? err.message : '生成失败'))}
                      className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      重绘这张
                    </button>
                    <button type="button" className="text-sm text-red-600 dark:text-red-400" onClick={() => useCompetitorStore.getState().removeRef(selected.id)}>移除参考图</button>
                  </div>
                </>
              ) : (
                <button type="button" className="text-sm text-red-600 dark:text-red-400" onClick={() => useCompetitorStore.getState().removeRef(selected.id)}>移除参考图</button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}


function DetailReferencePreview({
  strip,
}: {
  previewUrl?: string
  selected: CompetitorRefImage | null
  strip: ReturnType<typeof useDetailStripPreview>
}) {
  const blocks = useCompetitorStore((s) => s.session.detailSellingPointBlocks)
  const hasDetailRefs = useCompetitorStore((s) => s.session.refs.some((ref) => ref.category === 'detail'))
  if (!hasDetailRefs || strip.status === 'empty') {
    return <div className="flex h-64 items-center justify-center workbench-help text-sm" data-testid="competitor-detail-strip-empty">暂无参考详情图</div>
  }
  if (!blocks?.length) {
    return (
      <div className="flex h-64 items-center justify-center px-4 text-center workbench-help text-sm" data-testid="competitor-detail-blocks-pending">
        请先点「分析详情页」，再按每个卖点查看参考块并对标生成。分析前不提供详情长图预览。左侧仍可管理原分图。不必把主图和选项图一起分析。
      </div>
    )
  }
  return <SellingPointBlockGallery layout={strip.preview?.layout} />
}

function boundSourceLabel(source: string, uncertain: boolean): string {
  if (source === 'semantic_analysis' && !uncertain) return '语义边界来自本次分析，可能略有偏差'
  if (source === 'unconfirmed' || uncertain) return '语义边界不确定，不能当作精确切开'
  return '未返回精确纵坐标，暂用整张原分图，不是按卖点准确切开'
}

function SellingPointBlockGallery({ layout }: { layout?: DetailStripLayout | null }) {
  const blocks = useCompetitorStore((s) => s.session.detailSellingPointBlocks)
  if (!blocks?.length) return null
  return (
    <div className="space-y-2 px-3 py-3" data-testid="competitor-detail-selling-point-blocks">
      <p className="workbench-help">已按卖点拆成参考块，便于对标。这来自你触发的那一次分析，不是额外付费请求；空白分隔只用于分析前安全分包，不能单独当成已经识别出卖点。</p>
      {blocks.map((block, index) => {
        const crop = layout ? cropBlockFromLayout(layout, block) : null
        return (
          <figure key={block.id} className="space-y-1" data-testid={`competitor-detail-selling-point-block-${index + 1}`}>
            {crop && crop.height > 0 ? (
              <BlockCropImage crop={crop} alt={block.sellingPointText} />
            ) : null}
            <figcaption className="workbench-help">
              卖点 {index + 1}：{block.sellingPointText} · 纵坐标 {block.globalYStart}–{block.globalYEnd} · 原分图 {block.sourceRefIds.join('、') || '未知'} · {boundSourceLabel(block.boundSource, block.uncertainBounds)}{block.note ? `。${block.note}` : ''}
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}

function BlockCropImage({ crop, alt }: { crop: { width: number; height: number; pixels: Uint8ClampedArray }; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoked: string | null = null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = crop.width
      canvas.height = crop.height
      const context = canvas.getContext('2d')
      if (!context) return
      context.putImageData(new ImageData(new Uint8ClampedArray(crop.pixels), crop.width, crop.height), 0, 0)
      const objectUrl = canvas.toDataURL('image/png')
      setUrl(objectUrl)
      revoked = null
    } catch {
      setUrl(null)
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [crop])
  if (!url) return null
  return <img src={url} alt={alt} className="block h-auto w-full" data-testid="competitor-detail-selling-point-block-image" />
}

export type { CompetitorRefImage }
