import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Account } from '@/types'
import AccountUptimeStatus from '../AccountUptimeStatus'

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

const account = {
  id: 7,
  name: 'Primary OpenAI',
  platform: 'openai',
  type: 'apikey',
  proxy_id: null,
  concurrency: 1,
  priority: 10,
  status: 'active',
  error_message: null,
  last_used_at: null,
  expires_at: null,
  auto_pause_on_expired: false,
  created_at: '2026-08-07T00:00:00Z',
  updated_at: '2026-08-07T00:00:00Z',
  schedulable: true,
  rate_limited_at: null,
  rate_limit_reset_at: null,
  overload_until: null,
  temp_unschedulable_until: null,
  temp_unschedulable_reason: null,
  session_window_start: null,
  session_window_end: null,
  session_window_status: null
} as Account

const idleAccount = {
  ...account,
  id: 8,
  name: 'Idle OpenAI'
} as Account

const barsOf = (container: HTMLElement) => Array.from(container.querySelectorAll('svg g rect[data-status]:not([data-lit])'))

describe('AccountUptimeStatus', () => {
  it('renders 24 chronological hour bars with idle, operational and outage states', () => {
    const { container, getByRole } = render(
      <AccountUptimeStatus
        accounts={[account]}
        byAccount={{
          '7': [
            { account_id: 7, hour: 0, request_count: 20, failure_count: 0, failure_rate: 0 },
            { account_id: 7, hour: 1, request_count: 4, failure_count: 4, failure_rate: 1 }
          ]
        }}
        date="2026-08-07"
        timezone="Australia/Melbourne"
      />
    )

    const bars = barsOf(container)
    expect(bars).toHaveLength(24)
    expect(bars[0]).toHaveAttribute('data-status', 'operational')
    expect(bars[1]).toHaveAttribute('data-status', 'outage')
    expect(bars[2]).toHaveAttribute('data-status', 'idle')
    // 当日 4/24 = 16.67% 故障率，账号标记为降级，标题提示有异常账号
    expect(container.textContent).toContain('admin.accounts.failureHeatmap.failureRate 16.67%')
    expect(container.textContent).toContain('admin.accounts.failureHeatmap.degraded')
    expect(container.textContent).toContain('admin.accounts.failureHeatmap.affected')
    expect(container.textContent).toContain('2026-08-07 · Australia/Melbourne')

    const strip = getByRole('group')
    fireEvent.keyDown(strip, { key: 'Home' })
    fireEvent.keyDown(strip, { key: 'ArrowRight' })
    expect(container.textContent).toContain('01:00-01:59')
    expect(container.textContent).toContain('100.00%')
    fireEvent.keyDown(strip, { key: 'End' })
    expect(container.textContent).toContain('23:00-23:59')
  })

  it('only renders accounts that have calls for the displayed day', () => {
    const { container } = render(
      <AccountUptimeStatus
        accounts={[account, idleAccount]}
        byAccount={{
          '7': [{ account_id: 7, hour: 12, request_count: 1, failure_count: 0, failure_rate: 0 }],
          '8': [{ account_id: 8, hour: 12, request_count: 0, failure_count: 0, failure_rate: 0 }]
        }}
      />
    )

    expect(container.textContent).toContain('Primary OpenAI')
    expect(container.textContent).not.toContain('Idle OpenAI')
    expect(container.textContent).toContain('admin.accounts.failureHeatmap.allOperational')
    expect(barsOf(container)).toHaveLength(24)
  })

  it('shows the empty state when none of the accounts have calls', () => {
    const { container } = render(<AccountUptimeStatus accounts={[idleAccount]} byAccount={{}} />)

    expect(container.textContent).not.toContain('Idle OpenAI')
    expect(container.textContent).toContain('common.noData')
    expect(barsOf(container)).toHaveLength(0)
  })

  it('shows the load error and a skeleton while loading', () => {
    const { container } = render(<AccountUptimeStatus accounts={[account]} loading error="boom" />)

    expect(container.textContent).toContain('admin.accounts.failureHeatmap.loadFailed')
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(barsOf(container)).toHaveLength(0)
  })
})
