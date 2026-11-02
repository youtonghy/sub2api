import { describe, expect, it } from 'vitest'

import { appRoutes } from '@/router/routes'

describe('路由表', () => {
  it('所有 /admin 页面都要求管理员权限', () => {
    const unguarded = appRoutes
      .filter((route) => route.path.startsWith('/admin'))
      .filter((route) => route.meta.requiresAdmin !== true || route.meta.requiresAuth === false)
      .map((route) => route.path)
    expect(unguarded).toEqual([])
  })

  it('路由名称唯一', () => {
    const names = appRoutes.map((route) => route.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
