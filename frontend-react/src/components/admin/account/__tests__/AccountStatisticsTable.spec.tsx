import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Account, WindowStats } from '@/types'
import AccountStatisticsTable from '../AccountStatisticsTable'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

const account = {
  id: 7,
  name: 'Primary OpenAI',
  platform: 'openai',
  type: 'apikey',
  status: 'active',
  schedulable: true,
  concurrency: 1,
  priority: 0,
  created_at: '2026-08-24T00:00:00Z',
  updated_at: '2026-08-24T00:00:00Z',
  extra: {
    upstream_billing_probe: {
      status: 'ok',
      data: {
        object: 'sub2api.key_billing',
        schema_version: 1,
        billing_scope: 'token',
        group_rate_multiplier: 1.5,
        resolved_rate_multiplier: 1.5,
        effective_rate_multiplier: 2,
        peak_rate_enabled: false,
        observed_at: '2026-08-24T00:00:00Z'
      },
      last_attempt_at: '2026-08-24T00:00:00Z',
      next_probe_at: '2026-08-25T00:00:00Z'
    }
  }
} as unknown as Account

afterEach(() => cleanup())

describe('AccountStatisticsTable', () => {
  it('renders per-account daily usage, costs, rates, and TTFT', () => {
    const { container } = render(
      <AccountStatisticsTable
        accounts={[account]}
        statsByAccount={{
          '7': {
            requests: 8,
            tokens: 2400,
            input_tokens: 600,
            cache_read_tokens: 400,
            standard_cost: 1.25,
            cost: 0.75,
            user_cost: 2,
            average_first_token_ms: 1250
          }
        }}
        failuresByAccount={{
          '7': [{ account_id: 7, hour: 0, request_count: 10, failure_count: 2, failure_rate: 0.2 }]
        }}
      />
    )

    const row = container.querySelector('[data-statistics-account-id="7"]')!
    expect(row).not.toBeNull()
    expect(row.textContent).toContain('Primary OpenAI')
    expect(row.textContent).toContain('2,400')
    expect(row.textContent).toContain('$1.25')
    expect(row.textContent).toContain('$2.50')
    expect(row.textContent).toContain('40.0%')
    expect(row.textContent).toContain('80.0%')
    expect(row.textContent).toContain('1.25s')
  })

  it('does not show accounts that have not produced consumption', () => {
    const { container } = render(
      <AccountStatisticsTable
        accounts={[account]}
        statsByAccount={{ '7': { requests: 0, tokens: 0, cost: 0 } as WindowStats }}
        failuresByAccount={{}}
      />
    )

    expect(container.querySelector('[data-statistics-account-id="7"]')).toBeNull()
    expect(container.textContent).toContain('admin.accounts.statistics.noConsumption')
  })
})
