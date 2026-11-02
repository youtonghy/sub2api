import { Fragment, useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import type { UserBreakdownParams } from '@/api/admin/dashboard'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { useI18n } from '@/i18n/useI18n'
import type { EndpointStat } from '@/types'
import {
  distributionColor,
  formatCost,
  formatMetricValue,
  formatNumber,
  formatTokens,
  sortByMetric,
  toFiniteNumber,
  type DistributionMetric
} from './chartUtils'
import DistributionDonut from './DistributionDonut'
import UserBreakdownSubTable from './UserBreakdownSubTable'
import { useUserBreakdown } from './useUserBreakdown'
import styles from './charts.module.css'

export type EndpointSource = 'inbound' | 'upstream' | 'path'

export interface EndpointDistributionChartProps {
  /** 入站端点统计（source = inbound） */
  endpointStats: EndpointStat[]
  /** 上游端点统计（source = upstream） */
  upstreamEndpointStats?: EndpointStat[]
  /** 路径统计（source = path） */
  endpointPathStats?: EndpointStat[]
  loading?: boolean
  /** 标题，默认“端点分布” */
  title?: string
  metric?: DistributionMetric
  source?: EndpointSource
  /** 切换指标（对应 Vue 的 update:metric） */
  onMetricChange?: (metric: DistributionMetric) => void
  /** 切换数据来源（对应 Vue 的 update:source） */
  onSourceChange?: (source: EndpointSource) => void
  showMetricToggle?: boolean
  showSourceToggle?: boolean
  enableBreakdown?: boolean
  startDate?: string
  endDate?: string
  /** 用户明细请求附带的额外筛选条件 */
  filters?: Partial<UserBreakdownParams>
}

/** 端点用量分布：环形图 + 明细表 */
export default function EndpointDistributionChart({
  endpointStats,
  upstreamEndpointStats = [],
  endpointPathStats = [],
  loading = false,
  title = '',
  metric = 'tokens',
  source = 'inbound',
  onMetricChange,
  onSourceChange,
  showMetricToggle = false,
  showSourceToggle = false,
  enableBreakdown = true,
  startDate,
  endDate,
  filters
}: EndpointDistributionChartProps) {
  const { t } = useI18n()
  const breakdown = useUserBreakdown()
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const displayEndpointStats = useMemo(() => {
    const sourceStats =
      source === 'upstream' ? upstreamEndpointStats : source === 'path' ? endpointPathStats : endpointStats
    return sortByMetric(sourceStats, metric)
  }, [source, upstreamEndpointStats, endpointPathStats, endpointStats, metric])

  const chartData = useMemo(
    () =>
      displayEndpointStats.map((item, index) => ({
        key: item.endpoint,
        label: item.endpoint,
        value: toFiniteNumber(metric === 'actual_cost' ? item.actual_cost : item.total_tokens),
        color: distributionColor(index, displayEndpointStats.length)
      })),
    [displayEndpointStats, metric]
  )

  const toggleBreakdown = (endpoint: string) => {
    void breakdown.toggle(endpoint, {
      ...filters,
      start_date: startDate,
      end_date: endDate,
      endpoint,
      endpoint_type: source
    })
  }

  const heading = title || t('usage.endpointDistribution')
  const sourceOptions = [
    { value: 'inbound', label: t('usage.inbound') },
    { value: 'upstream', label: t('usage.upstream') },
    { value: 'path', label: t('usage.path') }
  ]
  const metricOptions = [
    { value: 'tokens', label: t('admin.dashboard.metricTokens') },
    { value: 'actual_cost', label: t('admin.dashboard.metricActualCost') }
  ]

  return (
    <section className={styles.panel} aria-busy={loading || undefined}>
      <div className={styles.header}>
        <h2 className={styles.title}>{heading}</h2>
        <div className={styles.toggles}>
          {showSourceToggle && (
            <SegmentedControl
              label={t('usage.endpoint')}
              options={sourceOptions}
              value={source}
              onValueChange={(value) => onSourceChange?.(value as EndpointSource)}
            />
          )}
          {showMetricToggle && (
            <SegmentedControl
              label={heading}
              options={metricOptions}
              value={metric}
              onValueChange={(value) => onMetricChange?.(value as DistributionMetric)}
            />
          )}
        </div>
      </div>

      {loading ? (
        <Skeleton lines={5} label={t('common.loading')} />
      ) : displayEndpointStats.length > 0 ? (
        <div className={styles.distribution}>
          <DistributionDonut
            data={chartData}
            label={heading}
            formatValue={(value) => formatMetricValue(value, metric)}
            activeKey={hoveredKey}
            onActiveChange={setHoveredKey}
          />
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('usage.endpoint')}</th>
                  <th scope="col">{t('admin.dashboard.requests')}</th>
                  <th scope="col">{t('admin.dashboard.tokens')}</th>
                  <th scope="col">{t('admin.dashboard.actual')}</th>
                  <th scope="col">{t('admin.dashboard.standard')}</th>
                </tr>
              </thead>
              <tbody>
                {displayEndpointStats.map((item, index) => {
                  const expanded = breakdown.expandedKey === item.endpoint
                  const swatch = { '--swatch': distributionColor(index, displayEndpointStats.length) } as CSSProperties
                  return (
                    <Fragment key={item.endpoint}>
                      <tr
                        className={[enableBreakdown ? styles.interactive : '', hoveredKey === item.endpoint ? styles.rowActive : '']
                          .filter(Boolean)
                          .join(' ')}
                        onClick={enableBreakdown ? () => toggleBreakdown(item.endpoint) : undefined}
                        onPointerEnter={() => setHoveredKey(item.endpoint)}
                        onPointerLeave={() => setHoveredKey(null)}
                      >
                        <td title={item.endpoint}>
                          <span className={styles.name}>
                            <span className={styles.swatch} style={swatch} aria-hidden="true" />
                            {enableBreakdown ? (
                              <button type="button" className={styles.toggleButton} aria-expanded={expanded}>
                                {expanded ? (
                                  <ChevronDown className={styles.chevron} size={12} aria-hidden="true" />
                                ) : (
                                  <ChevronRight className={styles.chevron} size={12} aria-hidden="true" />
                                )}
                                <span className={styles.nameText}>{item.endpoint}</span>
                              </button>
                            ) : (
                              <span className={styles.nameText}>{item.endpoint}</span>
                            )}
                          </span>
                        </td>
                        <td>{formatNumber(item.requests)}</td>
                        <td>{formatTokens(item.total_tokens)}</td>
                        <td className={styles.actual}>${formatCost(item.actual_cost)}</td>
                        <td className={styles.standard}>${formatCost(item.cost)}</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={5} className={styles.expandCell}>
                            <UserBreakdownSubTable items={breakdown.items} loading={breakdown.loading} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className={styles.message}>{t('admin.dashboard.noDataAvailable')}</p>
      )}
    </section>
  )
}
