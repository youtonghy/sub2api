import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SubscriptionsView from '../SubscriptionsView'
import { captured, resetCaptured } from './subscriptionsViewHarness'

const { list, bulkAction, bulkAssign, listUsers } = vi.hoisted(() => ({
  list: vi.fn(),
  bulkAction: vi.fn(),
  bulkAssign: vi.fn(),
  listUsers: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    subscriptions: { list, bulkAction, bulkAssign },
    groups: { getAll: vi.fn().mockResolvedValue([]) },
    users: { list: listUsers }
  }
}))
vi.mock('@/stores/app', async () => (await import('./subscriptionsViewHarness')).appStoreModule())
vi.mock('@/i18n/useI18n', async () => (await import('./subscriptionsViewHarness')).i18nModule())
// Vue 版 DataTable 替身渲染为空 <div />，这里同样只记录 props
vi.mock('@/components/common/DataTable', async () => (await import('./subscriptionsViewHarness')).capturingModule('DataTable'))
vi.mock('@/components/common/Select', async () => (await import('./subscriptionsViewHarness')).selectModule())
vi.mock('@/components/common/BaseDialog', async () => (await import('./subscriptionsViewHarness')).baseDialogModule())
vi.mock('@/components/common/Pagination', async () => (await import('./subscriptionsViewHarness')).capturingModule('Pagination'))
vi.mock('@/components/common/ConfirmDialog', async () => (await import('./subscriptionsViewHarness')).capturingModule('ConfirmDialog'))
vi.mock('@/components/common/EmptyState', async () => (await import('./subscriptionsViewHarness')).capturingModule('EmptyState'))
vi.mock('@/components/common/GroupBadge', async () => (await import('./subscriptionsViewHarness')).capturingModule('GroupBadge'))
vi.mock('@/components/common/GroupOptionItem', async () => (await import('./subscriptionsViewHarness')).capturingModule('GroupOptionItem'))

const rows = [
  { id: 1, user_id: 11, group_id: 1, status: 'active', user: { email: 'active@example.com' } },
  { id: 2, user_id: 22, group_id: 1, status: 'expired', user: { email: 'expired@example.com' } },
  { id: 3, user_id: 33, group_id: 1, status: 'revoked', user: { email: 'revoked@example.com' } }
]

const flushPromises = () => act(async () => {})

function mountView() {
  return render(
    <MemoryRouter>
      <SubscriptionsView />
    </MemoryRouter>
  )
}

const selectedKeys = () => captured.DataTable.selectedKeys

async function select(ids: number[]) {
  act(() => captured.DataTable.onSelectedKeysChange(ids))
  await flushPromises()
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetCaptured()
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('auth_user', JSON.stringify({ id: 777 }))
  list.mockResolvedValue({ items: rows, total: 60, pages: 3 })
  mountView()
  await flushPromises()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('subscription bulk operations', () => {
  it('uses eligible selected rows and retains failures and untouched selections after a partial result', async () => {
    bulkAction.mockResolvedValue({
      success_count: 1,
      failed_count: 1,
      results: [
        { subscription_id: 1, success: true },
        { subscription_id: 2, success: false, error: 'Cannot adjust this subscription' }
      ]
    })
    await select([1, 2, 3])
    fireEvent.click(document.querySelector('[data-test="bulk-extend"]')!)
    const form = document.querySelector<HTMLFormElement>('#bulk-subscription-action-form')!
    expect(form.textContent).toContain('active@example.com')
    expect(form.textContent).toContain('expired@example.com')
    expect(form.textContent).not.toContain('revoked@example.com')
    fireEvent.submit(form)
    await flushPromises()

    expect(bulkAction).toHaveBeenCalledWith({ subscription_ids: [1, 2], action: 'extend', days: 30 }, expect.any(String))
    expect(selectedKeys()).toEqual([2, 3])
    expect(form.textContent).toContain('Cannot adjust this subscription')
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('disables operations that do not apply to the selected status', async () => {
    await select([3])
    for (const action of ['extend', 'reset_quota', 'revoke']) {
      expect(document.querySelector<HTMLButtonElement>(`[data-test="bulk-${action}"]`)!.disabled).toBe(true)
    }
    expect(document.querySelector<HTMLButtonElement>('[data-test="bulk-restore"]')!.disabled).toBe(false)
  })

  it('clears selection on pagination, sorting, and filters and rejects IDs outside the visible page', async () => {
    await select([1, 999])
    expect(selectedKeys()).toEqual([1])
    act(() => captured.Pagination.onPageChange(2))
    await flushPromises()
    expect(selectedKeys()).toEqual([])
    await select([2])
    act(() => captured.DataTable.onSort('status', 'asc'))
    await flushPromises()
    expect(selectedKeys()).toEqual([])
    await select([3])
    // Vue 版对第一个 Select（状态筛选）触发 change
    act(() => captured['Select:admin.subscriptions.allStatus'].onChange('active', null))
    await flushPromises()
    expect(selectedKeys()).toEqual([])
  })

  it('assigns multiple users once and retries only failed users', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(screen.getAllByRole('button').find((button) => button.textContent === 'admin.subscriptions.assignSubscription')!)
    const form = document.querySelector<HTMLFormElement>('#assign-subscription-form')!
    fireEvent.click(within(form).getByRole('checkbox', { name: 'admin.subscriptions.batchAssign.enable' }))
    act(() => captured['Select:admin.subscriptions.selectGroup'].onChange(7, null))
    const search = form.querySelector<HTMLInputElement>('[data-assign-user-search] input')!
    for (const id of [11, 22]) {
      listUsers.mockResolvedValue({ items: [{ id, email: `user${id}@example.com` }] })
      fireEvent.focus(search)
      fireEvent.change(search, { target: { value: `user${id}` } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      await flushPromises()
      fireEvent.click(form.querySelector('[data-assign-user-search] button')!)
    }
    const assignUsers = () => form.querySelector('[data-test="assign-users"]')
    expect(assignUsers()!.textContent).toContain('user11@example.com')
    expect(assignUsers()!.textContent).toContain('user22@example.com')
    let resolveAssign!: (result: unknown) => void
    bulkAssign.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAssign = resolve
      })
    )
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(bulkAssign).toHaveBeenCalledTimes(1)
    expect(bulkAssign).toHaveBeenCalledWith({ user_ids: [11, 22], group_id: 7, validity_days: 30 })
    resolveAssign({ success_count: 1, failed_count: 1, subscriptions: [{ user_id: 11 }], errors: ['User 22: conflict'] })
    await flushPromises()
    expect(assignUsers()!.textContent).not.toContain('user11@example.com')
    expect(assignUsers()!.textContent).toContain('user22@example.com')
    expect(form.querySelector('[data-test="batch-assign-result"]')!.textContent).toContain('User 22: conflict')
    bulkAssign.mockResolvedValueOnce({ success_count: 1, failed_count: 0, subscriptions: [{ user_id: 22 }], errors: [] })
    fireEvent.submit(form)
    await flushPromises()
    expect(bulkAssign).toHaveBeenLastCalledWith({ user_ids: [22], group_id: 7, validity_days: 30 })
    expect(assignUsers()).toBeNull()
  })
})
