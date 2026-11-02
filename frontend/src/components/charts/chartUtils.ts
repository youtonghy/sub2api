/**
 * 图表组件共用的格式化与配色工具。格式化函数与 Vue 版各图表内的同名函数输出逐字节一致
 * （额外对 null、undefined、NaN 回落为 0，Vue 版部分组件在这些输入上会抛错或输出 NaN）。
 */
import type { TrendDataPoint, UserSpendingRankingItem } from '@/types'
import { t } from '@/i18n'

export type DistributionMetric = 'tokens' | 'actual_cost'

export const toFiniteNumber = (value: unknown): number => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

export const formatTokens = (value: number | null | undefined): string => {
  if (value === undefined || value === null) return '0'
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`
  } else if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`
  }
  return value.toLocaleString()
}

export const formatNumber = (value: number | null | undefined): string => {
  return toFiniteNumber(value).toLocaleString()
}

export const formatCost = (value: number | null | undefined): string => {
  const safeValue = toFiniteNumber(value)
  if (safeValue >= 1000) {
    return (safeValue / 1000).toFixed(2) + 'K'
  } else if (safeValue >= 1) {
    return safeValue.toFixed(2)
  } else if (safeValue >= 0.01) {
    return safeValue.toFixed(3)
  }
  return safeValue.toFixed(4)
}

export const formatDuration = (ms: number): string => {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`
  }
  return `${Math.round(ms)}ms`
}

/** 按指标格式化分布图数值：实际费用带 $，否则为 token 量 */
export const formatMetricValue = (value: number, metric: DistributionMetric): string =>
  metric === 'actual_cost' ? `$${formatCost(value)}` : formatTokens(value)

/** 对应 Vue 版 Doughnut tooltip 的 label 回调：`名称: 数值 (占比%)` */
export function formatShareLabel(label: string, value: number, values: number[], metric: DistributionMetric): string {
  const total = values.reduce((a, b) => a + b, 0)
  const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
  return `${label}: ${formatMetricValue(value, metric)} (${percentage}%)`
}

/** 分布图配色：4 项以内用 Arc 系列色，更多时用 12 色分类色板，再多回落为中性色 */
export function distributionColor(index: number, count: number): string {
  if (count <= 4) return `var(--series-${index + 1})`
  if (index < 12) return `var(--chart-cat-${index + 1})`
  return 'color-mix(in oklab, var(--foreground) 36%, var(--surface))'
}

/** “其他”汇总项的专用颜色，与任何系列色都不同 */
export const OTHER_COLOR = 'color-mix(in oklab, var(--foreground) 22%, var(--surface))'

/** 按指标降序排序（不修改原数组） */
export function sortByMetric<T extends { total_tokens: number; actual_cost: number }>(
  stats: T[] | undefined,
  metric: DistributionMetric
): T[] {
  if (!stats?.length) return []
  const metricKey = metric === 'actual_cost' ? 'actual_cost' : 'total_tokens'
  return [...stats].sort((a, b) => toFiniteNumber(b[metricKey]) - toFiniteNumber(a[metricKey]))
}

/** 仪表盘用户标签策略：用户名 → 邮箱 → “用户 #id” */
export function getRankingUserLabel(item: Pick<UserSpendingRankingItem, 'username' | 'email' | 'user_id'>): string {
  if (item.username?.trim()) return item.username.trim()
  if (item.email?.trim()) return item.email.trim()
  return t('admin.redeem.userPrefix', { id: item.user_id })
}

/** 缓存命中率 = 读缓存 / (输入 + 读缓存 + 写缓存)，分母为 0 时为 0 */
export function cacheHitRate(point: TrendDataPoint): number {
  const totalPromptTokens = point.input_tokens + point.cache_read_tokens + point.cache_creation_tokens
  return totalPromptTokens > 0 ? (point.cache_read_tokens / totalPromptTokens) * 100 : 0
}

/** 横轴短标签：小时粒度取时间部分，日粒度取月-日 */
export function axisLabelOf(date: string): string {
  const space = date.indexOf(' ')
  if (space > 0) return date.slice(space + 1)
  const match = /^\d{4}-(\d{2}-\d{2})$/.exec(date)
  return match ? match[1] : date
}

/** 把格式化后的量级（如 1.23M）拆成 metric-card 需要的数值、小数位与后缀 */
export function splitMagnitude(value: number | null | undefined): { value: number; decimals: number; suffix: string } {
  const safeValue = toFiniteNumber(value)
  const units: [number, string][] = [[1_000_000_000, 'B'], [1_000_000, 'M'], [1_000, 'K']]
  for (const [size, suffix] of units) {
    if (safeValue >= size) return { value: Number((safeValue / size).toFixed(2)), decimals: 2, suffix }
  }
  const fraction = String(safeValue).split('.')[1]?.length ?? 0
  return { value: safeValue, decimals: Math.min(fraction, 3), suffix: '' }
}
