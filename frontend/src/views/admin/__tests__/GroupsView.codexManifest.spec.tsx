import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminGroup, CodexModelsManifestConfig } from '@/types'
import GroupsView from '../GroupsView'
import { buttonContaining, flushPromises } from './groupsViewHarness'

const { listGroups, getModelAllowlistCandidates, getUsageSummary, getCapacitySummary, getLiveCapability, app, auth, onboarding } =
  vi.hoisted(() => ({
    listGroups: vi.fn(),
    getModelAllowlistCandidates: vi.fn(),
    getUsageSummary: vi.fn(),
    getCapacitySummary: vi.fn(),
    getLiveCapability: vi.fn(),
    app: { showError: vi.fn(), showSuccess: vi.fn() },
    auth: { isSimpleMode: false },
    onboarding: { isCurrentStep: vi.fn(() => false), nextStep: vi.fn() }
  }))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    groups: {
      list: listGroups,
      getAll: vi.fn(),
      getModelAllowlistCandidates,
      getUsageSummary,
      getCapacitySummary,
      getLiveCapability,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      duplicate: vi.fn(),
      updateSortOrder: vi.fn()
    },
    accounts: {
      list: vi.fn(),
      getById: vi.fn()
    }
  }
}))

vi.mock('@/stores/app', async () => (await import('./groupsViewHarness')).storeModule('useAppStore', app))
vi.mock('@/stores/auth', async () => (await import('./groupsViewHarness')).storeModule('useAuthStore', auth))
vi.mock('@/stores/onboarding', async () =>
  (await import('./groupsViewHarness')).storeModule('useOnboardingStore', onboarding)
)
vi.mock('@/i18n/useI18n', async () => (await import('./groupsViewHarness')).i18nModule())
vi.mock('@/components/common/DataTable', async () =>
  (await import('./groupsViewHarness')).makeDataTableModule({ firstRowCells: ['actions'] })
)
vi.mock('@/components/account/AccountFormLayout', async (importOriginal) =>
  (await import('./groupsViewHarness')).accountFormLayoutModule(importOriginal as never)
)
vi.mock('@/components/admin/channel/PricingEntryCard', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/ReasoningEffortPolicyFields', async () =>
  (await import('./groupsViewHarness')).nullModule()
)
vi.mock('@/components/common/Select', async () => (await import('./groupsViewHarness')).selectModule())
vi.mock('@/components/common/Pagination', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/common/ConfirmDialog', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/common/GroupCapacityBadge', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupRateMultipliersModal', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupRPMOverridesModal', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupSortOrderModal', async () => (await import('./groupsViewHarness')).nullModule())
vi.mock('@/components/admin/group/GroupCompositeRoutesModal', async () => (await import('./groupsViewHarness')).nullModule())
// 替身：每次点击都基于收到的 modelValue 发出更新，验证父组件逐次合并子组件更新
vi.mock('@/components/admin/group/CodexManifestAccountsField', () => ({
  default: (props: {
    modelValue: CodexModelsManifestConfig
    onModelValueChange: (value: CodexModelsManifestConfig) => void
  }) => (
    <div data-testid="codex-manifest-field">
      <output data-testid="codex-manifest-value">{JSON.stringify(props.modelValue)}</output>
      <button
        type="button"
        data-testid="codex-manifest-enable"
        onClick={() => props.onModelValueChange({ ...props.modelValue, enabled: true })}
      >
        enable
      </button>
      <button
        type="button"
        data-testid="codex-manifest-select-account"
        onClick={() => props.onModelValueChange({ ...props.modelValue, account_ids: [17] })}
      >
        select account
      </button>
    </div>
  )
}))

const sourceGroup = {
  id: 42,
  name: 'OpenAI',
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
  long_context_pricing_enabled: true,
  force_openai_fast: false,
  free_openai_fast: false,
  model_pricing: [],
  profit_control_enabled: false,
  profit_min_margin: 0,
  profit_safety_buffer: 0,
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
  search_price_per_1k: null,
  audio_realtime_price_per_min: null,
  audio_tts_price_per_million_chars: null,
  audio_stt_price_per_hour: null,
  peak_rate_enabled: false,
  peak_start: '',
  peak_end: '',
  peak_rate_multiplier: 1,
  claude_code_only: false,
  fallback_group_id: null,
  fallback_group_id_on_invalid_request: null,
  allow_messages_dispatch: false,
  allow_live: false,
  require_oauth_only: false,
  require_privacy_set: false,
  created_at: '2026-09-05T00:00:00Z',
  updated_at: '2026-09-05T00:00:00Z',
  model_routing: null,
  model_routing_enabled: false,
  mcp_xml_inject: true,
  supported_model_scopes: [],
  account_count: 1,
  active_account_count: 1,
  rate_limited_account_count: 0,
  models_list_config: undefined,
  codex_models_manifest_config: {
    enabled: false,
    account_ids: [],
    fallback_to_scheduler: false
  },
  sort_order: 10
} as unknown as AdminGroup

const manifestValue = () => document.querySelector('[data-testid="codex-manifest-value"]')!.textContent

describe('GroupsView Codex manifest binding', () => {
  beforeEach(() => {
    localStorage.clear()
    listGroups.mockReset()
    getModelAllowlistCandidates.mockReset()
    getUsageSummary.mockReset()
    getCapacitySummary.mockReset()
    getLiveCapability.mockReset()

    listGroups.mockResolvedValue({ items: [sourceGroup], total: 1, page: 1, page_size: 20, pages: 1 })
    getModelAllowlistCandidates.mockResolvedValue([])
    getUsageSummary.mockResolvedValue([])
    getCapacitySummary.mockResolvedValue([])
    getLiveCapability.mockResolvedValue({ supported: false })
  })

  afterEach(cleanup)

  it('preserves consecutive child updates on the edit config', async () => {
    render(<GroupsView />)
    await flushPromises()

    const editButton = buttonContaining('common.edit')
    expect(editButton).toBeTruthy()
    fireEvent.click(editButton!)
    await flushPromises()

    expect(manifestValue()).toBe(JSON.stringify(sourceGroup.codex_models_manifest_config))

    fireEvent.click(document.querySelector('[data-testid="codex-manifest-enable"]')!)
    await flushPromises()
    expect(manifestValue()).toContain('"enabled":true')

    fireEvent.click(document.querySelector('[data-testid="codex-manifest-select-account"]')!)
    await flushPromises()
    expect(manifestValue()).toBe(JSON.stringify({ enabled: true, account_ids: [17], fallback_to_scheduler: false }))
  })
})
