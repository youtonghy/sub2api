import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UsageFiltersHandle, UsageFiltersProps, UsageFiltersValue } from '@/components/admin/usage/UsageFilters'
import UsageView from '../UsageView'

const { list, exportList, getStats, getSnapshotV2, getById, getModelStats, listErrorLogs, aoaToSheet, sheetAddAoa, saveAs, xlsxWrite, captured } =
  vi.hoisted(() => ({
    list: vi.fn(),
    exportList: vi.fn(),
    getStats: vi.fn(),
    getSnapshotV2: vi.fn(),
    getById: vi.fn(),
    getModelStats: vi.fn(),
    listErrorLogs: vi.fn(),
    aoaToSheet: vi.fn((_rows: unknown[][]) => ({})),
    sheetAddAoa: vi.fn((_ws: unknown, _rows: unknown[][], _opts?: unknown) => {}),
    saveAs: vi.fn(),
    xlsxWrite: vi.fn(() => new Uint8Array([1, 2, 3])),
    captured: {
      filters: null as UsageFiltersProps | null,
      tableColumns: [] as Array<{ key: string; label: string }>,
      modelChart: null as null | { modelStats: unknown[]; filters: Record<string, unknown> }
    }
  }))

const messages: Record<string, string> = {
  'admin.dashboard.timeRange': 'Time Range',
  'admin.dashboard.day': 'Day',
  'admin.dashboard.hour': 'Hour',
  'admin.usage.failedToLoadUser': 'Failed to load user',
  'admin.usage.requestId': 'Request ID',
  'admin.usage.upstreamRequestId': 'Upstream ID',
  'usage.requestedModel': 'Requested model',
  'usage.sentUpstreamModel': 'Sent upstream model',
  'usage.upstreamResponseModel': 'Upstream response model',
  'usage.upstreamModelMismatch': 'Upstream model mismatch',
  'common.yes': 'Yes',
  'common.no': 'No'
}

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

vi.mock('@/api/admin', () => ({
  adminAPI: {
    usage: { list, getStats },
    dashboard: { getSnapshotV2, getModelStats },
    users: { getById }
  }
}))
vi.mock('@/api/admin/usage', () => ({ adminUsageAPI: { list: exportList } }))
vi.mock('file-saver', () => ({ saveAs }))
vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: aoaToSheet,
    sheet_add_aoa: sheetAddAoa,
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn()
  },
  write: xlsxWrite
}))
vi.mock('@/api/admin/ops', () => ({ listErrorLogs }))
vi.mock('@/stores/app', () => {
  const state = { showError: vi.fn(), showWarning: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }
  return {
    useAppStore: Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), { getState: () => state })
  }
})
vi.mock('@/utils/format', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/format')>()),
  formatReasoningEffort: (value: string | null | undefined) => value ?? '-'
}))
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => messages[key] ?? key, te: () => true, locale: 'en' })
}))

// ---- 子组件桩 ----
vi.mock('@/components/admin/usage/UsageFilters', () => ({
  default: function UsageFiltersStub(props: UsageFiltersProps & { ref?: Ref<UsageFiltersHandle> }) {
    captured.filters = props
    const [userKeyword, setUserKeyword] = useState('')
    const revision = useRef(0)
    useImperativeHandle(props.ref, () => ({
      getUserSearchRevision: () => revision.current,
      setUserKeyword: (email: string) => {
        revision.current += 1
        setUserKeyword(email)
      }
    }))
    return (
      <div>
        <span data-testid="user-filter-label">{userKeyword}</span>
        {props.afterReset}
      </div>
    )
  }
}))
vi.mock('@/components/admin/usage/UsageTable', () => ({
  default: (props: { columns: Array<{ key: string; label: string }>; onUserClick?: (id: number) => void }) => {
    captured.tableColumns = props.columns
    return (
      <div data-testid="usage-table">
        <button type="button" className="user-click" onClick={() => props.onUserClick?.(2)}>
          user
        </button>
      </div>
    )
  }
}))
vi.mock('@/components/admin/usage/UserTokenRanking', () => ({
  default: (props: { onSelectUser?: (id: number, email: string) => void }) => (
    <div data-testid="ranking">
      <button type="button" onClick={() => props.onSelectUser?.(5, 'rank@test.com')}>
        pick
      </button>
    </div>
  )
}))
vi.mock('@/components/charts/ModelDistributionChart', () => ({
  default: (props: { metric: string; modelStats: unknown[]; filters: Record<string, unknown>; onMetricChange?: (m: string) => void }) => {
    captured.modelChart = { modelStats: props.modelStats, filters: props.filters }
    return (
      <div data-testid="model-chart">
        <span className="metric">{props.metric}</span>
        <button type="button" onClick={() => props.onMetricChange?.('actual_cost')}>
          switch
        </button>
      </div>
    )
  }
}))
vi.mock('@/components/charts/GroupDistributionChart', () => ({
  default: (props: { metric: string; onMetricChange?: (m: string) => void }) => (
    <div data-testid="group-chart">
      <span className="metric">{props.metric}</span>
      <button type="button" onClick={() => props.onMetricChange?.('actual_cost')}>
        switch
      </button>
    </div>
  )
}))
vi.mock('@/components/charts/EndpointDistributionChart', () => ({ default: () => null }))
vi.mock('@/components/charts/TokenUsageTrend', () => ({ default: () => null }))
vi.mock('@/components/admin/usage/UsageStatsCards', () => ({ default: () => null }))
vi.mock('@/components/admin/usage/UsageExportProgress', () => ({ default: () => null }))
vi.mock('@/components/admin/usage/UsageCleanupDialog', () => ({ default: () => null }))
vi.mock('@/components/admin/user/UserBalanceHistoryModal', () => ({ default: () => null }))
vi.mock('@/components/common/Pagination', () => ({ default: () => null }))
vi.mock('@/components/common/Select', () => ({ default: () => null }))
vi.mock('@/components/common/DateRangePicker', () => ({ default: () => null }))
vi.mock('../ops/components/OpsErrorLogTable', () => ({ default: () => null }))
vi.mock('../ops/components/OpsErrorDetailModal', () => ({ default: () => null }))

const flushPromises = () => act(async () => {})
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms)
  })

const emptyStats = {
  total_requests: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_cache_tokens: 0,
  total_tokens: 0,
  total_cost: 0,
  total_actual_cost: 0,
  average_duration_ms: 0
}

function mountView(search = ''): ReturnType<typeof render> {
  const Wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[`/admin/usage${search}`]}>{children}</MemoryRouter>
  return render(<UsageView />, { wrapper: Wrapper })
}

const filtersProps = () => captured.filters!
const currentFilters = () => filtersProps().value as UsageFiltersValue
const userLabel = () => screen.getByTestId('user-filter-label').textContent
const detailTabs = () => screen.getAllByTestId('usage-detail-tab')
const selectTab = (index: number) =>
  act(async () => {
    fireEvent.mouseDown(detailTabs()[index], { button: 0, ctrlKey: false })
  })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  captured.filters = null
  captured.tableColumns = []
  captured.modelChart = null
  list.mockReset().mockResolvedValue({ items: [], total: 0, pages: 0 })
  getStats.mockReset().mockResolvedValue(emptyStats)
  getSnapshotV2.mockReset().mockResolvedValue({ trend: [], models: [], groups: [] })
  getModelStats.mockReset().mockResolvedValue({ models: [] })
  getById.mockReset()
  listErrorLogs.mockReset().mockResolvedValue({ items: [], total: 0, pages: 0 })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('admin UsageView route filters', () => {
  it('shows the routed user while applying user_id to usage requests', async () => {
    getById.mockResolvedValue({ id: 42, email: 'route-user@test.com' })

    mountView('?user_id=42')
    await flushPromises()

    expect(getById).toHaveBeenCalledWith(42, true)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ user_id: 42 }), expect.anything())
    expect(userLabel()).toBe('route-user@test.com')
  })

  it('does not apply a stale routed user label after user_id changes', async () => {
    let resolveLookup!: (user: { id: number; email: string }) => void
    getById.mockReturnValue(
      new Promise((resolve) => {
        resolveLookup = resolve
      })
    )

    mountView('?user_id=42')
    await flushPromises()
    await act(async () => {
      filtersProps().onValueChange?.({ ...currentFilters(), user_id: 84 })
    })
    await act(async () => {
      // 用户随后在筛选里选中了另一个用户
      ;(filtersProps() as { ref?: { current: UsageFiltersHandle | null } }).ref?.current?.setUserKeyword('current-user@test.com')
    })

    await act(async () => {
      resolveLookup({ id: 42, email: 'stale-user@test.com' })
    })
    await flushPromises()

    expect(userLabel()).toBe('current-user@test.com')
  })

  it('does not overwrite newer user input when the routed user lookup succeeds', async () => {
    let resolveLookup!: (user: { id: number; email: string }) => void
    getById.mockReturnValue(
      new Promise((resolve) => {
        resolveLookup = resolve
      })
    )

    mountView('?user_id=42')
    await flushPromises()
    await act(async () => {
      ;(filtersProps() as { ref?: { current: UsageFiltersHandle | null } }).ref?.current?.setUserKeyword('new-search@test.com')
    })

    await act(async () => {
      resolveLookup({ id: 42, email: 'route-user@test.com' })
    })
    await flushPromises()

    expect(currentFilters().user_id).toBe(42)
    expect(userLabel()).toBe('new-search@test.com')
  })

  it('does not overwrite newer user input when the routed user lookup fails', async () => {
    let rejectLookup!: (error: Error) => void
    getById.mockReturnValue(
      new Promise((_, reject) => {
        rejectLookup = reject
      })
    )

    mountView('?user_id=42')
    await flushPromises()
    await act(async () => {
      ;(filtersProps() as { ref?: { current: UsageFiltersHandle | null } }).ref?.current?.setUserKeyword('new-search@test.com')
    })

    await act(async () => {
      rejectLookup(new Error('lookup failed'))
    })
    await flushPromises()

    expect(currentFilters().user_id).toBe(42)
    expect(userLabel()).toBe('new-search@test.com')
  })

  it('shows the routed user ID when its label lookup fails', async () => {
    getById.mockRejectedValue(new Error('lookup failed'))

    mountView('?user_id=42')
    await flushPromises()

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ user_id: 42 }), expect.anything())
    expect(userLabel()).toBe('42')
  })
})

describe('admin UsageView native compaction filter', () => {
  it('propagates the filter to list/stats/model/snapshot requests and clears it on reset', async () => {
    mountView()
    await advance(120)
    await flushPromises()

    list.mockClear()
    getStats.mockClear()
    getModelStats.mockClear()
    getSnapshotV2.mockClear()

    // Vue 版：filters.native_compaction_v2 = true; applyFilters()
    await act(async () => {
      filtersProps().onChange?.({ ...currentFilters(), native_compaction_v2: true })
    })
    await flushPromises()

    expect(captured.modelChart!.filters.native_compaction_v2).toBe(true)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ native_compaction_v2: true }), expect.anything())
    expect(getStats).toHaveBeenCalledWith(expect.objectContaining({ native_compaction_v2: true }))
    expect(getModelStats).toHaveBeenCalledWith(expect.objectContaining({ native_compaction_v2: true }))
    expect(getSnapshotV2).toHaveBeenCalledWith(expect.objectContaining({ native_compaction_v2: true }))

    list.mockClear()
    getStats.mockClear()
    getModelStats.mockClear()
    getSnapshotV2.mockClear()

    await act(async () => {
      filtersProps().onReset?.()
    })
    await flushPromises()

    expect(currentFilters().native_compaction_v2).toBeNull()
    expect(captured.modelChart!.filters).not.toHaveProperty('native_compaction_v2')
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ native_compaction_v2: null }), expect.anything())
    expect(getStats).toHaveBeenCalledWith(expect.objectContaining({ native_compaction_v2: null }))
    expect(getModelStats).toHaveBeenCalledWith(expect.objectContaining({ native_compaction_v2: null }))
    expect(getSnapshotV2).toHaveBeenCalledWith(expect.objectContaining({ native_compaction_v2: null }))
  })
})

describe('admin UsageView distribution metric toggles', () => {
  it('keeps previous model stats visible during refresh until new data arrives', async () => {
    // 首次加载返回 A
    getModelStats.mockResolvedValueOnce({ models: [{ model: 'A', total_tokens: 10 }] })

    mountView()
    await advance(120)
    await flushPromises()
    expect(captured.modelChart!.modelStats).toEqual([{ model: 'A', total_tokens: 10 }])

    // 刷新:让第二次 getModelStats 处于 pending,断言旧数据 A 仍在(不被清空成 [])
    let resolveSecond: (v: unknown) => void = () => {}
    getModelStats.mockReturnValueOnce(
      new Promise((res) => {
        resolveSecond = res
      })
    )
    await act(async () => {
      filtersProps().onRefresh?.()
    })
    await flushPromises()
    expect(captured.modelChart!.modelStats).toEqual([{ model: 'A', total_tokens: 10 }])

    // 新数据到达后替换为 B
    await act(async () => {
      resolveSecond({ models: [{ model: 'B', total_tokens: 20 }] })
    })
    await flushPromises()
    expect(captured.modelChart!.modelStats).toEqual([{ model: 'B', total_tokens: 20 }])
  })

  it('keeps model and group metric toggles independent without refetching chart data', async () => {
    mountView()
    await advance(120)
    await flushPromises()

    expect(getSnapshotV2).toHaveBeenCalledTimes(1)
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    expect(getSnapshotV2).toHaveBeenCalledWith(
      expect.objectContaining({
        start_date: formatLocalDate(yesterday),
        end_date: formatLocalDate(now),
        granularity: 'hour'
      })
    )

    const modelChart = screen.getByTestId('model-chart')
    const groupChart = screen.getByTestId('group-chart')
    const metricOf = (el: HTMLElement) => el.querySelector('.metric')!.textContent

    expect(metricOf(modelChart)).toBe('tokens')
    expect(metricOf(groupChart)).toBe('tokens')

    fireEvent.click(modelChart.querySelector('button')!)
    await flushPromises()

    expect(metricOf(screen.getByTestId('model-chart'))).toBe('actual_cost')
    expect(metricOf(screen.getByTestId('group-chart'))).toBe('tokens')
    expect(getSnapshotV2).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('group-chart').querySelector('button')!)
    await flushPromises()

    expect(metricOf(screen.getByTestId('model-chart'))).toBe('actual_cost')
    expect(metricOf(screen.getByTestId('group-chart'))).toBe('actual_cost')
    expect(getSnapshotV2).toHaveBeenCalledTimes(1)
  })
})

describe('admin UsageView request ID column visibility', () => {
  const openColumnSettings = async () => {
    await act(async () => {
      fireEvent.click(screen.getByTitle('admin.users.columnSettings'))
    })
  }
  const toggleButton = (label: string) => screen.getAllByRole('menuitemcheckbox').find((button) => button.textContent === label)

  it('keeps request ID hidden by default and allows enabling it from column settings', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    mountView()
    await flushPromises()

    expect(captured.tableColumns).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: 'request_id' })]))

    await openColumnSettings()
    const requestIdToggle = toggleButton('Request ID')
    expect(requestIdToggle).toBeDefined()
    fireEvent.click(requestIdToggle!)
    await flushPromises()

    expect(captured.tableColumns).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'request_id', label: 'Request ID' })]))
    expect(setItem).toHaveBeenCalledWith('usage-hidden-columns-version', 'upstream-request-id-hidden-by-default')
  })

  it('keeps upstream ID hidden by default and allows enabling it from column settings', async () => {
    mountView()
    await flushPromises()

    expect(captured.tableColumns).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: 'upstream_request_id' })]))

    await openColumnSettings()
    const upstreamToggle = toggleButton('Upstream ID')
    expect(upstreamToggle).toBeDefined()
    fireEvent.click(upstreamToggle!)
    await flushPromises()

    expect(captured.tableColumns).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'upstream_request_id', label: 'Upstream ID' })])
    )
  })
})

describe('admin UsageView handleUserClick', () => {
  it('opens user via include_deleted when clicking a usage row user', async () => {
    getById.mockResolvedValue({ id: 2, email: 'd@test.com', deleted_at: '2026-05-28T00:00:00Z' })

    mountView()
    await advance(120)
    await flushPromises()

    fireEvent.click(screen.getByTestId('usage-table').querySelector('.user-click')!)
    await flushPromises()

    expect(getById).toHaveBeenCalledWith(2, true)
  })
})

describe('admin UsageView errors tab filter forwarding', () => {
  it('forwards model/account_id/group_id to listErrorLogs on the errors tab', async () => {
    mountView()
    await advance(120)
    await flushPromises()

    // 模拟用户在过滤器里选择了模型/账户/分组
    await act(async () => {
      filtersProps().onValueChange?.({ ...currentFilters(), model: 'gpt-5.3-codex', account_id: 7, group_id: 3 })
    })
    await flushPromises()

    // 切换到「错误请求」标签（第二个 tab）触发 loadAdminErrors
    await selectTab(1)
    await flushPromises()

    expect(listErrorLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        view: 'all',
        model: 'gpt-5.3-codex',
        account_id: 7,
        group_id: 3
      })
    )
  })
})

describe('admin UsageView ranking tab', () => {
  it('mounts ranking lazily and drill-down sets user filter then jumps back to usage tab', async () => {
    mountView()
    await advance(120)
    await flushPromises()

    // 懒挂载:切到排行 tab 前不渲染
    expect(screen.queryByTestId('ranking')).toBeNull()

    expect(detailTabs()).toHaveLength(3)
    await selectTab(2)
    await flushPromises()
    expect(screen.getByTestId('ranking')).toBeInTheDocument()

    // 下钻:设置 user_id、切回用量明细 tab 并按新筛选重新拉取列表
    list.mockClear()
    fireEvent.click(screen.getByTestId('ranking').querySelector('button')!)
    await flushPromises()

    expect(detailTabs()[0]).toHaveAttribute('aria-selected', 'true')
    expect(currentFilters().user_id).toBe(5)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ user_id: 5 }), expect.anything())
  })
})

describe('admin UsageView model audit export', () => {
  beforeEach(() => {
    exportList.mockReset().mockResolvedValue({
      items: [
        {
          id: 1,
          created_at: '2026-08-04T00:00:00Z',
          model: 'gpt-5.6-sol',
          upstream_model: 'gpt-5.5',
          upstream_response_model: 'gpt-5.4',
          upstream_model_mismatch: true,
          request_type: 'sync',
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          duration_ms: 10
        }
      ],
      total: 1,
      pages: 1
    })
    aoaToSheet.mockClear()
    sheetAddAoa.mockClear()
    saveAs.mockClear()
    xlsxWrite.mockClear()
  })

  it('exports requested, sent, response, and mismatch as separate admin columns', async () => {
    mountView()
    await advance(120)
    await flushPromises()
    await act(async () => {
      filtersProps().onValueChange?.({ ...currentFilters(), native_compaction_v2: true })
    })

    await act(async () => {
      filtersProps().onExport?.()
    })
    await flushPromises()
    await flushPromises()

    expect(exportList).toHaveBeenCalledWith(expect.objectContaining({ native_compaction_v2: true }), expect.anything())

    const headers = aoaToSheet.mock.calls[0][0][0] as string[]
    expect(headers.slice(4, 8)).toEqual(['Requested model', 'Sent upstream model', 'Upstream response model', 'Upstream model mismatch'])
    const row = sheetAddAoa.mock.calls[0][1][0] as unknown[]
    expect(row.slice(4, 8)).toEqual(['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'Yes'])
    expect(saveAs).toHaveBeenCalledTimes(1)
  })
})
