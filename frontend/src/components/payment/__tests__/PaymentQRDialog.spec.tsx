import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PaymentQRDialog from '../PaymentQRDialog'

const pollOrderStatus = vi.hoisted(() => vi.fn())
const cancelOrder = vi.hoisted(() => vi.fn())
const verifyOrder = vi.hoisted(() => vi.fn())
const showError = vi.hoisted(() => vi.fn())
const toCanvas = vi.hoisted(() => vi.fn())

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

vi.mock('@/stores/payment', () => ({
  usePaymentStore: { getState: () => ({ pollOrderStatus }) },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showError }) },
}))

vi.mock('@/api/payment', () => ({
  paymentAPI: {
    cancelOrder,
    verifyOrder,
  },
}))

vi.mock('qrcode', () => ({
  default: {
    toCanvas,
  },
}))

// Vue 版 BaseDialog 桩：show 时直接渲染内容与 footer
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children, footer }: { show: boolean; children?: ReactNode; footer?: ReactNode }) =>
    show ? <div>{children}{footer}</div> : null,
}))

const paidOrder = {
  id: 42,
  user_id: 9,
  amount: 100,
  pay_amount: 108,
  currency: 'CNY',
  fee_rate: 8,
  payment_type: 'alipay',
  out_trade_no: 'sub2_202606250001',
  status: 'COMPLETED',
  order_type: 'subscription',
  created_at: '2026-06-25T10:00:00Z',
  expires_at: '2099-01-01T10:30:00Z',
  refund_amount: 0,
}

describe('PaymentQRDialog currency display', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pollOrderStatus.mockReset().mockResolvedValue(paidOrder)
    cancelOrder.mockReset()
    verifyOrder.mockReset()
    showError.mockReset()
    toCanvas.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses order currency for pay_amount and USD for credited amount', async () => {
    const props = {
      orderId: 42,
      qrCode: '',
      expiresAt: '2099-01-01T10:30:00Z',
      paymentType: 'alipay',
    }
    const { container, rerender } = render(<PaymentQRDialog {...props} show={false} />)

    rerender(<PaymentQRDialog {...props} show />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(pollOrderStatus).toHaveBeenCalledWith(42)
    expect(container.textContent).toContain('$100.00')
    expect(container.textContent).toContain('¥108.00')
  })
})
