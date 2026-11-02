import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { redeem, getHistory, refreshUser, fetchActiveSubscriptions, showError, showWarning, showSuccess } = vi.hoisted(() => ({
  redeem: vi.fn(),
  getHistory: vi.fn(),
  refreshUser: vi.fn(),
  fetchActiveSubscriptions: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showSuccess: vi.fn()
}))

vi.mock('@/api', () => ({
  redeemAPI: { redeem, getHistory },
  authAPI: { getPublicSettings: vi.fn().mockResolvedValue({}) }
}))
vi.mock('@/stores/auth', () => {
  const state = { user: { balance: 10, concurrency: 2 }, refreshUser }
  return {
    useAuthStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
      getState: () => state
    })
  }
})
vi.mock('@/stores/subscriptions', () => {
  const state = { fetchActiveSubscriptions }
  return {
    useSubscriptionStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
      getState: () => state
    })
  }
})
vi.mock('@/stores/app', () => {
  const state = { showError, showWarning, showSuccess }
  return {
    useAppStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), {
      getState: () => state
    })
  }
})
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

import RedeemView from '../RedeemView'

const flushPromises = () => act(async () => {})

const codeInput = () => document.querySelector('input#code') as HTMLInputElement
const sizeSelect = () => document.querySelector('select') as HTMLSelectElement
const button = (text: string) => screen.getAllByRole('button').find((b) => b.textContent?.trim() === text)!
const text = () => document.body.textContent ?? ''

async function setCode(value: string) {
  await act(async () => {
    fireEvent.change(codeInput(), { target: { value } })
  })
}
async function submitForm() {
  await act(async () => {
    fireEvent.submit(document.querySelector('form')!)
  })
  await flushPromises()
}
async function click(text: string) {
  await act(async () => {
    fireEvent.click(button(text))
  })
  await flushPromises()
}
async function setSize(value: string) {
  await act(async () => {
    fireEvent.change(sizeSelect(), { target: { value } })
  })
}

async function mountView() {
  const view = render(<RedeemView />)
  await flushPromises()
  return view
}

async function submitCode() {
  const view = await mountView()
  await setCode(' REDEEM-CODE ')
  await submitForm()
  return view
}

describe('RedeemView refresh after redemption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redeem.mockResolvedValue({ type: 'balance', value: 20, message: 'Code applied' })
    getHistory.mockResolvedValue({ items: [], total: 0 })
    refreshUser.mockResolvedValue({ balance: 30, concurrency: 2 })
    fetchActiveSubscriptions.mockResolvedValue([])
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each(['balance', 'concurrency', 'subscription'])('keeps a successful %s redemption when profile refresh fails', async (type) => {
    redeem.mockResolvedValue({ type, value: 20, message: 'Code applied' })
    refreshUser.mockRejectedValue({ status: 503, message: 'Service unavailable' })
    getHistory.mockResolvedValueOnce({ items: [], total: 0 }).mockResolvedValueOnce({
      total: 1,
      items: [{ id: 1, code: 'REDEEM-CODE', type, value: 20, used_at: '2026-03-08T00:00:00Z' }]
    })

    await submitCode()

    expect(redeem).toHaveBeenCalledWith('REDEEM-CODE')
    expect(showError).not.toHaveBeenCalled()
    expect(showWarning).toHaveBeenCalledWith('redeem.userRefreshFailed')
    expect(showSuccess).toHaveBeenCalledWith('redeem.codeRedeemSuccess')
    expect(text()).toContain('Code applied')
    expect(text()).not.toContain('redeem.failedToRedeem')
    expect(codeInput().value).toBe('')
    expect(codeInput().disabled).toBe(false)
    expect(getHistory).toHaveBeenCalledTimes(2)
    expect(text()).toContain('REDEEM-C...')
    if (type === 'subscription') {
      expect(fetchActiveSubscriptions).toHaveBeenCalledWith(true)
    } else {
      expect(fetchActiveSubscriptions).not.toHaveBeenCalled()
    }
  })

  it('pages on the server, changes size, and resets page and total after redeeming', async () => {
    getHistory.mockResolvedValue({ items: [], total: 101 })
    await mountView()
    expect(getHistory).toHaveBeenLastCalledWith(1, 20)
    expect(button('pagination.previous')).toBeDisabled()
    await click('pagination.next')
    expect(getHistory).toHaveBeenLastCalledWith(2, 20)
    await click('pagination.previous')
    expect(getHistory).toHaveBeenLastCalledWith(1, 20)
    expect(Array.from(sizeSelect().options).map((o) => o.textContent)).toEqual(['20', '50', '100'])
    await setSize('50')
    await flushPromises()
    expect(getHistory).toHaveBeenLastCalledWith(1, 50)
    await setSize('100')
    await flushPromises()
    await click('pagination.next')
    expect(getHistory).toHaveBeenLastCalledWith(2, 100)
    expect(button('pagination.next')).toBeDisabled()
    getHistory.mockResolvedValue({ items: [], total: 102 })
    await setCode('NEW-CODE')
    await submitForm()
    expect(getHistory).toHaveBeenLastCalledWith(1, 100)
    expect(text()).toContain('102')
    expect(button('pagination.previous')).toBeDisabled()
  })

  it('restores the loaded size and keeps rows and navigation usable after a size request fails', async () => {
    const item = { id: 1, code: 'OLD-ROWS', type: 'balance', value: 20, used_at: '2026-03-08T00:00:00Z' }
    getHistory.mockResolvedValue({ items: [item], total: 61 })
    await mountView()
    await click('pagination.next')
    let rejectRequest!: (error: Error) => void
    getHistory.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject
        })
    )
    await setSize('50')
    expect(getHistory).toHaveBeenLastCalledWith(1, 50)
    expect(button('pagination.next')).toBeDisabled()
    await act(async () => {
      rejectRequest(new Error('Network error'))
    })
    await flushPromises()
    expect(sizeSelect().value).toBe('20')
    expect(text()).toContain('OLD-ROWS')
    expect(text()).toContain('61')
    expect(button('pagination.previous')).not.toBeDisabled()
    expect(button('pagination.next')).not.toBeDisabled()
    expect(showError).toHaveBeenCalledWith('redeem.historyLoadFailed')
    await click('pagination.next')
    expect(getHistory).toHaveBeenLastCalledWith(3, 20)
    await setSize('50')
    await flushPromises()
    expect(getHistory).toHaveBeenLastCalledWith(1, 50)
    expect(sizeSelect().value).toBe('50')
    expect(button('pagination.previous')).toBeDisabled()
  })

  it.each(['success', 'failure'])('ignores a stale history %s after a newer size request succeeds', async (outcome) => {
    let resolveOld!: (value: unknown) => void
    let rejectOld!: (error: Error) => void
    getHistory.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          resolveOld = resolve
          rejectOld = reject
        })
    )
    render(<RedeemView />)
    getHistory.mockResolvedValue({
      items: [{ id: 2, code: 'NEW-ROWS', type: 'balance', value: 30, used_at: '2026-03-08T00:00:00Z' }],
      total: 61
    })
    // Force overlapping requests to exercise responses arriving out of order.
    // 首个请求进行中时下拉被禁用，这里直接改值以模拟 Vue 版 setValue 的强制重叠请求。
    sizeSelect().disabled = false
    await setSize('50')
    await flushPromises()
    await click('pagination.next')
    expect(getHistory).toHaveBeenLastCalledWith(2, 50)
    await act(async () => {
      if (outcome === 'success') {
        resolveOld({ items: [], total: 0 })
      } else {
        rejectOld(new Error('Stale network error'))
      }
    })
    await flushPromises()
    expect(sizeSelect().value).toBe('50')
    expect(text()).toContain('NEW-ROWS')
    expect(text()).toContain('61')
    expect(button('pagination.previous')).not.toBeDisabled()
    expect(button('pagination.next')).toBeDisabled()
    expect(sizeSelect()).not.toBeDisabled()
    expect(showError).not.toHaveBeenCalled()
    await click('pagination.previous')
    expect(getHistory).toHaveBeenLastCalledWith(1, 50)
  })

  it('disables both paging buttons for empty history', async () => {
    await submitCode()
    for (const b of screen.getAllByRole('button').filter((el) => el.textContent?.trim().startsWith('pagination.'))) {
      expect(b).toBeDisabled()
    }
  })

  it('finishes normally without a warning when profile refresh succeeds', async () => {
    await submitCode()

    expect(refreshUser).toHaveBeenCalledOnce()
    expect(showWarning).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
    expect(showSuccess).toHaveBeenCalledWith('redeem.codeRedeemSuccess')
    expect(codeInput().value).toBe('')
  })

  it('preserves the existing subscription refresh warning after successful redemption', async () => {
    redeem.mockResolvedValue({ type: 'subscription', value: 20, message: 'Code applied' })
    fetchActiveSubscriptions.mockRejectedValue(new Error('Network Error'))
    await submitCode()

    expect(showWarning).toHaveBeenCalledWith('redeem.subscriptionRefreshFailed')
    expect(showError).not.toHaveBeenCalled()
    expect(showSuccess).toHaveBeenCalledWith('redeem.codeRedeemSuccess')
    expect(getHistory).toHaveBeenCalledTimes(2)
  })

  it('keeps the code and reports failure when the redemption request itself fails', async () => {
    redeem.mockRejectedValue({ response: { data: { detail: 'Invalid code' } } })
    await submitCode()

    expect(showError).toHaveBeenCalledWith('redeem.redeemFailed')
    expect(text()).toContain('Invalid code')
    expect(text()).not.toContain('Code applied')
    expect(codeInput().value).toBe(' REDEEM-CODE ')
    expect(refreshUser).not.toHaveBeenCalled()
    expect(fetchActiveSubscriptions).not.toHaveBeenCalled()
    expect(getHistory).toHaveBeenCalledOnce()
    expect(showSuccess).not.toHaveBeenCalled()
    expect(showWarning).not.toHaveBeenCalled()
  })
})
