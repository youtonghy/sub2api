import styles from './BaseUrlPresets.module.css'
import { CN_BASE_URL_PRESETS, type CnBaseUrlPreset } from './credentialsBuilder'

export interface CnBaseUrlPresetsProps {
  platform: 'kimi' | 'zhipu' | 'deepseek' | 'minimax'
  /** 当前已选账号类型，用于过滤和高亮匹配的预设 */
  mode?: 'payg' | 'coding'
  /** 当前已选 API 协议，用于过滤和高亮匹配的预设 */
  protocol?: 'adaptive' | 'chat_completions' | 'anthropic' | 'responses'
  /** 当前输入框中的 base url，用于高亮完全匹配项 */
  currentUrl?: string
  onSelect: (preset: CnBaseUrlPreset) => void
}

const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '')

/** 国产模型平台的 Base URL 快捷预设 */
export default function CnBaseUrlPresets({ platform, mode, protocol, currentUrl, onSelect }: CnBaseUrlPresetsProps) {
  const all = CN_BASE_URL_PRESETS[platform] ?? []
  // 只按协议过滤：同协议下 payg/coding 两档都展示，点击即同时切换账号类型。
  const presets = protocol == null ? all : all.filter((p) => p.protocol === protocol)

  const isActive = (preset: CnBaseUrlPreset) => (mode != null && preset.mode === mode) || preset.url === currentUrl

  return (
    <div className={styles.presets}>
      {presets.map((preset) => (
        <button
          key={preset.mode + ':' + preset.protocol + ':' + preset.url}
          type="button"
          data-testid="cn-base-url-preset"
          className={styles.preset}
          data-active={isActive(preset) ? 'true' : undefined}
          onClick={() => onSelect(preset)}
        >
          {preset.label} ({displayUrl(preset.url)})
        </button>
      ))}
    </div>
  )
}
