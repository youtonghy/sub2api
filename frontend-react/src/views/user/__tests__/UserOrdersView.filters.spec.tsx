import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UserOrdersView from '../UserOrdersView'

const api = vi.hoisted(() => ({ getMyOrders: vi.fn(), getRefundEligibleProviders: vi.fn() }))
const pagination = vi.hoisted(() => ({ props: null as null | { page: number; onPageChange?: (page: number) => void } }))
vi.mock('@/api/payment', () => ({ paymentAPI: api }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) } }))
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
// Vue 版把 OrderTable / BaseDialog / Pagination 替换为桩；Pagination 桩记录 props 以模拟 update:page
vi.mock('@/components/payment/OrderTable', () => ({ default: () => null }))
vi.mock('@/components/common/BaseDialog', () => ({ default: () => null }))
vi.mock('@/components/common/ConfirmDialog', () => ({ default: () => null }))
vi.mock('@/components/common/Pagination', () => ({
  default: (props: { page: number; onPageChange?: (page: number) => void }) => {
    pagination.props = props
    return <div data-testid="pagination" data-page={props.page} />
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  pagination.props = null
  api.getMyOrders.mockResolvedValue({ data: { items: [], total: 100 } })
  api.getRefundEligibleProviders.mockResolvedValue({ data: { provider_instance_ids: [] } })
})

async function flushPromises() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function openOrders() {
  render(<UserOrdersView />)
  await flushPromises()
  act(() => pagination.props!.onPageChange!(4))
  await flushPromises()
}

describe('order status filtering', () => {
  it('loads the first page with the selected status', async () => {
    await openOrders()
    fireEvent.click(screen.getByLabelText('payment.orders.status'))
    fireEvent.click(screen.getAllByRole('option').find(option => option.textContent?.includes('payment.status.pending'))!)
    await flushPromises()
    expect(api.getMyOrders).toHaveBeenLastCalledWith({ page: 1, page_size: 20, status: 'PENDING' })
    expect(pagination.props!.page).toBe(1)
    expect(api.getMyOrders).toHaveBeenCalledTimes(3)
  })

  it('keeps the current page on manual refresh', async () => {
    await openOrders()
    fireEvent.click(screen.getByTitle('common.refresh'))
    await flushPromises()
    expect(api.getMyOrders).toHaveBeenLastCalledWith({ page: 4, page_size: 20, status: undefined })
  })
})
