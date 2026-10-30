import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AdminPaymentPlansView from '../AdminPaymentPlansView'

const { getPlans, getConfig, getGroups } = vi.hoisted(() => ({
  getPlans: vi.fn(),
  getConfig: vi.fn(),
  getGroups: vi.fn()
}))

vi.mock('@/api/admin/payment', () => ({
  adminPaymentAPI: {
    getPlans,
    getConfig
  }
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    groups: {
      getAll: getGroups
    }
  }
}))

const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

// Vue 版对 DataTable 打桩只渲染价格列；React 版同样只渲染 price 单元格
vi.mock('@/components/common/DataTable', () => ({
  default: ({
    data,
    cells
  }: {
    data: Array<{ id: number; price: number }>
    cells: Record<string, (ctx: { row: unknown; value: unknown }) => unknown>
  }) => (
    <div>
      {data.map((row) => (
        <div key={row.id}>{cells.price({ value: row.price, row }) as never}</div>
      ))}
    </div>
  )
}))
vi.mock('../PlanEditDialog', () => ({ default: () => null }))
vi.mock('@/components/common/ConfirmDialog', () => ({ default: () => null }))
vi.mock('@/components/common/GroupBadge', () => ({ default: () => null }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

describe('AdminPaymentPlansView', () => {
  beforeEach(() => {
    getGroups.mockResolvedValue([])
    getConfig.mockResolvedValue({ data: {} })
    getPlans.mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'CNY plan',
          group_id: 1,
          price: 499,
          original_price: 599,
          currency: 'CNY',
          validity_days: 30,
          validity_unit: 'day',
          sort_order: 0,
          for_sale: true,
          features: []
        },
        {
          id: 2,
          name: 'Legacy plan',
          group_id: 1,
          price: 10,
          original_price: 0,
          currency: '',
          validity_days: 30,
          validity_unit: 'day',
          sort_order: 0,
          for_sale: true,
          features: []
        }
      ]
    })
  })

  it('uses the configured currency symbol and keeps legacy prices in USD', async () => {
    const { container } = render(<AdminPaymentPlansView />)

    await flushPromises()

    expect(container.textContent).toContain('¥499.00CNY')
    expect(container.textContent).toContain('¥599.00')
    expect(container.textContent).toContain('$10.00')
  })
})
