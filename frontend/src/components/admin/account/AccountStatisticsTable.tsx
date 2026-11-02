/**
 * 账号统计视图，对应 Vue 版 AccountStatisticsTable.vue：
 * 按账号展示今日 Token、标准费用、真实费用（标准费用 × 上游声明倍率）、缓存命中率、在线率与首 Token 等待。
 * 只列出有消耗的账号。
 */
import { Alert } from '@/components/arc/alert/alert'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import type { AccountHourlyFailureBucket } from '@/api/admin/ops'
import type { Account, WindowStats } from '@/types'
import { formatCurrency, formatNumber } from '@/utils/format'
import styles from './AccountStatisticsTable.module.css'

export interface AccountStatisticsTableProps {
  accounts: Account[]
  statsByAccount: Record<string, WindowStats>
  failuresByAccount: Record<string, AccountHourlyFailureBucket[]>
  loading?: boolean
  error?: string | null
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function upstreamDeclaredRate(account: Account): number {
  const data = account.extra?.upstream_billing_probe?.data
  const effective = data?.effective_rate_multiplier
  if (typeof effective === 'number' && Number.isFinite(effective) && effective >= 0) return effective
  const resolved = data?.resolved_rate_multiplier
  if (typeof resolved === 'number' && Number.isFinite(resolved) && resolved >= 0) return resolved
  return 1
}

function realCost(account: Account, stats?: WindowStats): number {
  return (stats?.standard_cost ?? 0) * upstreamDeclaredRate(account)
}

function cacheHitRate(stats?: WindowStats): string {
  if (!stats) return '-'
  const inputTokens = stats.input_tokens ?? 0
  const cacheReadTokens = stats.cache_read_tokens ?? 0
  const eligibleTokens = inputTokens + cacheReadTokens
  return eligibleTokens > 0 ? formatPercent((cacheReadTokens / eligibleTokens) * 100) : '-'
}

function formatTTFT(stats?: WindowStats): string {
  const value = stats?.average_first_token_ms ?? 0
  if (value <= 0) return '-'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}s`
  return `${Math.round(value)}ms`
}

export default function AccountStatisticsTable({
  accounts,
  statsByAccount,
  failuresByAccount,
  loading = false,
  error = null
}: AccountStatisticsTableProps) {
  const { t } = useI18n()

  const statsFor = (accountID: number): WindowStats | undefined => statsByAccount[String(accountID)]

  const hasConsumption = (account: Account): boolean => {
    const stats = statsFor(account.id)
    if (!stats) return false
    return (stats.requests ?? 0) > 0 || (stats.tokens ?? 0) > 0 || (stats.standard_cost ?? 0) > 0 || (stats.cost ?? 0) > 0
  }

  const onlineRate = (accountID: number): string => {
    const buckets = failuresByAccount[String(accountID)] ?? []
    const totals = buckets.reduce(
      (result, bucket) => {
        result.requests += bucket.request_count
        result.failures += bucket.failure_count
        return result
      },
      { requests: 0, failures: 0 }
    )
    if (totals.requests === 0) return '-'
    return formatPercent(((totals.requests - totals.failures) / totals.requests) * 100)
  }

  const consuming = accounts.filter(hasConsumption)

  return (
    <div className={styles.root}>
      {error && (
        <div className={styles.error}>
          <Alert tone="danger" title={error} />
        </div>
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('admin.accounts.statistics.account')}</th>
            <th data-align="right">{t('admin.accounts.statistics.tokens')}</th>
            <th data-align="right">{t('admin.accounts.statistics.standardCost')}</th>
            <th data-align="right">{t('admin.accounts.statistics.realCost')}</th>
            <th data-align="right">{t('admin.accounts.statistics.cacheHitRate')}</th>
            <th data-align="right">{t('admin.accounts.statistics.onlineRate')}</th>
            <th data-align="right">{t('admin.accounts.statistics.firstTokenWait')}</th>
          </tr>
        </thead>
        <tbody>
          {loading && accounts.length === 0 ? (
            Array.from({ length: 5 }, (_, index) => (
              <tr key={index}>
                {Array.from({ length: 7 }, (__, cell) => (
                  <td key={cell}>
                    <Skeleton height={16} />
                  </td>
                ))}
              </tr>
            ))
          ) : accounts.length === 0 ? (
            <tr>
              <td colSpan={7} className={styles.empty}>
                {t('common.noData')}
              </td>
            </tr>
          ) : (
            <>
              {consuming.map((account) => {
                const stats = statsFor(account.id)
                return (
                  <tr key={account.id} data-statistics-account-id={account.id}>
                    <td>
                      <div className={styles.name} title={account.name}>
                        {account.name}
                      </div>
                      <div className={styles.meta}>
                        {account.platform} · #{account.id}
                      </div>
                    </td>
                    <td data-align="right" className={styles.num}>{formatNumber(stats?.tokens ?? 0)}</td>
                    <td data-align="right" className={styles.num}>{formatCurrency(stats?.standard_cost ?? 0)}</td>
                    <td data-align="right" className={`${styles.num} ${styles.realCost}`}>
                      {formatCurrency(realCost(account, stats))}
                    </td>
                    <td data-align="right" className={styles.num}>{cacheHitRate(stats)}</td>
                    <td data-align="right" className={styles.num}>{onlineRate(account.id)}</td>
                    <td data-align="right" className={styles.num}>{formatTTFT(stats)}</td>
                  </tr>
                )
              })}
              {!loading && consuming.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.empty}>
                    {t('admin.accounts.statistics.noConsumption')}
                  </td>
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}
