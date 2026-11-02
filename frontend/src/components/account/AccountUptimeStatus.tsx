/**
 * 账号故障日志，用 Arc Pro Uptime status 区块展示：
 * 每个有调用的账号一行、当天 24 根小时柱，按失败率分为正常 / 降级 / 故障，无调用的小时显示为空闲。
 */
import { useMemo } from 'react'
import { Alert } from '@/components/arc/alert/alert'
import UptimeStatus, {
  type UptimeService,
  type UptimeSlot,
  type UptimeSlotStatus,
  type UptimeStatusLabels
} from '@/components/arc/blocks/uptime-status/uptime-status'
import Skeleton from '@/components/common/Skeleton'
import type { AccountHourlyFailureBucket } from '@/api/admin/ops'
import { useI18n } from '@/i18n/useI18n'
import type { Account } from '@/types'
import styles from './AccountUptimeStatus.module.css'

export interface AccountUptimeStatusProps {
  accounts: Account[]
  byAccount?: Record<string, AccountHourlyFailureBucket[]>
  date?: string
  timezone?: string
  loading?: boolean
  error?: string | null
}

const hours = Array.from({ length: 24 }, (_, hour) => hour)
const EMPTY_BY_ACCOUNT: Record<string, AccountHourlyFailureBucket[]> = {}

/** 失败率 ≤5% 视为正常，≤30% 为降级，更高为故障 */
const DEGRADED_RATE = 0.05
const OUTAGE_RATE = 0.3

const rateStatus = (rate: number): UptimeSlotStatus =>
  rate <= DEGRADED_RATE ? 'operational' : rate <= OUTAGE_RATE ? 'degraded' : 'outage'

const formatRate = (rate: number): string => `${(rate * 100).toFixed(2)}%`
const hourRange = (hour: number): string => {
  const hh = String(hour).padStart(2, '0')
  return `${hh}:00-${hh}:59`
}

export default function AccountUptimeStatus({
  accounts,
  byAccount = EMPTY_BY_ACCOUNT,
  date = '',
  timezone = '',
  loading = false,
  error = null
}: AccountUptimeStatusProps) {
  const { t, locale } = useI18n()
  const intlLocale = locale === 'zh' ? 'zh-CN' : 'en-US'

  const labels = useMemo<UptimeStatusLabels>(
    () => ({
      operational: t('admin.accounts.failureHeatmap.operational'),
      degraded: t('admin.accounts.failureHeatmap.degraded'),
      outage: t('admin.accounts.failureHeatmap.outage'),
      idle: t('admin.accounts.failureHeatmap.noCalls'),
      uptime: t('admin.accounts.failureHeatmap.successRate'),
      noData: t('admin.accounts.failureHeatmap.noCalls'),
      strip: (name: string) => t('admin.accounts.failureHeatmap.stripLabel', { name }),
      keyboardHint: t('admin.accounts.failureHeatmap.keyboardHint')
    }),
    // locale 变化时重新取文案
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )

  const services = useMemo<UptimeService[]>(() => {
    const rows: UptimeService[] = []
    for (const account of accounts) {
      const buckets = byAccount[String(account.id)] ?? []
      const requestCount = buckets.reduce((sum, bucket) => sum + bucket.request_count, 0)
      if (requestCount <= 0) continue
      const failureCount = buckets.reduce((sum, bucket) => sum + bucket.failure_count, 0)
      const dailyRate = failureCount / requestCount
      const dailyStatus = rateStatus(dailyRate)

      const slots = hours.map((hour): UptimeSlot => {
        const bucket = buckets.find((item) => item.hour === hour)
        if (!bucket || bucket.request_count <= 0) return { status: 'idle', label: hourRange(hour) }
        return {
          status: rateStatus(bucket.failure_rate),
          label: hourRange(hour),
          uptime: (1 - bucket.failure_rate) * 100,
          details: [
            { label: t('admin.accounts.failureHeatmap.requests'), value: String(bucket.request_count) },
            { label: t('admin.accounts.failureHeatmap.failures'), value: String(bucket.failure_count) },
            { label: t('admin.accounts.failureHeatmap.failureRate'), value: formatRate(bucket.failure_rate) }
          ]
        }
      })

      rows.push({
        id: String(account.id),
        name: account.name,
        detail: `${account.platform} · #${account.id} · ${t('admin.accounts.failureHeatmap.failureRate')} ${formatRate(dailyRate)}`,
        uptime: (1 - dailyRate) * 100,
        slots,
        issue:
          dailyStatus === 'operational'
            ? undefined
            : {
                tone: dailyStatus === 'outage' ? 'danger' : 'warning',
                label: t(`admin.accounts.failureHeatmap.${dailyStatus}`)
              }
      })
    }
    return rows
  }, [accounts, byAccount, t])

  const affected = services.filter((service) => service.issue).length
  const showRows = !loading && services.length > 0

  return (
    <div className={styles.root}>
      <UptimeStatus
        className={styles.block}
        services={showRows ? services : []}
        state={affected > 0 ? 'degraded' : 'operational'}
        title={
          affected > 0
            ? t('admin.accounts.failureHeatmap.affected', { count: affected })
            : t('admin.accounts.failureHeatmap.allOperational')
        }
        source={t('admin.accounts.failureHeatmap.title')}
        detail={[date || t('admin.accounts.failureHeatmap.today'), timezone].filter(Boolean).join(' · ')}
        panelTitle={t('admin.accounts.failureHeatmap.panelTitle')}
        panelDescription={t('admin.accounts.failureHeatmap.panelDescription')}
        axis={['00:00', '23:59']}
        labels={labels}
        pageStep={6}
        locale={intlLocale}
        notice={
          error ? (
            <Alert tone="danger" title={t('admin.accounts.failureHeatmap.loadFailed')} className={styles.alert} />
          ) : null
        }
        placeholder={
          loading ? (
            <div className={styles.loading} aria-busy="true" aria-label={t('common.loading')}>
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} height={56} />
              ))}
            </div>
          ) : services.length === 0 ? (
            <div className={styles.empty}>{t('common.noData')}</div>
          ) : undefined
        }
      />
    </div>
  )
}
