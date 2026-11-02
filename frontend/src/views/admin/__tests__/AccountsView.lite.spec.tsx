import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountsView from '../AccountsView'
import { app, captured, resetCaptured } from './accountsViewHarness'

const {
  listAccounts,
  listWithEtag,
  getById,
  getBatchTodayStats,
  getUpstreamBillingProbeSettings,
  getAllProxies,
  getAllGroups,
  refreshCredentials
} = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listWithEtag: vi.fn(),
  getById: vi.fn(),
  getBatchTodayStats: vi.fn(),
  getUpstreamBillingProbeSettings: vi.fn(),
  getAllProxies: vi.fn(),
  getAllGroups: vi.fn(),
  refreshCredentials: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      list: listAccounts,
      getById,
      listWithEtag,
      getBatchTodayStats,
      getUpstreamBillingProbeSettings,
      delete: vi.fn(),
      batchClearError: vi.fn(),
      batchRefresh: vi.fn(),
      toggleSchedulable: vi.fn(),
      refreshCredentials
    },
    proxies: { getAll: getAllProxies },
    groups: { getAll: getAllGroups }
  }
}))

vi.mock('@/i18n/useI18n', async () => (await import('./accountsViewHarness')).i18nModule())
vi.mock('@/stores/app', async () => (await import('./accountsViewHarness')).appStoreModule())
vi.mock('@/stores/auth', async () => (await import('./accountsViewHarness')).authStoreModule())
vi.mock('@/components/account', async () =>
  (await import('./accountsViewHarness')).accountBarrelModule({
    EditAccountModal: (props: any) => <div data-test="edit-account">{props.show ? props.account?.name : ''}</div>
  })
)
vi.mock('@/components/account/AccountCapacityCell', async () => (await import('./accountsViewHarness')).stubModule('AccountCapacityCell'))
vi.mock('@/components/account/AccountGroupsCell', async () =>
  (await import('./accountsViewHarness')).stubModule('AccountGroupsCell', (props: any) => (
    <span data-test="account-groups">{(props.groups ?? []).map((group: any) => group.name).join(',')}</span>
  ))
)
vi.mock('@/components/account/AccountSortOrderModal', async () => (await import('./accountsViewHarness')).stubModule('AccountSortOrderModal'))
vi.mock('@/components/account/AccountStatusIndicator', async () => (await import('./accountsViewHarness')).stubModule('AccountStatusIndicator'))
vi.mock('@/components/account/AccountTodayStatsCell', async () => (await import('./accountsViewHarness')).stubModule('AccountTodayStatsCell'))
vi.mock('@/components/account/AccountUsageCell', async () => (await import('./accountsViewHarness')).stubModule('AccountUsageCell'))
vi.mock('@/components/account/UpstreamBillingRateCell', async () => (await import('./accountsViewHarness')).stubModule('UpstreamBillingRateCell'))
vi.mock('@/components/admin/ErrorPassthroughRulesModal', async () => (await import('./accountsViewHarness')).stubModule('ErrorPassthroughRulesModal'))
vi.mock('@/components/admin/TLSFingerprintProfilesModal', async () => (await import('./accountsViewHarness')).stubModule('TLSFingerprintProfilesModal'))
vi.mock('@/components/admin/account/AccountModelTestPanel', async () => (await import('./accountsViewHarness')).stubModule('AccountModelTestPanel'))
vi.mock('@/components/admin/account/AccountStatsModal', async () =>
  (await import('./accountsViewHarness')).stubModule('AccountStatsModal', (props: any) => (
    <div data-test="stats-account">{props.show ? props.account?.name : ''}</div>
  ))
)
vi.mock('@/components/admin/account/AccountTestModal', async () =>
  (await import('./accountsViewHarness')).stubModule('AccountTestModal', (props: any) => (
    <div data-test="test-account">{props.show ? props.account?.name : ''}</div>
  ))
)
vi.mock('@/components/admin/account/ImportDataModal', async () => (await import('./accountsViewHarness')).stubModule('ImportDataModal'))
vi.mock('@/components/admin/account/ReAuthAccountModal', async () => (await import('./accountsViewHarness')).stubModule('ReAuthAccountModal'))
vi.mock('@/components/admin/account/ScheduledTestsPanel', async () => (await import('./accountsViewHarness')).stubModule('ScheduledTestsPanel'))
vi.mock('@/components/admin/account/AccountBulkActionsBar', async () => (await import('./accountsViewHarness')).stubModule('AccountBulkActionsBar'))
vi.mock('@/components/admin/account/AccountTableFilters', async () => (await import('./accountsViewHarness')).stubModule('AccountTableFilters'))
// 真实菜单（需要它的 .action-menu-content 来验证滚动关闭逻辑），同时记录 props 以便模拟事件
vi.mock('@/components/admin/account/AccountActionMenu', async (importOriginal) => {
  const harness = await import('./accountsViewHarness')
  const actual = await importOriginal<typeof import('@/components/admin/account/AccountActionMenu')>()
  const Real = actual.default
  return { default: harness.capturing('AccountActionMenu', (props: any) => <Real {...props} />) }
})
vi.mock('@/components/auth/TotpStepUpDialog', async () => (await import('./accountsViewHarness')).stubModule('TotpStepUpDialog'))
vi.mock('@/components/common/ConfirmDialog', async () => ({ default: (await import('./accountsViewHarness')).ConfirmDialogStub }))
vi.mock('@/components/common/Pagination', async () => (await import('./accountsViewHarness')).stubModule('Pagination'))
vi.mock('@/components/common/PlatformTypeBadge', async () => (await import('./accountsViewHarness')).platformTypeBadgeModule())
vi.mock('@/components/common/HelpTooltip', async () => (await import('./accountsViewHarness')).plainHelpTooltipModule())
vi.mock('@/components/common/DataTable', async () => ({
  default: (await import('./accountsViewHarness')).makeDataTableStub({
    cells: ['groups', 'actions'],
    rowAttrs: (row) => ({ 'data-account-name': row.name })
  })
}))

const flushPromises = () => act(async () => {})

const mountView = async () => {
  const view = render(<AccountsView />)
  await flushPromises()
  return view
}

const buttonByText = (container: HTMLElement, matcher: (text: string) => boolean) =>
  Array.from(container.querySelectorAll('button')).find((button) => matcher(button.textContent ?? ''))

const listRow = {
  id: 42,
  name: 'compact row',
  platform: 'openai',
  type: 'oauth',
  status: 'active',
  schedulable: true,
  concurrency: 2,
  priority: 1,
  group_ids: [7],
  extra: {},
  credentials: {}
}

const fullAccount = {
  ...listRow,
  groups: [{ id: 7, name: 'codex', platform: 'openai' }],
  account_groups: [{ account_id: 42, group_id: 7 }],
  credentials: { api_key: 'redacted' },
  extra: { detail_only: true }
}

describe('admin AccountsView lite account list', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCaptured()
    listAccounts.mockReset().mockResolvedValue({ items: [listRow], total: 1, page: 1, page_size: 20, pages: 1 })
    listWithEtag.mockReset().mockResolvedValue({ notModified: true, etag: 'compact-etag', data: null })
    getById.mockReset().mockResolvedValue(fullAccount)
    getBatchTodayStats.mockReset().mockResolvedValue({ stats: {} })
    getUpstreamBillingProbeSettings.mockReset().mockResolvedValue({ enabled: true })
    getAllProxies.mockReset().mockResolvedValue([])
    getAllGroups.mockReset().mockResolvedValue([{ id: 7, name: 'codex', platform: 'openai' }])
    refreshCredentials.mockReset()
    app.showError.mockReset()
    app.showWarning.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps lite=1 on the initial list request', async () => {
    await mountView()

    expect(listAccounts).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ lite: '1' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('maps group_ids through the group catalog for the table cell', async () => {
    const { container } = await mountView()

    expect(container.querySelector('[data-test="account-groups"]')?.textContent).toBe('codex')
  })

  it('keeps the action menu open during internal scrolling but closes it on table scrolling', async () => {
    const { container } = await mountView()

    const trigger = buttonByText(container, (text) => text === 'common.more')!
    await act(async () => {
      fireEvent.click(trigger)
    })
    const menu = document.body.querySelector('.action-menu-content')!
    await act(async () => {
      menu.dispatchEvent(new Event('scroll'))
    })
    expect(captured.AccountActionMenu.show).toBe(true)

    await act(async () => {
      menu.querySelector('button')!.dispatchEvent(new Event('scroll'))
    })
    expect(captured.AccountActionMenu.show).toBe(true)

    await act(async () => {
      container.querySelector('[data-test="data-table"]')!.dispatchEvent(new Event('scroll'))
    })
    expect(captured.AccountActionMenu.show).toBe(false)
  })

  it('keeps lite=1 on automatic ETag refreshes', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    localStorage.setItem('account-auto-refresh', JSON.stringify({ enabled: true, interval_seconds: 5 }))
    await mountView()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    await flushPromises()

    expect(listWithEtag).toHaveBeenCalledWith(1, 20, expect.objectContaining({ lite: '1' }), expect.objectContaining({ etag: null }))
  })

  it('loads the full account by id before opening edit, test, and stats actions', async () => {
    const { container } = await mountView()

    const editButton = buttonByText(container, (text) => text.includes('common.edit'))
    expect(editButton).toBeTruthy()
    await act(async () => {
      fireEvent.click(editButton!)
    })
    await flushPromises()
    expect(getById).toHaveBeenCalledWith(42)
    expect(container.querySelector('[data-test="edit-account"]')?.textContent).toBe('compact row')

    await act(async () => {
      captured.AccountActionMenu.onTest(listRow)
    })
    await flushPromises()
    expect(getById).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-test="test-account"]')?.textContent).toBe('compact row')

    await act(async () => {
      captured.AccountActionMenu.onStats(listRow)
    })
    await flushPromises()
    expect(getById).toHaveBeenCalledTimes(3)
    expect(container.querySelector('[data-test="stats-account"]')?.textContent).toBe('compact row')
  })

  it('shows the warning and patches the account after a partial Antigravity refresh', async () => {
    refreshCredentials.mockResolvedValue({
      account: { ...fullAccount, name: 'refreshed account' },
      message: 'Token refreshed, but project_id is temporarily unavailable',
      warning: 'missing_project_id_temporary'
    })
    const { container } = await mountView()

    await act(async () => {
      captured.AccountActionMenu.onRefreshToken(listRow)
    })
    await flushPromises()

    expect(refreshCredentials).toHaveBeenCalledWith(42)
    expect(container.querySelector('[data-account-name]')?.getAttribute('data-account-name')).toBe('refreshed account')
    expect(app.showWarning).toHaveBeenCalledWith('Token refreshed, but project_id is temporarily unavailable')
  })

  it('shows an error and keeps the modal closed when detail loading fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    getById.mockRejectedValueOnce(new Error('detail failed'))
    const { container } = await mountView()

    const editButton = buttonByText(container, (text) => text.includes('common.edit'))
    await act(async () => {
      fireEvent.click(editButton!)
    })
    await flushPromises()

    expect(app.showError).toHaveBeenCalledWith('detail failed')
    expect(container.querySelector('[data-test="edit-account"]')?.textContent).toBe('')
    consoleError.mockRestore()
  })
})
