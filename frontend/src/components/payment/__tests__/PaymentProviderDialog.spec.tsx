import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import PaymentProviderDialog, {
  type PaymentProviderDialogHandle,
  type PaymentProviderSavePayload
} from '@/components/payment/PaymentProviderDialog'
import { STRIPE_SDK_API_VERSION } from '@/components/payment/providerConfig'
import type { ProviderInstance } from '@/types/payment'

const messages: Record<string, string> = {
  'admin.settings.payment.providerConfig': 'Credentials',
  'admin.settings.payment.easypayCustomMethods': 'Custom EasyPay methods',
  'admin.settings.payment.easypayCustomMethodsHint': 'Add provider-specific EasyPay type values.',
  'admin.settings.payment.addCustomMethod': 'Add method',
  'admin.settings.payment.customMethodType': 'Payment type',
  'admin.settings.payment.customMethodUpstreamType': 'Upstream type',
  'admin.settings.payment.customMethodDisplayName': 'Display name',
  'admin.settings.payment.customMethodDisplayNamePlaceholder': '信用卡',
  'admin.settings.payment.paymentGuideTrigger': 'View payment guide',
  'admin.settings.payment.alipayGuideSummary': 'Desktop prefers QR precreate and falls back to cashier; mobile prefers WAP checkout.',
  'admin.settings.payment.wxpayGuideSummary': 'Desktop prefers Native QR; mobile routes to JSAPI or H5 based on browser context.',
  'admin.settings.payment.airwallexGuideSummary': 'Use Payment Acceptance read/write only.',
  'admin.settings.payment.stripeWebhookHint': 'Configure Stripe webhook.',
  'admin.settings.payment.stripeWebhookApiVersionHint': 'Use Stripe API version {version}.',
  'admin.settings.payment.airwallexWebhookHint': 'Select payment_intent.succeeded and use the latest stable API version.'
}

const i18n = vi.hoisted(() => ({
  t: (key: string, params?: unknown) => {
    // 调用发生在渲染时，此时 messages 已初始化
    const message = messages[key] ?? key
    if (!params || typeof params !== 'object') return message
    return Object.entries(params as Record<string, string>).reduce(
      (value, [name, replacement]) => value.replaceAll(`{${name}}`, replacement),
      message
    )
  },
  te: () => true,
  locale: 'en'
}))

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

const showError = vi.hoisted(() => vi.fn())
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError }) } }))

// Vue 版 BaseDialog 桩：show 时直接渲染内容与 footer
vi.mock('@/components/account/AccountFormLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/account/AccountFormLayout')>()
  return {
    ...actual,
    AccountFormDrawer: ({ show, children, footer }: { show: boolean; children: ReactNode; footer?: ReactNode }) =>
      show ? (
        <div>
          {children}
          {footer}
        </div>
      ) : null
  }
})

// Vue 版 Select / ToggleSwitch 桩：不渲染内容
vi.mock('@/components/common/Select', () => ({ default: () => <div /> }))
vi.mock('@/components/payment/ToggleSwitch', () => ({ default: () => <div /> }))

function providerFactory(overrides: Partial<ProviderInstance> = {}): ProviderInstance {
  return {
    id: 1,
    provider_key: 'airwallex',
    name: 'Airwallex',
    config: {},
    supported_types: ['airwallex'],
    enabled: true,
    payment_mode: '',
    refund_enabled: false,
    allow_user_refund: false,
    limits: '',
    sort_order: 0,
    ...overrides
  }
}

function mountDialog(options: { editing?: ProviderInstance | null } = {}) {
  const ref = createRef<PaymentProviderDialogHandle>()
  const onSave = vi.fn<(payload: PaymentProviderSavePayload) => void>()
  const view = render(
    <PaymentProviderDialog
      ref={ref}
      show
      saving={false}
      editing={options.editing ?? null}
      allKeyOptions={[
        { value: 'easypay', label: 'EasyPay' },
        { value: 'alipay', label: 'Alipay' },
        { value: 'wxpay', label: 'WeChat Pay' },
        { value: 'stripe', label: 'Stripe' },
        { value: 'airwallex', label: 'Airwallex' }
      ]}
      enabledKeyOptions={[
        { value: 'easypay', label: 'EasyPay' },
        { value: 'alipay', label: 'Alipay' },
        { value: 'wxpay', label: 'WeChat Pay' },
        { value: 'airwallex', label: 'Airwallex' }
      ]}
      allPaymentTypes={[
        { value: 'alipay', label: 'Alipay' },
        { value: 'wxpay', label: 'WeChat Pay' }
      ]}
      redirectLabel="Redirect"
      onSave={onSave}
    />
  )
  return { ...view, ref, onSave }
}

const bodyText = () => document.body.textContent ?? ''
const submit = () => fireEvent.submit(document.querySelector('form')!)
const guideButton = () => document.querySelector('button[title="View payment guide"]')

function textInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]'))
}

async function fillCustomMethod(type: string, upstreamType: string, displayName: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add method' }))
  const customTypeInputs = textInputs().filter((input) => input.placeholder === 'credit_card')
  const displayNameInput = textInputs().find((input) => input.placeholder === '信用卡')
  if (customTypeInputs.length < 2 || !displayNameInput) throw new Error('custom method inputs not found')
  fireEvent.change(customTypeInputs[0], { target: { value: type } })
  fireEvent.change(customTypeInputs[1], { target: { value: upstreamType } })
  fireEvent.change(displayNameInput, { target: { value: displayName } })
}

describe('PaymentProviderDialog callback URLs', () => {
  it.each([
    ['https://notify.example.com/', 'https://return.example.com///', 'https://notify.example.com', 'https://return.example.com'],
    [' https://notify.example.com/sub/ ', ' https://return.example.com/site/ ', 'https://notify.example.com/sub', 'https://return.example.com/site'],
    ['https://notify.example.com', 'https://return.example.com', 'https://notify.example.com', 'https://return.example.com'],
    ['', '', window.location.origin, window.location.origin]
  ])('joins callback paths to %s and %s', (notify, returnUrl, expectedNotify, expectedReturn) => {
    const provider = providerFactory({
      provider_key: 'easypay',
      name: 'EasyPay',
      config: { pid: 'pid-1', apiBase: 'https://pay.example.com' },
      supported_types: ['alipay'],
      payment_mode: 'qrcode'
    })
    const { ref, onSave, unmount } = mountDialog({ editing: provider })
    act(() => ref.current!.loadProvider(provider))
    // Vue 版按 !rounded-r-none 类找基础 URL 输入框，React 版按 data-callback-base
    const bases = document.querySelectorAll<HTMLInputElement>('input[data-callback-base]')
    fireEvent.change(bases[0], { target: { value: notify } })
    fireEvent.change(bases[1], { target: { value: returnUrl } })
    submit()
    const payload = onSave.mock.calls[0]?.[0]
    expect(payload?.config.notifyUrl).toBe(expectedNotify + '/api/v1/payment/webhook/easypay')
    expect(payload?.config.returnUrl).toBe(expectedReturn + '/payment/result')
    unmount()
  })
})

describe('PaymentProviderDialog payment guide', () => {
  it('shows no payment guide for providers without a flow guide', () => {
    mountDialog()

    expect(bodyText()).not.toContain(messages['admin.settings.payment.alipayGuideSummary'])
    expect(bodyText()).not.toContain(messages['admin.settings.payment.wxpayGuideSummary'])
    expect(guideButton()).toBeNull()
  })

  it.each([
    ['alipay', 'admin.settings.payment.alipayGuideSummary'],
    ['wxpay', 'admin.settings.payment.wxpayGuideSummary'],
    ['airwallex', 'admin.settings.payment.airwallexGuideSummary']
  ])('shows the payment guide summary for %s', (providerKey, summaryKey) => {
    const { ref } = mountDialog()

    act(() => ref.current!.reset(providerKey))

    expect(bodyText()).toContain(messages[summaryKey])
    expect(guideButton()).not.toBeNull()
  })

  it('shows Airwallex webhook event and API version guidance with the webhook URL', () => {
    const { ref } = mountDialog()

    act(() => ref.current!.reset('airwallex'))

    expect(bodyText()).toContain(messages['admin.settings.payment.airwallexWebhookHint'])
    expect(bodyText()).toContain('/api/v1/payment/webhook/airwallex')
  })

  it('shows Stripe webhook API version guidance with the integrated SDK version', () => {
    const { ref } = mountDialog()

    act(() => ref.current!.reset('stripe'))

    expect(bodyText()).toContain(messages['admin.settings.payment.stripeWebhookHint'])
    expect(bodyText()).toContain(`Use Stripe API version ${STRIPE_SDK_API_VERSION}.`)
    expect(bodyText()).toContain('/api/v1/payment/webhook/stripe')
  })

  it('emits an empty Airwallex accountId when the admin clears it', () => {
    const provider = providerFactory({
      config: {
        clientId: 'cid_123',
        apiBase: 'https://api.airwallex.com/api/v1',
        countryCode: 'CN',
        currency: 'CNY',
        accountId: 'acct_123'
      }
    })
    const { ref, onSave } = mountDialog({ editing: provider })

    act(() => ref.current!.loadProvider(provider))

    const accountIdInput = textInputs().find((input) => input.value === 'acct_123')
    if (!accountIdInput) throw new Error('accountId input not found')

    fireEvent.change(accountIdInput, { target: { value: '' } })
    submit()

    expect(onSave.mock.calls[0]?.[0].config.accountId).toBe('')
  })

  it.each(['epay', 'usdt.trc20'])(
    'serializes EasyPay upstream type %s and adds the local type to supported_types',
    async (upstreamType) => {
      const provider = providerFactory({
        provider_key: 'easypay',
        name: 'EasyPay',
        config: {
          pid: 'pid-1',
          apiBase: 'https://pay.example.com',
          notifyUrl: 'https://example.com/api/v1/payment/webhook/easypay',
          returnUrl: 'https://example.com/payment/result'
        },
        supported_types: ['alipay', 'wxpay'],
        payment_mode: 'qrcode'
      })
      const { ref, onSave } = mountDialog({ editing: provider })

      act(() => ref.current!.loadProvider(provider))

      await fillCustomMethod('ldc', upstreamType, 'LDC')
      submit()

      const payload = onSave.mock.calls[0]?.[0]
      expect(JSON.parse(payload!.config.customMethods)).toEqual([{ type: 'ldc', upstreamType, displayName: 'LDC' }])
      expect(payload!.supported_types).toEqual(['alipay', 'wxpay', 'ldc'])
    }
  )

  it.each([
    ['alipay_hk', 'hkpay'],
    ['usdt.trc20', 'usdt.trc20'],
    ['usdt_trc20', 'usdt/trc20']
  ])('rejects invalid EasyPay mapping %s to %s', async (type, upstreamType) => {
    const provider = providerFactory({
      provider_key: 'easypay',
      name: 'EasyPay',
      config: {
        pid: 'pid-1',
        apiBase: 'https://pay.example.com',
        notifyUrl: 'https://example.com/api/v1/payment/webhook/easypay',
        returnUrl: 'https://example.com/payment/result'
      },
      supported_types: ['alipay', 'wxpay'],
      payment_mode: 'qrcode'
    })
    const { ref, onSave } = mountDialog({ editing: provider })

    act(() => ref.current!.loadProvider(provider))

    await fillCustomMethod(type, upstreamType, 'Custom payment')
    submit()

    expect(onSave).not.toHaveBeenCalled()
  })
})
