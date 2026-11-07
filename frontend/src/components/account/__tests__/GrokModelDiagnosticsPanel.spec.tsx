import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadLocaleMessages, setLocale } from '@/i18n'
import enAccounts from '@/i18n/locales/en/admin/accounts'
import zhAccounts from '@/i18n/locales/zh/admin/accounts'
import enCommon from '@/i18n/locales/en/common'
import zhCommon from '@/i18n/locales/zh/common'
import type { GrokModelDiagnostics } from '@/types'
import { formatDateTime } from '@/utils/format'
import GrokModelDiagnosticsPanel, { type GrokModelDiagnosticsPanelProps } from '../GrokModelDiagnosticsPanel'

const zhCopy = (zhAccounts as { accounts: { grokModelDiagnostics: Record<string, string> } }).accounts.grokModelDiagnostics
const enCopy = (enAccounts as { accounts: { grokModelDiagnostics: Record<string, string> } }).accounts.grokModelDiagnostics
const NOT_LISTED_ZH = zhCopy.notListed
const REQUESTS_NOT_BLOCKED_ZH = zhCopy.compatibilityNotice

const START = Date.parse('2026-10-25T12:00:00.000Z')
const FETCHED_AT = '2026-10-25T11:00:00.000Z'
const EXPIRES_AT = '2026-10-25T12:00:05.000Z'
const LONG_ENDPOINT = `https://relay.example.com/${'endpoint-segment-'.repeat(12)}v1/models`

function freshDiagnostics(overrides: Partial<GrokModelDiagnostics> = {}): GrokModelDiagnostics {
  return {
    state: 'fresh',
    endpoint: 'https://cli-chat-proxy.grok.com/v1/models',
    fetched_at: FETCHED_AT,
    expires_at: EXPIRES_AT,
    models: ['grok-4.5', 'grok-4.6', 'grok-4.7', 'grok-4.7-build'],
    last_attempt: {
      started_at: FETCHED_AT,
      finished_at: '2026-10-25T11:00:01.000Z',
      status: 'success',
      scope: {
        account_id: 25,
        account_type: 'oauth',
        endpoint: 'https://cli-chat-proxy.grok.com/v1/models',
        fingerprint: 'abc'
      }
    },
    mappings: [
      { requested: 'composer-2.5', upstream: 'grok-composer-2.5-fast', status: 'not_listed' },
      { requested: 'friendly', upstream: 'grok-4.7', status: 'listed' },
      { requested: 'custom-*', status: 'unverifiable' },
      { requested: 'grok-imagine-image', upstream: 'grok-imagine-image', status: 'out_of_scope' }
    ],
    ...overrides
  } as GrokModelDiagnostics
}

async function mountPanel(props: Partial<GrokModelDiagnosticsPanelProps> = {}, locale: 'en' | 'zh' = 'zh') {
  await act(async () => {
    await setLocale(locale)
  })
  const allProps: GrokModelDiagnosticsPanelProps = { diagnostics: null, ...props }
  const view = render(<GrokModelDiagnosticsPanel {...allProps} />)
  const get = (testId: string) => {
    const el = view.container.querySelector(`[data-testid="${testId}"]`)
    if (!el) throw new Error(`missing ${testId}`)
    return el as HTMLElement
  }
  const find = (testId: string) => view.container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null
  return {
    ...view,
    get,
    find,
    text: () => view.container.textContent ?? '',
    openDetails: () => {
      const button = get('grok-diagnostics-details-toggle')
      if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button)
    },
    setProps: (next: Partial<GrokModelDiagnosticsPanelProps>) =>
      view.rerender(<GrokModelDiagnosticsPanel {...allProps} {...next} />)
  }
}

describe('GrokModelDiagnosticsPanel', () => {
  beforeAll(async () => {
    await loadLocaleMessages('en')
    await loadLocaleMessages('zh')
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(START)
  })

  afterEach(async () => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    await setLocale('en')
  })

  it('keeps English and Chinese diagnostic copy isomorphic and non-empty', () => {
    expect(Object.keys(enCopy).sort()).toEqual(Object.keys(zhCopy).sort())
    for (const value of [...Object.values(enCopy), ...Object.values(zhCopy)]) {
      expect(value.trim()).toBeTruthy()
    }
    expect(zhCommon.common.loading.trim()).toBeTruthy()
    expect(enCommon.common.loading.trim()).toBeTruthy()
  })

  it('shows source, last success, the latest attempt, and mapping differences for a fresh catalog', async () => {
    const view = await mountPanel({ diagnostics: freshDiagnostics() })
    fireEvent.click(view.get('grok-diagnostics-difference-toggle'))
    view.openDetails()
    const text = view.text()
    expect(text).toContain('https://cli-chat-proxy.grok.com/v1/models')
    expect(text).toContain(formatDateTime(FETCHED_AT))
    expect(text).toContain(zhCopy.lastSuccess)
    expect(text).toContain(zhCopy.lastAttempt)
    expect(text).toContain(zhCopy.attemptSuccess)
    expect(text).not.toContain('success')
    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy.fresh)
    for (const model of ['grok-4.5', 'grok-4.6', 'grok-4.7-build', 'composer-2.5', 'grok-composer-2.5-fast', 'friendly', 'custom-*']) {
      expect(text).toContain(model)
    }
    expect(text).toContain(NOT_LISTED_ZH)
    expect(text).toContain(REQUESTS_NOT_BLOCKED_ZH)
    expect(text).toContain(zhCopy.unverifiable)
    expect(text).toContain(zhCopy.outOfScope)
    expect(text).toContain(zhCopy.savedMappings)
    expect(text).toContain(zhCopy.upstreamModels)
  })

  it('renders the same sections in English', async () => {
    const view = await mountPanel({ diagnostics: freshDiagnostics() }, 'en')
    fireEvent.click(view.get('grok-diagnostics-difference-toggle'))
    view.openDetails()
    const text = view.text()
    for (const key of ['catalogTitle', 'fresh', 'notListed', 'compatibilityNotice', 'unverifiable', 'outOfScope', 'lastSuccess', 'lastAttempt']) {
      expect(text).toContain(enCopy[key])
    }
    expect(text).not.toContain('configured_fallback')
  })

  it('becomes stale at expires_at and withdraws current gaps without a request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    const view = await mountPanel({ diagnostics: freshDiagnostics() })
    fireEvent.click(view.get('grok-diagnostics-difference-toggle'))
    expect(view.get('grok-diagnostics-missing-summary').textContent).toContain(zhCopy.missingSummary.replace('{count}', '1'))
    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy.fresh)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy.stale)
    expect(view.find('grok-diagnostics-missing-summary')).toBeNull()
    expect(view.find('grok-diagnostics-difference-list')).toBeNull()
    expect(view.text()).not.toContain(NOT_LISTED_ZH)
    view.openDetails()
    expect(view.text()).toContain('composer-2.5')
    expect(view.text()).toContain(zhCopy.historicalComparison)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    '2026-10-25 12:00:00',
    '2026-02-29T12:00:00Z',
    '2026-10-25T24:00:00Z',
    '2026-10-25T12:60:00Z',
    '2026-10-25T12:00:00+08:60'
  ])('does not present an invalid catalog time %s as a successful observation', async (invalid) => {
    const view = await mountPanel({
      diagnostics: freshDiagnostics({
        fetched_at: invalid,
        expires_at: invalid,
        mappings: [{ requested: 'composer-2.5', upstream: 'grok-composer-2.5-fast', status: 'not_listed' }]
      })
    })
    view.openDetails()
    const text = view.text()
    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy.unknown)
    expect(text).not.toContain(invalid)
    expect(text).not.toContain(NOT_LISTED_ZH)
    const details = view.get('grok-diagnostics-details')
    expect(details.querySelector('dt')?.textContent).toBe(zhCopy.historicalSource)
    expect(details.querySelector('h4')?.textContent).toBe(zhCopy.historicalModels)
  })

  it('keeps a real leap day, numeric offset, and fractional second as the last success', async () => {
    const leapDay = '2024-02-29T23:30:00.5+08:00'
    const view = await mountPanel({
      diagnostics: freshDiagnostics({ fetched_at: leapDay, expires_at: '2026-10-25T20:00:00.123+08:00' })
    })
    view.openDetails()
    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy.fresh)
    expect(view.text()).toContain(formatDateTime(leapDay))
    expect(view.text()).toContain(NOT_LISTED_ZH)
  })

  it('does not present a future fetched_at echo as a successful observation', async () => {
    const future = '2026-10-25T13:00:00.000Z'
    const view = await mountPanel({ diagnostics: freshDiagnostics({ state: 'unknown', fetched_at: future, expires_at: undefined }) })
    view.openDetails()
    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy.unknown)
    expect(view.text()).not.toContain(formatDateTime(future))
    expect(view.text()).not.toContain(NOT_LISTED_ZH)
  })

  it.each([
    ['stale', '2026-10-25T05:00:00.000Z', '2026-10-25T11:00:00.000Z', 'stale', 'staleNotice'],
    ['source_changed', FETCHED_AT, EXPIRES_AT, 'sourceChanged', 'changedNotice']
  ] as const)('keeps a %s catalog readable without current gap claims', async (state, fetched, expires, label, notice) => {
    const view = await mountPanel({
      diagnostics: freshDiagnostics({ state, fetched_at: fetched, expires_at: expires, endpoint: LONG_ENDPOINT, models: ['grok-4.7', 'grok-x'] })
    })
    expect(view.find('grok-diagnostics-missing-summary')).toBeNull()
    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy[label])
    expect(view.get('grok-diagnostics-summary').textContent).toContain(zhCopy.historicalModelCount.replace('{count}', '2'))
    expect(view.text()).toContain(zhCopy[notice])
    view.openDetails()
    expect(view.text()).toContain(zhCopy.historicalComparison)
    expect(view.text()).not.toContain(NOT_LISTED_ZH)
    expect(view.text()).not.toContain(zhCopy.currentListed)
    expect(view.get('grok-diagnostics-endpoint').textContent).toBe(LONG_ENDPOINT)
  })

  it('shows the latest failure together with the previous successful catalog', async () => {
    const view = await mountPanel({
      diagnostics: freshDiagnostics({
        last_attempt: {
          started_at: '2026-10-25T11:50:00.000Z',
          finished_at: '2026-10-25T11:50:02.000Z',
          status: 'failed',
          error_code: 'transport'
        }
      })
    })
    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy.syncFailed)
    expect(view.text()).toContain(zhCopy.previousCatalogValid)
    view.openDetails()
    const attempt = view.get('grok-diagnostics-last-attempt').textContent ?? ''
    expect(attempt).toContain(zhCopy.errorTransport)
    expect(attempt).toContain(formatDateTime('2026-10-25T11:50:02.000Z'))
    expect(view.text()).not.toContain('transport')
    expect(view.text()).not.toContain('failed')
    expect(view.get('grok-diagnostics-last-success').textContent).not.toContain(formatDateTime('2026-10-25T11:50:02.000Z'))
  })

  it.each(['upstream_unavailable', '__proto__', 'constructor'])(
    'treats unknown or inherited error code %s as unavailable without echoing it',
    async (code) => {
      const view = await mountPanel({
        diagnostics: freshDiagnostics({
          last_attempt: { started_at: FETCHED_AT, finished_at: '2026-10-25T11:50:02.000Z', status: 'failed', error_code: code }
        })
      })
      expect(view.text()).toContain(zhCopy.attemptUnavailable)
      expect(view.text()).not.toContain(code)
      expect(view.text()).not.toContain('[object Object]')
    }
  )

  it.each(['weird_status', '__proto__', 'toString'])('labels attempt status %s as unknown without splicing it', async (status) => {
    const view = await mountPanel({
      diagnostics: freshDiagnostics({
        last_attempt: { started_at: FETCHED_AT, finished_at: '2026-10-25T11:50:02.000Z', status, error_code: 'http_error' }
      })
    })
    view.openDetails()
    const attempt = view.get('grok-diagnostics-last-attempt').textContent ?? ''
    expect(attempt).toContain(zhCopy.attemptUnknown)
    expect(attempt).not.toContain(status)
    expect(attempt).not.toContain(zhCopy.errorHTTP)
  })

  it('shows a fresh snapshot gap as the previous catalog when the latest attempt fell back', async () => {
    const view = await mountPanel({
      diagnostics: freshDiagnostics({
        last_attempt: { started_at: FETCHED_AT, finished_at: '2026-10-25T11:40:00.000Z', status: 'configured_fallback' }
      })
    })
    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy.attemptFallback)
    expect(view.text()).toContain(zhCopy.fallbackNotice)
    expect(view.text()).toContain(zhCopy.previousCatalogValid)
    expect(view.text()).not.toContain(zhCopy.attemptSuccess)
    fireEvent.click(view.get('grok-diagnostics-difference-toggle'))
    expect(view.get('grok-diagnostics-difference-list').textContent).toContain('grok-composer-2.5-fast')
  })

  it('does not invent a success time or current gaps when fallback has no trusted catalog', async () => {
    const view = await mountPanel({
      diagnostics: freshDiagnostics({
        state: 'unknown',
        fetched_at: undefined,
        expires_at: undefined,
        models: ['configured-only'],
        last_attempt: { started_at: FETCHED_AT, finished_at: '2026-10-25T11:40:00.000Z', status: 'configured_fallback' },
        mappings: [{ requested: 'composer-2.5', upstream: 'grok-composer-2.5-fast', status: 'not_listed' }]
      })
    })
    expect(view.find('grok-diagnostics-missing-summary')).toBeNull()
    expect(view.text()).toContain(zhCopy.unknownNotice)
    expect(view.get('grok-diagnostics-last-success').textContent).toContain(zhCopy.unknown)
    view.openDetails()
    expect(view.text()).toContain('configured-only')
    expect(view.text()).toContain(zhCopy.historicalComparison)
  })

  it('keeps refresh failure, the unsaved hint, and trusted gaps together', async () => {
    const view = await mountPanel({ diagnostics: freshDiagnostics(), refreshFailed: true, dirty: true, loading: true })
    expect(view.get('grok-diagnostics-refresh-failed').textContent).toBe(zhCopy.refreshFailed)
    expect(view.get('grok-diagnostics-dirty').textContent).toContain(zhCopy.savedConfigHint)
    expect(view.text()).toContain(zhCommon.common.loading)
    expect(view.get('grok-diagnostics-missing-summary')).toBeTruthy()
    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy.fresh)
  })

  it('counts each not_listed mapping and lists only those in the differences', async () => {
    const view = await mountPanel({
      diagnostics: freshDiagnostics({
        mappings: [
          { requested: 'composer-a', upstream: 'grok-composer-2.5-fast', status: 'not_listed' },
          { requested: 'composer-b', upstream: 'grok-composer-2.5-fast', status: 'not_listed' },
          { requested: 'custom-*', status: 'unverifiable' }
        ]
      })
    })
    expect(view.get('grok-diagnostics-summary').textContent).toContain(zhCopy.modelCount.replace('{count}', '4'))
    expect(view.get('grok-diagnostics-missing-summary').textContent).toContain(zhCopy.missingSummary.replace('{count}', '2'))
    fireEvent.click(view.get('grok-diagnostics-difference-toggle'))
    const diffs = view.get('grok-diagnostics-difference-list').textContent ?? ''
    expect(diffs).toContain('composer-a')
    expect(diffs).toContain('composer-b')
    expect(diffs.split(NOT_LISTED_ZH).length - 1).toBe(1)
    expect(diffs).not.toContain('custom-*')
  })

  it('omits the gap warning when nothing is missing', async () => {
    const view = await mountPanel({
      diagnostics: freshDiagnostics({ mappings: [{ requested: 'friendly', upstream: 'grok-4.7', status: 'listed' }] })
    })
    expect(view.find('grok-diagnostics-missing-summary')).toBeNull()
    expect(view.find('grok-diagnostics-difference-toggle')).toBeNull()
    view.openDetails()
    expect(view.get('grok-diagnostics-mappings').textContent).toContain(zhCopy.currentListed)
  })

  it('shows unknown with no diagnostics and offers no sync by default', async () => {
    const view = await mountPanel()
    expect(view.get('grok-diagnostics-state').textContent).toBe(zhCopy.unknown)
    expect(view.find('grok-diagnostics-sync')).toBeNull()
  })

  it('names the sync button with its visible label and saved-config title, and ignores clicks while syncing', async () => {
    const onSync = vi.fn()
    const view = await mountPanel({ diagnostics: freshDiagnostics(), canSync: true, onSync }, 'en')
    const button = view.get('grok-diagnostics-sync')
    expect(button.textContent).toContain(enCopy.syncCatalog)
    expect(button.getAttribute('aria-label')).toContain(enCopy.syncCatalog)
    expect(button.getAttribute('aria-label')).toContain(enCopy.syncSavedConfig)
    expect(button.getAttribute('title')).toBe(enCopy.syncSavedConfig)
    fireEvent.click(button)
    expect(onSync).toHaveBeenCalledTimes(1)

    view.setProps({ syncing: true })
    fireEvent.click(view.get('grok-diagnostics-sync'))
    expect(onSync).toHaveBeenCalledTimes(1)
    expect(view.get('grok-diagnostics-sync').hasAttribute('disabled')).toBe(true)
  })

  it('advances the relative success time as the clock moves', async () => {
    const view = await mountPanel({
      diagnostics: freshDiagnostics({ fetched_at: '2026-10-25T11:58:30.000Z', expires_at: '2026-10-25T18:00:00.000Z' })
    }, 'en')
    const line = () => view.get('grok-diagnostics-last-success').textContent ?? ''
    expect(line()).toContain('1m ago')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(line()).toContain('2m ago')
  })

  it('shows only the parsed host in the summary and the full endpoint in details', async () => {
    const endpoint = 'https://user:secret@relay.example.com/v1/models?token=abc'
    const view = await mountPanel({ diagnostics: freshDiagnostics({ endpoint }) })
    const summary = view.get('grok-diagnostics-summary').textContent ?? ''
    expect(summary).toContain('relay.example.com')
    expect(summary).not.toContain('secret')
    expect(summary).not.toContain('/v1/models')
    view.openDetails()
    expect(view.get('grok-diagnostics-endpoint').textContent).toBe(endpoint)
  })

  it('does not invent a host for an unparseable source', async () => {
    const view = await mountPanel({ diagnostics: freshDiagnostics({ endpoint: 'not a url' }) })
    expect(view.get('grok-diagnostics-summary').textContent).not.toContain('not a url')
    view.openDetails()
    expect(view.get('grok-diagnostics-endpoint').textContent).toBe('not a url')
  })

  it('connects disclosures with unique ids and clears its clock on unmount', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    await act(async () => {
      await setLocale('zh')
    })
    const diagnostics = freshDiagnostics()
    const view = render(
      <div>
        <GrokModelDiagnosticsPanel diagnostics={diagnostics} canSync />
        <GrokModelDiagnosticsPanel diagnostics={diagnostics} canSync />
      </div>
    )
    const detailToggles = Array.from(view.container.querySelectorAll('[data-testid="grok-diagnostics-details-toggle"]'))
    const diffToggles = Array.from(view.container.querySelectorAll('[data-testid="grok-diagnostics-difference-toggle"]'))
    const detailIds = detailToggles.map((button) => button.getAttribute('aria-controls'))
    const diffIds = diffToggles.map((button) => button.getAttribute('aria-controls'))
    expect(new Set(detailIds).size).toBe(2)
    expect(new Set(diffIds).size).toBe(2)
    expect(detailIds[0]).toMatch(/^grok-catalog-/)
    expect(diffIds[0]).toMatch(/^grok-differences-/)
    fireEvent.click(detailToggles[0])
    expect(detailToggles[0].getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(detailIds[0]!)?.getAttribute('data-testid')).toBe('grok-diagnostics-details')
    expect(view.container.querySelectorAll('[data-testid="grok-diagnostics-details"]')).toHaveLength(1)
    view.unmount()
    expect(clearSpy).toHaveBeenCalled()
  })

  it('keeps details open when the same panel receives updated diagnostics', async () => {
    const view = await mountPanel({ diagnostics: freshDiagnostics() })
    view.openDetails()
    view.setProps({ diagnostics: freshDiagnostics({ models: ['grok-4.5', 'grok-extra'] }) })
    expect(view.get('grok-diagnostics-details-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(view.text()).toContain('grok-extra')
  })
})
