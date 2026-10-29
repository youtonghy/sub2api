import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '@/types'
import CNProviderBalanceCell from '../CNProviderBalanceCell'

const { queryBalance } = vi.hoisted(() => ({
  queryBalance: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    cnProviders: { queryBalance }
  }
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' })
}))

const flushPromises = () => act(async () => {})

const account = {
  id: 7,
  platform: 'kimi',
  type: 'apikey',
  credentials: { account_mode: 'payg' },
  extra: {
    kimi_balance: 12.5,
    kimi_balance_currency: 'CNY'
  }
} as unknown as Account

describe('CNProviderBalanceCell', () => {
  beforeEach(() => {
    queryBalance.mockReset()
  })

  afterEach(() => cleanup())

  it('renders the persisted balance as static text with an explicit query action', async () => {
    const { container } = render(<CNProviderBalanceCell account={account} />)
    await flushPromises()

    // Snapshot value renders without any probe.
    expect(queryBalance).not.toHaveBeenCalled()
    expect(container.querySelector('[data-test="cn-provider-balance-value"]')?.textContent).toContain('CNY 12.50')

    // The control reads as an action; the i18n mock returns the key itself.
    const probeButton = container.querySelector('[data-test="cn-provider-balance-probe"]')!
    expect(probeButton.textContent).toBe('admin.accounts.cnProviders.probe')

    await act(async () => {
      fireEvent.click(probeButton)
    })
    await flushPromises()
    expect(queryBalance).toHaveBeenCalledWith(account.id)
  })

  it('shows the low-balance badge from the snapshot marker', () => {
    const lowAccount = {
      ...account,
      extra: { kimi_balance: 0.4, kimi_balance_low: true }
    } as unknown as Account

    const { container } = render(<CNProviderBalanceCell account={lowAccount} />)

    expect(container.textContent).toContain('admin.accounts.cnProviders.balanceLow')
  })

  it('keeps the snapshot balance visible when a query fails', async () => {
    queryBalance.mockResolvedValue({ success: false, error: 'HTTP 401' })
    const { container } = render(<CNProviderBalanceCell account={account} />)

    await act(async () => {
      fireEvent.click(container.querySelector('[data-test="cn-provider-balance-probe"]')!)
    })
    await flushPromises()

    expect(container.textContent).toContain('CNY 12.50')
    expect(container.textContent).toContain('HTTP 401')
  })
})
