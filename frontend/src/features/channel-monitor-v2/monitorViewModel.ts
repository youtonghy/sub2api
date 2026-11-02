/** 渠道监控 V2 组件共用的纯函数（从组件文件中拆出，保持组件文件只导出组件） */
import type { MonitorConfig } from '@/api/channelMonitorV2'

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
