// Deterministic, wholly synthetic PNGs. No personal images or paid output fixtures.
import { zlibSync } from 'fflate'
function u32(value: number) { return new Uint8Array([value >>> 24, value >>> 16, value >>> 8, value]) }
function crc(bytes: Uint8Array) {
  let value = 0xffffffff
  for (const byte of bytes) { value ^= byte; for (let n=0;n<8;n++) value=(value>>>1)^((value&1)?0xedb88320:0) }
  return (value^0xffffffff)>>>0
}
function join(parts: Uint8Array[]) { const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length}return out }
function chunk(type: string, bytes: Uint8Array) { const payload=join([new TextEncoder().encode(type),bytes]);return join([u32(bytes.length),payload,u32(crc(payload))]) }
const cache=new Map<string,Uint8Array>()
export function syntheticResultPng(name: string) {
  const existing=cache.get(name);if(existing)return existing
  const width=1254,height=1254,raw=new Uint8Array((width*4+1)*height),blue=name.includes('2')
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const n=y*(width*4+1)+1+x*4;raw.set(blue?[30,70,200,255]:[30,170,80,255],n)}
  const result=join([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',join([u32(width),u32(height),new Uint8Array([8,6,0,0,0])])),chunk('IDAT',zlibSync(raw)),chunk('IEND',new Uint8Array())]);cache.set(name,result);return result
}
