import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountsView from '../AccountsView'
import { resetCaptured } from './accountsViewHarness'

const { listAccounts } = vi.hoisted(() => ({
  listAccounts: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      list: listAccounts,
      listWithEtag: vi.fn(),
      getBatchTodayStats: vi.fn().mockResolvedValue({ stats: {} }),
      getUpstreamBillingProbeSettings: vi.fn().mockResolvedValue({ enabled: true, interval_minutes: 30 }),
      delete: vi.fn(),
      batchClearError: vi.fn(),
      batchRefresh: vi.fn(),
      toggleSchedulable: vi.fn()
    },
    proxies: { getAll: vi.fn().mockResolvedValue([]) },
    groups: { getAll: vi.fn().mockResolvedValue([]) }
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
vi.mock('@/components/admin/account/AccountBulkActionsBar', async () => (await import('./accountsViewHarness')).stubModule('AccountBulkActionsBar'))
vi.mock('@/components/admin/account/AccountTableFilters', async () => (await import('./accountsViewHarness')).stubModule('AccountTableFilters'))
vi.mock('@/components/admin/account/AccountActionMenu', async () => (await import('./accountsViewHarness')).stubModule('AccountActionMenu'))
vi.mock('@/components/auth/TotpStepUpDialog', async () => (await import('./accountsViewHarness')).stubModule('TotpStepUpDialog'))
vi.mock('@/components/common/ConfirmDialog', async () => ({ default: (await import('./accountsViewHarness')).ConfirmDialogStub }))
vi.mock('@/components/common/Pagination', async () => (await import('./accountsViewHarness')).stubModule('Pagination'))
vi.mock('@/components/common/PlatformTypeBadge', async () => (await import('./accountsViewHarness')).platformTypeBadgeModule())
vi.mock('@/components/common/HelpTooltip', async () => (await import('./accountsViewHarness')).plainHelpTooltipModule())
vi.mock('@/components/common/DataTable', async () => ({
  default: (await import('./accountsViewHarness')).makeDataTableStub({ columnKeys: 'data-column', sortButton: true })
}))

const flushPromises = () => act(async () => {})

const mountView = async () => {
  const view = render(<AccountsView />)
  await flushPromises()
  return view
}

describe('admin AccountsView priority column preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCaptured()
    listAccounts.mockReset().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
      pages: 0
    })
  })

  afterEach(() => cleanup())

  it('shows priority as a sortable column for fresh preferences', async () => {
    const { container } = await mountView()

    expect(container.querySelector('[data-column="priority"]')?.textContent).toBe('sortable')

    await act(async () => {
      fireEvent.click(container.querySelector('[data-test="sort-priority"]')!)
    })
    await flushPromises()

    expect(listAccounts).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ sort_by: 'priority', sort_order: 'desc' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('preserves an existing preference that explicitly hides priority', async () => {
    localStorage.setItem('account-hidden-columns', JSON.stringify(['priority', 'today_stats']))
    localStorage.setItem('account-hidden-columns-version', 'scheduler-score-hidden-by-default')

    const { container } = await mountView()

    expect(container.querySelector('[data-column="priority"]')).toBeNull()
    expect(JSON.parse(localStorage.getItem('account-hidden-columns') || '[]')).toEqual(['priority', 'today_stats'])
  })

  it('keeps priority visible while migrating older saved preferences', async () => {
    localStorage.setItem('account-hidden-columns', JSON.stringify(['today_stats']))

    const { container } = await mountView()

    expect(container.querySelector('[data-column="priority"]')?.textContent).toBe('sortable')
    expect(JSON.parse(localStorage.getItem('account-hidden-columns') || '[]')).toEqual(
      expect.arrayContaining(['today_stats', 'scheduler_score'])
    )
    expect(JSON.parse(localStorage.getItem('account-hidden-columns') || '[]')).not.toContain('priority')
  })
})
