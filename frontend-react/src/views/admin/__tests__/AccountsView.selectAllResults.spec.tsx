import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountsView from '../AccountsView'
import { app, captured, resetCaptured } from './accountsViewHarness'

const { listAccounts, listWithEtag, batchRefresh, getBatchTodayStats, getUpstreamBillingProbeSettings, getAllProxies, getAllGroups } =
  vi.hoisted(() => ({
    listAccounts: vi.fn(),
    listWithEtag: vi.fn(),
    batchRefresh: vi.fn(),
    getBatchTodayStats: vi.fn(),
    getUpstreamBillingProbeSettings: vi.fn(),
    getAllProxies: vi.fn(),
    getAllGroups: vi.fn()
  }))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      list: listAccounts,
      listWithEtag,
      getBatchTodayStats,
      getUpstreamBillingProbeSettings,
      batchDelete: vi.fn(),
      batchClearError: vi.fn(),
      batchRefresh,
      bulkUpdate: vi.fn()
    },
    proxies: { getAll: getAllProxies },
    groups: { getAll: getAllGroups }
  }
}))

vi.mock('@/i18n/useI18n', async () => (await import('./accountsViewHarness')).i18nModule())
vi.mock('@/stores/app', async () => (await import('./accountsViewHarness')).appStoreModule())
vi.mock('@/stores/auth', async () => (await import('./accountsViewHarness')).authStoreModule())
vi.mock('@/components/account', async () => (await import('./accountsViewHarness')).accountBarrelModule())
vi.mock('@/components/account/AccountCapacityCell', async () => (await import('./accountsViewHarness')).stubModule('AccountCapacityCell'))
vi.mock('@/components/account/AccountGroupsCell', async () => (await import('./accountsViewHarness')).stubModule('AccountGroupsCell'))
vi.mock('@/components/account/AccountSortOrderModal', async () => (await import('./accountsViewHarness')).stubModule('AccountSortOrderModal'))
vi.mock('@/components/account/AccountStatusIndicator', async () => (await import('./accountsViewHarness')).stubModule('AccountStatusIndicator'))
vi.mock('@/components/account/AccountTodayStatsCell', async () => (await import('./accountsViewHarness')).stubModule('AccountTodayStatsCell'))
vi.mock('@/components/account/AccountUsageCell', async () => (await import('./accountsViewHarness')).stubModule('AccountUsageCell'))
vi.mock('@/components/account/UpstreamBillingRateCell', async () => (await import('./accountsViewHarness')).stubModule('UpstreamBillingRateCell'))
vi.mock('@/components/admin/ErrorPassthroughRulesModal', async () => (await import('./accountsViewHarness')).stubModule('ErrorPassthroughRulesModal'))
vi.mock('@/components/admin/TLSFingerprintProfilesModal', async () => (await import('./accountsViewHarness')).stubModule('TLSFingerprintProfilesModal'))
vi.mock('@/components/admin/account/AccountModelTestPanel', async () => (await import('./accountsViewHarness')).stubModule('AccountModelTestPanel'))
vi.mock('@/components/admin/account/AccountStatsModal', async () => (await import('./accountsViewHarness')).stubModule('AccountStatsModal'))
vi.mock('@/components/admin/account/AccountTestModal', async () => (await import('./accountsViewHarness')).stubModule('AccountTestModal'))
vi.mock('@/components/admin/account/ImportDataModal', async () => (await import('./accountsViewHarness')).stubModule('ImportDataModal'))
vi.mock('@/components/admin/account/ReAuthAccountModal', async () => (await import('./accountsViewHarness')).stubModule('ReAuthAccountModal'))
vi.mock('@/components/admin/account/ScheduledTestsPanel', async () => (await import('./accountsViewHarness')).stubModule('ScheduledTestsPanel'))
vi.mock('@/components/admin/account/AccountBulkActionsBar', async () =>
  (await import('./accountsViewHarness')).stubModule('AccountBulkActionsBar', (props: any) => (
    <div>
      <span data-test="selected-count">{props.selectedIds.length}</span>
      <span data-test="total-results">{props.totalResults}</span>
      <span data-test="all-results-selected">{String(props.allResultsSelected)}</span>
      <button data-test="select-page" onClick={() => props.onSelectPage?.()}>select page</button>
      <button data-test="select-all-results" onClick={() => props.onSelectAllResults?.()}>select all</button>
      <button data-test="clear" onClick={() => props.onClear?.()}>clear</button>
      <button data-test="refresh-token" onClick={() => props.onRefreshToken?.()}>refresh token</button>
    </div>
  ))
)
vi.mock('@/components/admin/account/AccountTableFilters', async () =>
  (await import('./accountsViewHarness')).stubModule('AccountTableFilters', (props: any) => (
    <button data-test="change-filter" onClick={() => props.onChange?.()}>change filter</button>
  ))
)
vi.mock('@/components/admin/account/AccountActionMenu', async () => (await import('./accountsViewHarness')).stubModule('AccountActionMenu'))
vi.mock('@/components/auth/TotpStepUpDialog', async () => (await import('./accountsViewHarness')).stubModule('TotpStepUpDialog'))
vi.mock('@/components/common/ConfirmDialog', async () => ({ default: (await import('./accountsViewHarness')).ConfirmDialogStub }))
vi.mock('@/components/common/Pagination', async () => (await import('./accountsViewHarness')).stubModule('Pagination'))
vi.mock('@/components/common/PlatformTypeBadge', async () => (await import('./accountsViewHarness')).platformTypeBadgeModule())
vi.mock('@/components/common/HelpTooltip', async () => (await import('./accountsViewHarness')).plainHelpTooltipModule())
vi.mock('@/components/common/DataTable', async () => ({
  default: (await import('./accountsViewHarness')).makeDataTableStub({ cells: ['select'] })
}))

const flushPromises = () => act(async () => {})

const mountView = async () => {
  const view = render(<AccountsView />)
  await flushPromises()
  return view
}

const click = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element)
  })
}

const makeAccounts = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `account-${index + 1}`,
    platform: 'grok',
    type: 'oauth',
    status: 'active',
    schedulable: true,
    created_at: '2026-07-23T00:00:00Z',
    updated_at: '2026-07-23T00:00:00Z'
  }))

describe('admin AccountsView select all filtered results', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCaptured()
    listAccounts.mockReset()
    listWithEtag.mockReset()
    batchRefresh.mockReset()
    getBatchTodayStats.mockReset()
    getUpstreamBillingProbeSettings.mockReset()
    getAllProxies.mockReset()
    getAllGroups.mockReset()
    app.showError.mockReset()

    listWithEtag.mockResolvedValue({
      notModified: true,
      etag: null,
      data: null
    })
    getBatchTodayStats.mockResolvedValue({ stats: {} })
    getUpstreamBillingProbeSettings.mockResolvedValue({ enabled: true, interval_minutes: 30 })
    getAllProxies.mockResolvedValue([])
    getAllGroups.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each([
    {
      name: 'keeps only failed accounts selected',
      result: { total: 3, success: 2, failed: 1, errors: [{ account_id: 2, error: 'no refresh token available' }] },
      expectedIds: [2]
    },
    { name: 'clears the selection after every account succeeds', result: { total: 3, success: 3, failed: 0 }, expectedIds: [] },
    { name: 'keeps the original selection when failure details are missing', result: { total: 3, success: 2, failed: 1 }, expectedIds: [1, 2, 3] }
  ])('$name after a batch token refresh and table reload', async ({ result, expectedIds }) => {
    listAccounts.mockResolvedValue({ items: makeAccounts(3), total: 3, page: 1, page_size: 20, pages: 1 })
    batchRefresh.mockResolvedValue(result)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = await mountView()
    await click(container.querySelector('[data-test="select-page"]')!)
    await click(container.querySelector('[data-test="refresh-token"]')!)
    await flushPromises()

    expect(batchRefresh).toHaveBeenCalledWith([1, 2, 3])
    expect(listAccounts).toHaveBeenCalledTimes(2)
    expect(captured.AccountBulkActionsBar.selectedIds).toEqual(expectedIds)
    // Arc 勾选框是 role=checkbox 的按钮，用 aria-checked 表示选中
    expect(
      Array.from(container.querySelectorAll('[data-test="data-table"] [role="checkbox"]')).map(
        (checkbox) => checkbox.getAttribute('aria-checked') === 'true'
      )
    ).toEqual([1, 2, 3].map((id) => expectedIds.includes(id)))
    if (result.failed > 0) {
      expect(app.showError).toHaveBeenCalledWith('admin.accounts.bulkActions.partialSuccess')
      await click(container.querySelector('[data-test="refresh-token"]')!)
      await flushPromises()
      expect(batchRefresh).toHaveBeenLastCalledWith(expectedIds)
    }
  })

  it('selects all matching IDs in one commit and clears the selection when filters change', async () => {
    const allAccounts = makeAccounts(45)
    listAccounts.mockImplementation(async (_page: number, pageSize: number) => {
      if (pageSize === 1000) {
        return { items: allAccounts, total: 45, page: 1, page_size: 1000, pages: 1 }
      }
      return { items: allAccounts.slice(0, 20), total: 45, page: 1, page_size: 20, pages: 3 }
    })

    const { container } = await mountView()

    await click(container.querySelector('[data-test="select-all-results"]')!)
    await flushPromises()

    expect(container.querySelector('[data-test="selected-count"]')?.textContent).toBe('45')
    expect(container.querySelector('[data-test="total-results"]')?.textContent).toBe('45')
    expect(container.querySelector('[data-test="all-results-selected"]')?.textContent).toBe('true')
    expect(listAccounts).toHaveBeenCalledWith(1, 1000, expect.objectContaining({ lite: '1', include_scheduler_score: '0' }))

    await click(container.querySelector('[data-test="change-filter"]')!)

    expect(container.querySelector('[data-test="selected-count"]')?.textContent).toBe('0')
    expect(container.querySelector('[data-test="all-results-selected"]')?.textContent).toBe('false')
  })

  it('keeps the original page selection when loading all results fails', async () => {
    const currentPage = makeAccounts(20)
    listAccounts.mockImplementation(async (_page: number, pageSize: number) => {
      if (pageSize === 1000) {
        throw new Error('load all failed')
      }
      return { items: currentPage, total: 45, page: 1, page_size: 20, pages: 3 }
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { container } = await mountView()

    await click(container.querySelector('[data-test="select-page"]')!)
    expect(container.querySelector('[data-test="selected-count"]')?.textContent).toBe('20')

    await click(container.querySelector('[data-test="select-all-results"]')!)
    await flushPromises()

    expect(container.querySelector('[data-test="selected-count"]')?.textContent).toBe('20')
    expect(container.querySelector('[data-test="all-results-selected"]')?.textContent).toBe('false')
    expect(app.showError).toHaveBeenCalledWith('admin.accounts.bulkActions.selectAllFailed')
  })
})
