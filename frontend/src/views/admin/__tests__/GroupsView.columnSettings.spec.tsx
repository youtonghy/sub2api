import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminGroup } from '@/types'
import GroupsView from '../GroupsView'
import { flushPromises } from './groupsViewHarness'

const {
  listGroups,
  getAllGroups,
  getModelAllowlistCandidates,
  getUsageSummary,
  getCapacitySummary,
  getLiveCapability,
  listAccounts,
  app,
  onboarding,
  authState
} = vi.hoisted(() => ({
  listGroups: vi.fn(),
  getAllGroups: vi.fn(),
  getModelAllowlistCandidates: vi.fn(),
  getUsageSummary: vi.fn(),
  getCapacitySummary: vi.fn(),
  getLiveCapability: vi.fn(),
  listAccounts: vi.fn(),
  app: { showError: vi.fn(), showSuccess: vi.fn() },
  onboarding: { isCurrentStep: vi.fn(), nextStep: vi.fn() },
  authState: { isSimpleMode: false }
}))

const messages: Record<string, string> = vi.hoisted(() => ({
  'admin.groups.columnSettings': 'Column Settings',
  'admin.groups.columns.name': 'Name',
  'admin.groups.columns.id': 'ID',
  'admin.groups.columns.platform': 'Platform',
  'admin.groups.columns.billingType': 'Billing Type',
  'admin.groups.columns.rateMultiplier': 'Rate Multiplier',
  'admin.groups.columns.type': 'Type',
  'admin.groups.columns.accounts': 'Accounts',
  'admin.groups.columns.capacity': 'Capacity',
  'admin.groups.columns.usage': 'Usage',
  'admin.groups.columns.status': 'Status',
  'admin.groups.columns.actions': 'Actions',
  'admin.groups.usageToday': 'Today',
  'admin.groups.usageYesterday': 'Yesterday',
  'admin.groups.usageTotal': 'Total'
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    groups: {
      list: listGroups,
      getAll: getAllGroups,
      getModelAllowlistCandidates,
      getUsageSummary,
      getCapacitySummary,
      getLiveCapability,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateSortOrder: vi.fn()
    },
    accounts: {
      list: listAccounts
    }
  }
}))

vi.mock('@/stores/app', async () => (await import('./groupsViewHarness')).storeModule('useAppStore', app))
vi.mock('@/stores/auth', async () => (await import('./groupsViewHarness')).storeModule('useAuthStore', authState))
vi.mock('@/stores/onboarding', async () =>
  (await import('./groupsViewHarness')).storeModule('useOnboardingStore', onboarding)
)
vi.mock('@/i18n/useI18n', async () => (await import('./groupsViewHarness')).i18nModule(messages))
vi.mock('@/components/common/DataTable', async () =>
  (await import('./groupsViewHarness')).makeDataTableModule({ firstRowCells: ['usage'] })
)
vi.mock('@/components/common/Select', async () => (await import('./groupsViewHarness')).selectModule())
vi.mock('@/components/common/Pagination', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/common/ConfirmDialog', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/common/GroupCapacityBadge', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupRateMultipliersModal', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupRPMOverridesModal', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupSortOrderModal', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupCompositeRoutesModal', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupFormDrawer', async () => (await import('./groupsViewHarness')).nullModule())

const createGroup = (overrides: Partial<AdminGroup> = {}): AdminGroup =>
  ({
    id: 1,
    name: 'Core Anthropic',
    description: null,
    platform: 'anthropic',
    rate_multiplier: 1,
    rpm_limit: 0,
    is_exclusive: false,
    status: 'active',
    subscription_type: 'standard',
    daily_limit_usd: null,
    weekly_limit_usd: null,
    monthly_limit_usd: null,
    allow_image_generation: false,
    image_rate_independent: false,
    image_rate_multiplier: 1,
    image_price_1k: null,
    image_price_2k: null,
    image_price_4k: null,
    claude_code_only: false,
    fallback_group_id: null,
    fallback_group_id_on_invalid_request: null,
    allow_messages_dispatch: false,
    default_mapped_model: '',
    messages_dispatch_model_config: undefined,
    require_oauth_only: false,
    require_privacy_set: false,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    model_routing: null,
    model_routing_enabled: false,
    mcp_xml_inject: true,
    supported_model_scopes: [],
    account_count: 3,
    active_account_count: 2,
    rate_limited_account_count: 1,
    model_allowlist: undefined,
    sort_order: 10,
    ...overrides
  }) as AdminGroup

const mountView = async () => {
  const view = render(<GroupsView />)
  await flushPromises()
  return view
}

const columnKeys = () =>
  (document.querySelector('[data-test="columns"]')?.textContent ?? '').split(',').filter(Boolean)

const openColumnSettings = async () => {
  fireEvent.click(document.querySelector('button[title="Column Settings"]')!)
  await flushPromises()
}

const clickColumnToggle = async (label: string) => {
  const button = Array.from(document.querySelectorAll('[role="menuitemcheckbox"]')).find((item) =>
    item.textContent?.includes(label)
  )
  expect(button, `column toggle ${label}`).toBeTruthy()
  fireEvent.click(button!)
  await flushPromises()
}

describe('admin GroupsView column settings', () => {
  beforeEach(() => {
    localStorage.clear()

    for (const fn of [
      listGroups,
      getAllGroups,
      getModelAllowlistCandidates,
      getUsageSummary,
      getCapacitySummary,
      getLiveCapability,
      listAccounts,
      app.showError,
      app.showSuccess,
      onboarding.isCurrentStep,
      onboarding.nextStep
    ]) {
      fn.mockReset()
    }
    authState.isSimpleMode = false

    listGroups.mockResolvedValue({ items: [createGroup()], total: 1, page: 1, page_size: 20, pages: 1 })
    getAllGroups.mockResolvedValue([])
    getModelAllowlistCandidates.mockResolvedValue([])
    getUsageSummary.mockResolvedValue([])
    getCapacitySummary.mockResolvedValue([])
    getLiveCapability.mockResolvedValue({ supported: false })
    listAccounts.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, pages: 0 })
    onboarding.isCurrentStep.mockReturnValue(false)
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('does not call advanced group APIs or expose the exclusive filter in simple mode', async () => {
    authState.isSimpleMode = true
    await mountView()

    expect(getLiveCapability).not.toHaveBeenCalled()
    expect(getModelAllowlistCandidates).not.toHaveBeenCalled()
    expect(getUsageSummary).not.toHaveBeenCalled()
    expect(getCapacitySummary).not.toHaveBeenCalled()
    expect(listGroups).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ is_exclusive: undefined }),
      expect.anything()
    )
    const optionLabels = Array.from(document.querySelectorAll('select option')).map((option) => option.textContent)
    expect(optionLabels).not.toContain('admin.groups.allGroups')
  })

  it('hides the id column by default while keeping other group columns visible', async () => {
    await mountView()

    expect(columnKeys()).toEqual([
      'name',
      'platform',
      'billing_type',
      'rate_multiplier',
      'is_exclusive',
      'account_count',
      'capacity',
      'usage',
      'status',
      'actions'
    ])
    expect(localStorage.getItem('group-hidden-columns')).toBe(JSON.stringify(['id']))
    expect(localStorage.getItem('group-column-settings-version')).toBe('2')
  })

  it('applies saved hidden columns on mount and ignores unknown keys', async () => {
    localStorage.setItem(
      'group-hidden-columns',
      JSON.stringify(['usage', 'capacity', 'removed_column', 'name', 'actions'])
    )
    localStorage.setItem('group-column-settings-version', '2')

    await mountView()

    expect(columnKeys()).toEqual([
      'name',
      'id',
      'platform',
      'billing_type',
      'rate_multiplier',
      'is_exclusive',
      'account_count',
      'status',
      'actions'
    ])
  })

  it('auto-hides id for existing saved column prefs after version bump', async () => {
    localStorage.setItem('group-hidden-columns', JSON.stringify(['usage']))
    // No version key → treated as version 1, migrate to 2 and hide id.

    await mountView()

    expect(columnKeys()).toEqual([
      'name',
      'platform',
      'billing_type',
      'rate_multiplier',
      'is_exclusive',
      'account_count',
      'capacity',
      'status',
      'actions'
    ])
    expect(JSON.parse(localStorage.getItem('group-hidden-columns')!)).toEqual(expect.arrayContaining(['usage', 'id']))
    expect(localStorage.getItem('group-column-settings-version')).toBe('2')
  })

  it('toggles a column and persists hidden column keys', async () => {
    await mountView()

    await openColumnSettings()
    await clickColumnToggle('Usage')

    expect(columnKeys()).toEqual([
      'name',
      'platform',
      'billing_type',
      'rate_multiplier',
      'is_exclusive',
      'account_count',
      'capacity',
      'status',
      'actions'
    ])
    expect(JSON.parse(localStorage.getItem('group-hidden-columns')!)).toEqual(expect.arrayContaining(['id', 'usage']))
  })

  it('can show the id column from column settings', async () => {
    await mountView()

    await openColumnSettings()
    await clickColumnToggle('ID')

    expect(columnKeys()).toEqual([
      'name',
      'id',
      'platform',
      'billing_type',
      'rate_multiplier',
      'is_exclusive',
      'account_count',
      'capacity',
      'usage',
      'status',
      'actions'
    ])
    expect(localStorage.getItem('group-hidden-columns')).toBe(JSON.stringify([]))
  })

  it('skips usage and capacity fetches until consuming columns are shown', async () => {
    localStorage.setItem('group-hidden-columns', JSON.stringify(['billing_type', 'usage', 'capacity']))

    await mountView()

    expect(getUsageSummary).not.toHaveBeenCalled()
    expect(getCapacitySummary).not.toHaveBeenCalled()

    await openColumnSettings()
    await clickColumnToggle('Usage')
    expect(getUsageSummary).toHaveBeenCalledTimes(1)
    expect(getUsageSummary).toHaveBeenCalledWith()
    expect(getCapacitySummary).not.toHaveBeenCalled()

    await clickColumnToggle('Capacity')
    expect(getUsageSummary).toHaveBeenCalledTimes(1)
    expect(getCapacitySummary).toHaveBeenCalledTimes(1)
  })

  it('renders yesterday usage between today and total', async () => {
    getUsageSummary.mockResolvedValue([{ group_id: 1, today_cost: 1.25, yesterday_cost: 2.5, total_cost: 9.75 }])

    await mountView()
    const text = document.querySelector('[data-test="cell-usage"]')!.textContent ?? ''

    expect(text).toContain('Today$1.25')
    expect(text).toContain('Yesterday$2.50')
    expect(text).toContain('Total$9.75')
    expect(text.indexOf('Today')).toBeLessThan(text.indexOf('Yesterday'))
    expect(text.indexOf('Yesterday')).toBeLessThan(text.indexOf('Total'))
  })
})

