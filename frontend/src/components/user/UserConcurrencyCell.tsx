/**
 * 用户并发单元格，对应 Vue 版 UserConcurrencyCell.vue：当前并发 / 上限，
 * 满载为 danger、使用中为 warning、空闲为 neutral（Arc badge 色调）。
 */
import { LayoutGrid } from 'lucide-react'

import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import styles from './userCells.module.css'

export interface UserConcurrencyCellProps {
  current: number
  max: number
}

// Status color based on usage
function statusTone(current: number, max: number): BadgeTone {
  // Full: red
  if (current >= max && max > 0) return 'danger'
  // In use: yellow
  if (current > 0) return 'warning'
  // Idle: gray
  return 'neutral'
}

export default function UserConcurrencyCell({ current, max }: UserConcurrencyCellProps) {
  return (
    <Badge size="sm" tone={statusTone(current, max)} icon={<LayoutGrid size={12} strokeWidth={2} aria-hidden="true" />}>
      <span className={styles.concurrency}>
        <span>{current}</span>
        <span className={styles.concurrencySlash}>/</span>
        <span>{max}</span>
      </span>
    </Badge>
  )
}
