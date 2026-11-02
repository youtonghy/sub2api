/**
 * 趋势折线图，对应 Vue 版 MonitorTrendChart.vue（chart.js 双 Y 轴）。
 * React 版用 Arc line-chart：错误率与缓存率（百分比）一张图，首 Token P50（毫秒）拆成共享 X 轴的第二张小图。
 * 数据按相邻 3 点平滑；滚轮缩放横向、Shift+滚轮平移，数据变化时重置缩放。
 */
import { LineChart as LineChartIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { MonitorCoverage, MonitorHealth, MonitorMetric } from '@/api/channelMonitorV2'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { LineChart, type LineChartDatum, type LineChartSeries } from '@/components/arc/line-chart/line-chart'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import EmptyState from '@/components/common/EmptyState'
import { useI18n } from '@/i18n/useI18n'
import { bucketSpanLabel } from './bucketLabel'
import { formatMonitorMs, formatMonitorPercent } from './monitorFormat'
import { applyWheelZoom, clientXRatio, isZoomed, resetZoom, sliceByZoom, type ZoomState } from './monitorZoom'
import { smoothTrend } from './monitorViewModel'
import styles from './MonitorTrendChart.module.css'

export interface MonitorTrendPoint {
  bucket_start: string
  metrics: MonitorMetric
  health: MonitorHealth
}

export interface MonitorTrendChartProps {
  trend: MonitorTrendPoint[]
  coverage: MonitorCoverage | null
  loading?: boolean
}

export default function MonitorTrendChart({ trend, coverage, loading = false }: MonitorTrendChartProps) {
  const { t, locale } = useI18n()
  const chartRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<ZoomState>(resetZoom)
  const zoomed = isZoomed(zoom)

  // trend 变化时重置缩放（Vue 版 watch(() => props.trend)）
  const [lastTrend, setLastTrend] = useState(trend)
  if (lastTrend !== trend) {
    setLastTrend(trend)
    setZoom(resetZoom())
  }

  /** Window the series by zoom state around the cursor — not always the last N points. */
  const visibleTrend = useMemo(() => sliceByZoom(trend || [], zoom), [trend, zoom])

  const { percentData, ttftData } = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale || undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const errorRates = smoothTrend(visibleTrend.map((p) => (p.metrics.error_rate || 0) * 100))
    const cacheRates = smoothTrend(visibleTrend.map((p) => (p.metrics.cache_rate || 0) * 100))
    const ttftP50 = smoothTrend(visibleTrend.map((p) => p.metrics.ttft?.p50_ms ?? null))
    const base = visibleTrend.map((p) => {
      const label = format.format(new Date(p.bucket_start))
      return { key: p.bucket_start, label, axisLabel: label }
    })
    return {
      percentData: base.map<LineChartDatum>((point, index) => ({
        ...point,
        values: { error: errorRates[index] ?? undefined, cache: cacheRates[index] ?? undefined }
      })),
      // Arc 折线图会把缺失值画成 0；TTFT 只绘制有数据的时间桶，避免出现虚假的 0（Vue 版此处为断开的空隙）
      ttftData: base
        .map<LineChartDatum>((point, index) => ({ ...point, values: { ttft: ttftP50[index] ?? undefined } }))
        .filter((point) => typeof point.values.ttft === 'number' && Number.isFinite(point.values.ttft))
    }
  }, [visibleTrend, locale])

  const percentSeries: LineChartSeries[] = [
    { key: 'error', label: t('channelMonitorV2.chart.errorDataset'), color: 'var(--danger)', area: true },
    { key: 'cache', label: t('channelMonitorV2.chart.cacheDataset'), color: 'var(--success)', area: false }
  ]
  const ttftSeries: LineChartSeries[] = [{ key: 'ttft', label: t('channelMonitorV2.chart.ttftDataset'), area: false }]

  // Plain vertical wheel zooms X (narrower time range); shift/horizontal pans.
  // React 的 wheel 监听是被动的，这里在原生节点上注册非被动监听以便 preventDefault。
  const hasData = visibleTrend.length > 0
  useEffect(() => {
    const node = chartRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const ratio = clientXRatio(event.clientX, node)
      setZoom((current) => applyWheelZoom(current, event, ratio))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [hasData, loading])

  const bucketMinutes = (coverage?.bucket_seconds || 60) / 60

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>
            <LineChartIcon size={16} strokeWidth={1.75} className={styles.titleIcon} aria-hidden="true" />
            {t('channelMonitorV2.chart.title')}
          </h2>
          <p className={styles.description}>{t('channelMonitorV2.chart.description')}</p>
        </div>
        <div className={styles.tools}>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} data-series="error" aria-hidden="true" />
            {t('channelMonitorV2.chart.errorLegend')}
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} data-series="cache" aria-hidden="true" />
            {t('channelMonitorV2.chart.cacheLegend')}
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} data-series="ttft" aria-hidden="true" />
            {t('channelMonitorV2.chart.ttftLegend')}
          </span>
          <Badge size="sm">{bucketSpanLabel(t, bucketMinutes)}</Badge>
          <Button type="button" variant="secondary" size="sm" disabled={!zoomed} onClick={() => setZoom(resetZoom())}>
            {t('channelMonitorV2.chart.resetZoom')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className={styles.placeholder}>
          <Skeleton label={t('common.loading')} lines={6} />
        </div>
      ) : hasData ? (
        <div ref={chartRef} className={styles.charts}>
          <LineChart
            data={percentData}
            series={percentSeries}
            label={t('channelMonitorV2.chart.percentAxis')}
            height={200}
            legend={false}
            formatValue={(value) => formatMonitorPercent(value / 100)}
            formatTick={(value) => `${value}%`}
          />
          <LineChart
            data={ttftData}
            series={ttftSeries}
            label={t('channelMonitorV2.metrics.ttftP50')}
            height={110}
            legend={false}
            formatValue={(value) => formatMonitorMs(value)}
            formatTick={(value) => formatMonitorMs(value)}
          />
        </div>
      ) : (
        <div className={styles.placeholder}>
          <EmptyState title={t('channelMonitorV2.chart.emptyTitle')} description={t('channelMonitorV2.empty.description')} />
        </div>
      )}
    </section>
  )
}
