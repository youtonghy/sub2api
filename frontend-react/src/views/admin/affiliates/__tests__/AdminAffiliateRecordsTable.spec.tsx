import { act, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AdminAffiliateRecordsTable from '../AdminAffiliateRecordsTable'

const { listInviteRecords, listRebateRecords, listTransferRecords, getUserOverview } = vi.hoisted(() => ({
  listInviteRecords: vi.fn(),
  listRebateRecords: vi.fn(),
  listTransferRecords: vi.fn(),
  getUserOverview: vi.fn()
}))

vi.mock('@/api/admin/affiliates', () => {
  const affiliatesAPI = { listInviteRecords, listRebateRecords, listTransferRecords, getUserOverview }
  return { affiliatesAPI, default: affiliatesAPI }
})

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) }
}))

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版桩：TablePageLayout 依次渲染各区域，DataTable 每列渲染对应单元格
vi.mock('@/components/common/TablePageLayout', () => ({
  default: ({ filters, table, pagination }: { filters?: ReactNode; table?: ReactNode; pagination?: ReactNode }) => (
    <div>
      {filters}
      {table}
      {pagination}
    </div>
  )
}))

vi.mock('@/components/common/DataTable', () => ({
  default: ({
    columns,
    data,
    cells
  }: {
    columns: Array<{ key: string }>
    data: unknown[]
    cells: Record<string, (ctx: { row: unknown; value: unknown }) => ReactNode>
  }) => (
    <table>
      <tbody>
        {data.map((row, index) => (
          <tr key={index} data-test={'row-' + index}>
            {columns.map((column) => (
              <td key={column.key} data-test={'cell-' + column.key}>
                {cells[column.key]?.({ row, value: undefined })}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}))

vi.mock('@/components/common/Pagination', () => ({ default: () => null }))
vi.mock('@/components/payment/OrderStatusBadge', () => ({ default: () => null }))
vi.mock('@/components/common/BaseDialog', () => ({ default: () => null }))

const withdrawDialog = vi.hoisted(() => ({
  props: null as null | { show: boolean; onClose?: () => void; onSuccess?: (result: unknown) => void }
}))
vi.mock('../AffiliateOfflineWithdrawDialog', () => ({
  default: (props: { show: boolean; onClose?: () => void; onSuccess?: (result: unknown) => void }) => {
    withdrawDialog.props = props
    return <div data-test="withdraw-dialog" data-show={String(props.show)} />
  }
}))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

function page<T>(items: T[]) {
  return { items, total: items.length, page: 1, page_size: 20, pages: 1 }
}

const get = (container: Element, test: string) => {
  const el = container.querySelector(`[data-test="${test}"]`)
  if (!el) throw new Error(`${test} not found`)
  return el
}

describe('AdminAffiliateRecordsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    withdrawDialog.props = null
  })

  it('renders non-order rebate accruals with empty order fields', async () => {
    listRebateRecords.mockResolvedValue(
      page([
        {
          order_id: null,
          out_trade_no: '',
          inviter_id: 1,
          inviter_email: 'inviter@example.com',
          inviter_username: 'inviter',
          invitee_id: 2,
          invitee_email: 'invitee@example.com',
          invitee_username: 'invitee',
          order_amount: null,
          pay_amount: null,
          rebate_amount: 2,
          payment_type: '',
          order_status: '',
          created_at: '2026-09-17T08:00:00Z'
        }
      ])
    )

    const { container } = render(<AdminAffiliateRecordsTable type="rebates" />)
    await flushPromises()

    const row = get(container, 'row-0')
    expect(get(row, 'cell-order').textContent).toBe('-')
    expect(get(row, 'cell-order_amount').textContent).toBe('-')
    expect(get(row, 'cell-pay_amount').textContent).toBe('-')
    expect(get(row, 'cell-payment_type').textContent).toBe('-')
    expect(get(row, 'cell-order_status').textContent).toBe('-')
    expect(get(row, 'cell-rebate_amount').textContent).toBe('$2.00')
    expect(container.querySelector('[data-test="affiliate-withdraw-open"]')).toBeNull()
  })

  it('lists offline withdrawals next to balance transfers with their type', async () => {
    listTransferRecords.mockResolvedValue(
      page([
        {
          ledger_id: 11,
          action: 'withdraw',
          user_id: 42,
          user_email: 'inviter@example.com',
          username: 'inviter',
          amount: 12.5,
          balance_after: 5.5,
          available_quota_after: 7.5,
          frozen_quota_after: 0,
          history_quota_after: 30,
          snapshot_available: true,
          created_at: '2026-09-17T08:00:00Z'
        },
        {
          ledger_id: 10,
          action: 'transfer',
          user_id: 42,
          user_email: 'inviter@example.com',
          username: 'inviter',
          amount: 3,
          balance_after: 5.5,
          available_quota_after: 20,
          frozen_quota_after: 0,
          history_quota_after: 30,
          snapshot_available: true,
          created_at: '2026-09-16T08:00:00Z'
        }
      ])
    )

    const { container } = render(<AdminAffiliateRecordsTable type="transfers" />)
    await flushPromises()

    const withdrawRow = get(container, 'row-0')
    expect(get(withdrawRow, 'cell-action').textContent).toBe('admin.affiliates.outflowTypes.withdraw')
    expect(get(withdrawRow, 'cell-amount').textContent).toBe('$12.50')

    const transferRow = get(container, 'row-1')
    expect(get(transferRow, 'cell-action').textContent).toBe('admin.affiliates.outflowTypes.transfer')
  })

  it('opens the offline withdrawal dialog and reloads the first page after recording', async () => {
    listTransferRecords.mockResolvedValue(page([]))

    const { container } = render(<AdminAffiliateRecordsTable type="transfers" />)
    await flushPromises()
    expect(listTransferRecords).toHaveBeenCalledTimes(1)

    const button = get(container, 'affiliate-withdraw-open')
    expect(button.textContent).toBe('admin.affiliates.withdraw.button')
    fireEvent.click(button)
    expect(get(container, 'withdraw-dialog').getAttribute('data-show')).toBe('true')

    act(() => withdrawDialog.props?.onSuccess?.({ ledger_id: 12 }))
    await flushPromises()

    expect(get(container, 'withdraw-dialog').getAttribute('data-show')).toBe('false')
    expect(listTransferRecords).toHaveBeenCalledTimes(2)
    expect(listTransferRecords.mock.calls[1][0]).toMatchObject({ page: 1 })
  })
})
