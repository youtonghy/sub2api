import { useState } from 'react'

import { usageAPI, type UserDashboardStats as UserStatsType } from '@/api/usage'
import { getMyPlatformQuotas } from '@/api/user'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import type { DateRangeValue } from '@/components/common/DateRangePicker'
import UserDashboardCharts from '@/components/user/dashboard/UserDashboardCharts'
import UserDashboardQuickActions from '@/components/user/dashboard/UserDashboardQuickActions'
import UserDashboardRecentUsage from '@/components/user/dashboard/UserDashboardRecentUsage'
import UserDashboardStats from '@/components/user/dashboard/UserDashboardStats'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAuthStore } from '@/stores/auth'
import type { ModelStat, PlatformQuotaItem, TrendDataPoint, UsageLog } from '@/types'
import { formatDateLocalInput } from '@/utils/format'
import styles from './DashboardView.module.css'

interface ChartQuery {
  startDate: string
  endDate: string
  granularity: string
}

const createInitialQuery = (): ChartQuery => ({
  startDate: formatDateLocalInput(new Date(Date.now() - 6 * 86400000)),
  endDate: formatDateLocalInput(new Date()),
  granularity: 'day'
})

/** 用户仪表盘：KPI、图表、最近用量与快捷操作 */
export default function DashboardView() {
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)
  const isSimpleMode = useAuthStore((s) => s.isSimpleMode)

  const [stats, setStats] = useState<UserStatsType | null>(null)
  // 首次进入即处于加载态，渲染骨架而非整页转圈
  const [loading, setLoading] = useState(true)
  const [loadingUsage, setLoadingUsage] = useState(false)
  const [loadingCharts, setLoadingCharts] = useState(false)
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([])
  const [modelStats, setModelStats] = useState<ModelStat[]>([])
  const [recentUsage, setRecentUsage] = useState<UsageLog[]>([])
  const [platformQuotas, setPlatformQuotas] = useState<PlatformQuotaItem[] | null>(null)
  const [query, setQuery] = useState<ChartQuery>(createInitialQuery)

  const loadStats = async () => {
    setLoading(true)
    try {
      await useAuthStore.getState().refreshUser()
      setStats(await usageAPI.getDashboardStats())
    } catch (error) {
      console.error('Failed to load dashboard stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCharts = async (q: ChartQuery) => {
    setLoadingCharts(true)
    try {
      const res = await Promise.all([
        usageAPI.getDashboardTrend({
          start_date: q.startDate,
          end_date: q.endDate,
          granularity: q.granularity as 'day' | 'hour'
        }),
        usageAPI.getDashboardModels({ start_date: q.startDate, end_date: q.endDate })
      ])
      setTrendData(res[0].trend || [])
      setModelStats(res[1].models || [])
    } catch (error) {
      console.error('Failed to load charts:', error)
    } finally {
      setLoadingCharts(false)
    }
  }

  const loadRecent = async (q: ChartQuery) => {
    setLoadingUsage(true)
    try {
      const res = await usageAPI.getByDateRange(q.startDate, q.endDate)
      setRecentUsage(res.items.slice(0, 5))
    } catch (error) {
      console.error('Failed to load recent usage:', error)
    } finally {
      setLoadingUsage(false)
    }
  }

  const loadPlatformQuotas = async () => {
    try {
      const data = await getMyPlatformQuotas()
      setPlatformQuotas(data.platform_quotas ?? [])
    } catch (error) {
      console.warn('Failed to load platform quotas:', error)
      setPlatformQuotas([])
    }
  }

  const refreshAll = (q: ChartQuery = query) => {
    void loadStats()
    void loadCharts(q)
    void loadRecent(q)
    void loadPlatformQuotas()
  }

  useMountOnce(() => {
    refreshAll()
  })

  const onDateRangeChange = (range: DateRangeValue) => {
    const next = { ...query, startDate: range.startDate, endDate: range.endDate }
    setQuery(next)
    void loadCharts(next)
  }

  const onGranularityChange = (granularity: string) => {
    const next = { ...query, granularity }
    setQuery(next)
    void loadCharts(next)
  }

  if (loading && !stats) {
    return (
      <div className={styles.page} aria-busy="true">
        {[0, 1].map((row) => (
          <div key={row} className={styles.kpiRow}>
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} lines={3} className={styles.kpiSkeleton} label={t('common.loading')} />
            ))}
          </div>
        ))}
        <Skeleton lines={6} className={styles.blockSkeleton} label={t('common.loading')} />
      </div>
    )
  }

  // 统计加载失败且没有任何数据时，Vue 版整页留空；这里给出可重试的提示
  if (!stats) {
    return (
      <div className={styles.page}>
        <Alert tone="danger" title={t('common.error')}>
          <Button variant="secondary" size="sm" onClick={() => refreshAll()}>
            {t('common.refresh')}
          </Button>
        </Alert>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <UserDashboardStats
        stats={stats}
        balance={user?.balance || 0}
        isSimple={isSimpleMode}
        platformQuotas={platformQuotas}
      />
      <UserDashboardCharts
        startDate={query.startDate}
        endDate={query.endDate}
        granularity={query.granularity}
        loading={loadingCharts}
        trend={trendData}
        models={modelStats}
        onDateRangeChange={onDateRangeChange}
        onGranularityChange={onGranularityChange}
        onRefresh={() => refreshAll()}
      />
      <div className={styles.bottomGrid}>
        <UserDashboardRecentUsage data={recentUsage} loading={loadingUsage} />
        <UserDashboardQuickActions />
      </div>
    </div>
  )
}
