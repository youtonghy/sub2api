import { describe, expect, it } from 'vitest'

import {
  coversRange,
  oldestCreatedAt,
  ordersInRange,
  pageLimit,
  pagesToFetch,
  rangeStartMs,
  summarizeOrderFunnel,
  toFunnelStages,
  type FunnelOrder
} from '../orderFunnel'

const DAY = 86_400_000
const NOW = Date.parse('2026-07-15T12:00:00Z')

let nextId = 1
function order(overrides: Partial<FunnelOrder> & { daysAgo?: number } = {}): FunnelOrder {
  const { daysAgo = 1, ...rest } = overrides
  return {
    id: nextId++,
    status: 'COMPLETED',
    order_type: 'balance',
    created_at: new Date(NOW - daysAgo * DAY).toISOString(),
    paid_at: undefined,
    completed_at: undefined,
    ...rest
  }
}

const paid = { paid_at: '2026-11-01T00:00:00Z' }
const done = { paid_at: '2026-11-01T00:00:00Z', completed_at: '2026-11-01T00:01:00Z' }

describe('rangeStartMs', () => {
  it('goes back the given number of calendar days', () => {
    expect(rangeStartMs(7, NOW)).toBe(NOW - 7 * DAY)
  })
})

describe('pageLimit', () => {
  it('caps the page count at the maximum', () => {
    expect(pageLimit(0)).toBe(1)
    expect(pageLimit(250)).toBe(3)
    expect(pageLimit(5000)).toBe(8)
  })
})

describe('pagesToFetch', () => {
  const since = NOW - 30 * DAY

  it('reads one page when the first page already reaches past the range start', () => {
    const items = [order({ daysAgo: 1 }), order({ daysAgo: 40 })]
    expect(pagesToFetch({ items, total: 500 }, since, NOW)).toBe(1)
  })

  it('reads one page when there is nothing more to read', () => {
    expect(pagesToFetch({ items: [], total: 0 }, since, NOW)).toBe(1)
    expect(pagesToFetch({ items: [order({ daysAgo: 2 })], total: 1 }, since, NOW)).toBe(1)
  })

  it('estimates the pages from the span the first page covers, plus one', () => {
    // 第一页 100 条覆盖 10 天，30 天约需 3 页，多读 1 页
    const items = Array.from({ length: 100 }, (_, i) => order({ daysAgo: (i + 1) / 10 }))
    expect(pagesToFetch({ items, total: 10_000 }, since, NOW)).toBe(4)
  })

  it('never exceeds the available pages or the cap', () => {
    const items = Array.from({ length: 100 }, (_, i) => order({ daysAgo: (i + 1) / 100 }))
    expect(pagesToFetch({ items, total: 10_000 }, since, NOW)).toBe(8)
    expect(pagesToFetch({ items, total: 150 }, since, NOW)).toBe(2)
  })
})

describe('coversRange', () => {
  const since = NOW - 7 * DAY

  it('is covered when every order has been read', () => {
    expect(coversRange([order({ daysAgo: 1 })], since, 1, 1)).toBe(true)
  })

  it('is covered when an order older than the range start was read', () => {
    expect(coversRange([order({ daysAgo: 1 }), order({ daysAgo: 9 })], since, 1, 900)).toBe(true)
  })

  it('is not covered when more orders remain and all read orders are in range', () => {
    expect(coversRange([order({ daysAgo: 1 })], since, 8, 900)).toBe(false)
  })
})

describe('ordersInRange and oldestCreatedAt', () => {
  it('drops duplicates and orders before the range start', () => {
    const a = order({ daysAgo: 1 })
    const b = order({ daysAgo: 3 })
    const old = order({ daysAgo: 10 })
    const result = ordersInRange([a, b, b, old], NOW - 7 * DAY)
    expect(result.map((item) => item.id)).toEqual([a.id, b.id])
    expect(oldestCreatedAt(result)).toBe(b.created_at)
    expect(oldestCreatedAt([])).toBeNull()
  })
})

describe('summarizeOrderFunnel', () => {
  it('builds a strict created, paid, completed chain split by order type', () => {
    const summary = summarizeOrderFunnel([
      order({ status: 'PENDING' }),
      order({ status: 'EXPIRED' }),
      order({ status: 'CANCELLED', order_type: 'subscription' }),
      order({ status: 'FAILED' }),
      order({ status: 'RECHARGING', ...paid }),
      order({ status: 'FAILED', ...paid, order_type: 'subscription' }),
      order({ status: 'COMPLETED', ...done }),
      order({ status: 'COMPLETED', ...done, order_type: 'subscription' }),
      order({ status: 'REFUNDED', ...done })
    ])

    expect(summary.segmentKeys).toEqual(['balance', 'subscription'])
    expect(summary.inRange).toBe(9)
    expect(summary.counts.created).toEqual({ balance: 6, subscription: 3 })
    expect(summary.counts.paid).toEqual({ balance: 3, subscription: 2 })
    expect(summary.counts.completed).toEqual({ balance: 2, subscription: 1 })
    expect(summary.dropoff).toEqual({
      pending: 1,
      expired: 1,
      cancelled: 1,
      failedUnpaid: 1,
      otherUnpaid: 0,
      inProgress: 1,
      failedAfterPayment: 1,
      otherPaid: 0,
      refundAfterCompletion: 1
    })
  })

  it('does not count completed_at without paid_at as paid or completed', () => {
    const summary = summarizeOrderFunnel([order({ status: 'COMPLETED', completed_at: '2026-11-01T00:00:00Z' })])
    expect(summary.counts.paid).toEqual({ balance: 0, subscription: 0 })
    expect(summary.counts.completed).toEqual({ balance: 0, subscription: 0 })
    expect(summary.dropoff.otherUnpaid).toBe(1)
  })

  it('adds an other segment for unknown order types so segments add up to the total', () => {
    const summary = summarizeOrderFunnel([order({ order_type: 'gift' as FunnelOrder['order_type'], ...done })])
    expect(summary.segmentKeys).toEqual(['balance', 'subscription', 'other'])
    expect(summary.counts.created).toEqual({ balance: 0, subscription: 0, other: 1 })
  })

  it('maps to funnel stages in order', () => {
    const summary = summarizeOrderFunnel([order({ ...done }), order({ status: 'PENDING' })])
    const stages = toFunnelStages(summary, { created: 'Created', paid: 'Paid', completed: 'Completed' })
    expect(stages.map((stage) => stage.key)).toEqual(['created', 'paid', 'completed'])
    expect(stages[0].values).toEqual({ balance: 2, subscription: 0 })
    expect(stages[2]).toEqual({ key: 'completed', label: 'Completed', values: { balance: 1, subscription: 0 } })
  })
})
