import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConfirmDialogProps } from '@/components/common/ConfirmDialog'
import type { EndpointPoolProps } from '../components/EndpointPool'
import type { EventWorkspaceProps } from '../components/EventWorkspace'
import type { FilterDeleteDialogProps } from '../components/FilterDeleteDialog'
import type { RuntimeOverviewProps } from '../components/RuntimeOverview'
import type { PromptAuditConfig, PromptAuditRuntime } from '../types'
import { SCANNER_CATALOG } from '../viewModel'
import PromptAuditView from '../PromptAuditView'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(), updateConfig: vi.fn(), probeEndpoint: vi.fn(), getRuntime: vi.fn(), listEvents: vi.fn(),
  getEvent: vi.fn(), deleteEvent: vi.fn(), batchDeleteEvents: vi.fn(), previewDelete: vi.fn(), deleteEventsByFilter: vi.fn(), listGroups: vi.fn(),
  showSuccess: vi.fn(), showError: vi.fn()
}))
// 最近一次传给 EndpointPool 桩的 props（对应 Vue spec 中 getComponent(EndpointStub).props()）
const endpointProps = vi.hoisted(() => ({ current: null as EndpointPoolProps | null }))

vi.mock('../api', () => ({ default: mocks }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showSuccess: mocks.showSuccess, showError: mocks.showError }) } }))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    locale: 'en',
    te: () => false,
    setLocale: vi.fn(),
    t: (key: string, params?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (_, token) => String(params?.[token] ?? `{${token}}`))
  })
}))
vi.mock('@/components/arc/tabs/tabs', async () => {
  const harness = await import('./promptAuditHarness')
  return { Tabs: harness.TabsStub, TabsList: harness.TabsListStub, TabsTrigger: harness.TabsTriggerStub }
})
vi.mock('../components/RuntimeOverview', () => ({
  default: ({ error }: RuntimeOverviewProps) => <div data-test="runtime">{error}</div>
}))
vi.mock('../components/EndpointPool', () => ({
  default: (props: EndpointPoolProps) => {
    endpointProps.current = props
    const { endpoints, onEndpointsChange, onProbe } = props
    return (
      <div data-test="endpoint">
        <button
          type="button"
          data-test="inject-secret"
          onClick={() => onEndpointsChange?.(endpoints.map((e) => ({ ...e, token: 'PROMPT_AUDIT_CANARY_SECRET_DO_NOT_PERSIST' })))}
        >
          secret
        </button>
        <button type="button" data-test="probe" onClick={() => onProbe?.(endpoints[0])}>
          probe
        </button>
      </div>
    )
  }
}))
vi.mock('../components/PolicyPanel', () => ({ default: () => <div data-test="policy" /> }))
vi.mock('../components/EventWorkspace', () => ({
  default: ({ filters, onPreviewDelete, onFiltersChange, onDelete, onSelection, onBatchDelete }: EventWorkspaceProps) => (
    <div data-test="events">
      <button type="button" data-test="preview" onClick={() => onPreviewDelete?.()}>preview</button>
      <button type="button" data-test="change-filter" onClick={() => onFiltersChange?.({ ...filters, keyword: 'changed' })}>change</button>
      <button type="button" data-test="delete-one" onClick={() => onDelete?.(5)}>delete</button>
      <button type="button" data-test="select-batch" onClick={() => onSelection?.([5, 6])}>select</button>
      <button type="button" data-test="delete-batch" onClick={() => onBatchDelete?.()}>batch</button>
    </div>
  )
}))
vi.mock('../components/EventDetailDialog', () => ({ default: () => <div data-test="detail" /> }))
vi.mock('@/components/common/ConfirmDialog', () => ({
  default: ({ show, onConfirm }: ConfirmDialogProps) =>
    show ? (
      <div data-test="confirm">
        <button type="button" data-test="confirm-action" onClick={() => onConfirm?.()}>confirm</button>
      </div>
    ) : null
}))
vi.mock('../components/FilterDeleteDialog', () => ({
  default: ({ show, initialFilters, preview, onPreview, onConfirm }: FilterDeleteDialogProps) =>
    show ? (
      <div data-test="filter-delete-dialog">
        <button type="button" data-test="dialog-preview" onClick={() => onPreview?.({ ...initialFilters, start_at: '2026-07-15T00:00', end_at: '2026-07-16T00:00' })}>run</button>
        <button type="button" data-test="dialog-confirm" onClick={() => onConfirm?.({ ...initialFilters, start_at: '2026-07-15T00:00', end_at: '2026-07-16T00:00' })}>confirm</button>
        <span data-test="dialog-preview-state">{preview ? preview.matched_count : 'none'}</span>
      </div>
    ) : null
}))

const baseConfig = (): PromptAuditConfig => ({
  enabled: true, blocking_enabled: false, blocking_latest_turn_only: false, store_pass_events: false, effective_mode: 'async_audit', strategy: 'priority',
  worker_count: 4, queue_capacity: 100, scanners: SCANNER_CATALOG.map((item) => item.id), all_groups: true, group_ids: [],
  endpoints: [{ id: 'guard-1', name: 'Guard One', protocol: 'openai_compatible', base_url: 'http://127.0.0.1:8000', model: 'guard-model', timeout_ms: 3000, input_limit: 4000, enabled: true, has_token: true, token_status: 'configured' }],
  config_version: 7, updated_at: '2026-07-16T00:00:00Z', updated_by: 1, change_summary: '{}'
})
const runtime = (): PromptAuditRuntime => ({
  process_status: 'running', effective_mode: 'async_audit', expected_config_version: 7, active_config_version: 7,
  worker_total: 4, worker_active: 1, queue_capacity: 100,
  queue: { staging: 0, queued: 0, processing: 1, retry: 0, done: 5, failed: 0, active: 1 },
  processed_total: 5, failed_total: 0, enqueued_total: 5, dropped_total: 0, database_status: 'ok', redis_status: 'ok', endpoints: {},
  guard_metrics: { total: 1, allowed: 1, flagged: 0, blocked: 0, unavailable: 0, invalid: 0, timeouts: 0, failovers: 0, bulkhead_full: 0, record_failed: 0 }
})

async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-test="${id}"]`)
const get = (id: string) => {
  const el = q(id)
  if (!el) throw new Error(`element not found: ${id}`)
  return el
}
async function click(id: string) {
  fireEvent.click(get(id))
  await flushPromises()
}

describe('PromptAuditView', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    endpointProps.current = null
    mocks.getConfig.mockResolvedValue(baseConfig())
    mocks.getRuntime.mockResolvedValue(runtime())
    mocks.listGroups.mockResolvedValue([])
    mocks.listEvents.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, pages: 0 })
    mocks.updateConfig.mockImplementation(async () => ({ ...baseConfig(), config_version: 8 }))
    mocks.probeEndpoint.mockResolvedValue({ ok: true, status: 'healthy', message: 'ok', latency_ms: 2, http_status: 200, retryable: false, checked_at: '2026-07-16T00:00:00Z', token_applied: true })
    mocks.previewDelete.mockResolvedValue({ matched_count: 2, filter_summary: {}, snapshot_max_id: 10, filter_hash: 'a'.repeat(64), confirmation_token: 'opaque-confirmation', expires_at: '2026-07-16T00:05:00Z' })
    mocks.deleteEventsByFilter.mockResolvedValue({ deleted_events: 2, deleted_jobs: 2 })
    mocks.deleteEvent.mockResolvedValue({ deleted_events: 1, deleted_jobs: 1 })
    mocks.batchDeleteEvents.mockResolvedValue({ deleted_events: 2, deleted_jobs: 2 })
  })

  it('starts config, runtime, groups, and events loads independently', async () => {
    mocks.getRuntime.mockRejectedValue(new Error('runtime offline'))
    render(<PromptAuditView />)
    expect(mocks.getConfig).toHaveBeenCalledOnce()
    expect(mocks.getRuntime).toHaveBeenCalledOnce()
    expect(mocks.listGroups).toHaveBeenCalledOnce()
    expect(mocks.listEvents).toHaveBeenCalledOnce()
    await flushPromises()
    expect(get('runtime').textContent).toContain('runtime offline')
    expect(q('endpoint')).not.toBeNull()
    expect(q('events')).not.toBeNull()
  })

  it('separates configuration and audit events into page tabs', async () => {
    render(<PromptAuditView />)
    await flushPromises()

    // Vue 版用 v-show（display: none）；React 版用 hidden 属性
    expect(get('tab-events').getAttribute('aria-selected')).toBe('true')
    expect(get('tab-config').getAttribute('aria-selected')).toBe('false')
    expect(get('tab-panel-events')).not.toHaveAttribute('hidden')
    expect(get('tab-panel-config')).toHaveAttribute('hidden')
    expect(q('save-config')).toBeNull()
    expect(q('events')).not.toBeNull()
    expect(q('pass-events-disabled-notice')).not.toBeNull()
    expect(get('tab-events').textContent).toContain('admin.promptAudit.tabs.events')
    expect(get('tab-config').textContent).toContain('admin.promptAudit.tabs.config')

    await click('tab-config')
    expect(get('tab-config').getAttribute('aria-selected')).toBe('true')
    expect(get('tab-panel-config')).not.toHaveAttribute('hidden')
    expect(get('tab-panel-events')).toHaveAttribute('hidden')
    expect(q('save-config')).not.toBeNull()

    await click('tab-events')
    expect(get('tab-events').getAttribute('aria-selected')).toBe('true')
    expect(q('save-config')).toBeNull()

    fireEvent.click(get('pass-events-disabled-notice').querySelector('button')!)
    await flushPromises()
    expect(get('tab-config').getAttribute('aria-selected')).toBe('true')
    expect(q('save-config')).not.toBeNull()
    expect(get('tab-panel-config')).not.toHaveAttribute('hidden')
  })

  it('requires confirmation for blocking and disables it when audit is turned off', async () => {
    render(<PromptAuditView />)
    await flushPromises()
    await click('tab-config')
    await click('blocking-toggle')
    expect(q('confirm')).not.toBeNull()
    await click('confirm-action')
    expect(get('blocking-toggle').getAttribute('aria-checked')).toBe('true')
    await click('blocking-latest-turn-only-toggle')
    expect(get('blocking-latest-turn-only-toggle').getAttribute('aria-checked')).toBe('true')
    await click('enabled-toggle')
    expect(get('enabled-toggle').getAttribute('aria-checked')).toBe('false')
    expect(get('blocking-toggle').getAttribute('aria-checked')).toBe('false')
    expect(get('blocking-toggle')).toBeDisabled()
    expect(get('blocking-latest-turn-only-toggle')).toBeDisabled()
  })

  it('clears plaintext token state after a successful save', async () => {
    const { container } = render(<PromptAuditView />)
    await flushPromises()
    await click('tab-config')
    await click('inject-secret')
    expect(container.textContent).toContain('admin.promptAudit.saveBar.dirty')
    await click('save-config')
    expect(mocks.updateConfig).toHaveBeenCalledWith(expect.objectContaining({ endpoints: [expect.objectContaining({ token: 'PROMPT_AUDIT_CANARY_SECRET_DO_NOT_PERSIST' })] }))
    expect(endpointProps.current!.endpoints[0].token).toBe('')
    expect(document.body.innerHTML).not.toContain('PROMPT_AUDIT_CANARY_SECRET_DO_NOT_PERSIST')
  })

  it('reports real probe progress/results and invalidates filter confirmation when filters change', async () => {
    render(<PromptAuditView />)
    await flushPromises()
    await click('tab-config')
    await click('probe')
    expect(mocks.probeEndpoint).toHaveBeenCalledOnce()
    expect(endpointProps.current!.probeResults).toHaveProperty('guard-1')

    await click('tab-events')
    await click('preview')
    expect(q('filter-delete-dialog')).not.toBeNull()
    expect(mocks.previewDelete).not.toHaveBeenCalled()
    await click('dialog-preview')
    expect(mocks.previewDelete).toHaveBeenCalledOnce()
    expect(get('dialog-preview-state').textContent).toBe('2')
    await click('change-filter')
    expect(q('filter-delete-dialog')).not.toBeNull()
    expect(get('dialog-preview-state').textContent).toBe('none')
  })

  it('uses native labeled switches and a responsive save surface', async () => {
    render(<PromptAuditView />)
    await flushPromises()
    await click('tab-config')
    const switches = Array.from(document.querySelectorAll('[role="switch"]'))
    expect(switches).toHaveLength(4)
    expect(switches.every((item) => Boolean(item.getAttribute('aria-label')))).toBe(true)
    // Vue 版断言固定定位与 flex-wrap 的 Tailwind 类名；React 版保存栏是粘性底栏（CSS Module），只断言其存在且包含保存按钮
    expect(get('save-config').closest('div')).not.toBeNull()
  })

  it('executes single, selected-batch, and preview-confirmed filter deletion flows', async () => {
    render(<PromptAuditView />)
    await flushPromises()

    await click('delete-one')
    await click('confirm-action')
    expect(mocks.deleteEvent).toHaveBeenCalledWith(5)

    await click('select-batch')
    await click('delete-batch')
    await click('confirm-action')
    expect(mocks.batchDeleteEvents).toHaveBeenCalledWith([5, 6])

    await click('preview')
    await click('dialog-preview')
    expect(mocks.previewDelete).toHaveBeenCalledWith(expect.objectContaining({ start_at: '2026-07-15T00:00', end_at: '2026-07-16T00:00' }))
    await click('dialog-confirm')
    expect(mocks.deleteEventsByFilter).toHaveBeenCalledWith(expect.objectContaining({
      start_at: '2026-07-15T00:00',
      end_at: '2026-07-16T00:00'
    }), expect.objectContaining({
      snapshot_max_id: 10,
      confirmation_token: 'opaque-confirmation'
    }))
    expect(q('filter-delete-dialog')).toBeNull()
  })

  it('mints the confirmation token on the fly for one-click filter deletion without a manual preview', async () => {
    render(<PromptAuditView />)
    await flushPromises()

    await click('preview')
    expect(q('filter-delete-dialog')).not.toBeNull()
    expect(mocks.previewDelete).not.toHaveBeenCalled()

    await click('dialog-confirm')
    expect(mocks.previewDelete).toHaveBeenCalledOnce()
    expect(mocks.previewDelete).toHaveBeenCalledWith(expect.objectContaining({ start_at: '2026-07-15T00:00', end_at: '2026-07-16T00:00' }))
    expect(mocks.deleteEventsByFilter).toHaveBeenCalledWith(expect.objectContaining({
      start_at: '2026-07-15T00:00',
      end_at: '2026-07-16T00:00'
    }), expect.objectContaining({
      snapshot_max_id: 10,
      confirmation_token: 'opaque-confirmation'
    }))
    expect(q('filter-delete-dialog')).toBeNull()
  })
})
