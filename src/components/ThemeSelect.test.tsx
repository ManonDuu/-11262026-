// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Header from './Header'
import ThemeSelect from './ThemeSelect'
import AppearanceSettingsTab from './settings/AppearanceSettingsTab'
import Workbench from '../pdd/Workbench'
import CompetitorWorkbench from '../pdd/competitor/CompetitorWorkbench'
import TaskGrid from './TaskGrid'
import { useColorMode } from '../hooks/useColorMode'
import { useWorkbenchView, setWorkbenchView } from '../pdd/workbenchView'
import { useStore } from '../store'
import { usePddStore } from '../pdd/store'
import { useCompetitorStore } from '../pdd/competitor/store'
import { DEFAULT_SETTINGS } from '../lib/apiProfiles'
import { COLOR_MODE_KEY, readPageColorMode, getPageColorMode, setPageColorMode } from '../lib/colorMode'
import SCRIPT from '../../public/color-mode.js?raw'

vi.mock('./FavoriteCollections', () => ({ useFavoriteCollectionTitle: () => '' }))
vi.mock('../lib/db', () => ({getImage:vi.fn(), getImageThumbnail:vi.fn(),getImageDimensions:vi.fn(),getFreshThumbnailIds:vi.fn(async()=>[])}))

function MountedWorkbench() {
  useColorMode()
  const [view] = useWorkbenchView()
  return <><Header /><main data-testid={`mounted-${view}`}>{view === 'pdd' ? <Workbench /> : view === 'competitor' ? <CompetitorWorkbench /> : <TaskGrid />}</main>{createPortal(<div role="dialog" className="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">主题弹窗验证</div>, document.body)}</>
}

describe('全局手动页面颜色', () => {
  let root:Root, container:HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,media:'',addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})))
    vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}})
    localStorage.clear();setPageColorMode('light')
    useStore.setState({settings:{...DEFAULT_SETTINGS,uiFont:'system',monoFont:'system'},tasks:[],appMode:'gallery',agentConversations:[],filterFavorite:false,activeFavoriteCollectionId:null})
    usePddStore.setState({session:{...usePddStore.getState().session,cards:[]}})
    useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,cards:[],refs:[],productAssets:[],optionSlots:[]},queuePhase:'idle',analysisInFlight:null,generationInFlight:null})
    setWorkbenchView('pdd')
    container=document.createElement('div');document.body.appendChild(container);root=createRoot(container)
  })
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();setPageColorMode('light');localStorage.clear()})
  async function render(node:React.ReactNode){await act(async()=>root.render(node))}
  async function choose(value:'light'|'dark'){
    const select=container.querySelector<HTMLSelectElement>('select[aria-label="页面颜色"]')!
    await act(async()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}))})
    return select
  }
  it('公共顶部原生选择器可聚焦，有浅/深语义且跨三模块和body弹窗生效',async()=>{
    await render(<MountedWorkbench />)
    let select=await choose('dark');select.focus()
    expect(document.activeElement).toBe(select)
    expect(Array.from(select.options).map(o=>[o.value,o.text])).toEqual([['light','浅色'],['dark','深色']])
    expect(select.disabled).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.querySelector('[role="dialog"]')?.closest('html')).toBe(document.documentElement)
    for(const view of ['free','competitor','pdd']){
      await act(async()=>container.querySelector<HTMLButtonElement>(`[data-testid="workbench-view-${view}"]`)!.click())
      expect(container.querySelector(`[data-testid="mounted-${view}"]`)).not.toBeNull()
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(container.querySelector<HTMLSelectElement>('select[aria-label="页面颜色"]')?.value).toBe('dark')
    }
    await choose('light');expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
  it('只写独立主题key，不改模型设置、用户草稿/历史/成品，图片像素属性不变',async()=>{
    const storeBefore=useStore.getState(),competitorBefore=useCompetitorStore.getState().session,pddBefore=usePddStore.getState().session
    const sentinel='private fixture: do not modify';localStorage.setItem('unrelated-history',sentinel)
    await render(<><ThemeSelect /><img src="data:image/png;base64,fixture" alt="原图" style={{width:30}} /></>)
    const image=container.querySelector('img')!,before=image.outerHTML
    await choose('dark')
    expect(image.outerHTML).toBe(before)
    expect(useStore.getState()).toBe(storeBefore)
    expect(useCompetitorStore.getState().session).toBe(competitorBefore)
    expect(usePddStore.getState().session).toBe(pddBefore)
    expect(localStorage.getItem('unrelated-history')).toBe(sentinel)
    expect(localStorage.getItem(COLOR_MODE_KEY)).toBe('dark')
  })
  it('刷新bootstrap和组件重新挂载保留深色，系统事件不会覆盖手选',async()=>{
    await render(<ThemeSelect />);await choose('dark')
    await render(<></>);document.documentElement.classList.remove('dark')
    new Function('localStorage','document',SCRIPT)(localStorage,document)
    await render(<ThemeSelect />)
    expect(readPageColorMode()).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(container.querySelector<HTMLSelectElement>('select')?.value).toBe('dark')
    await act(async()=>window.dispatchEvent(new Event('change')))
    expect(getPageColorMode()).toBe('dark')
  })
  it('外观设置与顶部同一主题源，不写旧settings.colorMode',async()=>{
    const commit=vi.fn()
    await render(<AppearanceSettingsTab draft={DEFAULT_SETTINGS} commitSettings={commit}/>)
    await choose('dark')
    expect(commit).not.toHaveBeenCalled()
    expect(getPageColorMode()).toBe('dark')
    expect(container.textContent).toContain('仅改变界面')
  })
  it('无存储/非法值默认浅色，读取或写入受限仍可在当前页面切换',async()=>{
    localStorage.removeItem(COLOR_MODE_KEY);expect(readPageColorMode()).toBe('light')
    localStorage.setItem(COLOR_MODE_KEY,'bogus');expect(readPageColorMode()).toBe('light')
    const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('unavailable')})
    expect(readPageColorMode()).toBe('light');read.mockRestore()
    await render(<ThemeSelect />)
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')})
    await choose('dark')
    expect(getPageColorMode()).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
  it('只响应主题key跨窗口变化，不读取或覆盖其他设置',async()=>{
    await render(<ThemeSelect />)
    await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:'unrelated',newValue:'dark'})))
    expect(getPageColorMode()).toBe('light')
    await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:COLOR_MODE_KEY,newValue:'dark'})))
    expect(container.querySelector<HTMLSelectElement>('select')?.value).toBe('dark')
    await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:COLOR_MODE_KEY,newValue:'invalid'})))
    expect(getPageColorMode()).toBe('light')
  })
})
