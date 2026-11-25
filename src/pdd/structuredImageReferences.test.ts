// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store'
import { usePddStore } from './store'
import { useCompetitorStore } from './competitor/store'
import { getReferencedImageIds, registerImageReferenceSource, structuredWorkbenchImageIds } from '../lib/imageReferences'
describe('structured store ownership registrations',()=>{
 beforeEach(()=>{localStorage.clear();usePddStore.setState({session:{...usePddStore.getState().session,assets:[],cards:[]}});useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,refs:[],productAssets:[],cards:[]}});useStore.setState({tasks:[],inputImages:[],galleryInputDraft:null,agentInputDrafts:{},agentConversations:[],privacyMode:null})})
 it('suite store registers live asset metadata even before async blob hydration',()=>{
  usePddStore.setState({session:{...usePddStore.getState().session,assets:[{id:'logical',imageId:'stored',name:'synthetic.png'}]}})
  expect(getReferencedImageIds(useStore.getState())).toEqual(new Set(['logical','stored']))
  usePddStore.setState({session:{...usePddStore.getState().session,assets:[]}})
  expect(getReferencedImageIds(useStore.getState()).size).toBe(0)
 })
 it('competitor store registers product assets and generated results without requiring free task ownership',()=>{
  useCompetitorStore.setState({session:{...useCompetitorStore.getState().session,productAssets:[{id:'own',imageId:'own-image',name:'synthetic.png'}]}})
  const ids=structuredWorkbenchImageIds({refs:[{asset:{id:'ref',imageId:'ref-image'}}],cards:[{resultImageId:'output'}]})
  expect(ids).toEqual(new Set(['ref','ref-image','output']))
  expect(getReferencedImageIds(useStore.getState())).toEqual(new Set(['own','own-image']))
 })
 it('a failing reference source fails closed rather than declaring its images orphaned',()=>{
  const dispose=registerImageReferenceSource('unavailable',()=>{throw Error('metadata unavailable')})
  try {expect(()=>getReferencedImageIds(useStore.getState())).toThrow('metadata unavailable')} finally {dispose()}
 })
})
