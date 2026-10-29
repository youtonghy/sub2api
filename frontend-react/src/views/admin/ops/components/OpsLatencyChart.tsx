import { Clock } from 'lucide-react'
import { useMemo } from 'react'

import type { OpsLatencyHistogramResponse } from '@/api/admin/ops'
import { BarChart, type BarChartDatum } from '@/components/arc/bar-chart/bar-chart'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import HelpTooltip from '@/components/common/HelpTooltip'
import { useI18n } from '@/i18n/useI18n'
import { formatNumber } from '@/utils/format'
import type { ChartState } from '../types'
import panel from './OpsPanel.module.css'

export interface OpsLatencyChartProps {
  latencyData: OpsLatencyHistogramResponse | null
  loading: boolean
}

export default function OpsLatencyChart({ latencyData, loading }: OpsLatencyChartProps) {
  const { t } = useI18n()

  const hasData = (latencyData?.total_requests ?? 0) > 0
  const state: ChartState = hasData ? 'ready' : loading ? 'loading' : 'empty'

  const data = useMemo<BarChartDatum[]>(() => {
    if (!latencyData || !hasData) return []
    return latencyData.buckets.map((b) => ({ key: b.range, label: b.range, axisLabel: b.range, value: b.count }))
  }, [hasData, latencyData])

  return (
    <section className={[panel.panel, panel.fill].join(' ')}>
      <div className={panel.header}>
        <h2 className={panel.title}>
          <Clock size={16} aria-hidden="true" />
          {t('admin.ops.latencyHistogram')}
          <HelpTooltip content={t('admin.ops.tooltips.latencyHistogram')} />
        </h2>
      </div>
      {state === 'ready' ? (
        <BarChart
          data={data}
          label={t('admin.ops.latencyHistogram')}
          period={`${t('common.total')} ${formatNumber(latencyData?.total_requests ?? 0)}`}
          valueLabel={t('admin.ops.requests')}
          averageLabel={t('admin.ops.average')}
          categoryLabel={t('admin.ops.requestDetails.table.duration')}
          showAverage={false}
        />
      ) : state === 'loading' ? (
        <Skeleton label={t('common.loading')} lines={5} />
      ) : (
        <p className={panel.empty}>{t('admin.ops.charts.emptyRequest')}</p>
      )}
    </section>
  )
}
