import { ListFilter } from 'lucide-react'
import { useMemo } from 'react'

import type { OpsThroughputTrendPoint } from '@/api/admin/ops'
import { LineChart, type LineChartDatum, type LineChartSeries } from '@/components/arc/line-chart/line-chart'
import HelpTooltip from '@/components/common/HelpTooltip'
import { useI18n } from '@/i18n/useI18n'
import type { ChartState } from '../types'
import { formatHistoryLabel, sumNumbers } from '../utils/opsFormatters'
import panel from './OpsPanel.module.css'

export interface OpsSwitchRateTrendChartProps {
  points: OpsThroughputTrendPoint[]
  loading: boolean
  timeRange: string
  fullscreen?: boolean
}

export default function OpsSwitchRateTrendChart({ points, loading, timeRange, fullscreen = false }: OpsSwitchRateTrendChartProps) {
  const { t } = useI18n()

  const totalRequests = sumNumbers(points.map((p) => p.request_count))
  const hasData = points.length > 0 && totalRequests > 0

  const data = useMemo<LineChartDatum[]>(() => {
    if (!hasData) return []
    return points.map((p, index) => {
      const label = formatHistoryLabel(p.bucket_start, timeRange)
      const requests = p.request_count ?? 0
      const switches = p.switch_count ?? 0
      return {
        key: `${p.bucket_start}-${index}`,
        label,
        axisLabel: label,
        values: { switchRate: requests <= 0 ? 0 : switches / requests }
      }
    })
  }, [hasData, points, timeRange])

  const switchRateLabel = t('admin.ops.switchRate')
  const series = useMemo<LineChartSeries[]>(() => [{ key: 'switchRate', label: switchRateLabel, area: true }], [switchRateLabel])

  const state: ChartState = hasData ? 'ready' : loading ? 'loading' : 'empty'

  return (
    <section className={[panel.panel, panel.fill].join(' ')}>
      <div className={panel.header}>
        <h2 className={panel.title}>
          <ListFilter size={16} aria-hidden="true" />
          {t('admin.ops.switchRateTrend')}
          {!fullscreen && <HelpTooltip content={t('admin.ops.tooltips.switchRateTrend')} />}
        </h2>
      </div>
      <LineChart
        data={data}
        series={series}
        label={t('admin.ops.switchRateTrend')}
        loading={state === 'loading'}
        emptyLabel={t('admin.ops.charts.emptyRequest')}
        categoryLabel={t('admin.ops.requestDetails.table.time')}
        height={fullscreen ? 280 : 220}
        formatValue={(value) => value.toFixed(3)}
        formatTick={(value) => Number(value).toFixed(3)}
        legend={false}
      />
    </section>
  )
}
