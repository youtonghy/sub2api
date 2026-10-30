import { Badge } from '@/components/arc/badge/badge'
import { useI18n } from '@/i18n/useI18n'
import type { OrderStatus } from '@/types/payment'
import { orderStatusTone } from './orderStatusTone'

export interface OrderStatusBadgeProps {
  status: OrderStatus
}

const STATUS_KEYS: Record<OrderStatus, string> = {
  PENDING: 'payment.status.pending',
  PAID: 'payment.status.paid',
  RECHARGING: 'payment.status.recharging',
  COMPLETED: 'payment.status.completed',
  EXPIRED: 'payment.status.expired',
  CANCELLED: 'payment.status.cancelled',
  FAILED: 'payment.status.failed',
  REFUND_REQUESTED: 'payment.status.refund_requested',
  REFUNDING: 'payment.status.refunding',
  REFUND_PENDING: 'payment.status.refund_pending',
  REFUNDED: 'payment.status.refunded',
  PARTIALLY_REFUNDED: 'payment.status.partially_refunded',
  REFUND_FAILED: 'payment.status.refund_failed'
}

/** 订单状态徽章，对应 Vue 版 OrderStatusBadge.vue；未知状态显示原值 */
export default function OrderStatusBadge({ status }: OrderStatusBadgeProps) {
  const { t } = useI18n()
  const key = STATUS_KEYS[status]
  return (
    <Badge tone={orderStatusTone(status)} size="sm">
      {key ? t(key) : status}
    </Badge>
  )
}
