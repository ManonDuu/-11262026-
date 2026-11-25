import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const CSS = readFileSync('src/index.css', 'utf8')
import WORKBENCH from '../src/pdd/competitor/CompetitorWorkbench.tsx?raw'
import colors from 'tailwindcss/colors'
function luminance(hex:string){const rgb=hex.replace('#','').match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722}
function contrast(a:string,b:string){const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05)}
describe('视觉验收回归：真实zinc色板／状态',()=>{
 it('辅助文字使用不透明13px以上色值，浅深代表表面均达到4.5:1',()=>{
  const light=CSS.match(/\.workbench-help\s*\{[^}]*color:\s*(#[a-f0-9]+)/i)![1]
  const dark=CSS.match(/\.dark \.workbench-help\s*\{[^}]*color:\s*(#[a-f0-9]+)/i)![1]
  expect(light).toBe(colors.zinc[600]);expect(dark).toBe(colors.zinc[300])
  for(const background of ['#ffffff',colors.zinc[50],colors.zinc[100]])expect(contrast(light,background)).toBeGreaterThanOrEqual(4.5)
  for(const background of [colors.zinc[900],colors.zinc[800]])expect(contrast(dark,background)).toBeGreaterThanOrEqual(4.5)
  expect(CSS).toContain('font-size: 0.8125rem')
 })
 it('本地预览为暗色面而非白底，维持真实disabled',()=>{
  const button=WORKBENCH.split('data-testid="competitor-build-preview"')[1].split('</button>')[0]
  expect(button).toContain('dark:bg-gray-800');expect(button).toContain('dark:text-gray-100');expect(button).not.toContain('dark:bg-gray-100')
  expect(button).toContain('disabled={');expect(contrast(colors.zinc[100],colors.zinc[800])).toBeGreaterThanOrEqual(4.5)
 })
 it('自有favicon是小型16px ICO，含真实PNG负载',()=>{
  const bytes=readFileSync('public/favicon.ico');expect(bytes.length).toBeLessThan(512)
  expect([...bytes.subarray(0,6)]).toEqual([0,0,1,0,1,0]);expect(bytes[6]).toBe(16)
  expect([...bytes.subarray(22,30)]).toEqual([137,80,78,71,13,10,26,10])
 })
})
