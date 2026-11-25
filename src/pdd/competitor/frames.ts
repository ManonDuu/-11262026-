import type { AspectRatio, FrameSpec } from '../types'
import { frameFromPreset, frameFromRatio, isPresetRatio, simplifyRatio } from '../frameSpec'
import { CATEGORY_DEFAULT_PRESET, type CompetitorCategory } from './categories'

export function defaultFrameForCategory(category: CompetitorCategory, sourceWidth?: number, sourceHeight?: number): FrameSpec {
  if (category === 'option' && sourceWidth && sourceHeight && sourceWidth > 0 && sourceHeight > 0) {
    const simplified = simplifyRatio(sourceWidth, sourceHeight)
    const parsed = frameFromRatio(simplified.width, simplified.height)
    if (parsed.ok) return parsed.frame
  }
  const preset = CATEGORY_DEFAULT_PRESET[category]
  if (isPresetRatio(preset)) return frameFromPreset(preset)
  return frameFromPreset('1:1')
}

export function presetOrKeep(category: CompetitorCategory, value: string, current: FrameSpec): FrameSpec | { error: string } {
  if (!isPresetRatio(value)) return { error: '不支持的预设比例' }
  const allowed = category === 'hero' ? ['1:1', '3:4'] : category === 'detail' ? ['3:4', '9:16'] : ['1:1', '3:4']
  if (!allowed.includes(value) && value !== current.preset) {
    // 仍允许用户选列出的预设；自定义走 ratio/pixels
  }
  void current
  return frameFromPreset(value as AspectRatio)
}
