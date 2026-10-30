import { act, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataTableCellContext, DataTableHeaderContext, RowKey } from '@/components/common/DataTable'
import type { Column } from '@/components/common/types'
import type { AdminUser } from '@/types'

const {
  listUsers,
  toggleStatus,
  deleteUser,
  showError,
  showSuccess,
  getAllGroups,
  getBatchUsersUsage,
  listEnabledDefinitions,
  getBatchUserAttributes
} = vi.hoisted(() => ({
  listUsers: vi.fn(),
  toggleStatus: vi.fn(),
  deleteUser: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  getAllGroups: vi.fn(),
  getBatchUsersUsage: vi.fn(),
  listEnabledDefinitions: vi.fn(),
  getBatchUserAttributes: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    users: {
      list: listUsers,
      toggleStatus,
      delete: deleteUser
    },
    groups: {
      getAll: getAllGroups
    },
    dashboard: {
      getBatchUsersUsage
    },
    userAttributes: {
      listEnabledDefinitions,
      getBatchUserAttributes
    }
  }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showError, showSuccess }) }
}))

const i18n = vi.hoisted(() => ({
  t: (key: string, params?: { count?: number }) => (params?.count === undefined ? key : `${key}:${params.count}`),
  te: () => true,
  locale: 'en'
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// ===== 子组件替身（Vue 版 global.stubs） =====

const createAdminUser = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 42,
  username: 'scoped-user',
  email: 'scoped@example.com',
  role: 'user',
  balance: 0,
  concurrency: 1,
  status: 'active',
  allowed_groups: [],
  balance_notify_enabled: false,
  balance_notify_threshold: null,
  balance_notify_extra_emails: [],
  created_at: '2026-04-17T00:00:00Z',
  updated_at: '2026-04-17T00:00:00Z',
  notes: '',
  last_active_at: '2026-04-16T02:00:00Z',
  last_used_at: '2026-04-17T02:00:00Z',
  current_concurrency: 0,
  ...overrides
}) as AdminUser

vi.mock('@/components/common/DataTable', () => ({
  default: (props: {
    columns: Column[]
    data: AdminUser[]
    selectedKeys?: RowKey[]
    onSort?: (key: string, order: 'asc' | 'desc') => void
    onSelectedKeysChange?: (keys: RowKey[]) => void
    cells?: Record<string, (context: DataTableCellContext<AdminUser>) => ReactNode>
    headers?: Record<string, (context: DataTableHeaderContext) => ReactNode>
  }) => {
    const selectedKeys = props.selectedKeys || []
    const cell = (key: string, row: AdminUser, index: number) =>
      props.cells?.[key]?.({ row, value: (row as any)[key], expanded: false, index }) ?? null
    return (
      <div>
        <div data-test="columns">{props.columns.map((col) => col.key).join(',')}</div>
        <div data-test="row-order">{props.data.map((row) => row.email).join(',')}</div>
        <div data-test="row-state">
          {props.data.map((row) => [row.id, row.status, row.current_concurrency].join(':')).join(',')}
        </div>
        <div data-test="selected-keys">{selectedKeys.join(',')}</div>
        <button data-test="sort-last-used" onClick={() => props.onSort?.('last_used_at', 'desc')}>
          sort
        </button>
        {props.data.map((row) => (
          <button
            key={'select-' + row.id}
            data-test={'select-' + row.id}
            onClick={() => props.onSelectedKeysChange?.(Array.from(new Set([...selectedKeys, row.id])))}
          >
            select
          </button>
        ))}
        {props.columns.map((col) => (
          <div key={col.key}>{props.headers?.[col.key]?.({ column: col, sortKey: '', sortOrder: 'asc' })}</div>
        ))}
        {props.data.map((row, index) => (
          <div key={row.id}>
            {cell('last_used_at', row, index)}
            <div data-test={'actions-' + row.id}>{cell('actions', row, index)}</div>
          </div>
        ))}
      </div>
    )
  }
}))

vi.mock('@/components/common/Pagination', () => ({
  default: (props: { onPageChange?: (page: number) => void }) => (
    <button data-test="next-page" onClick={() => props.onPageChange?.(2)}>
      next
    </button>
  )
}))

vi.mock('@/components/common/ConfirmDialog', () => ({
  default: (props: { show: boolean; message: string; onConfirm?: () => void; onCancel?: () => void }) =>
    props.show ? (
      <div data-test="delete-dialog">
        <span>{props.message}</span>
        <button data-test="confirm-delete" onClick={() => props.onConfirm?.()}>
          confirm
        </button>
        <button data-test="cancel-delete" onClick={() => props.onCancel?.()}>
          cancel
        </button>
      </div>
    ) : null
}))

vi.mock('@/components/admin/user/BulkEditUserModal', () => ({
  default: (props: { show: boolean; selectedIds: number[]; onSuccess?: (affected: number) => void }) =>
    props.show ? (
      <div data-test="bulk-modal">
        <span data-test="bulk-modal-ids">{props.selectedIds.join(',')}</span>
        <button data-test="bulk-success" onClick={() => props.onSuccess?.(props.selectedIds.length)}>
          success
        </button>
      </div>
    ) : null
}))

const { empty } = vi.hoisted(() => ({ empty: () => ({ default: () => null }) }))
vi.mock('@/components/common/EmptyState', empty)
vi.mock('@/components/common/GroupBadge', empty)
vi.mock('@/components/common/Select', empty)
vi.mock('@/components/user/UserAttributesConfigModal', empty)
vi.mock('@/components/user/UserConcurrencyCell', empty)
vi.mock('@/components/admin/user/UserCreateModal', empty)
vi.mock('@/components/admin/user/UserEditModal', empty)
vi.mock('@/components/admin/user/UserPlatformQuotaModal', empty)
vi.mock('@/components/admin/user/UserApiKeysModal', empty)
vi.mock('@/components/admin/user/UserAllowedGroupsModal', empty)
vi.mock('@/components/admin/user/UserBalanceModal', empty)
vi.mock('@/components/admin/user/UserBalanceHistoryModal', empty)
vi.mock('@/components/admin/user/GroupReplaceModal', empty)

import UsersView from '../UsersView'

// 同时适配真实计时器与假计时器
const flushPromises = () =>
  act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
    else await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })

const byTest = (id: string) => document.body.querySelector(`[data-test="${id}"]`) as HTMLElement | null
const getByTest = (id: string) => {
  const el = byTest(id)
  if (!el) throw new Error(`[data-test="${id}"] not found`)
  return el
}
const click = (id: string) => fireEvent.click(getByTest(id))

const getToggleStatusButton = (id: number) => {
  const button = Array.from(getByTest(`actions-${id}`).querySelectorAll('button')).find((candidate) =>
    /admin\.users\.(disable|enable)$/.test(candidate.textContent ?? '')
  )
  if (!button) throw new Error(`toggle status button not found for user ${id}`)
  return button
}

describe('admin UsersView', () => {
  beforeEach(() => {
    vi.useRealTimers()
    localStorage.clear()

    listUsers.mockReset()
    toggleStatus.mockReset()
    deleteUser.mockReset()
    showError.mockReset()
    showSuccess.mockReset()
    getAllGroups.mockReset()
    getBatchUsersUsage.mockReset()
    listEnabledDefinitions.mockReset()
    getBatchUserAttributes.mockReset()

    listUsers.mockResolvedValue({
      items: [createAdminUser()],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1
    })
    getAllGroups.mockResolvedValue([])
    getBatchUsersUsage.mockResolvedValue({ stats: {} })
    listEnabledDefinitions.mockResolvedValue([])
    getBatchUserAttributes.mockResolvedValue({ values: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels bulk deletion without deleting or clearing selected users', async () => {
    const view = render(<UsersView />)
    await flushPromises()

    expect(byTest('bulk-delete-users')).toBeNull()
    click('select-42')
    click('bulk-delete-users')
    expect(getByTest('delete-dialog').textContent).toContain('admin.users.bulkDelete.confirm:1')
    expect(deleteUser).not.toHaveBeenCalled()

    click('cancel-delete')
    expect(byTest('delete-dialog')).toBeNull()
    expect(deleteUser).not.toHaveBeenCalled()
    expect(getByTest('selected-keys').textContent).toBe('42')
    view.unmount()
  })

  it.each([
    { failedIds: [], remaining: '', deleted: 2 },
    { failedIds: [43], remaining: '43', deleted: 1 },
    { failedIds: [42, 43], remaining: '42,43', deleted: 0 }
  ])('deletes across pages and retains failures: $remaining', async ({ failedIds, remaining, deleted }) => {
    listUsers.mockImplementation(async (page: number) => ({
      items: [createAdminUser({ id: page === 2 ? 43 : 42 })],
      total: 2, page, page_size: 20, pages: 2
    }))
    deleteUser.mockImplementation(async (id: number) => {
      if ((failedIds as number[]).includes(id)) throw new Error('Cannot delete user')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = render(<UsersView />)
    await flushPromises()
    click('select-42')
    click('next-page')
    await flushPromises()
    click('select-43')
    click('bulk-delete-users')
    expect(deleteUser).not.toHaveBeenCalled()

    click('confirm-delete')
    await flushPromises()

    expect(deleteUser.mock.calls).toEqual([[42], [43]])
    expect(getByTest('selected-keys').textContent).toBe(remaining)
    expect(byTest('delete-dialog')).toBeNull()
    if (deleted) {
      expect(showSuccess).toHaveBeenCalledWith(`admin.users.bulkDelete.success:${deleted}`)
      expect(listUsers.mock.lastCall?.[0]).toBe(1)
    } else {
      expect(showSuccess).not.toHaveBeenCalled()
    }
    if (failedIds.length) expect(showError).toHaveBeenCalledWith(`admin.users.bulkDelete.failed:${failedIds.length}`)
    else expect(showError).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    view.unmount()
  })

  it('deletes the confirmed selection while preserving users selected during deletion', async () => {
    listUsers.mockResolvedValue({
      items: [createAdminUser({ id: 42 }), createAdminUser({ id: 43 })],
      total: 2, page: 1, page_size: 20, pages: 1
    })
    let finishDelete!: () => void
    deleteUser.mockImplementation(() => new Promise<void>((resolve) => { finishDelete = resolve }))
    const view = render(<UsersView />)
    await flushPromises()
    click('select-42')
    click('bulk-delete-users')
    click('confirm-delete')
    expect(getByTest('bulk-delete-users')).toBeDisabled()
    click('select-43')
    await act(async () => finishDelete())
    await flushPromises()

    expect(deleteUser.mock.calls).toEqual([[42]])
    expect(getByTest('selected-keys').textContent).toBe('43')
    view.unmount()
  })

  it('updates only the toggled row in place without reloading the list', async () => {
    listUsers.mockResolvedValue({
      items: [createAdminUser({ id: 42, current_concurrency: 3 }), createAdminUser({ id: 43 })],
      total: 2, page: 1, page_size: 20, pages: 1
    })
    toggleStatus.mockResolvedValue(createAdminUser({ id: 42, status: 'disabled', current_concurrency: undefined }))
    const view = render(<UsersView />)
    await flushPromises()
    expect(getByTest('row-state').textContent).toBe('42:active:3,43:active:0')

    fireEvent.click(getToggleStatusButton(42))
    await flushPromises()

    expect(toggleStatus.mock.calls).toEqual([[42, 'disabled']])
    expect(listUsers).toHaveBeenCalledTimes(1)
    expect(getByTest('row-state').textContent).toBe('42:disabled:3,43:active:0')
    expect(getToggleStatusButton(42).textContent).toBe('admin.users.enable')
    expect(showSuccess).toHaveBeenCalledWith('admin.users.userDisabled')
    view.unmount()
  })

  it('keeps the row untouched when toggling status fails', async () => {
    toggleStatus.mockRejectedValue(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = render(<UsersView />)
    await flushPromises()

    fireEvent.click(getToggleStatusButton(42))
    await flushPromises()

    expect(listUsers).toHaveBeenCalledTimes(1)
    expect(getByTest('row-state').textContent).toBe('42:active:0')
    expect(showError).toHaveBeenCalledWith('admin.users.failedToToggle')
    expect(showSuccess).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    view.unmount()
  })

  it('reloads the list when a list request is in flight as the toggle resolves', async () => {
    let finishToggle!: (user: AdminUser) => void
    toggleStatus.mockImplementation(() => new Promise<AdminUser>((resolve) => { finishToggle = resolve }))
    const view = render(<UsersView />)
    await flushPromises()

    fireEvent.click(getToggleStatusButton(42))
    listUsers.mockImplementationOnce(() => new Promise(() => {}))
    click('sort-last-used')
    await flushPromises()
    expect(listUsers).toHaveBeenCalledTimes(2)

    listUsers.mockResolvedValue({
      items: [createAdminUser({ status: 'disabled' })],
      total: 1, page: 1, page_size: 20, pages: 1
    })
    await act(async () => finishToggle(createAdminUser({ status: 'disabled' })))
    await flushPromises()

    expect(listUsers).toHaveBeenCalledTimes(3)
    expect(getByTest('row-state').textContent).toBe('42:disabled:0')
    view.unmount()
  })

  it('shows active, used, and created activity columns in order and requests last_used_at sort', async () => {
    render(<UsersView />)
    await flushPromises()

    const visibleColumns = (getByTest('columns').textContent ?? '').split(',')
    expect(visibleColumns.slice(-4, -1)).toEqual(['last_active_at', 'last_used_at', 'created_at'])
    expect(visibleColumns).not.toContain('last_login_at')

    click('sort-last-used')
    await flushPromises()

    expect(listUsers).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({
        sort_by: 'last_used_at',
        sort_order: 'desc'
      }),
      expect.any(Object)
    )
  })

  it('clears usage current-page sort when switching to last_used_at server sort', async () => {
    vi.useFakeTimers()
    localStorage.setItem('user-column-settings-version', '3')
    localStorage.setItem(
      'user-hidden-columns',
      JSON.stringify([
        'notes',
        'groups',
        'subscriptions',
        'concurrency',
        'usage_anthropic',
        'usage_openai',
        'usage_gemini',
        'usage_antigravity',
        'balance_platform_quota'
      ])
    )

    listUsers.mockResolvedValue({
      items: [
        createAdminUser({ id: 1, email: 'last-used-first@example.com' }),
        createAdminUser({ id: 2, email: 'usage-first@example.com' })
      ],
      total: 2,
      page: 1,
      page_size: 20,
      pages: 1
    })
    getBatchUsersUsage.mockResolvedValue({
      stats: {
        1: { user_id: 1, today_actual_cost: 1, total_actual_cost: 1, by_platform: [] },
        2: { user_id: 2, today_actual_cost: 9, total_actual_cost: 9, by_platform: [] }
      }
    })

    render(<UsersView />)

    await flushPromises()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    await flushPromises()

    expect(getByTest('row-order').textContent).toBe('last-used-first@example.com,usage-first@example.com')

    click('usage-sort-trigger-usage')
    await flushPromises()
    click('usage-sort-usage-today')
    await flushPromises()

    expect(getByTest('row-order').textContent).toBe('usage-first@example.com,last-used-first@example.com')
    expect(localStorage.getItem('admin-users-usage-sort')).toContain('"key":"usage"')

    click('sort-last-used')
    await flushPromises()

    expect(localStorage.getItem('admin-users-usage-sort')).toBeNull()
    expect(getByTest('row-order').textContent).toBe('last-used-first@example.com,usage-first@example.com')
    expect(listUsers).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({
        sort_by: 'last_used_at',
        sort_order: 'desc'
      }),
      expect.any(Object)
    )
  })

  it('keeps selected user IDs across pages and clears them after a successful bulk update', async () => {
    let refreshed = false
    listUsers.mockImplementation(async (page: number) => {
      const user =
        page === 2
          ? createAdminUser({ id: 43, email: refreshed ? 'refreshed-page-two@example.com' : 'page-two@example.com' })
          : createAdminUser({ id: 42, email: 'page-one@example.com' })
      return { items: [user], total: 2, page, page_size: 20, pages: 2 }
    })

    render(<UsersView />)
    await flushPromises()

    expect(byTest('bulk-edit-limits')).toBeNull()
    click('select-42')
    expect(getByTest('selected-keys').textContent).toBe('42')
    expect(byTest('bulk-edit-limits')).not.toBeNull()

    click('next-page')
    await flushPromises()
    expect(getByTest('selected-keys').textContent).toBe('42')

    click('select-43')
    expect(getByTest('selected-keys').textContent).toBe('42,43')

    click('bulk-edit-limits')
    expect(getByTest('bulk-modal-ids').textContent).toBe('42,43')

    const callsBeforeSuccess = listUsers.mock.calls.length
    refreshed = true
    click('bulk-success')
    await flushPromises()

    expect(listUsers.mock.calls.length).toBeGreaterThan(callsBeforeSuccess)
    expect(getByTest('row-order').textContent).toBe('refreshed-page-two@example.com')
    expect(byTest('bulk-edit-limits')).toBeNull()
    expect(getByTest('selected-keys').textContent).toBe('')
  })
})
