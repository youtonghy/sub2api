import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PaymentOrder } from '@/types/payment'
import AdminRefundDialog from '../AdminRefundDialog'

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

function openRefund(overrides: Partial<PaymentOrder> = {}) {
  const order: PaymentOrder = {
    id: 1, user_id: 10, amount: 100, pay_amount: 100, fee_rate: 0,
    payment_type: 'stripe', out_trade_no: 'order-1', status: 'COMPLETED',
    order_type: 'balance', created_at: '2026-09-01', expires_at: '2026-09-02',
    refund_amount: 0, ...overrides
  }
  const view = render(<AdminRefundDialog show={false} order={order} userBalance={50} />)
  view.rerender(<AdminRefundDialog show order={order} userBalance={50} />)
  return view
}

const warning = 'payment.admin.insufficientBalance'
const bodyText = () => document.body.textContent ?? ''
const amountInput = () => document.querySelector<HTMLInputElement>('input[type="number"]')!

describe('refund balance warning', () => {
  it('compares the available balance with the edited refund amount', () => {
    openRefund()
    expect(bodyText()).toContain(warning)
    fireEvent.change(amountInput(), { target: { value: '20' } })
    expect(bodyText()).not.toContain(warning)
    fireEvent.change(amountInput(), { target: { value: '75' } })
    expect(bodyText()).toContain(warning)
  })

  it('does not warn when the balance exactly covers the refund', () => {
    openRefund()
    fireEvent.change(amountInput(), { target: { value: '50' } })
    expect(bodyText()).not.toContain(warning)
  })

  it('uses the remaining amount for an already partially refunded order', () => {
    openRefund({ status: 'PARTIALLY_REFUNDED', refund_amount: 80 })
    expect(amountInput().value).toBe('20')
    expect(bodyText()).not.toContain(warning)
  })

  it('keeps the warning hidden when balance deduction is disabled', () => {
    openRefund()
    // Vue 版对原生复选框 setValue(false)；React 版点击 Arc checkbox（Radix，role="checkbox"）
    fireEvent.click(document.getElementById('deduct-balance')!)
    expect(bodyText()).not.toContain(warning)
  })
})
