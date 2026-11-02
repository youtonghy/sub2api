/**
 * 配额徽章，对应 Vue 版 QuotaBadge.vue：已用 / 上限（美元），≥100% 红色，≥80% 黄色，其余绿色。
 */
import { Banknote } from 'lucide-react'

import { useI18n } from '@/i18n/useI18n'
import type { CapacityTone } from './CapacityBadge'
import styles from './miniBadge.module.css'

export interface QuotaBadgeProps {
  used: number
  limit: number
  /** 文字前缀，如 "D" / "W"；不传时显示 icon */
  label?: string
}

const fmt = (v: number) => v.toFixed(2)

export default function QuotaBadge({ used, limit, label }: QuotaBadgeProps) {
  const { t } = useI18n()
  const tone: CapacityTone = used >= limit ? 'danger' : used >= limit * 0.8 ? 'warning' : 'success'
  const tooltip = used >= limit ? t('admin.accounts.capacity.quota.exceeded') : t('admin.accounts.capacity.quota.normal')

  return (
    <span className={`${styles.badge} ${styles[tone]}`} title={tooltip} data-tone={tone}>
      {label ? <span className={styles.label}>{label}</span> : <Banknote aria-hidden="true" />}
      <span className={styles.mono}>${fmt(used)}</span>
      <span className={styles.separator}>/</span>
      <span className={styles.mono}>${fmt(limit)}</span>
    </span>
  )
}
