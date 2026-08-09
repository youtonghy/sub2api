import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import OpsProviderRealtimeMonitor from '../OpsProviderRealtimeMonitor.vue'

const mockGetConcurrencyStats = vi.fn()
const mockGetAccountAvailabilityStats = vi.fn()

vi.mock('@/api/admin/ops', () => ({
  opsAPI: {
    getConcurrencyStats: (...args: unknown[]) => mockGetConcurrencyStats(...args),
    getAccountAvailabilityStats: (...args: unknown[]) => mockGetAccountAvailabilityStats(...args)
  }
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => params?.count ? `${key}:${params.count}` : key,
      locale: ref('en')
    })
  }
})

function concurrencyResponse() {
  return {
    enabled: true,
    platform: {},
    group: {},
    account: {
      '1': { account_id: 1, account_name: 'Serving', platform: 'openai', group_id: 2, group_name: 'Primary', current_in_use: 2, max_capacity: 10, load_percentage: 20, waiting_in_queue: 0 },
      '2': { account_id: 2, account_name: 'Cooling', platform: 'openai', group_id: 2, group_name: 'Primary', current_in_use: 0, max_capacity: 10, load_percentage: 0, waiting_in_queue: 0 },
      '3': { account_id: 3, account_name: 'Hot', platform: 'openai', group_id: 2, group_name: 'Primary', current_in_use: 9, max_capacity: 10, load_percentage: 92, waiting_in_queue: 1 },
      '4': { account_id: 4, account_name: 'Broken', platform: 'openai', group_id: 2, group_name: 'Primary', current_in_use: 0, max_capacity: 10, load_percentage: 0, waiting_in_queue: 0 }
    }
  }
}

function availabilityResponse() {
  return {
    enabled: true,
    platform: {},
    group: {},
    account: {
      '1': { account_id: 1, account_name: 'Serving', platform: 'openai', group_id: 2, group_name: 'Primary', status: 'active', is_available: true, is_rate_limited: false, is_overloaded: false, has_error: false },
      '2': { account_id: 2, account_name: 'Cooling', platform: 'openai', group_id: 2, group_name: 'Primary', status: 'active', is_available: false, is_rate_limited: false, is_overloaded: false, has_error: false, cooldown_remaining_sec: 45, temp_unschedulable_reason: 'strict_priority_fallback: upstream_status=503' },
      '3': { account_id: 3, account_name: 'Hot', platform: 'openai', group_id: 2, group_name: 'Primary', status: 'active', is_available: true, is_rate_limited: false, is_overloaded: false, has_error: false },
      '4': { account_id: 4, account_name: 'Broken', platform: 'openai', group_id: 2, group_name: 'Primary', status: 'error', is_available: false, is_rate_limited: false, is_overloaded: false, has_error: true, error_message: 'Selected model is at capacity' }
    }
  }
}

describe('OpsProviderRealtimeMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConcurrencyStats.mockResolvedValue(concurrencyResponse())
    mockGetAccountAvailabilityStats.mockResolvedValue(availabilityResponse())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders active, saturated, cooling, and failing providers with live load', async () => {
    const wrapper = mount(OpsProviderRealtimeMonitor)
    await flushPromises()

    expect(wrapper.get('[data-provider-id="1"]').attributes('data-provider-state')).toBe('active')
    expect(wrapper.get('[data-provider-id="2"]').attributes('data-provider-state')).toBe('cooling')
    expect(wrapper.get('[data-provider-id="2"]').text()).toContain('45s')
    expect(wrapper.get('[data-provider-id="3"]').attributes('data-provider-state')).toBe('saturated')
    expect(wrapper.get('[data-provider-id="3"]').text()).toContain('92%')
    expect(wrapper.get('[data-provider-id="4"]').attributes('data-provider-state')).toBe('error')
    expect(wrapper.get('[data-provider-id="4"]').text()).toContain('Selected model is at capacity')

    wrapper.unmount()
  })

  it('passes the dashboard platform and group filters to realtime endpoints', async () => {
    const wrapper = mount(OpsProviderRealtimeMonitor, {
      props: { platformFilter: 'openai', groupIdFilter: 2 }
    })
    await flushPromises()

    expect(mockGetConcurrencyStats).toHaveBeenCalledWith('openai', 2)
    expect(mockGetAccountAvailabilityStats).toHaveBeenCalledWith('openai', 2)

    wrapper.unmount()
  })
})
