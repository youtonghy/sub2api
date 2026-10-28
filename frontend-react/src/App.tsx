import { Button } from '@/components/arc/button/button'
import { availableLocales } from '@/i18n'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useTheme } from '@/theme/useTheme'
import styles from './App.module.css'

/**
 * 基础骨架预览：验证设计 token、字体、主题与语言切换。
 * 下一步接入路由、布局与认证后由路由根组件替换。
 */
export default function App() {
  const { t, locale, setLocale } = useI18n()
  const { isDark, toggleTheme } = useTheme()
  const siteName = useAppStore((state) => state.siteName)
  const nextLocale = availableLocales.find((item) => item.code !== locale) ?? availableLocales[0]

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <img className={styles.logo} src="/logo.svg" alt="" />
        <h1 className={styles.title}>{siteName}</h1>
      </header>
      <p className={styles.description}>{t('common.peakRateTooltip', { window: '5h' })}</p>
      <div className={styles.actions}>
        <Button variant="primary">{t('common.save')}</Button>
        <Button variant="secondary" onClick={toggleTheme}>
          {isDark ? t('nav.lightMode') : t('nav.darkMode')}
        </Button>
        <Button variant="ghost" onClick={() => void setLocale(nextLocale.code)}>
          {nextLocale.name}
        </Button>
      </div>
    </main>
  )
}
