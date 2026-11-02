import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useI18n } from '@/i18n/useI18n'
import type { UserBreakdownItem } from '@/types'
import { formatCost, formatTokens } from './chartUtils'
import styles from './charts.module.css'

export interface UserBreakdownSubTableProps {
  items: UserBreakdownItem[]
  loading?: boolean
  /** 是否显示账号成本列（用户侧用量接口不返回 account_cost） */
  showAccountCost?: boolean
}

/** 分布图中某一行展开后的用户明细，嵌在父表格的跨列单元格内 */
export default function UserBreakdownSubTable({ items, loading = false, showAccountCost = true }: UserBreakdownSubTableProps) {
  const { t } = useI18n()

  return (
    <div className={styles.breakdown}>
      {loading ? (
        <div className={styles.breakdownLoading}>
          <Skeleton lines={2} label={t('common.loading')} />
        </div>
      ) : items.length === 0 ? (
        <p className={styles.breakdownMessage}>{t('admin.dashboard.noDataAvailable')}</p>
      ) : (
        <table className={styles.table}>
          <tbody>
            {items.map((user) => (
              <tr key={user.user_id}>
                <td title={user.email}>{user.email || `User #${user.user_id}`}</td>
                <td>{user.requests.toLocaleString()}</td>
                <td>{formatTokens(user.total_tokens)}</td>
                <td className={styles.actual}>${formatCost(user.actual_cost)}</td>
                {showAccountCost && <td className={styles.accountCost}>${formatCost(user.account_cost)}</td>}
                <td className={styles.standard}>${formatCost(user.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
