import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PaymentView from '../PaymentView'
import { PAYMENT_RECOVERY_STORAGE_KEY } from '@/components/payment/paymentFlow'
import { formatPaymentAmount } from '@/components/payment/currency'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh'
import type { CheckoutInfoResponse, MethodLimit, SubscriptionPlan } from '@/types/payment'

const routeState = vi.hoisted(() => ({
  path: '/purchase',
  query: {} as Record<string, string>,
}))

// Vue 版的 router.push / router.replace 在 React 里都是 navigate(to, options)
const navigate = vi.hoisted(() => vi.fn())
const createOrder = vi.hoisted(() => vi.fn())
const refreshUser = vi.hoisted(() => vi.fn())
const fetchActiveSubscriptions = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const showError = vi.hoisted(() => vi.fn())
const showInfo = vi.hoisted(() => vi.fn())
const showWarning = vi.hoisted(() => vi.fn())
const getCheckoutInfo = vi.hoisted(() => vi.fn())
const bridgeInvoke = vi.hoisted(() => vi.fn())
const translate = vi.hoisted(() => vi.fn((key: string) => key))
const amountInput = vi.hoisted(() => ({ onChange: null as null | ((value: number | null) => void) }))

vi.mock('react-router', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: routeState.path }),
  useSearchParams: () => [new URLSearchParams(routeState.query)],
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: translate, te: () => true, locale: 'en' }),
}))

vi.mock('@/stores/auth', () => {
  const state = { user: { username: 'demo-user', balance: 0 }, refreshUser }
  return { useAuthStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }) }
})

vi.mock('@/stores/payment', () => ({
  usePaymentStore: { getState: () => ({ createOrder }) },
}))

vi.mock('@/stores/subscriptions', () => {
  const state = { activeSubscriptions: [], fetchActiveSubscriptions }
  return { useSubscriptionStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }) }
})

// 公开设置放在真实的 zustand store 里，测试可在挂载后切换功能开关，触发页面重新渲染
vi.mock('@/stores/app', async () => {
  const { create } = await import('zustand')
  const useAppStore = create(() => ({
    cachedPublicSettings: undefined as Record<string, unknown> | undefined,
    showError,
    showInfo,
    showWarning,
  }))
  return { useAppStore }
})

vi.mock('@/api/payment', () => ({
  paymentAPI: {
    getCheckoutInfo,
  },
}))

vi.mock('@/utils/device', () => ({
  isMobileDevice: () => true,
}))

// Vue 版使用 shallowMount：子组件全部替换为桩
vi.mock('@/components/payment/AmountInput', () => ({
  default: (props: { onChange?: (value: number | null) => void }) => {
    amountInput.onChange = props.onChange ?? null
    return <div data-testid="amount-input" />
  },
}))
vi.mock('@/components/payment/SubscriptionPlanCard', () => ({
  default: ({ plan }: { plan: SubscriptionPlan }) => <div data-testid="plan-card">{plan.id}</div>,
}))
vi.mock('@/components/payment/PaymentStatusPanel', () => ({
  default: ({ onDone }: { onDone?: () => void }) => (
    <button type="button" data-testid="payment-status-panel" data-test="payment-done" onClick={() => onDone?.()} />
  ),
}))
vi.mock('@/components/payment/PaymentMethodSelector', () => ({
  default: ({ selected }: { selected: string }) => <div data-test="method-selector">{selected}</div>,
}))

type SetAppState = (state: { cachedPublicSettings: Record<string, unknown> | undefined }) => void

async function setPublicSettings(value: Record<string, unknown> | undefined) {
  const { useAppStore } = await import('@/stores/app')
  act(() => {
    (useAppStore as unknown as { setState: SetAppState }).setState({ cachedPublicSettings: value })
  })
}

function checkoutInfoFixture(overrides: Partial<CheckoutInfoResponse> = {}) {
  const wxpayMethod: MethodLimit = {
    daily_limit: 0,
    daily_used: 0,
    daily_remaining: 0,
    single_min: 0,
    single_max: 0,
    fee_rate: 0,
    available: true,
  }
  const data: CheckoutInfoResponse = {
    methods: {
      wxpay: wxpayMethod,
    },
    global_min: 0,
    global_max: 0,
    plans: [],
    balance_disabled: false,
    balance_recharge_multiplier: 1,
    subscription_usd_to_cny_rate: 0,
    recharge_fee_rate: 0,
    help_text: '',
    help_image_url: '',
    stripe_publishable_key: '',
  }

  return {
    data: { ...data, ...overrides },
  }
}

function checkoutInfoWithPlansFixture(options: {
  checkout?: Partial<CheckoutInfoResponse>
  method?: Partial<MethodLimit>
  plan?: Partial<SubscriptionPlan>
} = {}) {
  const base = checkoutInfoFixture(options.checkout).data
  const plan: SubscriptionPlan = {
    id: 7,
    group_id: 3,
    name: 'Starter',
    description: '',
    price: 128,
    original_price: 0,
    validity_days: 30,
    validity_unit: 'day',
    rate_multiplier: 1,
    daily_limit_usd: null,
    weekly_limit_usd: null,
    monthly_limit_usd: null,
    features: [],
    group_platform: 'openai',
    sort_order: 1,
    for_sale: true,
    group_name: 'OpenAI',
    ...options.plan,
  } as SubscriptionPlan

  return {
    data: {
      ...base,
      methods: {
        ...base.methods,
        wxpay: {
          ...base.methods.wxpay,
          ...options.method,
        },
      },
      plans: [plan],
    },
  }
}

function jsapiOrderFixture(resumeToken: string) {
  return {
    order_id: 123,
    amount: 88,
    pay_amount: 88,
    fee_rate: 0,
    expires_at: '2099-01-01T00:10:00.000Z',
    payment_type: 'wxpay',
    out_trade_no: 'sub2_jsapi_123',
    result_type: 'jsapi_ready' as const,
    resume_token: resumeToken,
    jsapi: {
      appId: 'wx123',
      timeStamp: '1712345678',
      nonceStr: 'nonce',
      package: 'prepay_id=wx123',
      signType: 'RSA',
      paySign: 'signed',
    },
  }
}

function oauthOrderFixture() {
  return {
    order_id: 456,
    amount: 128,
    pay_amount: 128,
    fee_rate: 0,
    expires_at: '2099-01-01T00:10:00.000Z',
    payment_type: 'wxpay',
    result_type: 'oauth_required' as const,
    oauth: {
      authorize_url: '/api/v1/auth/oauth/wechat/payment/start?payment_type=wxpay&redirect=%2Fpurchase%3Ffrom%3Dwechat',
      appid: 'wx123',
      scope: 'snsapi_base',
      redirect_url: '/auth/wechat/payment/callback',
    },
  }
}

async function flushPromises() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function resetMocks() {
  navigate.mockReset().mockResolvedValue(undefined)
  createOrder.mockReset()
  refreshUser.mockReset()
  fetchActiveSubscriptions.mockReset().mockResolvedValue(undefined)
  showError.mockReset()
  showInfo.mockReset()
  showWarning.mockReset()
  bridgeInvoke.mockReset()
  window.localStorage.clear()
  ;(window as Window & { WeixinJSBridge?: { invoke: typeof bridgeInvoke } }).WeixinJSBridge = undefined
}

async function mountView() {
  const utils = render(<PaymentView />)
  await flushPromises()
  return utils
}

async function mountSubscriptionConfirm(options: Parameters<typeof checkoutInfoWithPlansFixture>[0] = {}) {
  vi.useRealTimers()
  routeState.path = '/purchase'
  routeState.query = {
    tab: 'subscription',
    group: '3',
  }
  resetMocks()
  getCheckoutInfo.mockReset().mockResolvedValue(checkoutInfoWithPlansFixture(options))
  return mountView()
}

async function mountSubscriptionPlanList(planCount: number) {
  vi.useRealTimers()
  routeState.path = '/purchase'
  routeState.query = { tab: 'subscription' }
  resetMocks()
  const basePlan = checkoutInfoWithPlansFixture().data.plans[0]
  const plans = Array.from({ length: planCount }, (_, index) => ({
    ...basePlan,
    id: index + 1,
    name: `Plan ${index + 1}`,
  }))
  getCheckoutInfo.mockReset().mockResolvedValue(checkoutInfoFixture({ plans }))
  return mountView()
}

afterEach(() => {
  cleanup()
})

describe('PaymentView help text', () => {
  beforeEach(() => {
    vi.useRealTimers()
    routeState.path = '/purchase'
    routeState.query = {}
    createOrder.mockReset()
    window.localStorage.clear()
  })

  async function mountHelp(help_text: string, help_image_url = '') {
    getCheckoutInfo.mockReset().mockResolvedValue(checkoutInfoFixture({ help_text, help_image_url }))
    return mountView()
  }

  it('renders headings, emphasis, links, and lists in payment help without starting checkout', async () => {
    const { container } = await mountHelp('## Recharge help\n\n**Read first**\n\n- [Contact support](https://example.com/help)')
    const help = container.querySelector('.markdown-body')!
    expect(help.querySelector('h2')!.textContent).toBe('Recharge help')
    expect(help.querySelector('strong')!.textContent).toBe('Read first')
    expect(help.querySelector('li a')!.getAttribute('href')).toBe('https://example.com/help')
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('removes scripts, event handlers, and unsafe URLs from rendered help', async () => {
    const { container } = await mountHelp([
      '<script>alert(1)</script>',
      '<img src="https://example.com/help.png" onerror="alert(1)">',
      '[Unsafe](javascript:alert%281%29)',
      '[Support](https://example.com/help)',
    ].join('\n\n'))
    const help = container.querySelector('.markdown-body')!
    expect(help.querySelector('script')).toBeNull()
    expect(help.querySelector('img')!.getAttribute('onerror')).toBeNull()
    expect(Array.from(help.querySelectorAll('a')).map(link => link.getAttribute('href') ?? undefined)).toEqual([undefined, 'https://example.com/help'])
  })

  it('keeps plain-text soft line breaks and the separate help image preview', async () => {
    const { container } = await mountHelp('First line\nSecond line', 'https://example.com/help.png')
    const help = container.querySelector('.markdown-body')!
    expect(help.querySelector('p')!.textContent).toBe('First line\nSecond line')
    expect(help.querySelector('br')).toBeNull()
    fireEvent.click(container.querySelector('img')!)
    const images = document.body.querySelectorAll('img')
    expect(images).toHaveLength(2)
    expect(images[1].getAttribute('src')).toBe('https://example.com/help.png')
  })

  it('keeps image-only help without an empty Markdown container', async () => {
    const { container } = await mountHelp('', 'https://example.com/help.png')
    expect(container.querySelector('.markdown-body')).toBeNull()
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://example.com/help.png')
  })
})

describe('PaymentView subscription plan grid', () => {
  // Vue 版断言 Tailwind 栅格类（grid-cols-1 / sm:grid-cols-2 / lg:grid-cols-3）；React 版改为 CSS Module，
  // 3 列断点由 data-columns="3" 选择器控制。
  it.each([3, 4, 6])('keeps %i plans on the existing mobile/tablet/desktop grid', async (planCount) => {
    await mountSubscriptionPlanList(planCount)
    const cards = screen.getAllByTestId('plan-card')

    expect(cards).toHaveLength(planCount)
    expect(cards[0].parentElement).toHaveAttribute('data-columns', '3')
  })
})

describe('PaymentView recharge rate preview', () => {
  it('uses the selected payment method currency in both locale templates', async () => {
    translate.mockClear()
    routeState.path = '/purchase'
    routeState.query = {}
    getCheckoutInfo.mockReset().mockResolvedValue(checkoutInfoFixture({
      balance_recharge_multiplier: 0.5,
      methods: {
        stripe: {
          ...checkoutInfoFixture().data.methods.wxpay,
          currency: 'USD',
        },
      },
    }))

    await mountView()
    act(() => amountInput.onChange!(10))
    await flushPromises()

    expect(translate).toHaveBeenCalledWith('payment.rechargeRatePreview', {
      currency: 'USD',
      usd: '0.50',
    })
    expect(en.payment.rechargeRatePreview).toBe('Current rate: 1 {currency} = {usd} USD')
    expect(zh.payment.rechargeRatePreview).toBe('当前倍率：1 {currency} = {usd} USD')
  })
})

describe('PaymentView subscription confirmation amounts', () => {
  const buttonTexts = () => screen.getAllByRole('button').map(button => button.textContent ?? '')

  it('shows converted CNY pay amount using the subscription rate, not the balance multiplier', async () => {
    const { container } = await mountSubscriptionConfirm({
      checkout: {
        balance_recharge_multiplier: 0.14,
        subscription_usd_to_cny_rate: 7.15,
      },
      method: {
        currency: 'CNY',
      },
      plan: {
        price: 9.99,
        original_price: 12.99,
      },
    })

    const text = container.textContent ?? ''
    const convertedPrice = formatPaymentAmount(71.43, 'CNY', 'en')
    const convertedOriginalPrice = formatPaymentAmount(92.88, 'CNY', 'en')

    expect(text).toContain(convertedPrice)
    expect(text).toContain(convertedOriginalPrice)
    expect(text).not.toContain(formatPaymentAmount(9.99, 'CNY', 'en'))
    // 换算必须使用订阅汇率（×7.15），而不是余额倍率（÷0.14 = 71.36）
    expect(text).not.toContain(formatPaymentAmount(71.36, 'CNY', 'en'))
    expect(buttonTexts().some(label => label.includes(convertedPrice))).toBe(true)
  })

  it('keeps plan price when the subscription rate is not configured or payment currency is not CNY', async () => {
    // opt-in 回归锁：即使余额倍率已配置，未配置订阅汇率时 CNY 订阅仍按 price 直付
    const cnyWrapper = await mountSubscriptionConfirm({
      checkout: {
        balance_recharge_multiplier: 0.14,
        subscription_usd_to_cny_rate: 0,
      },
      method: {
        currency: 'CNY',
      },
      plan: {
        price: 7.99,
      },
    })

    const cnyText = cnyWrapper.container.textContent ?? ''
    expect(cnyText).toContain(formatPaymentAmount(7.99, 'CNY', 'en'))
    expect(cnyText).not.toContain(formatPaymentAmount(57.07, 'CNY', 'en'))
    expect(cnyText).not.toContain(formatPaymentAmount(57.13, 'CNY', 'en'))
    cnyWrapper.unmount()

    const usdWrapper = await mountSubscriptionConfirm({
      checkout: {
        subscription_usd_to_cny_rate: 7.15,
      },
      method: {
        currency: 'USD',
      },
      plan: {
        price: 7.99,
        original_price: 9.99,
      },
    })

    expect(usdWrapper.container.textContent).toContain(formatPaymentAmount(7.99, 'USD', 'en'))
    expect(usdWrapper.container.textContent).toContain(formatPaymentAmount(9.99, 'USD', 'en'))
  })

  it('adds fee rate after CNY rate conversion to match backend pay_amount', async () => {
    const { container } = await mountSubscriptionConfirm({
      checkout: {
        subscription_usd_to_cny_rate: 7.15,
        recharge_fee_rate: 2.5,
      },
      method: {
        currency: 'CNY',
      },
      plan: {
        price: 9.99,
      },
    })

    const text = container.textContent ?? ''
    const convertedPrice = formatPaymentAmount(71.43, 'CNY', 'en')
    const fee = formatPaymentAmount(1.79, 'CNY', 'en')
    const total = formatPaymentAmount(73.22, 'CNY', 'en')

    expect(text).toContain(convertedPrice)
    expect(text).toContain(fee)
    expect(text).toContain(total)
    expect(buttonTexts().some(label => label.includes(total))).toBe(true)
  })
})

describe('PaymentView payment recovery', () => {
  beforeEach(() => {
    vi.useRealTimers()
    routeState.path = '/purchase'
    routeState.query = {}
    resetMocks()
  })

  it('restores a custom EasyPay method as the selected payment method', async () => {
    getCheckoutInfo.mockResolvedValue(checkoutInfoFixture({
      methods: {
        wxpay: checkoutInfoFixture().data.methods.wxpay,
        ldc: {
          daily_limit: 0,
          daily_used: 0,
          daily_remaining: 0,
          single_min: 0,
          single_max: 0,
          fee_rate: 0,
          available: true,
          display_name: 'LDC Pay',
        },
      },
    }))
    window.localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify({
      orderId: 888,
      amount: 66,
      qrCode: 'ldc-qr',
      expiresAt: '2099-01-01T00:10:00.000Z',
      paymentType: 'ldc',
      payUrl: 'https://pay.example.com/ldc',
      outTradeNo: 'sub2_ldc_888',
      clientSecret: '',
      intentId: '',
      currency: '',
      countryCode: '',
      paymentEnv: '',
      payAmount: 66,
      orderType: 'balance',
      paymentMode: 'popup',
      resumeToken: '',
      createdAt: Date.now(),
    }))

    const { container } = await mountView()
    fireEvent.click(container.querySelector('[data-test="payment-done"]')!)
    await flushPromises()

    expect(container.querySelector('[data-test="method-selector"]')!.textContent).toBe('ldc')
  })
})

describe('PaymentView WeChat JSAPI flow', () => {
  beforeEach(() => {
    vi.useRealTimers()
    routeState.path = '/purchase'
    routeState.query = {
      wechat_resume: '1',
      wechat_resume_token: 'resume-token-123',
    }
    resetMocks()
    getCheckoutInfo.mockReset().mockResolvedValue(checkoutInfoFixture())
    ;(window as Window & { WeixinJSBridge?: { invoke: typeof bridgeInvoke } }).WeixinJSBridge = {
      invoke: bridgeInvoke,
    }
  })

  it('resets payment state and redirects to /payment/result after JSAPI reports success', async () => {
    createOrder.mockResolvedValue(jsapiOrderFixture('resume-token-123'))
    bridgeInvoke.mockImplementation((_action, _payload, callback) => {
      callback({ err_msg: 'get_brand_wcpay_request:ok' })
    })

    await mountView()

    expect(navigate).toHaveBeenCalledWith('/purchase', { replace: true })
    expect(navigate).toHaveBeenCalledWith('/payment/result?order_id=123&out_trade_no=sub2_jsapi_123&resume_token=resume-token-123')
    expect(window.localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull()
  })

  it('resets payment state when JSAPI reports cancellation', async () => {
    createOrder.mockResolvedValue(jsapiOrderFixture('resume-token-cancel'))
    bridgeInvoke.mockImplementation((_action, _payload, callback) => {
      callback({ err_msg: 'get_brand_wcpay_request:cancel' })
    })

    await mountView()

    expect(showInfo).toHaveBeenCalledWith('payment.qr.cancelled')
    expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('/payment/result'))
    expect(window.localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull()
  })

  it('clears stale recovery state when JSAPI never becomes available', async () => {
    vi.useFakeTimers()
    createOrder.mockResolvedValue(jsapiOrderFixture('resume-token-missing-bridge'))
    ;(window as Window & { WeixinJSBridge?: { invoke: typeof bridgeInvoke } }).WeixinJSBridge = undefined

    render(<PaymentView />)

    await flushPromises()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    await flushPromises()

    expect(showError).toHaveBeenCalledWith(
      'payment.errors.wechatJsapiUnavailable payment.errors.wechatOpenInWeChatHint',
    )
    expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('/payment/result'))
    expect(window.localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull()
    expect(screen.queryByTestId('payment-status-panel')).toBeNull()
  })

  it('clears a stale recovery snapshot before handling wechat resume callback params', async () => {
    createOrder.mockRejectedValueOnce(new Error('resume failed'))
    window.localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify({
      orderId: 999,
      amount: 66,
      qrCode: 'stale-qr',
      expiresAt: '2099-01-01T00:10:00.000Z',
      paymentType: 'alipay',
      payUrl: 'https://pay.example.com/stale',
      outTradeNo: 'stale-out-trade-no',
      clientSecret: '',
      intentId: '',
      currency: '',
      countryCode: '',
      paymentEnv: '',
      payAmount: 66,
      orderType: 'balance',
      paymentMode: 'popup',
      resumeToken: '',
      createdAt: Date.UTC(2099, 0, 1, 0, 0, 0),
    }))

    await mountView()

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      wechat_resume_token: 'resume-token-123',
    }))
    expect(window.localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toBeNull()
  })

  it('keeps subscription resume context for token-only WeChat callbacks', async () => {
    routeState.query = {
      wechat_resume: '1',
      wechat_resume_token: 'resume-subscription-7',
      payment_type: 'wxpay_direct',
      order_type: 'subscription',
      plan_id: '7',
    }
    getCheckoutInfo.mockResolvedValue(checkoutInfoWithPlansFixture())
    createOrder.mockResolvedValue(oauthOrderFixture())

    const originalLocation = window.location
    const locationState = {
      href: 'http://localhost/purchase',
      origin: 'http://localhost',
    }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationState,
    })

    await mountView()

    expect(navigate).toHaveBeenCalledWith('/purchase', { replace: true })
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      payment_type: 'wxpay',
      order_type: 'subscription',
      plan_id: 7,
      wechat_resume_token: 'resume-subscription-7',
    }))
    expect(locationState.href).toContain('/api/v1/auth/oauth/wechat/payment/start?')
    expect(new URL(locationState.href, 'http://localhost').searchParams.get('redirect')).toBe(
      '/purchase?from=wechat&payment_type=wxpay&order_type=subscription&plan_id=7',
    )

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  it('falls back to QR flow when mobile WeChat payment is unavailable', async () => {
    routeState.query = {
      wechat_resume: '1',
      wechat_resume_token: 'resume-token-h5',
      payment_type: 'wxpay_direct',
    }
    createOrder
      .mockRejectedValueOnce({ reason: 'WECHAT_H5_NOT_AUTHORIZED' })
      .mockResolvedValueOnce({
        order_id: 778,
        amount: 88,
        pay_amount: 88,
        fee_rate: 0,
        expires_at: '2099-01-01T00:10:00.000Z',
        payment_type: 'wxpay',
        qr_code: 'weixin://wxpay/bizpayurl?pr=fallback-native',
        out_trade_no: 'sub2_qr_778',
      })

    await mountView()

    expect(createOrder).toHaveBeenNthCalledWith(1, expect.objectContaining({
      payment_type: 'wxpay',
      is_mobile: true,
      wechat_resume_token: 'resume-token-h5',
    }))
    expect(createOrder).toHaveBeenNthCalledWith(2, expect.objectContaining({
      payment_type: 'wxpay',
      is_mobile: false,
      payment_source: 'hosted_redirect',
    }))
    expect(showWarning).toHaveBeenCalledWith('payment.errors.mobilePaymentFallbackToQr')
    expect(showError).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY)).toContain('weixin://wxpay/bizpayurl?pr=fallback-native')
  })
})

describe('PaymentView subscription feature flag', () => {
  afterEach(async () => {
    await setPublicSettings(undefined)
  })

  function tabLabels() {
    return screen
      .queryAllByRole('button')
      .map((button) => button.textContent ?? '')
      .filter((text) => text === 'payment.tabTopUp' || text === 'payment.tabSubscribe')
  }

  it('keeps the top-up / subscribe switcher when subscription_enabled is absent (opt-out default)', async () => {
    await mountSubscriptionPlanList(2)

    expect(tabLabels()).toEqual(['payment.tabTopUp', 'payment.tabSubscribe'])
    expect(screen.getAllByTestId('plan-card')).toHaveLength(2)
  })

  it('drops the subscribe tab, hides the switcher and ignores ?tab=subscription when subscriptions are disabled', async () => {
    await setPublicSettings({ subscription_enabled: false })
    const { container } = await mountSubscriptionPlanList(2)

    expect(tabLabels()).toEqual([])
    expect(screen.queryAllByTestId('plan-card')).toHaveLength(0)
    expect(container.textContent).toContain('payment.rechargeAccount')
  })

  it('shows an unavailable notice instead of a doomed top-up form when balance recharge is disabled too', async () => {
    await setPublicSettings({ subscription_enabled: false })
    const { container } = await mountSubscriptionConfirm({ checkout: { balance_disabled: true } })

    expect(tabLabels()).toEqual([])
    expect(screen.queryAllByTestId('plan-card')).toHaveLength(0)
    expect(container.textContent).not.toContain('payment.confirmSubscription')
    expect(container.textContent).not.toContain('payment.rechargeAccount')
    expect(container.textContent).toContain('payment.billingUnavailable')
  })

  it('falls back from the subscribe tab to top-up when the flag flips off after mount', async () => {
    const { container } = await mountSubscriptionPlanList(2)
    expect(screen.getAllByTestId('plan-card')).toHaveLength(2)

    await setPublicSettings({ subscription_enabled: false })
    await flushPromises()

    expect(tabLabels()).toEqual([])
    expect(screen.queryAllByTestId('plan-card')).toHaveLength(0)
    expect(container.textContent).toContain('payment.rechargeAccount')
  })

  it('enters the subscribe tab when a subscription-only site turns subscriptions back on', async () => {
    await setPublicSettings({ subscription_enabled: false })
    const { container } = await mountSubscriptionConfirm({ checkout: { balance_disabled: true } })
    expect(container.textContent).toContain('payment.billingUnavailable')

    await setPublicSettings({ subscription_enabled: true })
    await flushPromises()

    expect(container.textContent).not.toContain('payment.billingUnavailable')
    expect(container.textContent).not.toContain('payment.rechargeAccount')
    expect(screen.queryAllByTestId('plan-card').length).toBeGreaterThan(0)
  })
})
