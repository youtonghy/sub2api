/**
 * 登录类页面布局，基于 Arc Pro login-split 的分栏框架：左侧品牌栏、居中表单列与页脚，
 * 宽屏时右侧显示站点名与副标题。页面通过 <AuthFooter> 把链接（如去注册）放进页脚插槽，
 * 对应 Vue 版 AuthLayout 的 #footer 插槽。
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Outlet } from 'react-router'

import LocaleSwitcher from '@/components/common/LocaleSwitcher'
import { useAppStore } from '@/stores/app'
import { sanitizeUrl } from '@/utils/url'
import styles from './AuthLayout.module.css'

const FooterSlotContext = createContext<HTMLElement | null>(null)

/** 渲染到登录布局的页脚插槽（Vue 版的 #footer） */
export function AuthFooter({ children }: { children: ReactNode }) {
  const target = useContext(FooterSlotContext)
  return target ? createPortal(children, target) : null
}

export default function AuthLayout() {
  const siteName = useAppStore((state) => state.siteName) || 'RetooAi'
  const rawLogo = useAppStore((state) => state.siteLogo)
  const subtitle = useAppStore((state) => state.cachedPublicSettings?.site_subtitle) || 'Subscription to API Conversion Platform'
  const settingsLoaded = useAppStore((state) => state.publicSettingsLoaded)
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null)
  const siteLogo = sanitizeUrl(rawLogo || '', { allowRelative: true, allowDataUrl: true })
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    void useAppStore.getState().fetchPublicSettings()
  }, [])

  return (
    <div className={styles.root}>
      <div className={styles.layout}>
        <div className={styles.formSide}>
          <header className={styles.topBar}>
            <span className={styles.brand}>
              {settingsLoaded && <img className={styles.logo} src={siteLogo || '/logo.svg'} alt="" />}
              <span>{siteName}</span>
            </span>
            <LocaleSwitcher />
          </header>
          <main className={styles.main}>
            <div className={styles.column}>
              <FooterSlotContext.Provider value={footerSlot}>
                <Outlet />
              </FooterSlotContext.Provider>
              <div ref={setFooterSlot} className={styles.slot} />
            </div>
          </main>
          <footer className={styles.footer}>
            &copy; {currentYear} {siteName}. All rights reserved.
          </footer>
        </div>
        <aside className={styles.panel} aria-hidden="true">
          <div className={styles.panelContent}>
            <img className={styles.panelLogo} src={siteLogo || '/logo.svg'} alt="" />
            <p className={styles.panelTitle}>{siteName}</p>
            <p className={styles.panelSubtitle}>{subtitle}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
