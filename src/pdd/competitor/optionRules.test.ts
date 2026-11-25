import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPreviewCards, reconcilePreviewCards } from './preview'
import { buildOptionGenerationRules, parseOptionInventory } from './optionRules'
import { applyAnalysisSuggestions, parseAnalysisResponse, buildAnalysisChatMessages } from './analyze'
import { generateCompetitorCard, inspectCompetitorGenerationInput } from './generation'
import { useCompetitorStore } from './store'
import type { CompetitorRefImage } from './types'
import { submitTask } from '../../store'

vi.mock('../../store', () => ({
  useStore: { getState: () => ({ settings: {model:'', apiMode:'images'}, params:{}, tasks:[], setSettings:vi.fn(), setParams:vi.fn() }) },
  submitTask: vi.fn(async () => { throw new Error('intercepted, no paid call') }),
  waitForTaskSettled: vi.fn(),
}))
vi.mock('../generationInputs', () => ({collectInputImages: vi.fn(async (assets) => assets.map((asset: {id:string}) => ({id:asset.id, dataUrl:'fixture'}))) }))

function ref(id: string, category: CompetitorRefImage['category'] = 'option'): CompetitorRefImage {
  return {id, category, asset:{id:`asset-${id}`,imageId:`asset-${id}`, name:id}, optionName:`套餐-${id}`, contentsNote:'竞品车一辆、铲子一把', sellingPoint:'合金车', sceneHint:'棚拍',layoutSummary:'居中',analysisStatus:'model_suggested',source:'manual_import',
    optionInventory:[{role:'main',name:'车',quantity:1,appearance:'黄色履带车'}, {role:'gift',name:'铲子',quantity:1,appearance:'短柄铲'}]}
}
function preview(custom = '') {
  return buildPreviewCards({refs:[ref('z'),ref('a')], optionSlots:[{id:'slot-z',optionName:'自家套餐甲', contentsNote:custom,boundRefId:'z',missing:false}],styleMode:'strict',heroGenerateCount:12}).cards
}
function seed(custom = '') {
  const cards=preview(custom)
  useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,
    refs:[ref('z'),ref('a')],cards, productAssets:[{id:'product',imageId:'product',name:'自家实拍'}], generationConfirmed:true,
    optionSlots:[{id:'slot-z',optionName:'自家套餐甲',contentsNote:custom,boundRefId:'z',missing:false}],styleMode:'strict'},queuePhase:'idle'})
  return cards
}
beforeEach(() => {vi.clearAllMocks()})

describe('选项图1对1与逐套餐搭配', () => {
  it('保持真实上传顺序，每张只绑定一个参考，不因主图数量循环、不漏未命名套餐', () => {
    const cards=preview()
    expect(cards.map(card=>card.refImageId)).toEqual(['z','a'])
    expect(cards[0].optionSlotId).toBe('slot-z')
    expect(cards[0].optionCompositionNote).toBe('')
    expect(cards[0].imagePrompt).toContain('原搭配一对一重构')
    expect(cards[0].imagePrompt).toContain('主商品：车；数量=1')
    expect(cards[0].imagePrompt).toContain('赠品：铲子；数量=1')
    expect(cards[0].imagePrompt).not.toContain('用户指定搭配（仅本张优先）')
  })
  it('只将对应框用户要求写入该卡，其他选项仍保留原搭配', () => {
    const cards=preview('车一辆、铲子两把')
    expect(cards[0].contentsNote).toBe('车一辆、铲子两把')
    expect(cards[0].optionName).toBe('自家套餐甲')
    expect(cards[0].imagePrompt).toContain('本套餐用户指定搭配（仅本张优先）：车一辆、铲子两把')
    expect(cards[0].imagePrompt).toContain('不要用竞品默认清单否决')
    expect(cards[1].imagePrompt).not.toContain('铲子两把')
    expect(cards[1].imagePrompt).toContain('原搭配一对一重构')
  })
  it('新物真实外形不明在预览和prompt明确限制，不凭名称补细节', () => {
    const cards=preview('加一个蓝色收纳箱')
    expect(cards[0].analysisWarnings?.join()).toContain('真实外形未知')
    expect(cards[0].imagePrompt).toContain('不得凭名称想象形状')
    expect(cards[0].imagePrompt).toContain('请补充该物品实拍参考')
    expect(cards[0].imagePrompt).not.toContain('收纳箱带四个轮子')
    expect(cards[0].imagePrompt).toContain('用户允许的搭配变更不是允许编造外形')
  })
  it('未确认的数量不自动补成1，旧数据无清单也不编造', () => {
    expect(parseOptionInventory([{role:'gift',name:'铲',quantity:'2',appearance:null}])[0].quantity).toBeNull()
    expect(parseOptionInventory([{role:'invented',name:'箱子',quantity:1}])).toEqual([])
    expect(buildOptionGenerationRules()).toContain('不把未识别当作没有')
    expect(buildOptionGenerationRules()).toContain('不凭空补清单或猜数量')
  })
  it('分析清单是逐图观察，作用范围不传播到主图与详情图', () => {
    const parsed=parseAnalysisResponse(JSON.stringify({results:[{refId:'z',optionInventory:[{role:'main',name:'车',quantity:1,appearance:'履带'}]}]}),['z'])
    if(!parsed.ok) throw Error('fixture should parse')
    const refs=[ref('z'),ref('h','hero'),ref('d','detail')]
    const after=applyAnalysisSuggestions(refs,parsed.results)
    expect(after[0].optionInventory?.[0].appearance).toBe('履带')
    expect(after[1]).toBe(refs[1]);expect(after[2]).toBe(refs[2])
    const chat=buildAnalysisChatMessages([{refId:'z',category:'option',dataUrl:'fixture'}],'产品','',undefined,'option')
    expect(chat.system).toContain('optionInventory')
    expect(chat.system).toContain('不把用户要求但图中没有的东西伪称已看见')
  })
  it('默认与自定义规则和正确参考ID进入最终请求构造，不借用其他套餐', () => {
    const cards=seed('车两辆')
    const first=inspectCompetitorGenerationInput(cards[0].id)
    const second=inspectCompetitorGenerationInput(cards[1].id)
    expect(first.assetIds).toEqual(['product','asset-z'])
    expect(first.prompt).toContain('refId=z')
    expect(first.prompt).toContain('本套餐用户指定搭配（仅本张优先）：车两辆')
    expect(second.assetIds).toEqual(['product','asset-a'])
    expect(second.prompt).not.toContain('车两辆')
    expect(second.prompt).toContain('原搭配一对一重构')
  })
  it('逐张编辑与自由prompt重绘仍带本张搭配规则；失败保留成品', async () => {
    const cards=seed('车两辆')
    useCompetitorStore.getState().patchCard(cards[0].id,{title:'我的标题',sceneSummary:'桌面',layoutSummary:'上文下图'})
    let input=inspectCompetitorGenerationInput(cards[0].id)
    expect(input.prompt).toContain('我的标题');expect(input.prompt).toContain('桌面');expect(input.prompt).toContain('上文下图')
    useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,cards:useCompetitorStore.getState().session.cards.map((c)=>c.id===cards[0].id?{...c,imagePrompt:'手写这一张的prompt',lastPromptEditAt:9999999999999,lastStructuredEditAt:1,resultImageId:'finished',status:'done'}:c)}})
    await expect(generateCompetitorCard(cards[0].id)).rejects.toThrow('intercepted')
    expect(submitTask).toHaveBeenCalledTimes(1)
    const payload=vi.mocked(submitTask).mock.calls[0] as unknown as [{input:{prompts:string[];inputImages:Array<{id:string}>}}]
    expect(payload[0].input.prompts[0]).toContain('手写这一张的prompt')
    expect(payload[0].input.prompts[0]).toContain('本套餐用户指定搭配（仅本张优先）：车两辆')
    expect(payload[0].input.inputImages.map(a=>a.id)).toEqual(['product','asset-z'])
    expect(useCompetitorStore.getState().session.cards[0].resultImageId).toBe('finished')
    expect(useCompetitorStore.getState().session.cards[1].title).toBe(cards[1].title)
  })
  it('旧预览搭配变动在付费请求前拦截，主动本地预览应用新搭配但保留成品与手改', async () => {
    const old=seed()
    const finished={...old[0],title:'手改',resultImageId:'keep',status:'done' as const}
    useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,cards:[finished,old[1]],optionSlots:[{id:'slot-z',optionName:'甲',contentsNote:'车两辆',boundRefId:'z',missing:false}]}})
    await expect(generateCompetitorCard(finished.id)).rejects.toThrow('更新本地预览')
    expect(submitTask).not.toHaveBeenCalled()
    const next=reconcilePreviewCards([finished,old[1]],preview('车两辆'))
    expect(next[0].title).toBe('手改');expect(next[0].resultImageId).toBe('keep')
    expect(next[0].optionCompositionNote).toBe('车两辆')
  })
  it('保护卡片按参考ID匹配而不是错用套餐顺序，原参考丢失不借图', () => {
    const cards=seed()
    const protectedCards=cards.map(c=>({...c,resultImageId:`keep-${c.refImageId}`,status:'done' as const}))
    const next=reconcilePreviewCards(protectedCards,[...cards].reverse())
    expect(next.map(c=>c.resultImageId)).toEqual(['keep-a','keep-z'])
    useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,refs:[ref('a')]}})
    expect(()=>inspectCompetitorGenerationInput(cards[0].id)).toThrow('缺少对应竞品参考')
  })
  it('未确认或正在生成时不发重绘请求', async () => {
    const cards=seed()
    useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,generationConfirmed:false}})
    await expect(generateCompetitorCard(cards[0].id)).rejects.toThrow('预览确认')
    useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,generationConfirmed:true,cards:[{...cards[0],status:'generating'},cards[1]]}})
    await generateCompetitorCard(cards[0].id)
    expect(submitTask).not.toHaveBeenCalled()
  })
})
