/**
 * 账号优先级拖动排序的公共规则。
 *
 * 优先级是"数值越小越优先"的整数。拖动一个账号后，它的新优先级由**新前邻居**
 * 和**新后邻居**决定，其它账号的优先级保持不变 —— 这样一次拖动不会把整张表的
 * 优先级重写一遍。
 *
 * 规则：
 *  - 前后都有邻居：取区间中点（严格落在两者之间）
 *  - 只在最前：取后邻居之上一个空位
 *  - 只在最后：取前邻居之下一个空位
 *  - 没有邻居（唯一账号）：取 1
 *  - 邻居之间没有整数空位，或目标值已被其它账号占用：返回 null，由调用方决定
 *    退回整体重编号
 */

export const MIN_ACCOUNT_PRIORITY = 1

export interface DropPriorityInput {
  /** 新前邻居的优先级，没有则 null */
  lowerBound: number | null
  /** 新后邻居的优先级，没有则 null */
  upperBound: number | null
  /** 当前已被其它账号占用的优先级（不含被拖动的账号） */
  taken?: ReadonlySet<number>
}

/**
 * 计算被拖动账号应取的新优先级；无法在邻居之间找到位置时返回 null。
 */
export function computeDropPriority(input: DropPriorityInput): number | null {
  const { lowerBound, upperBound } = input
  const taken = input.taken ?? new Set<number>()
  const free = (value: number) => value >= MIN_ACCOUNT_PRIORITY && !taken.has(value)

  if (lowerBound == null && upperBound == null) {
    // 只有一个账号，或者整表都被拖动：从头开始。
    return free(MIN_ACCOUNT_PRIORITY) ? MIN_ACCOUNT_PRIORITY : null
  }

  if (lowerBound == null) {
    // 拖到最前：贴着后邻居往上找最近空位。
    for (let candidate = upperBound! - 1; candidate >= MIN_ACCOUNT_PRIORITY; candidate--) {
      if (free(candidate)) return candidate
    }
    return null
  }

  if (upperBound == null) {
    // 拖到最后：贴着前邻居往下找最近空位。
    for (let candidate = lowerBound + 1; candidate <= lowerBound + taken.size + 1; candidate++) {
      if (free(candidate)) return candidate
    }
    return null
  }

  if (upperBound - lowerBound < 2) return null

  const middle = Math.round((lowerBound + upperBound) / 2)
  if (free(middle)) return middle
  // 中间点被占用时向内找最近的空位。
  for (let offset = 1; offset < upperBound - lowerBound; offset++) {
    for (const candidate of [middle + offset, middle - offset]) {
      if (candidate > lowerBound && candidate < upperBound && free(candidate)) return candidate
    }
  }
  return null
}
