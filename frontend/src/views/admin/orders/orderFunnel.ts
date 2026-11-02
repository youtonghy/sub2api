/**
 * 支付看板订单漏斗的数据整理。
 *
 * 后端的订单列表接口不支持按日期筛选，也只能按单个状态精确过滤，因此无法用“每阶段一次计数请求”得到所选时间范围内的漏斗。
 * 这里改为按创建时间倒序翻页读取订单（每页 100 条，最多 8 页），用每条订单自身的时间戳判断阶段：
 * 已创建（created_at 在范围内）→ 已支付（有 paid_at）→ 已完成（同时有 paid_at 与 completed_at）。
 * 三个阶段是严格的子集链；过期、取消、失败、退款等状态只作为流失说明，不作为漏斗阶段。
 */
import type { PaymentOrder } from '@/types/payment'

export const FUNNEL_PAGE_SIZE = 100
export const FUNNEL_MAX_PAGES = 8

/** 已知的订单类型分段；出现其他类型时追加 OTHER_SEGMENT，保证分段之和等于总数 */
export const KNOWN_SEGMENTS = ['balance', 'subscription'] as const
export const OTHER_SEGMENT = 'other'

export const FUNNEL_STAGE_KEYS = ['created', 'paid', 'completed'] as const
export type FunnelStageKey = (typeof FUNNEL_STAGE_KEYS)[number]

export type FunnelOrder = Pick<PaymentOrder, 'id' | 'status' | 'order_type' | 'created_at' | 'paid_at' | 'completed_at'>

const REFUND_STATUSES = new Set<string>([
  'REFUND_REQUESTED',
  'REFUNDING',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'REFUND_FAILED'
])

export interface FunnelDropoff {
  /** 未支付：按当前状态拆分 */
  pending: number
  expired: number
  cancelled: number
  failedUnpaid: number
  otherUnpaid: number
  /** 已支付未完成 */
  inProgress: number
  failedAfterPayment: number
  otherPaid: number
  /** 已完成后进入退款流程（仍计入“已完成”阶段） */
  refundAfterCompletion: number
}

export interface OrderFunnelSummary {
  /** 每个阶段按分段计数 */
  counts: Record<FunnelStageKey, Record<string, number>>
  /** 有序分段键：balance、subscription，存在未知类型时再加 other */
  segmentKeys: string[]
  dropoff: FunnelDropoff
  /** 范围内订单数，等于“已创建”阶段总数 */
  inRange: number
}

/** 与后端看板 now.AddDate(0, 0, -days) 一致的范围起点（毫秒） */
export function rangeStartMs(days: number, now: number = Date.now()): number {
  const start = new Date(now)
  start.setDate(start.getDate() - days)
  return start.getTime()
}

function createdMs(order: Pick<FunnelOrder, 'created_at'>): number {
  return new Date(order.created_at).getTime()
}

/** 最多能读的页数：总页数与上限取小 */
export function pageLimit(total: number, pageSize: number = FUNNEL_PAGE_SIZE, maxPages: number = FUNNEL_MAX_PAGES): number {
  return Math.min(Math.max(1, Math.ceil(total / pageSize)), maxPages)
}

/**
 * 读完第一页后估计总共要读几页（含第一页）。
 * 第一页最早的一条已早于范围起点，或已没有更多订单时只读一页；
 * 否则按第一页覆盖的时间跨度估算整个范围需要的页数，多读一页留余量，并受 pageLimit 限制。
 */
export function pagesToFetch(
  firstPage: { items: Pick<FunnelOrder, 'created_at'>[]; total: number },
  sinceMs: number,
  now: number = Date.now(),
  pageSize: number = FUNNEL_PAGE_SIZE,
  maxPages: number = FUNNEL_MAX_PAGES
): number {
  const { items, total } = firstPage
  const limit = pageLimit(total, pageSize, maxPages)
  if (!items.length || limit <= 1) return 1
  const lastMs = createdMs(items[items.length - 1])
  if (!Number.isFinite(lastMs) || lastMs < sinceMs) return 1
  const spanPerPage = now - lastMs
  if (spanPerPage <= 0) return limit
  const estimate = Math.ceil((now - sinceMs) / spanPerPage) + 1
  return Math.min(Math.max(2, estimate), limit)
}

/**
 * 读到的订单是否覆盖了整个范围：读到了早于起点的订单，或已经读完全部订单。
 * 未覆盖时漏斗只统计最近的若干条，界面需要说明。
 */
export function coversRange(
  orders: Pick<FunnelOrder, 'created_at'>[],
  sinceMs: number,
  fetchedPages: number,
  total: number,
  pageSize: number = FUNNEL_PAGE_SIZE
): boolean {
  if (fetchedPages * pageSize >= total) return true
  return orders.some((order) => createdMs(order) < sinceMs)
}

/** 去重（翻页期间有新订单会让后一页重复出现上一页末尾的订单）并只保留范围内的订单 */
export function ordersInRange<T extends FunnelOrder>(orders: T[], sinceMs: number): T[] {
  const seen = new Set<number>()
  const result: T[] = []
  for (const order of orders) {
    if (seen.has(order.id)) continue
    seen.add(order.id)
    const created = createdMs(order)
    if (Number.isFinite(created) && created >= sinceMs) result.push(order)
  }
  return result
}

/** 范围内最早一条订单的创建时间；用于说明未覆盖范围时的实际统计起点 */
export function oldestCreatedAt(orders: Pick<FunnelOrder, 'created_at'>[]): string | null {
  let oldest: string | null = null
  let oldestMs = Infinity
  for (const order of orders) {
    const ms = createdMs(order)
    if (ms < oldestMs) {
      oldestMs = ms
      oldest = order.created_at
    }
  }
  return oldest
}

function segmentOf(order: FunnelOrder): string {
  return (KNOWN_SEGMENTS as readonly string[]).includes(order.order_type) ? order.order_type : OTHER_SEGMENT
}

/** 汇总范围内订单（调用方先用 ordersInRange 过滤）为三阶段漏斗与流失说明 */
export function summarizeOrderFunnel(orders: FunnelOrder[]): OrderFunnelSummary {
  const counts: OrderFunnelSummary['counts'] = { created: {}, paid: {}, completed: {} }
  const dropoff: FunnelDropoff = {
    pending: 0,
    expired: 0,
    cancelled: 0,
    failedUnpaid: 0,
    otherUnpaid: 0,
    inProgress: 0,
    failedAfterPayment: 0,
    otherPaid: 0,
    refundAfterCompletion: 0
  }
  let hasOther = false
  const bump = (stage: FunnelStageKey, segment: string) => {
    counts[stage][segment] = (counts[stage][segment] ?? 0) + 1
  }

  for (const order of orders) {
    const segment = segmentOf(order)
    if (segment === OTHER_SEGMENT) hasOther = true
    bump('created', segment)
    if (!order.paid_at) {
      if (order.status === 'PENDING') dropoff.pending++
      else if (order.status === 'EXPIRED') dropoff.expired++
      else if (order.status === 'CANCELLED') dropoff.cancelled++
      else if (order.status === 'FAILED') dropoff.failedUnpaid++
      else dropoff.otherUnpaid++
      continue
    }
    bump('paid', segment)
    if (!order.completed_at) {
      if (order.status === 'PAID' || order.status === 'RECHARGING') dropoff.inProgress++
      else if (order.status === 'FAILED') dropoff.failedAfterPayment++
      else dropoff.otherPaid++
      continue
    }
    bump('completed', segment)
    if (REFUND_STATUSES.has(order.status)) dropoff.refundAfterCompletion++
  }

  const segmentKeys: string[] = [...KNOWN_SEGMENTS]
  if (hasOther) segmentKeys.push(OTHER_SEGMENT)
  for (const stage of FUNNEL_STAGE_KEYS) {
    for (const key of segmentKeys) counts[stage][key] = counts[stage][key] ?? 0
  }

  return { counts, segmentKeys, dropoff, inRange: orders.length }
}

/** 转成 FunnelChart 的 stages（分段模式，每阶段 values 按分段键给出） */
export function toFunnelStages(
  summary: OrderFunnelSummary,
  stageLabels: Record<FunnelStageKey, string>
): { key: FunnelStageKey; label: string; values: Record<string, number> }[] {
  return FUNNEL_STAGE_KEYS.map((key) => ({ key, label: stageLabels[key], values: { ...summary.counts[key] } }))
}
