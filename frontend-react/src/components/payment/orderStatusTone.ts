/**
 * 订单状态到 Arc badge 色调的映射。
 * Vue 版用 Tailwind 颜色（OrderStatusBadge）或 badge-* 类（orderUtils.statusBadgeClass）；
 * React 版统一为 Arc badge 的语义色调。
 */
import type { BadgeTone } from '@/components/arc/badge/badge'
import { statusBadgeClass } from './orderUtils'

/** OrderStatusBadge.vue 的颜色映射：黄 → warning，蓝/紫 → info，绿 → success，灰 → neutral，橙 → warning，红 → danger */
const ORDER_STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'warning',
  PAID: 'info',
  RECHARGING: 'info',
  COMPLETED: 'success',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  FAILED: 'danger',
  REFUND_REQUESTED: 'warning',
  REFUNDING: 'warning',
  REFUND_PENDING: 'warning',
  REFUNDED: 'info',
  PARTIALLY_REFUNDED: 'info',
  REFUND_FAILED: 'danger'
}

export function orderStatusTone(status: string): BadgeTone {
  return ORDER_STATUS_TONE[status] ?? 'neutral'
}

const BADGE_CLASS_TONE: Record<string, BadgeTone> = {
  'badge-warning': 'warning',
  'badge-info': 'info',
  'badge-success': 'success',
  'badge-secondary': 'neutral',
  'badge-danger': 'danger'
}

/** orderUtils.statusBadgeClass 的色调版本（AdminOrderTable / AdminOrderDetail 使用） */
export function statusBadgeTone(status: string): BadgeTone {
  return BADGE_CLASS_TONE[statusBadgeClass(status)] ?? 'neutral'
}
