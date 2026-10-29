/**
 * 账号今日统计单元格，对应 Vue 版 AccountTodayStatsCell.vue：请求数、Token、账号计费、用户计费。
 */
import { useI18n } from '@/i18n/useI18n'
import type { WindowStats } from '@/types'
import { formatCurrency, formatNumber } from '@/utils/format'
import Skeleton from '@/components/common/Skeleton'
import styles from './AccountTodayStatsCell.module.css'

export interface AccountTodayStatsCellProps {
  stats?: WindowStats | null
  loading?: boolean
  error?: string | null
}

// Format large token numbers (e.g., 1234567 -> 1.23M)
const formatTokens = (tokens: number): string => {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(2)}M`
  } else if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`
  }
  return tokens.toString()
}

export default function AccountTodayStatsCell({ stats = null, loading = false, error = null }: AccountTodayStatsCellProps) {
  const { t } = useI18n()

  // Loading state
  if (loading && !stats) {
    return (
      <div className={styles.skeleton} aria-busy="true">
        <Skeleton width={48} height={12} />
        <Skeleton width={64} height={12} />
        <Skeleton width={40} height={12} />
      </div>
    )
  }

  // Error state
  if (error && !stats) {
    return <div className={styles.error}>{error}</div>
  }

  // No data
  if (!stats) {
    return <div className={styles.empty}>-</div>
  }

  return (
    <div className={styles.stats}>
      {/* Requests */}
      <div className={styles.row}>
        <span className={styles.label}>{t('admin.accounts.stats.requests')}:</span>
        <span className={styles.value}>{formatNumber(stats.requests)}</span>
      </div>
      {/* Tokens */}
      <div className={styles.row}>
        <span className={styles.label}>{t('admin.accounts.stats.tokens')}:</span>
        <span className={styles.value}>{formatTokens(stats.tokens)}</span>
      </div>
      {/* Cost (Account) */}
      <div className={styles.row}>
        <span className={styles.label}>{t('usage.accountBilled')}:</span>
        <span className={`${styles.value} ${styles.cost}`}>{formatCurrency(stats.cost)}</span>
      </div>
      {/* Cost (User/API Key) */}
      {stats.user_cost != null ? (
        <div className={styles.row}>
          <span className={styles.label}>{t('usage.userBilled')}:</span>
          <span className={styles.value}>{formatCurrency(stats.user_cost)}</span>
        </div>
      ) : null}
    </div>
  )
}
