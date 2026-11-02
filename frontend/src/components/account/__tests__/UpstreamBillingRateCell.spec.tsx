import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '@/types'
import UpstreamBillingRateCell, { type UpstreamBillingRateCellProps } from '../UpstreamBillingRateCell'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
    te: () => true,
    locale: 'en'
  })
}))

const makeAccount = (overrides: Partial<Account> = {}): Account => ({
  id: 1,
  name: 'upstream',
  platform: 'openai',
  type: 'apikey',
  proxy_id: null,
  concurrency: 1,
  priority: 1,
  status: 'active',
  error_message: null,
  last_used_at: null,
  expires_at: null,
  auto_pause_on_expired: false,
  created_at: '2026-07-13T00:00:00Z',
  updated_at: '2026-07-13T00:00:00Z',
  schedulable: true,
  rate_limited_at: null,
  rate_limit_reset_at: null,
  overload_until: null,
  temp_unschedulable_until: null,
  temp_unschedulable_reason: null,
  session_window_start: null,
  session_window_end: null,
  session_window_status: null,
  ...overrides
})

const billingData = {
  object: 'sub2api.key_billing' as const,
  schema_version: 1 as const,
  billing_scope: 'token' as const,
  group_rate_multiplier: 0.8,
  resolved_rate_multiplier: 0.6,
  peak_rate_enabled: true,
  peak_start: '09:00',
  peak_end: '18:00',
  peak_rate_multiplier: 1.5,
  applied_peak_multiplier: 1.5,
  effective_rate_multiplier: 0.9,
  timezone: 'Asia/Shanghai',
  observed_at: '2026-07-13T00:00:00Z'
}

/** 渲染并返回可像 Vue 的 setProps 一样合并更新属性的句柄 */
function mount(initial: UpstreamBillingRateCellProps) {
  let props = initial
  const view = render(<UpstreamBillingRateCell {...props} />)
  return {
    ...view,
    text: () => view.container.textContent ?? '',
    setProps(next: Partial<UpstreamBillingRateCellProps>) {
      props = { ...props, ...next }
      view.rerender(<UpstreamBillingRateCell {...props} />)
    }
  }
}

const rateText = () => screen.getByTestId('upstream-billing-rate').textContent

/** 悬停详情触发区，返回挂在 body 上的提示框 */
async function openTooltip() {
  fireEvent.mouseEnter(screen.getByTestId('upstream-billing-rate'))
  await act(async () => {})
  const tooltips = document.body.querySelectorAll('[role="tooltip"]')
  return tooltips[tooltips.length - 1] as HTMLElement
}

describe('UpstreamBillingRateCell', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T00:30:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('recomputes the current effective rate and keeps the icon-only probe action', () => {
    const wrapper = mount({
      account: makeAccount({
        extra: {
          upstream_billing_probe_enabled: true,
          upstream_billing_probe: {
            status: 'ok',
            data: billingData,
            received_at: '2026-07-13T00:00:00Z',
            fresh_until: '2026-07-14T00:00:00Z',
            last_attempt_at: '2026-07-13T00:00:00Z',
            next_probe_at: '2026-07-13T00:30:00Z'
          }
        }
      }),
      now: Date.now()
    })

    expect(wrapper.text()).toContain('0.60x')
    wrapper.setProps({ now: Date.parse('2026-07-13T01:00:00Z') })
    expect(wrapper.text()).toContain('0.90x')
    wrapper.setProps({ now: Date.parse('2026-07-13T10:00:00Z') })
    expect(wrapper.text()).toContain('0.60x')
    expect(wrapper.text()).not.toContain('admin.accounts.upstreamBilling.latest')
    expect(screen.getByTestId('upstream-billing-probe').textContent).toBe('')
    expect(screen.getByTestId('upstream-billing-probe')).toHaveAttribute(
      'aria-label',
      'admin.accounts.upstreamBilling.manualProbe'
    )
  })

  it('uses retained failed data only while it is still fresh', () => {
    const account = makeAccount({
      extra: {
        upstream_billing_probe: {
          status: 'ok',
          data: billingData,
          received_at: '2026-07-12T22:00:00Z',
          fresh_until: '2026-07-12T23:00:00Z',
          last_attempt_at: '2026-07-12T22:00:00Z',
          next_probe_at: '2026-07-12T22:30:00Z'
        }
      }
    })
    const wrapper = mount({ account, now: Date.now() })
    expect(wrapper.text()).toContain('admin.accounts.upstreamBilling.stale')
    expect(rateText()).toBe('admin.accounts.upstreamBilling.stale')

    wrapper.setProps({
      account: makeAccount({
        extra: {
          upstream_billing_probe: {
            status: 'failed',
            data: billingData,
            received_at: '2026-07-13T00:00:00Z',
            fresh_until: '2026-07-13T01:00:00Z',
            last_attempt_at: '2026-07-13T00:00:00Z',
            next_probe_at: '2026-07-13T01:00:00Z',
            last_error: 'http_error'
          }
        }
      })
    })
    expect(wrapper.text()).toContain('0.60x')
    expect(wrapper.text()).toContain('admin.accounts.upstreamBilling.failed')

    wrapper.setProps({ now: Date.parse('2026-07-13T01:00:00Z') })
    expect(wrapper.text()).toContain('0.90x')
    expect(wrapper.text()).not.toContain('admin.accounts.upstreamBilling.stale')

    wrapper.setProps({ now: Date.parse('2026-07-13T01:00:00.001Z') })
    expect(rateText()).toBe('admin.accounts.upstreamBilling.stale')
    expect(wrapper.text()).toContain('admin.accounts.upstreamBilling.stale')

    wrapper.setProps({
      now: Date.now(),
      account: makeAccount({
        extra: {
          upstream_billing_probe: {
            status: 'failed',
            data: billingData,
            received_at: '2026-07-12T22:00:00Z',
            fresh_until: '2026-07-12T23:00:00Z',
            last_attempt_at: '2026-07-13T00:00:00Z',
            next_probe_at: '2026-07-13T01:00:00Z',
            last_error: 'http_error'
          }
        }
      })
    })
    expect(rateText()).toBe('admin.accounts.upstreamBilling.stale')
    expect(wrapper.text()).toContain('admin.accounts.upstreamBilling.stale')
  })

  it('shows stale snapshot details, local next probe time, and the account probe state', async () => {
    const wrapper = mount({
      account: makeAccount({
        extra: {
          upstream_billing_probe_enabled: true,
          upstream_billing_probe: {
            status: 'ok',
            data: billingData,
            received_at: '2026-07-12T22:00:00Z',
            fresh_until: '2026-07-12T23:00:00Z',
            last_attempt_at: '2026-07-12T22:00:00Z',
            next_probe_at: '2026-07-13T01:00:00Z'
          }
        }
      }),
      now: Date.now()
    })

    const tooltip = await openTooltip()
    // Vue 版断言 HelpTooltip 的 widthClass 为 w-max，React 版传入 CSS 宽度 max-content
    expect(tooltip.style.width).toBe('max-content')
    expect(tooltip.textContent).toContain('admin.accounts.upstreamBilling.lastDetectedRate:0.9')
    expect(tooltip.textContent).toContain('admin.accounts.upstreamBilling.lastDetectedAt:')
    expect(tooltip.textContent).toContain('admin.accounts.upstreamBilling.elapsedSince:admin.accounts.upstreamBilling.hoursAgo:2')
    expect(tooltip.textContent).toContain('admin.accounts.upstreamBilling.nextProbeAt:')
    expect(tooltip.textContent).not.toContain('admin.accounts.upstreamBilling.stale')
    // Vue 版断言 text-emerald-400 / text-red-400 颜色类，React 版断言 data-state
    expect(tooltip.querySelector('[data-testid="upstream-billing-probe-state"] span')).toHaveAttribute('data-state', 'enabled')

    wrapper.setProps({
      account: makeAccount({
        extra: {
          upstream_billing_probe_enabled: false,
          upstream_billing_probe: {
            status: 'unsupported',
            last_attempt_at: '2026-07-13T00:00:00Z',
            next_probe_at: '2026-07-13T01:00:00Z'
          }
        }
      })
    })
    expect(tooltip.querySelector('[data-testid="upstream-billing-next-probe"]')).toBeNull()
    expect(tooltip.querySelector('[data-testid="upstream-billing-probe-state"] span')).toHaveAttribute('data-state', 'disabled')
    wrapper.unmount()
  })

  it('stacks the global-off state below the account state and hides it when globally enabled', async () => {
    const wrapper = mount({
      account: makeAccount({
        extra: {
          upstream_billing_probe_enabled: true,
          upstream_billing_probe: {
            status: 'unsupported',
            last_attempt_at: '2026-07-13T00:00:00Z',
            next_probe_at: '2026-07-13T01:00:00Z'
          }
        }
      }),
      globalProbeEnabled: false,
      now: Date.now()
    })

    const tooltip = await openTooltip()
    const accountState = tooltip.querySelector('[data-testid="upstream-billing-probe-state"]')
    const globalState = tooltip.querySelector('[data-testid="upstream-billing-global-probe-state"]')
    expect(accountState?.querySelector('span')).toHaveAttribute('data-state', 'enabled')
    expect(globalState?.textContent).toContain('admin.accounts.upstreamBilling.globalProbeState')
    expect(globalState?.querySelector('span')).toHaveAttribute('data-state', 'disabled')
    expect(tooltip.querySelector('[data-testid="upstream-billing-next-probe"]')).toBeNull()

    wrapper.setProps({ globalProbeEnabled: true })
    expect(tooltip.querySelector('[data-testid="upstream-billing-global-probe-state"]')).toBeNull()
    expect(tooltip.querySelector('[data-testid="upstream-billing-next-probe"]')).not.toBeNull()

    wrapper.setProps({
      globalProbeEnabled: false,
      account: makeAccount({
        extra: { upstream_billing_probe_enabled: false }
      })
    })
    expect(accountState?.querySelector('span')).toHaveAttribute('data-state', 'disabled')
    expect(tooltip.querySelector('[data-testid="upstream-billing-global-probe-state"]')).not.toBeNull()
    expect(tooltip.querySelector('[data-testid="upstream-billing-next-probe"]')).toBeNull()
    wrapper.unmount()
  })

  it('emits manual probe commands only for eligible accounts', () => {
    const onProbe = vi.fn()
    const wrapper = mount({ account: makeAccount(), now: Date.now(), onProbe })
    fireEvent.click(screen.getByTestId('upstream-billing-probe'))
    expect(onProbe).toHaveBeenCalledTimes(1)

    // 探测已放宽到全部 API-key 平台：grok API-key 账号同样可探测。
    wrapper.setProps({ account: makeAccount({ platform: 'grok' }) })
    fireEvent.click(screen.getByTestId('upstream-billing-probe'))
    expect(onProbe).toHaveBeenCalledTimes(2)

    wrapper.setProps({ account: makeAccount({ type: 'oauth' }) })
    expect(wrapper.container.querySelectorAll('button')).toHaveLength(0)
    expect(wrapper.text()).toBe('-')
  })

  it('fails neutral for malformed data and timestamps', () => {
    const malformedAccount = (
      dataOverrides: Partial<typeof billingData> = {},
      snapshotOverrides: Record<string, unknown> = {}
    ) => makeAccount({
      extra: {
        upstream_billing_probe: {
          status: 'ok',
          data: { ...billingData, ...dataOverrides },
          received_at: '2026-07-13T00:00:00Z',
          fresh_until: '2026-07-13T01:00:00Z',
          last_attempt_at: '2026-07-13T00:00:00Z',
          next_probe_at: '2026-07-13T01:00:00Z',
          ...snapshotOverrides
        }
      }
    })
    const wrapper = mount({
      account: malformedAccount({
        resolved_rate_multiplier: -1,
        peak_rate_enabled: false,
        effective_rate_multiplier: -1
      }),
      now: Date.now()
    })

    expect(rateText()).toBe('-')
    wrapper.setProps({ account: malformedAccount({ billing_scope: 'request' as 'token' }) })
    expect(rateText()).toBe('-')
    wrapper.setProps({ account: malformedAccount({}, { received_at: 'not-a-time' }) })
    expect(rateText()).toBe('admin.accounts.upstreamBilling.stale')
    wrapper.setProps({ account: malformedAccount({}, { received_at: '2026-07-13T00:31:00Z' }) })
    expect(rateText()).toBe('0.60x')
    wrapper.setProps({ account: malformedAccount({}, { received_at: '2026-07-13T00:36:00Z' }) })
    expect(rateText()).toBe('admin.accounts.upstreamBilling.stale')
    wrapper.setProps({ account: malformedAccount({}, { fresh_until: '2026-07-12T23:59:00Z' }) })
    expect(rateText()).toBe('admin.accounts.upstreamBilling.stale')

    wrapper.setProps({
      account: makeAccount({
        extra: {
          upstream_billing_probe: {
            status: 'failed',
            last_attempt_at: '2026-07-13T00:00:00Z',
            next_probe_at: '2026-07-13T01:00:00Z',
            last_error: 'network_error'
          }
        }
      })
    })
    expect(rateText()).toBe('admin.accounts.upstreamBilling.failed')
    expect(wrapper.text()).toContain('admin.accounts.upstreamBilling.failed')
    expect(wrapper.text()).not.toContain('admin.accounts.upstreamBilling.stale')
  })

  it('uses unsupported as the primary tooltip trigger without a dash', () => {
    const wrapper = mount({
      account: makeAccount({
        extra: {
          upstream_billing_probe: {
            status: 'unsupported',
            last_attempt_at: '2026-07-13T00:00:00Z',
            next_probe_at: '2026-07-13T00:30:00Z',
            last_error: 'unsupported'
          }
        }
      }),
      now: Date.now()
    })

    expect(rateText()).toBe('admin.accounts.upstreamBilling.unsupported')
    expect(wrapper.text()).not.toContain('-admin.accounts.upstreamBilling.unsupported')
  })
})
