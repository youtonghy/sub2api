import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AirwallexPaymentView from '../AirwallexPaymentView'
import {
  PAYMENT_RECOVERY_STORAGE_KEY,
  type PaymentRecoverySnapshot,
} from '@/components/payment/paymentFlow'

const routeState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
}))
const routerPush = vi.hoisted(() => vi.fn())
const airwallexInit = vi.hoisted(() => vi.fn())
const redirectToCheckout = vi.hoisted(() => vi.fn())

vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams(routeState.query)],
  useNavigate: () => routerPush,
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'zh-CN' }),
}))

vi.mock('@airwallex/components-sdk', () => ({
  init: airwallexInit,
}))

function airwallexSnapshot(overrides: Partial<PaymentRecoverySnapshot> = {}): PaymentRecoverySnapshot {
  return {
    orderId: 101,
    amount: 88,
    qrCode: '',
    expiresAt: '2099-01-01T00:10:00.000Z',
    paymentType: 'airwallex',
    payUrl: '/payment/airwallex?order_id=101&out_trade_no=sub2_awx_101&resume_token=resume-awx',
    outTradeNo: 'sub2_awx_101',
    clientSecret: 'awx_client_secret',
    intentId: 'int_awx_101',
    currency: 'CNY',
    countryCode: 'CN',
    paymentEnv: 'demo',
    payAmount: 88,
    orderType: 'balance',
    paymentMode: '',
    resumeToken: 'resume-awx',
    createdAt: Date.UTC(2099, 0, 1, 0, 0, 0),
    ...overrides,
  }
}

async function flushPromises() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe('AirwallexPaymentView', () => {
  beforeEach(() => {
    routeState.query = {}
    routerPush.mockReset()
    airwallexInit.mockReset().mockResolvedValue({
      payments: {
        redirectToCheckout,
      },
    })
    redirectToCheckout.mockReset()
    window.localStorage.clear()
  })

  it('从本地恢复快照读取支付参数，避免在 URL 中暴露 client_secret', async () => {
    routeState.query = {
      order_id: '101',
      out_trade_no: 'sub2_awx_101',
      resume_token: 'resume-awx',
    }
    window.localStorage.setItem(
      PAYMENT_RECOVERY_STORAGE_KEY,
      JSON.stringify(airwallexSnapshot()),
    )

    render(<AirwallexPaymentView />)
    await flushPromises()

    expect(airwallexInit).toHaveBeenCalledWith({
      env: 'demo',
      enabledElements: ['payments'],
      locale: 'zh',
    })
    expect(redirectToCheckout).toHaveBeenCalledWith(expect.objectContaining({
      intent_id: 'int_awx_101',
      client_secret: 'awx_client_secret',
      currency: 'CNY',
      country_code: 'CN',
    }))

    const checkoutOptions = redirectToCheckout.mock.calls[0][0]
    const successUrl = new URL(checkoutOptions.successUrl)
    expect(successUrl.searchParams.get('order_id')).toBe('101')
    expect(successUrl.searchParams.get('out_trade_no')).toBe('sub2_awx_101')
    expect(successUrl.searchParams.get('resume_token')).toBe('resume-awx')
  })

  it('拒绝只从 URL query 读取 Airwallex 支付密钥', async () => {
    routeState.query = {
      order_id: '101',
      intent_id: 'int_from_query',
      client_secret: 'secret_from_query',
    }

    const { container } = render(<AirwallexPaymentView />)
    await flushPromises()

    expect(airwallexInit).not.toHaveBeenCalled()
    expect(container.textContent).toContain('payment.airwallexMissingParams')
  })
})
