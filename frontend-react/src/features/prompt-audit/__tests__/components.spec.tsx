import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaginationProps } from '@/components/common/Pagination'
import EndpointPool from '../components/EndpointPool'
import EventDetailDialog from '../components/EventDetailDialog'
import EventWorkspace from '../components/EventWorkspace'
import FilterDeleteDialog from '../components/FilterDeleteDialog'
import PolicyPanel from '../components/PolicyPanel'
import type { PromptAuditDraft, PromptAuditEndpointDraft, PromptAuditEvent, PromptEventFilters } from '../types'
import { emptyEventFilters, resolveDeleteRangeFilters, SCANNER_CATALOG } from '../viewModel'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    locale: 'en',
    te: () => false,
    setLocale: vi.fn(),
    t: (key: string, params?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (_, token) => String(params?.[token] ?? `{${token}}`))
  })
}))
vi.mock('@/components/common/BaseDialog', async () => ({ default: (await import('./promptAuditHarness')).DialogStub }))
vi.mock('@/components/arc/tabs/tabs', async () => {
  const harness = await import('./promptAuditHarness')
  return { Tabs: harness.TabsStub, TabsList: harness.TabsListStub, TabsTrigger: harness.TabsTriggerStub, TabsContent: harness.TabsContentStub }
})
vi.mock('@/components/common/Pagination', () => ({
  default: (_props: PaginationProps) => <div data-test="pagination" />
}))

const endpoint = (): PromptAuditEndpointDraft => ({
  id: 'guard-1', name: 'Guard One', protocol: 'openai_compatible', base_url: 'http://127.0.0.1:8000',
  model: 'guard-model', timeout_ms: 3000, input_limit: 4000, enabled: true,
  has_token: true, token_status: 'configured', token: '', clear_token: false
})

const q = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)
const get = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const el = q<T>(selector)
  if (!el) throw new Error(`element not found: ${selector}`)
  return el
}
const buttonWithText = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes(text))

describe('Prompt Audit components', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('edits a saved endpoint with blank-secret keep, explicit clear, replacement, and probe actions', () => {
    const onEndpointsChange = vi.fn()
    const onProbe = vi.fn()
    const { container } = render(
      <EndpointPool endpoints={[endpoint()]} probeResults={{}} probingIds={[]} onEndpointsChange={onEndpointsChange} onProbe={onProbe} />
    )
    expect(container.textContent).toContain('admin.promptAudit.pool.configured')
    const edit = buttonWithText('common.edit')
    expect(edit).toBeTruthy()
    fireEvent.click(edit!)
    const token = get<HTMLInputElement>('[aria-label="admin.promptAudit.pool.apiKey"]')
    expect(token.value).toBe('')
    expect(token.getAttribute('placeholder')).toContain('admin.promptAudit.pool.keepSecret')

    // Vue 版是原生 checkbox；React 版是 Arc 复选框（role="checkbox"）
    fireEvent.click(screen.getByRole('checkbox', { name: 'admin.promptAudit.pool.clearSecret' }))
    fireEvent.change(token, { target: { value: 'replacement-canary' } })
    fireEvent.click(get('[data-test="save-endpoint"]'))
    const updated = onEndpointsChange.mock.lastCall?.[0] as PromptAuditEndpointDraft[]
    expect(updated[0]).toMatchObject({ token: 'replacement-canary', clear_token: false })

    const probe = buttonWithText('admin.promptAudit.pool.probe')
    fireEvent.click(probe!)
    expect(onProbe.mock.calls[0]?.[0]).toMatchObject({ id: 'guard-1' })
  })

  it('surfaces an undecryptable saved credential and prompts for re-entry', () => {
    const invalidEndpoint = { ...endpoint(), token_status: 'invalid' }
    const { container } = render(<EndpointPool endpoints={[invalidEndpoint]} probeResults={{}} probingIds={[]} />)
    expect(container.textContent).toContain('admin.promptAudit.pool.invalid')
    expect(container.textContent).not.toContain('admin.promptAudit.pool.configured')

    fireEvent.click(buttonWithText('common.edit')!)
    const token = get<HTMLInputElement>('[aria-label="admin.promptAudit.pool.apiKey"]')
    expect(token.getAttribute('placeholder')).toContain('admin.promptAudit.pool.reenterSecret')
  })

  it('confirms endpoint deletion through a dialog instead of window.confirm', async () => {
    const onEndpointsChange = vi.fn()
    const nativeConfirm = vi.spyOn(window, 'confirm')
    render(<EndpointPool endpoints={[endpoint()]} probeResults={{}} probingIds={[]} onEndpointsChange={onEndpointsChange} />)
    fireEvent.click(buttonWithText('common.delete')!)
    expect(nativeConfirm).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('admin.promptAudit.pool.deleteConfirm')
    expect(onEndpointsChange).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(buttonWithText('common.confirm')!)
    })
    expect(onEndpointsChange).toHaveBeenCalledWith([])
  })

  it('supports group search, stale configured groups, nine scanners, and bounded worker inputs', () => {
    const draft: PromptAuditDraft = {
      enabled: true, blocking_enabled: false, blocking_latest_turn_only: false, store_pass_events: false, effective_mode: 'async_audit', strategy: 'priority',
      worker_count: 4, queue_capacity: 100, scanners: SCANNER_CATALOG.map((item) => item.id), all_groups: false, group_ids: [1, 99],
      endpoints: [endpoint()], config_version: 1, updated_at: '', updated_by: 0, change_summary: ''
    }
    const onDraftChange = vi.fn()
    const { container } = render(
      <PolicyPanel
        draft={draft}
        groups={[{ id: 1, name: 'Alpha', platform: 'openai', status: 'active' }, { id: 2, name: 'Beta', platform: 'claude', status: 'inactive' }]}
        onDraftChange={onDraftChange}
      />
    )
    expect(container.textContent).toContain('99')
    const scannerBoxes = screen
      .getAllByRole('checkbox')
      .filter((input) => SCANNER_CATALOG.some((scanner) => input.getAttribute('aria-label') === `admin.promptAudit.scanners.${scanner.id}`))
    expect(scannerBoxes).toHaveLength(9)
    fireEvent.change(get('[aria-label="admin.promptAudit.policy.searchGroups"]'), { target: { value: 'Beta' } })
    expect(container.textContent).toContain('Beta')
    expect(container.textContent).not.toContain('Alpha')
    fireEvent.change(get('[aria-label="admin.promptAudit.policy.workerCount"]'), { target: { value: '6' } })
    const emitted = onDraftChange.mock.lastCall?.[0] as PromptAuditDraft
    expect(emitted.worker_count).toBe(6)
  })

  it('keeps identity fields separate, supports selection, and opens filter deletion from the toolbar', () => {
    const event: PromptAuditEvent = {
      id: 1, job_id: 1, decision: 'critical', risk_level: 'critical', action: 'Block', categories: ['pii'], matched_scanners: ['pii'], scanner_scores: { pii: 1 }, scanner_evidence: { pii: 'redacted' }, scanner_backend: 'qwen3guard-openai', scanner_version: '1', guard_endpoint_id: 'guard-1', policy_id: 'priority', policy_version: 1, config_version: 1, chunk_total: 1, latency_ms: 10, issue_summaries: [], created_at: '2026-07-16T00:00:00Z',
      snapshot: { request_id: 'req-1', user_id: 1, username: 'alice', user_email: 'alice@example.test', api_key_id: 2, api_key_name: 'alice-key', group_id: 3, group_name: 'Alpha', provider: 'openai', endpoint: '/v1/chat/completions', protocol: 'openai_chat', model: 'gpt-test', prompt_hash: 'a'.repeat(64), redacted_preview: 'redacted preview', full_prompt: 'full prompt text', prompt_length: 10, message_count: 1, stage: 'http' }
    }
    const onPreviewDelete = vi.fn()
    const onSelection = vi.fn()
    const { container } = render(
      <EventWorkspace
        events={[event]}
        total={1}
        page={1}
        pageSize={20}
        filters={emptyEventFilters()}
        selectedIds={[]}
        loading={false}
        error=""
        onPreviewDelete={onPreviewDelete}
        onSelection={onSelection}
      />
    )
    expect(container.textContent).toContain('alice')
    expect(container.textContent).toContain('alice@example.test')
    expect(container.textContent).toContain('alice-key')
    expect(container.textContent).toContain('admin.promptAudit.decisions.critical · admin.promptAudit.riskLevels.critical')
    expect(container.textContent).toContain('admin.promptAudit.scanners.pii')
    expect(get('[data-test="filter-delete"]')).not.toBeDisabled()
    fireEvent.click(get('[data-test="filter-delete"]'))
    expect(onPreviewDelete).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'admin.promptAudit.events.selectEvent' })[0])
    expect(onSelection.mock.lastCall?.[0]).toEqual([1])
  })

  it('resolves delete range presets to an epoch start and a cutoff end', () => {
    const now = Date.parse('2026-07-17T12:00:00.000Z')
    const sevenDays = resolveDeleteRangeFilters(emptyEventFilters(), '7d', now)
    expect(sevenDays.start_at).toBe('1970-01-01T00:00:00.000Z')
    expect(sevenDays.end_at).toBe('2026-07-10T12:00:00.000Z')
    const all = resolveDeleteRangeFilters(emptyEventFilters(), 'all', now)
    expect(all.start_at).toBe('1970-01-01T00:00:00.000Z')
    expect(all.end_at).toBe('2026-07-17T12:00:00.000Z')
    const customSource = { ...emptyEventFilters(), start_at: '2026-07-01T00:00', end_at: '2026-07-02T00:00' }
    expect(resolveDeleteRangeFilters(customSource, 'custom', now)).toEqual(customSource)
  })

  it('drives filter deletion through presets, custom validation, preview, and confirm', () => {
    const onConfirm = vi.fn()
    const onPreview = vi.fn()
    const onCriteriaChange = vi.fn()
    const props = { show: true, initialFilters: emptyEventFilters(), previewing: false, deleting: false, onConfirm, onPreview, onCriteriaChange }
    const { rerender } = render(<FilterDeleteDialog {...props} preview={null} />)
    expect(get<HTMLInputElement>('[data-test="range-preset-7d"]').checked).toBe(true)
    expect(q('[data-test="custom-range"]')).toBeNull()
    expect(q('[data-test="delete-preview-empty"]')).not.toBeNull()
    // A valid preset is enough: confirm is armed immediately (one-click flow)
    // and needs no disabled-reason hint.
    expect(get('[data-test="confirm-filter-delete"]')).not.toBeDisabled()
    expect(q('[data-test="confirm-disabled-reason"]')).toBeNull()
    fireEvent.click(get('[data-test="confirm-filter-delete"]'))
    const directConfirm = onConfirm.mock.lastCall?.[0] as PromptEventFilters
    expect(directConfirm.start_at).toBe('1970-01-01T00:00:00.000Z')
    expect(Date.now() - new Date(directConfirm.end_at).getTime()).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000)

    fireEvent.click(get('[data-test="range-preset-30d"]'))
    expect(onCriteriaChange.mock.calls.length).toBeGreaterThan(0)
    fireEvent.change(get('[data-test="delete-risk"]'), { target: { value: 'high' } })
    fireEvent.click(get('[data-test="run-delete-preview"]'))
    const presetPreview = onPreview.mock.lastCall?.[0] as PromptEventFilters
    expect(presetPreview.risk_level).toBe('high')
    expect(presetPreview.start_at).toBe('1970-01-01T00:00:00.000Z')
    expect(Date.now() - new Date(presetPreview.end_at).getTime()).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000)

    fireEvent.click(get('[data-test="range-preset-custom"]'))
    expect(q('[data-test="custom-range"]')).not.toBeNull()
    expect(get('[data-test="run-delete-preview"]')).toBeDisabled()
    expect(get('[data-test="confirm-filter-delete"]')).toBeDisabled()
    expect(get('[data-test="confirm-disabled-reason"]').textContent).toBe('admin.promptAudit.events.filterDeleteConfirmInvalidRange')
    expect(get('[data-test="confirm-filter-delete"]').getAttribute('title')).toBe('admin.promptAudit.events.filterDeleteConfirmInvalidRange')
    fireEvent.change(get('[data-test="custom-range"] [aria-label="admin.promptAudit.events.startAt"]'), { target: { value: '2026-07-01T00:00' } })
    fireEvent.change(get('[data-test="custom-range"] [aria-label="admin.promptAudit.events.endAt"]'), { target: { value: '2026-07-02T00:00' } })
    expect(get('[data-test="run-delete-preview"]')).not.toBeDisabled()
    expect(get('[data-test="confirm-filter-delete"]')).not.toBeDisabled()
    expect(q('[data-test="confirm-disabled-reason"]')).toBeNull()
    fireEvent.click(get('[data-test="run-delete-preview"]'))
    const customPreview = onPreview.mock.lastCall?.[0] as PromptEventFilters
    expect(customPreview.start_at).toBe('2026-07-01T00:00')
    expect(customPreview.end_at).toBe('2026-07-02T00:00')

    rerender(
      <FilterDeleteDialog
        {...props}
        preview={{ matched_count: 3, filter_summary: {}, snapshot_max_id: 9, filter_hash: 'b'.repeat(64), confirmation_token: 'tok', expires_at: '2026-07-16T00:05:00Z' }}
      />
    )
    expect(get('[data-test="delete-preview-result"]').textContent).toContain('admin.promptAudit.events.filterDeleteCount')
    expect(q('[data-test="confirm-disabled-reason"]')).toBeNull()
    expect(get('[data-test="confirm-filter-delete"]')).not.toBeDisabled()
    fireEvent.click(get('[data-test="confirm-filter-delete"]'))
    const confirmed = onConfirm.mock.lastCall?.[0] as PromptEventFilters
    expect(confirmed.start_at).toBe('2026-07-01T00:00')
    expect(confirmed.end_at).toBe('2026-07-02T00:00')
  })

  it('explains that a zero-match preview leaves nothing to delete', () => {
    const preview = { matched_count: 0, filter_summary: {}, snapshot_max_id: 0, filter_hash: 'c'.repeat(64), confirmation_token: 'tok', expires_at: '2026-07-16T00:05:00Z' }
    const { rerender } = render(
      <FilterDeleteDialog show initialFilters={emptyEventFilters()} preview={preview} previewing={false} deleting={false} />
    )
    expect(get('[data-test="confirm-filter-delete"]')).toBeDisabled()
    expect(get('[data-test="confirm-disabled-reason"]').textContent).toBe('admin.promptAudit.events.filterDeleteConfirmNoMatches')
    rerender(<FilterDeleteDialog show initialFilters={emptyEventFilters()} preview={preview} previewing deleting={false} />)
    expect(q('[data-test="confirm-disabled-reason"]')).toBeNull()
    expect(get('[data-test="confirm-filter-delete"]')).toBeDisabled()
  })

  it('inherits an explicit list-filter range as the custom preset', () => {
    const initialFilters = { ...emptyEventFilters(), start_at: '2026-07-01T00:00', end_at: '2026-07-02T00:00', decision: 'critical' }
    render(<FilterDeleteDialog show initialFilters={initialFilters} preview={null} previewing={false} deleting={false} />)
    expect(get<HTMLInputElement>('[data-test="range-preset-custom"]').checked).toBe(true)
    expect(get<HTMLInputElement>('[data-test="custom-range"] [aria-label="admin.promptAudit.events.startAt"]').value).toBe('2026-07-01T00:00')
    expect(get<HTMLSelectElement>('[data-test="delete-decision"]').value).toBe('critical')
    expect(get('[data-test="run-delete-preview"]')).not.toBeDisabled()
  })

  it('shows the full unredacted prompt and structured guard return on the risks tab', () => {
    const event: PromptAuditEvent = {
      id: 1, job_id: 1, decision: 'critical', risk_level: 'critical', action: 'Block',
      categories: ['sexual_content_or_sexual_acts'], matched_scanners: ['sexual_content_or_sexual_acts'],
      scanner_scores: { sexual_content_or_sexual_acts: 1 },
      scanner_evidence: { sexual_content_or_sexual_acts: 'Sexual Content or Sexual Acts' },
      scanner_backend: 'qwen3guard-openai', scanner_version: 'qwen3guard', guard_endpoint_id: 'guard-1',
      policy_id: 'priority', policy_version: 1, config_version: 1, chunk_total: 1, latency_ms: 12,
      issue_summaries: [{
        category: 'sexual_content_or_sexual_acts', scanner_id: 'sexual_content_or_sexual_acts',
        title: '性内容或性行为', description: 'Sexual content or sexual acts', severity: 'critical',
        severity_label: '严重', action: 'Block', action_label: '阻止',
        code: 'prompt_audit_sexual_content_or_sexual_acts', score: 1,
        evidence: 'Sexual Content or Sexual Acts', evidence_hash: 'abc'
      }],
      created_at: '2026-07-16T00:00:00Z',
      snapshot: {
        request_id: 'req-1', user_id: 1, username: 'alice', user_email: 'alice@example.test',
        api_key_id: 2, api_key_name: 'alice-key', group_id: 3, group_name: 'Alpha', provider: 'openai',
        endpoint: '/v1/chat/completions', protocol: 'openai_chat', model: 'gpt-test',
        prompt_hash: 'a'.repeat(64), redacted_preview: 'redacted prompt body', full_prompt: 'complete unmasked prompt body', prompt_length: 20,
        message_count: 1, stage: 'http'
      }
    }
    render(<EventDetailDialog show event={event} loading={false} />)
    // Vue 版断言面板的 Tailwind 高度类名；React 版只断言固定高度的面板容器存在
    expect(q('[data-test="event-detail-tab-panel"]')).not.toBeNull()

    const riskTab = screen.getAllByRole('tab').find((tab) => tab.textContent?.includes('admin.promptAudit.events.tabs.risks'))
    expect(riskTab).toBeTruthy()
    fireEvent.click(riskTab!)
    expect(q('[data-test="event-detail-tab-panel"]')).not.toBeNull()
    expect(get('[data-test="risk-prompt-preview"]').textContent).toContain('complete unmasked prompt body')
    expect(get('[data-test="risk-prompt-preview"]').textContent).not.toContain('redacted prompt body')
    expect(get('[data-test="risk-guard-return"]').textContent).toContain('"decision": "admin.promptAudit.decisions.critical"')
    expect(get('[data-test="risk-guard-return"]').textContent).toContain('admin.promptAudit.scanners.sexual_content_or_sexual_acts')
    expect(get('[data-test="risk-issue"]').textContent).toContain('admin.promptAudit.scanners.sexual_content_or_sexual_acts')
  })

  it('falls back to the redacted preview for events stored before full prompts were kept', () => {
    const event: PromptAuditEvent = {
      id: 2, job_id: 2, decision: 'flag', risk_level: 'medium', action: 'Warn',
      categories: ['pii'], matched_scanners: ['pii'], scanner_scores: {}, scanner_evidence: {},
      scanner_backend: 'qwen3guard-openai', scanner_version: '1', guard_endpoint_id: 'guard-1',
      policy_id: 'priority', policy_version: 1, config_version: 1, chunk_total: 1, latency_ms: 5,
      issue_summaries: [], created_at: '2026-07-16T00:00:00Z',
      snapshot: {
        request_id: 'req-2', user_id: 1, username: 'bob', user_email: '', api_key_id: 2,
        api_key_name: 'bob-key', group_id: 3, group_name: 'Alpha', provider: 'openai',
        endpoint: '/v1/chat/completions', protocol: 'openai_chat', model: 'gpt-test',
        prompt_hash: 'b'.repeat(64), redacted_preview: 'legacy redacted preview', full_prompt: '', prompt_length: 20,
        message_count: 1, stage: 'http'
      }
    }
    render(<EventDetailDialog show event={event} loading={false} />)
    const riskTab = screen.getAllByRole('tab').find((tab) => tab.textContent?.includes('admin.promptAudit.events.tabs.risks'))
    fireEvent.click(riskTab!)
    expect(get('[data-test="risk-prompt-full"]').textContent).toContain('legacy redacted preview')
  })
})
