import { useI18n } from '@/i18n/useI18n'
import styles from './oauth.module.css'

/** “或使用以下方式继续”分隔线 */
export default function OAuthDivider() {
  const { t } = useI18n()
  return (
    <div className={styles.divider}>
      <span className={styles.dividerLine} />
      <span className={styles.dividerText}>{t('auth.oauthOrContinue')}</span>
      <span className={styles.dividerLine} />
    </div>
  )
}
