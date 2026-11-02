/**
 * 管理仪表盘「用户消费排行变化」：Arc Pro race-bar-chart，按工具栏的时间范围与粒度逐期累计实际费用。
 *
 * 区块进入视口附近后才请求（users-trend，metric=actual_cost，前 12 名），之后时间范围、粒度变化或点“刷新”时重新请求；
 * 过期响应直接丢弃。不自动播放。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInView } from 'motion/react'

import { adminAPI } from '@/api/admin'
import { Alert } from '@/components/arc/alert/alert'
import { RaceBarChart } from '@/components/arc/race-bar-chart/race-bar-chart'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { formatCost, getRankingUserLabel } from '@/components/charts/chartUtils'
import chartStyles from '@/components/charts/charts.module.css'
import { useI18n } from '@/i18n/useI18n'
import type { UserUsageTrendPoint } from '@/types'
import { buildCumulativeRaceFrames, formatDollarTick, formatPeriodLabel, raceFrameDuration } from './dashboardInsightsData'
import styles from './dashboardInsights.module.css'
import { useIntlLocale, useRaceBarChartLabels } from './useInsightsLabels'

/** 与“用户使用趋势”一致取前 12 名 */
const RACE_USER_LIMIT = 12
const RACE_BARS = 10

const formatDollars = (value: number): string => `$${formatCost(value)}`

export interface DashboardUserRaceProps {
  startDate: string
  endDate: string
  granularity: 'day' | 'hour'
  /** 点击工具栏“刷新”时递增，触发重新请求 */
  reloadKey: number
}

type LoadState = { key: string; points: UserUsageTrendPoint[]; failed: boolean }

export default function DashboardUserRace({ startDate, endDate, granularity, reloadKey }: DashboardUserRaceProps) {
  const { t } = useI18n()
  const intlLocale = useIntlLocale()
  const labels = useRaceBarChartLabels()
  const root = useRef<HTMLDivElement>(null)
  const nearView = useInView(root, { once: true, margin: '200px 0px' })
  const [result, setResult] = useState<LoadState | null>(null)
  const requestKey = `${startDate}|${endDate}|${granularity}|${reloadKey}`

  useEffect(() => {
    if (!nearView) return
    let cancelled = false
    adminAPI.dashboard
      .getUserUsageTrend({ start_date: startDate, end_date: endDate, granularity, limit: RACE_USER_LIMIT, metric: 'actual_cost' })
      .then(
        (response) => {
          if (!cancelled) setResult({ key: requestKey, points: response.trend || [], failed: false })
        },
        (error: unknown) => {
          if (cancelled) return
          console.error('[DashboardUserRace] Failed to load user usage trend:', error)
          setResult({ key: requestKey, points: [], failed: true })
        }
      )
    return () => {
      cancelled = true
    }
  }, [nearView, requestKey, startDate, endDate, granularity])

  const current = result?.key === requestKey ? result : null

  const race = useMemo(
    () =>
      buildCumulativeRaceFrames(current?.points ?? [], getRankingUserLabel, (date, withYear) =>
        formatPeriodLabel(date, intlLocale, withYear)
      ),
    [current, intlLocale]
  )

  const renderBody = () => {
    if (!current) return <Skeleton lines={6} label={t('insightsUi.race.loading')} />
    if (current.failed) return <Alert tone="danger" title={t('insightsUi.race.loadFailed')} />
    if (!race.items.length) return <p className={chartStyles.message}>{t('admin.dashboard.noDataAvailable')}</p>
    return (
      <RaceBarChart
        // 换一组数据时从第一帧重新开始
        key={requestKey}
        items={race.items}
        frames={race.frames}
        label={t('insightsUi.race.label')}
        formatValue={formatDollars}
        formatTick={formatDollarTick}
        bars={RACE_BARS}
        defaultFrame={race.frames.length - 1}
        autoPlay={false}
        frameDuration={raceFrameDuration(race.frames.length)}
        labels={labels}
        locale={intlLocale}
      />
    )
  }

  return (
    <div ref={root} className={styles.race} aria-busy={!current || undefined}>
      <p className={styles.raceDescription}>{t('insightsUi.race.description')}</p>
      {renderBody()}
    </div>
  )
}
