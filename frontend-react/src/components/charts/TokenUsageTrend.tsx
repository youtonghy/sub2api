import { useMemo, useState } from 'react'

import { LineChart, type LineChartDatum, type LineChartSeries } from '@/components/arc/line-chart/line-chart'
import { useI18n } from '@/i18n/useI18n'
import type { TrendDataPoint } from '@/types'
import { axisLabelOf, cacheHitRate, formatCost, formatTokens } from './chartUtils'
import { useKeepOneSeries } from './useKeepOneSeries'
import styles from './charts.module.css'

export interface TokenUsageTrendProps {
  trendData: TrendDataPoint[]
  loading?: boolean
}

// 系列名称沿用 Vue 版的英文字面量
const TOKEN_SERIES: LineChartSeries[] = [
  { key: 'input', label: 'Input', color: 'var(--series-1)', area: true },
  { key: 'output', label: 'Output', color: 'var(--series-2)', area: true },
  { key: 'cacheCreation', label: 'Cache Creation', color: 'var(--series-3)', area: true },
  { key: 'cacheRead', label: 'Cache Read', color: 'var(--series-4)', area: true }
]

const HIT_RATE_SERIES: LineChartSeries[] = [
  { key: 'cacheHitRate', label: 'Cache Hit Rate', color: 'var(--chart-cat-5)', dashed: true, area: false }
]

/**
 * Token 用量趋势。Vue 版是一张双 y 轴折线图；这里拆成两张共享横轴日期的图：
 * 上方为四类 token 面积折线，下方为缓存命中率（%）的紧凑折线。
 * Vue 版 tooltip 页脚的“实际 / 标准费用”改为图下方的说明行，显示悬停点（未悬停时为最新点）。
 */
export default function TokenUsageTrend({ trendData, loading = false }: TokenUsageTrendProps) {
  const { t } = useI18n()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const tokenSeries = useKeepOneSeries(TOKEN_SERIES)
  const hitRateSeries = useKeepOneSeries(HIT_RATE_SERIES)

  const tokenData = useMemo<LineChartDatum[]>(
    () =>
      trendData.map((d) => ({
        key: d.date,
        label: d.date,
        axisLabel: axisLabelOf(d.date),
        values: {
          input: d.input_tokens,
          output: d.output_tokens,
          cacheCreation: d.cache_creation_tokens,
          cacheRead: d.cache_read_tokens
        }
      })),
    [trendData]
  )

  const hitRateData = useMemo<LineChartDatum[]>(
    () =>
      trendData.map((d) => ({
        key: d.date,
        label: d.date,
        axisLabel: axisLabelOf(d.date),
        values: { cacheHitRate: cacheHitRate(d) }
      })),
    [trendData]
  )

  const onActiveChange = (index: number | null) => setActiveIndex(index)
  const point = trendData.length ? trendData[Math.min(activeIndex ?? trendData.length - 1, trendData.length - 1)] : null
  const empty = trendData.length === 0

  return (
    <section className={styles.panel} aria-busy={loading || undefined}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('admin.dashboard.tokenUsageTrend')}</h2>
      </div>
      <div className={styles.trend}>
        <LineChart
          data={tokenData}
          series={TOKEN_SERIES}
          label={t('admin.dashboard.tokenUsageTrend')}
          height={192}
          loading={loading}
          emptyLabel={t('admin.dashboard.noDataAvailable')}
          formatValue={(value) => formatTokens(value)}
          formatTick={(value) => formatTokens(value)}
          hiddenSeries={tokenSeries.hidden}
          onHiddenSeriesChange={tokenSeries.onHiddenChange}
          onActiveChange={onActiveChange}
        />
        {!empty && (
          <LineChart
            data={hitRateData}
            series={HIT_RATE_SERIES}
            label="Cache Hit Rate"
            height={72}
            loading={loading}
            legend
            hiddenSeries={hitRateSeries.hidden}
            onHiddenSeriesChange={hitRateSeries.onHiddenChange}
            formatValue={(value) => `${value.toFixed(1)}%`}
            formatTick={(value) => `${value}%`}
            onActiveChange={onActiveChange}
          />
        )}
        {point && (
          <p className={styles.caption} aria-live="off">
            <span className={styles.captionDate}>{point.date}</span>
            <span>
              {t('admin.dashboard.actual')} ${formatCost(point.actual_cost)}
            </span>
            <span>
              {t('admin.dashboard.standard')} ${formatCost(point.cost)}
            </span>
          </p>
        )}
      </div>
    </section>
  )
}
