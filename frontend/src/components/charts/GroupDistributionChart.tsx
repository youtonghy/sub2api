import { Fragment, useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import type { UserBreakdownParams } from '@/api/admin/dashboard'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { useI18n } from '@/i18n/useI18n'
import type { GroupStat } from '@/types'
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

export interface GroupDistributionChartProps {
  groupStats: GroupStat[]
  loading?: boolean
  metric?: DistributionMetric
  /** 切换指标（对应 Vue 的 update:metric），配合 showMetricToggle 使用 */
  onMetricChange?: (metric: DistributionMetric) => void
  showMetricToggle?: boolean
  /** 点击分组行展开用户明细（未分组的行不可展开） */
  enableBreakdown?: boolean
  showAccountCost?: boolean
  startDate?: string
  endDate?: string
  /** 用户明细请求附带的额外筛选条件 */
  filters?: Partial<UserBreakdownParams>
}

/** 分组用量分布：环形图 + 明细表 */
export default function GroupDistributionChart({
  groupStats,
  loading = false,
  metric = 'tokens',
  onMetricChange,
  showMetricToggle = false,
  enableBreakdown = true,
  showAccountCost = true,
  startDate,
  endDate,
  filters
}: GroupDistributionChartProps) {
  const { t } = useI18n()
  const breakdown = useUserBreakdown()
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const displayGroupStats = useMemo(() => sortByMetric(groupStats, metric), [groupStats, metric])
  const keyOf = (group: GroupStat) => `group-${group.group_id}`

  const chartData = useMemo(
    () =>
      displayGroupStats.map((group, index) => ({
        key: `group-${group.group_id}`,
        label: group.group_name || String(group.group_id),
        value: toFiniteNumber(metric === 'actual_cost' ? group.actual_cost : group.total_tokens),
        color: distributionColor(index, displayGroupStats.length)
      })),
    [displayGroupStats, metric]
  )

  const canExpand = (group: GroupStat) => enableBreakdown && group.group_id > 0
  const toggleBreakdown = (group: GroupStat) => {
    void breakdown.toggle(keyOf(group), {
      ...filters,
      start_date: startDate,
      end_date: endDate,
      group_id: Number(group.group_id)
    })
  }

  const metricOptions = [
    { value: 'tokens', label: t('admin.dashboard.metricTokens') },
    { value: 'actual_cost', label: t('admin.dashboard.metricActualCost') }
  ]

  return (
    <section className={styles.panel} aria-busy={loading || undefined}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('admin.dashboard.groupDistribution')}</h2>
        {showMetricToggle && (
          <SegmentedControl
            label={t('admin.dashboard.groupDistribution')}
            options={metricOptions}
            value={metric}
            onValueChange={(value) => onMetricChange?.(value as DistributionMetric)}
          />
        )}
      </div>

      {loading ? (
        <Skeleton lines={5} label={t('common.loading')} />
      ) : displayGroupStats.length > 0 ? (
        <div className={styles.distribution}>
          <DistributionDonut
            data={chartData}
            label={t('admin.dashboard.groupDistribution')}
            formatValue={(value) => formatMetricValue(value, metric)}
            activeKey={hoveredKey}
            onActiveChange={setHoveredKey}
          />
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('admin.dashboard.group')}</th>
                  <th scope="col">{t('admin.dashboard.requests')}</th>
                  <th scope="col">{t('admin.dashboard.tokens')}</th>
                  <th scope="col">{t('admin.dashboard.actual')}</th>
                  {showAccountCost && <th scope="col">{t('admin.dashboard.accountCost')}</th>}
                  <th scope="col">{t('admin.dashboard.standard')}</th>
                </tr>
              </thead>
              <tbody>
                {displayGroupStats.map((group, index) => {
                  const key = keyOf(group)
                  const expandable = canExpand(group)
                  const expanded = breakdown.expandedKey === key
                  const name = group.group_name || t('admin.dashboard.noGroup')
                  const swatch = { '--swatch': distributionColor(index, displayGroupStats.length) } as CSSProperties
                  return (
                    <Fragment key={group.group_id}>
                      <tr
                        className={[expandable ? styles.interactive : '', hoveredKey === key ? styles.rowActive : '']
                          .filter(Boolean)
                          .join(' ')}
                        onClick={expandable ? () => toggleBreakdown(group) : undefined}
                        onPointerEnter={() => setHoveredKey(key)}
                        onPointerLeave={() => setHoveredKey(null)}
                      >
                        <td title={group.group_name || String(group.group_id)}>
                          <span className={styles.name}>
                            <span className={styles.swatch} style={swatch} aria-hidden="true" />
                            {expandable ? (
                              <button type="button" className={styles.toggleButton} aria-expanded={expanded}>
                                {expanded ? (
                                  <ChevronDown className={styles.chevron} size={12} aria-hidden="true" />
                                ) : (
                                  <ChevronRight className={styles.chevron} size={12} aria-hidden="true" />
                                )}
                                <span className={styles.nameText}>{name}</span>
                              </button>
                            ) : (
                              <span className={styles.nameText}>{name}</span>
                            )}
                          </span>
                        </td>
                        <td>{formatNumber(group.requests)}</td>
                        <td>{formatTokens(group.total_tokens)}</td>
                        <td className={styles.actual}>${formatCost(group.actual_cost)}</td>
                        {showAccountCost && <td className={styles.accountCost}>${formatCost(group.account_cost)}</td>}
                        <td className={styles.standard}>${formatCost(group.cost)}</td>
                      </tr>
                      {/* User breakdown sub-rows */}
                      {expanded && (
                        <tr>
                          <td colSpan={showAccountCost ? 6 : 5} className={styles.expandCell}>
                            <UserBreakdownSubTable
                              items={breakdown.items}
                              loading={breakdown.loading}
                              showAccountCost={showAccountCost}
                            />
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
