/**
 * 多选筛选器，对应 Vue 版 FilterMultiSelect.vue：触发器显示「标签：已选值」，下拉第一项清空为「全部」，
 * 其余选项可多选并显示计数；选择后保持打开以便连续操作。基于 Arc popover（Escape、点击外部关闭）。
 */
import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import { useI18n } from '@/i18n/useI18n'
import { monitorIntlLocale } from './monitorFormat'
import styles from './FilterMultiSelect.module.css'

export interface FilterOption {
  value: string
  label: string
  count?: number
}

export interface FilterMultiSelectProps {
  label: string
  allLabel: string
  /** Vue 版 modelValue */
  value: string[]
  /** Options for this picker (parent may cascade by platform). */
  options: FilterOption[]
  /** Compact trigger for single-row toolbars. */
  compact?: boolean
  /** Vue 版 update:modelValue */
  onChange?: (value: string[]) => void
}

export default function FilterMultiSelect({ label, allLabel, value, options, compact = false, onChange }: FilterMultiSelectProps) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)

  let selectionLabel: string
  if (value.length === 0) selectionLabel = allLabel
  else if (value.length === 1) selectionLabel = options.find((item) => item.value === value[0])?.label || value[0]
  else selectionLabel = t('channelMonitorV2.filters.selectedCount', { count: value.length })

  // Stay open so users can re-select without reopening.
  const clear = () => onChange?.([])

  // Stay open on toggle (multi-select).
  const toggle = (option: string) => {
    const selected = new Set(value)
    if (selected.has(option)) selected.delete(option)
    else selected.add(option)
    onChange?.([...selected])
  }

  const formatCount = (count: number) =>
    Intl.NumberFormat(locale || monitorIntlLocale(), { notation: count >= 10000 ? 'compact' : 'standard' }).format(count)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={styles.trigger}
        data-compact={compact ? '' : undefined}
        aria-haspopup="listbox"
        aria-label={label}
      >
        <span className={styles.value}>{t('channelMonitorV2.filters.labelValue', { label, value: selectionLabel })}</span>
        <ChevronDown size={14} strokeWidth={1.75} className={styles.chevron} data-open={open ? '' : undefined} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className={styles.dropdown} role="listbox" aria-multiselectable="true" aria-label={label}>
        <button type="button" className={[styles.option, styles.allOption].join(' ')} onClick={clear}>
          <span>{allLabel}</span>
          {value.length === 0 ? <Check size={14} strokeWidth={2} className={styles.check} aria-hidden="true" /> : null}
        </button>

        {options.map((option) => {
          const selected = value.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={selected}
              className={styles.option}
              onClick={() => toggle(option.value)}
            >
              <span className={styles.optionMain}>
                <span className={styles.box} data-checked={selected ? '' : undefined} aria-hidden="true">
                  {selected ? <Check size={12} strokeWidth={2.25} /> : null}
                </span>
                <span className={styles.optionLabel}>{option.label}</span>
              </span>
              {option.count != null ? <small className={styles.count}>{formatCount(option.count)}</small> : null}
            </button>
          )
        })}
        {options.length === 0 ? <p className={styles.empty}>{t('channelMonitorV2.filters.empty')}</p> : null}
      </PopoverContent>
    </Popover>
  )
}
