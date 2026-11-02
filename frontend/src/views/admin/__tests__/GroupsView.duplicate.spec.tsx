import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { adminAPI } from '@/api/admin'
import type { AdminGroup } from '@/types'
import GroupsView from '../GroupsView'
import { buttonByText, drawerStub, flushPromises } from './groupsViewHarness'

const {
  listGroups,
  duplicateGroup,
  updateGroup,
  getModelAllowlistCandidates,
  getUsageSummary,
  getCapacitySummary,
  getLiveCapability,
  app,
  authState,
  onboarding
} = vi.hoisted(() => ({
  listGroups: vi.fn(),
  duplicateGroup: vi.fn(),
  updateGroup: vi.fn(),
  getModelAllowlistCandidates: vi.fn(),
  getUsageSummary: vi.fn(),
  getCapacitySummary: vi.fn(),
  getLiveCapability: vi.fn(),
  app: { showSuccess: vi.fn(), showError: vi.fn() },
  authState: { isSimpleMode: false },
  onboarding: { isCurrentStep: vi.fn(() => false), nextStep: vi.fn() }
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    groups: {
      list: listGroups,
      duplicate: duplicateGroup,
      getModelAllowlistCandidates,
      getUsageSummary,
      getCapacitySummary,
      getLiveCapability,
      getAll: vi.fn(),
      create: vi.fn(),
      update: updateGroup,
      delete: vi.fn(),
      updateSortOrder: vi.fn()
    },
    accounts: {
      list: vi.fn(),
      getById: vi.fn()
    }
  }
}))

vi.mock('@/stores/app', async () => (await import('./groupsViewHarness')).storeModule('useAppStore', app))
vi.mock('@/stores/auth', async () => (await import('./groupsViewHarness')).storeModule('useAuthStore', authState))
vi.mock('@/stores/onboarding', async () =>
  (await import('./groupsViewHarness')).storeModule('useOnboardingStore', onboarding)
)
vi.mock('@/i18n/useI18n', async () => (await import('./groupsViewHarness')).i18nModule())
vi.mock('@/components/common/DataTable', async () =>
  (await import('./groupsViewHarness')).makeDataTableModule({ rowCells: ['actions'] })
)
vi.mock('@/components/account/AccountFormLayout', async (importOriginal) =>
  (await import('./groupsViewHarness')).accountFormLayoutModule(importOriginal as never)
)
vi.mock('@/components/admin/channel/PricingEntryCard', async () =>
  (await import('./groupsViewHarness')).pricingEntryCardModule()
)
vi.mock('@/components/common/Select', async () => (await import('./groupsViewHarness')).selectModule())
vi.mock('@/components/common/Pagination', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/common/ConfirmDialog', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/common/GroupCapacityBadge', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupRateMultipliersModal', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupRPMOverridesModal', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupSortOrderModal', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupCompositeRoutesModal', async () => (await import('./groupsViewHarness')).nullModule())

const sourceGroup = {
  id: 42,
  name: 'Primary',
  description: null,
  platform: 'openai',
  rate_multiplier: 1,
  rpm_limit: 0,
  is_exclusive: false,
  status: 'active',
  subscription_type: 'standard',
  daily_limit_usd: null,
  weekly_limit_usd: null,
  monthly_limit_usd: null,
  allow_image_generation: false,
  allow_batch_image_generation: false,
  image_rate_independent: false,
  image_rate_multiplier: 1,
  batch_image_discount_multiplier: 0.5,
  batch_image_hold_multiplier: 0.6,
  image_price_1k: null,
  image_price_2k: null,
  image_price_4k: null,
  video_rate_independent: false,
  video_rate_multiplier: 1,
  video_price_480p: null,
  video_price_720p: null,
  video_price_1080p: null,
  web_search_price_per_call: null,
  peak_rate_enabled: false,
  peak_start: '',
  peak_end: '',
  peak_rate_multiplier: 1,
  claude_code_only: false,
  fallback_group_id: null,
  fallback_group_id_on_invalid_request: null,
  allow_messages_dispatch: false,
  default_mapped_model: '',
  messages_dispatch_model_config: undefined,
  require_oauth_only: false,
  require_privacy_set: false,
  created_at: '2026-07-16T00:00:00Z',
  updated_at: '2026-07-16T00:00:00Z',
  model_routing: null,
  model_routing_enabled: false,
  mcp_xml_inject: true,
  supported_model_scopes: [],
  account_count: 1,
  active_account_count: 1,
  rate_limited_account_count: 0,
  model_allowlist: undefined,
  sort_order: 10
} as unknown as AdminGroup

const mountView = () => render(<GroupsView />)
const editButton = () => buttonByText('common.edit')!
const submitEditForm = () => fireEvent.submit(document.querySelector('#edit-group-form')!)
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

describe('GroupsView duplicate action', () => {
  beforeEach(() => {
    authState.isSimpleMode = false
    localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const fn of [
      listGroups,
      duplicateGroup,
      updateGroup,
      getModelAllowlistCandidates,
      getUsageSummary,
      getCapacitySummary,
      getLiveCapability,
      app.showSuccess,
      app.showError
    ]) {
      fn.mockReset()
    }

    listGroups.mockResolvedValue({ items: [sourceGroup], total: 1, page: 1, page_size: 20, pages: 1 })
    duplicateGroup.mockResolvedValue({ ...sourceGroup, id: 43, name: 'Primary (Copy)', status: 'inactive' })
    getModelAllowlistCandidates.mockResolvedValue([])
    getUsageSummary.mockResolvedValue([])
    getCapacitySummary.mockResolvedValue([])
    getLiveCapability.mockResolvedValue({ supported: false })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('duplicates the selected group, reports success, and refreshes the list', async () => {
    mountView()
    await flushPromises()

    fireEvent.click(byTestId('group-duplicate')!)
    await flushPromises()

    expect(duplicateGroup).toHaveBeenCalledTimes(1)
    expect(duplicateGroup).toHaveBeenCalledWith(42)
    expect(app.showSuccess).toHaveBeenCalledWith('admin.groups.duplicateSuccess')
    expect(listGroups).toHaveBeenCalledTimes(2)
  })

  it('hides advanced group actions in simple mode', async () => {
    authState.isSimpleMode = true
    const compositeGroup = { ...sourceGroup, platform: 'composite' }
    listGroups.mockResolvedValueOnce({ items: [compositeGroup], total: 1, page: 1, page_size: 20, pages: 1 })
    mountView()
    await flushPromises()

    expect(byTestId('group-duplicate')).toBeNull()
    expect(byTestId('group-composite-routes')).toBeNull()
    expect(byTestId('group-rate-multipliers')).toBeNull()
    expect(byTestId('group-rpm-overrides')).toBeNull()
  })

  it('ignores repeated clicks while the duplicate request is in flight', async () => {
    let resolveDuplicate!: (value: AdminGroup) => void
    duplicateGroup.mockImplementationOnce(
      () =>
        new Promise<AdminGroup>((resolve) => {
          resolveDuplicate = resolve
        })
    )
    mountView()
    await flushPromises()

    const button = byTestId('group-duplicate')!
    fireEvent.click(button)
    fireEvent.click(button)
    await flushPromises()

    expect(duplicateGroup).toHaveBeenCalledTimes(1)
    expect(byTestId('group-duplicate')!.hasAttribute('disabled')).toBe(true)
    expect(byTestId('group-duplicate')!.getAttribute('title')).toBe('admin.groups.duplicating')

    await act(async () => {
      resolveDuplicate({ ...sourceGroup, id: 43, name: 'Primary (Copy)', status: 'inactive' })
    })
    await flushPromises()
    expect(byTestId('group-duplicate')!.hasAttribute('disabled')).toBe(false)
  })

  it('shows the API error and restores the action when duplication fails', async () => {
    duplicateGroup.mockRejectedValueOnce(new Error('duplicate failed'))
    mountView()
    await flushPromises()

    fireEvent.click(byTestId('group-duplicate')!)
    await flushPromises()

    expect(app.showError).toHaveBeenCalledWith('duplicate failed')
    expect(byTestId('group-duplicate')!.hasAttribute('disabled')).toBe(false)
  })

  it('does not report a successful duplicate as failed when the refresh fails', async () => {
    listGroups
      .mockResolvedValueOnce({ items: [sourceGroup], total: 1, page: 1, page_size: 20, pages: 1 })
      .mockRejectedValueOnce(new Error('refresh failed'))
    mountView()
    await flushPromises()

    fireEvent.click(byTestId('group-duplicate')!)
    await flushPromises()

    expect(app.showSuccess).toHaveBeenCalledWith('admin.groups.duplicateSuccess')
    expect(app.showError).toHaveBeenCalledWith('admin.groups.failedToLoad')
    expect(app.showError).not.toHaveBeenCalledWith('admin.groups.duplicateFailed')
  })

  it('shows the standardized API message when updating a group fails', async () => {
    updateGroup.mockRejectedValueOnce({
      status: 409,
      code: 409,
      message: 'group name already exists',
      reason: 'GROUP_EXISTS'
    })
    mountView()
    await flushPromises()

    expect(editButton()).toBeTruthy()
    fireEvent.click(editButton())
    await flushPromises()
    submitEditForm()
    await flushPromises()

    expect(updateGroup).toHaveBeenCalledTimes(1)
    expect(app.showError).toHaveBeenCalledWith('group name already exists')
  })

  it('keeps the edited group rendered while the edit drawer slides out, and reopening still submits it', async () => {
    drawerStub.renderWhileClosed = true
    try {
      mountView()
      await flushPromises()
      fireEvent.click(editButton())
      await flushPromises()

      const editDrawer = () => document.querySelector('#edit-group-form')?.closest<HTMLElement>('[data-drawer-open]') ?? null
      expect(editDrawer()?.dataset.drawerOpen).toBe('true')
      const cancel = Array.from(editDrawer()!.querySelectorAll('button')).find((button) => button.textContent === 'common.cancel')!
      fireEvent.click(cancel)
      await flushPromises()

      // 关闭后（滑出动画期间）表单仍保留最后一个分组的内容
      expect(editDrawer()?.dataset.drawerOpen).toBe('false')
      expect(document.querySelector<HTMLInputElement>('#edit-group-form input[value="Primary"]')).not.toBeNull()
      // 关闭期间提交不会生效：提交仍以当前编辑中的分组为准
      submitEditForm()
      await flushPromises()
      expect(updateGroup).not.toHaveBeenCalled()

      fireEvent.click(editButton())
      await flushPromises()
      expect(editDrawer()?.dataset.drawerOpen).toBe('true')
      submitEditForm()
      await flushPromises()
      expect(updateGroup).toHaveBeenCalledTimes(1)
      expect(updateGroup).toHaveBeenCalledWith(42, expect.objectContaining({ name: 'Primary' }))
    } finally {
      drawerStub.renderWhileClosed = false
    }
  })

  it('loads, edits, and saves custom reasoning multipliers for group pricing', async () => {
    const group = {
      ...sourceGroup,
      model_pricing: [
        {
          platform: 'openai',
          models: ['example-model'],
          billing_mode: 'token',
          input_price: 3e-6,
          output_price: 15e-6,
          cache_write_price: null,
          cache_read_price: null,
          image_input_price: null,
          image_output_price: null,
          per_request_price: null,
          reasoning_effort_multipliers: { high: 1.5, max: 3 },
          intervals: [],
          time_pricing: null
        }
      ]
    }
    listGroups.mockResolvedValue({ items: [group], total: 1, page: 1, page_size: 20, pages: 1 })
    updateGroup.mockResolvedValue(group)
    mountView()
    await flushPromises()
    fireEvent.click(editButton())
    await flushPromises()

    const input = (effort: string) => document.querySelector<HTMLInputElement>(`[data-reasoning-effort="${effort}"]`)!
    expect(input('high').value).toBe('1.5')
    fireEvent.change(input('high'), { target: { value: '0.5' } })
    fireEvent.change(input('max'), { target: { value: '' } })
    submitEditForm()
    await flushPromises()
    expect(updateGroup).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        model_pricing: [expect.objectContaining({ reasoning_effort_multipliers: { high: 0.5 } })]
      })
    )
  })

  it('blocks saving an invalid group reasoning multiplier and allows clearing it', async () => {
    const group = {
      ...sourceGroup,
      model_pricing: [
        {
          platform: 'openai',
          models: ['example-model'],
          billing_mode: 'token',
          input_price: 3e-6,
          output_price: 15e-6,
          cache_write_price: null,
          cache_read_price: null,
          image_input_price: null,
          image_output_price: null,
          per_request_price: null,
          reasoning_effort_multipliers: { high: 1.5 },
          intervals: [],
          time_pricing: null
        }
      ]
    }
    listGroups.mockResolvedValue({ items: [group], total: 1, page: 1, page_size: 20, pages: 1 })
    updateGroup.mockResolvedValue(group)
    mountView()
    await flushPromises()
    fireEvent.click(editButton())
    await flushPromises()

    fireEvent.change(document.querySelector('[data-reasoning-effort="high"]')!, { target: { value: '0' } })
    submitEditForm()
    expect(updateGroup).not.toHaveBeenCalled()
    expect(app.showError).toHaveBeenCalledWith(expect.stringContaining('reasoningEffortMultiplierPositive'))

    fireEvent.click(document.querySelector('[data-testid="reasoning-effort-multipliers"] button')!)
    submitEditForm()
    await flushPromises()
    expect(updateGroup).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        model_pricing: [expect.objectContaining({ reasoning_effort_multipliers: null })]
      })
    )
  })

  it('updates manifest controls immediately and submits the displayed selection', async () => {
    vi.useFakeTimers()
    vi.mocked(adminAPI.accounts.list).mockResolvedValue({ items: [{ id: 5, name: 'Manifest account' }] } as never)
    updateGroup.mockResolvedValue(sourceGroup)
    mountView()
    try {
      await flushPromises()
      fireEvent.click(editButton())
      await flushPromises()

      const toggle = () => byTestId('codex-manifest-toggle')!
      fireEvent.click(toggle())
      expect(toggle().getAttribute('aria-checked')).toBe('true')
      const search = () => byTestId('codex-manifest-search')!
      fireEvent.focus(search())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      await flushPromises()
      expect(adminAPI.accounts.list).toHaveBeenCalledWith(
        1,
        20,
        { search: '', platform: 'openai', group: '42' },
        expect.anything()
      )
      fireEvent.click(document.querySelector('[data-testid="codex-manifest-dropdown"] button')!)
      expect(byTestId('codex-manifest-selected-tags')!.textContent).toContain('Manifest account')

      fireEvent.click(document.querySelector('[aria-label="remove account 5"]')!)
      expect(byTestId('codex-manifest-selected-tags')).toBeNull()
      submitEditForm()
      expect(updateGroup).not.toHaveBeenCalled()
      expect(byTestId('codex-manifest-validation-error')).not.toBeNull()

      fireEvent.focus(search())
      fireEvent.click(document.querySelector('[data-testid="codex-manifest-dropdown"] button')!)
      expect(byTestId('codex-manifest-selected-tags')!.textContent).toContain('Manifest account')
      const fallback = () => byTestId('codex-manifest-fallback-toggle')!
      fireEvent.click(fallback())
      expect(fallback().getAttribute('aria-checked')).toBe('true')
      fireEvent.click(fallback())
      expect(fallback().getAttribute('aria-checked')).toBe('false')
      fireEvent.click(fallback())

      fireEvent.click(toggle())
      expect(byTestId('codex-manifest-search')).toBeNull()
      fireEvent.click(toggle())
      expect(byTestId('codex-manifest-selected-tags')!.textContent).toContain('Manifest account')
      submitEditForm()
      await flushPromises()
      expect(updateGroup).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          codex_models_manifest_config: { enabled: true, account_ids: [5], fallback_to_scheduler: true }
        })
      )

      // Reopening reads the saved group afresh, without retaining the prior draft.
      fireEvent.click(editButton())
      await flushPromises()
      expect(toggle().getAttribute('aria-checked')).toBe('false')
      expect(byTestId('codex-manifest-search')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
