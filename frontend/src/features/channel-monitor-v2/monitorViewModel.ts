/** 渠道监控 V2 组件共用的纯函数（从组件文件中拆出，保持组件文件只导出组件） */
import type { MonitorConfig, MonitorCoverage, MonitorMatrixRow } from '@/api/channelMonitorV2'
import type { HorizonSeries } from '@/components/arc/blocks/horizon-chart/horizon-chart'

/** Split "AVG 475ms · P90 800ms" into chips so nothing is ellipsized. */
export function splitMetricDetail(detail: string): string[] {
  const raw = (detail || '').trim()
  if (!raw || raw === '-') return []
  return raw
    .split(/\s*[·|]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function normalizeRank(rank: number | null | undefined): number | null {
  const n = Number(rank)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/** 相邻 3 点平均；null 保持为空 */
export function smoothTrend(values: Array<number | null>): Array<number | null> {
  if (values.length <= 2) return values
  return values.map((value, index) => {
    if (value == null) return null
    const neighbors = values
      .slice(Math.max(0, index - 1), Math.min(values.length, index + 2))
      .filter((item): item is number => item != null)
    if (!neighbors.length) return value
    return neighbors.reduce((sum, item) => sum + item, 0) / neighbors.length
  })
}

/** healthScoreClass 返回 'health-score5' 之类的类名，这里取后半段作为 data-health 的值 */
export function healthAttr(cls: string): string {
  return cls.replace(/^health-/, '')
}

export const defaultMonitorThresholds: MonitorConfig['health_thresholds'] = {
  minimum_sample: 50,
  warning_error_rate: 0.05,
  critical_error_rate: 0.2,
  target_ttft_ms: 3000,
  warning_ttft_ms: 3000,
  critical_ttft_ms: 10000,
  // Higher is better: below 85% watch, below 60% critical.
  warning_cache_rate: 0.85,
  critical_cache_rate: 0.6,
  error_weight: 0.6,
  ttft_weight: 0.2,
  cache_weight: 0.2
}

/** Factory ignored categories (matches backend DefaultChannelMonitorV2IgnoredErrorCategories). */
const defaultIgnoredErrorCategories = [
  'authentication',
  'client_cancelled',
  'content_policy',
  'context_limit',
  'group_access',
  'model_unsupported',
  'not_found',
  'quota_or_balance'
] as const


export function normalizeMonitorConfig(value: MonitorConfig): MonitorConfig {
  const ignored = value.ignored_error_categories
  return {
    ...value,
    health_thresholds: { ...defaultMonitorThresholds, ...(value.health_thresholds || {}) },
    // Preserve explicit empty arrays from the server (operator cleared all).
    ignored_error_categories: [...(ignored == null ? [...defaultIgnoredErrorCategories] : ignored)].sort()
  }
}

/**
 * 所选范围 [requested_start, requested_end) 内的全部时间桶起点（ISO 字符串）。
 * 部分回填时空桶也保留，旧接口没有 requested_end 时回落到 data_through。
 */
export function coverageBucketStarts(coverage: Pick<MonitorCoverage, 'bucket_seconds' | 'requested_start' | 'requested_end' | 'data_through'>): string[] {
  const step = Math.max(60, coverage.bucket_seconds) * 1000
  const requestedStart = new Date(coverage.requested_start).getTime()
  const requestedEndRaw = coverage.requested_end ? new Date(coverage.requested_end).getTime() : NaN
  const dataThrough = new Date(coverage.data_through).getTime()
  const end = Number.isFinite(requestedEndRaw) && requestedEndRaw > requestedStart ? requestedEndRaw : dataThrough
  if (![requestedStart, end].every(Number.isFinite) || requestedStart >= end) return []
  const starts: string[] = []
  for (let cursor = Math.floor(requestedStart / step) * step; cursor < end; cursor += step) {
    starts.push(new Date(cursor).toISOString())
  }
  return starts
}

/** 矩阵行名：平台 / 分组 / 模型，“其他模型”汇总行用 otherModelsLabel */
export function monitorRowLabel(row: MonitorMatrixRow, otherModelsLabel: string): string {
  const parts = [row.platform]
  if (row.group_name || row.group_id) parts.push(row.group_name || `#${row.group_id}`)
  if (row.model) parts.push(row.model === '__other__' ? otherModelsLabel : row.model)
  return parts.join(' / ')
}

/** 矩阵行的稳定标识 */
export function monitorRowKey(row: MonitorMatrixRow): string {
  return [row.platform, row.group_id || 0, row.model || ''].join(':')
}

/** 带符号的百分点，保留一位小数，负号用真正的减号 */
export function formatDeviation(value: number): string {
  const rounded = Math.round(value * 10) / 10
  if (rounded === 0) return '0%'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}%`
}

/** 地平线视图：每行在各时间桶的成功率减去该行整体成功率（百分点）；无请求的桶记为 0 */
export function deviationSeries(rows: MonitorMatrixRow[], bucketStarts: string[], otherModelsLabel: string): HorizonSeries[] {
  const indexByStart = new Map(bucketStarts.map((start, index) => [start, index]))
  return rows.map((row) => {
    const baseline = (1 - (row.metrics.error_rate || 0)) * 100
    const values = bucketStarts.map(() => 0)
    for (const bucket of row.buckets || []) {
      const index = indexByStart.get(new Date(bucket.bucket_start).toISOString())
      if (index == null || bucket.metrics.request_count <= 0) continue
      values[index] = Math.round(((1 - (bucket.metrics.error_rate || 0)) * 100 - baseline) * 10) / 10
    }
    return { id: monitorRowKey(row), name: monitorRowLabel(row, otherModelsLabel), values }
  })
}
