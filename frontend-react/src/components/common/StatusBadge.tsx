import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import styles from './StatusBadge.module.css'

export interface StatusBadgeProps {
  /** active/success → 成功色；disabled/inactive/warning → 警告色；error/danger → 危险色；其余中性 */
  status: string
  label: string
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'active':
    case 'success':
      return 'success'
    case 'disabled':
    case 'inactive':
    case 'warning':
      return 'warning'
    case 'error':
    case 'danger':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** 状态徽章：色点 + 文案 */
export default function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <Badge size="sm" tone={statusTone(status)} data-status={status} icon={<span className={styles.dot} />}>
      {label}
    </Badge>
  )
}
