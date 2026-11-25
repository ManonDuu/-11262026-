import { categoryConfirmed } from './categoryScope'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { detectConnection } from '../api'
import { importProductFiles, loadImageDataUrl } from '../assets'
import { formatPixelSize } from '../imageParams'
import TextPrimaryColorPicker from '../TextPrimaryColorPicker'
import { ANALYSIS_CATEGORY_LABELS, CATEGORY_LABELS, COMPETITOR_CATEGORIES, STYLE_MODE_HINTS, STYLE_MODE_LABELS, type CompetitorCategory } from './categories'
import CategoryBoard from './CategoryBoard'
import GeneratedResults from './GeneratedResults'
import { getSharedApiConnectionStatus, setSharedDetectedModels, setSharedWorkbenchModels } from '../sharedModels'
import { usePddStore } from '../store'
import { buildCoverageRows, describeCoverage } from './coverage'
import { analysisCategoryLabel, requestCompetitorAnalysis } from './analyze'
import { assessSessionDetailPlan, oldPlanCoverageHint } from './detailPlan'
import { downloadCategoryZip, downloadGroupedZip } from './exportGroups'
import { pauseCompetitorQueue, resumeCompetitorQueue, runCompetitorQueue, stopCompetitorQueue } from './generation'
import { prepareCategoryGeneration } from './categoryGenerate'
import { defaultHeroGenerateCount, parseHeroGenerateCount } from './heroGenerateCount'
import { makeRefImage, useCompetitorStore } from './store'

export default function CompetitorWorkbench() {
  const session = useCompetitorStore((s) => s.session)
  const imageModel = usePddStore((s) => s.imageModel)
  const planningModel = usePddStore((s) => s.planningModel)
  const detected = usePddStore((s) => s.detected)
  const settings = useStore((s) => s.settings)
  const connection = getSharedApiConnectionStatus(settings)
  const queuePhase = useCompetitorStore((s) => s.queuePhase)
  const queuePaused = useCompetitorStore((s) => s.queuePaused)
  const lightbox = useCompetitorStore((s) => s.lightbox)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showToast = useStore((s) => s.showToast)

  const [optionNameDraft, setOptionNameDraft] = useState('')
  const [optionContentsDraft, setOptionContentsDraft] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [resultUrls, setResultUrls] = useState<Record<string, string>>({})
  const [zipping, setZipping] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [previewCategory, setPreviewCategory] = useState<CompetitorCategory>(() => session.refs[0]?.category || 'hero')
  const analysisInFlight = useCompetitorStore((s) => s.analysisInFlight)
  const generationInFlight = useCompetitorStore((s) => s.generationInFlight)
  const [analyzingCategory, setAnalyzingCategory] = useState<CompetitorCategory | null>(null)
  const [heroCountDraft, setHeroCountDraft] = useState(() => String(defaultHeroGenerateCount(session)))
  const [heroCountError, setHeroCountError] = useState<string | null>(null)
  const productInputRef = useRef<HTMLInputElement>(null)
  const generatingLock = queuePhase === 'running' || queuePhase === 'planning' || queuePhase === 'paused' || Boolean(generationInFlight)
  const actionBusy = Boolean(analysisInFlight) || analyzing || generatingLock

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const next: Record<string, string> = {}
      for (const card of session.cards) {
        const ids = [card.resultImageId, ...(card.detailCropSlices || []).map((slice) => slice.imageId)].filter(Boolean) as string[]
        for (const id of ids) {
          if (next[id]) continue
          const url = await loadImageDataUrl(id)
          if (url) next[id] = url
        }
      }
      if (!cancelled) setResultUrls(next)
    }
    void load()
    return () => { cancelled = true }
  }, [session.cards])

  const coverage = useMemo(
    () => buildCoverageRows(session.refs, session.optionSlots, !!session.captureCoverage?.attempted, session.captureCoverage),
    [session.refs, session.optionSlots, session.captureCoverage],
  )



  const onDetect = useCallback(async () => {
    setDetecting(true)
    try {
      const result = await detectConnection()
      setSharedDetectedModels({
        checkedAt: result.checkedAt,
        allIds: result.allIds,
        planningIds: result.planningIds,
        imageIds: result.imageIds,
        recommendedPlanning: result.recommendedPlanning,
        recommendedImage: result.recommendedImage,
        error: result.error ?? null,
      })
      if (result.ok) {
        const nextPlanning = planningModel && result.planningIds.includes(planningModel) ? planningModel : result.recommendedPlanning || ''
        const nextImage = imageModel && result.imageIds.includes(imageModel) ? imageModel : result.recommendedImage || ''
        setSharedWorkbenchModels(nextPlanning, nextImage)
        showToast(`已使用本机反代 ${result.baseUrlHost}，识别到 ${result.allIds.length} 个模型`, 'success')
      } else {
        showToast(result.error || '检测连接失败', 'error')
      }
    } finally {
      setDetecting(false)
    }
  }, [imageModel, planningModel, showToast])

  const importTo = async (category: CompetitorCategory, fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    if (!files.length) return
    try {
      const imported = await importProductFiles(files)
      if (!imported.length) {
        showToast('没有识别到图片文件', 'error')
        return
      }
      const refs = imported.map((asset) => makeRefImage({ category, asset }))
      useCompetitorStore.getState().addRefs(refs)
      showToast(`已上传 ${imported.length} 张${CATEGORY_LABELS[category]}。`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '上传失败', 'error')
    }
  }

  const importProduct = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    if (!files.length) return
    try {
      const imported = await importProductFiles(files)
      if (!imported.length) {
        showToast('没有识别到图片文件', 'error')
        return
      }
      useCompetitorStore.getState().setProductAssets([...session.productAssets, ...imported])
    } catch (err) {
      showToast(err instanceof Error ? err.message : '上传失败', 'error')
    }
  }

  const onBuildPreview = () => {
    if (actionBusy) return
    if (!useCompetitorStore.getState().session.refs.some((ref) => ref.category === previewCategory)) { showToast(`请先上传${analysisCategoryLabel(previewCategory)}`, 'error'); return }
    const parsed = parseHeroGenerateCount(heroCountDraft)
    if (previewCategory === 'hero' && !parsed.ok) { setHeroCountError(parsed.error); return }
    if (previewCategory === 'hero' && parsed.ok) {
      useCompetitorStore.getState().setHeroGenerateCount(parsed.value)
      setHeroCountError(null)
    }
    const result = useCompetitorStore.getState().buildPreview(previewCategory)
    if (!result.count) {
      showToast(useCompetitorStore.getState().session.planningError || '请先上传参考图', 'error')
      return
    }
    const missing = result.skippedMissingOptions ? `，另有 ${result.skippedMissingOptions} 个未绑图的选项未进入预览` : ''
    const preserved = result.preservedCount ? `已保留 ${result.preservedCount} 张已有成品或手改文案，不会覆盖。` : ''
    const mapping = result.heroMappingNote ? result.heroMappingNote : ''
    showToast(`已用当前已填内容生成${analysisCategoryLabel(previewCategory)}本地预览 ${result.count} 张${missing}。这不是模型策划，不会扣生图费。${preserved}${mapping}`, 'success')
  }

  const onAnalyze = async (category: CompetitorCategory) => {
    if (analyzing || useCompetitorStore.getState().analysisInFlight || ['running','planning','paused'].includes(useCompetitorStore.getState().queuePhase) || useCompetitorStore.getState().generationInFlight) return
    const state = useCompetitorStore.getState()
    const label = analysisCategoryLabel(category)
    const hasRefs = state.session.refs.some((ref) => ref.category === category)
    if (!hasRefs) {
      showToast(`请先上传${label}再分析`, 'error')
      return
    }
    if (!planningModel) {
      showToast('请先选择与套图共用的规划模型。分析会发出请求，但不会自动生图。', 'error')
      return
    }
    setPreviewCategory(category)
    useCompetitorStore.setState({ analysisInFlight: category })
    const startedAt = Date.now()
    setAnalyzing(true)
    setAnalyzingCategory(category)
    try {
      const result = await requestCompetitorAnalysis({
        planningModel,
        productName: state.session.productName,
        productFactsNote: state.session.productFactsNote,
        detailSellingPointNote: state.session.detailSellingPointNote,
        detailStyleNote: state.session.detailStyleNote,
        refs: state.session.refs,
        optionSlots: state.session.optionSlots,
        category,
      })
      if (!result.ok || !result.results) {
        const message = result.error || `分析${label}失败，未写入任何卖点`
        useCompetitorStore.getState().setAnalysisError({
          at: Date.now(),
          category,
          message,
          durationMs: Date.now() - startedAt,
        })
        showToast(message, 'error')
        return
      }
      useCompetitorStore.getState().applyAnalysisSuggestions(result.results, {
        sellingPointBlocks: result.sellingPointBlocks,
        category,
      })
      showToast(`已写入${label}的分析建议，其他类别的分析、手改和成品都保留。请核对后如需再生成本地预览。分析不等于已经生图。不必三类都分析完才能预览。`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : `分析${label}失败`
      useCompetitorStore.getState().setAnalysisError({
        at: Date.now(),
        category,
        message,
        durationMs: Date.now() - startedAt,
      })
      showToast(message, 'error')
    } finally {
      useCompetitorStore.setState({ analysisInFlight: null })
      setAnalyzing(false)
      setAnalyzingCategory(null)
    }
  }

  const onGenerateCategory = async (category: CompetitorCategory) => {
    if (actionBusy || useCompetitorStore.getState().analysisInFlight) return
    const state = useCompetitorStore.getState()
    if (!categoryConfirmed(state.session, category)) {
      showToast('请先勾选预览确认，再开始生图', 'error')
      return
    }
    if (!imageModel) {
      showToast('请先选择与套图共用的生图模型', 'error')
      return
    }
    let heroCount: number | undefined
    if (category === 'hero') {
      const parsed = parseHeroGenerateCount(heroCountDraft)
      if (!parsed.ok) {
        setHeroCountError(parsed.error)
        showToast(parsed.error, 'error')
        return
      }
      setHeroCountError(null)
      useCompetitorStore.getState().setHeroGenerateCount(parsed.value)
      heroCount = parsed.value
    }
    const prepared = prepareCategoryGeneration(useCompetitorStore.getState().session, category, heroCount)
    if (!prepared.ok) {
      showToast(prepared.error, 'error')
      return
    }
    if (prepared.cardsToReplace?.length) useCompetitorStore.getState().replaceCardsById(prepared.cardsToReplace)
    if (prepared.cardsToAdd.length) useCompetitorStore.getState().appendCards(prepared.cardsToAdd)
    if (!prepared.cardIds.length) {
      showToast(prepared.message || `没有需要新生成的${CATEGORY_LABELS[category]}。`, 'success')
      return
    }
    try {
      const mapping = prepared.message ? prepared.message : ''
      showToast(`开始生成${CATEGORY_LABELS[category]}，共 ${prepared.cardIds.length} 张。其他类型不会一起生成。${mapping}`, 'success')
      await runCompetitorQueue(prepared.cardIds, imageModel)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '生成失败', 'error')
    }
  }

  const doneCount = session.cards.filter((card) => card.status === 'done' && card.resultImageId).length
  const activeLightboxCard = session.cards.find((card) => card.id === lightbox?.cardId)
  const optionRefs = session.refs.filter((ref) => ref.category === 'option')

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 pb-24" data-testid="competitor-workbench">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-50">竞品参谋</h1>
            <p className="mt-1 workbench-help text-sm">按类别上传竞品主图、详情图和规格/选项图，再分析并重构。主图默认模仿竞品风格并重新构图，做成适合该产品类目的新图；产品和赠品外形不变，不虚构功能。你填写了风格就按你的风格。详情页规则见下方。</p>
          </div>
        </div>
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300" data-testid="competitor-shared-connection">
          {connection.configured
            ? `与套图、自由生图共用本机反代（${connection.baseUrlHost}），不用重新填写地址和密钥。`
            : '还没有在设置里找到本机反代配置。请使用与其他模块相同的设置，不必为竞品参谋单独再接一套。'}
          {planningModel || imageModel ? ` 当前规划模型 ${planningModel || '未选'}，生图模型 ${imageModel || '未选'}。` : ' 若套图里已经选过模型，这里会直接沿用。'}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <label className="workbench-help">规划模型（与套图共用，仅用于你手动触发的逐图分析）
            <select className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" value={planningModel} onChange={(e) => setSharedWorkbenchModels(e.target.value, imageModel)}>
              <option value="">{detected?.planningIds.length || planningModel ? '请选择规划模型' : '可先刷新模型列表'}</option>
              {(detected?.planningIds.length ? detected.planningIds : (planningModel ? [planningModel] : [])).map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <label className="workbench-help">生图模型（与套图共用）
            <select className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" value={imageModel} onChange={(e) => setSharedWorkbenchModels(planningModel, e.target.value)}>
              <option value="">{detected?.imageIds.length || imageModel ? '请选择生图模型' : '可先刷新模型列表'}</option>
              {(detected?.imageIds.length ? detected.imageIds : (imageModel ? [imageModel] : [])).map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={detecting} onClick={() => void onDetect()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">
              {detecting ? '刷新中…' : '刷新模型列表'}
            </button>
            <button type="button" onClick={() => setShowSettings(true)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">打开共用设置</button>
          </div>
        </div>
        <p className="mt-2 workbench-help">分别点「分析主图」「分析详情页」或「分析选项图」才会调用规划模型；一次只分析一类。确认后才生图，不会在分析后自动扣费。</p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-base font-semibold">自家产品与风格</h2>
        <label className="mt-3 block workbench-help">产品名称
          <input className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" value={session.productName} onChange={(e) => useCompetitorStore.getState().setProductName(e.target.value)} />
        </label>
        <label className="mt-3 block workbench-help">自家商品要点（选填）
          <textarea
            data-testid="competitor-product-facts"
            rows={2}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
            placeholder="仅填写已确认的参数或卖点，例如容量、尺寸。会用于核对详情页，不会自动把主图营销点算进来。"
            value={session.productFactsNote || ''}
            onChange={(e) => useCompetitorStore.getState().setProductFactsNote(e.target.value)}
          />
        </label>
        <div className="mt-3 rounded-xl border border-dashed border-gray-300 p-4 workbench-help text-sm dark:border-gray-600">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>上传自己的产品原图，用于锁定外形。生图前至少需要 1 张。</span>
            <button type="button" onClick={() => productInputRef.current?.click()} className="rounded-lg bg-orange-500 px-3 py-1.5 text-white">上传产品图</button>
          </div>
          <input ref={productInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) void importProduct(e.target.files); e.target.value = '' }} />
          <div className="mt-3 flex flex-wrap gap-2">
            {session.productAssets.map((asset) => (
              <div key={asset.id} className="h-16 w-16 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                {asset.thumbnailDataUrl || asset.dataUrl ? <img src={asset.thumbnailDataUrl || asset.dataUrl} alt={asset.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] text-gray-400">已存</div>}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {(Object.keys(STYLE_MODE_LABELS) as Array<keyof typeof STYLE_MODE_LABELS>).map((mode) => (
            <label key={mode} className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="style-mode" checked={session.styleMode === mode} onChange={() => useCompetitorStore.getState().setStyleMode(mode)} className="mt-1" />
              <span>
                <span className="font-medium">{STYLE_MODE_LABELS[mode]}</span>
                <span className="mt-0.5 block workbench-help">{STYLE_MODE_HINTS[mode]}</span>
              </span>
            </label>
          ))}
        </div>
        {session.styleMode === 'custom' ? (
          <div className="mt-3">
            <TextPrimaryColorPicker value={session.textPrimaryColor} onChange={(value) => useCompetitorStore.getState().setTextPrimaryColor(value)} />
          </div>
        ) : null}
        <p className="mt-3 workbench-help">同款商品不等于可以使用竞对原图的版权。成品应使用你自己的产品图，不要照搬对方商标、水印或无法确认的认证。价格和预计送达默认不画进图里。</p>
      </section>

      <p className="workbench-help text-sm" data-testid="competitor-upload-intro">请按「主图、详情图、选项图」分别上传你已保存的图片，再进行分析。规格图可在对应分类里填写套餐名称。</p>

      <CategoryBoard
        coverage={coverage}
        generatingLock={actionBusy}
        onSupplement={(category, files) => void importTo(category, files)}
        onGenerateError={(message) => showToast(message, 'error')}
      />

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-base font-semibold">选项套餐对应</h2>
        <p className="mt-1 workbench-help text-sm">上传选项图后，可在这里添加套餐名称并绑定对应图片。没有自动映射时请手工填写。缺失就标明缺失，不会自动造图或用主图顶替。价格和预计送达不算选项内容。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="min-w-[12rem] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" placeholder="套餐名称，例如：单独一只挖掘机" value={optionNameDraft} onChange={(e) => setOptionNameDraft(e.target.value)} />
          <input className="min-w-[12rem] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" placeholder="本套餐搭配要求（选填；留空按竞品原搭配1对1）" aria-label="本套餐主商品、赠品、配件搭配要求" value={optionContentsDraft} onChange={(e) => setOptionContentsDraft(e.target.value)} />
          <button type="button" className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white dark:bg-gray-100 dark:text-gray-900" onClick={() => {
            if (!optionNameDraft.trim()) { showToast('请填写套餐名称', 'error'); return }
            useCompetitorStore.getState().addOptionSlot(optionNameDraft, optionContentsDraft)
            setOptionNameDraft('')
            setOptionContentsDraft('')
          }}>添加套餐</button>
        </div>
        <div className="mt-3 space-y-2">
          {session.optionSlots.map((slot) => (
            <div key={slot.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
              <input className="min-w-[8rem] flex-1 rounded border border-gray-200 px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={slot.optionName} onChange={(e) => useCompetitorStore.getState().updateOptionSlot(slot.id, { optionName: e.target.value })} />
              <input className="min-w-[8rem] flex-1 rounded border border-gray-200 px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={slot.contentsNote} onChange={(e) => useCompetitorStore.getState().updateOptionSlot(slot.id, { contentsNote: e.target.value })} placeholder="本套餐搭配要求（选填；留空按竞品原搭配1对1）" aria-label="本套餐主商品、赠品、配件搭配要求" />
              <select className="rounded border border-gray-200 px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={slot.boundRefId || ''} onChange={(e) => useCompetitorStore.getState().bindOptionSlot(slot.id, e.target.value || null)}>
                <option value="">未绑定（缺失）</option>
                {optionRefs.map((ref) => <option key={ref.id} value={ref.id}>{ref.optionName || ref.asset.name || ref.id}</option>)}
              </select>
              <span className={`text-xs ${slot.missing ? 'text-amber-600' : 'text-green-700'}`}>{slot.missing ? '缺失' : '已绑定'}</span>
              <button type="button" className="text-xs text-red-600 dark:text-red-400" onClick={() => useCompetitorStore.getState().removeOptionSlot(slot.id)}>删除</button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-base font-semibold">覆盖率与预览确认</h2>
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300" data-testid="competitor-option-rules-hint">选项图默认按上传顺序一对一重构，主商品、赠品、配件的形状结构和数量保留。只有在对应套餐的搭配框填写要求，才对该套餐优先改搭配；修改后请更新本地预览，已有成品与逐张编辑不会自动覆盖。搭配中未在参考图出现的新物品真实外形未知，请补充实拍；已要求模型不得据名称虚构外形，出图仍需核对。旧预览也可先更新本地预览；成品仅主动重绘才改变。</p>
        <p className="mt-1 workbench-help text-sm">本地预览不会分析图片。请按类别点击「分析主图」「分析详情页」或「分析选项图」提取卖点，不必三类都分析。{describeCoverage(coverage)}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 workbench-help text-sm">
          {coverage.map((row) => <li key={row.category}>{row.note}</li>)}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          {COMPETITOR_CATEGORIES.map((category) => {
            const hasRefs = session.refs.some((ref) => ref.category === category)
            const busy = actionBusy
            const current = analyzing && analyzingCategory === category
            return (
              <button
                key={category}
                type="button"
                disabled={busy || !hasRefs}
                onClick={() => void onAnalyze(category)}
                data-testid={`competitor-analyze-${category}`}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm disabled:opacity-50 dark:border-gray-700"
              >
                {current ? `正在分析${ANALYSIS_CATEGORY_LABELS[category]}…` : `分析${ANALYSIS_CATEGORY_LABELS[category]}（调用规划模型，不自动生图）`}
              </button>
            )
          })}
          {analyzing && analyzingCategory ? (
            <p className="w-full workbench-help" data-testid="competitor-analyze-progress">正在分析{ANALYSIS_CATEGORY_LABELS[analyzingCategory]}，不会同时发起其他类分析或自动生图。</p>
          ) : null}
          {session.lastAnalysisError ? (
            <p className="w-full text-sm text-red-600 dark:text-red-400" data-testid="competitor-analyze-error">分析{session.lastAnalysisError.category === 'all' ? '参考图' : ANALYSIS_CATEGORY_LABELS[session.lastAnalysisError.category]}失败：{session.lastAnalysisError.message}</p>
          ) : null}
          <label className="text-sm">当前预览类别
            <select data-testid="competitor-preview-category" value={previewCategory} disabled={actionBusy} onChange={(event) => setPreviewCategory(event.target.value as CompetitorCategory)} className="ml-2 rounded border px-2 py-1">
              {COMPETITOR_CATEGORIES.map((category) => <option key={category} value={category}>{ANALYSIS_CATEGORY_LABELS[category]}</option>)}
            </select>
          </label>
          <button type="button" data-testid="competitor-build-preview" disabled={actionBusy || !session.refs.some((ref) => ref.category === previewCategory)} onClick={onBuildPreview} className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700">用已填内容生成本地预览（仅{ANALYSIS_CATEGORY_LABELS[previewCategory]}，不调用模型）</button>
          {queuePhase === 'running' ? <button type="button" onClick={pauseCompetitorQueue} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">暂停</button> : null}
          {queuePaused ? <button type="button" onClick={resumeCompetitorQueue} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">继续</button> : null}
          {generatingLock ? <button type="button" onClick={stopCompetitorQueue} className="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">停止</button> : null}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="workbench-help">主图生成数量
            <input
              data-testid="competitor-hero-count"
              type="text"
              inputMode="numeric"
              className="mt-1 w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
              value={heroCountDraft}
              aria-invalid={Boolean(heroCountError)}
              onChange={(e) => {
                setHeroCountDraft(e.target.value)
                setHeroCountError(null)
              }}
            />
          </label>
          <button type="button" disabled={actionBusy || !categoryConfirmed(session, 'hero')} onClick={() => void onGenerateCategory('hero')} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" data-testid="competitor-generate-hero">生成主图</button>
          <button type="button" disabled={actionBusy || !categoryConfirmed(session, 'detail')} onClick={() => void onGenerateCategory('detail')} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" data-testid="competitor-generate-detail">生成详情页</button>
          <button type="button" disabled={actionBusy || !categoryConfirmed(session, 'option')} onClick={() => void onGenerateCategory('option')} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" data-testid="competitor-generate-option">生成选项图</button>
        </div>
        {heroCountError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400" data-testid="competitor-hero-count-error">{heroCountError}</p> : <p className="mt-2 workbench-help">主图数量须为 1 到 12 的正整数，与套图每批上限相同。超出不会自动改小。多张竞品主图按实际上传顺序依次模仿；若数量多于参考主图，会从第一张再循环并重新构图，例如 3 张参考生成 5 张即为 1、2、3、1、2，不会复用已有成品，也不按文件名排序。详情页和选项图按当前预览方案生成，不会额外设置数量。已有成品和手改文案不会被自动覆盖；新规则在你主动生成或重绘时写入请求。</p>}
        {session.heroMappingNote ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300" data-testid="competitor-hero-mapping-note">{session.heroMappingNote}</p> : null}
        <div className="mt-3 space-y-2 rounded-xl bg-gray-50 px-3 py-3 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300" data-testid="competitor-detail-page-settings">
          <p>详情页按竞品对标卖点分张生成，默认原样保留卖点词原文和产品外形、已标注尺寸，不凭空编造，也不按竞品张数硬凑。构图风格只作参考，可以重新布局。未填写卖点或风格时按这个默认规则；你填写了哪一项，就只按你写的改那一项。使用现有单张尺寸和比例，不再生成整张长图再裁切。</p>
          {session.cards.some((card) => card.category === 'detail' && card.detailRenderMode === 'long_strip') ? (
            <p data-testid="competitor-detail-longstrip-rebuild-hint" className="text-amber-700 dark:text-amber-300">当前预览仍是整长图方案，不会自动改写或重生成已有成品。请先点击「用已填内容生成本地预览」，再生成详情页。</p>
          ) : null}
          <label className="block">详情卖点要求（选填）
            <textarea
              data-testid="competitor-detail-selling-point-note"
              rows={2}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
              placeholder="留空则按竞品卖点词原文分张生成。填写后以你写的卖点词为准，不会被“卖点不能改变”改回竞品原文。"
              value={session.detailSellingPointNote || ''}
              onChange={(e) => useCompetitorStore.getState().setDetailSellingPointNote(e.target.value)}
            />
          </label>
          <label className="block">详情构图/风格要求（选填）
            <textarea
              data-testid="competitor-detail-style-note"
              rows={2}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950"
              placeholder="留空则借鉴竞品构图风格并重新布局。只改风格时不会改你未指定的卖点词。"
              value={session.detailStyleNote || ''}
              onChange={(e) => useCompetitorStore.getState().setDetailStyleNote(e.target.value)}
            />
          </label>
        </div>
        {(() => {
          const hint = oldPlanCoverageHint(assessSessionDetailPlan(session))
          return hint ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300" data-testid="competitor-detail-plan-hint">{hint}</p> : null
        })()}
        <label className="mt-3 flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" className="mt-1" data-testid="competitor-confirm-category" disabled={actionBusy || !session.cards.some((card) => card.category === previewCategory)} checked={categoryConfirmed(session, previewCategory)} onChange={(e) => useCompetitorStore.getState().confirmGeneration(e.target.checked, previewCategory)} />
          <span>我已检查{ANALYSIS_CATEGORY_LABELS[previewCategory]}预览，确认仅该类别；其他类别的确认独立保留。预览本身不调用模型，只有主动分析或生成所选类别才发请求。</span>
        </label>
      </section>

      {session.cards.length ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">生成进度 · {doneCount}/{session.cards.length}</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={zipping || !doneCount}
                onClick={() => {
                  setZipping(true)
                  void downloadGroupedZip(session.cards)
                    .then((n) => showToast(`已打包全部已完成图 ${n} 张`, 'success'))
                    .catch((err) => showToast(err instanceof Error ? err.message : '打包失败', 'error'))
                    .finally(() => setZipping(false))
                }}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700"
              >
                下载全部已完成图
              </button>
              {COMPETITOR_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  disabled={zipping || !session.cards.some((card) => card.category === category && card.resultImageId)}
                  onClick={() => {
                    setZipping(true)
                    void downloadCategoryZip(session.cards, category)
                      .then((n) => showToast(`已打包${CATEGORY_LABELS[category]} ${n} 张`, 'success'))
                      .catch((err) => showToast(err instanceof Error ? err.message : '打包失败', 'error'))
                      .finally(() => setZipping(false))
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700"
                >
                  下载{CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 workbench-help text-sm">生成结果按主图、详情页、选项图分框展示，不会替换上方竞品参考图。</p>
          <GeneratedResults
            cards={session.cards}
            resultUrls={resultUrls}
            generatingLock={actionBusy}
            onOpen={(cardId) => useCompetitorStore.getState().setLightbox(cardId)}
            onGenerateError={(message) => showToast(message, 'error')}
          />
        </section>
      ) : null}

      {activeLightboxCard ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => useCompetitorStore.getState().setLightbox(null)}>
          <div className="max-h-full max-w-3xl overflow-auto rounded-2xl bg-white p-4 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">生成结果 {formatPixelSize(activeLightboxCard.resultWidth, activeLightboxCard.resultHeight) || ''}</h3>
              <button type="button" onClick={() => useCompetitorStore.getState().setLightbox(null)} className="workbench-help text-sm">关闭</button>
            </div>
            {activeLightboxCard.resultImageId && resultUrls[activeLightboxCard.resultImageId] ? (
              <img src={resultUrls[activeLightboxCard.resultImageId]} alt="生成结果原图" className="w-full rounded-xl bg-gray-50 dark:bg-gray-900 object-contain" />
            ) : <div className="workbench-help text-sm">还没有生成结果，或结果仍在载入。</div>}
          </div>
        </div>
      ) : null}
    </div>
  )
}
