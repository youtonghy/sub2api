import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountsView from '../AccountsView'
import { app, captured, resetCaptured } from './accountsViewHarness'

const {
  listAccounts,
  listWithEtag,
  getUpstreamBillingRatesWithEtag,
  getBatchTodayStats,
  getUpstreamBillingProbeSettings,
  getAllProxies,
  getAllGroups,
  probeUpstreamBilling,
  probeUpstreamBillingBatch,
  tableMode
} = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listWithEtag: vi.fn(),
  getUpstreamBillingRatesWithEtag: vi.fn(),
  getBatchTodayStats: vi.fn(),
  getUpstreamBillingProbeSettings: vi.fn(),
  getAllProxies: vi.fn(),
  getAllGroups: vi.fn(),
  probeUpstreamBilling: vi.fn(),
  probeUpstreamBillingBatch: vi.fn(),
  // Vue 版各用例挂载不同的 DataTable 替身；这里由用例切换替身模式
  tableMode: { current: 'default' as 'default' | 'upstream' | 'probe' }
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      list: listAccounts,
      listWithEtag,
      getUpstreamBillingRatesWithEtag,
      getBatchTodayStats,
      getUpstreamBillingProbeSettings,
      delete: vi.fn(),
      batchClearError: vi.fn(),
      batchRefresh: vi.fn(),
      probeUpstreamBilling,
      probeUpstreamBillingBatch,
      toggleSchedulable: vi.fn()
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
    BulkEditAccountModal: (props: any) => (
      <div data-test="bulk-edit-modal" data-show={String(props.show)} data-target-mode={props.target?.mode ?? ''} />
    )
  })
)
vi.mock('@/components/account/AccountCapacityCell', async () => (await import('./accountsViewHarness')).stubModule('AccountCapacityCell'))
vi.mock('@/components/account/AccountGroupsCell', async () => (await import('./accountsViewHarness')).stubModule('AccountGroupsCell'))
vi.mock('@/components/account/AccountSortOrderModal', async () => (await import('./accountsViewHarness')).stubModule('AccountSortOrderModal'))
vi.mock('@/components/account/AccountStatusIndicator', async () => (await import('./accountsViewHarness')).stubModule('AccountStatusIndicator'))
vi.mock('@/components/account/AccountTodayStatsCell', async () => (await import('./accountsViewHarness')).stubModule('AccountTodayStatsCell'))
vi.mock('@/components/account/AccountUsageCell', async () => (await import('./accountsViewHarness')).stubModule('AccountUsageCell'))
// upstream 模式下渲染全局探测开关；probe 模式下使用真实单元格（含探测按钮）
vi.mock('@/components/account/UpstreamBillingRateCell', async (importOriginal) => {
  const harness = await import('./accountsViewHarness')
  const actual = await importOriginal<typeof import('@/components/account/UpstreamBillingRateCell')>()
  const Real = actual.default
  return {
    default: harness.capturing('UpstreamBillingRateCell', (props: any) =>
      tableMode.current === 'probe' ? (
        <Real {...props} />
      ) : (
        <span data-test="upstream-billing-cell" data-global-enabled={String(props.globalProbeEnabled)} />
      )
    )
  }
})
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
      <button data-test="edit-filtered" onClick={() => props.onEditFiltered?.()}>edit filtered</button>
      <button data-test="probe-upstream-billing" onClick={() => props.onProbeUpstreamBilling?.()}>probe</button>
    </div>
  ))
)
vi.mock('@/components/admin/account/AccountTableFilters', async () => (await import('./accountsViewHarness')).stubModule('AccountTableFilters'))
vi.mock('@/components/admin/account/AccountActionMenu', async () => (await import('./accountsViewHarness')).stubModule('AccountActionMenu'))
vi.mock('@/components/auth/TotpStepUpDialog', async () => (await import('./accountsViewHarness')).stubModule('TotpStepUpDialog'))
vi.mock('@/components/common/ConfirmDialog', async () => ({ default: (await import('./accountsViewHarness')).ConfirmDialogStub }))
vi.mock('@/components/common/Pagination', async () =>
  (await import('./accountsViewHarness')).stubModule('Pagination', (props: any) => (
    <button data-test="next-page" onClick={() => props.onPageChange?.(2)}>next</button>
  ))
)
vi.mock('@/components/common/PlatformTypeBadge', async () => (await import('./accountsViewHarness')).platformTypeBadgeModule())
vi.mock('@/components/common/HelpTooltip', async () => (await import('./accountsViewHarness')).plainHelpTooltipModule())
vi.mock('@/components/common/DataTable', async () => {
  const harness = await import('./accountsViewHarness')
  const DefaultTable = harness.makeDataTableStub({
    columnKeys: 'column-key',
    cells: [['select', 'select-row'], 'created_at', ['rate_multiplier', 'account-rate']]
  })
  const UpstreamTable = harness.makeDataTableStub({ cells: ['upstream_billing_rate'] })
  const ProbeTable = harness.makeDataTableStub({ cells: [['rate_multiplier', 'account-rate'], 'upstream_billing_rate'] })
  return {
    default: (props: any) =>
      tableMode.current === 'upstream' ? (
        <UpstreamTable {...props} />
      ) : tableMode.current === 'probe' ? (
        <ProbeTable {...props} />
      ) : (
        <DefaultTable {...props} />
      )
  }
})

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

const selectFirstRow = async (container: HTMLElement) => {
  await click(container.querySelector('[data-test="select-row"] [role="checkbox"]')!)
}

describe('admin AccountsView bulk edit scope', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCaptured()
    tableMode.current = 'default'

    listAccounts.mockReset()
    listWithEtag.mockReset()
    getUpstreamBillingRatesWithEtag.mockReset()
    getBatchTodayStats.mockReset()
    getUpstreamBillingProbeSettings.mockReset()
    getAllProxies.mockReset()
    getAllGroups.mockReset()
    probeUpstreamBilling.mockReset()
    probeUpstreamBillingBatch.mockReset()
    app.showError.mockReset()
    app.showSuccess.mockReset()

    listAccounts.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, pages: 0 })
    listWithEtag.mockResolvedValue({ notModified: true, etag: null, data: null })
    getUpstreamBillingRatesWithEtag.mockResolvedValue({ notModified: true, etag: null, data: null })
    getBatchTodayStats.mockResolvedValue({ stats: {} })
    getUpstreamBillingProbeSettings.mockResolvedValue({ enabled: true, interval_minutes: 30 })
    getAllProxies.mockResolvedValue([])
    getAllGroups.mockResolvedValue([])
    probeUpstreamBilling.mockResolvedValue({})
    probeUpstreamBillingBatch.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens bulk edit in filtered-results mode from the bulk actions dropdown', async () => {
    const { container } = await mountView()
    await click(container.querySelector('[data-test="edit-filtered"]')!)
    await flushPromises()

    const modal = container.querySelector('[data-test="bulk-edit-modal"]')!
    expect(modal.getAttribute('data-show')).toBe('true')
    expect(modal.getAttribute('data-target-mode')).toBe('filtered')
  })

  it('renders the created_at column by default', async () => {
    listAccounts.mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'test-account',
          platform: 'anthropic',
          type: 'oauth',
          status: 'active',
          schedulable: true,
          created_at: '2026-03-07T10:00:00Z',
          updated_at: '2026-03-07T10:00:00Z'
        }
      ],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1
    })

    const { container } = await mountView()

    const columnKeys = Array.from(container.querySelectorAll('[data-test="column-key"]')).map((node) => node.textContent)
    expect(columnKeys).toContain('created_at')
    const columns = captured.DataTable.columns as Array<{ key: string; label: string; sortable: boolean }>
    expect(columns.find((column) => column.key === 'created_at')).toMatchObject({
      label: 'admin.accounts.columns.createdAt',
      sortable: true
    })
  })

  it('passes the loaded global probe state to every upstream billing cell', async () => {
    tableMode.current = 'upstream'
    listAccounts.mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'upstream',
          platform: 'openai',
          type: 'apikey',
          status: 'active',
          schedulable: true,
          created_at: '2026-07-13T00:00:00Z',
          updated_at: '2026-07-13T00:00:00Z'
        }
      ],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1
    })
    getUpstreamBillingProbeSettings.mockResolvedValue({ enabled: false, interval_minutes: 30 })

    const { container } = await mountView()

    expect(getUpstreamBillingProbeSettings).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-test="upstream-billing-cell"]')?.getAttribute('data-global-enabled')).toBe('false')
  })

  it('submits selected account IDs from every page for backend eligibility checks', async () => {
    const account = (id: number) => ({
      id,
      name: `account-${id}`,
      platform: 'openai',
      type: 'apikey',
      status: 'active',
      schedulable: true,
      created_at: '2026-07-13T00:00:00Z',
      updated_at: '2026-07-13T00:00:00Z'
    })
    listAccounts
      .mockResolvedValueOnce({ items: [account(7)], total: 2, page: 1, page_size: 1, pages: 2 })
      .mockResolvedValueOnce({ items: [account(11)], total: 2, page: 2, page_size: 1, pages: 2 })

    const { container } = await mountView()
    await selectFirstRow(container)
    await click(container.querySelector('[data-test="next-page"]')!)
    await flushPromises()
    await selectFirstRow(container)
    await click(container.querySelector('[data-test="probe-upstream-billing"]')!)
    await flushPromises()

    expect(probeUpstreamBillingBatch).toHaveBeenCalledWith([7, 11])
  })

  it('updates the current page locally after a batch probe', async () => {
    const account = (id: number, rateMultiplier: number) => ({
      id,
      name: `account-${id}`,
      platform: 'openai',
      type: 'apikey',
      status: 'active',
      schedulable: true,
      rate_multiplier: rateMultiplier,
      created_at: '2026-07-13T00:00:00Z',
      updated_at: '2026-07-13T00:00:00Z'
    })
    listAccounts
      .mockResolvedValueOnce({ items: [account(7, 0.25)], total: 2, page: 1, page_size: 1, pages: 2 })
      .mockResolvedValueOnce({ items: [account(11, 0.25)], total: 2, page: 2, page_size: 1, pages: 2 })
      .mockResolvedValueOnce({ items: [account(11, 0.065)], total: 2, page: 2, page_size: 1, pages: 2 })
    probeUpstreamBillingBatch.mockResolvedValue([
      {
        account_id: 11,
        snapshot: {
          status: 'ok',
          data: { effective_rate_multiplier: 0.065 },
          synced_rate_multiplier: 0.065,
          last_attempt_at: '2026-07-13T00:00:00Z',
          next_probe_at: '2026-07-13T00:30:00Z'
        }
      }
    ])

    const { container } = await mountView()
    await click(container.querySelector('[data-test="next-page"]')!)
    await flushPromises()
    await selectFirstRow(container)
    await click(container.querySelector('[data-test="probe-upstream-billing"]')!)
    await flushPromises()

    expect(probeUpstreamBillingBatch).toHaveBeenCalledWith([11])
    expect(listAccounts).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-test="account-rate"]')?.textContent).toBe('0.065x')
  })

  it('does not report a successful batch probe as failed when reconciliation is skipped', async () => {
    const account = {
      id: 7,
      name: 'account-7',
      platform: 'openai',
      type: 'apikey',
      status: 'active',
      schedulable: true,
      rate_multiplier: 0.25,
      created_at: '2026-07-13T00:00:00Z',
      updated_at: '2026-07-13T00:00:00Z'
    }
    listAccounts.mockResolvedValueOnce({ items: [account], total: 1, page: 1, page_size: 20, pages: 1 })
    probeUpstreamBillingBatch.mockResolvedValue([
      {
        account_id: 7,
        snapshot: {
          status: 'ok',
          data: { effective_rate_multiplier: 0.065 },
          last_attempt_at: '2026-07-13T00:00:00Z',
          next_probe_at: '2026-07-13T00:30:00Z'
        }
      }
    ])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { container } = await mountView()
    await selectFirstRow(container)
    await click(container.querySelector('[data-test="probe-upstream-billing"]')!)
    await flushPromises()

    expect(app.showError).not.toHaveBeenCalled()
    expect(app.showSuccess).toHaveBeenCalledWith('admin.accounts.upstreamBilling.batchCompleted')
    consoleError.mockRestore()
  })

  it('updates the account row after a successful single-account probe', async () => {
    tableMode.current = 'probe'
    const account = (rateMultiplier: number) => ({
      id: 7,
      name: 'account-7',
      platform: 'openai',
      type: 'apikey',
      status: 'active',
      schedulable: true,
      rate_multiplier: rateMultiplier,
      extra: { upstream_billing_probe_enabled: true },
      created_at: '2026-07-13T00:00:00Z',
      updated_at: '2026-07-13T00:00:00Z'
    })
    listAccounts
      .mockResolvedValueOnce({ items: [account(0.25)], total: 1, page: 1, page_size: 20, pages: 1 })
      .mockResolvedValueOnce({ items: [account(0.065)], total: 1, page: 1, page_size: 20, pages: 1 })
    probeUpstreamBilling.mockResolvedValue({
      account_id: 7,
      snapshot: {
        status: 'ok',
        data: { effective_rate_multiplier: 0.065 },
        synced_rate_multiplier: 0.065,
        last_attempt_at: '2026-07-13T00:00:00Z',
        next_probe_at: '2026-07-13T00:30:00Z'
      }
    })

    const { container } = await mountView()
    await click(container.querySelector('[data-testid="upstream-billing-probe"]')!)
    await flushPromises()

    expect(probeUpstreamBilling).toHaveBeenCalledWith(7)
    expect(listAccounts).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-test="account-rate"]')?.textContent).toBe('0.065x')
  })
})
