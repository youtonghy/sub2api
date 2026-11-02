import { beforeEach, describe, expect, it, vi } from 'vitest'
import { matchPath } from 'react-router'

import { useAdminComplianceStore } from '@/stores/adminCompliance'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { PublicSettings } from '@/types'
import { resetGuardState, resolveNavigation } from '@/router/guard'
import { appRoutes } from '@/router/routes'

const setupStatus = vi.hoisted(() => ({ needs_setup: false }))

vi.mock('@/api/setup', () => ({
  getSetupStatus: vi.fn(async () => setupStatus),
}))

vi.mock('@/api/admin/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/admin/system')>()),
  checkUpdates: vi.fn(),
}))

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getPublicSettings: vi.fn(),
}))

interface AuthState {
  isAuthenticated: boolean
  isAdmin: boolean
  isSimpleMode?: boolean
  backendModeEnabled?: boolean
  hasPendingAuthSession?: boolean
}

function arrange(state: AuthState, settings: Partial<PublicSettings> | null = null) {
  useAuthStore.setState({
    isAuthenticated: state.isAuthenticated,
    isAdmin: state.isAdmin,
    isSimpleMode: state.isSimpleMode ?? false,
    hasPendingAuthSession: state.hasPendingAuthSession ?? false,
    checkAuth: vi.fn(),
  })
  useAppStore.setState({
    backendModeEnabled: state.backendModeEnabled ?? false,
    publicSettingsLoaded: settings !== null,
    cachedPublicSettings: settings as PublicSettings | null,
  })
  // 管理员合规状态视为已确认，守卫不再请求接口
  useAdminComplianceStore.setState({ initialized: true })
}

/** 用真实路由表解析 meta，再运行真实守卫 */
function navigate(fullPath: string) {
  const [path] = fullPath.split('?')
  const def = appRoutes.find((route) => route.path !== '*' && matchPath(route.path, path))
    ?? appRoutes.find((route) => route.path === '*')!
  const match = def.path === '*' ? null : matchPath(def.path, path)
  return resolveNavigation({
    path,
    fullPath,
    name: def.name,
    params: (match?.params ?? {}) as Record<string, string | undefined>,
    meta: def.meta,
  })
}

const user: AuthState = { isAuthenticated: true, isAdmin: false }
const admin: AuthState = { isAuthenticated: true, isAdmin: true }
const anonymous: AuthState = { isAuthenticated: false, isAdmin: false }

describe('路由守卫', () => {
  beforeEach(() => {
    resetGuardState()
    setupStatus.needs_setup = false
    useAuthStore.setState(useAuthStore.getInitialState(), true)
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  describe('未认证用户', () => {
    beforeEach(() => arrange(anonymous))

    it('访问需要认证的页面重定向到 /login 并带上 redirect', async () => {
      expect(await navigate('/dashboard?tab=1')).toBe('/login?redirect=%2Fdashboard%3Ftab%3D1')
    })

    it('访问管理页面重定向到 /login', async () => {
      expect(await navigate('/admin/users')).toBe('/login?redirect=%2Fadmin%2Fusers')
    })

    it('访问公开页面允许通过', async () => {
      expect(await navigate('/login')).toBeNull()
      expect(await navigate('/home')).toBeNull()
      expect(await navigate('/legal/terms')).toBeNull()
    })

    it('未知路径与 Vue 版一致，需要登录', async () => {
      expect(await navigate('/does-not-exist')).toBe('/login?redirect=%2Fdoes-not-exist')
    })
  })

  describe('已认证普通用户', () => {
    beforeEach(() => arrange(user))

    it('访问 /login 与 /register 重定向到 /dashboard', async () => {
      expect(await navigate('/login')).toBe('/dashboard')
      expect(await navigate('/register')).toBe('/dashboard')
    })

    it('访问 /dashboard 允许通过', async () => {
      expect(await navigate('/dashboard')).toBeNull()
    })

    it('访问管理页面被拒绝，重定向到 /dashboard', async () => {
      expect(await navigate('/admin/dashboard')).toBe('/dashboard')
      expect(await navigate('/admin/users')).toBe('/dashboard')
    })
  })

  describe('已认证管理员', () => {
    beforeEach(() => arrange(admin))

    it('访问 /login 重定向到 /admin/dashboard', async () => {
      expect(await navigate('/login')).toBe('/admin/dashboard')
    })

    it('访问管理页面与用户页面允许通过', async () => {
      expect(await navigate('/admin/accounts')).toBeNull()
      expect(await navigate('/keys')).toBeNull()
    })
  })

  describe('简易模式受限路由', () => {
    it('普通用户访问 /subscriptions 与 /redeem 重定向到 /dashboard', async () => {
      arrange({ ...user, isSimpleMode: true })
      expect(await navigate('/subscriptions')).toBe('/dashboard')
      expect(await navigate('/redeem')).toBe('/dashboard')
    })

    it('管理员访问 /admin/subscriptions 重定向，/admin/groups 允许', async () => {
      arrange({ ...admin, isSimpleMode: true })
      expect(await navigate('/admin/subscriptions')).toBe('/admin/dashboard')
      expect(await navigate('/admin/redeem')).toBe('/admin/dashboard')
      expect(await navigate('/admin/groups')).toBeNull()
    })

    it('非受限页面正常访问', async () => {
      arrange({ ...user, isSimpleMode: true })
      expect(await navigate('/keys')).toBeNull()
      expect(await navigate('/dashboard')).toBeNull()
    })
  })

  describe('功能开关', () => {
    it('支付显式关闭时拦截 /purchase，未加载时放行', async () => {
      arrange(user, { payment_enabled: false })
      expect(await navigate('/purchase')).toBe('/dashboard')
    })

    it('风控显式关闭时管理员回到系统设置', async () => {
      arrange(admin, { risk_control_enabled: false })
      expect(await navigate('/admin/risk-control')).toBe('/admin/settings')
    })

    it('订阅显式关闭时拦截「我的订阅」', async () => {
      arrange(user, { subscription_enabled: false })
      expect(await navigate('/subscriptions')).toBe('/dashboard')
      arrange(user, { subscription_enabled: true })
      expect(await navigate('/subscriptions')).toBeNull()
    })

    it('模型广场关闭时按身份回退，强制登录时要求登录', async () => {
      arrange(anonymous, { model_plaza_enabled: false })
      expect(await navigate('/model-plaza')).toBe('/home')
      arrange(anonymous, { model_plaza_enabled: true, model_plaza_require_auth: true })
      expect(await navigate('/model-plaza')).toBe('/login?redirect=%2Fmodel-plaza')
    })
  })

  describe('Backend Mode', () => {
    it('未登录：/home 重定向到 /login，/login、/key-usage、/setup 与回调放行', async () => {
      arrange({ ...anonymous, backendModeEnabled: true })
      setupStatus.needs_setup = true
      expect(await navigate('/home')).toBe('/login')
      expect(await navigate('/login')).toBeNull()
      expect(await navigate('/key-usage')).toBeNull()
      expect(await navigate('/setup')).toBeNull()
      expect(await navigate('/auth/linuxdo/callback')).toBeNull()
      expect(await navigate('/auth/wechat/payment/callback')).toBeNull()
      expect(await navigate('/payment/result')).toBeNull()
    })

    it('已完成安装时 /setup 按身份重定向', async () => {
      arrange({ ...anonymous, backendModeEnabled: true })
      expect(await navigate('/setup')).toBe('/login')
      arrange({ ...admin, backendModeEnabled: true })
      expect(await navigate('/setup')).toBe('/admin/dashboard')
    })

    it('管理员拥有完整访问，/login 重定向到后台', async () => {
      arrange({ ...admin, backendModeEnabled: true })
      expect(await navigate('/admin/dashboard')).toBeNull()
      expect(await navigate('/login')).toBe('/admin/dashboard')
    })

    it('已登录非管理员：/dashboard 重定向到 /login，/login 不循环，/key-usage 放行', async () => {
      arrange({ ...user, backendModeEnabled: true })
      expect(await navigate('/dashboard')).toBe('/login')
      expect(await navigate('/login')).toBeNull()
      expect(await navigate('/key-usage')).toBeNull()
    })

    it('待完成的认证会话放行 /register，没有会话时拦截 /email-verify', async () => {
      arrange({ ...anonymous, backendModeEnabled: true, hasPendingAuthSession: true })
      expect(await navigate('/register')).toBeNull()
      arrange({ ...anonymous, backendModeEnabled: true })
      expect(await navigate('/email-verify')).toBe('/login')
    })
  })
})
