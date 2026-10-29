import { useI18n } from '@/i18n/useI18n'
import styles from './BaseUrlPresets.module.css'
import { GROK_BASE_URL_PRESETS, type GrokBaseUrlPreset } from './credentialsBuilder'

export interface GrokBaseUrlPresetsProps {
  onSelect: (url: string) => void
}

const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '')

// Grok 快捷端点：点击把预设地址填入调用方的输入框。
export default function GrokBaseUrlPresets({ onSelect }: GrokBaseUrlPresetsProps) {
  const { t } = useI18n()

  const presetLabel = (preset: GrokBaseUrlPreset) =>
    preset.label ?? t(`admin.accounts.grokCustomBaseUrl.presets.${preset.labelKey}`)

  return (
    <div className={styles.presets}>
      {GROK_BASE_URL_PRESETS.map((preset) => (
        <button
          key={preset.url}
          type="button"
          data-testid="grok-base-url-preset"
          className={styles.preset}
          onClick={() => onSelect(preset.url)}
        >
          {presetLabel(preset)} ({displayUrl(preset.url)})
        </button>
      ))}
    </div>
  )
}
