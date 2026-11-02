import { useI18n } from '@/i18n/useI18n'
import styles from './AccountPriorityCell.module.css'

// 只显示"第几个被使用"的位次，不暴露内部 priority 数值。
// 位次由父级按当前列表顺序（同优先级按 id 兜底）算好后传入，
// 保证与拖动后的视觉顺序始终一致。
export interface AccountPriorityCellProps {
  rank: number
}

export default function AccountPriorityCell({ rank }: AccountPriorityCellProps) {
  const { t } = useI18n()
  return (
    <span className={styles.cell} title={t('admin.accounts.priorityOrderHint')} data-testid="account-priority-cell">
      <span data-testid="account-priority-rank">{rank}</span>
    </span>
  )
}
