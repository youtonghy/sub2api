import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountsView from '../AccountsView'
import { resetCaptured } from './accountsViewHarness'

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
vi.mock('@/components/admin/account/AccountTableFilters', async () => (await import('./accountsViewHarness')).stubModule('AccountTableFilters'))
vi.mock('@/components/admin/account/AccountActionMenu', async () => (await import('./accountsViewHarness')).stubModule('AccountActionMenu'))
vi.mock('@/components/auth/TotpStepUpDialog', async () => (await import('./accountsViewHarness')).stubModule('TotpStepUpDialog'))
vi.mock('@/components/common/ConfirmDialog', async () => ({ default: (await import('./accountsViewHarness')).ConfirmDialogStub }))
vi.mock('@/components/common/Pagination', async () => (await import('./accountsViewHarness')).stubModule('Pagination'))
vi.mock('@/components/common/PlatformTypeBadge', async () => (await import('./accountsViewHarness')).platformTypeBadgeModule())
vi.mock('@/components/common/HelpTooltip', async () => (await import('./accountsViewHarness')).plainHelpTooltipModule())
// Render the scheduler-score cell for every row so the fallback logic is observable.
vi.mock('@/components/common/DataTable', async () => ({
  default: (await import('./accountsViewHarness')).makeDataTableStub({
    cells: ['scheduler_score'],
    rowAttrs: (row) => ({ 'data-test': `scheduler-score-${row.id}` })
  })
}))

const flushPromises = () => act(async () => {})

const mountView = async () => {
  const view = render(<AccountsView />)
  await flushPromises()
  return view
}

const baseAccount = {
  platform: 'openai',
  type: 'apikey',
  status: 'active',
  schedulable: true,
  concurrency: 1,
  priority: 0,
  error_message: null,
  last_used_at: null,
  expires_at: null,
  auto_pause_on_expired: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
}

describe('admin AccountsView scheduler score column', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCaptured()

    listAccounts.mockReset()
    listWithEtag.mockReset()
    getBatchTodayStats.mockReset()
    getAllProxies.mockReset()
    getAllGroups.mockReset()

    listAccounts.mockResolvedValue({
      items: [
        {
          ...baseAccount,
          id: 1,
          name: 'ungrouped-openai',
          // 未分组账号：后端只返回基础分（scheduler_score），无分组维度分数
          scheduler_score: {
            base_score: 1.234567,
            sticky_score: 0,
            sticky_weighted_enabled: false
          }
        },
        {
          ...baseAccount,
          id: 2,
          name: 'grouped-openai',
          scheduler_score: {
            base_score: 2,
            sticky_score: 3,
            sticky_weighted_enabled: true
          },
          scheduler_scores: [
            {
              group_id: 5,
              group_name: 'group-five',
              base_score: 2,
              sticky_score: 3,
              sticky_weighted_enabled: true
            }
          ]
        },
        {
          ...baseAccount,
          id: 3,
          name: 'no-score',
          platform: 'anthropic'
        }
      ],
      total: 3,
      page: 1,
      page_size: 20,
      pages: 1
    })
    listWithEtag.mockResolvedValue({
      notModified: true,
      etag: null,
      data: null
    })
    getBatchTodayStats.mockResolvedValue({ stats: {} })
    getAllProxies.mockResolvedValue([])
    getAllGroups.mockResolvedValue([])
  })

  afterEach(() => cleanup())

  it('falls back to the base score for ungrouped accounts instead of showing a dash', async () => {
    const { container } = await mountView()

    expect(listAccounts.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ include_scheduler_score: '0' }))

    const ungroupedCell = container.querySelector('[data-test="scheduler-score-1"]')
    expect(ungroupedCell).not.toBeNull()
    expect(ungroupedCell!.textContent).toContain('1.234567')
    expect(ungroupedCell!.textContent).toContain('admin.accounts.schedulerScore.ungrouped')
    expect(ungroupedCell!.textContent).not.toBe('-')
  })

  it('renders per-group scores for grouped accounts', async () => {
    const { container } = await mountView()

    const groupedCell = container.querySelector('[data-test="scheduler-score-2"]')
    expect(groupedCell).not.toBeNull()
    expect(groupedCell!.textContent).toContain('group-five')
    expect(groupedCell!.textContent).toContain('2')
  })

  it('keeps scheduler score hidden for old saved column settings until the admin opts in again', async () => {
    localStorage.setItem('account-hidden-columns', JSON.stringify(['today_stats']))

    await mountView()

    expect(listAccounts.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ include_scheduler_score: '0' }))
    expect(JSON.parse(localStorage.getItem('account-hidden-columns') || '[]')).toContain('scheduler_score')
  })

  it('requests scheduler scores when the migrated column settings explicitly show the column', async () => {
    localStorage.setItem('account-hidden-columns', JSON.stringify(['today_stats']))
    localStorage.setItem('account-hidden-columns-version', 'scheduler-score-hidden-by-default')

    await mountView()

    expect(listAccounts.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ include_scheduler_score: '1' }))
  })

  it('still shows a dash when no scheduler score is available', async () => {
    const { container } = await mountView()

    const emptyCell = container.querySelector('[data-test="scheduler-score-3"]')
    expect(emptyCell).not.toBeNull()
    expect(emptyCell!.textContent).toBe('-')
  })
})
