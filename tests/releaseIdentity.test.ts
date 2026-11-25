import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
const source=readFileSync('public/sw.js','utf8')
function worker(){
 const handlers=new Map<string,(event:any)=>void>(),removed:string[]=[],opened:string[]=[]
 const keys=['unrelated-cache','gpt-image-playground-v0.9.5','pdd-image-workbench-02-v1.9.0','pdd-image-workbench-02-v2.0.0']
 runInNewContext(source,{URL,self:{registration:{scope:'https://example.invalid/app/'},location:{origin:'https://example.invalid'},addEventListener:(name:string,fn:any)=>handlers.set(name,fn),skipWaiting:vi.fn(),clients:{claim:vi.fn(async()=>{})}},caches:{keys:async()=>keys,delete:async(key:string)=>{removed.push(key);return true},open:async(key:string)=>{opened.push(key);return{addAll:async()=>{}}}}})
 return{handlers,removed,opened}
}
describe('02版独立发布标识与缓存边界',()=>{
 it('包／页面／PWA都有清晰02版标识',()=>{
  const pkg=JSON.parse(readFileSync('package.json','utf8')),manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'))
  expect(pkg.version).toBe('2.0.0');expect(pkg.name).toBe('pdd-image-workbench-02');expect(manifest.name).toBe('拼多多工作台02版');expect(readFileSync('index.html','utf8')).toContain('拼多多工作台02版')
 })
 it('只升级本版命名空间缓存，不删除旧版或同来源其他应用缓存',async()=>{
  const w=worker();let pending:Promise<unknown>|undefined
  w.handlers.get('install')!({waitUntil:(p:Promise<unknown>)=>{pending=p}});await pending
  expect(w.opened).toEqual(['pdd-image-workbench-02-v2.0.0'])
  w.handlers.get('activate')!({waitUntil:(p:Promise<unknown>)=>{pending=p}});await pending
  expect(w.removed).toEqual(['pdd-image-workbench-02-v1.9.0'])
 })
 it('模型POST／模型列表GET和站外请求不由静态缓存接管',()=>{
  const w=worker(),respondWith=vi.fn()
  for(const request of [{method:'POST',url:'https://example.invalid/app/v1/images/edits'},{method:'GET',url:'https://example.invalid/app/v1/models'},{method:'GET',url:'https://provider.invalid/result.png'}])w.handlers.get('fetch')!({request,respondWith})
  expect(respondWith).not.toHaveBeenCalled()
 })
 it('Git发布保留Windows批处理原字节，避免manifest提交后失配',()=>{
  const attributes=readFileSync('.gitattributes','utf8'),batch=readFileSync('start-win.bat','utf8')
  expect(attributes.split(/\r?\n/)).toContain('*.bat -text')
  expect(batch).toContain('\r\n')
  expect((batch.match(/\r\n/g)||[]).length).toBe((batch.match(/\n/g)||[]).length)
 })

})
