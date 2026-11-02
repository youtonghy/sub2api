import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

import OpsProviderRealtimeMonitor from '../OpsProviderRealtimeMonitor'

const { mockGetConcurrencyStats, mockGetAccountAvailabilityStats } = vi.hoisted(() => ({
  mockGetConcurrencyStats: vi.fn(),
  mockGetAccountAvailabilityStats: vi.fn()
}))

vi.mock('@/api/admin/ops', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  opsAPI: {
    getConcurrencyStats: (...args: unknown[]) => mockGetConcurrencyStats(...args),
    getAccountAvailabilityStats: (...args: unknown[]) => mockGetAccountAvailabilityStats(...args)
  }
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params?.count ? `${key}:${params.count}` : key),
    te: () => true,
    locale: 'en'
  })
}))

function concurrencyResponse() {
  return {
    enabled: true,
    platform: {},
    group: {},
    account: {
      '1': { account_id: 1, account_name: 'Serving', platform: 'openai', group_id: 2, group_name: 'Primary', current_in_use: 2, max_capacity: 10, load_percentage: 20, waiting_in_queue: 0 },
      '2': { account_id: 2, account_name: 'Cooling', platform: 'openai', group_id: 2, group_name: 'Primary', current_in_use: 0, max_capacity: 10, load_percentage: 0, waiting_in_queue: 0 },
      '3': { account_id: 3, account_name: 'Hot', platform: 'openai', group_id: 2, group_name: 'Primary', current_in_use: 9, max_capacity: 10, load_percentage: 92, waiting_in_queue: 1 },
      '4': { account_id: 4, account_name: 'Broken', platform: 'openai', group_id: 2, group_name: 'Primary', current_in_use: 0, max_capacity: 10, load_percentage: 0, waiting_in_queue: 0 },
      '5': { account_id: 5, account_name: 'Idle', platform: 'openai', group_id: 2, group_name: 'Primary', current_in_use: 0, max_capacity: 10, load_percentage: 0, waiting_in_queue: 0 }
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
      '4': { account_id: 4, account_name: 'Broken', platform: 'openai', group_id: 2, group_name: 'Primary', status: 'error', is_available: false, is_rate_limited: false, is_overloaded: false, has_error: true, error_message: 'Selected model is at capacity' },
      '5': { account_id: 5, account_name: 'Idle', platform: 'openai', group_id: 2, group_name: 'Primary', status: 'active', is_available: true, is_rate_limited: false, is_overloaded: false, has_error: false }
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

  it('only renders providers that are handling calls or have account errors', async () => {
    const { container, unmount } = render(<OpsProviderRealtimeMonitor />)
    const get = (id: number) => container.querySelector(`[data-provider-id="${id}"]`)

    await waitFor(() => expect(get(1)).not.toBeNull())

    expect(get(1)!.getAttribute('data-provider-state')).toBe('active')
    expect(get(2)!.getAttribute('data-provider-state')).toBe('cooling')
    expect(get(2)!.textContent).toContain('45s')
    expect(get(3)!.getAttribute('data-provider-state')).toBe('saturated')
    expect(get(3)!.textContent).toContain('92%')
    expect(get(4)!.getAttribute('data-provider-state')).toBe('error')
    expect(get(4)!.textContent).toContain('Selected model is at capacity')
    expect(get(5)).toBeNull()

    unmount()
  })

  it('passes the dashboard platform and group filters to realtime endpoints', async () => {
    const { unmount } = render(<OpsProviderRealtimeMonitor platformFilter="openai" groupIdFilter={2} />)

    await waitFor(() => expect(mockGetConcurrencyStats).toHaveBeenCalledWith('openai', 2))
    expect(mockGetAccountAvailabilityStats).toHaveBeenCalledWith('openai', 2)

    unmount()
  })
})
