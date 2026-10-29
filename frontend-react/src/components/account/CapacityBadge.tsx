/**
 * 容量计数徽章，对应 Vue 版 CapacityBadge.vue：图标 + 当前值 / 上限 + 可选后缀。
 * Vue 版通过 colorClass 传入 Tailwind 颜色类，这里改为语义色调 tone。
 */
import type { ReactNode } from 'react'

import styles from './miniBadge.module.css'

export type CapacityTone = 'neutral' | 'success' | 'warning' | 'orange' | 'danger'

export interface CapacityBadgeProps {
  tone: CapacityTone
  tooltip?: string
  current: string | number
  max: string | number
  suffix?: string
  /** 前置图标（Vue 版默认插槽） */
  children?: ReactNode
}

export default function CapacityBadge({ tone, tooltip, current, max, suffix, children }: CapacityBadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} title={tooltip || undefined} data-tone={tone}>
      {children}
      <span className={styles.mono}>{current}</span>
      <span className={styles.separator}>/</span>
      <span className={styles.mono}>{max}</span>
      {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
    </span>
  )
}
