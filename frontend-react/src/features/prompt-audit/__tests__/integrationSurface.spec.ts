import { describe, expect, it } from 'vitest'

import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh'
import { appRoutes } from '@/router/routes'

// Vue 版还从 AppSidebar.vue 与组件源码中 grep 文本；那些只针对 Vue 源码的断言已不适用，这里保留路由元信息与语言文件对称性。
describe('Prompt Audit integration surface', () => {
  it('registers an admin and risk-control guarded route', () => {
    const route = appRoutes.find((item) => item.path === '/admin/prompt-audit')
    expect(route).toBeTruthy()
    expect(route!.meta).toMatchObject({ requiresAuth: true, requiresAdmin: true, requiresRiskControl: true })
  })

  it('keeps Prompt Audit locale trees symmetric', () => {
    expect(Object.keys(zh.admin.promptAudit)).toEqual(Object.keys(en.admin.promptAudit))
    expect(zh.nav.securityAudit).toBeTruthy()
    expect(en.nav.securityAudit).toBeTruthy()
  })
})
