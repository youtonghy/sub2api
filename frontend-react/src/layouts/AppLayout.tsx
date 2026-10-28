/**
 * 应用外壳：基于 Arc Pro sidebar-rail 的侧边栏（可收起为图标栏，窄屏为抽屉）与顶栏。
 * 对应 Vue 版 AppLayout + AppSidebar + AppHeader；作为父路由渲染，导航时不会重新挂载。
 */
import { useCallback, useEffect, useRef } from 'react'
import { BookOpen, Headset, KeyRound, LayoutGrid, RotateCcw, User } from 'lucide-react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'

import { SidebarRail } from '@/components/arc/blocks/sidebar-rail/sidebar-rail'
import { UserMenu } from '@/components/arc/user-menu/user-menu'
import AnnouncementBell from '@/components/common/AnnouncementBell'
import LocaleSwitcher from '@/components/common/LocaleSwitcher'
import SubscriptionProgressMini from '@/components/common/SubscriptionProgressMini'
import VersionBadge from '@/components/common/VersionBadge'
import { useOnboardingTour } from '@/composables/useOnboardingTour'
import { useI18n } from '@/i18n/useI18n'
import { resolveRouteMetaKeys } from '@/router/title'
import { useCurrentRoute } from '@/router/useCurrentRoute'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useOnboardingStore } from '@/stores/onboarding'
import { useTheme } from '@/theme/useTheme'
import { FeatureFlags, resolveFeatureFlag } from '@/utils/featureFlags'
import { resolveSiteBillingMode } from '@/utils/siteBillingMode'
import { sanitizeUrl } from '@/utils/url'
import BalanceDisplay from './BalanceDisplay'
import { resolveActiveEntry, useAppNavigation } from './useAppNavigation'
import styles from './AppLayout.module.css'

const TOUR_SELECTORS: Record<string, string> = {
  '/admin/groups': '#sidebar-group-manage',
  '/admin/accounts': '#sidebar-channel-manage',
  '/keys': '[data-tour="sidebar-my-keys"]',
}

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const siteName = useAppStore((state) => state.siteName)
  const rawLogo = useAppStore((state) => state.siteLogo)
  const siteVersion = useAppStore((state) => state.siteVersion)
  const settingsLoaded = useAppStore((state) => state.publicSettingsLoaded)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const siteLogo = sanitizeUrl(rawLogo || '', { allowRelative: true, allowDataUrl: true })
  const homePath = isAdmin ? '/admin/dashboard' : '/dashboard'

  return (
    <div className={styles.brand}>
      <Link to={homePath} className={styles.brandLink} aria-label={siteName}>
        <span className={styles.logo}>{settingsLoaded && <img src={siteLogo || '/logo.svg'} alt="" />}</span>
        <span className={styles.brandText} data-collapsed={collapsed || undefined} aria-hidden={collapsed}>
          <strong>{siteName}</strong>
        </span>
      </Link>
      <VersionBadge version={siteVersion} collapsed={collapsed} />
    </div>
  )
}

function PageHeading() {
  const { t } = useI18n()
  const route = useCurrentRoute()
  const settings = useAppStore((state) => state.cachedPublicSettings)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const adminMenuItems = useAdminSettingsStore((state) => state.customMenuItems)
  const keys = resolveRouteMetaKeys(route, { billingMode: resolveSiteBillingMode(settings) })

  let title = ''
  // 自定义页面使用菜单名称，而不是通用的「自定义页面」
  if (route.name === 'CustomPage') {
    const id = route.params.id
    const menuItem = (settings?.custom_menu_items ?? []).find((item) => item.id === id)
      ?? (isAdmin ? adminMenuItems.find((item) => item.id === id) : undefined)
    title = menuItem?.label ?? ''
  }
  if (!title) {
    title = keys.titleKey ? t(keys.titleKey) : route.meta.title ?? ''
  }
  const description = keys.descriptionKey ? t(keys.descriptionKey) : ''

  return (
    <div className={styles.heading}>
      <h1 className={styles.title}>{title}</h1>
      {description && <p className={styles.description}>{description}</p>}
    </div>
  )
}

function HeaderActions() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isSimpleMode = useAuthStore((state) => state.isSimpleMode)
  const rawDocUrl = useAppStore((state) => state.docUrl)
  const contactInfo = useAppStore((state) => state.contactInfo)
  const settings = useAppStore((state) => state.cachedPublicSettings)
  const { preference, setThemePreference } = useTheme()
  const docUrl = sanitizeUrl(rawDocUrl)
  const modelPlazaEnabled = resolveFeatureFlag(settings, FeatureFlags.modelPlaza)

  const handleLogout = useCallback(async () => {
    try {
      await useAuthStore.getState().logout()
    } catch (error) {
      // Ignore logout errors - still redirect to login
      console.error('Logout error:', error)
    }
    navigate('/login')
  }, [navigate])

  if (!user) {
    return <div className={styles.actions}><LocaleSwitcher /></div>
  }

  const displayName = user.username || user.email?.split('@')[0] || ''
  const items = [
    { label: t('nav.profile'), icon: <User size={16} strokeWidth={1.75} />, onSelect: () => navigate('/profile') },
    { label: t('nav.apiKeys'), icon: <KeyRound size={16} strokeWidth={1.75} />, onSelect: () => navigate('/keys') },
    // 联系客服（仅配置后显示），与 Vue 版用户下拉菜单一致
    ...(contactInfo ? [{ label: `${t('common.contactSupport')}: ${contactInfo}`, icon: <Headset size={16} strokeWidth={1.75} /> }] : []),
    // 只在标准模式的管理员下显示新手引导按钮
    ...(!isSimpleMode && user.role === 'admin'
      ? [{ label: t('onboarding.restartTour'), icon: <RotateCcw size={16} strokeWidth={1.75} />, onSelect: () => useOnboardingStore.getState().replay() }]
      : []),
  ]

  return (
    <div className={styles.actions}>
      <AnnouncementBell />
      {docUrl && (
        <a className={styles.iconLink} href={docUrl} target="_blank" rel="noopener noreferrer">
          <BookOpen size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.linkLabel}>{t('nav.docs')}</span>
        </a>
      )}
      {modelPlazaEnabled && (
        <Link className={styles.iconLink} to="/model-plaza?embedded=1" aria-label={t('nav.modelPlaza')} title={t('nav.modelPlaza')}>
          <LayoutGrid size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.linkLabel}>{t('nav.modelPlaza')}</span>
        </Link>
      )}
      <LocaleSwitcher />
      <SubscriptionProgressMini />
      <BalanceDisplay user={user} />
      <UserMenu
        user={{
          name: displayName,
          email: user.email,
          plan: t(`admin.users.roles.${user.role}`),
          avatarSrc: user.avatar_url?.trim() || undefined,
        }}
        items={items}
        theme={preference}
        onThemeChange={setThemePreference}
        onSignOut={handleLogout}
        labels={{
          theme: t('shell.theme'),
          light: t('nav.lightMode'),
          dark: t('nav.darkMode'),
          system: t('shell.themeSystem'),
          signOut: t('nav.logout'),
          signingOut: t('nav.logout'),
          accountMenu: t('common.userMenu'),
        }}
        showName
      />
    </div>
  )
}

export default function AppLayout() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const collapsed = useAppStore((state) => state.sidebarCollapsed)
  const mobileOpen = useAppStore((state) => state.mobileOpen)
  const { sections, paths } = useAppNavigation()
  const activeId = resolveActiveEntry(location.pathname, paths)
  const contentRef = useRef<HTMLDivElement>(null)
  const isAdminUser = useAuthStore((state) => state.user?.role === 'admin')
  const { replayTour } = useOnboardingTour({ storageKey: isAdminUser ? 'admin_guide' : 'user_guide', autoStart: true })

  useEffect(() => {
    useOnboardingStore.getState().setReplayCallback(replayTour)
  }, [replayTour])

  function handleSelect(id: string) {
    navigate(id)
    // 新手引导：点击引导指向的菜单项时推进到下一步（与 Vue 版 AppSidebar 一致）
    const selector = TOUR_SELECTORS[id]
    const onboarding = useOnboardingStore.getState()
    if (selector && onboarding.isCurrentStep(selector)) {
      onboarding.nextStep(500)
    }
  }

  // 页面内容在外壳内部滚动，切换页面时回到顶部
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <SidebarRail
      sections={sections}
      activeId={activeId}
      onSelect={handleSelect}
      brand={(isCollapsed) => <SidebarBrand collapsed={isCollapsed} />}
      topbar={<><PageHeading /><HeaderActions /></>}
      contentRef={contentRef}
      collapsed={collapsed}
      onCollapsedChange={(next) => useAppStore.getState().setSidebarCollapsed(next)}
      sheetOpen={mobileOpen}
      onSheetOpenChange={(open) => useAppStore.getState().setMobileOpen(open)}
      labels={{
        navigation: t('shell.navigation'),
        expand: t('shell.expandSidebar'),
        collapse: t('shell.collapseSidebar'),
        openNavigation: t('shell.openNavigation'),
        closeNavigation: t('shell.closeNavigation'),
      }}
    >
      <Outlet />
    </SidebarRail>
  )
}
