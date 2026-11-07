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

  it('MCP 连接页与授权页沿用 Vue 版路径、名称与 meta', () => {
    const settings = appRoutes.find((route) => route.name === 'MCP')
    expect(settings?.path).toBe('/settings/mcp')
    expect(settings?.layout).toBe('app')
    expect(settings?.meta).toMatchObject({ requiresAuth: true, requiresAdmin: false, titleKey: 'mcp.title', descriptionKey: 'mcp.description' })

    const authorize = appRoutes.find((route) => route.name === 'MCPOAuthAuthorize')
    expect(authorize?.path).toBe('/oauth/mcp/authorize')
    // 授权页自带整页布局，不显示侧边栏
    expect(authorize?.layout).toBe('none')
    expect(authorize?.meta).toMatchObject({ requiresAuth: true, requiresAdmin: false, titleKey: 'mcp.consentTitle' })
  })
})
