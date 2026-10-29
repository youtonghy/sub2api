/**
 * 账号失败率热力图，对应 Vue 版 AccountFailureHeatmap.vue：
 * 每个有调用的账号一行、24 个小时格子，按失败率分级着色，名称列固定在左侧。
 */
import { Alert } from '@/components/arc/alert/alert'
import Skeleton from '@/components/common/Skeleton'
import type { AccountHourlyFailureBucket } from '@/api/admin/ops'
import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import styles from './AccountFailureHeatmap.module.css'

export interface AccountFailureHeatmapProps {
  accounts: Account[]
  byAccount?: Record<string, AccountHourlyFailureBucket[]>
  date?: string
  timezone?: string
  loading?: boolean
  error?: string | null
}

/** 失败率分级，对应 Vue 版的 透明 / 绿 / 黄 / 橙 / 红 */
type FailureLevel = 'empty' | 'low' | 'medium' | 'high' | 'critical'

const hours = Array.from({ length: 24 }, (_, hour) => hour)
const EMPTY_BY_ACCOUNT: Record<string, AccountHourlyFailureBucket[]> = {}

const emptyBucket = (accountID: number, hour: number): AccountHourlyFailureBucket => ({
  account_id: accountID,
  hour,
  request_count: 0,
  failure_count: 0,
  failure_rate: 0
})

const bucketLevel = (bucket: AccountHourlyFailureBucket): FailureLevel => {
  if (bucket.request_count <= 0) return 'empty'
  if (bucket.failure_rate <= 0.05) return 'low'
  if (bucket.failure_rate <= 0.15) return 'medium'
  if (bucket.failure_rate <= 0.3) return 'high'
  return 'critical'
}

const rateLevel = (rate: number): FailureLevel => {
  if (rate <= 0.05) return 'low'
  if (rate <= 0.15) return 'medium'
  if (rate <= 0.3) return 'high'
  return 'critical'
}

const formatRate = (rate: number): string => `${(rate * 100).toFixed(2)}%`

const dailySummary = (buckets: AccountHourlyFailureBucket[]) => {
  const requestCount = buckets.reduce((sum, bucket) => sum + bucket.request_count, 0)
  const failureCount = buckets.reduce((sum, bucket) => sum + bucket.failure_count, 0)
  return {
    requestCount,
    failureCount,
    failureRate: requestCount > 0 ? failureCount / requestCount : 0
  }
}

export default function AccountFailureHeatmap({
  accounts,
  byAccount = EMPTY_BY_ACCOUNT,
  date = '',
  timezone = '',
  loading = false,
  error = null
}: AccountFailureHeatmapProps) {
  const { t } = useI18n()

  const activeAccounts = accounts.filter(
    (account) => byAccount[String(account.id)]?.some((bucket) => bucket.request_count > 0) ?? false
  )

  const bucketFor = (accountID: number, hour: number): AccountHourlyFailureBucket =>
    byAccount[String(accountID)]?.find((bucket) => bucket.hour === hour) ?? emptyBucket(accountID, hour)

  const bucketTitle = (bucket: AccountHourlyFailureBucket): string => {
    const range = `${String(bucket.hour).padStart(2, '0')}:00-${String(bucket.hour).padStart(2, '0')}:59`
    if (bucket.request_count <= 0) {
      return `${range} · ${t('admin.accounts.failureHeatmap.noCalls')}`
    }
    const rate = formatRate(bucket.failure_rate)
    return `${range} · ${t('admin.accounts.failureHeatmap.requests')} ${bucket.request_count} · ${t('admin.accounts.failureHeatmap.failures')} ${bucket.failure_count} · ${t('admin.accounts.failureHeatmap.failureRate')} ${rate}`
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{t('admin.accounts.failureHeatmap.title')}</h2>
          <div className={styles.subtitle}>
            {date || t('admin.accounts.failureHeatmap.today')} · {timezone}
          </div>
        </div>
        <div className={styles.legend} aria-label="failure-rate-legend">
          <span>{t('admin.accounts.failureHeatmap.legendLow')}</span>
          <span className={styles.swatch} data-level="low" />
          <span className={styles.swatch} data-level="medium" />
          <span className={styles.swatch} data-level="high" />
          <span className={styles.swatch} data-level="critical" />
          <span>{t('admin.accounts.failureHeatmap.legendHigh')}</span>
        </div>
      </div>

      {error ? (
        <Alert tone="danger" title={t('admin.accounts.failureHeatmap.loadFailed')} className={styles.alert} />
      ) : null}

      <div className={styles.scroller}>
        <div className={styles.grid}>
          <div className={styles.nameHeader}>{t('admin.accounts.columns.name')}</div>
          {hours.map((hour) => (
            <div key={`header-${hour}`} className={styles.hourHeader}>
              {hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
            </div>
          ))}

          {!loading
            ? activeAccounts.map((account) => {
                const summary = dailySummary(byAccount[String(account.id)] ?? [])
                return [
                  <div key={`${account.id}-name`} className={styles.nameCell}>
                    <div className={styles.nameInner}>
                      <div className={styles.name} title={account.name}>
                        {account.name}
                      </div>
                      <div className={styles.meta}>
                        <span>{account.platform}</span>
                        <span>#{account.id}</span>
                        {summary.requestCount > 0 ? (
                          <span className={styles.dailyRate} data-level={rateLevel(summary.failureRate)}>
                            {t('admin.accounts.failureHeatmap.todayRate')} {formatRate(summary.failureRate)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>,
                  ...hours.map((hour) => {
                    const bucket = bucketFor(account.id, hour)
                    const title = bucketTitle(bucket)
                    return (
                      <div key={`${account.id}-${hour}`} className={styles.bucketCell}>
                        <button
                          type="button"
                          className={styles.bucket}
                          data-level={bucketLevel(bucket)}
                          title={title}
                          aria-label={title}
                        />
                      </div>
                    )
                  })
                ]
              })
            : null}
        </div>

        {loading ? (
          <div className={styles.loading} aria-busy="true" aria-label={t('common.loading')}>
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} height={40} />
            ))}
          </div>
        ) : activeAccounts.length === 0 ? (
          <div className={styles.empty}>{t('common.noData')}</div>
        ) : null}
      </div>
    </div>
  )
}
