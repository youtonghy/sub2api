import { fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AdminPaymentConfig } from '@/api/admin/payment'
import type { AdminGroup } from '@/types'
import PlanEditDialog from '../PlanEditDialog'

const i18n = vi.hoisted(() => ({
  t: (key: string, params?: Record<string, unknown>) => {
    if (key === 'payment.admin.subscriptionCnyPayPreview') return `preview ${params?.amount}`
    if (key === 'payment.admin.subscriptionCnyPayPreviewWithFee') return `fee ${params?.feeRate} ${params?.total}`
    return key
  },
  te: () => true,
  locale: 'en'
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) }
}))

vi.mock('@/api/admin/payment', () => ({
  adminPaymentAPI: {
    createPlan: vi.fn(),
    updatePlan: vi.fn()
  }
}))

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

// Vue 版 Select 桩：原生 select，选项来自 options
vi.mock('@/components/common/Select', () => ({
  default: ({
    value,
    options,
    placeholder,
    onChange
  }: {
    value: unknown
    options: Array<{ value: string | number; label: string; platform?: string }>
    placeholder?: string
    onChange?: (value: number | null) => void
  }) => (
    <select
      value={value == null ? '' : String(value)}
      onChange={(event) => onChange?.(event.target.value === '' ? null : Number(event.target.value))}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value} data-platform={option.platform}>
          {option.label}
        </option>
      ))}
    </select>
  )
}))
vi.mock('@/components/common/GroupBadge', () => ({ default: () => null }))

const groupFixture = (overrides: Partial<AdminGroup>): AdminGroup => ({
  id: 1,
  name: 'OpenAI',
  description: null,
  platform: 'openai',
  rate_multiplier: 1,
  rpm_limit: 0,
  is_exclusive: false,
  status: 'active',
  subscription_type: 'subscription',
  daily_limit_usd: null,
  weekly_limit_usd: null,
  monthly_limit_usd: null,
  allow_image_generation: false,
  image_rate_independent: false,
  image_rate_multiplier: 1,
  image_price_1k: null,
  image_price_2k: null,
  image_price_4k: null,
  peak_rate_enabled: false,
  peak_start: '',
  peak_end: '',
  peak_rate_multiplier: 1,
  claude_code_only: false,
  fallback_group_id: null,
  fallback_group_id_on_invalid_request: null,
  allow_messages_dispatch: false,
  require_oauth_only: false,
  require_privacy_set: false,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  model_routing: null,
  model_routing_enabled: false,
  mcp_xml_inject: false,
  sort_order: 0,
  ...overrides
} as AdminGroup)

function mountDialog({
  groups = [],
  paymentConfig = null
}: {
  groups?: AdminGroup[]
  paymentConfig?: Partial<AdminPaymentConfig> | null
} = {}) {
  return render(
    <PlanEditDialog show plan={null} groups={groups} paymentConfig={paymentConfig as AdminPaymentConfig | null} />
  )
}

const numberInput = () => document.querySelector<HTMLInputElement>('input[type="number"]')!

describe('PlanEditDialog', () => {
  it('shows CNY channel charge using the configured subscription rate and fee', () => {
    const { container } = mountDialog({
      paymentConfig: {
        subscription_usd_to_cny_rate: 7.15,
        recharge_fee_rate: 2.5
      }
    })

    fireEvent.change(numberInput(), { target: { value: '9.99' } })

    expect(container.textContent).toContain('preview')
    expect(container.textContent).toContain('¥71.43')
    expect(container.textContent).toContain('fee 2.5')
    expect(container.textContent).toContain('¥73.22')
  })

  it('hides the preview when the subscription rate is not configured', () => {
    const { container } = mountDialog({
      paymentConfig: {
        subscription_usd_to_cny_rate: 0,
        recharge_fee_rate: 2.5
      }
    })

    fireEvent.change(numberInput(), { target: { value: '9.99' } })

    expect(container.textContent).not.toContain('preview')
    expect(container.textContent).not.toContain('¥71.43')
  })

  it('allows composite subscription groups for payment plans', () => {
    const { container } = mountDialog({
      groups: [
        groupFixture({
          id: 10,
          name: 'OpenAI + Claude + Gemini + Grok',
          platform: 'composite' as AdminGroup['platform'],
          rate_multiplier: 1.2,
          subscription_type: 'subscription'
        }),
        groupFixture({
          id: 11,
          name: 'Standard OpenAI',
          platform: 'openai',
          subscription_type: 'standard'
        })
      ]
    })

    const options = Array.from(container.querySelectorAll('option')).map((option) => option.textContent)

    // 全平台分组：下拉不再展示平台维度，只保留名称与倍率。
    expect(options).toContain('OpenAI + Claude + Gemini + Grok (1.2x)')
    expect(options).not.toContain('Standard OpenAI (1x)')
  })
})
