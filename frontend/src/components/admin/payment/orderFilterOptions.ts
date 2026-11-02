import { useI18n } from '@/i18n/useI18n'

/** 管理员订单筛选项（AdminOrderTable 与 AdminOrdersView 相同，Vue 版各写了一份） */
export function useOrderFilterOptions() {
  const { t } = useI18n()

  const statusFilterOptions = [
    { value: '', label: t('payment.admin.allStatuses') },
    { value: 'PENDING', label: t('payment.status.pending') },
    { value: 'PAID', label: t('payment.status.paid') },
    { value: 'COMPLETED', label: t('payment.status.completed') },
    { value: 'EXPIRED', label: t('payment.status.expired') },
    { value: 'CANCELLED', label: t('payment.status.cancelled') },
    { value: 'FAILED', label: t('payment.status.failed') },
    { value: 'REFUNDED', label: t('payment.status.refunded') },
    { value: 'REFUND_REQUESTED', label: t('payment.status.refund_requested') },
    { value: 'REFUND_PENDING', label: t('payment.status.refund_pending') },
    { value: 'REFUND_FAILED', label: t('payment.status.refund_failed') }
  ]

  const paymentTypeFilterOptions = [
    { value: '', label: t('payment.admin.allPaymentTypes') },
    { value: 'alipay', label: t('payment.methods.alipay') },
    { value: 'wxpay', label: t('payment.methods.wxpay') },
    { value: 'stripe', label: t('payment.methods.stripe') },
    { value: 'airwallex', label: t('payment.methods.airwallex') }
  ]

  const orderTypeFilterOptions = [
    { value: '', label: t('payment.admin.allOrderTypes') },
    { value: 'balance', label: t('payment.admin.balanceOrder') },
    { value: 'subscription', label: t('payment.admin.subscriptionOrder') }
  ]

  return { statusFilterOptions, paymentTypeFilterOptions, orderTypeFilterOptions }
}
