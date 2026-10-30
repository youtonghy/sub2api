import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminUser } from '@/types'
import UserBalanceHistoryModal from '../UserBalanceHistoryModal'

const mocks = vi.hoisted(() => ({ getUserBalanceHistory: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { users: mocks } }))
vi.mock('@/utils/format', () => ({ formatDateTime: () => 'date' }))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版 Select 桩通过 vm.$emit('change') 触发；React 版记录 onChange 并直接调用
const select = vi.hoisted(() => ({ onChange: null as null | ((value: string) => void) }))
vi.mock('@/components/common/Select', () => ({
  default: (props: { onChange?: (value: string) => void }) => {
    select.onChange = props.onChange ?? null
    return null
  }
}))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

function result(id: number) {
  return { items: [{ id, type: 'admin_balance', value: id, notes: `History ${id}` }], total: 1, total_recharged: id }
}
function deferred() {
  let resolve!: (value: ReturnType<typeof result>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<ReturnType<typeof result>>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const userOne = { id: 1, email: 'one@example.com', balance: 1 } as AdminUser
function openDialog() {
  const view = render(<UserBalanceHistoryModal show={false} user={userOne} />)
  view.rerender(<UserBalanceHistoryModal show user={userOne} />)
  const setProps = (show: boolean, user: AdminUser = userOne) => view.rerender(<UserBalanceHistoryModal show={show} user={user} />)
  return { ...view, setProps }
}

// Vue 版断言 svg.animate-spin，React 版断言加载占位
const isLoading = () => screen.queryByTestId('balance-history-loading') !== null

describe('UserBalanceHistoryModal request ordering', () => {
  it('keeps the new user history when an old response finishes later', async () => {
    const old = deferred()
    mocks.getUserBalanceHistory.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result(20))
    const wrapper = openDialog()
    wrapper.setProps(false)
    wrapper.setProps(true, { id: 2, email: 'two@example.com', balance: 2 } as AdminUser)
    await flushPromises()
    old.resolve(result(10))
    await flushPromises()
    expect(document.body.textContent).toContain('History 20')
    expect(document.body.textContent).not.toContain('History 10')
    expect(document.body.textContent).toContain('$20.00')
  })

  it('does not end the current filter loading state when an old request finishes', async () => {
    const old = deferred()
    const current = deferred()
    mocks.getUserBalanceHistory.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    openDialog()
    act(() => select.onChange!('balance'))
    await flushPromises()
    old.resolve(result(10))
    await flushPromises()
    expect(isLoading()).toBe(true)
    expect(document.body.textContent).not.toContain('History 10')
    current.resolve(result(20))
    await flushPromises()
    expect(isLoading()).toBe(false)
    expect(document.body.textContent).toContain('History 20')
  })

  it.each(['close', 'unmount'])('ignores failures after %s', async (action) => {
    const pending = deferred()
    mocks.getUserBalanceHistory.mockReturnValueOnce(pending.promise)
    const wrapper = openDialog()
    if (action === 'close') wrapper.setProps(false)
    else wrapper.unmount()
    pending.reject(new Error('Stale error'))
    await flushPromises()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('still reports current failures and ends loading', async () => {
    const error = new Error('Current error')
    mocks.getUserBalanceHistory.mockRejectedValueOnce(error)
    openDialog()
    await flushPromises()
    expect(console.error).toHaveBeenCalledWith('Failed to load balance history:', error)
    expect(isLoading()).toBe(false)
  })
})
