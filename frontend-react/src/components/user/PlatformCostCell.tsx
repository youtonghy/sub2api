/** 单平台用量单元格，对应 Vue 版 PlatformCostCell.vue：今日 / 累计实际费用 */
import type { PlatformUsage } from '@/api/admin/dashboard'
import { useI18n } from '@/i18n/useI18n'
import styles from './userCells.module.css'

export interface PlatformCostCellProps {
  usage?: PlatformUsage
}

export default function PlatformCostCell({ usage }: PlatformCostCellProps) {
  const { t } = useI18n()

  if (!usage) return <span className={styles.muted}>—</span>

  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <span className={styles.label}>{t('admin.users.today')}:</span>
        <span className={styles.value}>${usage.today_actual_cost.toFixed(4)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>{t('admin.users.total')}:</span>
        <span className={styles.value}>${usage.total_actual_cost.toFixed(4)}</span>
      </div>
    </div>
  )
}
