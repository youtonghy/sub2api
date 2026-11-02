import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import { currencySymbol } from '@/components/payment/currency'
import { statusBadgeTone } from '@/components/payment/orderStatusTone'
import { canRefund as canRefundStatus, formatOrderDateTime } from '@/components/payment/orderUtils'
import { useI18n } from '@/i18n/useI18n'
import type { PaymentOrder } from '@/types/payment'
import styles from './AdminPayment.module.css'

export interface AdminOrderDetailProps {
  show: boolean
  order: PaymentOrder | null
  onClose?: () => void
  onCancel?: (order: PaymentOrder) => void
  onRetry?: (order: PaymentOrder) => void
  onRefund?: (order: PaymentOrder) => void
}

const creditedAmountSymbol = currencySymbol('USD')

/** 管理员订单详情，对应 Vue 版 AdminOrderDetail.vue */
export default function AdminOrderDetail({ show, order, onClose, onCancel, onRetry, onRefund }: AdminOrderDetailProps) {
  const { t } = useI18n()

  const paymentAmountSymbol = currencySymbol(order?.currency)

  /** 充值金额 (base amount before fee) = pay_amount - fee = pay_amount / (1 + fee_rate/100) */
  const feeRate = order ? Number(order.fee_rate) || 0 : 0
  const baseAmount = !order ? 0 : feeRate <= 0 ? order.pay_amount : order.pay_amount / (1 + feeRate / 100)
  /** 手续费 = pay_amount - baseAmount */
  const feeAmount = !order || feeRate <= 0 ? 0 : order.pay_amount - baseAmount

  return (
    <BaseDialog show={show} title={t('payment.admin.orderDetail')} width="wide" onClose={() => onClose?.()}>
      {order && (
        <div className={styles.stack}>
          <dl className={styles.detailGrid}>
            <div>
              <dt>{t('payment.orders.orderId')}</dt>
              <dd className={styles.mono}>#{order.id}</dd>
            </div>
            <div>
              <dt>{t('payment.orders.status')}</dt>
              <dd>
                <Badge tone={statusBadgeTone(order.status)} size="sm">
                  {t('payment.status.' + order.status.toLowerCase(), order.status)}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>{t('payment.orders.baseAmount')}</dt>
              <dd className={styles.strong}>
                {paymentAmountSymbol}
                {baseAmount.toFixed(2)}
              </dd>
            </div>
            {order.fee_rate > 0 && (
              <div>
                <dt>
                  {t('payment.orders.fee')} ({order.fee_rate}%)
                </dt>
                <dd className={styles.strong}>
                  {paymentAmountSymbol}
                  {feeAmount.toFixed(2)}
                </dd>
              </div>
            )}
            <div>
              <dt>{t('payment.orders.payAmount')}</dt>
              <dd className={styles.strong}>
                {paymentAmountSymbol}
                {order.pay_amount.toFixed(2)}
              </dd>
            </div>
            {(order.bonus_amount ?? 0) > 0 && (
              <div>
                <dt>{t('payment.orders.bonusAmount')}</dt>
                <dd className={styles.bonus}>
                  +{creditedAmountSymbol}
                  {(order.bonus_amount ?? 0).toFixed(2)}
                </dd>
              </div>
            )}
            {(order.amount !== order.pay_amount || (order.bonus_amount ?? 0) > 0) && (
              <div>
                <dt>{t('payment.orders.creditedAmount')}</dt>
                <dd className={styles.strong}>
                  {creditedAmountSymbol}
                  {order.amount.toFixed(2)}
                </dd>
              </div>
            )}
            <div>
              <dt>{t('payment.orders.paymentMethod')}</dt>
              <dd>{t('payment.methods.' + order.payment_type, order.payment_type)}</dd>
            </div>
            <div>
              <dt>{t('payment.admin.orderType')}</dt>
              <dd>{t('payment.admin.' + order.order_type + 'Order', order.order_type)}</dd>
            </div>
            <div>
              <dt>{t('payment.orders.userId')}</dt>
              <dd>#{order.user_id}</dd>
            </div>
            <div>
              <dt>{t('payment.orders.createdAt')}</dt>
              <dd>{formatOrderDateTime(order.created_at)}</dd>
            </div>
            <div>
              <dt>{t('payment.admin.expiresAt')}</dt>
              <dd>{formatOrderDateTime(order.expires_at)}</dd>
            </div>
            {order.paid_at && (
              <div>
                <dt>{t('payment.admin.paidAt')}</dt>
                <dd>{formatOrderDateTime(order.paid_at)}</dd>
              </div>
            )}
            {order.completed_at && (
              <div>
                <dt>{t('payment.admin.completedAt')}</dt>
                <dd>{formatOrderDateTime(order.completed_at)}</dd>
              </div>
            )}
          </dl>

          {!!order.refund_amount && (
            <Alert tone="danger" title={t('payment.admin.refundInfo')}>
              <div>
                {t('payment.admin.refundAmount')}: {creditedAmountSymbol}
                {order.refund_amount.toFixed(2)}
              </div>
              {order.refund_reason && (
                <div>
                  {t('payment.admin.refundReason')}: {order.refund_reason}
                </div>
              )}
            </Alert>
          )}

          <div className={styles.footerActions}>
            {order.status === 'PENDING' && (
              <Button type="button" variant="secondary" size="sm" onClick={() => onCancel?.(order)}>
                {t('payment.orders.cancel')}
              </Button>
            )}
            {order.status === 'FAILED' && (
              <Button type="button" variant="secondary" size="sm" onClick={() => onRetry?.(order)}>
                {t('payment.admin.retry')}
              </Button>
            )}
            {canRefundStatus(order.status) && (
              <Button type="button" variant="danger" size="sm" onClick={() => onRefund?.(order)}>
                {t('payment.admin.refund')}
              </Button>
            )}
          </div>
        </div>
      )}
    </BaseDialog>
  )
}
