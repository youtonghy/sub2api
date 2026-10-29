import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountsView from '../AccountsView'
import { captured, resetCaptured } from './accountsViewHarness'

const { listAccounts, listWithEtag, getBatchTodayStats, getAllProxies, getAllGroups } = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listWithEtag: vi.fn(),
  getBatchTodayStats: vi.fn(),
  getAllProxies: vi.fn(),
  getAllGroups: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      list: listAccounts,
      listWithEtag,
      getBatchTodayStats,
      getUpstreamBillingProbeSettings: vi.fn().mockResolvedValue({ enabled: true, interval_minutes: 30 }),
      delete: vi.fn(),
      batchClearError: vi.fn(),
      batchRefresh: vi.fn(),
      toggleSchedulable: vi.fn()
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
vi.mock('@/components/admin/account/AccountBulkActionsBar', async () => (await import('./accountsViewHarness')).stubModule('AccountBulkActionsBar'))
vi.mock('@/components/admin/account/AccountTableFilters', async () =>
  (await import('./accountsViewHarness')).stubModule('AccountTableFilters', (props: any) => (
    <div data-test="account-filters" data-group-count={props.groups.length} />
  ))
)
vi.mock('@/components/admin/account/AccountActionMenu', async () => (await import('./accountsViewHarness')).stubModule('AccountActionMenu'))
vi.mock('@/components/auth/TotpStepUpDialog', async () => (await import('./accountsViewHarness')).stubModule('TotpStepUpDialog'))
vi.mock('@/components/common/ConfirmDialog', async () => ({ default: (await import('./accountsViewHarness')).ConfirmDialogStub }))
vi.mock('@/components/common/Pagination', async () => (await import('./accountsViewHarness')).stubModule('Pagination'))
vi.mock('@/components/common/PlatformTypeBadge', async () => (await import('./accountsViewHarness')).platformTypeBadgeModule())
// Expose the content passed to HelpTooltip without dealing with its portal.
vi.mock('@/components/common/HelpTooltip', async () => (await import('./accountsViewHarness')).helpTooltipModule())
// Render the per-column header renderers so we can assert the usage-window header hint.
vi.mock('@/components/common/DataTable', async () => ({
  default: (await import('./accountsViewHarness')).makeDataTableStub({
    headers: { usage: 'usage-header', upstream_billing_rate: 'upstream-billing-header' },
    cells: [['rate_multiplier', 'account-rate']]
  })
}))

const flushPromises = () => act(async () => {})

const mountView = async () => {
  const view = render(<AccountsView />)
  await flushPromises()
  return view
}

describe('admin AccountsView usage windows hint', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCaptured()

    listAccounts.mockReset()
    listWithEtag.mockReset()
    getBatchTodayStats.mockReset()
    getAllProxies.mockReset()
    getAllGroups.mockReset()

    listAccounts.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, pages: 0 })
    listWithEtag.mockResolvedValue({ etag: null, data: null })
    getBatchTodayStats.mockResolvedValue({ stats: {} })
    getAllProxies.mockResolvedValue([])
    getAllGroups.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('keeps groups available when loading proxies fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getAllProxies.mockRejectedValue(new Error('proxy service unavailable'))
    getAllGroups.mockResolvedValue([{ id: 7, name: 'production' }])

    const { container } = await mountView()

    expect(container.querySelector('[data-test="account-filters"]')?.getAttribute('data-group-count')).toBe('1')
  })

  it('renders an explanatory tooltip next to the usage windows column header', async () => {
    const { container } = await mountView()

    const header = container.querySelector('[data-test="usage-header"]')
    expect(header).not.toBeNull()
    // Column label is still shown alongside the help icon.
    expect(header!.textContent).toContain('admin.accounts.columns.usageWindows')

    const hint = container.querySelector('[data-test="usage-windows-hint"]')
    expect(hint).not.toBeNull()
    expect(hint!.textContent).toBe('admin.accounts.usageWindowsHint')
  })

  it('keeps Ollama Cloud in the single usage column and ignores legacy column preferences', async () => {
    localStorage.setItem('account-hidden-columns', JSON.stringify(['ollama_cloud_usage']))
    await mountView()

    const columns = captured.DataTable.columns as Array<{ key: string }>
    expect(columns.filter((column) => column.key === 'usage')).toHaveLength(1)
    expect(columns.some((column) => column.key === 'ollama_cloud_usage')).toBe(false)
  })

  it('renders the upstream billing trust warning next to the declared-rate column', async () => {
    const { container } = await mountView()

    const header = container.querySelector('[data-test="upstream-billing-header"]')
    expect(header).not.toBeNull()
    expect(header!.textContent).toContain('admin.accounts.columns.upstreamBillingRate')
    expect(
      Array.from(container.querySelectorAll('[data-test="usage-windows-hint"]')).some(
        (node) => node.textContent === 'admin.accounts.upstreamBilling.trustWarning'
      )
    ).toBe(true)
    const columns = captured.DataTable.columns as Array<{ key: string; sortable: boolean }>
    expect(columns.find((column) => column.key === 'upstream_billing_rate')?.sortable).toBe(true)
  })

  it('shows account multipliers with enough precision to match declared rates', async () => {
    listAccounts.mockResolvedValueOnce({
      items: [
        {
          id: 7,
          name: 'precision-account',
          platform: 'gemini',
          type: 'apikey',
          status: 'active',
          rate_multiplier: 0.065,
          extra: {
            upstream_billing_probe_enabled: true,
            upstream_billing_rate_sync_enabled: true
          },
          created_at: '2026-07-13T00:00:00Z',
          updated_at: '2026-07-13T00:00:00Z'
        }
      ],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1
    })

    const { container } = await mountView()

    expect(container.querySelector('[data-test="account-rate"]')?.textContent).toBe('0.065x')
    const indicator = container.querySelector('[data-testid="account-rate-sync-indicator"]')
    expect(indicator?.getAttribute('title')).toBe('admin.accounts.upstreamBilling.syncedRateTooltip')
  })
})
