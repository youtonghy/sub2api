import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AccountFailureHeatmap from '../AccountFailureHeatmap.vue'
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

describe('AccountFailureHeatmap', () => {
  it('renders 24 chronological cells with blank, green, and red states', () => {
    const wrapper = mount(AccountFailureHeatmap, {
      props: {
        accounts: [account],
        byAccount: {
          '7': [
            { account_id: 7, hour: 0, request_count: 20, failure_count: 0, failure_rate: 0 },
            { account_id: 7, hour: 1, request_count: 4, failure_count: 4, failure_rate: 1 }
          ]
        },
        date: '2026-08-07',
        timezone: 'Australia/Melbourne'
      }
    })

    const cells = wrapper.findAll('button[aria-label]')
    expect(cells).toHaveLength(24)
    expect(cells[0].classes()).toContain('bg-emerald-100')
    expect(cells[1].classes()).toContain('bg-red-500')
    expect(cells[2].classes()).toContain('bg-transparent')
    expect(cells[1].attributes('title')).toContain('01:00-01:59')
    expect(cells[1].attributes('title')).toContain('100.00%')
    expect(cells[23].attributes('title')).toContain('23:00-23:59')
    expect(wrapper.text()).toContain('admin.accounts.failureHeatmap.todayRate 16.67%')
  })
})
