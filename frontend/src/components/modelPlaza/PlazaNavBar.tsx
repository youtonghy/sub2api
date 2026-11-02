/**
 * 模型广场独立形态的顶部导航，对应 Vue 版 components/modelPlaza/PlazaNavBar.vue。
 * 左：站点 logo + 名称（公共设置未加载时为骨架）；右：登录 / 回到后台。
 */
import { Link } from 'react-router'

import buttonStyles from '@/components/arc/button/button.module.css'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { sanitizeUrl } from '@/utils/url'
import styles from './PlazaNavBar.module.css'

export default function PlazaNavBar() {
  const { t } = useI18n()
  const settings = useAppStore((state) => state.cachedPublicSettings)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isAdmin = useAuthStore((state) => state.isAdmin)

  const siteName = settings?.site_name || 'RetooAi'
  const siteLogo = sanitizeUrl(settings?.site_logo || '', { allowRelative: true, allowDataUrl: true })
  const backTarget = isAdmin ? '/admin/dashboard' : '/dashboard'
  const linkClass = [buttonStyles.button, buttonStyles.primary, buttonStyles.md, styles.action].join(' ')

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        {/* 左：站点 logo + 名称 */}
        <div className={styles.brand}>
          {settings ? (
            <>
              <span className={styles.logo}>
                <img src={siteLogo || '/logo.svg'} alt="Logo" />
              </span>
              <span className={styles.siteName}>{siteName}</span>
            </>
          ) : (
            <>
              <span className={`${styles.logo} ${styles.placeholder}`} aria-hidden="true" />
              <span className={styles.namePlaceholder} aria-hidden="true" />
            </>
          )}
        </div>

        {/* 右：登录 / 回到后台 */}
        {isAuthenticated ? (
          <Link to={backTarget} className={linkClass}>
            {t('modelPlaza.nav.backToDashboard')}
          </Link>
        ) : (
          <Link to={{ pathname: '/login', search: `?${new URLSearchParams({ redirect: '/model-plaza' })}` }} className={linkClass}>
            {t('modelPlaza.nav.login')}
          </Link>
        )}
      </div>
    </header>
  )
}
