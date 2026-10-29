import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { SelectProps } from '@/components/common/Select'
import OpsAlertEventsCard from '../OpsAlertEventsCard'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const { listAlertEvents, showError, selects, i18n } = vi.hoisted(() => ({
  listAlertEvents: vi.fn(),
  showError: vi.fn(),
  // 记录每个筛选下拉的最新 props（按 aria-label），用于触发 onChange
  selects: new Map<string, SelectProps>(),
  i18n: { t: (key: string) => key, te: () => true, locale: 'en' },
}))

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
vi.mock('@/api/admin/ops', async (importOriginal) => {
  const opsAPI = { listAlertEvents }
  return { ...(await importOriginal<object>()), opsAPI, default: opsAPI }
})
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError, showSuccess: vi.fn() }) } }))
vi.mock('@/components/common/Select', () => ({
  default: (props: SelectProps & { 'aria-label'?: string }) => {
    selects.set(String(props['aria-label']), props)
    return <div className="select-stub" />
  },
}))
// 表格只需呈现行 ID，避免虚拟滚动与布局测量
vi.mock('@/components/common/DataTable', () => ({
  default: ({ data }: { data: Array<{ id: number }> }) => (
    <div>{data.map((row) => <div key={row.id} data-testid="alert-row">{row.id}</div>)}</div>
  ),
}))
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children }: { show: boolean; children?: ReactNode }) => (show ? <div>{children}</div> : null),
}))

afterEach(cleanup)

const rows = (first: number, count = 10) => Array.from({ length: count }, (_, i) => ({
  id: first + i, severity: 'P1', status: 'firing', created_at: '2026-10-03T00:00:00Z',
}))
const ids = (list: Array<{ id: number }>) => list.map((row) => String(row.id))

const flush = () => act(async () => {})
const renderedIds = () => screen.queryAllByTestId('alert-row').map((row) => row.textContent)
const changeSeverity = (value: string) => act(() => { selects.get('admin.ops.alertEvents.table.severity')!.onChange!(value, null) })
// 滚动到底部附近触发加载更多（jsdom 中尺寸均为 0，任意滚动都视为接近底部）
const scrollToBottom = () => act(() => { fireEvent.scroll(screen.getByTestId('ops-alert-events-frame')) })
const isLoadingMore = () => screen.queryByText('admin.ops.alertEvents.loading') !== null
const reachedEnd = () => screen.queryByTestId('ops-alert-events-end') !== null

describe('alert events filtered pagination', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    selects.clear()
  })

  it.each(['resolve', 'reject'] as const)('ignores a superseded first page that %ss', async (outcome) => {
    const old = deferred<ReturnType<typeof rows>>()
    listAlertEvents.mockReturnValueOnce(old.promise).mockResolvedValueOnce(rows(100))
    render(<OpsAlertEventsCard />)
    changeSeverity('P2')
    await flush()
    if (outcome === 'resolve') old.resolve(rows(1))
    else old.reject(new Error('obsolete request'))
    await flush()
    expect(renderedIds()).toEqual(ids(rows(100)))
    expect(reachedEnd()).toBe(false) // hasMore 仍为 true
    expect(showError).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)('ignores an old next page that %ss after changing filters', async (outcome) => {
    const old = deferred<ReturnType<typeof rows>>()
    const current = deferred<ReturnType<typeof rows>>()
    listAlertEvents.mockResolvedValueOnce(rows(1)).mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(rows(100)).mockReturnValueOnce(current.promise)
    render(<OpsAlertEventsCard />)
    await flush()
    scrollToBottom() // 旧的下一页请求（old）
    expect(listAlertEvents).toHaveBeenCalledTimes(2)
    changeSeverity('P2')
    await flush()
    expect(isLoadingMore()).toBe(false)
    scrollToBottom() // 新筛选下的下一页请求（current）
    expect(listAlertEvents).toHaveBeenCalledTimes(4)
    if (outcome === 'resolve') old.resolve(rows(11, 1))
    else old.reject(new Error('obsolete request'))
    await flush()
    expect(isLoadingMore()).toBe(true)
    expect(renderedIds()).toEqual(ids(rows(100)))
    expect(reachedEnd()).toBe(false)
    current.resolve(rows(110, 1))
    await flush()
    expect(renderedIds()).toEqual(ids([...rows(100), ...rows(110, 1)]))
    expect(reachedEnd()).toBe(true) // hasMore 变为 false
  })
})
