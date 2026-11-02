import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account, OpenCodeGoUsageState } from '@/types'
import OpenCodeGoUsageCell from '../OpenCodeGoUsageCell'
import shared from '../usageCells.module.css'

const { refreshOpenCodeGoUsage, barProps } = vi.hoisted(() => ({
  refreshOpenCodeGoUsage: vi.fn(),
  // 记录每次渲染的 UsageProgressBar props（Vue 版 findAllComponents(UsageProgressBar).props()）
  barProps: [] as Array<Record<string, any>>
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      refreshOpenCodeGoUsage
    }
  }
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const short: Record<string, string> = {
        'admin.accounts.opencodeGo.rollingShort': '5h',
        'admin.accounts.opencodeGo.weeklyShort': '7d',
        'admin.accounts.opencodeGo.monthlyShort': '1m',
        'admin.accounts.opencodeGo.unauthorized': 'unauthorized',
        'admin.accounts.opencodeGo.failed': 'failed',
        'admin.accounts.opencodeGo.ok': 'ok'
      }
      return short[key] ?? key
    },
    te: () => true,
    locale: 'en'
  })
}))

vi.mock('../UsageProgressBar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../UsageProgressBar')>()
  const Real = actual.default
  return {
    ...actual,
    default: (props: any) => {
      barProps.push(props)
      return <Real {...props} />
    }
  }
})

const lastBars = (count: number) => barProps.slice(-count)

const usageState = (overrides: Partial<OpenCodeGoUsageState> = {}): OpenCodeGoUsageState => ({
  account_id: 7,
  eligible: true,
  auto_refresh_enabled: false,
  snapshot: {
    status: 'ok',
    fetched_at: '2026-07-22T12:00:00Z',
    last_attempt_at: '2026-07-22T12:00:00Z',
    next_refresh_at: '2026-07-22T13:00:00Z',
    data: {
      rolling: { percent: 5.6, resets_at: '2026-07-23T03:00:00Z' },
      weekly: { percent: 14.2, resets_at: '2026-07-29T00:00:00Z' },
      monthly: { percent: 33.3, resets_at: '2026-08-01T00:00:00Z' }
    }
  },
  ...overrides
})

const account = (state = usageState()): Account =>
  ({
    id: 7,
    name: 'opencode',
    platform: 'openai',
    type: 'apikey',
    opencode_go_usage: state,
    proxy_id: null,
    concurrency: 1,
    priority: 1,
    status: 'active',
    error_message: null,
    last_used_at: null,
    expires_at: null,
    auto_pause_on_expired: false,
    created_at: '2026-07-22T00:00:00Z',
    updated_at: '2026-07-22T00:00:00Z',
    schedulable: true,
    rate_limited_at: null,
    rate_limit_reset_at: null,
    overload_until: null,
    temp_unschedulable_until: null,
    temp_unschedulable_reason: null,
    session_window_start: null,
    session_window_end: null,
    session_window_status: null
  }) as Account

describe('OpenCodeGoUsageCell', () => {
  beforeEach(() => {
    refreshOpenCodeGoUsage.mockReset()
    barProps.length = 0
  })

  afterEach(() => cleanup())

  it('renders rolling, weekly and monthly windows in a shrinkable mobile-safe cell', () => {
    const { container } = render(<OpenCodeGoUsageCell account={account()} />)
    const cell = container.querySelector('[data-testid="opencode-go-usage-cell"]')!
    // Vue 版断言 min-w-0 / max-w-full（且没有 min-w-[12rem]）；这里断言可收缩的共享 stack 类
    expect(cell.classList.contains(shared.stack)).toBe(true)
    expect(cell.getAttribute('style')).toBeNull()

    const bars = lastBars(3)
    expect(bars).toHaveLength(3)
    expect(bars[0]).toMatchObject({ label: '5h', utilization: 5.6, resetsAt: '2026-07-23T03:00:00Z', color: 'indigo' })
    expect(bars[1]).toMatchObject({ label: '7d', utilization: 14.2, resetsAt: '2026-07-29T00:00:00Z', color: 'emerald' })
    expect(bars[2]).toMatchObject({ label: '1m', utilization: 33.3, resetsAt: '2026-08-01T00:00:00Z', color: 'amber' })

    expect(container.querySelector('[data-testid="opencode-go-status-badge"]')).toBeNull()
    const query = container.querySelector('[data-testid="opencode-go-usage-query"]')!
    expect(query.textContent).toContain('admin.accounts.usageWindow.activeQuery')
  })

  it('refreshes usage on demand and emits the new state', async () => {
    const next = usageState()
    next.snapshot!.data!.rolling!.percent = 42
    refreshOpenCodeGoUsage.mockResolvedValueOnce(next)
    const onUpdated = vi.fn()
    const { container } = render(<OpenCodeGoUsageCell account={account()} onUpdated={onUpdated} />)

    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="opencode-go-usage-query"]')!)
    })
    await act(async () => {})

    expect(refreshOpenCodeGoUsage).toHaveBeenCalledWith(7)
    expect(lastBars(3)[0].utilization).toBe(42)
    expect(onUpdated.mock.calls[0]?.[0]).toEqual(next)
  })

  it('shows a status badge when the snapshot status is not ok', () => {
    const { container } = render(
      <OpenCodeGoUsageCell
        account={account(
          usageState({ snapshot: { status: 'unauthorized', last_attempt_at: '2026-07-22T12:00:00Z', next_refresh_at: '2026-07-22T13:00:00Z' } })
        )}
      />
    )
    const badge = container.querySelector('[data-testid="opencode-go-status-badge"]')!
    expect(badge.textContent).toBe('unauthorized')
    // Vue 版断言 bg-amber-100 / text-amber-700；这里为警告色调
    expect(badge.getAttribute('data-tone')).toBe('warning')
  })

  it('shows a red badge for failed snapshots', () => {
    const { container } = render(
      <OpenCodeGoUsageCell
        account={account(
          usageState({
            snapshot: { status: 'failed', last_attempt_at: '2026-07-22T12:00:00Z', next_refresh_at: '2026-07-22T13:00:00Z', last_error: 'http_error' }
          })
        )}
      />
    )
    const badge = container.querySelector('[data-testid="opencode-go-status-badge"]')!
    expect(badge.textContent).toBe('failed')
    // Vue 版断言 bg-red-100 / text-red-700；这里为危险色调
    expect(badge.getAttribute('data-tone')).toBe('danger')
  })

  it('renders a dash when the account is not eligible or has no state', () => {
    const { container } = render(<OpenCodeGoUsageCell account={account(usageState({ eligible: false }))} />)
    expect(container.querySelector('[data-testid="opencode-go-usage-cell"]')).toBeNull()
    expect(container.textContent).toBe('-')
  })

  it('reacts to an account snapshot update', () => {
    const { rerender } = render(<OpenCodeGoUsageCell account={account()} />)
    const next = usageState()
    next.snapshot!.data!.rolling!.percent = 43

    rerender(<OpenCodeGoUsageCell account={account(next)} />)

    expect(lastBars(3)[0].utilization).toBe(43)
  })
})
