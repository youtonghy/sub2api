/**
 * 管理员订单列表，对应 Vue 版 views/admin/orders/AdminOrdersView.vue：
 * 搜索与筛选、订单表格、详情（含审计日志）、取消 / 重试、退款与退款状态查询。
 */
import { Check, DollarSign, Eye, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { adminPaymentAPI } from '@/api/admin/payment'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import AdminRefundDialog, { type AdminRefundConfirmData } from '@/components/admin/payment/AdminRefundDialog'
import { useOrderFilterOptions } from '@/components/admin/payment/orderFilterOptions'
import BaseDialog from '@/components/common/BaseDialog'
import Pagination from '@/components/common/Pagination'
import SearchInput from '@/components/common/SearchInput'
import Select from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import { currencySymbol } from '@/components/payment/currency'
import OrderStatusBadge from '@/components/payment/OrderStatusBadge'
import OrderTable from '@/components/payment/OrderTable'
import { formatOrderDateTime } from '@/components/payment/orderUtils'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { PaymentOrder } from '@/types/payment'
import { extractI18nErrorMessage } from '@/utils/apiError'
import styles from './Orders.module.css'

interface AuditLog {
  id: number
  action: string
  detail: string | null
  operator: string | null
  created_at: string
}

interface OrderQuery {
  keyword: string
  status: string
  payment_type: string
  order_type: string
  page: number
  page_size: number
}

const creditedAmountSymbol = currencySymbol('USD')

function paymentAmountSymbol(order: PaymentOrder | null | undefined): string {
  return currencySymbol(order?.currency)
}

function formatDateTime(dateStr: string): string {
  return formatOrderDateTime(dateStr)
}

function isRefundPendingWarning(warning: string | undefined): boolean {
  return /pending|处理中|待/.test(String(warning || '').toLowerCase())
}

export default function AdminOrdersView() {
  const { t } = useI18n()
  const { statusFilterOptions, paymentTypeFilterOptions, orderTypeFilterOptions } = useOrderFilterOptions()

  const [ordersLoading, setOrdersLoading] = useState(false)
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [total, setTotal] = useState(0)
  // 查询条件同时保存在 ref 里，防抖与异步回调总是读到最新值（Vue 版直接读 reactive）
  const [initialQuery] = useState<OrderQuery>(() => ({
    keyword: '',
    status: '',
    payment_type: '',
    order_type: '',
    page: 1,
    page_size: 20
  }))
  const queryRef = useRef<OrderQuery>(initialQuery)
  const [query, setQuery] = useState<OrderQuery>(initialQuery)
  const loadSeq = useRef(0)

  const [selectedOrder, setSelectedOrder] = useState<PaymentOrder | null>(null)
  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const [showRefundDialog, setShowRefundDialog] = useState(false)
  const [refundSubmitting, setRefundSubmitting] = useState(false)
  const [refundRequireForce, setRefundRequireForce] = useState(false)
  const [refundWarning, setRefundWarning] = useState('')
  const [refundQueryingIds, setRefundQueryingIds] = useState<Set<number>>(() => new Set())
  const [orderAuditLogs, setOrderAuditLogs] = useState<AuditLog[]>([])

  const showError = (err: unknown) =>
    useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))

  const updateQuery = (patch: Partial<OrderQuery>) => {
    queryRef.current = { ...queryRef.current, ...patch }
    setQuery(queryRef.current)
  }

  async function loadOrders() {
    const q = queryRef.current
    const seq = ++loadSeq.current
    setOrdersLoading(true)
    try {
      const res = await adminPaymentAPI.getOrders({
        page: q.page,
        page_size: q.page_size,
        keyword: q.keyword || undefined,
        status: q.status || undefined,
        payment_type: q.payment_type || undefined,
        order_type: q.order_type || undefined
      })
      if (seq !== loadSeq.current) return
      setOrders(res.data.items || [])
      setTotal(res.data.total || 0)
    } catch (err: unknown) {
      if (seq !== loadSeq.current) return
      showError(err)
    } finally {
      if (seq === loadSeq.current) setOrdersLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 首次进入页面时加载订单（Vue 版 onMounted）
    void loadOrders()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOrderPageChange = (page: number) => {
    updateQuery({ page })
    void loadOrders()
  }
  const handleOrderPageSizeChange = (size: number) => {
    updateQuery({ page_size: size, page: 1 })
    void loadOrders()
  }

  const changeFilter = (patch: Partial<OrderQuery>) => {
    updateQuery(patch)
    void loadOrders()
  }

  async function showOrderDetail(order: PaymentOrder) {
    setSelectedOrder(order)
    setOrderAuditLogs([])
    setShowDetailDialog(true)
    try {
      const res = await adminPaymentAPI.getOrder(order.id)
      const data = res.data as unknown as Record<string, unknown>
      if (data.order) setSelectedOrder(data.order as PaymentOrder)
      setOrderAuditLogs((data.auditLogs || data.audit_logs || []) as unknown as AuditLog[])
    } catch {
      /* keep cached order data */
    }
  }

  async function handleCancelOrder(order: PaymentOrder) {
    try {
      await adminPaymentAPI.cancelOrder(order.id)
      useAppStore.getState().showSuccess(t('payment.admin.orderCancelled'))
      void loadOrders()
    } catch (err: unknown) {
      showError(err)
    }
  }

  async function handleRetryOrder(order: PaymentOrder) {
    try {
      await adminPaymentAPI.retryRecharge(order.id)
      useAppStore.getState().showSuccess(t('payment.admin.retrySuccess'))
      void loadOrders()
    } catch (err: unknown) {
      showError(err)
    }
  }

  function openRefundDialog(order: PaymentOrder) {
    setSelectedOrder(order)
    setRefundRequireForce(false)
    setRefundWarning('')
    setShowRefundDialog(true)
  }

  function closeRefundDialog() {
    setShowRefundDialog(false)
    setRefundRequireForce(false)
    setRefundWarning('')
  }

  async function handleRefund(data: AdminRefundConfirmData) {
    if (!selectedOrder) return
    setRefundSubmitting(true)
    try {
      const res = await adminPaymentAPI.refundOrder(selectedOrder.id, {
        amount: data.amount,
        reason: data.reason,
        deduct_balance: data.deduct_balance,
        force: data.force
      })
      if (res.data.success) {
        useAppStore.getState().showSuccess(t('payment.admin.refundSuccess'))
        closeRefundDialog()
        void loadOrders()
        return
      }
      if (isRefundPendingWarning(res.data.warning)) {
        useAppStore.getState().showSuccess(t('payment.admin.refundPending'))
        closeRefundDialog()
        void loadOrders()
        return
      }
      if (res.data.require_force) {
        // Backend needs an explicit force confirmation (e.g. the user spent their
        // balance after requesting the refund). Keep the dialog open and surface
        // the force checkbox instead of dropping the admin back to the list.
        setRefundRequireForce(true)
        setRefundWarning(res.data.warning || '')
        return
      }
      useAppStore.getState().showError(res.data.warning || t('common.error'))
    } catch (err: unknown) {
      showError(err)
    } finally {
      setRefundSubmitting(false)
    }
  }

  async function handleQueryRefund(order: PaymentOrder) {
    setRefundQueryingIds((prev) => new Set(prev).add(order.id))
    try {
      const res = await adminPaymentAPI.queryRefund(order.id)
      if (res.data.success) {
        useAppStore.getState().showSuccess(t('payment.admin.refundSuccess'))
      } else if (isRefundPendingWarning(res.data.warning)) {
        useAppStore.getState().showSuccess(t('payment.admin.refundPending'))
      } else {
        useAppStore.getState().showError(res.data.warning || t('common.error'))
      }
      void loadOrders()
    } catch (err: unknown) {
      showError(err)
    } finally {
      setRefundQueryingIds((prev) => {
        const next = new Set(prev)
        next.delete(order.id)
        return next
      })
    }
  }

  const renderActions = (row: PaymentOrder) => {
    const querying = refundQueryingIds.has(row.id)
    return (
      <div className={styles.rowActions}>
        <Button type="button" variant="ghost" size="sm" onClick={() => void showOrderDetail(row)}>
          <Eye size={14} aria-hidden="true" />
          {t('common.view')}
        </Button>
        {row.status === 'PENDING' && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleCancelOrder(row)}>
            <X size={14} aria-hidden="true" />
            {t('payment.orders.cancel')}
          </Button>
        )}
        {row.status === 'FAILED' && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleRetryOrder(row)}>
            <RefreshCw size={14} aria-hidden="true" />
            {t('payment.admin.retry')}
          </Button>
        )}
        {row.status === 'REFUND_REQUESTED' ? (
          <>
            {!!row.refund_amount && (
              <Badge tone="info" size="sm">
                {creditedAmountSymbol}
                {row.refund_amount.toFixed(2)}
              </Badge>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => openRefundDialog(row)}>
              <Check size={14} aria-hidden="true" />
              {t('payment.admin.approveRefund')}
            </Button>
          </>
        ) : row.status === 'REFUND_FAILED' ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => openRefundDialog(row)}>
            <RefreshCw size={14} aria-hidden="true" />
            {t('payment.admin.retryRefund')}
          </Button>
        ) : row.status === 'REFUND_PENDING' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={querying}
            onClick={() => void handleQueryRefund(row)}
          >
            <RefreshCw size={14} className={querying ? styles.spin : undefined} aria-hidden="true" />
            {t('payment.admin.queryRefundStatus')}
          </Button>
        ) : row.status === 'COMPLETED' || row.status === 'PARTIALLY_REFUNDED' ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => openRefundDialog(row)}>
            <DollarSign size={14} aria-hidden="true" />
            {t('payment.admin.refund')}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <TablePageLayout
        filters={
          <div className={styles.toolbar}>
            <SearchInput
              className={styles.search}
              value={query.keyword}
              placeholder={t('payment.admin.searchOrders')}
              onChange={(keyword) => updateQuery({ keyword })}
              onSearch={() => void loadOrders()}
            />
            <Select
              className={styles.filterSelect}
              value={query.status}
              options={statusFilterOptions}
              aria-label={t('payment.orders.status')}
              onChange={(value) => changeFilter({ status: String(value ?? '') })}
            />
            <Select
              className={styles.filterSelectWide}
              value={query.payment_type}
              options={paymentTypeFilterOptions}
              aria-label={t('payment.orders.paymentMethod')}
              onChange={(value) => changeFilter({ payment_type: String(value ?? '') })}
            />
            <Select
              className={styles.filterSelect}
              value={query.order_type}
              options={orderTypeFilterOptions}
              aria-label={t('payment.admin.orderType')}
              onChange={(value) => changeFilter({ order_type: String(value ?? '') })}
            />
            <div className={styles.toolbarEnd}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void loadOrders()}
                disabled={ordersLoading}
                title={t('common.refresh')}
                aria-label={t('common.refresh')}
              >
                <RefreshCw size={16} className={ordersLoading ? styles.spin : undefined} aria-hidden="true" />
              </Button>
            </div>
          </div>
        }
        table={<OrderTable orders={orders} loading={ordersLoading} showUser actions={renderActions} />}
        pagination={
          total > 0 ? (
            <Pagination
              page={query.page}
              total={total}
              pageSize={query.page_size}
              onPageChange={handleOrderPageChange}
              onPageSizeChange={handleOrderPageSizeChange}
            />
          ) : undefined
        }
      />

      {/* Order Detail Dialog */}
      <BaseDialog
        show={showDetailDialog}
        title={t('payment.admin.orderDetail')}
        width="wide"
        onClose={() => setShowDetailDialog(false)}
      >
        {selectedOrder && (
          <div className={styles.detail}>
            <dl className={styles.detailGrid}>
              <div>
                <dt>{t('payment.orders.orderId')}</dt>
                <dd className={styles.mono}>#{selectedOrder.id}</dd>
              </div>
              <div>
                <dt>{t('payment.orders.orderNo')}</dt>
                <dd className={styles.strong}>{selectedOrder.out_trade_no}</dd>
              </div>
              <div>
                <dt>{t('payment.orders.status')}</dt>
                <dd>
                  <OrderStatusBadge status={selectedOrder.status} />
                </dd>
              </div>
              <div>
                <dt>{t('payment.orders.amount')}</dt>
                <dd className={styles.strong}>
                  {creditedAmountSymbol}
                  {selectedOrder.amount.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt>{t('payment.orders.payAmount')}</dt>
                <dd className={styles.strong}>
                  {paymentAmountSymbol(selectedOrder)}
                  {selectedOrder.pay_amount.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt>{t('payment.orders.paymentMethod')}</dt>
                <dd>{t('payment.methods.' + selectedOrder.payment_type, selectedOrder.payment_type)}</dd>
              </div>
              <div>
                <dt>{t('payment.admin.feeRate')}</dt>
                <dd>{selectedOrder.fee_rate}%</dd>
              </div>
              <div>
                <dt>{t('payment.orders.createdAt')}</dt>
                <dd>{formatDateTime(selectedOrder.created_at)}</dd>
              </div>
              <div>
                <dt>{t('payment.admin.expiresAt')}</dt>
                <dd>{formatDateTime(selectedOrder.expires_at)}</dd>
              </div>
              {selectedOrder.paid_at && (
                <div>
                  <dt>{t('payment.admin.paidAt')}</dt>
                  <dd>{formatDateTime(selectedOrder.paid_at)}</dd>
                </div>
              )}
              {!!selectedOrder.refund_amount && (
                <div>
                  <dt>{t('payment.admin.refundAmount')}</dt>
                  <dd className={styles.danger}>
                    {creditedAmountSymbol}
                    {selectedOrder.refund_amount.toFixed(2)}
                  </dd>
                </div>
              )}
              {selectedOrder.refund_reason && (
                <div className={styles.span2}>
                  <dt>{t('payment.admin.refundReason')}</dt>
                  <dd>{selectedOrder.refund_reason}</dd>
                </div>
              )}
            </dl>

            {/* Refund request info */}
            {selectedOrder.refund_requested_at && (
              <section className={styles.detailSection}>
                <h3 className={styles.detailHeading}>{t('payment.admin.refundRequestInfo')}</h3>
                <dl className={styles.detailGrid}>
                  <div>
                    <dt>{t('payment.admin.refundRequestedAt')}</dt>
                    <dd>{formatDateTime(selectedOrder.refund_requested_at)}</dd>
                  </div>
                  <div>
                    <dt>{t('payment.admin.refundRequestedBy')}</dt>
                    <dd>#{selectedOrder.refund_requested_by}</dd>
                  </div>
                  <div className={styles.span2}>
                    <dt>{t('payment.admin.refundRequestReason')}</dt>
                    <dd>{selectedOrder.refund_request_reason}</dd>
                  </div>
                </dl>
              </section>
            )}

            {/* Audit Logs */}
            {orderAuditLogs.length > 0 && (
              <section className={styles.detailSection}>
                <h3 className={styles.detailHeading}>{t('payment.admin.auditLogs')}</h3>
                <ul className={styles.auditList}>
                  {orderAuditLogs.map((log) => (
                    <li key={log.id} className={styles.auditItem}>
                      <div className={styles.auditHead}>
                        <span className={styles.strong}>{log.action}</span>
                        <span className={styles.muted}>{formatDateTime(log.created_at)}</span>
                      </div>
                      {log.detail && <div className={styles.auditDetail}>{log.detail}</div>}
                      {log.operator && (
                        <div className={styles.muted}>
                          {t('payment.admin.operator')}: {log.operator}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </BaseDialog>

      <AdminRefundDialog
        show={showRefundDialog}
        order={selectedOrder}
        submitting={refundSubmitting}
        requireForce={refundRequireForce}
        warning={refundWarning}
        onConfirm={(data) => void handleRefund(data)}
        onCancel={closeRefundDialog}
      />
    </>
  )
}
