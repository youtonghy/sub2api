import { adminAPI } from '@/api/admin'
import type { AccountListItem } from '@/types'

// 一次分页请求尽量取全量：拖动排序必须看到同一条全局顺序，不能只排当前页。
const PAGE_SIZE = 1000
// 防御性上限，避免异常 total 把界面拖死（1000 × 10 = 1 万个账号）。
const MAX_PAGES = 10

/** 取全量账号（紧凑字段），按真实调度顺序 priority、id 升序排列。 */
export async function fetchAllAccountsByPriority(): Promise<AccountListItem[]> {
  const collected: AccountListItem[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await adminAPI.accounts.list(page, PAGE_SIZE, {
      lite: '1',
      sort_by: 'priority',
      sort_order: 'asc'
    })
    collected.push(...response.items)
    const total = response.total ?? collected.length
    if (!response.items.length || collected.length >= total) break
  }
  // 服务端已按 priority 排序，这里再用 id 兜底保证同一优先级内的顺序稳定。
  return collected.sort((a, b) => a.priority - b.priority || a.id - b.id)
}
