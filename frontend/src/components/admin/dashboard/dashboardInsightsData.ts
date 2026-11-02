/**
 * 管理仪表盘「KPI 下钻」与「用户消费排行赛跑」的数据映射（纯函数，便于单测）。
 *
 * - KPI：一次按天的趋势请求，补齐缺失日期为 0，得到每个指标最近 180 天的日序列（旧 → 新）。
 * - 构成：模型 / 分组统计在最近 30 天与之前 30 天各取一次，share 为近 30 天占比，
 *   delta 为该分段数值相对之前 30 天的变化率（与 kpi-drilldown 对合计类指标的约定一致）。
 * - 排行赛跑：按用户逐期累计实际费用，每期一帧。
 */
import type { BreakdownRow, Kpi, KpiFormat } from '@/components/arc/blocks/kpi-drilldown/kpi-drilldown-data'
import type { RaceBarFrame, RaceBarItem } from '@/components/arc/race-bar-chart/race-bar-chart'
import type { GroupStat, ModelStat, TrendDataPoint, UserUsageTrendPoint } from '@/types'

/** 趋势、模型统计、分组统计三者都有的可累加指标 */
export type InsightMetric = 'requests' | 'total_tokens' | 'actual_cost' | 'cost'

/** kpi-drilldown 最长区间 90 天，再加同样长的对比区间 */
export const KPI_SERIES_DAYS = 180
/** 构成表的统计窗口 */
export const BREAKDOWN_DAYS = 30
/** 构成表最多列出的分段数，其余合并为“其他” */
export const BREAKDOWN_LIMIT = 5

const toNumber = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 日历日期（YYYY-MM-DD）加减天数，按 UTC 计算，不受本地夏令时影响 */
export function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

/** 以 end 结尾、共 count 天的日期列表，旧 → 新 */
export function dailyDates(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftIsoDate(end, index - (count - 1)))
}

export interface InsightWindows {
  /** 最后一个完整日（昨天），所有序列与构成窗口都以它结尾 */
  end: string
  trendStart: string
  currentStart: string
  previousStart: string
  previousEnd: string
}

/**
 * 以“今天”推出各请求的日期窗口。今天尚未结束，计入会让每个区间的对比都偏低，
 * 所以序列截止到昨天。
 */
export function insightWindows(today: string): InsightWindows {
  const end = shiftIsoDate(today, -1)
  const currentStart = shiftIsoDate(end, -(BREAKDOWN_DAYS - 1))
  return {
    end,
    trendStart: shiftIsoDate(end, -(KPI_SERIES_DAYS - 1)),
    currentStart,
    previousStart: shiftIsoDate(currentStart, -BREAKDOWN_DAYS),
    previousEnd: shiftIsoDate(currentStart, -1)
  }
}

/** 把趋势点按日期对齐到 dates，缺失的日期补 0，同一天出现多次时累加 */
export function buildDailySeries(trend: TrendDataPoint[], dates: string[], metric: InsightMetric): number[] {
  const byDate = new Map<string, number>()
  for (const point of trend) {
    const day = point.date.slice(0, 10)
    byDate.set(day, (byDate.get(day) ?? 0) + toNumber(point[metric]))
  }
  return dates.map((date) => byDate.get(date) ?? 0)
}

/** 构成表的统一输入：一个分段在某个窗口内各指标的数值 */
export interface BreakdownSource {
  key: string
  name: string
  values: Record<InsightMetric, number>
}

const metricValues = (stat: Pick<ModelStat, InsightMetric>): Record<InsightMetric, number> => ({
  requests: toNumber(stat.requests),
  total_tokens: toNumber(stat.total_tokens),
  actual_cost: toNumber(stat.actual_cost),
  cost: toNumber(stat.cost)
})

export function modelSources(stats: ModelStat[] | undefined): BreakdownSource[] {
  return (stats ?? []).map((stat) => ({ key: stat.model, name: stat.model, values: metricValues(stat) }))
}

/** 分组名为空时与分组分布图一致，显示“无分组” */
export function groupSources(stats: GroupStat[] | undefined, noGroupLabel: string): BreakdownSource[] {
  return (stats ?? []).map((stat) => ({
    key: String(stat.group_id),
    name: stat.group_name || noGroupLabel,
    values: metricValues(stat)
  }))
}

/**
 * 近 30 天按指标降序取前 limit 个分段，其余合并为 otherLabel。
 * share = 分段 / 近 30 天合计；delta = (近 30 天 − 之前 30 天) / 之前 30 天；之前为 0 时标记 isNew。
 */
export function buildBreakdownRows(
  current: BreakdownSource[],
  previous: BreakdownSource[],
  metric: InsightMetric,
  otherLabel: string,
  limit = BREAKDOWN_LIMIT
): BreakdownRow[] {
  const ranked = current.filter((source) => source.values[metric] > 0).sort((a, b) => b.values[metric] - a.values[metric])
  const total = ranked.reduce((sum, source) => sum + source.values[metric], 0)
  if (total <= 0) return []

  const before = new Map<string, number>()
  for (const source of previous) before.set(source.key, (before.get(source.key) ?? 0) + source.values[metric])

  const row = (name: string, value: number, prior: number): BreakdownRow => ({
    name,
    value,
    share: value / total,
    delta: prior > 0 ? (value - prior) / prior : 0,
    isNew: prior <= 0
  })

  const top = ranked.slice(0, limit)
  const rows = top.map((source) => row(source.name, source.values[metric], before.get(source.key) ?? 0))
  const rest = ranked.slice(limit)
  if (rest.length) {
    const topKeys = new Set(top.map((source) => source.key))
    const restValue = rest.reduce((sum, source) => sum + source.values[metric], 0)
    let restBefore = 0
    for (const [key, value] of before) if (!topKeys.has(key)) restBefore += value
    rows.push(row(otherLabel, restValue, restBefore))
  }
  return rows
}

export interface KpiDefinition {
  id: InsightMetric
  label: string
  description: string
  /** 基础格式（如 $ 前缀与小数位），单位（K/M/B）按序列量级自动追加 */
  format: KpiFormat
}

export interface BreakdownWindowStats {
  models: { current: ModelStat[]; previous: ModelStat[] }
  groups: { current: GroupStat[]; previous: GroupStat[] }
}

export interface BuildKpisOptions {
  definitions: KpiDefinition[]
  trend: TrendDataPoint[]
  end: string
  stats: BreakdownWindowStats
  otherLabel: string
  noGroupLabel: string
}

/** 组装 kpi-drilldown 的 kpis：合计类指标，区间值为区间内逐日之和；序列以 end 结尾共 180 天 */
export function buildKpis({ definitions, trend, end, stats, otherLabel, noGroupLabel }: BuildKpisOptions): Kpi[] {
  const dates = dailyDates(end, KPI_SERIES_DAYS)
  const models = { current: modelSources(stats.models.current), previous: modelSources(stats.models.previous) }
  const groups = {
    current: groupSources(stats.groups.current, noGroupLabel),
    previous: groupSources(stats.groups.previous, noGroupLabel)
  }
  return definitions.map((definition) => {
    const series = buildDailySeries(trend, dates, definition.id)
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      format: magnitudeFormat(series, definition.format),
      kind: 'total',
      aggregate: 'sum',
      series,
      breakdowns: {
        model: buildBreakdownRows(models.current, models.previous, definition.id, otherLabel),
        group: buildBreakdownRows(groups.current, groups.previous, definition.id, otherLabel)
      }
    }
  })
}

/** 按序列量级选一个固定单位，让卡片数值、坐标轴与提示保持同一刻度 */
export function magnitudeFormat(series: number[], base: KpiFormat = {}): KpiFormat {
  const peak = series.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
  const units: [number, string][] = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K']
  ]
  for (const [divisor, suffix] of units) {
    if (peak >= divisor) return { ...base, divisor, suffix: `${suffix}${base.suffix ?? ''}`, decimals: 2 }
  }
  return { ...base, decimals: base.decimals ?? 0 }
}

const PERIOD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/

/**
 * 时间桶的显示名：日粒度“11月2日”/“Nov 2”，小时粒度附加“14:00”；
 * 跨年的区间带上年份，避免不同年份的同一天重名。
 */
export function formatPeriodLabel(date: string, locale: string, withYear = false): string {
  const match = PERIOD_PATTERN.exec(date)
  if (!match) return date
  const [, year, month, day, time] = match
  const calendar = new Intl.DateTimeFormat(locale, {
    year: withYear ? 'numeric' : undefined,
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))))
  return time ? `${calendar} ${time}` : calendar
}

export interface RaceData {
  items: RaceBarItem[]
  frames: RaceBarFrame[]
}

/**
 * 用户消费排行的累计帧：每个时间桶一帧，值为该用户从区间开始到这一桶的累计实际费用。
 * 条目按区间合计降序，合计为 0 的用户不参与排行。
 */
export function buildCumulativeRaceFrames(
  points: UserUsageTrendPoint[],
  labelOf: (point: UserUsageTrendPoint) => string,
  periodOf: (date: string, withYear: boolean) => string
): RaceData {
  const users = new Map<number, { label: string; total: number }>()
  const byDate = new Map<string, Map<number, number>>()
  for (const point of points) {
    const cost = toNumber(point.actual_cost)
    const user = users.get(point.user_id)
    if (user) user.total += cost
    else users.set(point.user_id, { label: labelOf(point), total: cost })
    const bucket = byDate.get(point.date) ?? new Map<number, number>()
    bucket.set(point.user_id, (bucket.get(point.user_id) ?? 0) + cost)
    byDate.set(point.date, bucket)
  }

  const ranked = [...users.entries()].filter(([, user]) => user.total > 0).sort((a, b) => b[1].total - a[1].total)
  if (!ranked.length) return { items: [], frames: [] }

  const dates = [...byDate.keys()].sort()
  const withYear = dates[0].slice(0, 4) !== dates[dates.length - 1].slice(0, 4)
  const running = new Map<number, number>(ranked.map(([id]) => [id, 0]))
  const frames = dates.map((date) => {
    for (const [id, cost] of byDate.get(date)!) if (running.has(id)) running.set(id, running.get(id)! + cost)
    return {
      period: periodOf(date, withYear),
      values: Object.fromEntries([...running].map(([id, value]) => [`user-${id}`, value]))
    }
  })
  return { items: ranked.map(([id, user]) => ({ id: `user-${id}`, label: user.label })), frames }
}

const compactDollars = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** 坐标轴刻度用的紧凑金额（$20、$1.5K），刻度较密时不会互相重叠 */
export function formatDollarTick(value: number): string {
  return `$${compactDollars.format(toNumber(value))}`
}

/** 帧数多时缩短每帧时长，让完整播放保持在十几秒 */
export function raceFrameDuration(frameCount: number): number {
  if (frameCount <= 1) return 1400
  return Math.round(Math.min(1400, Math.max(250, 16000 / frameCount)))
}
