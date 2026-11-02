import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { OpsDashboardOverview } from '@/api/admin/ops'
import OpsDashboardHeader from '../OpsDashboardHeader'
import OpsRequestDetailsModal, { type OpsRequestDetailsModalProps } from '../OpsRequestDetailsModal'
import { resetAccountNameCacheForTests } from '../../utils/accountNameMap'

const { listRequestDetails, listAccounts, viewport, i18n } = vi.hoisted(() => ({
  listRequestDetails: vi.fn(),
  listAccounts: vi.fn(),
  viewport: { desktop: true },
  i18n: { t: (key: string) => key, te: () => true, locale: 'en' },
}))

vi.mock('../../hooks/useMediaQuery', () => ({ useMediaQuery: () => viewport.desktop }))
vi.mock('@/api/admin/ops', async (importOriginal) => {
  const opsAPI = { listRequestDetails, getRealtimeTrafficSummary: vi.fn().mockResolvedValue({ enabled: false, summary: null }) }
  return { ...(await importOriginal<object>()), opsAPI, default: opsAPI }
})
vi.mock('@/api/admin/accounts', () => ({ accountsAPI: { list: listAccounts } }))
vi.mock('@/api', () => ({ adminAPI: { groups: { getAll: vi.fn().mockResolvedValue([]) } } }))
vi.mock('@/stores', () => {
  const settings = { opsRealtimeMonitoringEnabled: false, setOpsRealtimeMonitoringEnabledLocal: vi.fn() }
  const app = { showError: vi.fn(), showWarning: vi.fn() }
  const useAdminSettingsStore = Object.assign((selector: (s: typeof settings) => unknown) => selector(settings), { getState: () => settings })
  const useAppStore = Object.assign((selector: (s: typeof app) => unknown) => selector(app), { getState: () => app })
  return { useAdminSettingsStore, useAppStore }
})
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: vi.fn() }) }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))
vi.mock('@/components/common/BaseDialog', () => ({
  default: ({ show, children }: { show: boolean; children?: ReactNode }) => (show ? <div data-testid="dialog">{children}</div> : null),
}))
vi.mock('@/components/common/Pagination', () => ({ default: () => null }))
vi.mock('@/components/common/Select', () => ({ default: () => <div data-testid="select-stub" /> }))
vi.mock('@/components/common/HelpTooltip', () => ({ default: () => null }))

afterEach(cleanup)

async function openDetails(sort: 'duration_desc' | 'ttft_desc') {
  const props: OpsRequestDetailsModalProps = { show: false, timeRange: '1h', preset: { title: 'Details', sort } }
  const utils = render(<OpsRequestDetailsModal {...props} />)
  utils.rerender(<OpsRequestDetailsModal {...props} show />)
  await waitFor(() => expect(listRequestDetails).toHaveBeenCalled())
  await act(async () => {})
  return utils
}

describe('Ops request latency details', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAccountNameCacheForTests()
    viewport.desktop = true
    listRequestDetails.mockResolvedValue({
      items: [
        { kind: 'success', created_at: '2026-09-10T00:00:00Z', duration_ms: 12000, first_token_ms: 800, account_id: 101 },
        { kind: 'success', created_at: '2026-09-10T00:00:01Z', duration_ms: 9000, first_token_ms: 0, account_id: 102 },
        { kind: 'success', created_at: '2026-09-10T00:00:02Z', duration_ms: 5000, first_token_ms: null, account_id: 999 },
      ],
      total: 3,
    })
    listAccounts.mockResolvedValue({
      items: [
        { id: 101, name: 'acc-alpha' },
        { id: 102, name: 'acc-beta' },
      ],
      total: 2,
    })
  })

  it('opens the TTFT card with first-token sorting and successful requests', async () => {
    const onOpenRequestDetails = vi.fn()
    render(
      <OpsDashboardHeader
        overview={{} as OpsDashboardOverview}
        platform=""
        groupId={null}
        timeRange="1h"
        queryMode="auto"
        loading={false}
        lastUpdated={null}
        onOpenRequestDetails={onOpenRequestDetails}
      />,
    )
    await act(async () => {})
    const button = screen.getAllByRole('button').find((item) =>
      item.textContent === 'admin.ops.requestDetails.details' &&
      item.parentElement?.textContent?.includes('TTFT'),
    )
    expect(button).toBeDefined()
    fireEvent.click(button!)
    expect(onOpenRequestDetails.mock.calls).toEqual([[
      { title: 'admin.ops.ttftLabel', kind: 'success', sort: 'ttft_desc' },
    ]])
  })

  it.each([true, false])('shows TTFT rather than total duration (desktop: %s)', async (desktop) => {
    viewport.desktop = desktop
    const { container } = await openDetails('ttft_desc')
    expect(listRequestDetails).toHaveBeenCalledWith(expect.objectContaining({ sort: 'ttft_desc' }))
    const text = container.textContent
    expect(text).toContain('admin.ops.ttftLabel')
    expect(text).toContain('800 ms')
    expect(text).toContain('0 ms')
    expect(text).not.toContain('12000 ms')
    expect(text).not.toContain('9000 ms')
    expect(text).not.toContain('5000 ms')
    if (desktop) expect(container.querySelectorAll('tbody tr')[2].querySelectorAll('td')[5].textContent).toBe('-')
    else expect(text).toContain('admin.ops.ttftLabel: -')
  })

  it('shows account names with id fallback in the account column', async () => {
    const { container } = await openDetails('ttft_desc')
    expect(container.textContent).toContain('admin.ops.requestDetails.table.account')
    await waitFor(() => {
      const accountCells = Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.querySelectorAll('td')[4].textContent)
      expect(accountCells).toEqual(['acc-alpha', 'acc-beta', '#999'])
    })
    // 999 不在账号映射里，应触发一次强制刷新重建缓存
    expect(listAccounts).toHaveBeenCalledTimes(2)
  })

  it('keeps total duration for duration details', async () => {
    const { container } = await openDetails('duration_desc')
    expect(listRequestDetails).toHaveBeenCalledWith(expect.objectContaining({ sort: 'duration_desc' }))
    expect(container.textContent).toContain('admin.ops.requestDetails.table.duration')
    expect(container.textContent).toContain('12000 ms')
    expect(container.textContent).not.toContain('800 ms')
  })
})

// React 版补充：从单条错误详情返回（resumeState=true）时保留分页与数据，父组件随后把 resumeState
// 复位为 false 也不能触发重置或重新请求（对应 Vue 的 watch(modelValue) 语义）。
describe('Ops request details resume state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAccountNameCacheForTests()
    viewport.desktop = true
    listRequestDetails.mockResolvedValue({ items: [{ kind: 'success', created_at: '2026-09-10T00:00:00Z', duration_ms: 10 }], total: 1 })
    listAccounts.mockResolvedValue({ items: [], total: 0 })
  })

  it('does not refetch when reopened with resumeState or when resumeState flips back', async () => {
    const base: OpsRequestDetailsModalProps = { show: false, timeRange: '1h', preset: { title: 'Details' } }
    const { rerender } = render(<OpsRequestDetailsModal {...base} />)
    rerender(<OpsRequestDetailsModal {...base} show />)
    await waitFor(() => expect(listRequestDetails).toHaveBeenCalledTimes(1))

    rerender(<OpsRequestDetailsModal {...base} show={false} />)
    rerender(<OpsRequestDetailsModal {...base} show resumeState />)
    rerender(<OpsRequestDetailsModal {...base} show resumeState={false} />)
    await act(async () => {})
    expect(listRequestDetails).toHaveBeenCalledTimes(1)

    rerender(<OpsRequestDetailsModal {...base} show={false} />)
    rerender(<OpsRequestDetailsModal {...base} show />)
    await waitFor(() => expect(listRequestDetails).toHaveBeenCalledTimes(2))
  })
})
