import { Switch } from '@/components/arc/switch/switch'

export interface ToggleProps {
  /** 是否开启（Vue 版 modelValue） */
  value: boolean
  onChange?: (value: boolean) => void
  disabled?: boolean
  /** 可见标签；不传时请提供 aria-label */
  label?: string
  id?: string
  'aria-label'?: string
  className?: string
}

/** 开关，对应 Vue 版 Toggle.vue，基于 Arc switch（role="switch"、aria-checked） */
export default function Toggle({ value, onChange, disabled, label, id, className, 'aria-label': ariaLabel }: ToggleProps) {
  return (
    <Switch
      id={id}
      checked={value}
      onCheckedChange={(next) => onChange?.(next)}
      disabled={disabled}
      label={label}
      aria-label={ariaLabel}
      className={className}
    />
  )
}
