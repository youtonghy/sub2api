import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import PaymentStatusPanel, { type PaymentStatusPanelProps } from '../PaymentStatusPanel'

const orderFactory = (status: string) => ({
  id: 42,
  user_id: 9,
  amount: 88,
  pay_amount: 88,
  fee_rate: 0,
  payment_type: 'alipay',
  out_trade_no: 'sub2_20260420abcd1234',
  status,
  order_type: 'balance',
  created_at: '2026-04-20T12:00:00Z',
  expires_at: '2099-01-01T12:30:00Z',
  refund_amount: 0,
})

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
  })
}

function mountPanel(props: Partial<PaymentStatusPanelProps>) {
  const onSuccess = vi.fn()
  const utils = render(
    <PaymentStatusPanel
      orderId={42}
      qrCode="https://pay.example.com/qr/42"
      expiresAt="2099-01-01T12:30:00Z"
      paymentType="alipay"
      orderType="balance"
      onSuccess={onSuccess}
      {...props}
    />,
  )
  return { ...utils, onSuccess }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function withMobileAlipayEnv(hiddenGetter: () => boolean) {
  const originalLocation = window.location
  const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden')
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign },
  })
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: hiddenGetter,
  })
  return {
    assign,
    restore() {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
      if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden)
    },
  }
}

describe('PaymentStatusPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pollOrderStatus.mockReset()
    cancelOrder.mockReset()
    verifyOrder.mockReset()
    showError.mockReset()
    toCanvas.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('treats RECHARGING as a successful terminal state', async () => {
    pollOrderStatus.mockResolvedValue(orderFactory('RECHARGING'))

    const { container, onSuccess } = mountPanel({})

    await flushPromises()
    await advance(3000)
    await flushPromises()

    expect(pollOrderStatus).toHaveBeenCalledWith(42)
    expect(container.textContent).toContain('payment.result.success')
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('shows reopen button in QR mode when payUrl is also available', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window)

    const { container } = mountPanel({ payUrl: 'https://pay.example.com/session/42' })

    await flushPromises()
    expect(container.textContent).toContain('payment.qr.openPayWindow')

    fireEvent.click(screen.getByRole('button', { name: 'payment.qr.openPayWindow' }))
    expect(openSpy).toHaveBeenCalledWith(
      'https://pay.example.com/session/42',
      'paymentPopup',
      expect.any(String),
    )

    openSpy.mockRestore()
  })

  it('uses generic QR copy for custom methods that contain built-in names', async () => {
    const { container } = mountPanel({ paymentType: 'card_alipay' })

    await flushPromises()

    expect(container.textContent).toContain('payment.qr.scanToPay')
    expect(container.textContent).not.toContain('payment.qr.scanAlipay')
  })

  it('actively verifies a stuck pending order and settles it when upstream confirms payment', async () => {
    pollOrderStatus.mockResolvedValue(orderFactory('PENDING'))
    verifyOrder.mockResolvedValue({
      data: orderFactory('COMPLETED'),
    })

    const { container, onSuccess } = mountPanel({ paymentType: 'wxpay' })

    await flushPromises()
    await advance(3000)
    await flushPromises()

    expect(pollOrderStatus).toHaveBeenCalledWith(42)
    expect(verifyOrder).toHaveBeenCalledWith('sub2_20260420abcd1234')
    expect(container.textContent).toContain('payment.result.success')
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('actively verifies a pending mobile Alipay precreate order', async () => {
    const env = withMobileAlipayEnv(() => false)
    pollOrderStatus.mockResolvedValue(orderFactory('PENDING'))
    verifyOrder.mockResolvedValue({ data: orderFactory('COMPLETED') })

    const { onSuccess, unmount } = mountPanel({
      amount: 88,
      payAmount: 88,
      qrCode: 'https://qr.alipay.com/dynamic-order-42',
      outTradeNo: 'sub2_20260420abcd1234',
      mobileAlipayDeepLink: true,
    })

    await flushPromises()
    await advance(3000)
    await flushPromises()

    expect(verifyOrder).toHaveBeenCalledWith('sub2_20260420abcd1234')
    expect(onSuccess).toHaveBeenCalledTimes(1)

    unmount()
    env.restore()
  })

  it('actively verifies a pending desktop Alipay order', async () => {
    pollOrderStatus.mockResolvedValue(orderFactory('PENDING'))
    verifyOrder.mockResolvedValue({ data: orderFactory('COMPLETED') })

    const { onSuccess, unmount } = mountPanel({
      amount: 88,
      payAmount: 88,
      qrCode: 'https://qr.alipay.com/desktop-order-42',
      outTradeNo: 'sub2_20260420abcd1234',
    })

    await flushPromises()
    await advance(3000)
    await flushPromises()

    expect(verifyOrder).toHaveBeenCalledWith('sub2_20260420abcd1234')
    expect(onSuccess).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('keeps the QR fallback hidden until the Alipay app launch times out', async () => {
    const env = withMobileAlipayEnv(() => false)

    const { container, unmount } = mountPanel({
      amount: 88,
      payAmount: 88,
      qrCode: 'https://qr.alipay.com/dynamic-order-42',
      outTradeNo: 'sub2_20260420abcd1234',
      mobileAlipayDeepLink: true,
    })

    await flushPromises()
    expect(env.assign).toHaveBeenCalledWith(expect.stringContaining('alipays://platformapi/startapp?saId=10000007&qrcode='))
    expect(container.querySelector('[data-test="alipay-qr-fallback"]')).toBeNull()

    await advance(2200)
    await flushPromises()

    expect(container.querySelector('[data-test="alipay-qr-fallback"]')).not.toBeNull()
    expect(container.textContent).toContain('payment.qr.saveQRCode')
    expect(container.textContent).toContain('sub2_20260420abcd1234')
    expect(toCanvas).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 'https://qr.alipay.com/dynamic-order-42', expect.any(Object))

    unmount()
    env.restore()
  })

  it('does not show the QR fallback after the page enters the background', async () => {
    let hidden = false
    const env = withMobileAlipayEnv(() => hidden)

    const { container, unmount } = mountPanel({
      amount: 88,
      payAmount: 88,
      qrCode: 'https://qr.alipay.com/dynamic-order-42',
      outTradeNo: 'sub2_20260420abcd1234',
      mobileAlipayDeepLink: true,
    })

    await flushPromises()
    hidden = true
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(2200)
    await flushPromises()

    expect(container.querySelector('[data-test="alipay-qr-fallback"]')).toBeNull()
    expect(container.textContent).toContain('payment.qr.alipayContinueInApp')

    unmount()
    env.restore()
  })
})
