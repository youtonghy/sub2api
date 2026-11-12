import { describe, expect, it } from 'vitest'
import { MAX_ACCOUNT_PRIORITY, MIN_ACCOUNT_PRIORITY, computeDropPriority, planPriorityMove } from '../accountPriorityOrder'

describe('computeDropPriority', () => {
  it('takes the midpoint when both neighbours exist', () => {
    expect(computeDropPriority({ lowerBound: 10, upperBound: 20 })).toBe(15)
    expect(computeDropPriority({ lowerBound: 10, upperBound: 13 })).toBe(12)
  })

  it('goes above the next neighbour when dropped first', () => {
    expect(computeDropPriority({ lowerBound: null, upperBound: 10 })).toBe(9)
    expect(computeDropPriority({ lowerBound: null, upperBound: 1 })).toBeNull()
  })

  it('goes below the previous neighbour when dropped last', () => {
    expect(computeDropPriority({ lowerBound: 10, upperBound: null })).toBe(11)
  })

  it('returns the minimum priority for a single row', () => {
    expect(computeDropPriority({ lowerBound: null, upperBound: null })).toBe(MIN_ACCOUNT_PRIORITY)
  })

  it('returns null when the neighbours leave no integer slot', () => {
    expect(computeDropPriority({ lowerBound: 10, upperBound: 11 })).toBeNull()
  })

  it('skips priorities already taken by other accounts', () => {
    // 中间点 15 被占用 → 向内找 16
    expect(computeDropPriority({ lowerBound: 10, upperBound: 20, taken: new Set([15]) })).toBe(16)
    // 拖到最前时，9/8 都被占用 → 取 7
    expect(computeDropPriority({ lowerBound: null, upperBound: 10, taken: new Set([9, 8]) })).toBe(7)
    // 拖到最后时，11 被占用 → 取 12
    expect(computeDropPriority({ lowerBound: 10, upperBound: null, taken: new Set([11]) })).toBe(12)
  })

  it('never returns a value below the minimum', () => {
    expect(computeDropPriority({ lowerBound: null, upperBound: MIN_ACCOUNT_PRIORITY + 1 })).toBe(MIN_ACCOUNT_PRIORITY)
  })
})

describe('planPriorityMove', () => {
  const applyPlan = (ordered: Array<{ id: number; priority: number }>, plan: Array<{ id: number; priority: number }>) => {
    const next = new Map(plan.map((change) => [change.id, change.priority]))
    return ordered
      .map((row) => ({ ...row, priority: next.get(row.id) ?? row.priority }))
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .map((row) => row.id)
  }

  it('writes only the moved account when its new neighbours leave a slot', () => {
    const ordered = [
      { id: 1, priority: 10 },
      { id: 2, priority: 20 },
      { id: 3, priority: 30 }
    ]
    expect(planPriorityMove({ ordered, movedId: 3, previousId: 1, nextId: 2 })).toEqual([{ id: 3, priority: 15 }])
  })

  it('renumbers in the NEW order when consecutive priorities leave no slot', () => {
    const ordered = [
      { id: 1, priority: 1 },
      { id: 2, priority: 2 },
      { id: 3, priority: 3 }
    ]
    const plan = planPriorityMove({ ordered, movedId: 3, previousId: 1, nextId: 2 })!
    expect(applyPlan(ordered, plan)).toEqual([1, 3, 2])
    // 重编号留出间隔，下一次拖动只需写一个账号
    expect(planPriorityMove({
      ordered: [
        { id: 1, priority: 10 },
        { id: 3, priority: 20 },
        { id: 2, priority: 30 }
      ],
      movedId: 2,
      previousId: 1,
      nextId: 3
    })).toEqual([{ id: 2, priority: 15 }])
  })

  it('reorders accounts that all share the default priority', () => {
    const ordered = [1, 2, 3, 4].map((id) => ({ id, priority: 1 }))
    const plan = planPriorityMove({ ordered, movedId: 1, previousId: 3, nextId: 4 })!
    expect(applyPlan(ordered, plan)).toEqual([2, 3, 1, 4])
  })

  it('anchors on the previous neighbour in the global order, keeping hidden accounts in place', () => {
    // 2 不在当前页/被筛掉：把 4 拖到 1 之后，应紧跟 1，而不是越过 2 之后的账号
    const ordered = [
      { id: 1, priority: 1 },
      { id: 2, priority: 2 },
      { id: 3, priority: 3 },
      { id: 4, priority: 4 }
    ]
    const plan = planPriorityMove({ ordered, movedId: 4, previousId: 1, nextId: 3 })!
    expect(applyPlan(ordered, plan)).toEqual([1, 4, 2, 3])
  })

  it('places the account before the next neighbour when there is no previous one', () => {
    const ordered = [
      { id: 1, priority: 1 },
      { id: 2, priority: 2 },
      { id: 3, priority: 3 }
    ]
    const plan = planPriorityMove({ ordered, movedId: 3, previousId: null, nextId: 2 })!
    expect(applyPlan(ordered, plan)).toEqual([1, 3, 2])
  })

  it('never plans a priority above the backend maximum', () => {
    const ordered = [
      { id: 1, priority: MAX_ACCOUNT_PRIORITY - 1 },
      { id: 2, priority: MAX_ACCOUNT_PRIORITY }
    ]
    const plan = planPriorityMove({ ordered, movedId: 1, previousId: 2, nextId: null })!
    expect(applyPlan(ordered, plan)).toEqual([2, 1])
    expect(Math.max(...plan.map((change) => change.priority))).toBeLessThanOrEqual(MAX_ACCOUNT_PRIORITY)
  })

  it('returns an empty plan when nothing changes and null when the list is stale', () => {
    const ordered = [
      { id: 1, priority: 10 },
      { id: 2, priority: 15 },
      { id: 3, priority: 20 }
    ]
    expect(planPriorityMove({ ordered, movedId: 2, previousId: 1, nextId: 3 })).toEqual([])
    expect(planPriorityMove({ ordered, movedId: 9, previousId: 1, nextId: 3 })).toBeNull()
    expect(planPriorityMove({ ordered, movedId: 2, previousId: 9, nextId: 3 })).toBeNull()
  })
})
