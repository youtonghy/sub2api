import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

describe('admin platform filters', () => {
  it('drops the group platform filter on the subscriptions page', () => {
    // 全平台分组下「按分组平台筛选订阅」恒为空集，已移除。
    const source = readSource('src/views/admin/SubscriptionsView.vue')
    expect(source).not.toContain('GROUP_PLATFORM_OPTIONS')
    expect(source).not.toContain('filters.platform')
  })

  it('uses the concrete platform catalog on the groups page', () => {
    const source = readSource('src/views/admin/GroupsView.vue')
    // 分组平台已恒为全平台（composite），组表单不再选择分组平台，
    // 只剩 Composite 路由目标平台仍需要具体平台清单。
    expect(source).not.toContain('GROUP_PLATFORM_OPTIONS')
    expect(source).toContain('...CONCRETE_PLATFORM_OPTIONS')
  })

  it('uses the concrete platform catalog wherever concrete platforms are selected', () => {
    for (const path of [
      'src/components/admin/account/AccountTableFilters.vue',
      'src/components/admin/ErrorPassthroughRulesModal.vue',
      'src/views/admin/ops/components/OpsDashboardHeader.vue'
    ]) {
      const source = readSource(path)
      expect(source).toContain("import { CONCRETE_PLATFORM_OPTIONS } from '@/constants/platforms'")
      expect(source).toMatch(/platformOptions\s*=.*CONCRETE_PLATFORM_OPTIONS|pOpts.*\.\.\.CONCRETE_PLATFORM_OPTIONS/s)
    }
  })
})
