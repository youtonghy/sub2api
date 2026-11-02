import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account, OllamaCloudUsageState } from '@/types'
import OllamaCloudUsageCell from '../OllamaCloudUsageCell'
import shared from '../usageCells.module.css'

const { refreshOllamaCloudUsage, barProps } = vi.hoisted(() => ({
  refreshOllamaCloudUsage: vi.fn(),
  // 记录每次渲染的 UsageProgressBar props（Vue 版 findAllComponents(UsageProgressBar).props()）
  barProps: [] as Array<Record<string, any>>
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      refreshOllamaCloudUsage
    }
  }
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
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

/** 最近一次渲染中的进度条（每次渲染按顺序记录，取最后 count 个） */
const lastBars = (count: number) => barProps.slice(-count)

const usageState = (): OllamaCloudUsageState => ({
  account_id: 7,
  eligible: true,
  configured: true,
  auto_refresh_enabled: false,
  encryption_key_configured: true,
  snapshot: {
    status: 'ok',
    fetched_at: '2026-07-22T12:00:00Z',
    last_attempt_at: '2026-07-22T12:00:00Z',
    next_refresh_at: '2026-07-22T13:00:00Z',
    data: {
      plan: 'max',
      five_hour: { used_percent: 5.6, reset_at: '2026-07-23T03:00:00Z' },
      seven_day: { used_percent: 14.2, reset_at: '2026-07-29T00:00:00Z' },
      balance: '$0',
      models: [
        { model: 'gpt-oss:120b-cloud', window: 'five_hour', requests: 2 },
        { model: 'gpt-oss:120b-cloud', window: 'seven_day', requests: 12 }
      ]
    }
  }
})

const account = (state = usageState()): Account =>
  ({
    id: 7,
    name: 'ollama',
    platform: 'openai',
    type: 'apikey',
    ollama_cloud_usage: state,
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

describe('OllamaCloudUsageCell', () => {
  beforeEach(() => {
    refreshOllamaCloudUsage.mockReset()
    barProps.length = 0
  })

  afterEach(() => cleanup())

  it('renders native 5h and 7d windows with the configured-account query action', () => {
    const { container } = render(<OllamaCloudUsageCell account={account()} />)
    const cell = container.querySelector('[data-testid="ollama-cloud-usage-cell"]')!
    // Vue 版断言 min-w-0 / max-w-full（且没有 min-w-[12rem]）；这里断言可收缩的共享 stack 类
    expect(cell.classList.contains(shared.stack)).toBe(true)
    expect(cell.getAttribute('style')).toBeNull()

    const bars = lastBars(2)
    expect(bars).toHaveLength(2)
    expect(bars[0]).toMatchObject({ label: '5h', utilization: 5.6, resetsAt: '2026-07-23T03:00:00Z' })
    expect(bars[1]).toMatchObject({ label: '7d', utilization: 14.2, resetsAt: '2026-07-29T00:00:00Z' })

    expect(container.querySelector('[data-testid="ollama-cloud-usage-details"]')).toBeNull()
    const query = container.querySelector('[data-testid="ollama-cloud-usage-query"]')!
    // Vue 版断言蓝色文字按钮（text-blue-600 / hover:bg-blue-50）；这里为强调色的共享操作按钮
    expect(query.classList.contains(shared.action)).toBe(true)
    expect(query.hasAttribute('data-tone')).toBe(false)
    expect(query.textContent).toContain('admin.accounts.usageWindow.activeQuery')
    expect(container.textContent).not.toContain('max')
    expect(container.textContent).not.toContain('$0')
    expect(container.textContent).not.toContain('gpt-oss:120b-cloud')
  })

  it('reacts to an account snapshot update', () => {
    const { rerender } = render(<OllamaCloudUsageCell account={account()} />)
    const next = usageState()
    next.snapshot!.data!.five_hour!.used_percent = 43

    rerender(<OllamaCloudUsageCell account={account(next)} />)

    expect(lastBars(2)[0].utilization).toBe(43)
  })

  it('queries through the edit-page refresh endpoint and emits the updated state', async () => {
    const next = usageState()
    next.snapshot!.data!.five_hour!.used_percent = 43
    refreshOllamaCloudUsage.mockResolvedValueOnce(next)
    const onUpdated = vi.fn()
    const { container } = render(<OllamaCloudUsageCell account={account()} onUpdated={onUpdated} />)

    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="ollama-cloud-usage-query"]')!)
    })
    await act(async () => {})

    expect(refreshOllamaCloudUsage).toHaveBeenCalledWith(7)
    expect(lastBars(2)[0].utilization).toBe(43)
    expect(onUpdated.mock.calls[0]?.[0]).toEqual(next)
  })

  it('hides the query action until a browser session is configured', () => {
    const state = usageState()
    state.configured = false

    const { container } = render(<OllamaCloudUsageCell account={account(state)} />)

    expect(container.querySelector('[data-testid="ollama-cloud-usage-query"]')).toBeNull()
  })
})
