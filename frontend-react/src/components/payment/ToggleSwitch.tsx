import { Switch } from '@/components/arc/switch/switch'
import styles from './ToggleSwitch.module.css'

export interface ToggleSwitchProps {
  label: string
  checked: boolean
  /** 点击开关（Vue 版 toggle 事件），由父组件翻转状态 */
  onToggle?: () => void
}

/** 紧凑开关：标签在上、开关在下，对应 Vue 版 ToggleSwitch.vue；基于 Arc switch（role="switch"） */
export default function ToggleSwitch({ label, checked, onToggle }: ToggleSwitchProps) {
  return (
    <div className={styles.toggle}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={() => onToggle?.()} aria-label={label} />
    </div>
  )
}
