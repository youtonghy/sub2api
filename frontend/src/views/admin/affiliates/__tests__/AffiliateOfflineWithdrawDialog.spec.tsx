import { act, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AffiliateOfflineWithdrawDialog from '../AffiliateOfflineWithdrawDialog'

const { lookupUsers, getUserOverview, withdrawUserQuota, showError, showSuccess } = vi.hoisted(() => ({
  lookupUsers: vi.fn(),
  getUserOverview: vi.fn(),
  withdrawUserQuota: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn()
}))

vi.mock('@/api/admin/affiliates', () => ({
  affiliatesAPI: { lookupUsers, getUserOverview, withdrawUserQuota }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showError, showSuccess }) }
}))

const i18n = vi.hoisted(() => ({
  t: (key: string, params?: unknown) =>
    params && typeof params === 'object' ? `${key} ${JSON.stringify(params)}` : key,
  te: () => true,
  locale: 'en'
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版 BaseDialog 桩：show 时直接渲染内容与 footer
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children, footer }: { show: boolean; children?: ReactNode; footer?: ReactNode }) =>
    show ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null
}))

// 假定时器下逐轮清空微任务（替代 Vue 测试的 flushPromises）
const flushPromises = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function mountDialog() {
  const onSuccess = vi.fn()
  const view = render(<AffiliateOfflineWithdrawDialog show onSuccess={onSuccess} />)
  return { ...view, onSuccess }
}

const el = <T extends Element = HTMLElement>(test: string) => {
  const found = document.querySelector<T>(`[data-test="${test}"]`)
  if (!found) throw new Error(`${test} not found`)
  return found
}
const find = (test: string) => document.querySelector(`[data-test="${test}"]`)
const setValue = (test: string, value: string) => fireEvent.change(el<HTMLInputElement>(test), { target: { value } })
const click = async (test: string) => {
  fireEvent.click(el(test))
  await flushPromises()
}
const isDisabled = (test: string) => el<HTMLButtonElement | HTMLInputElement>(test).disabled

function overviewWithQuota(availableQuota: number) {
  return {
    user_id: 42,
    email: 'inviter@example.com',
    username: 'inviter',
    aff_code: 'INVITER',
    rebate_rate_percent: 20,
    invited_count: 3,
    rebated_invitee_count: 2,
    available_quota: availableQuota,
    history_quota: 50
  }
}

function withdrawResponse(amount: number, availableAfter: number, replayed = false) {
  return {
    result: {
      ledger_id: 9,
      user_id: 42,
      amount,
      available_quota_after: availableAfter,
      frozen_quota_after: 0,
      history_quota_after: 50
    },
    replayed
  }
}

async function pickUser(availableQuota: number) {
  lookupUsers.mockResolvedValue([{ id: 42, email: 'inviter@example.com', username: 'inviter' }])
  getUserOverview.mockResolvedValue(overviewWithQuota(availableQuota))
  setValue('withdraw-user-search', 'inviter')
  act(() => {
    vi.advanceTimersByTime(300)
  })
  await flushPromises()
  await click('withdraw-user-option')
}

describe('AffiliateOfflineWithdrawDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records the exact available quota as the withdrawal amount', async () => {
    const { onSuccess } = mountDialog()
    await pickUser(12.34567891)

    expect(lookupUsers).toHaveBeenCalledWith('inviter')
    expect(getUserOverview).toHaveBeenCalledWith(42)
    expect(el('withdraw-available-quota').textContent).toBe('$12.34567891')

    await click('withdraw-fill-all')
    expect(el<HTMLInputElement>('withdraw-amount').value).toBe('12.34567891')

    withdrawUserQuota.mockResolvedValue(withdrawResponse(12.34567891, 0))
    await click('withdraw-submit')

    expect(withdrawUserQuota).toHaveBeenCalledWith(42, { amount: 12.34567891 }, expect.stringMatching(/^affiliate-withdraw-/))
    expect(showSuccess).toHaveBeenCalledWith(
      'admin.affiliates.withdraw.success {"amount":"$12.34567891","remaining":"$0.00"}'
    )
    expect(onSuccess.mock.calls[0]?.[0]).toMatchObject({ ledger_id: 9 })
  })

  it('blocks amounts above the available quota', async () => {
    mountDialog()
    await pickUser(10)

    setValue('withdraw-amount', '10.00000001')

    expect(el('withdraw-amount-error').textContent).toBe('admin.affiliates.withdraw.amountExceeds')
    expect(isDisabled('withdraw-submit')).toBe(true)
    await click('withdraw-submit')
    expect(withdrawUserQuota).not.toHaveBeenCalled()
  })

  it('treats a user without an affiliate profile as having no available quota', async () => {
    lookupUsers.mockResolvedValue([{ id: 7, email: 'fresh@example.com', username: 'fresh' }])
    getUserOverview.mockRejectedValue({ reason: 'USER_NOT_FOUND', message: 'user not found' })
    mountDialog()

    setValue('withdraw-user-search', 'fresh')
    act(() => {
      vi.advanceTimersByTime(300)
    })
    await flushPromises()
    await click('withdraw-user-option')

    expect(showError).not.toHaveBeenCalled()
    expect(el('withdraw-selected-user').textContent).toContain('fresh@example.com')
    expect(el('withdraw-available-quota').textContent).toBe('$0.00')
    expect(isDisabled('withdraw-fill-all')).toBe(true)

    setValue('withdraw-amount', '1')
    expect(el('withdraw-amount-error').textContent).toBe('admin.affiliates.withdraw.amountExceeds')
    expect(isDisabled('withdraw-submit')).toBe(true)
  })

  it('shows the API error and reloads the available quota when recording fails', async () => {
    const { onSuccess } = mountDialog()
    await pickUser(10)

    withdrawUserQuota.mockRejectedValue({ status: 400, reason: 'AFFILIATE_QUOTA_INSUFFICIENT', message: 'insufficient' })
    setValue('withdraw-amount', '5')
    await click('withdraw-submit')

    expect(showError).toHaveBeenCalledWith('admin.affiliates.errors.AFFILIATE_QUOTA_INSUFFICIENT {}')
    expect(getUserOverview).toHaveBeenCalledTimes(2)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it.each([
    ['a network error', { status: 0, message: 'Network error. Please check your connection.' }],
    ['a gateway error', { status: 502, message: 'Bad Gateway' }],
    ['a request timeout', { status: 408, message: 'Request Timeout' }]
  ])('retries the same registration with the same key after %s', async (_label, failure) => {
    const { onSuccess } = mountDialog()
    await pickUser(10)
    await click('withdraw-fill-all')

    // 服务端其实已登记，只是响应丢失：刷新后的可提取额度已扣到 0。
    withdrawUserQuota.mockRejectedValueOnce(failure)
    getUserOverview.mockResolvedValue(overviewWithQuota(0))
    await click('withdraw-submit')

    expect(showError).toHaveBeenCalledTimes(1)
    expect(el('withdraw-available-quota').textContent).toBe('$0.00')
    expect(el('withdraw-uncertain-hint').textContent).toBe('admin.affiliates.withdraw.uncertainHint')
    expect(isDisabled('withdraw-amount')).toBe(true)
    expect(isDisabled('withdraw-fill-all')).toBe(true)
    expect(isDisabled('withdraw-clear-user')).toBe(true)
    expect(find('withdraw-amount-error')).toBeNull()
    expect(isDisabled('withdraw-submit')).toBe(false)

    withdrawUserQuota.mockResolvedValueOnce(withdrawResponse(10, 0, true))
    await click('withdraw-submit')

    expect(withdrawUserQuota).toHaveBeenCalledTimes(2)
    const [firstCall, retryCall] = withdrawUserQuota.mock.calls
    expect(firstCall).toEqual([42, { amount: 10 }, expect.stringMatching(/^affiliate-withdraw-/)])
    expect(retryCall).toEqual(firstCall)
    expect(showSuccess).toHaveBeenCalledWith('admin.affiliates.withdraw.replayed {"amount":"$10.00","remaining":"$0.00"}')
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('starts a new registration with a fresh key after a definite rejection', async () => {
    mountDialog()
    await pickUser(10)
    setValue('withdraw-amount', '6')

    withdrawUserQuota.mockRejectedValueOnce({ status: 400, reason: 'AFFILIATE_QUOTA_INSUFFICIENT', message: 'insufficient' })
    await click('withdraw-submit')

    expect(find('withdraw-uncertain-hint')).toBeNull()
    expect(isDisabled('withdraw-amount')).toBe(false)

    setValue('withdraw-amount', '5')
    withdrawUserQuota.mockResolvedValueOnce(withdrawResponse(5, 5))
    await click('withdraw-submit')

    expect(withdrawUserQuota).toHaveBeenCalledTimes(2)
    const [rejectedCall, nextCall] = withdrawUserQuota.mock.calls
    expect(nextCall[1]).toEqual({ amount: 5 })
    expect(nextCall[2]).not.toBe(rejectedCall[2])
    expect(showSuccess).toHaveBeenCalledWith('admin.affiliates.withdraw.success {"amount":"$5.00","remaining":"$5.00"}')
  })
})
