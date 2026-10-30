import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import UsageFilters, { type UsageFiltersValue } from '../UsageFilters'

// --- i18n messages (only what UsageFilters needs) ---
const messages: Record<string, string> = {
  'admin.usage.userDeletedBadge': 'deleted',
  'admin.usage.userFilter': 'User',
  'admin.usage.searchUserPlaceholder': 'Search user...',
  'usage.apiKeyFilter': 'API Key',
  'admin.usage.searchApiKeyPlaceholder': 'Search API key...',
  'usage.model': 'Model',
  'admin.usage.allModels': 'All Models',
  'admin.usage.account': 'Account',
  'admin.usage.searchAccountPlaceholder': 'Search account...',
  'usage.type': 'Type',
  'admin.usage.allTypes': 'All Types',
  'usage.ws': 'WS',
  'usage.stream': 'Stream',
  'usage.sync': 'Sync',
  'usage.compactionFilter': 'Request Kind',
  'usage.allCompactionTypes': 'All Requests',
  'usage.compactionOnly': 'Compaction Only',
  'admin.usage.billingType': 'Billing Type',
  'admin.usage.allBillingTypes': 'All Billing Types',
  'admin.usage.billingTypeBalance': 'Balance',
  'admin.usage.billingTypeSubscription': 'Subscription',
  'admin.usage.billingMode': 'Billing Mode',
  'admin.usage.allBillingModes': 'All Billing Modes',
  'admin.usage.billingModeToken': 'Token',
  'admin.usage.billingModePerRequest': 'Per Request',
  'admin.usage.billingModeImage': 'Image',
  'admin.usage.upstreamModelAudit': 'Upstream model audit',
  'admin.usage.allUpstreamModelAudit': 'All response model states',
  'admin.usage.upstreamModelMismatchOnly': 'Mismatched only',
  'admin.usage.upstreamModelMatchedOnly': 'Matched only',
  'admin.usage.group': 'Group',
  'admin.usage.allGroups': 'All Groups',
  'common.refresh': 'Refresh',
  'common.reset': 'Reset',
  'admin.usage.cleanup.button': 'Cleanup',
  'usage.exportExcel': 'Export'
}

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => messages[key] ?? key, te: () => true, locale: 'en' })
}))

// Mock the admin API module — we control searchUsers return value per test
const mockSearchUsers = vi.fn()
const mockSearchApiKeys = vi.fn().mockResolvedValue([])
const mockGroupsList = vi.fn().mockResolvedValue({ items: [] })
const mockGetModelStats = vi.fn().mockResolvedValue({ models: [] })
const mockAccountsList = vi.fn().mockResolvedValue({ items: [] })

vi.mock('@/api/admin', () => ({
  adminAPI: {
    usage: {
      searchUsers: (...args: unknown[]) => mockSearchUsers(...args),
      searchApiKeys: (...args: unknown[]) => mockSearchApiKeys(...args)
    },
    groups: { list: (...args: unknown[]) => mockGroupsList(...args) },
    dashboard: { getModelStats: (...args: unknown[]) => mockGetModelStats(...args) },
    accounts: { list: (...args: unknown[]) => mockAccountsList(...args) }
  }
}))

interface SelectStubProps {
  value: unknown
  options: Array<{ value: unknown; label: string }>
  onChange?: (value: unknown) => void
  'aria-label'?: string
}
const selectProps: SelectStubProps[] = []
vi.mock('@/components/common/Select', () => ({
  default: (props: SelectStubProps) => {
    selectProps.push(props)
    return <div data-testid="select-stub" data-label={props['aria-label']} />
  }
}))

afterEach(cleanup)

const flushPromises = () => act(async () => {})

// Default props helper
const defaultFilters = (): UsageFiltersValue => ({
  user_id: undefined,
  api_key_id: undefined,
  account_id: undefined,
  model: null,
  request_type: null,
  native_compaction_v2: null,
  billing_type: null,
  billing_mode: null,
  upstream_model_mismatch: null,
  group_id: null,
  start_date: '',
  end_date: ''
})

/** 受控外壳：模拟父组件持有筛选（Vue 版 v-model 就地修改） */
function mountFilters(filters = defaultFilters(), modelOptions: string[] = []) {
  const onChange = vi.fn()
  const latest = { current: filters }
  function Harness() {
    const [value, setValue] = useState(filters)
    return (
      <UsageFilters
        value={value}
        onValueChange={(next) => {
          latest.current = next
          setValue(next)
        }}
        onChange={(next) => {
          latest.current = next
          setValue(next)
          onChange(next)
        }}
        exporting={false}
        startDate="2026-05-01"
        endDate="2026-05-28"
        showActions={false}
        modelOptions={modelOptions}
      />
    )
  }
  const view = render(<Harness />)
  return { ...view, onChange, latest }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

const userInput = () => screen.getByPlaceholderText('Search user...')
const typeUser = async (text: string) => {
  fireEvent.change(userInput(), { target: { value: text } })
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
  await flushPromises()
}

describe('UsageFilters — user search dropdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSearchUsers.mockReset()
    mockSearchApiKeys.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('(a) labels deleted users with the i18n badge and (b) sorts active users before deleted ones, (c) selection sets user_id', async () => {
    // Arrange: mock returns deleted FIRST (proves sorting re-orders to active-first)
    mockSearchUsers.mockResolvedValue([
      { id: 2, email: 'gone@test.com', deleted: true },
      { id: 1, email: 'active@test.com', deleted: false }
    ])

    const { onChange, latest } = mountFilters()

    // Trigger focus (shows dropdown) then input (fires debounced search)
    fireEvent.focus(userInput())
    await typeUser('test')

    // --- (b) Sort: active user should appear BEFORE deleted user ---
    const buttons = Array.from(screen.getByTestId('usage-filter-user').querySelectorAll('[role="option"]'))
    const emailTexts = buttons.map((b) => b.textContent ?? '')

    const activeIdx = emailTexts.findIndex((t) => t.includes('active@test.com'))
    const deletedIdx = emailTexts.findIndex((t) => t.includes('gone@test.com'))
    expect(activeIdx).toBeGreaterThanOrEqual(0)
    expect(deletedIdx).toBeGreaterThanOrEqual(0)
    expect(activeIdx).toBeLessThan(deletedIdx)

    // --- (a) Label: deleted user's button shows the badge text ---
    expect(buttons[deletedIdx].textContent).toContain('deleted')
    expect(buttons[activeIdx].textContent).not.toContain('deleted')

    // --- (c) Selection: clicking active user button sets user_id and emits change ---
    fireEvent.click(buttons[activeIdx])
    await flushPromises()

    expect(onChange).toHaveBeenCalled()
    expect(latest.current.user_id).toBe(1)
  })

  it('keeps results from the latest user search when responses arrive out of order', async () => {
    const firstSearch = deferred<Array<{ id: number; email: string; deleted: boolean }>>()
    const secondSearch = deferred<Array<{ id: number; email: string; deleted: boolean }>>()
    mockSearchUsers.mockImplementationOnce(() => firstSearch.promise).mockImplementationOnce(() => secondSearch.promise)

    const { container } = mountFilters()
    fireEvent.focus(userInput())

    await typeUser('a')
    await typeUser('ab')

    await act(async () => {
      secondSearch.resolve([{ id: 2, email: 'ab@test.com', deleted: false }])
    })
    expect(container.textContent).toContain('ab@test.com')

    await act(async () => {
      firstSearch.resolve([{ id: 1, email: 'a@test.com', deleted: false }])
    })
    expect(container.textContent).toContain('ab@test.com')
    expect(container.textContent).not.toContain('a@test.com')
  })

  it('does not restore stale user results after the search is cleared', async () => {
    const pendingSearch = deferred<Array<{ id: number; email: string; deleted: boolean }>>()
    mockSearchUsers.mockImplementationOnce(() => pendingSearch.promise)

    const { container } = mountFilters()
    fireEvent.focus(userInput())

    await typeUser('stale')
    await typeUser('')

    await act(async () => {
      pendingSearch.resolve([{ id: 3, email: 'stale@test.com', deleted: false }])
    })
    expect(container.textContent).not.toContain('stale@test.com')
  })
})

describe('UsageFilters — model options come from prop (no dup request)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGetModelStats.mockClear()
    mockGroupsList.mockClear()
    selectProps.length = 0
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not call dashboard.getModelStats on mount and renders model options from prop', async () => {
    mountFilters(defaultFilters(), ['claude-3', 'gpt-4o'])
    await flushPromises()

    expect(mockGetModelStats).not.toHaveBeenCalled()

    const modelSelect = selectProps.filter((p) => p['aria-label'] === 'Model').at(-1)!
    expect(modelSelect.options.map((o) => o.value)).toEqual([null, 'claude-3', 'gpt-4o'])
  })
})

describe('UsageFilters — native compaction filter', () => {
  beforeEach(() => {
    selectProps.length = 0
  })

  it('offers only All/Compaction and emits the independent boolean filter', async () => {
    const { onChange, latest } = mountFilters()
    await flushPromises()

    const compactionSelect = selectProps.find((select) => select.options.some((option) => option.value === true))
    expect(compactionSelect).toBeDefined()
    expect(compactionSelect!.options).toEqual([
      { value: null, label: 'All Requests' },
      { value: true, label: 'Compaction Only' }
    ])
    expect(compactionSelect!.options).not.toEqual(expect.arrayContaining([expect.objectContaining({ value: false })]))

    await act(async () => {
      compactionSelect!.onChange?.(true)
    })

    expect(latest.current.native_compaction_v2).toBe(true)
    expect(onChange).toHaveBeenCalled()
  })
})
