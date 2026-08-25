import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AccountStatisticsTable from '../AccountStatisticsTable.vue'
import type { Account } from '@/types'

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key })
  }
})

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
} as Account

describe('AccountStatisticsTable', () => {
  it('renders per-account daily usage, costs, rates, and TTFT', () => {
    const wrapper = mount(AccountStatisticsTable, {
      props: {
        accounts: [account],
        statsByAccount: {
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
        },
        failuresByAccount: {
          '7': [
            { account_id: 7, hour: 0, request_count: 10, failure_count: 2, failure_rate: 0.2 }
          ]
        }
      }
    })

    const row = wrapper.get('[data-statistics-account-id="7"]')
    expect(row.text()).toContain('Primary OpenAI')
    expect(row.text()).toContain('2,400')
    expect(row.text()).toContain('$1.25')
    expect(row.text()).toContain('$2.50')
    expect(row.text()).toContain('40.0%')
    expect(row.text()).toContain('80.0%')
    expect(row.text()).toContain('1.25s')
  })

  it('shows unknown rates and latency as a dash when the account has no calls', () => {
    const wrapper = mount(AccountStatisticsTable, {
      props: {
        accounts: [account],
        statsByAccount: {
          '7': { requests: 0, tokens: 0, cost: 0 }
        },
        failuresByAccount: {}
      }
    })

    expect(wrapper.get('[data-statistics-account-id="7"]').text()).toContain('-')
  })
})
