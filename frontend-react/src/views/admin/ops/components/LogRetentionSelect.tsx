import { useState } from 'react'

import arcInputStyles from '@/components/arc/input/input.module.css'
import Select, { type SelectValue } from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import styles from './LogRetentionSelect.module.css'

export interface LogRetentionSelectProps {
  /** 保留天数（Vue 版 modelValue） */
  value: number
  onChange?: (value: number) => void
  label: string
  allowForever?: boolean
  className?: string
}

const presets = [1, 3, 7, 14, 30, 60, 90, 180, 365]

export default function LogRetentionSelect({ value, onChange, label, allowForever = false, className }: LogRetentionSelectProps) {
  const { t } = useI18n()
  const [custom, setCustom] = useState(false)

  const options = [
    ...(allowForever ? [{ value: 0, label: t('admin.ops.systemLogs.retentionForever') }] : []),
    ...presets.map((days) => ({ value: days, label: t('admin.ops.systemLogs.retentionDaysOption', { days }) })),
    { value: 'custom', label: t('admin.ops.systemLogs.retentionDaysCustom') }
  ]
  const selection: number | 'custom' =
    custom || !(presets.includes(value) || (allowForever && value === 0)) ? 'custom' : value

  const select = (next: SelectValue) => {
    setCustom(next === 'custom')
    if (typeof next === 'number') onChange?.(next)
  }

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <Select value={selection} options={options} aria-label={label} onChange={select} />
      {selection === 'custom' && (
        <input
          value={Number.isFinite(value) ? value : ''}
          type="number"
          min={1}
          max={3650}
          step={1}
          className={arcInputStyles.input}
          aria-label={`${label}: ${t('admin.ops.systemLogs.retentionDaysCustom')}`}
          onChange={(event) => onChange?.(event.target.valueAsNumber)}
        />
      )}
    </div>
  )
}
