// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const memory=vi.hoisted(()=>new Map<string,string>())
const submit=vi.hoisted(()=>vi.fn(async (_input:unknown)=>{throw new Error('intercepted final image task, no paid call')}))
vi.mock('../../store',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('../../store')>()
  return {...actual,submitTask:submit,waitForTaskSettled:vi.fn()}
})
vi.mock('../../lib/db',async(importOriginal)=>{
 const actual=await importOriginal<typeof import('../../lib/db')>()
 return {...actual,storeImage:vi.fn(async(dataUrl:string)=>{const id=`converted-${memory.size}`;memory.set(id,dataUrl);return id}),
 storeImageWithSize:vi.fn(async(dataUrl:string)=>{const id=`upload-${memory.size}`;memory.set(id,dataUrl);return {id,width:64,height:64}}),
 getImage:vi.fn(async(id:string)=>memory.has(id)?{id,dataUrl:memory.get(id),source:'upload',createdAt:1}:undefined),
 getImageThumbnail:vi.fn(),getImageDimensions:vi.fn(async()=>({width:64,height:64}))}
})
import CompetitorWorkbench from './CompetitorWorkbench'
import { useCompetitorStore } from './store'
import { useStore } from '../../store'
import { DEFAULT_SETTINGS } from '../../lib/apiProfiles'
import { setSharedWorkbenchModels } from '../sharedModels'
import { usePddStore } from '../store'
import { categoryConfirmed } from './categoryScope'
import { buildPreviewCards } from './preview'
import type { CompetitorRefImage } from './types'
import { COMPETITOR_CATEGORIES, type CompetitorCategory } from './categories'

const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY2kAAAAASUVORK5CYII='
const data=(id:string)=>`data:image/png;base64,${btoa(atob(PNG)+id)}`
function ref(category:CompetitorCategory):CompetitorRefImage {
 const id=`ref-${category}`
 return {id,category,asset:{id,imageId:id,name:id+'.png',width:64,height:64,dataUrl:data(id)},optionName:category==='option'?'套餐甲':'',contentsNote:'',sellingPoint:'',sceneHint:'',layoutSummary:'',analysisStatus:'pending',source:'manual_import'}
}
function seed(category:CompetitorCategory,others=true){
 memory.clear()
 const refs=others?COMPETITOR_CATEGORIES.map(ref):[ref(category)]
 refs.forEach(r=>memory.set(r.id,r.asset.dataUrl!));memory.set('product',data('product'))
 const existing=buildPreviewCards({refs:refs.filter(r=>r.category!==category).map(r=>({...r,sellingPoint:'旧卖点',sellingPointCore:'旧卖点',analysisStatus:'model_suggested'})),optionSlots:[],styleMode:'strict'}).cards.map(c=>({...c,title:`手改-${c.category}`,resultImageId:`finished-${c.category}`,status:'done' as const,lastStructuredEditAt:5}))
 useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,refs,cards:existing,productAssets:[{id:'product',imageId:'product',name:'own.png',dataUrl:data('product')}],optionSlots:[],detailSellingPointBlocks:undefined,detailSellingPointNote:'',detailStyleNote:'',productFactsNote:'',heroGenerateCount:1,categoryConfirmations:{hero:true,detail:true,option:true},generationConfirmed:true,lastAnalysisError:null,planningError:null},analysisInFlight:null,queuePhase:'idle',queueStopped:false,queuePaused:false,lightbox:null})
 useStore.setState({settings:{...DEFAULT_SETTINGS,baseUrl:'http://127.0.0.1:9/v1',apiKey:'unit-test-not-real'},tasks:[]})
 usePddStore.setState({planningModel:'unit-plan',imageModel:'unit-image'})
 setSharedWorkbenchModels('unit-plan','unit-image')
 return existing
}
async function flush(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})}
async function until(predicate:()=>boolean){for(let i=0;i<60;i++){if(predicate())return;await flush()}throw Error('condition timeout')}
function analysisFetch(){return vi.fn(async(_url:unknown,init?:RequestInit)=>{
 const body=JSON.parse(String(init?.body));const parts=body.messages[1].content as Array<{type:string;refId?:string}>
 const ids=parts.filter(p=>p.type==='image_url').map(p=>p.refId)
 return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({results:ids.map(refId=>({refId,sellingPointCore:'合金车',sellingPointCopy:'合金车',sceneCategory:'棚拍',layoutSummary:'居中',warnings:[]}))})}}]}),{status:200})
})}

describe('真实DOM独立分析→本类预览→仅本类生成（全程拦截网络/最终提交）',()=>{
 let root:Root,container:HTMLDivElement
 beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear();submit.mockClear();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container)})
 afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();localStorage.clear();useCompetitorStore.setState({analysisInFlight:null,queuePhase:'idle'})})
 const button=(id:string)=>container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!
 const click=async(id:string)=>{await act(async()=>button(id).click());await flush()}
 for(const category of COMPETITOR_CATEGORIES){for(const others of [true,false]){
 it(`${category}独立完成链路；其他两类${others?'有图但未分析':'无图'}也不阻断`,async()=>{
  const existing=seed(category,others)
  if(others)useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,refs:useCompetitorStore.getState().session.refs.map(r=>r.category===category?r:{...r,asset:{...r.asset,dataUrl:'data:application/octet-stream;base64,AAAA'}})}})
  const snapshots=existing.map(c=>JSON.stringify(c))
  const fetchMock=analysisFetch();vi.stubGlobal('fetch',fetchMock)
  await act(async()=>root.render(<CompetitorWorkbench/>));await flush()
  await click(`competitor-analyze-${category}`)
  await until(()=>useCompetitorStore.getState().analysisInFlight===null)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const analysisBody=JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
  const parts=analysisBody.messages[1].content as Array<{type:string;image_url?:{url:string};refId?:string}>
  expect(parts.filter(p=>p.type==='image_url').map(p=>p.image_url?.url)).toEqual([data(`ref-${category}`)])
  expect(submit).not.toHaveBeenCalled()
  expect(container.querySelector<HTMLSelectElement>('[data-testid="competitor-preview-category"]')?.value).toBe(category)
  await click('competitor-build-preview')
  const planned=useCompetitorStore.getState().session
  expect(planned.cards.filter(c=>!existing.some(e=>e.id===c.id)).map(c=>c.category)).toEqual([category])
  expect(fetchMock).toHaveBeenCalledTimes(1) // local preview isn't a planning call
  for(let i=0;i<existing.length;i++)expect(JSON.stringify(planned.cards.find(c=>c.id===existing[i].id))).toBe(snapshots[i])
  expect(categoryConfirmed(planned,category)).toBe(false)
  await click('competitor-confirm-category')
  expect(categoryConfirmed(useCompetitorStore.getState().session,category)).toBe(true)
  await click(`competitor-generate-${category}`)
  await until(()=>submit.mock.calls.length===1)
  const task=submit.mock.calls[0][0] as {input:{prompts:string[];inputImages:Array<{dataUrl:string}>}}
  expect(task.input.inputImages.map(i=>i.dataUrl)).toEqual([data('product'),data(`ref-${category}`)])
  expect(task.input.prompts).toHaveLength(1)
  expect(task.input.prompts[0]).toContain(category==='hero'?'主图':category==='detail'?'详情':'选项图')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await until(()=>useCompetitorStore.getState().queuePhase!=='running')
  expect(submit).toHaveBeenCalledTimes(1)
  const after=useCompetitorStore.getState().session
  for(let i=0;i<existing.length;i++)expect(JSON.stringify(after.cards.find(c=>c.id===existing[i].id))).toBe(snapshots[i])
  if(others)for(const other of COMPETITOR_CATEGORIES.filter(c=>c!==category)){
    expect(after.refs.find(r=>r.category===other)?.analysisStatus).toBe('pending')
    expect(categoryConfirmed(after,other)).toBe(true)
  }
 })}}
 it('已有本类分析可零分析请求预览生成；本类改动不撤销其他类确认与成品',async()=>{
  const existing=seed('option')
  useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,refs:useCompetitorStore.getState().session.refs.map(r=>r.category==='option'?{...r,sellingPoint:'旧选项卖点',analysisStatus:'model_suggested'}:r)}})
  const fetchMock=vi.fn(async()=>{throw Error('unexpected provider request')});vi.stubGlobal('fetch',fetchMock)
  await act(async()=>root.render(<CompetitorWorkbench/>));await flush()
  const select=container.querySelector<HTMLSelectElement>('[data-testid="competitor-preview-category"]')!
  await act(async()=>{select.value='option';select.dispatchEvent(new Event('change',{bubbles:true}))})
  await click('competitor-build-preview')
  expect(fetchMock).not.toHaveBeenCalled()
  await click('competitor-confirm-category')
  await click('competitor-generate-option')
  await until(()=>submit.mock.calls.length===1)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(categoryConfirmed(useCompetitorStore.getState().session,'hero')).toBe(true)
  expect(categoryConfirmed(useCompetitorStore.getState().session,'detail')).toBe(true)
  for(const card of existing)expect(useCompetitorStore.getState().session.cards.find(c=>c.id===card.id)).toEqual(card)
  const snapshot=JSON.parse(localStorage.getItem('pdd-competitor-advisor-session')!)
  expect(snapshot.state.session.categoryConfirmations).toEqual({hero:true,detail:true,option:true})
 })
 it('分析进行中锁住跨类生成/预览，失败不清分析与成品、无自动重试',async()=>{
  const existing=seed('hero');let release:()=>void=()=>{}
  const wait=new Promise<void>(resolve=>{release=resolve})
  const fetchMock=vi.fn(async()=>{await wait;return new Response('{}',{status:502})});vi.stubGlobal('fetch',fetchMock)
  await act(async()=>root.render(<CompetitorWorkbench/>));await flush()
  await click('competitor-analyze-hero')
  expect(button('competitor-build-preview').disabled).toBe(true)
  expect(button('competitor-generate-option').disabled).toBe(true)
  await click('competitor-generate-option');await click('competitor-analyze-detail')
  expect(fetchMock).toHaveBeenCalledTimes(1);expect(submit).not.toHaveBeenCalled()
  release();await until(()=>useCompetitorStore.getState().analysisInFlight===null)
  expect(useCompetitorStore.getState().session.cards).toEqual(existing)
  expect(useCompetitorStore.getState().session.lastAnalysisError?.category).toBe('hero')
  expect(fetchMock).toHaveBeenCalledTimes(1)
 })
 it('生成队列持锁时重复点击、跨类生成与分析都不多发请求',async()=>{
  seed('hero')
  vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('must not analyze')}))
  let release:()=>void=()=>{}
  const wait=new Promise<void>(resolve=>{release=resolve})
  submit.mockImplementationOnce(async()=>{await wait;throw Error('intercepted final image failure')})
  await act(async()=>root.render(<CompetitorWorkbench/>));await flush()
  await click('competitor-build-preview');await click('competitor-confirm-category')
  await click('competitor-generate-hero');await until(()=>submit.mock.calls.length===1)
  expect(button('competitor-generate-hero').disabled).toBe(true)
  expect(button('competitor-generate-option').disabled).toBe(true)
  expect(button('competitor-analyze-detail').disabled).toBe(true)
  await click('competitor-generate-hero');await click('competitor-generate-option');await click('competitor-analyze-detail')
  expect(submit).toHaveBeenCalledTimes(1)
  release();await until(()=>useCompetitorStore.getState().queuePhase!=='running')
  expect(submit).toHaveBeenCalledTimes(1)
 })
 it('其他类别历史残留generating状态不冒充活跃请求阻断本类',async()=>{
  seed('hero')
  useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,cards:useCompetitorStore.getState().session.cards.map(c=>({...c,status:'generating'}))},generationInFlight:null})
  vi.stubGlobal('fetch',analysisFetch())
  await act(async()=>root.render(<CompetitorWorkbench/>));await flush()
  expect(button('competitor-analyze-hero').disabled).toBe(false)
  await click('competitor-analyze-hero');await until(()=>useCompetitorStore.getState().analysisInFlight===null)
  await click('competitor-build-preview');await click('competitor-confirm-category')
  await click('competitor-generate-hero');await until(()=>submit.mock.calls.length===1)
  expect(submit).toHaveBeenCalledTimes(1)
 })
 it('选择无图类别不触发全量预览；上传新类别不清其他成品',async()=>{
  const existing=seed('hero',false)
  await act(async()=>root.render(<CompetitorWorkbench/>));await flush()
  const select=container.querySelector<HTMLSelectElement>('[data-testid="competitor-preview-category"]')!
  await act(async()=>{select.value='detail';select.dispatchEvent(new Event('change',{bubbles:true}))})
  expect(button('competitor-build-preview').disabled).toBe(true)
  expect(button('competitor-analyze-detail').disabled).toBe(true)
  expect(submit).not.toHaveBeenCalled()
  await act(async()=>useCompetitorStore.getState().addRefs([ref('option')]))
  expect(useCompetitorStore.getState().session.cards).toEqual(existing)
 })
})
