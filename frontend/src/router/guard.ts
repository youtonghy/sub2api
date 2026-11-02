/**
 * 导航守卫：与 Vue 版 router.beforeEach 的检查顺序一一对应。
 * 返回 null 表示放行，返回字符串表示重定向目标（可带查询参数）。
 */
import { getSetupStatus } from '@/api/setup'
import { useAdminComplianceStore } from '@/stores/adminCompliance'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { RouteLike, RouteMeta } from './meta'
import { resolveCompletedSetupRedirectPath } from './setupRedirect'
import { resolveRouteDocumentTitle } from './title'

export interface GuardTarget {
  /** 不含查询参数的路径 */
  path: string
  /** 含查询参数，用作登录后的 redirect */
  fullPath: string
  name: string
  params: Record<string, string | undefined>
  meta: RouteMeta
}

const BACKEND_MODE_ALLOWED_PATHS = ['/login', '/key-usage', '/setup', '/payment/result', '/payment/airwallex', '/legal']
const BACKEND_MODE_CALLBACK_PATHS = [
  '/auth/callback',
  '/auth/linuxdo/callback',
  '/auth/dingtalk/callback',
  '/auth/dingtalk/email-completion',
  '/auth/oidc/callback',
  '/auth/wechat/callback',
  '/auth/wechat/payment/callback',
]
const BACKEND_MODE_PENDING_AUTH_PATHS = ['/register', '/email-verify']
const SIMPLE_MODE_RESTRICTED_PATHS = ['/admin/subscriptions', '/admin/redeem', '/subscriptions', '/redeem']

export function isBackendModePublicRouteAllowed(path: string, hasPendingAuthSession: boolean): boolean {
  if (BACKEND_MODE_ALLOWED_PATHS.some((allowedPath) => path === allowedPath || path.startsWith(allowedPath))) {
    return true
  }

  if (BACKEND_MODE_CALLBACK_PATHS.some((callbackPath) => path === callbackPath)) {
    return true
  }

  if (hasPendingAuthSession && BACKEND_MODE_PENDING_AUTH_PATHS.some((allowedPath) => path === allowedPath)) {
    return true
  }

  return false
}

function loginRedirect(fullPath: string): string {
  return `/login?${new URLSearchParams({ redirect: fullPath }).toString()}`
}

function homeFor(isAdmin: boolean): string {
  return isAdmin ? '/admin/dashboard' : '/dashboard'
}

let authInitialized = false

/** 仅供测试：重置首次导航时的会话恢复标记 */
export function resetGuardState(): void {
  authInitialized = false
}

export function updateDocumentTitleFor(route: RouteLike): void {
  const appStore = useAppStore.getState()
  const authStore = useAuthStore.getState()
  const customMenuItems = [
    ...(appStore.cachedPublicSettings?.custom_menu_items ?? []),
    ...(authStore.isAdmin ? useAdminSettingsStore.getState().customMenuItems : []),
  ]
  document.title = resolveRouteDocumentTitle(route, appStore.siteName, customMenuItems)
}

async function ensurePublicSettings(): Promise<void> {
  if (useAppStore.getState().publicSettingsLoaded) {
    return
  }
  try {
    await useAppStore.getState().fetchPublicSettings()
  } catch (error) {
    console.warn('Failed to load public settings in route guard', error)
  }
}

export async function resolveNavigation(to: GuardTarget): Promise<string | null> {
  // Restore auth state from localStorage on first navigation (page refresh)
  if (!authInitialized) {
    useAuthStore.getState().checkAuth()
    authInitialized = true
  }

  updateDocumentTitleFor(to)

  const auth = () => useAuthStore.getState()
  const app = () => useAppStore.getState()

  // Check if route requires authentication
  const requiresAuth = to.meta.requiresAuth !== false // Default to true
  const requiresAdmin = to.meta.requiresAdmin === true

  if (to.path === '/setup') {
    try {
      const status = await getSetupStatus()
      if (!status.needs_setup) {
        return resolveCompletedSetupRedirectPath(auth().isAuthenticated, auth().isAdmin)
      }
    } catch {
      // If setup status cannot be determined, keep the setup page reachable.
    }
  }

  // If route doesn't require auth, allow access
  if (!requiresAuth) {
    // If already authenticated and trying to access login/register, redirect to appropriate dashboard
    if (auth().isAuthenticated && (to.path === '/login' || to.path === '/register')) {
      // In backend mode, non-admin users should NOT be redirected away from login
      // (they are blocked from all protected routes, so redirecting would cause a loop)
      if (app().backendModeEnabled && !auth().isAdmin) {
        return null
      }
      return homeFor(auth().isAdmin)
    }
    // Model Plaza：公开路由但受「启用开关 + 可选强制登录」双重控制（后端同口径 fail-closed）
    if (to.path === '/model-plaza') {
      await ensurePublicSettings()
      const plazaSettings = app().cachedPublicSettings
      // 仅在设置成功加载且明确为 false 时拦截（瞬时加载失败视为未知，由后端 404 兜底）
      if (app().publicSettingsLoaded && plazaSettings?.model_plaza_enabled === false) {
        return auth().isAuthenticated ? homeFor(auth().isAdmin) : '/home'
      }
      if (plazaSettings?.model_plaza_require_auth === true && !auth().isAuthenticated) {
        return loginRedirect(to.fullPath)
      }
      // Backend mode：登录的非管理员也不可见（匿名由下方公共拦截处理，广场不在白名单）
      if (app().backendModeEnabled && auth().isAuthenticated && !auth().isAdmin) {
        return '/login'
      }
    }
    // Backend mode: block public pages for unauthenticated users (except login, key-usage, setup)
    if (app().backendModeEnabled && !auth().isAuthenticated) {
      if (!isBackendModePublicRouteAllowed(to.path, auth().hasPendingAuthSession)) {
        return '/login'
      }
    }
    return null
  }

  // Route requires authentication
  if (!auth().isAuthenticated) {
    return loginRedirect(to.fullPath)
  }

  // Check admin requirement
  if (requiresAdmin && !auth().isAdmin) {
    return '/dashboard'
  }

  if (requiresAdmin && auth().isAdmin) {
    const adminComplianceStore = useAdminComplianceStore.getState()
    if (!adminComplianceStore.initialized) {
      try {
        await adminComplianceStore.fetchStatus()
      } catch (error) {
        const err = error as { status?: number; code?: string; metadata?: Record<string, string> }
        if (err.status === 423 && err.code === 'ADMIN_COMPLIANCE_ACK_REQUIRED') {
          useAdminComplianceStore.getState().requireAcknowledgement(err.metadata)
        }
      }
    }
  }

  // 公共设置可能尚未加载（纯静态部署无 __APP_CONFIG__ 注入）。此时 cachedPublicSettings 为空
  // 会把 payment/risk_control 误判为“未启用”而错误拦截，故这里先确保设置加载完成。
  if (to.meta.requiresPayment || to.meta.requiresRiskControl || to.meta.requiresSubscription) {
    await ensurePublicSettings()
  }

  // Only an explicit value from successfully loaded settings can disable a route.
  // A transient settings failure is unknown state, not a confirmed feature toggle.
  const settings = app().cachedPublicSettings
  const settingsLoaded = app().publicSettingsLoaded
  if (to.meta.requiresPayment && settingsLoaded && settings?.payment_enabled === false) {
    return homeFor(auth().isAdmin)
  }

  if (to.meta.requiresRiskControl && settingsLoaded && settings?.risk_control_enabled === false) {
    return auth().isAdmin ? '/admin/settings' : '/dashboard'
  }

  // 订阅功能是 opt-out 开关：只有显式 false 才拦截「我的订阅」页直达。
  if (to.meta.requiresSubscription && settingsLoaded && settings?.subscription_enabled === false) {
    return homeFor(auth().isAdmin)
  }

  // 简易模式下限制访问某些页面
  if (auth().isSimpleMode && SIMPLE_MODE_RESTRICTED_PATHS.some((path) => to.path.startsWith(path))) {
    return homeFor(auth().isAdmin)
  }

  // Backend mode: admin gets full access, non-admin blocked
  if (app().backendModeEnabled) {
    if (auth().isAuthenticated && auth().isAdmin) {
      return null
    }
    if (!isBackendModePublicRouteAllowed(to.path, auth().hasPendingAuthSession)) {
      return '/login'
    }
  }

  return null
}
