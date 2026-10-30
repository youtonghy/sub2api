import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import OrderTable from '@/components/payment/OrderTable'
import type { PaymentOrder } from '@/types/payment'
import AdminOrderDetail from '../AdminOrderDetail'
import AdminOrderTable from '../AdminOrderTable'
import AdminRefundDialog from '../AdminRefundDialog'

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

function orderFactory(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 1,
    user_id: 10,
    amount: 100,
    pay_amount: 108,
    currency: 'USD',
    fee_rate: 8,
    payment_type: 'stripe',
    out_trade_no: 'sub2_202606250001',
    status: 'COMPLETED',
    order_type: 'subscription',
    created_at: '2026-06-25T10:00:00Z',
    expires_at: '2026-06-25T10:30:00Z',
    refund_amount: 25,
    ...overrides
  }
}

// 对话框渲染到 body 下的 portal
const bodyText = () => document.body.textContent ?? ''

describe('admin order currency display', () => {
  it('uses order currency for paid/base/fee amounts and USD for credited/refund amounts', () => {
    render(<AdminOrderDetail show order={orderFactory({ currency: 'CNY' })} />)

    const text = bodyText()
    expect(text).toContain('¥100.00')
    expect(text).toContain('¥8.00')
    expect(text).toContain('¥108.00')
    expect(text).toContain('$100.00')
    expect(text).toContain('$25.00')
  })

  it('uses order currency for pay_amount and USD for refundable balance amounts', () => {
    render(
      <AdminRefundDialog
        show
        order={orderFactory({ currency: 'USD', status: 'PARTIALLY_REFUNDED', refund_amount: 20 })}
        userBalance={200}
      />
    )

    const text = bodyText()
    expect(text).toContain('$108.00')
    expect(text).toContain('$100.00')
    expect(text).toContain('$20.00')
    expect(text).toContain('$80.00')
    expect(text).toContain('$200.00')
  })

  it('renders payment currency consistently in the shared order table', () => {
    const { container } = render(
      <OrderTable
        orders={[
          orderFactory({ id: 1, currency: 'USD', amount: 100, pay_amount: 108 }),
          orderFactory({ id: 2, currency: 'CNY', amount: 100, pay_amount: 108 })
        ]}
        loading={false}
        showUser
      />
    )

    const text = container.textContent ?? ''
    expect(text).toContain('$108.00')
    expect(text).toContain('¥108.00')
    expect(text).toContain('$100.00')
  })

  it('renders payment currency consistently in the admin order table', () => {
    const { container } = render(
      <AdminOrderTable
        orders={[
          orderFactory({ id: 1, currency: 'USD', amount: 100, pay_amount: 108 }),
          orderFactory({ id: 2, currency: 'CNY', amount: 100, pay_amount: 108 })
        ]}
        loading={false}
        page={1}
        pageSize={20}
        total={2}
      />
    )

    const text = container.textContent ?? ''
    expect(text).toContain('$108.00')
    expect(text).toContain('¥108.00')
    expect(text).toContain('$100.00')
  })
})
