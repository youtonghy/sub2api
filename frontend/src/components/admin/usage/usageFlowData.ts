/**
 * 使用记录“调用流向”桑基图的数据映射：分组 → 请求模型 → 上游模型。
 *
 * 数据只来自两个现有接口：
 * - 分组统计（页面已加载的 snapshot groups），用来决定哪些分组单独成列、哪些合并为“其他分组”；
 * - 模型统计 model_source=mapping，每行的 model 形如 `请求模型 -> 上游模型`
 *   （后端 resolveModelDimensionExpression 拼接，两侧都已回落到 model 字段）。
 *
 * 每个前几名分组各请求一次 mapping（带 group_id），其余分组用“不带分组的总量 − 前几名之和”精确得出，
 * 不做任何估算；只有一个分组时只请求一次。
 */
import type { ModelStatsParams } from '@/api/admin/dashboard'
import type { SankeyLink, SankeyNode } from '@/components/arc/sankey-flow/sankey-flow'
import type { GroupStat, ModelStat } from '@/types'

/** 一次已应用的筛选及其分组统计；内容相同的查询复用同一个对象，图表据此决定是否重新请求 */
export interface FlowQuery {
  key: string
  /** 与分组统计相同的筛选（不含 model_source） */
  params: Omit<ModelStatsParams, 'model_source'>
  groups: GroupStat[]
}

export function createFlowQuery(params: FlowQuery['params'], groups: GroupStat[]): FlowQuery {
  return { key: JSON.stringify([params, groups]), params, groups }
}

export type FlowMetric = 'tokens' | 'actual_cost' | 'requests'

/** 缓存键：不带分组的总量 */
export const OVERALL_KEY = 'all'
export const MAX_FLOW_GROUPS = 5
export const MAX_FLOW_MODELS = 8

const MAPPING_SEPARATOR = ' -> '
const OTHER_ID = '\u0000other'

type MetricSource = Pick<ModelStat, 'requests' | 'total_tokens' | 'actual_cost'>

const finite = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function metricValue(stat: MetricSource, metric: FlowMetric): number {
  if (metric === 'actual_cost') return finite(stat.actual_cost)
  if (metric === 'requests') return finite(stat.requests)
  return finite(stat.total_tokens)
}

/** 解析 mapping 行的 `请求模型 -> 上游模型`；没有分隔符时两侧相同 */
export function parseMappingModel(model: string): { requested: string; upstream: string } {
  const at = model.indexOf(MAPPING_SEPARATOR)
  if (at < 0) return { requested: model, upstream: model }
  return { requested: model.slice(0, at), upstream: model.slice(at + MAPPING_SEPARATOR.length) }
}

export interface FlowRequestPlan {
  /** 需要请求的 mapping 统计：OVERALL_KEY 或分组 id（字符串） */
  keys: string[]
  /** 单独成节点的分组，按指标从大到小 */
  groups: GroupStat[]
  /** 合并进“其余分组”节点的分组（由总量减去前几名得出） */
  rest: GroupStat[]
  /** 只有一个分组：总量请求即该分组的数据 */
  single: boolean
}

/**
 * 决定请求哪些 mapping 统计。group_id=0（未分组）无法单独筛选，只能进入“其余分组”。
 */
export function planFlowRequests(groupStats: GroupStat[], metric: FlowMetric, maxGroups = MAX_FLOW_GROUPS): FlowRequestPlan {
  const groups = groupStats
    .filter((group) => finite(group.requests) > 0 || metricValue(group, metric) > 0)
    .sort((a, b) => metricValue(b, metric) - metricValue(a, metric))
  if (groups.length === 0) return { keys: [], groups: [], rest: [], single: false }
  if (groups.length === 1) return { keys: [OVERALL_KEY], groups, rest: [], single: true }
  const top = groups.filter((group) => group.group_id > 0).slice(0, maxGroups)
  const topIds = new Set(top.map((group) => group.group_id))
  const rest = groups.filter((group) => !topIds.has(group.group_id))
  const keys = top.map((group) => String(group.group_id))
  if (rest.length) keys.push(OVERALL_KEY)
  return { keys, groups: top, rest, single: false }
}

export interface FlowLabels {
  groupName: (group: GroupStat) => string
  otherGroups: string
  otherModels: string
  unknownModel: string
}

export interface FlowGraph {
  nodes: SankeyNode[]
  links: SankeyLink[]
  total: number
}

interface FlowSource {
  id: string
  label: string
  /** mapping 行：请求模型、上游模型、指标值 */
  rows: { requested: string; upstream: string; value: number }[]
}

function mappingRows(stats: ModelStat[], metric: FlowMetric, modelFilter: string) {
  const merged = new Map<string, { requested: string; upstream: string; value: number }>()
  for (const stat of stats) {
    const { requested, upstream } = parseMappingModel(stat.model ?? '')
    // 页面的模型筛选按请求模型匹配（与后端分组统计的语义一致），模型统计接口不接收该参数，在此过滤
    if (modelFilter && requested !== modelFilter) continue
    const key = `${requested}${MAPPING_SEPARATOR}${upstream}`
    const row = merged.get(key) ?? { requested, upstream, value: 0 }
    row.value += metricValue(stat, metric)
    merged.set(key, row)
  }
  return merged
}

/** 取前 max 个；超出时保留前 max-1 个，其余合并为“其他” */
function capKeys(totals: Map<string, number>, max: number): Set<string> {
  const ranked = [...totals.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])
  const keep = ranked.length > max ? ranked.slice(0, max - 1) : ranked
  return new Set(keep.map(([key]) => key))
}

export interface BuildFlowInput {
  plan: FlowRequestPlan
  /** 以 FlowRequestPlan.keys 为键的 mapping 统计 */
  stats: Record<string, ModelStat[] | undefined>
  metric: FlowMetric
  labels: FlowLabels
  /** 页面当前的模型筛选（请求模型） */
  modelFilter?: string
  maxModels?: number
}

/** 计划中的数据未全部到达时返回 null */
export function buildFlowGraph({ plan, stats, metric, labels, modelFilter = '', maxModels = MAX_FLOW_MODELS }: BuildFlowInput): FlowGraph | null {
  if (plan.keys.some((key) => !stats[key])) return null
  const filter = modelFilter.trim()
  const sources: FlowSource[] = []

  if (plan.single) {
    const group = plan.groups[0]
    sources.push({ id: `g:${group.group_id}`, label: labels.groupName(group), rows: [...mappingRows(stats[OVERALL_KEY]!, metric, filter).values()] })
  } else {
    const assigned = new Map<string, number>()
    for (const group of plan.groups) {
      const rows = mappingRows(stats[String(group.group_id)]!, metric, filter)
      for (const [key, row] of rows) assigned.set(key, (assigned.get(key) ?? 0) + row.value)
      sources.push({ id: `g:${group.group_id}`, label: labels.groupName(group), rows: [...rows.values()] })
    }
    if (plan.rest.length) {
      const overall = mappingRows(stats[OVERALL_KEY]!, metric, filter)
      const overallTotal = [...overall.values()].reduce((sum, row) => sum + row.value, 0)
      // 并发写入可能让总量与分组之和有细微出入：只保留明显为正的差值
      const epsilon = Math.max(1e-9, overallTotal * 1e-9)
      const rows = [...overall].flatMap(([key, row]) => {
        const value = row.value - (assigned.get(key) ?? 0)
        return value > epsilon ? [{ ...row, value }] : []
      })
      const label = plan.rest.length === 1 ? labels.groupName(plan.rest[0]) : labels.otherGroups
      sources.push({ id: `g:${OTHER_ID}`, label, rows })
    }
  }

  const requestedTotals = new Map<string, number>()
  const upstreamTotals = new Map<string, number>()
  for (const source of sources) {
    for (const row of source.rows) {
      requestedTotals.set(row.requested, (requestedTotals.get(row.requested) ?? 0) + row.value)
      upstreamTotals.set(row.upstream, (upstreamTotals.get(row.upstream) ?? 0) + row.value)
    }
  }
  const keptRequested = capKeys(requestedTotals, maxModels)
  const keptUpstream = capKeys(upstreamTotals, maxModels)
  const requestedId = (model: string) => (keptRequested.has(model) ? `r:${model}` : `r:${OTHER_ID}`)
  const upstreamId = (model: string) => (keptUpstream.has(model) ? `u:${model}` : `u:${OTHER_ID}`)

  const linkValues = new Map<string, SankeyLink>()
  const addLink = (source: string, target: string, value: number) => {
    if (!(value > 0)) return
    const key = `${source}\u0001${target}`
    const link = linkValues.get(key) ?? { source, target, value: 0 }
    link.value += value
    linkValues.set(key, link)
  }
  const nodeTotals = new Map<string, number>()
  const addNode = (id: string, value: number) => nodeTotals.set(id, (nodeTotals.get(id) ?? 0) + value)
  for (const source of sources) {
    for (const row of source.rows) {
      if (!(row.value > 0)) continue
      addLink(source.id, requestedId(row.requested), row.value)
      addLink(requestedId(row.requested), upstreamId(row.upstream), row.value)
      addNode(source.id, row.value)
      addNode(requestedId(row.requested), row.value)
      addNode(upstreamId(row.upstream), row.value)
    }
  }

  const modelLabel = (model: string) => model.trim() || labels.unknownModel
  const columnNodes = (prefix: string, column: number, labelOf: (id: string) => string): SankeyNode[] =>
    [...nodeTotals.entries()]
      .filter(([id, value]) => id.startsWith(prefix) && value > 0)
      .sort((a, b) => {
        const aOther = a[0].endsWith(OTHER_ID) ? 1 : 0
        const bOther = b[0].endsWith(OTHER_ID) ? 1 : 0
        return aOther - bOther || b[1] - a[1]
      })
      .map(([id]) => ({ id, label: labelOf(id), column }))

  const sourceLabels = new Map(sources.map((source) => [source.id, source.label]))
  const nodes = [
    ...columnNodes('g:', 0, (id) => sourceLabels.get(id) ?? id),
    ...columnNodes('r:', 1, (id) => (id.endsWith(OTHER_ID) ? labels.otherModels : modelLabel(id.slice(2)))),
    ...columnNodes('u:', 2, (id) => (id.endsWith(OTHER_ID) ? labels.otherModels : modelLabel(id.slice(2))))
  ]
  const total = sources.reduce((sum, source) => sum + (nodeTotals.get(source.id) ?? 0), 0)
  return { nodes, links: [...linkValues.values()], total }
}
