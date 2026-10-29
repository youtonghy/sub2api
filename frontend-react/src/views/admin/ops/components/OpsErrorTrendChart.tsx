import { TrendingDown } from 'lucide-react'
import { useMemo } from 'react'

import type { OpsErrorTrendPoint } from '@/api/admin/ops'
import { Button } from '@/components/arc/button/button'
import { LineChart, type LineChartDatum, type LineChartSeries } from '@/components/arc/line-chart/line-chart'
import HelpTooltip from '@/components/common/HelpTooltip'
import { useI18n } from '@/i18n/useI18n'
import type { ChartState } from '../types'
import { formatHistoryLabel, sumNumbers } from '../utils/opsFormatters'
import panel from './OpsPanel.module.css'

export interface OpsErrorTrendChartProps {
  points: OpsErrorTrendPoint[]
  loading: boolean
  timeRange: string
  onOpenRequestErrors?: () => void
  onOpenUpstreamErrors?: () => void
}

export default function OpsErrorTrendChart({ points, loading, timeRange, onOpenRequestErrors, onOpenUpstreamErrors }: OpsErrorTrendChartProps) {
  const { t } = useI18n()

  const totalRequestErrors = sumNumbers(points.map((p) => p.error_count_sla ?? 0))
  const totalUpstreamErrors = sumNumbers(
    points.map((p) => (p.upstream_error_count_excl_429_529 ?? 0) + (p.upstream_429_count ?? 0) + (p.upstream_529_count ?? 0))
  )
  const totalDisplayed = sumNumbers(
    points.map((p) => (p.error_count_sla ?? 0) + (p.upstream_error_count_excl_429_529 ?? 0) + (p.business_limited_count ?? 0))
  )

  const hasRequestErrors = totalRequestErrors > 0
  const hasUpstreamErrors = totalUpstreamErrors > 0
  const hasData = points.length > 0 && totalDisplayed > 0

  const data = useMemo<LineChartDatum[]>(() => {
    if (!hasData) return []
    return points.map((p, index) => {
      const label = formatHistoryLabel(p.bucket_start, timeRange)
      return {
        key: `${p.bucket_start}-${index}`,
        label,
        axisLabel: label,
        values: {
          sla: p.error_count_sla ?? 0,
          upstream: p.upstream_error_count_excl_429_529 ?? 0,
          businessLimited: p.business_limited_count ?? 0
        }
      }
    })
  }, [hasData, points, timeRange])

  const slaLabel = t('admin.ops.errorsSla')
  const upstreamLabel = t('admin.ops.upstreamExcl429529')
  const businessLimitedLabel = t('admin.ops.businessLimited')
  const series = useMemo<LineChartSeries[]>(
    () => [
      { key: 'sla', label: slaLabel, color: 'var(--danger)', area: true },
      { key: 'upstream', label: upstreamLabel, area: true },
      { key: 'businessLimited', label: businessLimitedLabel, color: 'var(--text-muted)', dashed: true, area: false }
    ],
    [businessLimitedLabel, slaLabel, upstreamLabel]
  )

  const state: ChartState = hasData ? 'ready' : loading ? 'loading' : 'empty'

  return (
    <section className={[panel.panel, panel.fill].join(' ')}>
      <div className={panel.header}>
        <h2 className={panel.title}>
          <TrendingDown size={16} aria-hidden="true" />
          {t('admin.ops.errorTrend')}
          <HelpTooltip content={t('admin.ops.tooltips.errorTrend')} />
        </h2>
        <div className={panel.toolbar}>
          <Button type="button" variant="secondary" size="sm" disabled={!hasRequestErrors} onClick={() => onOpenRequestErrors?.()}>
            {t('admin.ops.errorDetails.requestErrors')}
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={!hasUpstreamErrors} onClick={() => onOpenUpstreamErrors?.()}>
            {t('admin.ops.errorDetails.upstreamErrors')}
          </Button>
        </div>
      </div>
      <LineChart
        data={data}
        series={series}
        label={t('admin.ops.errorTrend')}
        loading={state === 'loading'}
        emptyLabel={t('admin.ops.charts.emptyError')}
        categoryLabel={t('admin.ops.requestDetails.table.time')}
      />
    </section>
  )
}
