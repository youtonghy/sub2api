import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SubscriptionsView from '../SubscriptionsView'
import { app, captured, resetCaptured } from './subscriptionsViewHarness'

const { listSubscriptions, assignSubscription, getAllGroups, listUsers, searchUsageUsers } = vi.hoisted(() => ({
  listSubscriptions: vi.fn(),
  assignSubscription: vi.fn(),
  getAllGroups: vi.fn(),
  listUsers: vi.fn(),
  searchUsageUsers: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    subscriptions: { list: listSubscriptions, assign: assignSubscription },
    groups: { getAll: getAllGroups },
    users: { list: listUsers },
    usage: { searchUsers: searchUsageUsers }
  }
}))

vi.mock('@/stores/app', async () => (await import('./subscriptionsViewHarness')).appStoreModule())
vi.mock('@/i18n/useI18n', async () =>
  (await import('./subscriptionsViewHarness')).i18nModule((key: string, params?: { id?: number }) =>
    key === 'admin.redeem.userPrefix' ? `User #${params?.id}` : key
  )
)
vi.mock('@/components/common/DataTable', async () => (await import('./subscriptionsViewHarness')).dataTableModule())
vi.mock('@/components/common/Select', async () => (await import('./subscriptionsViewHarness')).selectModule())
vi.mock('@/components/common/BaseDialog', async () => (await import('./subscriptionsViewHarness')).baseDialogModule())
vi.mock('@/components/common/Pagination', async () => (await import('./subscriptionsViewHarness')).capturingModule('Pagination'))
vi.mock('@/components/common/ConfirmDialog', async () => (await import('./subscriptionsViewHarness')).capturingModule('ConfirmDialog'))
vi.mock('@/components/common/EmptyState', async () => (await import('./subscriptionsViewHarness')).capturingModule('EmptyState'))
vi.mock('@/components/common/GroupBadge', async () => (await import('./subscriptionsViewHarness')).capturingModule('GroupBadge'))
vi.mock('@/components/common/GroupOptionItem', async () => (await import('./subscriptionsViewHarness')).capturingModule('GroupOptionItem'))

const subscriptionRow = (user: Record<string, unknown>) => ({
  id: 9,
  user_id: 42,
  group_id: 3,
  status: 'active',
  starts_at: '2026-01-01T00:00:00Z',
  expires_at: null,
  daily_usage_usd: 0,
  weekly_usage_usd: 0,
  monthly_usage_usd: 0,
  daily_window_start: null,
  weekly_window_start: null,
  monthly_window_start: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  user
})

const flushPromises = () => act(async () => {})
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const mountView = () =>
  render(
    <MemoryRouter>
      <SubscriptionsView />
    </MemoryRouter>
  )

const openAssign = () =>
  fireEvent.click(screen.getAllByRole('button').find((button) => button.textContent === 'admin.subscriptions.assignSubscription')!)
const picker = (name: 'assign' | 'filter') => document.querySelector<HTMLElement>(`[data-${name}-user-search]`)!
const pickerInput = (name: 'assign' | 'filter') => picker(name).querySelector('input')!
const pickerButton = (name: 'assign' | 'filter') => picker(name).querySelector('button')!
const typeInto = (input: HTMLInputElement, value: string) => {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
}

describe('admin subscription users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCaptured()
    localStorage.clear()
    listSubscriptions.mockResolvedValue({
      items: [subscriptionRow({ email: 'reader@example.com', username: 'Reader' })],
      total: 1,
      pages: 1
    })
    assignSubscription.mockResolvedValue({})
    getAllGroups.mockResolvedValue([])
    listUsers.mockResolvedValue({
      items: [{ id: 42, email: 'reader@example.com' }],
      total: 1,
      pages: 1
    })
    searchUsageUsers.mockResolvedValue([{ id: 14, email: 'deleted@example.com', deleted: true }])
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('searches current users when assigning a subscription', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mountView()
    await flushPromises()
    openAssign()
    typeInto(pickerInput('assign'), '  example.com  ')
    await advance(300)
    await flushPromises()

    expect(listUsers).toHaveBeenCalledWith(1, 30, {
      search: 'example.com',
      sort_by: 'email',
      sort_order: 'asc'
    })
    expect(searchUsageUsers).not.toHaveBeenCalled()
    expect(picker('assign').textContent).toContain('reader@example.com')
    expect(picker('assign').textContent).not.toContain('deleted@example.com')
    fireEvent.click(pickerButton('assign'))
    expect(pickerInput('assign').value).toBe('reader@example.com')
  })

  it.each(['another', ''])('clears the assignment user immediately when input changes to %j', async (keyword) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mountView()
    await flushPromises()
    openAssign()
    const form = document.querySelector('#assign-subscription-form')!
    act(() => captured['Select:admin.subscriptions.selectGroup'].onChange(3, null))
    typeInto(pickerInput('assign'), 'reader')
    await advance(300)
    await flushPromises()
    fireEvent.click(pickerButton('assign'))

    fireEvent.change(pickerInput('assign'), { target: { value: keyword } })
    fireEvent.submit(form)
    await flushPromises()

    expect(assignSubscription).not.toHaveBeenCalled()
    expect(app.showError).toHaveBeenCalledWith('admin.subscriptions.pleaseSelectUser')
    expect(listUsers).toHaveBeenCalledTimes(1)

    listUsers.mockResolvedValue({ items: [{ id: 84, email: 'another@example.com' }] })
    typeInto(pickerInput('assign'), 'another')
    await advance(300)
    await flushPromises()
    fireEvent.click(pickerButton('assign'))
    fireEvent.submit(form)
    await flushPromises()

    expect(assignSubscription).toHaveBeenCalledTimes(1)
    expect(assignSubscription).toHaveBeenCalledWith({
      user_id: 84,
      group_id: 3,
      validity_days: 30
    })
  })

  it('keeps deleted users available when filtering subscription history', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mountView()
    await flushPromises()
    typeInto(pickerInput('filter'), 'deleted')
    await advance(300)
    await flushPromises()

    expect(searchUsageUsers).toHaveBeenCalledWith('deleted')
    expect(listUsers).not.toHaveBeenCalled()
    expect(picker('filter').textContent).toContain('deleted@example.com')
    fireEvent.click(pickerButton('filter'))
    await flushPromises()
    expect(listSubscriptions).toHaveBeenLastCalledWith(
      1,
      expect.any(Number),
      expect.objectContaining({ user_id: 14 }),
      expect.any(Object)
    )
  })

  it('renders the user email as a link to that user filtered usage records', async () => {
    mountView()
    await flushPromises()

    const link = screen.getByRole('link', { name: 'reader@example.com' })
    expect(link.textContent).toBe('reader@example.com')
    expect(link.getAttribute('href')).toBe('/admin/usage?user_id=42')
  })

  it('uses the user ID label for the usage link when username mode has no username', async () => {
    localStorage.setItem('subscription-user-column-mode', 'username')
    listSubscriptions.mockResolvedValue({
      items: [subscriptionRow({ email: 'reader@example.com' })],
      total: 1,
      pages: 1
    })

    mountView()
    await flushPromises()

    const link = screen.getByRole('link', { name: 'User #42' })
    expect(link.textContent).toBe('User #42')
    expect(link.getAttribute('href')).toBe('/admin/usage?user_id=42')
  })
})
