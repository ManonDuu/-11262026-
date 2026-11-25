import type { CollectorJobPublic, CollectorRuntimeInfo } from './types'
import { planCaptureIngest, importCaptureImageAssets, attachImportedAssets, captureAssetName } from '../captureIngest'
import { makeRefImage, useCompetitorStore } from '../store'
import type { CaptureImagePayload } from '../captureProtocol'

const PREFIX = '/__competitor-capture'

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(text || `采集接口返回无效（HTTP ${response.status}）`)
  }
}

export async function fetchCollectorRuntime(): Promise<CollectorRuntimeInfo> {
  try {
    const response = await fetch(`${PREFIX}/runtime`, { headers: { Accept: 'application/json' } })
    if (!response.ok) {
      return { ready: false, playwrightVersion: '', chromiumRevision: '', message: '工作台采集服务尚未加载，请刷新或重启本机工作台后再试。' }
    }
    return await readJson<CollectorRuntimeInfo>(response)
  } catch {
    return { ready: false, playwrightVersion: '', chromiumRevision: '', message: '无法连接到本机采集服务。请确认工作台地址是 http://127.0.0.1:5173/ 并已重启。' }
  }
}

export async function startCollectorJob(input: { goodsId?: string; canonicalUrl: string; navigationUrl?: string; entryKind?: CollectorJobPublic['entryKind'] }): Promise<CollectorJobPublic> {
  const response = await fetch(`${PREFIX}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readJson<CollectorJobPublic & { error?: string }>(response)
  if (!response.ok) throw new Error(data.error || data.message || '无法开始采集')
  return data
}

export async function fetchCollectorJob(jobId: string): Promise<CollectorJobPublic> {
  const response = await fetch(`${PREFIX}/job/${encodeURIComponent(jobId)}`, { headers: { Accept: 'application/json' } })
  const data = await readJson<CollectorJobPublic & { error?: string }>(response)
  if (!response.ok) throw new Error(data.error || data.message || '无法读取采集进度')
  return data
}

export async function continueCollectorJob(jobId: string): Promise<CollectorJobPublic> {
  const response = await fetch(`${PREFIX}/job/${encodeURIComponent(jobId)}/continue`, { method: 'POST', headers: { Accept: 'application/json' } })
  const data = await readJson<CollectorJobPublic & { error?: string }>(response)
  if (!response.ok) throw new Error(data.error || data.message || '无法继续采集')
  return data
}

export async function cancelCollectorJob(jobId: string): Promise<CollectorJobPublic> {
  const response = await fetch(`${PREFIX}/job/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', headers: { Accept: 'application/json' } })
  const data = await readJson<CollectorJobPublic & { error?: string }>(response)
  if (!response.ok) throw new Error(data.error || data.message || '无法取消采集')
  return data
}

export async function fetchCollectorImage(jobId: string, imageId: string): Promise<Blob> {
  const response = await fetch(`${PREFIX}/job/${encodeURIComponent(jobId)}/image/${encodeURIComponent(imageId)}`)
  if (!response.ok) throw new Error('无法读取采集到的图片')
  return response.blob()
}

export async function ingestCollectorJob(job: CollectorJobPublic): Promise<{ message: string; status: string }> {
  const assetsByPayloadId: Record<string, Awaited<ReturnType<typeof importCaptureImageAssets>>['assetsByPayloadId'][string]> = {}
  const payloads: CaptureImagePayload[] = []
  for (const image of job.images) {
    let blob: Blob | null = null
    if (image.bytesStatus === 'ok') {
      try {
        blob = await fetchCollectorImage(job.id, image.id)
      } catch {
        blob = null
      }
    }
    payloads.push({
      ...image,
      blob,
      bytesStatus: blob ? 'ok' : (image.bytesStatus === 'ok' ? 'unavailable' : image.bytesStatus),
    })
  }
  const imported = await importCaptureImageAssets(payloads)
  Object.assign(assetsByPayloadId, imported.assetsByPayloadId)
  const withAssets = attachImportedAssets(payloads, assetsByPayloadId)
  const state = useCompetitorStore.getState()
  const plan = planCaptureIngest({
    goodsId: job.goodsId,
    images: withAssets,
    options: job.options.map((item) => ({ optionName: item.optionName, contentsNote: item.contentsNote, imageId: item.imageId })),
    message: job.message,
  }, {
    goodsId: state.session.goodsId,
    refs: state.session.refs,
    optionSlots: state.session.optionSlots,
  })
  const refs = plan.refsToAdd
    .filter((item) => !item.skipped && item.asset)
    .map((item) => makeRefImage({
      category: item.category,
      asset: { ...item.asset!, name: captureAssetName(item.sourceKey, item.asset!.name) },
      optionName: item.optionName,
      contentsNote: item.contentsNote,
      source: 'link_capture',
    }))
  useCompetitorStore.getState().commitCapturePlan(plan, refs)
  return { message: plan.message, status: plan.captureStatus }
}


export async function fetchCollectorLastStatus(): Promise<{ diagnosticText: string } & Record<string, unknown>> {
  const response = await fetch(`${PREFIX}/last-status`, { headers: { Accept: 'application/json' } })
  const data = await readJson<{ diagnosticText?: string; error?: string } & Record<string, unknown>>(response)
  if (!response.ok || !data.diagnosticText) throw new Error(data.error || '还没有可复制的诊断信息')
  return { ...data, diagnosticText: data.diagnosticText }
}
