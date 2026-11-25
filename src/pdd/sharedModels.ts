import { getActiveApiProfile } from '../lib/apiProfiles'
import type { AppSettings } from '../types'
import { usePddStore } from './store'
import type { DetectedModels } from './types'

export interface SharedApiConnectionStatus {
  configured: boolean
  hasBaseUrl: boolean
  hasKey: boolean
  baseUrlHost: string
}

export interface SharedWorkbenchModels {
  planningModel: string
  imageModel: string
  detected: DetectedModels | null
}

export function describeApiHost(baseUrl: string): string {
  const value = baseUrl.trim()
  if (!value) return ''
  try {
    return new URL(value).host || value
  } catch {
    return value
  }
}

/** 只描述本机反代是否已配置，绝不返回或打印 API Key。 */
export function getSharedApiConnectionStatus(settings: Partial<AppSettings> | unknown): SharedApiConnectionStatus {
  const profile = getActiveApiProfile(settings)
  const baseUrl = profile.baseUrl?.trim() || ''
  const hasKey = Boolean(profile.apiKey?.trim())
  return {
    hasBaseUrl: Boolean(baseUrl),
    hasKey,
    configured: Boolean(baseUrl && hasKey),
    baseUrlHost: describeApiHost(baseUrl),
  }
}

export function getSharedWorkbenchModels(): SharedWorkbenchModels {
  const state = usePddStore.getState()
  return {
    planningModel: state.planningModel || '',
    imageModel: state.imageModel || '',
    detected: state.detected,
  }
}

export function setSharedWorkbenchModels(planning?: string, image?: string): void {
  usePddStore.getState().setModels(planning, image)
}

export function setSharedDetectedModels(detected: DetectedModels | null): void {
  usePddStore.getState().setDetected(detected)
}

export function resolveSharedPlanningModel(fallback = ''): string {
  return getSharedWorkbenchModels().planningModel || fallback
}

export function resolveSharedImageModel(fallback = ''): string {
  return getSharedWorkbenchModels().imageModel || fallback
}
