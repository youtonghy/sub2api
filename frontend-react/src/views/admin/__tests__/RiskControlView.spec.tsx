import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContentModerationAPIKeyStatus, ContentModerationConfig, UpdateContentModerationConfig } from '@/api/admin/riskControl'
import RiskControlView from '../RiskControlView'

const {
  getConfig,
  updateConfig,
  getStatus,
  listLogs,
  getGroups,
  getProxies,
  testAPIKeys,
  showError,
  showSuccess
} = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  getStatus: vi.fn(),
  listLogs: vi.fn(),
  getGroups: vi.fn(),
  getProxies: vi.fn(),
  testAPIKeys: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn()
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    riskControl: {
      getConfig,
      updateConfig,
      getStatus,
      listLogs,
      testAPIKeys,
      deleteFlaggedHash: vi.fn(),
      clearFlaggedHashes: vi.fn(),
      unbanUser: vi.fn()
    },
    groups: { getAll: getGroups },
    proxies: { getAll: getProxies }
  }
}))

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showError, showSuccess }) }
}))

vi.mock('@/utils/apiError', () => ({
  extractApiErrorMessage: (_err: unknown, fallback: string) => fallback
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'admin.riskControl.preBlockAPIKeyLoadSummary') {
        return `同步并发 ${params?.active} / 可用 Key ${params?.available}，累计 ${params?.total} 次，worker：${params?.workerActive} / ${params?.workerTotal}`
      }
      return key.replace(/\{(\w+)\}/g, (_, token) => String(params?.[token] ?? `{${token}}`))
    },
    te: () => false,
    locale: 'en',
    setLocale: vi.fn()
  })
}))

vi.mock('@/components/arc/drawer/drawer', async () => {
  const harness = await import('./riskControlViewHarness')
  return { Drawer: harness.DrawerStub, DrawerContent: harness.DrawerContentStub }
})
vi.mock('@/components/arc/tabs/tabs', async () => {
  const harness = await import('./riskControlViewHarness')
  return { Tabs: harness.TabsStub, TabsList: harness.TabsListStub, TabsTrigger: harness.TabsTriggerStub, TabsContent: harness.TabsContentStub }
})
vi.mock('@/components/common/Select', async () => ({ default: (await import('./riskControlViewHarness')).SelectStub }))
vi.mock('@/components/common/ProxySelector', async () => ({ default: (await import('./riskControlViewHarness')).NullStub }))
vi.mock('@/components/common/Pagination', async () => ({ default: (await import('./riskControlViewHarness')).NullStub }))
vi.mock('@/components/common/DataTable', async () => ({ default: (await import('./riskControlViewHarness')).DataTableStub }))
vi.mock('@/components/account/ModelWhitelistSelector', async () => ({
  default: (await import('./riskControlViewHarness')).ModelWhitelistSelectorStub
}))

const baseConfig = (): ContentModerationConfig => ({
  enabled: true,
  mode: 'pre_block',
  base_url: 'https://api.openai.com',
  model: 'omni-moderation-latest',
  proxy_id: null,
  api_key_configured: false,
  api_key_masked: '',
  api_key_count: 0,
  api_key_masks: [],
  api_key_statuses: [],
  timeout_ms: 3000,
  sample_rate: 100,
  all_groups: true,
  group_ids: [],
  record_non_hits: false,
  worker_count: 4,
  queue_size: 32768,
  block_status: 403,
  block_message: '内容审计命中风险规则，请调整输入后重试',
  email_on_hit: true,
  auto_ban_enabled: true,
  ban_threshold: 10,
  violation_window_hours: 720,
  retry_count: 2,
  hit_retention_days: 180,
  non_hit_retention_days: 3,
  pre_hash_check_enabled: false,
  blocked_keywords: [],
  keyword_blocking_mode: 'keyword_and_api',
  thresholds: {
    harassment: 0.98,
    sexual: 0.65
  },
  model_filter: {
    type: 'all',
    models: []
  }
})

const runtimeStatus = () => ({
  enabled: true,
  risk_control_enabled: true,
  mode: 'pre_block',
  worker_count: 4,
  max_workers: 32,
  active_workers: 0,
  idle_workers: 4,
  queue_size: 32768,
  queue_length: 0,
  queue_usage_percent: 0,
  enqueued: 0,
  dropped: 0,
  processed: 0,
  errors: 0,
  pre_block_active: 0,
  pre_block_checked: 0,
  pre_block_allowed: 0,
  pre_block_blocked: 0,
  pre_block_errors: 0,
  pre_block_avg_latency_ms: 0,
  pre_block_api_key_active: 0,
  pre_block_api_key_available_count: 0,
  pre_block_api_key_total_calls: 0,
  pre_block_api_key_loads: [],
  api_key_statuses: [],
  flagged_hash_count: 0,
  last_cleanup_deleted_hit: 0,
  last_cleanup_deleted_non_hit: 0
})

async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

async function mountView() {
  const result = render(<RiskControlView />)
  await flushPromises()
  return result
}

function findButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.includes(text))
  if (!button) {
    throw new Error(`button not found: ${text}`)
  }
  return button
}

async function click(text: string) {
  fireEvent.click(findButtonByText(text))
  await flushPromises()
}

const byTest = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.querySelector<T>(`[data-test="${id}"]`)
  if (!el) throw new Error(`element not found: ${id}`)
  return el
}

async function switchEngine(value: string) {
  fireEvent.change(byTest('audit-engine-select').querySelector('select')!, { target: { value } })
  await flushPromises()
}

async function setValue(id: string, value: string) {
  fireEvent.change(byTest<HTMLInputElement>(id), { target: { value } })
  await flushPromises()
}

const keyPanelText = () => byTest('audit-key-statuses').textContent ?? ''
const pageText = () => document.body.textContent ?? ''

describe('admin RiskControlView', () => {
  beforeEach(() => {
    getConfig.mockReset()
    updateConfig.mockReset()
    getStatus.mockReset()
    listLogs.mockReset()
    getGroups.mockReset()
    showError.mockReset()
    showSuccess.mockReset()
    testAPIKeys.mockReset()

    getConfig.mockResolvedValue(baseConfig())
    getStatus.mockResolvedValue(runtimeStatus())
    listLogs.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, pages: 1 })
    getGroups.mockResolvedValue([])
    getProxies.mockResolvedValue([])
    updateConfig.mockImplementation(async (payload: UpdateContentModerationConfig) => ({
      ...baseConfig(),
      ...payload,
      model_filter: payload.model_filter ?? baseConfig().model_filter,
      api_key_configured: false,
      api_key_masked: '',
      api_key_count: 0,
      api_key_masks: [],
      api_key_statuses: []
    }))
  })

  it.each(['openai', 'typesafe'] as const)('shows the selected draft engine keys while %s remains active', async (activeEngine) => {
    const openaiKey: ContentModerationAPIKeyStatus = {
      index: 1, key_hash: 'openai-hash', masked: '********oa01', status: 'frozen',
      failure_count: 1, success_count: 0, last_error: '', last_latency_ms: 100,
      last_http_status: 429, last_tested: false, configured: true
    }
    const typesafeKey: ContentModerationAPIKeyStatus = { ...openaiKey, key_hash: 'typesafe-hash', masked: '********ts02', status: 'ok', failure_count: 0, success_count: 1, last_http_status: 200 }
    const profiles = {
      openai: { ...baseConfig(), engine: 'openai' as const, api_key_configured: true, api_key_count: 1, api_key_statuses: [openaiKey] },
      typesafe: { ...baseConfig(), engine: 'typesafe' as const, api_key_configured: true, api_key_count: 1, api_key_statuses: [typesafeKey] }
    }
    const otherEngine = activeEngine === 'openai' ? 'typesafe' : 'openai'
    getConfig.mockResolvedValue({ ...profiles[activeEngine], engine_configs: profiles })
    getStatus.mockResolvedValue({ ...runtimeStatus(), engine: activeEngine, api_key_statuses: profiles[activeEngine].api_key_statuses })
    const { unmount } = await mountView()
    await click('admin.riskControl.openSettings')
    expect(keyPanelText()).toContain(profiles[activeEngine].api_key_statuses[0].masked)
    await switchEngine(otherEngine)
    expect(keyPanelText()).toContain(profiles[otherEngine].api_key_statuses[0].masked)
    expect(keyPanelText()).not.toContain(profiles[activeEngine].api_key_statuses[0].masked)
    expect(keyPanelText()).toContain(otherEngine === 'openai' ? 'admin.riskControl.apiKeyStatusFrozen' : 'admin.riskControl.apiKeyStatusOk')
    await click('admin.riskControl.refreshStatus')
    expect(keyPanelText()).toContain(profiles[otherEngine].api_key_statuses[0].masked)
    expect(keyPanelText()).not.toContain(profiles[activeEngine].api_key_statuses[0].masked)
    await switchEngine(activeEngine)
    expect(keyPanelText()).toContain(profiles[activeEngine].api_key_statuses[0].masked)
    expect(keyPanelText()).not.toContain(profiles[otherEngine].api_key_statuses[0].masked)
    expect(updateConfig).not.toHaveBeenCalled()
    unmount()
  })

  it('shows an empty key panel for an unconfigured draft engine', async () => {
    getStatus.mockResolvedValue({ ...runtimeStatus(), api_key_statuses: [{ masked: '********oa01', configured: true, status: 'ok' }] })
    const { unmount } = await mountView()
    await click('admin.riskControl.openSettings')
    await switchEngine('typesafe')
    expect(keyPanelText()).toContain('admin.riskControl.apiKeyHealthEmpty')
    expect(keyPanelText()).not.toContain('********oa01')
    expect(updateConfig).not.toHaveBeenCalled()
    unmount()
  })

  it('preserves both engine drafts and saves thresholds independently', async () => {
    const { unmount } = await mountView()
    await click('admin.riskControl.openSettings')
    await setValue('audit-base-url', 'https://openai-edited.example')
    await click('admin.riskControl.tabs.riskThresholds')
    await setValue('risk-threshold-sexual', '73')
    await click('admin.riskControl.tabs.basic')
    await switchEngine('typesafe')
    expect(byTest<HTMLInputElement>('audit-model').value).toBe('jev-latest')
    await setValue('audit-base-url', 'https://typesafe-edited.example')
    await click('admin.riskControl.tabs.riskThresholds')
    expect(byTest<HTMLInputElement>('risk-threshold-sexual').value).toBe('65')
    await setValue('risk-threshold-sexual', '91')
    await click('admin.riskControl.tabs.basic')
    await switchEngine('openai')
    expect(byTest<HTMLInputElement>('audit-base-url').value).toBe('https://openai-edited.example')
    await click('admin.riskControl.saveConfig')
    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ engine: 'openai', engine_configs: {
      openai: expect.objectContaining({ base_url: 'https://openai-edited.example', thresholds: expect.objectContaining({ sexual: 0.73 }) }),
      typesafe: expect.objectContaining({ base_url: 'https://typesafe-edited.example', thresholds: expect.objectContaining({ sexual: 0.91 }) })
    } }))
    expect(showError).not.toHaveBeenCalled()
    unmount()
  })

  it('tests the draft engine without switching the active engine', async () => {
    testAPIKeys.mockResolvedValue({ items: [{ status: 'ok', configured: false }], image_count: 0 })
    const { unmount } = await mountView()
    await click('admin.riskControl.openSettings')
    await switchEngine('typesafe')
    fireEvent.change(document.querySelector('textarea[autocomplete="new-password"]')!, { target: { value: 'test-only-key' } })
    await flushPromises()
    await click('admin.riskControl.testInputApiKeys')
    expect(testAPIKeys).toHaveBeenCalledWith(expect.objectContaining({ engine: 'typesafe', api_keys: ['test-only-key'], model: 'jev-latest', thresholds: expect.objectContaining({ sexual: 0.65 }) }))
    expect(updateConfig).not.toHaveBeenCalled()
    expect(byTest('active-audit-engine').textContent).not.toContain('TypeSafe AI')
    unmount()
  })

  it.each(['openai', 'typesafe'] as const)('restores the shared defaults for %s without replacing saved thresholds on load', async (engine) => {
    getConfig.mockResolvedValue({ ...baseConfig(), engine, thresholds: { sexual: 0.8, harassment: 0.8 } })
    const { unmount } = await mountView()
    await click('admin.riskControl.openSettings')
    await click('admin.riskControl.tabs.riskThresholds')
    expect(byTest<HTMLInputElement>('risk-threshold-sexual').value).toBe('80')
    await click('admin.riskControl.riskThresholdReset')
    const defaults = {
      harassment: 98, 'harassment/threatening': 90, hate: 65, 'hate/threatening': 65,
      illicit: 95, 'illicit/violent': 95, 'self-harm': 65, 'self-harm/intent': 85,
      'self-harm/instructions': 65, sexual: 65, 'sexual/minors': 65, violence: 95, 'violence/graphic': 95
    }
    for (const [category, value] of Object.entries(defaults)) {
      expect(byTest<HTMLInputElement>(`risk-threshold-${category}`).value).toBe(String(value))
    }
    if (engine === 'typesafe') expect(pageText()).toContain('admin.riskControl.typeSafeThresholds')
    expect(updateConfig).not.toHaveBeenCalled()
    unmount()
  })

  it('saves the selected model filter mode and models', async () => {
    await mountView()

    await click('admin.riskControl.openSettings')
    await click('admin.riskControl.tabs.scope')
    // Vue 版模型过滤是按钮卡片；React 版是 Arc radio-cards（role="radio"）
    const include = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find((item) =>
      item.textContent?.includes('admin.riskControl.modelFilterInclude')
    )!
    fireEvent.click(include)
    await flushPromises()
    await setValue('model-filter-input', 'gpt-5.5, gpt-5.4')
    await click('admin.riskControl.saveConfig')

    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      model_filter: {
        type: 'include',
        models: ['gpt-5.5', 'gpt-5.4']
      }
    }))
    expect(showError).not.toHaveBeenCalled()
  })

  it('submits edited risk control thresholds when saving moderation config', async () => {
    await mountView()

    await click('admin.riskControl.openSettings')
    await click('admin.riskControl.tabs.riskThresholds')
    await setValue('risk-threshold-sexual', '72')
    await setValue('risk-threshold-harassment', '99')
    await click('admin.riskControl.saveConfig')

    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      thresholds: expect.objectContaining({
        sexual: 0.72,
        harassment: 0.99
      })
    }))
    expect(showError).not.toHaveBeenCalled()
  })

  it('describes worker runtime as async audit and pre-block record processing', async () => {
    getStatus.mockResolvedValue({
      ...runtimeStatus(),
      mode: 'observe',
      processed: 12,
      queue_length: 2
    })

    await mountView()

    expect(pageText()).toContain('admin.riskControl.workerStatusHint')
    expect(pageText()).not.toContain('admin.riskControl.preBlockSyncStatus')
    expect(pageText()).toContain('admin.riskControl.records')
    expect(pageText()).toContain('12')
    expect(pageText()).toContain('2 / 32,768')
  })

  it('shows pre-block synchronous moderation metrics separately from worker queue', async () => {
    getStatus.mockResolvedValue({
      ...runtimeStatus(),
      pre_block_active: 2,
      pre_block_checked: 128,
      pre_block_allowed: 120,
      pre_block_blocked: 8,
      pre_block_errors: 1,
      pre_block_avg_latency_ms: 86,
      pre_block_api_key_active: 2,
      pre_block_api_key_available_count: 2,
      pre_block_api_key_total_calls: 128,
      active_workers: 3,
      worker_count: 7,
      pre_block_api_key_loads: [
        {
          index: 0,
          key_hash: 'hash-one',
          masked: 'sk-...one',
          status: 'ok',
          active: 1,
          total: 72,
          success: 70,
          errors: 2,
          avg_latency_ms: 84,
          last_latency_ms: 80,
          last_http_status: 200
        },
        {
          index: 1,
          key_hash: 'hash-two',
          masked: 'sk-...two',
          status: 'ok',
          active: 1,
          total: 56,
          success: 56,
          errors: 0,
          avg_latency_ms: 90,
          last_latency_ms: 92,
          last_http_status: 200
        }
      ]
    })

    await mountView()

    expect(pageText()).toContain('admin.riskControl.preBlockSyncStatus')
    expect(pageText()).toContain('admin.riskControl.preBlockSyncHint')
    expect(pageText()).not.toContain('admin.riskControl.workerStatus')
    expect(pageText()).toContain('admin.riskControl.records')
    expect(pageText()).toContain('128')
    expect(pageText()).toContain('120')
    expect(pageText()).toContain('8')
    expect(pageText()).toContain('86 ms')
    expect(pageText()).toContain('admin.riskControl.preBlockAPIKeyLoad')
    expect(pageText()).toContain('sk-...one')
    expect(pageText()).toContain('sk-...two')
    expect(pageText()).toContain('72')
    expect(pageText()).toContain('56')
    expect(pageText()).toContain('同步并发 2 / 可用 Key 2，累计 128 次，worker：3 / 7')

    // Vue spec 还断言了 Tailwind 类名（grid、card、max-h-[280px] 等）；样式改为 CSS Module，只保留结构断言
    const runtimeCards = byTest('pre-block-runtime-cards')
    const syncCard = byTest('pre-block-sync-card')
    const apiKeyLoadCard = byTest('pre-block-api-key-load-card')

    expect(syncCard.parentElement).toBe(runtimeCards)
    expect(apiKeyLoadCard.parentElement).toBe(runtimeCards)
    expect(syncCard.querySelector('h2')!.textContent).toBe('admin.riskControl.preBlockSyncStatus')
    expect(syncCard.textContent).toContain('admin.riskControl.preBlockSyncHint')
    expect(apiKeyLoadCard.querySelector('h2')!.textContent).toBe('admin.riskControl.preBlockAPIKeyLoad')
    expect(apiKeyLoadCard.textContent).toContain('admin.riskControl.preBlockAPIKeyLoadHint')
    expect(byTest('pre-block-api-key-load-list')).toBeInTheDocument()
  })
})
