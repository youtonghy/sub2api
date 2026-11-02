import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { DollarSign, RefreshCw, X } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { Textarea } from '@/components/arc/textarea/textarea'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import Pagination from '@/components/common/Pagination'
import Select from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import OrderTable from '@/components/payment/OrderTable'
import ui from '@/components/payment/paymentUi.module.css'
import { paymentAPI } from '@/api/payment'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { PaymentOrder } from '@/types/payment'
import { extractI18nErrorMessage } from '@/utils/apiError'
import styles from './UserOrdersView.module.css'

interface PaginationState {
  page: number
  page_size: number
  total: number
}

export default function UserOrdersView() {
  const { t } = useI18n()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [refundEligibleProviders, setRefundEligibleProviders] = useState<Set<string>>(() => new Set())
  const [currentFilter, setCurrentFilter] = useState('')
  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null)
  const [refundTarget, setRefundTarget] = useState<PaymentOrder | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, page_size: 20, total: 0 })

  // 请求参数需要同步读取最新值（筛选、翻页后立即请求）
  const queryRef = useRef({ page: 1, page_size: 20, status: '' })

  const statusFilters = [
    { value: '', label: t('common.all') },
    { value: 'PENDING', label: t('payment.status.pending') },
    { value: 'COMPLETED', label: t('payment.status.completed') },
    { value: 'FAILED', label: t('payment.status.failed') },
    { value: 'REFUNDED', label: t('payment.status.refunded') },
  ]

  async function fetchOrders() {
    const query = queryRef.current
    setLoading(true)
    try {
      const res = await paymentAPI.getMyOrders({
        page: query.page,
        page_size: query.page_size,
        status: query.status || undefined,
      })
      setOrders(res.data.items || [])
      const total = res.data.total || 0
      setPagination((prev) => ({ ...prev, total }))
    } catch (err: unknown) {
      useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))
    } finally {
      setLoading(false)
    }
  }

  function updateQuery(next: Partial<typeof queryRef.current>) {
    queryRef.current = { ...queryRef.current, ...next }
    setPagination((prev) => ({ ...prev, page: queryRef.current.page, page_size: queryRef.current.page_size }))
  }

  function handlePageChange(page: number) {
    updateQuery({ page })
    void fetchOrders()
  }

  function handlePageSizeChange(size: number) {
    updateQuery({ page_size: size, page: 1 })
    void fetchOrders()
  }

  function handleFilterChange(status: string) {
    setCurrentFilter(status)
    queryRef.current = { ...queryRef.current, status }
    handlePageChange(1)
  }

  async function confirmCancel() {
    if (!cancelTargetId) return
    setActionLoading(true)
    try {
      await paymentAPI.cancelOrder(cancelTargetId)
      useAppStore.getState().showSuccess(t('common.success'))
      setCancelTargetId(null)
      await fetchOrders()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))
    } finally {
      setActionLoading(false)
    }
  }

  function openRefundDialog(order: PaymentOrder) {
    setRefundTarget(order)
    setRefundReason('')
  }

  async function confirmRefund() {
    if (!refundTarget || !refundReason.trim()) return
    setActionLoading(true)
    try {
      await paymentAPI.requestRefund(refundTarget.id, { reason: refundReason.trim() })
      useAppStore.getState().showSuccess(t('common.success'))
      setRefundTarget(null)
      setRefundReason('')
      await fetchOrders()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))
    } finally {
      setActionLoading(false)
    }
  }

  function canRequestRefund(order: PaymentOrder): boolean {
    if (order.status !== 'COMPLETED') return false
    if (!order.provider_instance_id) return false
    return refundEligibleProviders.has(order.provider_instance_id)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时加载订单，属于与后端同步的副作用
    void fetchOrders()
    void (async () => {
      try {
        const res = await paymentAPI.getRefundEligibleProviders()
        setRefundEligibleProviders(new Set(res.data.provider_instance_ids || []))
      } catch { /* ignore — default to hiding refund button */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const renderActions = (row: PaymentOrder) => (
    <div className={styles.rowActions}>
      {row.status === 'PENDING' && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setCancelTargetId(row.id)}>
          <X size={14} aria-hidden="true" />
          {t('payment.orders.cancel')}
        </Button>
      )}
      {canRequestRefund(row) && (
        <Button type="button" variant="ghost" size="sm" onClick={() => openRefundDialog(row)}>
          <DollarSign size={14} aria-hidden="true" />
          {t('payment.orders.requestRefund')}
        </Button>
      )}
    </div>
  )

  return (
    <>
      <TablePageLayout
        filters={
          <div className={styles.toolbar}>
            <Select
              className={styles.filterSelect}
              value={currentFilter}
              options={statusFilters}
              aria-label={t('payment.orders.status')}
              onChange={(value) => handleFilterChange(String(value ?? ''))}
            />
            <div className={styles.toolbarEnd}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void fetchOrders()}
                disabled={loading}
                title={t('common.refresh')}
                aria-label={t('common.refresh')}
              >
                <RefreshCw size={16} className={loading ? styles.spin : undefined} aria-hidden="true" />
              </Button>
              <Button type="button" onClick={() => navigate('/purchase')}>{t('payment.result.backToRecharge')}</Button>
            </div>
          </div>
        }
        table={<OrderTable orders={orders} loading={loading} actions={renderActions} />}
        pagination={
          pagination.total > 0 ? (
            <Pagination
              page={pagination.page}
              total={pagination.total}
              pageSize={pagination.page_size}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : undefined
        }
      />

      {/* Cancel Confirm Dialog */}
      <ConfirmDialog
        show={!!cancelTargetId}
        title={t('payment.orders.cancel')}
        message={t('payment.confirmCancel')}
        confirmText={t('payment.orders.cancel')}
        danger
        loading={actionLoading}
        onConfirm={confirmCancel}
        onCancel={() => setCancelTargetId(null)}
      />

      {/* Refund Dialog */}
      <BaseDialog
        show={!!refundTarget}
        title={t('payment.orders.requestRefund')}
        onClose={() => setRefundTarget(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setRefundTarget(null)}>{t('common.cancel')}</Button>
            <Button type="button" disabled={!refundReason.trim()} loading={actionLoading} onClick={confirmRefund}>
              {actionLoading ? t('common.processing') : t('payment.orders.requestRefund')}
            </Button>
          </>
        }
      >
        {refundTarget && (
          <div className={ui.stack}>
            <div className={ui.details}>
              <div className={ui.row}>
                <span className={ui.rowLabel}>{t('payment.orders.orderId')}</span>
                <span className={`${ui.rowValue} ${ui.mono}`}>#{refundTarget.id}</span>
              </div>
              <div className={ui.row}>
                <span className={ui.rowLabel}>{t('payment.orders.amount')}</span>
                <span className={ui.rowValue}>${refundTarget.amount.toFixed(2)}</span>
              </div>
            </div>
            <Textarea
              label={t('payment.refundReason')}
              rows={3}
              value={refundReason}
              placeholder={t('payment.refundReasonPlaceholder')}
              onChange={(event) => setRefundReason(event.target.value)}
            />
          </div>
        )}
      </BaseDialog>
    </>
  )
}
