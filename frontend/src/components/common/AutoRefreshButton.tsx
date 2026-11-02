import { Check, RefreshCw } from 'lucide-react'

import { DropdownMenu, type DropdownItem } from '@/components/arc/dropdown-menu/dropdown-menu'
import { useI18n } from '@/i18n/useI18n'
import styles from './AutoRefreshButton.module.css'

export interface AutoRefreshButtonProps {
  enabled: boolean
  intervalSeconds: number
  countdown: number
  intervals: readonly number[]
  /** 切换启用（Vue 版 update:enabled） */
  onEnabledChange?: (value: boolean) => void
  /** 选择刷新间隔（Vue 版 update:interval） */
  onIntervalChange?: (value: number) => void
}

/** 自动刷新开关与间隔选择，对应 Vue 版 AutoRefreshButton.vue，基于 Arc dropdown-menu */
export default function AutoRefreshButton({
  enabled,
  intervalSeconds,
  countdown,
  intervals,
  onEnabledChange,
  onIntervalChange
}: AutoRefreshButtonProps) {
  const { t } = useI18n()
  const check = <Check size={16} strokeWidth={1.75} aria-hidden="true" />
  const blank = <span className={styles.blank} aria-hidden="true" />

  const items: DropdownItem[] = [
    {
      label: t('common.autoRefresh.enable'),
      icon: enabled ? check : blank,
      onSelect: () => onEnabledChange?.(!enabled)
    },
    ...intervals.map((sec, index) => ({
      label: t('common.autoRefresh.seconds', { n: sec }),
      icon: intervalSeconds === sec ? check : blank,
      separatorBefore: index === 0,
      onSelect: () => onIntervalChange?.(sec)
    }))
  ]

  return (
    <DropdownMenu
      label={enabled ? t('common.autoRefresh.countdown', { seconds: countdown }) : t('common.autoRefresh.title')}
      icon={
        <RefreshCw
          className={enabled ? styles.spinning : undefined}
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      }
      items={items}
    />
  )
}
