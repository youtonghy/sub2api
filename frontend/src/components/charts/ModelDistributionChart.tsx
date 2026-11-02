import { Fragment, useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import type { UserBreakdownParams } from '@/api/admin/dashboard'
import { Alert } from '@/components/arc/alert/alert'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { useI18n } from '@/i18n/useI18n'
import type { ModelStat, UserSpendingRankingItem } from '@/types'
import {
  OTHER_COLOR,
  distributionColor,
  formatCost,
  formatMetricValue,
  formatNumber,
  formatTokens,
  getRankingUserLabel,
  sortByMetric,
  toFiniteNumber,
  type DistributionMetric
} from './chartUtils'
import DistributionDonut from './DistributionDonut'
import UserBreakdownSubTable from './UserBreakdownSubTable'
import { useUserBreakdown } from './useUserBreakdown'
import styles from './charts.module.css'

export type ModelSource = 'requested' | 'upstream' | 'mapping'
type DistributionView = 'model_distribution' | 'spending_ranking'
type RankingDisplayItem = UserSpendingRankingItem & { isOther?: boolean }

export interface ModelDistributionChartProps {
  /** 请求模型统计（source = requested） */
  modelStats: ModelStat[]
  /** 上游模型统计（source = upstream） */
  upstreamModelStats?: ModelStat[]
  /** 模型映射统计（source = mapping） */
  mappingModelStats?: ModelStat[]
  source?: ModelSource
  /** 切换数据来源（对应 Vue 的 update:source），配合 showSourceToggle 使用 */
  onSourceChange?: (source: ModelSource) => void
  /** 显示“模型分布 / 用户消费排行”视图切换 */
  enableRankingView?: boolean
  rankingItems?: UserSpendingRankingItem[]
  /** 区间内全部用户的合计，用来计算排行之外的“其他”项 */
  rankingTotalActualCost?: number
  rankingTotalRequests?: number
  rankingTotalTokens?: number
  loading?: boolean
  metric?: DistributionMetric
  /** 切换指标（对应 Vue 的 update:metric），配合 showMetricToggle 使用 */
  onMetricChange?: (metric: DistributionMetric) => void
  showSourceToggle?: boolean
  showMetricToggle?: boolean
  /** 点击模型行展开用户明细 */
  enableBreakdown?: boolean
  showAccountCost?: boolean
  rankingLoading?: boolean
  rankingError?: boolean
  startDate?: string
  endDate?: string
  /** 用户明细请求附带的额外筛选条件 */
  filters?: Partial<UserBreakdownParams>
  /** 点击排行中的用户行（“其他”行不可点击），对应 Vue 的 ranking-click */
  onRankingClick?: (item: UserSpendingRankingItem) => void
}

const OTHERS_KEY = 'ranking-others'
const rankingKeyOf = (item: RankingDisplayItem, index: number) =>
  item.isOther ? OTHERS_KEY : `ranking-${item.user_id}-${index}`

/** 模型用量分布，可切换为用户消费排行 */
export default function ModelDistributionChart({
  modelStats,
  upstreamModelStats = [],
  mappingModelStats = [],
  source = 'requested',
  onSourceChange,
  enableRankingView = false,
  rankingItems = [],
  rankingTotalActualCost = 0,
  rankingTotalRequests = 0,
  rankingTotalTokens = 0,
  loading = false,
  metric = 'tokens',
  onMetricChange,
  showSourceToggle = false,
  showMetricToggle = false,
  enableBreakdown = true,
  showAccountCost = true,
  rankingLoading = false,
  rankingError = false,
  startDate,
  endDate,
  filters,
  onRankingClick
}: ModelDistributionChartProps) {
  const { t } = useI18n()
  const breakdown = useUserBreakdown()
  const [activeView, setActiveView] = useState<DistributionView>('model_distribution')
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const distributionColspan = showAccountCost ? 6 : 5

  const displayModelStats = useMemo(() => {
    const sourceStats = source === 'upstream' ? upstreamModelStats : source === 'mapping' ? mappingModelStats : modelStats
    return sortByMetric(sourceStats, metric)
  }, [source, upstreamModelStats, mappingModelStats, modelStats, metric])

  const chartData = useMemo(
    () =>
      displayModelStats.map((m, index) => ({
        key: `model-${m.model}`,
        label: m.model,
        value: toFiniteNumber(metric === 'actual_cost' ? m.actual_cost : m.total_tokens),
        color: distributionColor(index, displayModelStats.length)
      })),
    [displayModelStats, metric]
  )

  const otherRankingItem = useMemo<RankingDisplayItem | null>(() => {
    if (!rankingItems?.length) return null

    const rankedActualCost = rankingItems.reduce((sum, item) => sum + toFiniteNumber(item.actual_cost), 0)
    const rankedRequests = rankingItems.reduce((sum, item) => sum + toFiniteNumber(item.requests), 0)
    const rankedTokens = rankingItems.reduce((sum, item) => sum + toFiniteNumber(item.tokens), 0)

    const otherActualCost = Math.max((rankingTotalActualCost || 0) - rankedActualCost, 0)
    const otherRequests = Math.max((rankingTotalRequests || 0) - rankedRequests, 0)
    const otherTokens = Math.max((rankingTotalTokens || 0) - rankedTokens, 0)

    if (otherActualCost <= 0.000001 && otherRequests <= 0 && otherTokens <= 0) return null

    return {
      user_id: 0,
      email: '',
      username: '',
      actual_cost: otherActualCost,
      requests: otherRequests,
      tokens: otherTokens,
      isOther: true
    }
  }, [rankingItems, rankingTotalActualCost, rankingTotalRequests, rankingTotalTokens])

  const rankingDisplayItems = useMemo<RankingDisplayItem[]>(() => {
    if (!rankingItems?.length) return []
    return otherRankingItem ? [...rankingItems, otherRankingItem] : [...rankingItems]
  }, [rankingItems, otherRankingItem])

  const rankingColor = (item: RankingDisplayItem, index: number) =>
    item.isOther ? OTHER_COLOR : distributionColor(index, rankingItems.length)

  const getRankingRowLabel = (item: RankingDisplayItem): string => {
    if (item.isOther) return t('admin.dashboard.spendingRankingOther')
    return getRankingUserLabel(item)
  }

  const rankingChartData = useMemo(
    () =>
      rankingDisplayItems.map((item, index) => ({
        key: rankingKeyOf(item, index),
        label: item.isOther ? t('admin.dashboard.spendingRankingOther') : `#${index + 1} ${getRankingUserLabel(item)}`,
        value: toFiniteNumber(item.actual_cost),
        color: item.isOther ? OTHER_COLOR : distributionColor(index, rankingItems.length)
      })),
    [rankingDisplayItems, rankingItems.length, t]
  )

  const toggleBreakdown = (model: string) => {
    void breakdown.toggle(`model-${model}`, {
      ...filters,
      start_date: startDate,
      end_date: endDate,
      model,
      model_source: source
    })
  }

  const isDistribution = !enableRankingView || activeView === 'model_distribution'
  const heading = isDistribution ? t('admin.dashboard.modelDistribution') : t('admin.dashboard.spendingRankingTitle')
  const rowClass = (interactive: boolean, key: string, extra = '') =>
    [interactive ? styles.interactive : '', hoveredKey === key ? styles.rowActive : '', extra].filter(Boolean).join(' ')

  const sourceOptions = [
    { value: 'requested', label: t('usage.requestedModel') },
    { value: 'upstream', label: t('usage.upstreamModel') },
    { value: 'mapping', label: t('usage.mapping') }
  ]
  const metricOptions = [
    { value: 'tokens', label: t('admin.dashboard.metricTokens') },
    { value: 'actual_cost', label: t('admin.dashboard.metricActualCost') }
  ]
  const viewOptions = [
    { value: 'model_distribution', label: t('admin.dashboard.viewModelDistribution') },
    { value: 'spending_ranking', label: t('admin.dashboard.viewSpendingRanking') }
  ]

  const renderDistribution = () => {
    if (loading) return <Skeleton lines={5} label={t('common.loading')} />
    if (!displayModelStats.length) return <p className={styles.message}>{t('admin.dashboard.noDataAvailable')}</p>
    return (
      <div className={styles.distribution}>
        <DistributionDonut
          data={chartData}
          label={t('admin.dashboard.modelDistribution')}
          formatValue={(value) => formatMetricValue(value, metric)}
          activeKey={hoveredKey}
          onActiveChange={setHoveredKey}
        />
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('admin.dashboard.model')}</th>
                <th scope="col">{t('admin.dashboard.requests')}</th>
                <th scope="col">{t('admin.dashboard.tokens')}</th>
                <th scope="col">{t('admin.dashboard.actual')}</th>
                {showAccountCost && <th scope="col">{t('admin.dashboard.accountCost')}</th>}
                <th scope="col">{t('admin.dashboard.standard')}</th>
              </tr>
            </thead>
            <tbody>
              {displayModelStats.map((model, index) => {
                const key = `model-${model.model}`
                const expanded = breakdown.expandedKey === key
                const swatch = { '--swatch': distributionColor(index, displayModelStats.length) } as CSSProperties
                return (
                  <Fragment key={model.model}>
                    <tr
                      className={rowClass(enableBreakdown, key)}
                      onClick={enableBreakdown ? () => toggleBreakdown(model.model) : undefined}
                      onPointerEnter={() => setHoveredKey(key)}
                      onPointerLeave={() => setHoveredKey(null)}
                    >
                      <td title={model.model}>
                        <span className={styles.name}>
                          <span className={styles.swatch} style={swatch} aria-hidden="true" />
                          {enableBreakdown ? (
                            <button type="button" className={styles.toggleButton} aria-expanded={expanded}>
                              {expanded ? (
                                <ChevronDown className={styles.chevron} size={12} aria-hidden="true" />
                              ) : (
                                <ChevronRight className={styles.chevron} size={12} aria-hidden="true" />
                              )}
                              <span className={styles.nameText}>{model.model}</span>
                            </button>
                          ) : (
                            <span className={styles.nameText}>{model.model}</span>
                          )}
                        </span>
                      </td>
                      <td>{formatNumber(model.requests)}</td>
                      <td>{formatTokens(model.total_tokens)}</td>
                      <td className={styles.actual}>${formatCost(model.actual_cost)}</td>
                      {showAccountCost && <td className={styles.accountCost}>${formatCost(model.account_cost)}</td>}
                      <td className={styles.standard}>${formatCost(model.cost)}</td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={distributionColspan} className={styles.expandCell}>
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
    )
  }

  const renderRanking = () => {
    if (rankingLoading) return <Skeleton lines={5} label={t('common.loading')} />
    if (rankingError) return <Alert tone="danger" title={t('admin.dashboard.failedToLoad')} />
    if (!rankingDisplayItems.length) return <p className={styles.message}>{t('admin.dashboard.noDataAvailable')}</p>
    return (
      <div className={styles.distribution}>
        <DistributionDonut
          data={rankingChartData}
          label={t('admin.dashboard.spendingRankingTitle')}
          formatValue={(value) => `$${formatCost(value)}`}
          activeKey={hoveredKey}
          onActiveChange={setHoveredKey}
        />
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('admin.dashboard.spendingRankingUser')}</th>
                <th scope="col">{t('admin.dashboard.spendingRankingRequests')}</th>
                <th scope="col">{t('admin.dashboard.spendingRankingTokens')}</th>
                <th scope="col">{t('admin.dashboard.spendingRankingSpend')}</th>
              </tr>
            </thead>
            <tbody>
              {rankingDisplayItems.map((item, index) => {
                const key = rankingKeyOf(item, index)
                const label = getRankingRowLabel(item)
                const swatch = { '--swatch': rankingColor(item, index) } as CSSProperties
                return (
                  <tr
                    key={item.isOther ? 'others' : `${item.user_id}-${index}`}
                    className={rowClass(!item.isOther, key, item.isOther ? styles.otherRow : '')}
                    onClick={item.isOther ? undefined : () => onRankingClick?.(item)}
                    onPointerEnter={() => setHoveredKey(key)}
                    onPointerLeave={() => setHoveredKey(null)}
                  >
                    <td>
                      <span className={styles.name}>
                        <span className={styles.swatch} style={swatch} aria-hidden="true" />
                        <span className={styles.rank}>{item.isOther ? 'Σ' : `#${index + 1}`}</span>
                        {item.isOther ? (
                          <span className={styles.nameText} title={label}>{label}</span>
                        ) : (
                          <button type="button" className={styles.toggleButton} title={label}>
                            <span className={styles.nameText}>{label}</span>
                          </button>
                        )}
                      </span>
                    </td>
                    <td>{formatNumber(item.requests)}</td>
                    <td>{formatTokens(item.tokens)}</td>
                    <td className={styles.actual}>${formatCost(item.actual_cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const busy = isDistribution ? loading : rankingLoading
  return (
    <section className={styles.panel} aria-busy={busy || undefined}>
      <div className={styles.header}>
        <h2 className={styles.title}>{heading}</h2>
        <div className={styles.toggles}>
          {showSourceToggle && (
            <SegmentedControl
              label={t('admin.dashboard.model')}
              options={sourceOptions}
              value={source}
              onValueChange={(value) => onSourceChange?.(value as ModelSource)}
            />
          )}
          {showMetricToggle && (
            <SegmentedControl
              label={t('admin.dashboard.modelDistribution')}
              options={metricOptions}
              value={metric}
              onValueChange={(value) => onMetricChange?.(value as DistributionMetric)}
            />
          )}
          {enableRankingView && (
            <SegmentedControl
              label={heading}
              options={viewOptions}
              value={activeView}
              onValueChange={(value) => {
                setActiveView(value as DistributionView)
                setHoveredKey(null)
              }}
            />
          )}
        </div>
      </div>
      {isDistribution ? renderDistribution() : renderRanking()}
    </section>
  )
}
