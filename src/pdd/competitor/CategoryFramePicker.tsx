import { useState } from 'react'
import type { FrameSpec } from '../types'
import { describeFrame, frameFromPixels, frameFromPreset, frameFromRatio, isPresetRatio } from '../frameSpec'
import { CATEGORY_PRESETS, type CompetitorCategory } from './categories'

interface Props {
  category: CompetitorCategory
  value: FrameSpec
  onChange: (value: FrameSpec) => void
  disabled?: boolean
}

export default function CategoryFramePicker({ category, value, onChange, disabled }: Props) {
  const presets = CATEGORY_PRESETS[category]
  const selectedPreset = value.inputMode === 'preset' ? value.preset : ''
  const isCustom = value.inputMode !== 'preset'
  const [customW, setCustomW] = useState(String(value.width || ''))
  const [customH, setCustomH] = useState(String(value.height || ''))
  const [error, setError] = useState('')

  return (
    <div className="space-y-2" data-testid={`competitor-frame-${category}`}>
      <div className="flex flex-wrap gap-2">
        {presets.map((ratio) => (
          <button
            key={ratio}
            type="button"
            disabled={disabled}
            onClick={() => { if (isPresetRatio(ratio)) onChange(frameFromPreset(ratio)); setError('') }}
            className={`rounded-full px-3 py-1 text-sm ${selectedPreset === ratio && !isCustom ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'border border-gray-200 dark:border-gray-700'}`}
          >
            {ratio}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const parsed = frameFromRatio(customW || '3', customH || '4')
            if (parsed.ok) { onChange(parsed.frame); setError('') }
            else setError(parsed.error)
          }}
          className={`rounded-full px-3 py-1 text-sm ${isCustom ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'border border-gray-200 dark:border-gray-700'}`}
        >
          自定义
        </button>
      </div>
      {isCustom ? (
        <div className="flex flex-wrap items-end gap-2 text-xs text-gray-500">
          <label>宽
            <input className="ml-1 w-16 rounded border border-gray-200 px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={customW} disabled={disabled} onChange={(e) => setCustomW(e.target.value)} />
          </label>
          <label>高
            <input className="ml-1 w-16 rounded border border-gray-200 px-2 py-1 dark:border-gray-700 dark:bg-gray-950" value={customH} disabled={disabled} onChange={(e) => setCustomH(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={disabled}
            className="rounded border border-gray-200 px-2 py-1 dark:border-gray-700"
            onClick={() => {
              const ratio = frameFromRatio(customW, customH)
              if (ratio.ok) { onChange(ratio.frame); setError(''); return }
              const pixels = frameFromPixels(customW, customH)
              if (pixels.ok) { onChange(pixels.frame); setError(''); return }
              setError(ratio.error || pixels.error)
            }}
          >
            应用
          </button>
        </div>
      ) : null}
      <p className="text-[11px] text-gray-400">当前画幅：{describeFrame(value)}</p>
      {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  )
}
