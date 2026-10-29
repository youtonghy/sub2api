import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OllamaCloudUsageSettings from '../OllamaCloudUsageSettings'
import type { Account, OllamaCloudUsageState } from '@/types'

const api = vi.hoisted(() => ({
  getOllamaCloudUsage: vi.fn(),
  saveOllamaCloudUsageSession: vi.fn(),
  deleteOllamaCloudUsageSession: vi.fn(),
  setOllamaCloudUsageAutoRefresh: vi.fn(),
  refreshOllamaCloudUsage: vi.fn()
}))
const notifications = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }))

vi.mock('@/api/admin', () => ({ adminAPI: { accounts: api } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => notifications } }))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'admin.accounts.ollamaCloud.errors.OLLAMA_CLOUD_USAGE_REFRESH_RATE_LIMITED') {
        return `retry in ${params?.retry_after_seconds} seconds`
      }
      if (key === 'admin.accounts.ollamaCloud.fiveHourShort') return '5h'
      if (key === 'admin.accounts.ollamaCloud.sevenDayShort') return '7d'
      return key
    },
    te: () => true,
    locale: 'en'
  })
}))

const flushPromises = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
})

const state = (overrides: Partial<OllamaCloudUsageState> = {}): OllamaCloudUsageState => ({
  account_id: 7,
  eligible: true,
  configured: false,
  auto_refresh_enabled: false,
  encryption_key_configured: true,
  ...overrides
})

const detailedState = (plan = 'max'): OllamaCloudUsageState =>
  state({
    configured: true,
    snapshot: {
      status: 'ok',
      fetched_at: '2026-07-22T12:00:00Z',
      last_attempt_at: '2026-07-22T12:00:00Z',
      next_refresh_at: '2026-07-22T13:00:00Z',
      data: {
        plan,
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

const account = (usage: OllamaCloudUsageState = state()): Account => ({
  id: 7,
  name: 'ollama',
  platform: 'anthropic',
  type: 'apikey',
  ollama_cloud_usage: usage,
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
})

afterEach(cleanup)

describe('OllamaCloudUsageSettings', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset())
    notifications.showSuccess.mockReset()
    notifications.showError.mockReset()
  })

  it('uses the existing account state without an immediate duplicate GET', async () => {
    api.saveOllamaCloudUsageSession.mockResolvedValueOnce(state({ configured: true }))
    const onUpdated = vi.fn()
    const { container } = render(<OllamaCloudUsageSettings account={account()} onUpdated={onUpdated} />)
    await flushPromises()

    const input = container.querySelector('#ollama-cloud-session') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'wos-session=browser-secret' } })
    fireEvent.click(screen.getByTestId('ollama-cloud-session-save'))
    await flushPromises()

    expect(api.getOllamaCloudUsage).not.toHaveBeenCalled()
    expect(api.saveOllamaCloudUsageSession).toHaveBeenCalledWith(7, 'wos-session=browser-secret')
    expect(input.value).toBe('')
    expect(container.textContent).not.toContain('browser-secret')
    expect(onUpdated.mock.calls.at(-1)?.[0]).toMatchObject({ configured: true })
  })

  it('fails closed when the persistent encryption key is unavailable', async () => {
    const { container } = render(
      <OllamaCloudUsageSettings account={account(state({ encryption_key_configured: false }))} />
    )
    await flushPromises()
    fireEvent.change(container.querySelector('#ollama-cloud-session') as HTMLTextAreaElement, {
      target: { value: 'wos-session=secret' }
    })

    expect(screen.getByTestId('ollama-cloud-session-save')).toBeDisabled()
    expect(container.textContent).toContain('admin.accounts.ollamaCloud.encryptionKeyRequired')
    expect(api.saveOllamaCloudUsageSession).not.toHaveBeenCalled()
  })

  it('updates the account-level automatic refresh switch through its dedicated endpoint', async () => {
    api.setOllamaCloudUsageAutoRefresh.mockResolvedValueOnce(state({ configured: true, auto_refresh_enabled: true }))
    render(<OllamaCloudUsageSettings account={account(state({ configured: true }))} />)
    await flushPromises()

    fireEvent.click(within(screen.getByTestId('ollama-cloud-auto-refresh')).getByRole('switch'))
    await flushPromises()
    expect(api.setOllamaCloudUsageAutoRefresh).toHaveBeenCalledWith(7, true)
  })

  it('keeps plan, balance, model, status, and manual refresh details in the edit settings', async () => {
    api.refreshOllamaCloudUsage.mockResolvedValueOnce(detailedState('pro'))
    render(<OllamaCloudUsageSettings account={account(detailedState())} />)
    await flushPromises()

    const details = screen.getByTestId('ollama-cloud-usage-details')
    expect(details.textContent).toContain('max')
    expect(details.textContent).toContain('$0')
    expect(details.textContent).toContain('5h gpt-oss:120b-cloud: 2')
    expect(details.textContent).toContain('7d gpt-oss:120b-cloud: 12')
    expect(details.textContent).toContain('admin.accounts.ollamaCloud.ok')

    fireEvent.click(screen.getByTestId('ollama-cloud-refresh'))
    await flushPromises()

    expect(api.refreshOllamaCloudUsage).toHaveBeenCalledWith(7)
    expect(screen.getByTestId('ollama-cloud-usage-details').textContent).toContain('pro')
    expect(notifications.showSuccess).toHaveBeenCalled()
  })

  it('shows the structured manual refresh limit from the edit settings', async () => {
    api.refreshOllamaCloudUsage.mockRejectedValueOnce({
      status: 429,
      reason: 'OLLAMA_CLOUD_USAGE_REFRESH_RATE_LIMITED',
      metadata: { retry_after_seconds: '18' }
    })
    render(<OllamaCloudUsageSettings account={account(detailedState())} />)

    fireEvent.click(screen.getByTestId('ollama-cloud-refresh'))
    await flushPromises()

    expect(notifications.showError).toHaveBeenCalledWith('retry in 18 seconds')
  })
})
