import { describe, expect, it } from 'vitest'
import { MIN_ACCOUNT_PRIORITY, computeDropPriority } from '../accountPriorityOrder'

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
