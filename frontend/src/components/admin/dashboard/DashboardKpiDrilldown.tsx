/**
 * 管理仪表盘「用量概览」：Arc Pro kpi-drilldown，卡片展开为带周期对比的日趋势与模型 / 分组构成表。
 *
 * 数据只在主仪表盘数据就绪、且区块进入视口附近后加载一次（不轮询，不跟随工具栏的时间范围）：
 * 1 次按天趋势（最近 180 天）+ 模型、分组统计各 2 次（近 30 天与之前 30 天），共 5 个并行请求。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInView } from 'motion/react'

import { adminAPI } from '@/api/admin'
import { Alert } from '@/components/arc/alert/alert'
import { KpiDrilldown } from '@/components/arc/blocks/kpi-drilldown/kpi-drilldown'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useI18n } from '@/i18n/useI18n'
import type { TrendDataPoint } from '@/types'
import {
  buildKpis,
  insightWindows,
  type BreakdownWindowStats,
  type InsightMetric,
  type KpiDefinition
} from './dashboardInsightsData'
import styles from './dashboardInsights.module.css'
import { useIntlLocale, useKpiDrilldownLabels } from './useInsightsLabels'

const METRICS: { id: InsightMetric; prefix?: string; decimals?: number }[] = [
  { id: 'requests' },
  { id: 'total_tokens' },
  { id: 'actual_cost', prefix: '$', decimals: 2 },
  { id: 'cost', prefix: '$', decimals: 2 }
]

interface LoadedData {
  end: string
  trend: TrendDataPoint[]
  stats: BreakdownWindowStats
}

type LoadState = { attempt: number; data: LoadedData | null; failed: boolean }

const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

async function loadInsights(): Promise<LoadedData> {
  const windows = insightWindows(formatLocalDate(new Date()))
  const current = { start_date: windows.currentStart, end_date: windows.end }
  const previous = { start_date: windows.previousStart, end_date: windows.previousEnd }
  const [trend, modelsNow, modelsBefore, groupsNow, groupsBefore] = await Promise.all([
    adminAPI.dashboard.getUsageTrend({ start_date: windows.trendStart, end_date: windows.end, granularity: 'day' }),
    adminAPI.dashboard.getModelStats(current),
    adminAPI.dashboard.getModelStats(previous),
    adminAPI.dashboard.getGroupStats(current),
    adminAPI.dashboard.getGroupStats(previous)
  ])
  return {
    end: windows.end,
    trend: trend.trend || [],
    stats: {
      models: { current: modelsNow.models || [], previous: modelsBefore.models || [] },
      groups: { current: groupsNow.groups || [], previous: groupsBefore.groups || [] }
    }
  }
}

export interface DashboardKpiDrilldownProps {
  /** 主仪表盘数据加载完成后为 true，此后才开始加载本区块 */
  enabled: boolean
}

export default function DashboardKpiDrilldown({ enabled }: DashboardKpiDrilldownProps) {
  const { t, locale } = useI18n()
  const intlLocale = useIntlLocale()
  const labels = useKpiDrilldownLabels()
  const root = useRef<HTMLDivElement>(null)
  const nearView = useInView(root, { once: true, margin: '200px 0px' })
  // attempt 只在用户点“重试”时增加；result.attempt 落后于 attempt 即为加载中
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<LoadState | null>(null)
  const active = enabled && nearView

  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadInsights().then(
      (data) => {
        if (!cancelled) setResult({ attempt, data, failed: false })
      },
      (error: unknown) => {
        if (cancelled) return
        console.error('[DashboardKpiDrilldown] Failed to load usage overview:', error)
        setResult({ attempt, data: null, failed: true })
      }
    )
    return () => {
      cancelled = true
    }
  }, [active, attempt])

  const data = result?.attempt === attempt ? result.data : null
  const failed = result?.attempt === attempt && result.failed

  const kpis = useMemo(() => {
    if (!data) return null
    const definitions: KpiDefinition[] = METRICS.map((metric) => ({
      id: metric.id,
      label: t(`insightsUi.kpi.metrics.${metric.id}.label`),
      description: t(`insightsUi.kpi.metrics.${metric.id}.description`),
      format: { prefix: metric.prefix, decimals: metric.decimals }
    }))
    return buildKpis({
      definitions,
      trend: data.trend,
      end: data.end,
      stats: data.stats,
      otherLabel: t('insightsUi.kpi.other'),
      noGroupLabel: t('insightsUi.kpi.noGroup')
    })
    // locale 变化时重新取指标名称
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, t, locale])

  const dimensions = useMemo(
    () => [
      { value: 'model', label: t('insightsUi.kpi.dimensions.model') },
      { value: 'group', label: t('insightsUi.kpi.dimensions.group') }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )

  if (data && kpis) {
    return (
      <div ref={root}>
        <KpiDrilldown
          className={styles.drilldown}
          title={t('insightsUi.kpi.title')}
          kpis={kpis}
          dimensions={dimensions}
          end={data.end}
          columns={2}
          labels={labels}
          locale={intlLocale}
        />
      </div>
    )
  }

  return (
    <div ref={root} className={styles.frame} aria-busy={!failed || undefined}>
      <h2 className={styles.frameTitle}>{t('insightsUi.kpi.title')}</h2>
      {failed ? (
        <Alert tone="danger" title={t('insightsUi.kpi.loadFailed')}>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            {t('insightsUi.kpi.retry')}
          </Button>
        </Alert>
      ) : (
        <Skeleton lines={6} className={styles.kpiSkeleton} label={t('insightsUi.kpi.loading')} />
      )}
    </div>
  )
}
