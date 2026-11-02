/**
 * 根布局：承担 Vue 版 App.vue 的全局职责（标题、favicon、安装检查、公开配置、
 * 订阅轮询、公告、管理员合规），并挂载导航进度条、toast 与全局弹窗。
 */
import { useEffect, useRef } from 'react'
import { Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router'

import { ToastStack, ToastStackProvider } from '@/components/arc/toast-stack/toast-stack'
import AdminComplianceDialog from '@/components/admin/AdminComplianceDialog'
import AnnouncementPopup from '@/components/common/AnnouncementPopup'
import NavigationProgress from '@/components/common/NavigationProgress'
import ToastBridge from '@/components/common/ToastBridge'
import { getSetupStatus } from '@/api/setup'
import { useI18n } from '@/i18n/useI18n'
import { resolveRouteDocumentTitle } from '@/router/title'
import { useCurrentRoute } from '@/router/useCurrentRoute'
import { useAdminComplianceStore } from '@/stores/adminCompliance'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAnnouncementStore } from '@/stores/announcements'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useSubscriptionStore } from '@/stores/subscriptions'
import { updateFavicon } from '@/utils/branding'
import { FeatureFlags, resolveFeatureFlag } from '@/utils/featureFlags'
import { resolveSiteBillingMode } from '@/utils/siteBillingMode'

function startSubscriptionSync() {
  const subscriptionStore = useSubscriptionStore.getState()
  subscriptionStore.fetchActiveSubscriptions().catch((error: unknown) => {
    console.error('Failed to preload subscriptions:', error)
  })
  subscriptionStore.startPolling()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible' && useAuthStore.getState().isAuthenticated) {
    void useAnnouncementStore.getState().fetchAnnouncements()
  }
}

function useDocumentTitle() {
  const route = useCurrentRoute()
  const { locale } = useI18n()
  const siteName = useAppStore((state) => state.siteName)
  const settings = useAppStore((state) => state.cachedPublicSettings)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const adminMenuItems = useAdminSettingsStore((state) => state.customMenuItems)

  useEffect(() => {
    const customMenuItems = [...(settings?.custom_menu_items ?? []), ...(isAdmin ? adminMenuItems : [])]
    document.title = resolveRouteDocumentTitle(route, siteName, customMenuItems, {
      billingMode: resolveSiteBillingMode(settings),
    })
  }, [route, locale, siteName, settings, isAdmin, adminMenuItems])
}

function useSessionSync() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const settings = useAppStore((state) => state.cachedPublicSettings)
  const subscriptionEnabled = resolveFeatureFlag(settings, FeatureFlags.subscription)
  const previousAuthenticated = useRef<boolean | undefined>(undefined)

  // 登录状态变化：预加载订阅、拉取公告与合规状态；登出时清空
  useEffect(() => {
    const oldValue = previousAuthenticated.current
    previousAuthenticated.current = isAuthenticated
    if (!isAuthenticated) {
      if (oldValue !== undefined) {
        useSubscriptionStore.getState().clear()
        useAnnouncementStore.getState().reset()
        useAdminComplianceStore.getState().reset()
      }
      return
    }

    if (useAuthStore.getState().isAdmin) {
      useAdminComplianceStore.getState().fetchStatus().catch((error: unknown) => {
        console.error('Failed to fetch admin compliance status:', error)
      })
    }

    let timer: number | undefined
    if (oldValue === false) {
      // New login: delay 3s then force fetch
      timer = window.setTimeout(() => void useAnnouncementStore.getState().fetchAnnouncements(true), 3000)
    } else {
      // Page refresh restore
      void useAnnouncementStore.getState().fetchAnnouncements()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isAuthenticated])

  // 订阅功能开关（opt-out）：关闭后不再预加载/轮询；登录后才到达的开关补启动，反向则清空
  useEffect(() => {
    if (!isAuthenticated) return
    if (subscriptionEnabled) {
      startSubscriptionSync()
    } else {
      useSubscriptionStore.getState().clear()
    }
  }, [isAuthenticated, subscriptionEnabled])
}

export default function RootLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const siteLogo = useAppStore((state) => state.siteLogo)

  useDocumentTitle()
  useSessionSync()

  useEffect(() => {
    if (siteLogo) {
      updateFavicon(siteLogo)
    }
  }, [siteLogo])

  // 路由变化时刷新公告（store 内部节流）
  useEffect(() => {
    if (useAuthStore.getState().isAuthenticated) {
      void useAnnouncementStore.getState().fetchAnnouncements()
    }
  }, [location.pathname])

  useEffect(() => {
    function onAdminComplianceRequired(event: Event) {
      const detail = (event as CustomEvent<Record<string, string>>).detail || {}
      useAdminComplianceStore.getState().requireAcknowledgement(detail)
    }
    window.addEventListener('admin-compliance-required', onAdminComplianceRequired)

    let cancelled = false
    void (async () => {
      // Check if setup is needed
      try {
        const status = await getSetupStatus()
        if (!cancelled && status.needs_setup && window.location.pathname !== '/setup') {
          navigate('/setup', { replace: true })
          return
        }
      } catch {
        // If setup endpoint fails, assume normal mode and continue
      }
      // Load public settings into appStore (cached for other components)
      await useAppStore.getState().fetchPublicSettings()
    })()

    return () => {
      cancelled = true
      window.removeEventListener('admin-compliance-required', onAdminComplianceRequired)
    }
  }, [navigate])

  return (
    <ToastStackProvider>
      <NavigationProgress />
      <Outlet />
      <ScrollRestoration />
      <ToastBridge />
      <ToastStack />
      <AnnouncementPopup />
      <AdminComplianceDialog />
    </ToastStackProvider>
  )
}
