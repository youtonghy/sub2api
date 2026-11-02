/**
 * 首页，对应 Vue 版 views/HomeView.vue。
 * 优先级：管理员自定义首页内容（URL → iframe，否则原样渲染 HTML）> 精简首页 > 默认首页。
 * 主题切换使用 @/theme/useTheme（沿用 localStorage 键 theme）。
 */
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  LayoutGrid,
  Moon,
  Server,
  Shield,
  Sun,
  Users,
  Wallet
} from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router'

import buttonStyles from '@/components/arc/button/button.module.css'
import LocaleSwitcher from '@/components/common/LocaleSwitcher'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/theme/useTheme'
import { FeatureFlags, resolveFeatureFlag } from '@/utils/featureFlags'
import { sanitizeUrl } from '@/utils/url'
import styles from './HomeView.module.css'

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const

export default function HomeView() {
  const { t } = useI18n()
  const { isDark, toggleTheme } = useTheme()
  const settings = useAppStore((state) => state.cachedPublicSettings)
  const storeSiteName = useAppStore((state) => state.siteName)
  const storeSiteLogo = useAppStore((state) => state.siteLogo)
  const storeDocUrl = useAppStore((state) => state.docUrl)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const user = useAuthStore((state) => state.user)

  // Site settings - directly from appStore (already initialized from injected config)
  const siteName = settings?.site_name || storeSiteName || 'RetooAi'
  const siteLogo = sanitizeUrl(settings?.site_logo || storeSiteLogo || '', { allowRelative: true, allowDataUrl: true })
  const siteSubtitle = settings?.site_subtitle || 'AI API Gateway Platform'
  const docUrl = sanitizeUrl(settings?.doc_url || storeDocUrl || '')
  const homeContent = settings?.home_content || ''
  const hasHomeContent = homeContent.trim().length > 0
  const compactHomeEnabled = settings?.compact_home_enabled === true
  const modelPlazaEnabled = resolveFeatureFlag(settings, FeatureFlags.modelPlaza)

  // Check if homeContent is a URL (for iframe display)
  const trimmedHomeContent = homeContent.trim()
  const isHomeContentUrl = trimmedHomeContent.startsWith('http://') || trimmedHomeContent.startsWith('https://')

  const modelPlazaRequiresAuth = settings?.model_plaza_require_auth === true
  const showModelPlazaEntry = modelPlazaEnabled && (isAuthenticated || !modelPlazaRequiresAuth)
  const dashboardPath = isAdmin ? '/admin/dashboard' : '/dashboard'
  const userInitial = user?.email ? user.email.charAt(0).toUpperCase() : ''
  const currentYear = new Date().getFullYear()
  const themeTitle = isDark ? t('home.switchToLight') : t('home.switchToDark')

  useEffect(() => {
    // Check auth state
    useAuthStore.getState().checkAuth()

    // Ensure public settings are loaded (will use cache if already loaded from injected config)
    const appStore = useAppStore.getState()
    if (!appStore.publicSettingsLoaded) {
      void appStore.fetchPublicSettings()
    }
  }, [])

  // Custom Home Content: Full Page Mode
  if (hasHomeContent) {
    return (
      <div className={styles.fullPage}>
        {isHomeContentUrl ? (
          <iframe src={trimmedHomeContent} className={styles.homeFrame} allowFullScreen title={siteName} />
        ) : (
          // SECURITY: homeContent is admin-only setting, XSS risk is acceptable
          <div dangerouslySetInnerHTML={{ __html: homeContent }} />
        )}
      </div>
    )
  }

  const docLink = docUrl ? (
    <a
      href={docUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.iconButton}
      title={t('home.viewDocs')}
      aria-label={t('home.viewDocs')}
    >
      <BookOpen {...ICON} />
    </a>
  ) : null

  const modelPlazaLink = showModelPlazaEntry ? (
    <Link to="/model-plaza" className={styles.navLink} title={t('nav.modelPlaza')}>
      <LayoutGrid {...ICON} />
      <span className={styles.navLinkLabel}>{t('nav.modelPlaza')}</span>
    </Link>
  ) : null

  const themeButton = (
    <button type="button" className={styles.iconButton} title={themeTitle} aria-label={themeTitle} onClick={toggleTheme}>
      {isDark ? <Sun {...ICON} /> : <Moon {...ICON} />}
    </button>
  )

  const primaryLink = (extra: string) => [buttonStyles.button, buttonStyles.primary, buttonStyles.md, styles.buttonLink, extra].join(' ')

  // Compact Home Page
  if (compactHomeEnabled) {
    return (
      <div data-testid="compact-home" className={styles.compact}>
        <header className={styles.compactHeader}>
          <nav className={styles.compactNav}>
            <div className={styles.compactBrand}>
              <img src={siteLogo || '/logo.svg'} alt="Logo" className={styles.compactLogo} />
              <span className={styles.compactSiteName}>{siteName}</span>
            </div>
            <div className={styles.actions}>
              <LocaleSwitcher />
              {docLink}
              {modelPlazaLink}
              {themeButton}
              <Link to={isAuthenticated ? dashboardPath : '/login'} className={primaryLink('')} data-home-entry="">
                {isAuthenticated ? t('home.dashboard') : t('home.login')}
              </Link>
            </div>
          </nav>
        </header>

        <main className={styles.compactMain}>
          <div className={styles.compactHero}>
            <img src={siteLogo || '/logo.svg'} alt="Logo" className={styles.compactHeroLogo} />
            <h1 className={styles.compactTitle}>{siteName}</h1>
            <p className={styles.compactSubtitle}>{siteSubtitle}</p>
            <Link to={isAuthenticated ? dashboardPath : '/login'} className={primaryLink(styles.compactCta)}>
              {isAuthenticated ? t('home.goToDashboard') : t('home.login')}
            </Link>
          </div>
        </main>

        <footer className={styles.compactFooter}>
          &copy; {currentYear} {siteName}
        </footer>
      </div>
    )
  }

  const features = [
    { icon: Server, title: t('home.features.unifiedGateway'), desc: t('home.features.unifiedGatewayDesc') },
    { icon: Users, title: t('home.features.multiAccount'), desc: t('home.features.multiAccountDesc') },
    { icon: Wallet, title: t('home.features.balanceQuota'), desc: t('home.features.balanceQuotaDesc') }
  ]

  const tags = [
    { icon: ArrowLeftRight, label: t('home.tags.subscriptionToApi') },
    { icon: Shield, label: t('home.tags.stickySession') },
    { icon: BarChart3, label: t('home.tags.realtimeBilling') }
  ]

  const providers = [
    { initial: 'C', name: t('home.providers.claude') },
    { initial: 'G', name: 'GPT' },
    { initial: 'G', name: t('home.providers.gemini') },
    { initial: 'A', name: t('home.providers.antigravity') }
  ]

  // Default Home Page
  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <nav className={styles.nav}>
          {/* Logo */}
          <div className={styles.logo}>
            <img src={siteLogo || '/logo.svg'} alt="Logo" />
          </div>

          {/* Nav Actions */}
          <div className={styles.actions}>
            <LocaleSwitcher />
            {docLink}
            {modelPlazaLink}
            {themeButton}

            {/* Login / Dashboard Button */}
            {isAuthenticated ? (
              <Link to={dashboardPath} className={styles.dashboardPill} data-home-entry="">
                <span className={styles.avatar}>{userInitial}</span>
                <span>{t('home.dashboard')}</span>
                <ArrowUpRight size={12} strokeWidth={2} aria-hidden="true" />
              </Link>
            ) : (
              <Link to="/login" className={styles.loginPill} data-home-entry="">
                {t('home.login')}
              </Link>
            )}
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className={styles.main}>
        <div className={styles.container}>
          {/* Hero Section - Left/Right Layout */}
          <div className={styles.hero}>
            {/* Left: Text Content */}
            <div className={styles.heroText}>
              <h1 className={styles.heroTitle}>{siteName}</h1>
              <p className={styles.heroSubtitle}>{siteSubtitle}</p>
              <Link to={isAuthenticated ? dashboardPath : '/login'} className={[buttonStyles.button, buttonStyles.primary, buttonStyles.lg, styles.buttonLink].join(' ')}>
                {isAuthenticated ? t('home.goToDashboard') : t('home.getStarted')}
                <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>

            {/* Right: Terminal Animation */}
            <div className={styles.heroVisual}>
              <div className={styles.terminalContainer} data-terminal="">
                <div className={styles.terminalWindow} aria-hidden="true">
                  <div className={styles.terminalHeader}>
                    <div className={styles.terminalButtons}>
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className={styles.terminalTitle}>terminal</span>
                  </div>
                  <div className={styles.terminalBody}>
                    <div className={styles.codeLine} style={{ animationDelay: '0.3s' }}>
                      <span className={styles.codePrompt}>$</span>
                      <span className={styles.codeCmd}>curl</span>
                      <span className={styles.codeFlag}>-X POST</span>
                      <span className={styles.codeUrl}>/v1/messages</span>
                    </div>
                    <div className={styles.codeLine} style={{ animationDelay: '1s' }}>
                      <span className={styles.codeComment}># Routing to upstream...</span>
                    </div>
                    <div className={styles.codeLine} style={{ animationDelay: '1.8s' }}>
                      <span className={styles.codeSuccess}>200 OK</span>
                      <span className={styles.codeResponse}>{'{ "content": "Hello!" }'}</span>
                    </div>
                    <div className={styles.codeLine} style={{ animationDelay: '2.5s' }}>
                      <span className={styles.codePrompt}>$</span>
                      <span className={styles.cursor} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Feature Tags - Centered */}
          <div className={styles.tags}>
            {tags.map(({ icon: Icon, label }) => (
              <div key={label} className={styles.tag}>
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                <span>{label}</span>
              </div>
            ))}
          </div>

          {/* Features Grid */}
          <div className={styles.features}>
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className={styles.feature}>
                <div className={styles.featureIcon}>
                  <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <h3 className={styles.featureTitle}>{title}</h3>
                <p className={styles.featureDesc}>{desc}</p>
              </div>
            ))}
          </div>

          {/* Supported Providers */}
          <div className={styles.providersHeading}>
            <h2 className={styles.providersTitle}>{t('home.providers.title')}</h2>
            <p className={styles.providersDesc}>{t('home.providers.description')}</p>
          </div>

          <div className={styles.providers}>
            {providers.map((provider) => (
              <div key={provider.name} className={styles.provider}>
                <span className={styles.providerInitial}>{provider.initial}</span>
                <span className={styles.providerName}>{provider.name}</span>
                <span className={styles.providerSupported}>{t('home.providers.supported')}</span>
              </div>
            ))}
            {/* More - Coming Soon */}
            <div className={`${styles.provider} ${styles.providerSoon}`}>
              <span className={styles.providerInitial}>+</span>
              <span className={styles.providerName}>{t('home.providers.more')}</span>
              <span className={styles.providerSoonBadge}>{t('home.providers.soon')}</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <p className={styles.footerText}>
            &copy; {currentYear} {siteName}. {t('home.footer.allRightsReserved')}
          </p>
          {docUrl && (
            <a href={docUrl} target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
              {t('home.docs')}
            </a>
          )}
        </div>
      </footer>
    </div>
  )
}
