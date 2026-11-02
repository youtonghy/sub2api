import { useMemo, useState, type CSSProperties } from 'react'
import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import type { DonutChartDatum } from '@/components/arc/donut-chart/donut-chart'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { distributionColor } from '@/components/charts/chartUtils'
import chartStyles from '@/components/charts/charts.module.css'
import DistributionDonut from '@/components/charts/DistributionDonut'
import TokenUsageTrend from '@/components/charts/TokenUsageTrend'
import DateRangePicker, { type DateRangeValue } from '@/components/common/DateRangePicker'
import { useI18n } from '@/i18n/useI18n'
import type { ModelStat, TrendDataPoint } from '@/types'
import { formatCostFixed as formatCost, formatNumberLocaleString as formatNumber, formatTokensK as formatTokens } from '@/utils/format'
import styles from './UserDashboardCharts.module.css'

export interface UserDashboardChartsProps {
  loading: boolean
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD */
  endDate: string
  granularity: string
  trend: TrendDataPoint[]
  models: ModelStat[]
  /** 时间范围应用后回调（合并 Vue 版 update:startDate、update:endDate 与 dateRangeChange） */
  onDateRangeChange?: (range: DateRangeValue) => void
  /** 粒度切换（合并 Vue 版 update:granularity 与 granularityChange） */
  onGranularityChange?: (granularity: string) => void
  onRefresh?: () => void
}

/** 用户仪表盘图表：工具栏（时间范围、刷新、粒度）+ 模型分布 + Token 用量趋势 */
export default function UserDashboardCharts({
  loading,
  startDate,
  endDate,
  granularity,
  trend,
  models,
  onDateRangeChange,
  onGranularityChange,
  onRefresh
}: UserDashboardChartsProps) {
  const { t } = useI18n()
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const modelData = useMemo<DonutChartDatum[]>(
    () =>
      (models ?? []).map((m, index) => ({
        key: `model-${m.model}`,
        label: m.model,
        value: m.total_tokens,
        color: distributionColor(index, models.length)
      })),
    [models]
  )

  const granularityOptions = [
    { value: 'day', label: t('dashboard.day') },
    { value: 'hour', label: t('dashboard.hour') }
  ]

  const renderModelDistribution = () => {
    if (loading) return <Skeleton lines={5} label={t('common.loading')} />
    return (
      <div className={chartStyles.distribution}>
        {modelData.length ? (
          <DistributionDonut
            data={modelData}
            label={t('dashboard.modelDistribution')}
            formatValue={(value) => `${formatTokens(value)} tokens`}
            activeKey={hoveredKey}
            onActiveChange={setHoveredKey}
          />
        ) : (
          <p className={chartStyles.message}>{t('dashboard.noDataAvailable')}</p>
        )}
        <div className={chartStyles.tableScroll}>
          <table className={chartStyles.table}>
            <thead>
              <tr>
                <th scope="col">{t('dashboard.model')}</th>
                <th scope="col">{t('dashboard.requests')}</th>
                <th scope="col">{t('dashboard.tokens')}</th>
                <th scope="col">{t('dashboard.actual')}</th>
                <th scope="col">{t('dashboard.standard')}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model, index) => {
                const key = `model-${model.model}`
                const swatch = { '--swatch': distributionColor(index, models.length) } as CSSProperties
                return (
                  <tr
                    key={model.model}
                    className={hoveredKey === key ? chartStyles.rowActive : undefined}
                    onPointerEnter={() => setHoveredKey(key)}
                    onPointerLeave={() => setHoveredKey(null)}
                  >
                    <td title={model.model}>
                      <span className={chartStyles.name}>
                        <span className={chartStyles.swatch} style={swatch} aria-hidden="true" />
                        <span className={chartStyles.nameText}>{model.model}</span>
                      </span>
                    </td>
                    <td>{formatNumber(model.requests)}</td>
                    <td>{formatTokens(model.total_tokens)}</td>
                    <td className={chartStyles.actual}>${formatCost(model.actual_cost)}</td>
                    <td className={chartStyles.standard}>${formatCost(model.cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Date Range Filter */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <span className={styles.toolbarLabel}>{t('dashboard.timeRange')}</span>
          <DateRangePicker startDate={startDate} endDate={endDate} onChange={onDateRangeChange} />
          <Button variant="secondary" onClick={() => onRefresh?.()} disabled={loading}>
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            {t('common.refresh')}
          </Button>
        </div>
        <div className={styles.toolbarGroup}>
          <span className={styles.toolbarLabel}>{t('dashboard.granularity')}</span>
          <SegmentedControl
            label={t('dashboard.granularity')}
            options={granularityOptions}
            value={granularity}
            onValueChange={(value) => onGranularityChange?.(value)}
          />
        </div>
      </div>

      {/* Charts Grid */}
      <div className={styles.chartsGrid}>
        {/* Model Distribution Chart */}
        <section className={chartStyles.panel} aria-busy={loading || undefined} aria-labelledby="user-dashboard-models">
          <div className={chartStyles.header}>
            <h2 id="user-dashboard-models" className={chartStyles.title}>
              {t('dashboard.modelDistribution')}
            </h2>
          </div>
          {renderModelDistribution()}
        </section>

        {/* Token Usage Trend Chart */}
        <TokenUsageTrend trendData={trend} loading={loading} />
      </div>
    </>
  )
}
