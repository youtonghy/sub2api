import { useId, useState, type FormEvent } from 'react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import TextArea from '@/components/common/TextArea'
import { currencySymbol } from '@/components/payment/currency'
import { formatOrderDateTime } from '@/components/payment/orderUtils'
import { useI18n } from '@/i18n/useI18n'
import type { PaymentOrder } from '@/types/payment'
import styles from './AdminPayment.module.css'

export interface AdminRefundConfirmData {
  amount: number
  reason: string
  deduct_balance: boolean
  force: boolean
}

export interface AdminRefundDialogProps {
  show: boolean
  order: PaymentOrder | null
  submitting?: boolean
  userBalance?: number | null
  requireForce?: boolean
  warning?: string
  onConfirm?: (data: AdminRefundConfirmData) => void
  onCancel?: () => void
}

const creditedAmountSymbol = currencySymbol('USD')

// In REFUND_REQUESTED / REFUND_PENDING status, refund_amount is requested/pending, not actually refunded.
// Only PARTIALLY_REFUNDED / REFUNDED have real refund amounts.
function actuallyRefundedOf(order: PaymentOrder | null): number {
  if (!order) return 0
  const s = order.status
  if (s === 'PARTIALLY_REFUNDED' || s === 'REFUNDED') return order.refund_amount || 0
  return 0
}

function maxRefundableOf(order: PaymentOrder | null): number {
  if (!order) return 0
  return order.amount - actuallyRefundedOf(order)
}

function initialAmount(order: PaymentOrder): number {
  // For REFUND_REQUESTED, pre-fill with the requested amount
  if (order.status === 'REFUND_REQUESTED' && order.refund_amount) return order.refund_amount
  return maxRefundableOf(order)
}

/** 管理员退款对话框，对应 Vue 版 AdminRefundDialog.vue */
export default function AdminRefundDialog({
  show,
  order,
  submitting = false,
  userBalance,
  requireForce = false,
  warning,
  onConfirm,
  onCancel
}: AdminRefundDialogProps) {
  const { t } = useI18n()
  const formId = useId()

  const [amountText, setAmountText] = useState(() => (show && order ? String(initialAmount(order)) : '0'))
  const [reason, setReason] = useState(() => (show && order ? order.refund_request_reason || '' : ''))
  const [deductBalance, setDeductBalance] = useState(true)
  const [force, setForce] = useState(false)

  // 打开时重置表单（Vue 版 watch(() => props.show)）
  const [lastShow, setLastShow] = useState(show)
  if (lastShow !== show) {
    setLastShow(show)
    if (show && order) {
      setAmountText(String(initialAmount(order)))
      setReason(order.refund_request_reason || '')
      setDeductBalance(true)
      setForce(false)
    }
  }

  // v-model.number：空输入按 0 处理
  const amount = amountText.trim() === '' ? 0 : Number(amountText)
  const paymentAmountSymbol = currencySymbol(order?.currency)
  const actuallyRefunded = actuallyRefundedOf(order)
  const maxRefundable = maxRefundableOf(order)
  const balanceInsufficient = userBalance != null && !!order && userBalance < amount

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!(amount > 0) || amount > maxRefundable) return
    if (requireForce && !force) return
    onConfirm?.({ amount, reason, deduct_balance: deductBalance, force })
  }

  return (
    <BaseDialog
      show={show}
      title={t('payment.admin.refundOrder')}
      width="normal"
      onClose={() => onCancel?.()}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onCancel?.()}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="danger"
            disabled={submitting || !(amount > 0) || (requireForce && !force)}
          >
            {submitting ? t('common.processing') : t('payment.admin.confirmRefund')}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={handleSubmit}>
        {/* Refund Request Info */}
        {(order?.refund_requested_at || order?.refund_request_reason) && (
          <Alert tone="info" title={t('payment.admin.refundRequestInfo')}>
            {order?.refund_requested_at && (
              <div className={styles.infoRow}>
                <span>{t('payment.admin.refundRequestedAt')}</span>
                <span>{formatOrderDateTime(order.refund_requested_at)}</span>
              </div>
            )}
            {order?.refund_request_reason && (
              <div>
                {t('payment.admin.refundRequestReason')}: {order.refund_request_reason}
              </div>
            )}
          </Alert>
        )}

        {/* Order Info */}
        <dl className={styles.summary}>
          <div className={styles.summaryRow}>
            <dt>{t('payment.orders.orderId')}</dt>
            <dd className={styles.mono}>#{order?.id}</dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>{t('payment.orders.creditedAmount')}</dt>
            <dd className={styles.strong}>
              {creditedAmountSymbol}
              {order?.amount?.toFixed(2)}
            </dd>
          </div>
          <div className={styles.summaryRow}>
            <dt>{t('payment.orders.payAmount')}</dt>
            <dd className={styles.strong}>
              {paymentAmountSymbol}
              {order?.pay_amount?.toFixed(2)}
            </dd>
          </div>
          {actuallyRefunded > 0 && (
            <div className={styles.summaryRow}>
              <dt>{t('payment.admin.alreadyRefunded')}</dt>
              <dd className={styles.danger}>
                {creditedAmountSymbol}
                {actuallyRefunded.toFixed(2)}
              </dd>
            </div>
          )}
        </dl>

        {/* Deduct Balance */}
        <div className={styles.stack}>
          <div className={styles.checkRow}>
            <Checkbox
              id="deduct-balance"
              checked={deductBalance}
              onCheckedChange={(checked) => setDeductBalance(checked === true)}
              label={t('payment.admin.deductBalance')}
            />
            <span className={styles.hint}>{t('payment.admin.deductBalanceHint')}</span>
          </div>

          {/* User Balance Info (when deduct_balance is checked) */}
          {deductBalance && userBalance != null && (
            <div className={styles.balanceGrid}>
              <div className={styles.balanceCell}>
                <div className={styles.balanceLabel}>{t('payment.admin.userBalance')}</div>
                <div className={styles.balanceValue}>
                  {creditedAmountSymbol}
                  {userBalance.toFixed(2)}
                </div>
              </div>
              <div className={styles.balanceCell}>
                <div className={styles.balanceLabel}>{t('payment.admin.orderAmount')}</div>
                <div className={styles.balanceValue}>
                  {creditedAmountSymbol}
                  {order?.amount?.toFixed(2)}
                </div>
              </div>
            </div>
          )}

          {/* Insufficient balance warning */}
          {deductBalance && balanceInsufficient && (
            <Alert tone="warning" title={t('payment.admin.insufficientBalance')} />
          )}

          {/* No deduction info */}
          {!deductBalance && <Alert tone="info" title={t('payment.admin.noDeduction')} />}
        </div>

        {/* Refund Amount */}
        <Input
          label={t('payment.admin.refundAmount')}
          type="number"
          step="0.01"
          min="0.01"
          max={maxRefundable}
          required
          value={amountText}
          onChange={setAmountText}
          prefix={<span>{creditedAmountSymbol}</span>}
          hint={`${t('payment.admin.maxRefundable')}: ${creditedAmountSymbol}${maxRefundable.toFixed(2)}`}
        />

        {/* Reason */}
        <TextArea
          label={t('payment.admin.refundReason')}
          rows={3}
          required
          value={reason}
          onChange={setReason}
          placeholder={t('payment.admin.refundReasonPlaceholder')}
        />

        {/* Warning */}
        {warning && <Alert tone="warning" title={warning} />}

        {/* Force Refund */}
        {requireForce && (
          <Checkbox
            id="force-refund"
            checked={force}
            onCheckedChange={(checked) => setForce(checked === true)}
            label={t('payment.admin.forceRefund')}
          />
        )}
      </form>
    </BaseDialog>
  )
}
