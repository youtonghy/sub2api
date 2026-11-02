import { TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'

import type { OpsErrorDistributionResponse } from '@/api/admin/ops'
import { Button } from '@/components/arc/button/button'
import { SplitBar, type SplitSegment } from '@/components/arc/split-bar/split-bar'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useSplitBarLabels } from '@/components/charts/useArcChartLabels'
import HelpTooltip from '@/components/common/HelpTooltip'
import { useI18n } from '@/i18n/useI18n'
import type { ChartState } from '../types'
import panel from './OpsPanel.module.css'
import styles from './OpsErrorDistributionChart.module.css'

export interface OpsErrorDistributionChartProps {
  data: OpsErrorDistributionResponse | null
  loading: boolean
  onOpenDetails?: () => void
}

interface ErrorCategory {
  key: string
  label: string
  count: number
  color: string
}

// 颜色语义：上游错误=警告色，客户端错误=分类色，系统错误=危险色，其他=弱化文字色。
const CATEGORY_COLORS = {
  upstream: 'var(--warning)',
  client: 'var(--chart-cat-1)',
  system: 'var(--danger)',
  other: 'var(--text-muted)'
} as const

export default function OpsErrorDistributionChart({ data, loading, onOpenDetails }: OpsErrorDistributionChartProps) {
  const { t } = useI18n()
  const splitLabels = useSplitBarLabels()

  const totalSlaErrors = (data?.items ?? []).reduce((total, item) => total + Number(item.sla || 0), 0)
  const hasData = totalSlaErrors > 0
  const state: ChartState = hasData ? 'ready' : loading ? 'loading' : 'empty'

  const categories = useMemo<ErrorCategory[]>(() => {
    if (!data) return []

    let upstream = 0 // 502, 503, 504
    let client = 0 // 4xx
    let system = 0 // 500
    let other = 0

    for (const item of data.items || []) {
      const code = Number(item.status_code || 0)
      const count = Number(item.sla || 0)
      if (!Number.isFinite(code) || !Number.isFinite(count)) continue

      if ([502, 503, 504].includes(code)) upstream += count
      else if (code >= 400 && code < 500) client += count
      else if (code === 500) system += count
      else other += count
    }

    const out: ErrorCategory[] = []
    if (upstream > 0) out.push({ key: 'upstream', label: t('admin.ops.upstream'), count: upstream, color: CATEGORY_COLORS.upstream })
    if (client > 0) out.push({ key: 'client', label: t('admin.ops.client'), count: client, color: CATEGORY_COLORS.client })
    if (system > 0) out.push({ key: 'system', label: t('admin.ops.system'), count: system, color: CATEGORY_COLORS.system })
    if (other > 0) out.push({ key: 'other', label: t('admin.ops.other'), count: other, color: CATEGORY_COLORS.other })
    return out
  }, [data, t])

  const topReason = categories.length === 0 ? null : categories.reduce((prev, cur) => (cur.count > prev.count ? cur : prev))

  const chartData = useMemo<SplitSegment[] | null>(() => {
    if (!hasData || categories.length === 0) return null
    return categories.map((c) => ({ id: c.key, label: c.label, value: c.count, color: c.color }))
  }, [categories, hasData])

  return (
    <section className={[panel.panel, panel.fill].join(' ')}>
      <div className={panel.header}>
        <h2 className={panel.title}>
          <TriangleAlert size={16} aria-hidden="true" />
          {t('admin.ops.errorDistribution')}
          <HelpTooltip content={t('admin.ops.tooltips.errorDistribution')} />
        </h2>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={state !== 'ready'}
          title={t('admin.ops.errorTrend')}
          onClick={() => onOpenDetails?.()}
        >
          {t('admin.ops.requestDetails.details')}
        </Button>
      </div>

      {state === 'ready' && chartData ? (
        <div className={styles.ready}>
          {topReason && (
            <div className={styles.top}>
              {t('admin.ops.top')}: <span style={{ color: topReason.color }}>{topReason.label}</span>
            </div>
          )}
          {/* 分段条自带图例（可点击隐藏某类错误），悬停分段在右上角读出错误数 */}
          <SplitBar
            className={styles.bar}
            segments={chartData}
            label={t('admin.ops.errorDistribution')}
            totalLabel={splitLabels.total}
            labels={splitLabels}
          />
        </div>
      ) : state === 'loading' ? (
        <Skeleton label={t('common.loading')} lines={4} />
      ) : (
        <p data-testid="ops-chart-empty" className={panel.empty}>
          {t('admin.ops.charts.emptyError')}
        </p>
      )}
    </section>
  )
}
