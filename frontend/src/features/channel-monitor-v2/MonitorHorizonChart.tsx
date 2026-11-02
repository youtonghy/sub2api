/**
 * 地平线视图：每个维度一行，按时间桶显示成功率相对该行整体成功率的偏离（百分点），
 * 高于平均折叠为强调色色带，低于平均为橙色色带，颜色越深偏离越大。基于 Arc Pro horizon-chart。
 * 没有请求的时间桶按平均值（0 偏离）处理。
 */
import { useMemo } from 'react'

import type { MonitorCoverage, MonitorMatrixRow } from '@/api/channelMonitorV2'
import { HorizonChart, type HorizonDay } from '@/components/arc/blocks/horizon-chart/horizon-chart'
import { useHorizonChartLabels } from '@/components/charts/useArcChartLabels'
import EmptyState from '@/components/common/EmptyState'
import { useI18n } from '@/i18n/useI18n'
import { coverageBucketStarts, deviationSeries, formatDeviation } from './monitorViewModel'
import styles from './MonitorHorizonChart.module.css'

export interface MonitorHorizonChartProps {
  rows: MonitorMatrixRow[]
  coverage: MonitorCoverage
}

const TICK_COUNT = 6

export default function MonitorHorizonChart({ rows, coverage }: MonitorHorizonChartProps) {
  const { t, locale } = useI18n()
  const labels = useHorizonChartLabels()

  const bucketStarts = useMemo(
    () =>
      coverageBucketStarts({
        bucket_seconds: coverage.bucket_seconds,
        requested_start: coverage.requested_start,
        requested_end: coverage.requested_end,
        data_through: coverage.data_through
      }),
    [coverage.bucket_seconds, coverage.requested_start, coverage.requested_end, coverage.data_through]
  )

  const series = useMemo(() => deviationSeries(rows, bucketStarts, t('channelMonitorV2.otherModels')), [rows, bucketStarts, t])

  const { days, ticks } = useMemo(() => {
    const multiDay = coverage.bucket_seconds >= 3600 && bucketStarts.length * coverage.bucket_seconds > 86_400
    const short = new Intl.DateTimeFormat(locale || undefined, multiDay ? { month: '2-digit', day: '2-digit', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
    const full = new Intl.DateTimeFormat(locale || undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const endTime = new Intl.DateTimeFormat(locale || undefined, { hour: '2-digit', minute: '2-digit' })
    const days: HorizonDay[] = bucketStarts.map((start) => {
      const from = new Date(start)
      const to = new Date(from.getTime() + coverage.bucket_seconds * 1000)
      return { short: short.format(from), long: `${full.format(from)} - ${endTime.format(to)}` }
    })
    const last = days.length - 1
    const step = Math.max(1, Math.round(last / (TICK_COUNT - 1)))
    const ticks = days.length ? Array.from({ length: Math.floor(last / step) + 1 }, (_, i) => ({ index: i * step, label: days[i * step].short })) : []
    return { days, ticks }
  }, [bucketStarts, coverage.bucket_seconds, locale])

  // 色带满格的偏离量：取最大偏离向上取整，至少 1 个百分点，避免平稳数据被放大成满屏色块
  const extent = useMemo(() => {
    let max = 0
    for (const item of series) for (const value of item.values) max = Math.max(max, Math.abs(value))
    return Math.max(1, Math.ceil(max))
  }, [series])

  if (!rows.length || !bucketStarts.length) {
    return (
      <section className={styles.empty}>
        <EmptyState title={t('channelMonitorV2.matrix.emptyTitle')} />
      </section>
    )
  }

  return (
    <HorizonChart
      className={styles.horizon}
      series={series}
      days={days}
      ticks={ticks}
      title={t('channelMonitorV2.horizon.title')}
      description={t('channelMonitorV2.horizon.description')}
      baselineLabel={t('channelMonitorV2.horizon.baseline')}
      defaultSort="peak"
      defaultBands={3}
      extent={extent}
      formatValue={formatDeviation}
      labels={labels}
    />
  )
}
