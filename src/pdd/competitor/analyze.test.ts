import { describe, expect, it } from 'vitest'
import { applyAnalysisSuggestions, buildAnalysisChatMessages, composeCompetitorAnalysisImages, filterRefsForAnalysis, inspectCompetitorAnalysisInput, parseAnalysisResponse } from './analyze'
import { fillSolidRgba } from './detailStrip'
import type { CompetitorRefImage } from './types'

describe('竞品逐图分析请求构造（不发网）', () => {
  it('把每张参考图作为 image_url 输入，并要求不照抄、不编造', () => {
    const messages = buildAnalysisChatMessages([
      { refId: 'ref-hero', category: 'hero', dataUrl: 'data:image/png;base64,AAA' },
      { refId: 'ref-opt', category: 'option', optionName: '单独一只挖掘机', dataUrl: 'data:image/png;base64,BBB' },
    ], '工程车')
    expect(messages.imageCount).toBe(2)
    expect(messages.system).toMatch(/不要照抄图上原句/)
    expect(messages.system).toMatch(/不要发明参考图中没有的功能、参数、效果或认证/)
    const textPart = messages.userContent[0] as { type: string; text: string }
    expect(textPart.text).toMatch(/refId=ref-hero/)
    expect(textPart.text).toMatch(/单独一只挖掘机/)
    expect(messages.userContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_url', refId: 'ref-hero' }),
      expect.objectContaining({ type: 'image_url', refId: 'ref-opt' }),
    ]))
  })

  it('解析失败时不写入卖点；成功时只更新对应图且不编造空缺数量', () => {
    expect(parseAnalysisResponse('not-json', ['ref-hero']).ok).toBe(false)
    const parsed = parseAnalysisResponse(JSON.stringify({
      results: [
        { refId: 'ref-hero', sellingPointCore: '结实耐玩', sellingPointCopy: '结实耐用，陪伴户外玩耍', sceneCategory: '草坪', layoutSummary: '左侧产品右侧卖点', warnings: [] },
        { refId: 'unknown', sellingPointCopy: '应被丢弃' },
      ],
    }), ['ref-hero'])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const refs: CompetitorRefImage[] = [
      {
        id: 'ref-hero',
        category: 'hero',
        asset: { id: 'a', imageId: 'a', name: 'a.png' },
        optionName: '',
        contentsNote: '',
        sellingPoint: '',
        sceneHint: '',
        layoutSummary: '',
        analysisStatus: 'pending',
        source: 'manual_import',
      },
      {
        id: 'ref-opt',
        category: 'option',
        asset: { id: 'b', imageId: 'b', name: 'b.png' },
        optionName: '',
        contentsNote: '',
        sellingPoint: '',
        sceneHint: '',
        layoutSummary: '',
        analysisStatus: 'pending',
        source: 'manual_import',
      },
    ]
    const next = applyAnalysisSuggestions(refs, parsed.results)
    expect(next[0].sellingPoint).toBe('结实耐用，陪伴户外玩耍')
    expect(next[0].sceneHint).toBe('草坪')
    expect(next[0].analysisStatus).toBe('model_suggested')
    expect(next[1].sellingPoint).toBe('')
    expect(next[1].contentsNote).toBe('')
    expect(next[1].analysisStatus).toBe('pending')
  })
})


function analysisRef(id: string, category: CompetitorRefImage['category'], width: number, height: number): CompetitorRefImage {
  return {
    id,
    category,
    asset: { id, imageId: id, name: `${id}.png`, width, height, dataUrl: `data:image/png;base64,${id}` },
    optionName: '',
    contentsNote: '',
    sellingPoint: '',
    sceneHint: '',
    layoutSummary: '',
    analysisStatus: 'pending',
    source: 'manual_import',
  }
}

describe('详情长图作为分析输入（拦截构造，不发真实请求）', () => {
  it('多张详情图只发送按上传顺序拼接的长图，并为每个原分图保留 refId 映射', async () => {
    const refs = [
      analysisRef('hero-1', 'hero', 64, 64),
      analysisRef('detail-z', 'detail', 80, 20),
      analysisRef('detail-a', 'detail', 40, 10),
      analysisRef('opt-1', 'option', 64, 64),
    ]
    const prepared = new Map(refs.map((ref) => [ref.id, ref.asset.dataUrl || '']))
    const composed = await composeCompetitorAnalysisImages(refs, prepared, {
      decodePixels: async (dataUrl) => {
        const ref = refs.find((item) => dataUrl.endsWith(item.id))
        if (!ref?.asset.width || !ref.asset.height) throw new Error('missing fixture')
        const color: [number, number, number, number] = ref.id === 'detail-z' ? [220, 20, 20, 255] : [20, 40, 220, 255]
        return { width: ref.asset.width, height: ref.asset.height, pixels: fillSolidRgba(ref.asset.width, ref.asset.height, color) }
      },
      encodeSlice: async (slice) => ({ dataUrl: `data:image/png;base64,STRIP-${slice.index}-${slice.width}x${slice.height}` }),
    })
    expect(composed.ok).toBe(true)
    if (!composed.ok) return
    expect(composed.expectedRefIds).toEqual(['hero-1', 'detail-z', 'detail-a', 'opt-1'])
    const stripImages = composed.images.filter((image) => image.role === 'detail-strip')
    expect(stripImages).toHaveLength(1)
    expect(composed.images.filter((image) => image.category === 'detail')).toHaveLength(1)
    expect(stripImages[0]?.dataUrl).toBe('data:image/png;base64,STRIP-1-80x40')
    expect(stripImages[0]?.strip?.sourceRefIds).toEqual(['detail-z', 'detail-a'])
    expect(composed.layout?.kind).toBe('strip')
    expect(composed.layout?.placements.map((item) => item.refId)).toEqual(['detail-z', 'detail-a'])

    const messages = buildAnalysisChatMessages(composed.images, '工程车')
    expect(messages.imageCount).toBe(3)
    expect(messages.system).toMatch(/纵向拼接/)
    const textPart = messages.userContent[0] as { type: string; text: string }
    expect(textPart.text).toMatch(/按用户上传先后顺序从上到下纵向拼接成一张长图/)
    expect(textPart.text).toMatch(/1\. detail-z/)
    expect(textPart.text).toMatch(/2\. detail-a/)
    expect(textPart.text).toMatch(/不要把这一段本身当作一个 refId 结果/)
    expect(textPart.text).not.toMatch(/请逐张分析下面这些竞品参考图，把长图当成一张散图/)

    const parsed = parseAnalysisResponse(JSON.stringify({
      results: [
        { refId: 'detail-z', sellingPointCopy: '上半段卖点', sceneCategory: '白底', layoutSummary: '顶栏' },
        { refId: 'detail-a', sellingPointCopy: '下半段卖点', sceneCategory: '白底', layoutSummary: '参数表' },
        { refId: 'detail-strip-1', sellingPointCopy: '不应写入' },
      ],
    }), composed.expectedRefIds)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.results.map((item) => item.refId)).toEqual(['detail-z', 'detail-a'])
  })

  it('详情图解码失败或超限时中止分析，避免静默漏图', async () => {
    const refs = [
      analysisRef('detail-ok', 'detail', 80, 20),
      { ...analysisRef('detail-bad', 'detail', 0, 0), asset: { id: 'detail-bad', imageId: 'detail-bad', name: 'bad.png', width: 0, height: 0, dataUrl: 'data:image/png;base64,bad' } },
    ]
    const prepared = new Map(refs.map((ref) => [ref.id, ref.asset.dataUrl || '']))
    const composed = await composeCompetitorAnalysisImages(refs, prepared, {
      decodePixels: async () => ({ width: 0, height: 0, pixels: fillSolidRgba(1, 1, [0, 0, 0, 0]) }),
      encodeSlice: async () => ({ dataUrl: 'data:image/png;base64,X' }),
    })
    expect(composed.ok).toBe(false)
    if (composed.ok) return
    expect(composed.error).toMatch(/无法纳入长图分析/)
  })
})


describe('卖点块分析输入（拦截构造，不发真实请求）', () => {
  it('超限单张详情图会按安全分段发送，不把整张超限图交给模型', async () => {
    const refs = [analysisRef('detail-tall', 'detail', 80, 9000)]
    const prepared = new Map(refs.map((ref) => [ref.id, ref.asset.dataUrl || '']))
    const composed = await composeCompetitorAnalysisImages(refs, prepared, {
      decodePixels: async () => ({ width: 80, height: 9000, pixels: fillSolidRgba(80, 9000, [20, 80, 200, 255]) }),
      encodeSlice: async (slice) => ({ dataUrl: `data:image/png;base64,TALL-${slice.index}-${slice.height}` }),
    })
    expect(composed.ok).toBe(true)
    if (!composed.ok) return
    const stripImages = composed.images.filter((image) => image.role === 'detail-strip')
    expect(stripImages.length).toBeGreaterThan(1)
    expect(composed.images.some((image) => image.role === 'reference' && image.category === 'detail')).toBe(false)
    expect(stripImages.every((image) => (image.strip?.height || 0) <= 8192)).toBe(true)
    expect(composed.layout?.kind).toBe('sliced')
    expect(composed.layout?.height).toBe(9000)
  })

  it('解析 sellingPointBlocks 时保留卖点词、跨图 ref 和不确定标记', () => {
    const parsed = parseAnalysisResponse(JSON.stringify({
      results: [
        { refId: 'detail-a', sellingPointCopy: '加厚合金臂', sellingPoints: [{ id: 'sp1', core: '加厚合金臂', status: 'confirmed' }] },
      ],
      sellingPointBlocks: [
        { id: 'sp1', core: '加厚合金臂', sourceRefIds: ['detail-a', 'detail-b'], yStart: 60, yEnd: 100, uncertainBounds: false },
      ],
    }), ['detail-a', 'detail-b'])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const raw = parsed.raw as { sellingPointBlocks: Array<{ sourceRefIds: string[]; core: string }> }
    expect(raw.sellingPointBlocks[0].sourceRefIds).toEqual(['detail-a', 'detail-b'])
    expect(raw.sellingPointBlocks[0].core).toBe('加厚合金臂')
  })
})

describe('按类别拆分分析输入（拦截构造，不发真实请求）', () => {
  it('只选择对应类别的参考图，并保持上传顺序', () => {
    const refs = [
      analysisRef('hero-z', 'hero', 64, 64),
      analysisRef('detail-1', 'detail', 80, 20),
      analysisRef('hero-a', 'hero', 64, 64),
      analysisRef('option-1', 'option', 64, 64),
    ]
    expect(filterRefsForAnalysis(refs, 'hero').map((item) => item.id)).toEqual(['hero-z', 'hero-a'])
    expect(inspectCompetitorAnalysisInput({ refs, category: 'detail' }).refIds).toEqual(['detail-1'])
    expect(inspectCompetitorAnalysisInput({ refs, category: 'option' }).refIds).toEqual(['option-1'])
    expect(inspectCompetitorAnalysisInput({ refs, category: 'hero' }).missing).toBe(false)
    expect(inspectCompetitorAnalysisInput({ refs: refs.filter((item) => item.category !== 'option'), category: 'option' }).missing).toBe(true)
  })

  it('分析主图的提示词声明只分析主图，不带详情或选项图', () => {
    const messages = buildAnalysisChatMessages([
      { refId: 'hero-z', category: 'hero', dataUrl: 'data:image/png;base64,AAA' },
    ], '工程车', '', undefined, 'hero')
    const textPart = messages.userContent[0] as { type: string; text: string }
    expect(textPart.text).toMatch(/本次只分析「主图」/)
    expect(textPart.text).not.toMatch(/refId=detail/)
    expect(messages.userContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_url', refId: 'hero-z' }),
    ]))
    expect(messages.imageCount).toBe(1)
  })
})

