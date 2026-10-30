import type { ReactNode } from 'react'

import DataTable from '@/components/common/DataTable'
import type { Column } from '@/components/common/types'
import { useI18n } from '@/i18n/useI18n'
import type { PaymentOrder } from '@/types/payment'
import { currencySymbol } from './currency'
import OrderStatusBadge from './OrderStatusBadge'
import styles from './OrderTable.module.css'

export interface OrderTableProps {
  orders: PaymentOrder[]
  loading: boolean
  showUser?: boolean
  /** 操作列内容（Vue 版 #actions 插槽） */
  actions?: (row: PaymentOrder) => ReactNode
}

/** 管理员订单列表的行会附带用户名与备注（PaymentOrder 类型里没有声明） */
type OrderRow = PaymentOrder & { user_name?: string; user_notes?: string }

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString()
}

const creditedAmountSymbol = currencySymbol('USD')

function paymentAmountSymbol(order: PaymentOrder): string {
  return currencySymbol(order.currency)
}

/** 订单表格，对应 Vue 版 OrderTable.vue（用户订单页与管理员订单页共用） */
export default function OrderTable({ orders, loading, showUser = false, actions }: OrderTableProps) {
  const { t } = useI18n()

  const columns: Column<PaymentOrder>[] = [
    { key: 'id', label: t('payment.orders.orderId') },
    { key: 'out_trade_no', label: t('payment.orders.orderNo') }
  ]
  if (showUser) {
    columns.push({ key: 'user_email', label: t('payment.admin.colUser') })
  }
  columns.push(
    { key: 'pay_amount', label: t('payment.orders.payAmount') },
    { key: 'payment_type', label: t('payment.orders.paymentMethod') },
    { key: 'status', label: t('payment.orders.status') },
    { key: 'created_at', label: t('payment.orders.createdAt') },
    { key: 'actions', label: t('common.actions') }
  )

  const cells: Record<string, (ctx: { row: PaymentOrder; value: any }) => ReactNode> = {
    id: ({ value }) => <span className={styles.mono}>#{value}</span>,
    out_trade_no: ({ value }) => <span className={styles.text}>{value}</span>,
    pay_amount: ({ value, row }) => (
      <div className={styles.text}>
        <span className={styles.strong}>
          {paymentAmountSymbol(row)}
          {Number(value).toFixed(2)}
        </span>
        {row.fee_rate > 0 && (
          <span className={styles.aside} title={t('payment.orders.fee') + ': ' + row.fee_rate + '%'}>
            ({t('payment.orders.fee')} {row.fee_rate}%)
          </span>
        )}
        {(row.amount !== row.pay_amount || (row.bonus_amount ?? 0) > 0) && (
          <div className={styles.sub}>
            {t('payment.orders.creditedAmount')}: {creditedAmountSymbol}
            {row.amount.toFixed(2)}
            {(row.bonus_amount ?? 0) > 0 && (
              <span className={styles.bonus}>
                ({t('payment.orders.bonusIncluded', { amount: creditedAmountSymbol + (row.bonus_amount ?? 0).toFixed(2) })})
              </span>
            )}
          </div>
        )}
      </div>
    ),
    payment_type: ({ value }) => <span className={styles.text}>{t('payment.methods.' + value, value)}</span>,
    status: ({ value }) => <OrderStatusBadge status={value} />,
    created_at: ({ value }) => <span className={styles.muted}>{formatDate(value)}</span>,
    actions: ({ row }) => actions?.(row) ?? null
  }
  if (showUser) {
    cells.user_email = ({ value, row }: { value: any; row: OrderRow }) => (
      <div className={styles.text}>
        <span>{value || row.user_name || '#' + row.user_id}</span>
        {row.user_notes && <span className={styles.aside}>({row.user_notes})</span>}
      </div>
    )
  }

  return <DataTable columns={columns} data={orders} loading={loading} cells={cells} />
}
