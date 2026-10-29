import { useMemo, useRef, useState } from 'react'
import { ChevronRight, LayoutGrid, RefreshCw, Sparkles, type LucideIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router'

import { adminAPI } from '@/api/admin'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { LineChart, type LineChartDatum, type LineChartSeries } from '@/components/arc/line-chart/line-chart'
import { MetricCard } from '@/components/arc/metric-card/metric-card'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import {
  axisLabelOf,
  formatCost,
  formatNumber,
  formatTokens,
  splitMagnitude
} from '@/components/charts/chartUtils'
import chartStyles from '@/components/charts/charts.module.css'
import ModelDistributionChart from '@/components/charts/ModelDistributionChart'
import TokenUsageTrend from '@/components/charts/TokenUsageTrend'
import { useKeepOneSeries } from '@/components/charts/useKeepOneSeries'
import DateRangePicker, { type DateRangeValue } from '@/components/common/DateRangePicker'
import { useBatchImageAccess } from '@/composables/useBatchImageAccess'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type {
  AccountUsageRankingItem,
  DashboardStats,
  ModelStat,
  TrendDataPoint,
  UserSpendingRankingItem,
  UserUsageTrendPoint
} from '@/types'
import styles from './DashboardView.module.css'

type Granularity = 'day' | 'hour'
type UserTrendMetric = 'tokens' | 'actual_cost'

interface DashboardQuery {
  startDate: string
  endDate: string
  granularity: Granularity
}

const rankingLimit = 12

// Helper function to format date in local timezone
const formatLocalDate = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const getLast24HoursRangeDates = (): { start: string; end: string } => {
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  return {
    start: formatLocalDate(start),
    end: formatLocalDate(end)
  }
}

const createInitialQuery = (): DashboardQuery => {
  const defaultRange = getLast24HoursRangeDates()
  return { startDate: defaultRange.start, endDate: defaultRange.end, granularity: 'hour' }
}

/** 平均响应时间拆成 metric-card 的数值与单位，显示结果与 formatDuration 一致 */
const splitDuration = (ms: number): { value: number; decimals: number; suffix: string } => {
  if (ms >= 1000) return { value: Number((ms / 1000).toFixed(2)), decimals: 2, suffix: 's' }
  return { value: Math.round(ms), decimals: 0, suffix: 'ms' }
}

interface QuickAction {
  to: string
  title: string
  description: string
  icon: LucideIcon
}

export default function DashboardView() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { canUseBatchImage, refreshBatchImageAccess } = useBatchImageAccess()

  const [stats, setStats] = useState<DashboardStats | null>(null)
  const statsRef = useRef<DashboardStats | null>(null)
  // 首次加载统计时为 true（对应 Vue 的 loading，渲染骨架而非整页转圈）
  const [loading, setLoading] = useState(true)
  const [chartsLoading, setChartsLoading] = useState(false)
  const [userTrendLoading, setUserTrendLoading] = useState(false)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [rankingError, setRankingError] = useState(false)
  const [accountRankingLoading, setAccountRankingLoading] = useState(false)
  const [accountRankingError, setAccountRankingError] = useState(false)

  // Chart data
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([])
  const [modelStats, setModelStats] = useState<ModelStat[]>([])
  const [userTrend, setUserTrend] = useState<UserUsageTrendPoint[]>([])
  const [userTrendMetric, setUserTrendMetricState] = useState<UserTrendMetric>('tokens')
  const [rankingItems, setRankingItems] = useState<UserSpendingRankingItem[]>([])
  const [accountRanking, setAccountRanking] = useState<AccountUsageRankingItem[]>([])
  const [rankingTotals, setRankingTotals] = useState({ actualCost: 0, requests: 0, tokens: 0 })

  // 每类请求一个序号，只采纳最后一次请求的响应
  const chartLoadSeq = useRef(0)
  const usersTrendLoadSeq = useRef(0)
  const rankingLoadSeq = useRef(0)
  const accountRankingLoadSeq = useRef(0)

  // Date range
  const [query, setQuery] = useState<DashboardQuery>(createInitialQuery)

  // Load data
  const loadDashboardSnapshot = async (includeStats: boolean, q: DashboardQuery) => {
    const currentSeq = ++chartLoadSeq.current
    if (includeStats && !statsRef.current) {
      setLoading(true)
    }
    setChartsLoading(true)
    try {
      const response = await adminAPI.dashboard.getSnapshotV2({
        start_date: q.startDate,
        end_date: q.endDate,
        granularity: q.granularity,
        include_stats: includeStats,
        include_trend: true,
        include_model_stats: true,
        include_group_stats: false,
        include_users_trend: false
      })
      if (currentSeq !== chartLoadSeq.current) return
      if (includeStats && response.stats) {
        statsRef.current = response.stats
        setStats(response.stats)
      }
      setTrendData(response.trend || [])
      setModelStats(response.models || [])
    } catch (error) {
      if (currentSeq !== chartLoadSeq.current) return
      useAppStore.getState().showError(t('admin.dashboard.failedToLoad'))
      console.error('Error loading dashboard snapshot:', error)
    } finally {
      if (currentSeq === chartLoadSeq.current) {
        setLoading(false)
        setChartsLoading(false)
      }
    }
  }

  const loadUsersTrend = async (q: DashboardQuery, metric: UserTrendMetric) => {
    const currentSeq = ++usersTrendLoadSeq.current
    setUserTrendLoading(true)
    try {
      const response = await adminAPI.dashboard.getUserUsageTrend({
        start_date: q.startDate,
        end_date: q.endDate,
        granularity: q.granularity,
        limit: 12,
        metric
      })
      if (currentSeq !== usersTrendLoadSeq.current) return
      setUserTrend(response.trend || [])
    } catch (error) {
      if (currentSeq !== usersTrendLoadSeq.current) return
      console.error('Error loading users trend:', error)
      setUserTrend([])
    } finally {
      if (currentSeq === usersTrendLoadSeq.current) {
        setUserTrendLoading(false)
      }
    }
  }

  const loadUserSpendingRanking = async (q: DashboardQuery) => {
    const currentSeq = ++rankingLoadSeq.current
    setRankingLoading(true)
    setRankingError(false)
    try {
      const response = await adminAPI.dashboard.getUserSpendingRanking({
        start_date: q.startDate,
        end_date: q.endDate,
        limit: rankingLimit
      })
      if (currentSeq !== rankingLoadSeq.current) return
      setRankingItems(response.ranking || [])
      setRankingTotals({
        actualCost: response.total_actual_cost || 0,
        requests: response.total_requests || 0,
        tokens: response.total_tokens || 0
      })
    } catch (error) {
      if (currentSeq !== rankingLoadSeq.current) return
      console.error('Error loading user spending ranking:', error)
      setRankingItems([])
      setRankingTotals({ actualCost: 0, requests: 0, tokens: 0 })
      setRankingError(true)
    } finally {
      if (currentSeq === rankingLoadSeq.current) {
        setRankingLoading(false)
      }
    }
  }

  const loadAccountUsageRanking = async (q: DashboardQuery) => {
    const currentSeq = ++accountRankingLoadSeq.current
    setAccountRankingLoading(true)
    setAccountRankingError(false)
    try {
      const response = await adminAPI.dashboard.getAccountUsageRanking({
        start_date: q.startDate,
        end_date: q.endDate
      })
      if (currentSeq !== accountRankingLoadSeq.current) return
      setAccountRanking(response.ranking || [])
    } catch (error) {
      if (currentSeq !== accountRankingLoadSeq.current) return
      console.error('Error loading account usage ranking:', error)
      setAccountRanking([])
      setAccountRankingError(true)
    } finally {
      if (currentSeq === accountRankingLoadSeq.current) {
        setAccountRankingLoading(false)
      }
    }
  }

  const loadDashboardStats = async (q: DashboardQuery = query) => {
    await Promise.all([
      loadDashboardSnapshot(true, q),
      loadUsersTrend(q, userTrendMetric),
      loadUserSpendingRanking(q),
      loadAccountUsageRanking(q)
    ])
  }

  const loadChartData = async (q: DashboardQuery) => {
    await Promise.all([
      loadDashboardSnapshot(false, q),
      loadUsersTrend(q, userTrendMetric),
      loadUserSpendingRanking(q),
      loadAccountUsageRanking(q)
    ])
  }

  useMountOnce(() => {
    void refreshBatchImageAccess()
    void loadDashboardStats()
  })

  // Date range change handler
  const onDateRangeChange = (range: DateRangeValue) => {
    // Auto-select granularity based on date range
    const start = new Date(range.startDate)
    const end = new Date(range.endDate)
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))

    // If range is 1 day, use hourly granularity
    const next: DashboardQuery = {
      startDate: range.startDate,
      endDate: range.endDate,
      granularity: daysDiff <= 1 ? 'hour' : 'day'
    }
    setQuery(next)
    void loadChartData(next)
  }

  const onGranularityChange = (value: string) => {
    const next: DashboardQuery = { ...query, granularity: value as Granularity }
    setQuery(next)
    void loadChartData(next)
  }

  const setUserTrendMetric = (metric: UserTrendMetric) => {
    if (userTrendMetric === metric) return
    setUserTrendMetricState(metric)
    setUserTrend([])
    void loadUsersTrend(query, metric)
  }

  const goToUserUsage = (item: UserSpendingRankingItem) => {
    const params = new URLSearchParams({
      user_id: String(item.user_id),
      start_date: query.startDate,
      end_date: query.endDate
    })
    void navigate(`/admin/usage?${params.toString()}`)
  }

  // Format helpers
  const formatUserTrendValue = (value: number): string =>
    userTrendMetric === 'tokens' ? formatTokens(value) : `$${formatCost(value)}`

  // User trend chart data：12 个用户各一条线，按区间合计降序排列，使用 12 色分类色板
  const userTrendChart = useMemo(() => {
    if (!userTrend?.length) return { data: [] as LineChartDatum[], series: [] as LineChartSeries[] }

    const getDisplayName = (point: UserUsageTrendPoint): string => {
      const username = point.username?.trim()
      if (username) {
        return username
      }

      const email = point.email?.trim()
      if (email) {
        return email
      }

      return t('admin.redeem.userPrefix', { id: point.user_id })
    }

    // Group by user_id to avoid merging different users with the same display name
    const userGroups = new Map<number, { name: string; data: Map<string, number>; total: number }>()
    const allDates = new Set<string>()

    userTrend.forEach((point) => {
      allDates.add(point.date)
      const key = point.user_id
      if (!userGroups.has(key)) {
        userGroups.set(key, { name: getDisplayName(point), data: new Map(), total: 0 })
      }
      const value = userTrendMetric === 'tokens' ? point.tokens : point.actual_cost
      const group = userGroups.get(key)!
      group.data.set(point.date, value)
      group.total += Number(value) || 0
    })

    const sortedDates = Array.from(allDates).sort()
    const groups = Array.from(userGroups.entries()).sort((a, b) => b[1].total - a[1].total)

    const series: LineChartSeries[] = groups.map(([userId, group], idx) => ({
      key: `user-${userId}`,
      label: group.name,
      color: `var(--chart-cat-${(idx % 12) + 1})`,
      area: false
    }))

    const data: LineChartDatum[] = sortedDates.map((date) => ({
      key: date,
      label: date,
      axisLabel: axisLabelOf(date),
      values: Object.fromEntries(groups.map(([userId, group]) => [`user-${userId}`, group.data.get(date) || 0]))
    }))

    return { data, series }
  }, [userTrend, userTrendMetric, t])

  const userTrendSeries = useKeepOneSeries(userTrendChart.series)

  const granularityOptions = [
    { value: 'day', label: t('admin.dashboard.day') },
    { value: 'hour', label: t('admin.dashboard.hour') }
  ]
  const userTrendMetricOptions = [
    { value: 'tokens', label: t('admin.dashboard.tokens') },
    { value: 'actual_cost', label: t('admin.dashboard.actualSpending') }
  ]

  const quickActions: QuickAction[] = [
    ...(canUseBatchImage
      ? [{ to: '/batch-image', title: t('admin.dashboard.batchImage'), description: t('admin.dashboard.batchImageDesc'), icon: Sparkles }]
      : []),
    { to: '/admin/groups', title: t('admin.dashboard.groupPricing'), description: t('admin.dashboard.groupPricingDesc'), icon: LayoutGrid }
  ]

  // 统计加载失败且没有任何数据时，Vue 版整页留空；这里给出可重试的提示
  if (!loading && !stats) {
    return (
      <div className={styles.page}>
        <Alert tone="danger" title={t('admin.dashboard.failedToLoad')}>
          <Button variant="secondary" size="sm" onClick={() => void loadDashboardStats()}>
            {t('common.refresh')}
          </Button>
        </Alert>
      </div>
    )
  }

  const costContext = (actual: number, account: number | undefined, standard: number) =>
    `${t('admin.dashboard.actual')} $${formatCost(actual)} · ${t('admin.dashboard.accountCost')} $${formatCost(account)} · ${t('admin.dashboard.standard')} $${formatCost(standard)}`
  const costTitle = `${t('admin.dashboard.actual')} / ${t('admin.dashboard.accountCost')} / ${t('admin.dashboard.standard')}`

  const renderKpis = () => {
    if (!stats) {
      return [0, 1].map((row) => (
        <div key={row} className={styles.kpiRow}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} lines={3} className={styles.kpiSkeleton} label={t('common.loading')} />
          ))}
        </div>
      ))
    }
    const todayTokens = splitMagnitude(stats.today_tokens)
    const totalTokens = splitMagnitude(stats.total_tokens)
    const rpm = splitMagnitude(stats.rpm)
    const duration = splitDuration(stats.average_duration_ms)
    return (
      <>
        {/* Row 1: Core Stats */}
        <div className={styles.kpiRow}>
          <MetricCard
            label={t('admin.dashboard.apiKeys')}
            value={stats.total_api_keys}
            context={`${stats.active_api_keys} ${t('common.active')}`}
          />
          <MetricCard
            label={t('admin.dashboard.accounts')}
            value={stats.total_accounts}
            context={`${stats.normal_accounts} ${t('common.active')}`}
            change={stats.error_accounts > 0 ? `${stats.error_accounts} ${t('common.error')}` : undefined}
          />
          <MetricCard
            label={t('admin.dashboard.todayRequests')}
            value={stats.today_requests}
            context={`${t('common.total')}: ${formatNumber(stats.total_requests)}`}
          />
          <MetricCard
            label={t('admin.dashboard.users')}
            prefix="+"
            value={stats.today_new_users}
            context={`${t('common.total')}: ${formatNumber(stats.total_users)}`}
          />
        </div>

        {/* Row 2: Token Stats */}
        <div className={styles.kpiRow}>
          <div className={styles.kpiCell} title={costTitle}>
            <MetricCard
              label={t('admin.dashboard.todayTokens')}
              value={todayTokens.value}
              decimals={todayTokens.decimals}
              suffix={todayTokens.suffix}
              context={costContext(stats.today_actual_cost, stats.today_account_cost, stats.today_cost)}
            />
          </div>
          <div className={styles.kpiCell} title={costTitle}>
            <MetricCard
              label={t('admin.dashboard.totalTokens')}
              value={totalTokens.value}
              decimals={totalTokens.decimals}
              suffix={totalTokens.suffix}
              context={costContext(stats.total_actual_cost, stats.total_account_cost, stats.total_cost)}
            />
          </div>
          <MetricCard
            label={t('admin.dashboard.performance')}
            value={rpm.value}
            decimals={rpm.decimals}
            suffix={`${rpm.suffix} RPM`}
            context={`${formatTokens(stats.tpm)} TPM`}
          />
          <MetricCard
            label={t('admin.dashboard.avgResponse')}
            value={duration.value}
            decimals={duration.decimals}
            suffix={duration.suffix}
            context={`${stats.active_users} ${t('admin.dashboard.activeUsers')}`}
          />
        </div>
      </>
    )
  }

  const renderAccountRanking = () => {
    if (accountRankingLoading) return <Skeleton lines={5} label={t('common.loading')} />
    if (accountRankingError) return <Alert tone="danger" title={t('admin.dashboard.failedToLoad')} />
    if (!accountRanking.length) return <p className={chartStyles.message}>{t('admin.dashboard.noDataAvailable')}</p>
    return (
      <div className={`${chartStyles.tableScroll} ${chartStyles.tableScrollTall}`}>
        <table className={`${chartStyles.table} ${chartStyles.tableComfortable}`}>
          <thead>
            <tr>
              <th scope="col">{t('admin.dashboard.account')}</th>
              <th scope="col">{t('admin.dashboard.requests')}</th>
              <th scope="col">{t('admin.dashboard.tokens')}</th>
              <th scope="col">{t('admin.dashboard.spendingRankingSpend')}</th>
            </tr>
          </thead>
          <tbody>
            {accountRanking.map((item, index) => (
              <tr key={item.account_id}>
                <td>
                  <span className={chartStyles.name}>
                    <span className={chartStyles.rank}>#{index + 1}</span>
                    <span className={chartStyles.nameText} title={item.account_name}>
                      {item.account_name}
                    </span>
                  </span>
                </td>
                <td>{formatNumber(item.requests)}</td>
                <td>{formatTokens(item.tokens)}</td>
                <td className={chartStyles.actual}>${formatCost(item.actual_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const userTrendTitle = `${t('admin.dashboard.recentUsage')} (Top 12)`

  return (
    <div className={styles.page}>
      <section className={styles.kpis} aria-label={t('admin.dashboard.title')} aria-busy={!stats || undefined}>
        {renderKpis()}
      </section>

      {/* Quick Actions */}
      <section className={styles.panel} aria-labelledby="dashboard-quick-actions">
        <h2 id="dashboard-quick-actions" className={chartStyles.title}>
          {t('admin.dashboard.quickActions')}
        </h2>
        <div className={styles.actions}>
          {quickActions.map((action) => (
            <Link key={action.to} to={action.to} className={styles.action}>
              <span className={styles.actionIcon}>
                <action.icon size={18} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className={styles.actionText}>
                <span className={styles.actionTitle}>{action.title}</span>
                <span className={styles.actionDescription}>{action.description}</span>
              </span>
              <ChevronRight className={styles.actionChevron} size={16} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      {/* Charts Section：一行工具栏控制下方所有图表 */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <span className={styles.toolbarLabel}>{t('admin.dashboard.timeRange')}</span>
          <DateRangePicker startDate={query.startDate} endDate={query.endDate} onChange={onDateRangeChange} />
          <Button variant="secondary" onClick={() => void loadDashboardStats()} disabled={chartsLoading}>
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            {t('common.refresh')}
          </Button>
        </div>
        <div className={styles.toolbarGroup}>
          <span className={styles.toolbarLabel}>{t('admin.dashboard.granularity')}</span>
          <SegmentedControl
            label={t('admin.dashboard.granularity')}
            options={granularityOptions}
            value={query.granularity}
            onValueChange={onGranularityChange}
          />
        </div>
      </div>

      {/* Charts Grid */}
      <div className={styles.chartsGrid}>
        <ModelDistributionChart
          modelStats={modelStats}
          enableRankingView
          rankingItems={rankingItems}
          rankingTotalActualCost={rankingTotals.actualCost}
          rankingTotalRequests={rankingTotals.requests}
          rankingTotalTokens={rankingTotals.tokens}
          loading={chartsLoading}
          rankingLoading={rankingLoading}
          rankingError={rankingError}
          startDate={query.startDate}
          endDate={query.endDate}
          onRankingClick={goToUserUsage}
        />
        <TokenUsageTrend trendData={trendData} loading={chartsLoading} />
      </div>

      {/* Account Usage Ranking */}
      <section className={styles.panel} aria-labelledby="dashboard-account-ranking" aria-busy={accountRankingLoading || undefined}>
        <h2 id="dashboard-account-ranking" className={chartStyles.title}>
          {t('admin.dashboard.accountRankingTitle')}
        </h2>
        {renderAccountRanking()}
      </section>

      {/* User Usage Trend (Full Width) */}
      <section className={styles.panel} aria-labelledby="dashboard-user-trend" aria-busy={userTrendLoading || undefined}>
        <div className={chartStyles.header}>
          <h2 id="dashboard-user-trend" className={chartStyles.title}>
            {userTrendTitle}
          </h2>
          <SegmentedControl
            label={t('admin.dashboard.recentUsage')}
            options={userTrendMetricOptions}
            value={userTrendMetric}
            onValueChange={(value) => setUserTrendMetric(value as UserTrendMetric)}
          />
        </div>
        <LineChart
          data={userTrendChart.data}
          series={userTrendChart.series}
          label={userTrendTitle}
          height={256}
          loading={userTrendLoading}
          emptyLabel={t('admin.dashboard.noDataAvailable')}
          formatValue={(value) => formatUserTrendValue(value)}
          formatTick={formatUserTrendValue}
          hiddenSeries={userTrendSeries.hidden}
          onHiddenSeriesChange={userTrendSeries.onHiddenChange}
        />
      </section>
    </div>
  )
}
