import { DollarSign, Eye, RefreshCw, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import DataTable from '@/components/common/DataTable'
import Pagination from '@/components/common/Pagination'
import SearchInput from '@/components/common/SearchInput'
import Select from '@/components/common/Select'
import type { Column } from '@/components/common/types'
import { currencySymbol } from '@/components/payment/currency'
import { statusBadgeTone } from '@/components/payment/orderStatusTone'
import { canRefund, formatOrderDateTime } from '@/components/payment/orderUtils'
import { useI18n } from '@/i18n/useI18n'
import type { PaymentOrder } from '@/types/payment'
import { useOrderFilterOptions } from './orderFilterOptions'
import styles from './AdminPayment.module.css'

export interface AdminOrderFilters {
  keyword?: string
  status?: string
  payment_type?: string
  order_type?: string
}

export interface AdminOrderTableProps {
  orders: PaymentOrder[]
  loading: boolean
  page: number
  pageSize: number
  total: number
  onDetail?: (order: PaymentOrder) => void
  onCancel?: (order: PaymentOrder) => void
  onRetry?: (order: PaymentOrder) => void
  onRefund?: (order: PaymentOrder) => void
  onRefresh?: () => void
  /** Vue 版 update:page */
  onPageChange?: (page: number) => void
  /** Vue 版 update:pageSize */
  onPageSizeChange?: (size: number) => void
  onFilter?: (filters: AdminOrderFilters) => void
}

const creditedAmountSymbol = currencySymbol('USD')

function paymentAmountSymbol(order: PaymentOrder): string {
  return currencySymbol(order.currency)
}

/** 管理员订单表格（含筛选与分页），对应 Vue 版 AdminOrderTable.vue */
export default function AdminOrderTable({
  orders,
  loading,
  page,
  pageSize,
  total,
  onDetail,
  onCancel,
  onRetry,
  onRefund,
  onRefresh,
  onPageChange,
  onPageSizeChange,
  onFilter
}: AdminOrderTableProps) {
  const { t } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState({ status: '', payment_type: '', order_type: '' })
  const { statusFilterOptions, paymentTypeFilterOptions, orderTypeFilterOptions } = useOrderFilterOptions()

  const emitFiltersChanged = (keyword: string, next: typeof filters) => {
    onFilter?.({
      keyword: keyword || undefined,
      status: next.status || undefined,
      payment_type: next.payment_type || undefined,
      order_type: next.order_type || undefined
    })
  }

  const changeFilter = (key: keyof typeof filters, value: string) => {
    const next = { ...filters, [key]: value }
    setFilters(next)
    emitFiltersChanged(searchQuery, next)
  }

  const columns: Column<PaymentOrder>[] = [
    { key: 'id', label: t('payment.orders.orderId') },
    { key: 'user_id', label: t('payment.orders.userId') },
    { key: 'pay_amount', label: t('payment.orders.payAmount') },
    { key: 'payment_type', label: t('payment.orders.paymentMethod') },
    { key: 'status', label: t('payment.orders.status') },
    { key: 'order_type', label: t('payment.orders.orderType') },
    { key: 'created_at', label: t('payment.orders.createdAt') },
    { key: 'actions', label: t('payment.orders.actions') }
  ]

  const cells: Record<string, (ctx: { row: PaymentOrder; value: any }) => ReactNode> = {
    id: ({ value }) => <span className={styles.mono}>#{value}</span>,
    user_id: ({ value }) => <span className={styles.secondary}>#{value}</span>,
    pay_amount: ({ value, row }) => (
      <div className={styles.cellText}>
        <span className={styles.strong}>
          {paymentAmountSymbol(row)}
          {Number(value).toFixed(2)}
        </span>
        {row.fee_rate > 0 && (
          <span className={styles.aside} title={t('payment.orders.fee') + ': ' + row.fee_rate + '%'}>
            ({row.fee_rate}%)
          </span>
        )}
        {(row.amount !== row.pay_amount || (row.bonus_amount ?? 0) > 0) && (
          <div className={styles.sub}>
            {t('payment.orders.creditedAmount')}: {creditedAmountSymbol}
            {row.amount.toFixed(2)}
            {(row.bonus_amount ?? 0) > 0 && (
              <span className={styles.bonusInline}>
                ({t('payment.orders.bonusIncluded', { amount: creditedAmountSymbol + (row.bonus_amount ?? 0).toFixed(2) })})
              </span>
            )}
          </div>
        )}
      </div>
    ),
    payment_type: ({ value }) => <span className={styles.cellText}>{t('payment.methods.' + value, value)}</span>,
    status: ({ value }) => (
      <Badge tone={statusBadgeTone(value)} size="sm">
        {t('payment.status.' + String(value).toLowerCase(), value)}
      </Badge>
    ),
    order_type: ({ value }) => <span className={styles.cellText}>{t('payment.admin.' + value + 'Order', value)}</span>,
    created_at: ({ value }) => <span className={styles.muted}>{formatOrderDateTime(value)}</span>,
    actions: ({ row }) => (
      <div className={styles.rowActions}>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDetail?.(row)}>
          <Eye size={14} aria-hidden="true" />
          {t('common.view')}
        </Button>
        {row.status === 'PENDING' && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onCancel?.(row)}>
            <X size={14} aria-hidden="true" />
            {t('payment.orders.cancel')}
          </Button>
        )}
        {row.status === 'FAILED' && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onRetry?.(row)}>
            <RefreshCw size={14} aria-hidden="true" />
            {t('payment.admin.retry')}
          </Button>
        )}
        {canRefund(row.status) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onRefund?.(row)}>
            <DollarSign size={14} aria-hidden="true" />
            {t('payment.admin.refund')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <SearchInput
          className={styles.search}
          value={searchQuery}
          placeholder={t('payment.admin.searchOrders')}
          onChange={setSearchQuery}
          onSearch={(keyword) => emitFiltersChanged(keyword, filters)}
        />
        <Select
          className={styles.filterSelect}
          value={filters.status}
          options={statusFilterOptions}
          aria-label={t('payment.orders.status')}
          onChange={(value) => changeFilter('status', String(value ?? ''))}
        />
        <Select
          className={styles.filterSelect}
          value={filters.payment_type}
          options={paymentTypeFilterOptions}
          aria-label={t('payment.orders.paymentMethod')}
          onChange={(value) => changeFilter('payment_type', String(value ?? ''))}
        />
        <Select
          className={styles.filterSelect}
          value={filters.order_type}
          options={orderTypeFilterOptions}
          aria-label={t('payment.orders.orderType')}
          onChange={(value) => changeFilter('order_type', String(value ?? ''))}
        />
        <div className={styles.toolbarEnd}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onRefresh?.()}
            disabled={loading}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          >
            <RefreshCw size={16} className={loading ? styles.spin : undefined} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className={styles.region}>
        <DataTable columns={columns} data={orders} loading={loading} cells={cells} />
        {total > 0 && (
          <Pagination
            page={page}
            total={total}
            pageSize={pageSize}
            onPageChange={(next) => onPageChange?.(next)}
            onPageSizeChange={(size) => onPageSizeChange?.(size)}
          />
        )}
      </div>
    </div>
  )
}
