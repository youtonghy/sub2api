import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Account } from '@/types'
import AccountFailureHeatmap from '../AccountFailureHeatmap'

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

const cellsOf = (container: HTMLElement) => Array.from(container.querySelectorAll('button[aria-label]'))

describe('AccountFailureHeatmap', () => {
  it('renders 24 chronological cells with blank, green, and red states', () => {
    const { container } = render(
      <AccountFailureHeatmap
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

    const cells = cellsOf(container)
    expect(cells).toHaveLength(24)
    // Vue 版断言 Tailwind 颜色类（绿 / 红 / 透明），React 版断言失败率分级 data-level
    expect(cells[0]).toHaveAttribute('data-level', 'low')
    expect(cells[1]).toHaveAttribute('data-level', 'critical')
    expect(cells[2]).toHaveAttribute('data-level', 'empty')
    expect(cells[1].getAttribute('title')).toContain('01:00-01:59')
    expect(cells[1].getAttribute('title')).toContain('100.00%')
    expect(cells[23].getAttribute('title')).toContain('23:00-23:59')
    expect(container.textContent).toContain('admin.accounts.failureHeatmap.todayRate 16.67%')
  })

  it('only renders accounts that have calls for the displayed day', () => {
    const { container } = render(
      <AccountFailureHeatmap
        accounts={[account, idleAccount]}
        byAccount={{
          '7': [{ account_id: 7, hour: 12, request_count: 1, failure_count: 0, failure_rate: 0 }],
          '8': [{ account_id: 8, hour: 12, request_count: 0, failure_count: 0, failure_rate: 0 }]
        }}
      />
    )

    expect(container.textContent).toContain('Primary OpenAI')
    expect(container.textContent).not.toContain('Idle OpenAI')
    expect(cellsOf(container)).toHaveLength(24)
  })

  it('shows the empty state when none of the accounts have calls', () => {
    const { container } = render(<AccountFailureHeatmap accounts={[idleAccount]} byAccount={{}} />)

    expect(container.textContent).not.toContain('Idle OpenAI')
    expect(container.textContent).toContain('common.noData')
    expect(cellsOf(container)).toHaveLength(0)
  })
})
