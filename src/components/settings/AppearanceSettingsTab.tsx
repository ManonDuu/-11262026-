import type { AppSettings } from '../../types'
import ThemeSelect from '../ThemeSelect'
import FontSettingField from './FontSettingField'

interface AppearanceSettingsTabProps {
  draft: AppSettings
  commitSettings: (nextDraft: AppSettings) => void
}

export default function AppearanceSettingsTab({ draft, commitSettings }: AppearanceSettingsTabProps) {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">颜色</h4>
        <div className="block">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="block text-sm text-gray-600 dark:text-gray-300">颜色模式</span>
            <div className="w-28 shrink-0">
              <ThemeSelect />
            </div>
          </div>
          <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
            与顶部「页面颜色」同步；手动选择后记住，不随系统改变。仅改变界面，不影响图片、生成或导出。
          </div>
        </div>
      </section>
      <section className="space-y-4">
        <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">字体</h4>
        <FontSettingField
          slot="ui"
          label="界面字体"
          description="内置字体为 HarmonyOS Sans SC；选择“系统字体”时使用系统默认的字体。"
          mode={draft.uiFont}
          name={draft.uiFontName}
          onChange={(mode, name) => commitSettings({ ...draft, uiFont: mode, uiFontName: name })}
        />
        <FontSettingField
          slot="mono"
          label="代码字体"
          description="内置字体为 Maple Mono NF CN，用于代码块。"
          mode={draft.monoFont}
          name={draft.monoFontName}
          onChange={(mode, name) => commitSettings({ ...draft, monoFont: mode, monoFontName: name })}
        />
      </section>
    </div>
  )
}
