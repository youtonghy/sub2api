/**
 * 账号近 30 天用量统计弹窗，对应 Vue 版 AccountStatsModal.vue。
 * 打开时请求 adminAPI.accounts.getStats(id, 30)，关闭时清空。
 * 与 Vue 版的差异：Vue 版的双 Y 轴趋势图拆为两张共用横轴的图——费用（账号计费、用户计费）与请求数；
 * KPI 使用 Arc metric-card，数值格式与 Vue 版 formatCost / formatNumber / formatTokens 完全一致。
 */
import { useEffect, useMemo, useState } from 'react'

import { adminAPI } from '@/api/admin'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { LineChart, type LineChartDatum, type LineChartSeries } from '@/components/arc/line-chart/line-chart'
import { MetricCard } from '@/components/arc/metric-card/metric-card'
import EndpointDistributionChart from '@/components/charts/EndpointDistributionChart'
import ModelDistributionChart from '@/components/charts/ModelDistributionChart'
import BaseDialog from '@/components/common/BaseDialog'
import EmptyState from '@/components/common/EmptyState'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import type { Account, AccountUsageStatsResponse } from '@/types'
import styles from './AccountStatsModal.module.css'

export interface AccountStatsModalProps {
  show: boolean
  account: Account | null
  onClose: () => void
}

// Format helpers（与 Vue 版逐字一致）
const formatCost = (value: number): string => {
  if (value >= 1000) {
    return (value / 1000).toFixed(2) + 'K'
  } else if (value >= 1) {
    return value.toFixed(2)
  } else if (value >= 0.01) {
    return value.toFixed(3)
  }
  return value.toFixed(4)
}

const formatNumber = (value: number): string => {
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(2) + 'M'
  } else if (value >= 1_000) {
    return (value / 1_000).toFixed(2) + 'K'
  }
  return value.toLocaleString()
}

const formatTokens = (value: number): string => {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`
  } else if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`
  }
  return value.toLocaleString()
}

const formatDuration = (ms: number): string => {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`
  }
  return `${Math.round(ms)}ms`
}

/** 把格式化后的文本（如 1.23K、0.0123、12,345）拆成 metric-card 的数值、小数位与后缀，显示结果与原文本一致 */
const toMetric = (text: string) => {
  const match = /^(-?[\d,]*\.?\d+)(.*)$/.exec(text)
  if (!match) return { value: 0, decimals: 0, suffix: text }
  const numeric = match[1].replace(/,/g, '')
  const dot = numeric.indexOf('.')
  return { value: Number(numeric), decimals: dot === -1 ? 0 : numeric.length - dot - 1, suffix: match[2] }
}

function DetailPanel({ title, rows }: { title: string; rows: Array<{ label: string; value: string; tone?: 'accent' }> }) {
  return (
    <section className={styles.panel}>
      <h3 className={styles.panelTitle}>{title}</h3>
      <dl className={styles.rows}>
        {rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <dt>{row.label}</dt>
            <dd data-tone={row.tone}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default function AccountStatsModal({ show, account, onClose }: AccountStatsModalProps) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<AccountUsageStatsResponse | null>(null)

  // Load stats when modal opens；关闭时清空
  const accountId = account?.id ?? null
  const [lastShow, setLastShow] = useState(show)
  if (lastShow !== show) {
    setLastShow(show)
    if (!show) setStats(null)
  }

  useEffect(() => {
    if (!show || accountId === null) return
    let cancelled = false
    const loadStats = async () => {
      setLoading(true)
      try {
        const result = await adminAPI.accounts.getStats(accountId, 30)
        if (!cancelled) setStats(result)
      } catch (error) {
        console.error('Failed to load account stats:', error)
        if (!cancelled) setStats(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadStats()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与 Vue 版一致，只在打开时加载
  }, [show])

  const accountBilledLabel = `${t('usage.accountBilled')} (USD)`
  const userBilledLabel = `${t('usage.userBilled')} (USD)`
  const requestsLabel = t('admin.accounts.stats.requests')

  const trend = useMemo(() => {
    if (!stats?.history?.length) return null
    const data: LineChartDatum[] = stats.history.map((h, index) => ({
      key: `${index}-${h.label}`,
      label: h.label,
      axisLabel: h.label,
      values: { actual_cost: h.actual_cost, user_cost: h.user_cost, requests: h.requests }
    }))
    return data
  }, [stats])

  const costSeries: LineChartSeries[] = [
    { key: 'actual_cost', label: accountBilledLabel, area: true },
    { key: 'user_cost', label: userBilledLabel, dashed: true, area: false }
  ]
  const requestSeries: LineChartSeries[] = [{ key: 'requests', label: requestsLabel, area: false }]

  const summary = stats?.summary
  const money = (value: number | undefined) => `$${formatCost(value || 0)}`

  return (
    <BaseDialog
      show={show}
      title={t('admin.accounts.usageStatistics')}
      width="extra-wide"
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <div className={styles.body}>
        {/* Account Info Header */}
        {account && (
          <div className={styles.header}>
            <div>
              <div className={styles.accountName}>{account.name}</div>
              <div className={styles.muted}>{t('admin.accounts.last30DaysUsage')}</div>
            </div>
            <Badge tone={account.status === 'active' ? 'success' : 'neutral'}>{account.status}</Badge>
          </div>
        )}

        {loading ? (
          <div className={styles.kpis} aria-busy="true">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} height={112} />
            ))}
          </div>
        ) : stats && summary ? (
          <>
            {/* Row 1: Main Stats Cards */}
            <div className={styles.kpis}>
              <MetricCard
                label={t('admin.accounts.stats.totalCost')}
                prefix="$"
                {...toMetric(formatCost(summary.total_cost))}
                context={`${t('admin.accounts.stats.accumulatedCost')} (${t('usage.userBilled')}: ${money(summary.total_user_cost)} · ${t('admin.accounts.stats.standardCost')}: ${money(summary.total_standard_cost)})`}
              />
              <MetricCard
                label={t('admin.accounts.stats.totalRequests')}
                {...toMetric(formatNumber(summary.total_requests))}
                context={t('admin.accounts.stats.totalCalls')}
              />
              <MetricCard
                label={t('admin.accounts.stats.avgDailyCost')}
                prefix="$"
                {...toMetric(formatCost(summary.avg_daily_cost))}
                context={`${t('admin.accounts.stats.basedOnActualDays', { days: summary.actual_days_used })} (${t('usage.userBilled')}: ${money(summary.avg_daily_user_cost)})`}
              />
              <MetricCard
                label={t('admin.accounts.stats.avgDailyRequests')}
                {...toMetric(formatNumber(Math.round(summary.avg_daily_requests)))}
                context={t('admin.accounts.stats.avgDailyUsage')}
              />
            </div>

            {/* Row 2: Today, Highest Cost, Highest Requests */}
            <div className={styles.panels}>
              <DetailPanel
                title={t('admin.accounts.stats.todayOverview')}
                rows={[
                  { label: t('usage.accountBilled'), value: money(summary.today?.cost) },
                  { label: t('usage.userBilled'), value: money(summary.today?.user_cost) },
                  { label: t('admin.accounts.stats.requests'), value: formatNumber(summary.today?.requests || 0) },
                  { label: t('admin.accounts.stats.tokens'), value: formatTokens(summary.today?.tokens || 0) }
                ]}
              />
              <DetailPanel
                title={t('admin.accounts.stats.highestCostDay')}
                rows={[
                  { label: t('admin.accounts.stats.date'), value: summary.highest_cost_day?.label || '-' },
                  { label: t('usage.accountBilled'), value: money(summary.highest_cost_day?.cost), tone: 'accent' },
                  { label: t('usage.userBilled'), value: money(summary.highest_cost_day?.user_cost) },
                  { label: t('admin.accounts.stats.requests'), value: formatNumber(summary.highest_cost_day?.requests || 0) }
                ]}
              />
              <DetailPanel
                title={t('admin.accounts.stats.highestRequestDay')}
                rows={[
                  { label: t('admin.accounts.stats.date'), value: summary.highest_request_day?.label || '-' },
                  {
                    label: t('admin.accounts.stats.requests'),
                    value: formatNumber(summary.highest_request_day?.requests || 0),
                    tone: 'accent'
                  },
                  { label: t('usage.accountBilled'), value: money(summary.highest_request_day?.cost) },
                  { label: t('usage.userBilled'), value: money(summary.highest_request_day?.user_cost) }
                ]}
              />
            </div>

            {/* Row 3: Token Stats */}
            <div className={styles.panels}>
              <DetailPanel
                title={t('admin.accounts.stats.accumulatedTokens')}
                rows={[
                  { label: t('admin.accounts.stats.totalTokens'), value: formatTokens(summary.total_tokens) },
                  { label: t('admin.accounts.stats.dailyAvgTokens'), value: formatTokens(Math.round(summary.avg_daily_tokens)) }
                ]}
              />
              <DetailPanel
                title={t('admin.accounts.stats.performance')}
                rows={[
                  { label: t('admin.accounts.stats.avgResponseTime'), value: formatDuration(summary.avg_duration_ms) },
                  { label: t('admin.accounts.stats.daysActive'), value: `${summary.actual_days_used} / ${summary.days}` }
                ]}
              />
              <DetailPanel
                title={t('admin.accounts.stats.recentActivity')}
                rows={[
                  { label: t('admin.accounts.stats.todayRequests'), value: formatNumber(summary.today?.requests || 0) },
                  { label: t('admin.accounts.stats.todayTokens'), value: formatTokens(summary.today?.tokens || 0) },
                  { label: t('admin.accounts.stats.todayCost'), value: money(summary.today?.cost) }
                ]}
              />
            </div>

            {/* Usage Trend Chart：费用与请求数分为两张共用横轴的图 */}
            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>{t('admin.accounts.stats.usageTrend')}</h3>
              {trend ? (
                <div className={styles.charts}>
                  <LineChart
                    data={trend}
                    series={costSeries}
                    label={accountBilledLabel}
                    height={200}
                    formatValue={(value) => `$${formatCost(value)}`}
                    formatTick={(value) => `$${formatCost(Number(value))}`}
                    emptyLabel={t('admin.dashboard.noDataAvailable')}
                  />
                  <LineChart
                    data={trend}
                    series={requestSeries}
                    label={requestsLabel}
                    height={140}
                    formatValue={(value) => formatNumber(value)}
                    formatTick={(value) => formatNumber(Number(value))}
                    legend={false}
                    emptyLabel={t('admin.dashboard.noDataAvailable')}
                  />
                </div>
              ) : (
                <p className={styles.muted}>{t('admin.dashboard.noDataAvailable')}</p>
              )}
            </section>

            {/* Model Distribution */}
            <ModelDistributionChart modelStats={stats.models} loading={false} />

            <EndpointDistributionChart endpointStats={stats.endpoints || []} loading={false} title={t('usage.inboundEndpoint')} />

            <EndpointDistributionChart
              endpointStats={stats.upstream_endpoints || []}
              loading={false}
              title={t('usage.upstreamEndpoint')}
            />
          </>
        ) : (
          /* No Data State */
          <EmptyState title={t('admin.accounts.stats.noData')} />
        )}
      </div>
    </BaseDialog>
  )
}
