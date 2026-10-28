import { useEffect } from 'react'
import { useSearchParams } from 'react-router'

import { Button } from '@/components/arc/button/button'
import { resolveWeChatOAuthStart, type OAuthLoginStart } from '@/api/auth'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { resolveAffiliateReferralCode, storeOAuthAffiliateCode } from '@/utils/oauthAffiliate'
import OAuthDivider from './OAuthDivider'
import styles from './oauth.module.css'

export interface WechatOAuthSectionProps {
  disabled?: boolean
  affCode?: string
  showDivider?: boolean
  onStart: (request: OAuthLoginStart) => void
}

export default function WechatOAuthSection({ disabled, affCode, showDivider = true, onStart }: WechatOAuthSectionProps) {
  const { t, locale } = useI18n()
  const [searchParams] = useSearchParams()
  const cachedPublicSettings = useAppStore((state) => state.cachedPublicSettings)
  const providerName = t('auth.wechatProviderName')

  const resolvedStart = resolveWeChatOAuthStart(cachedPublicSettings)
  const buttonDisabled = Boolean(disabled) || resolvedStart.mode === null

  function localizeWeChatHint(zh: string, en: string): string {
    return locale.startsWith('zh') ? zh : en
  }

  function resolveDisabledHint(): string {
    if (disabled) {
      return ''
    }
    switch (resolvedStart.unavailableReason) {
      case 'external_browser_required':
        return t('auth.oauthFlow.wechatSystemBrowserOnly')
      case 'wechat_browser_required':
        return t('auth.oauthFlow.wechatBrowserOnly')
      case 'native_app_required':
        return localizeWeChatHint(
          '当前仅配置微信移动应用登录，需要在原生 App 中通过微信 SDK 发起授权。',
          'This site only has WeChat mobile app login configured. Continue from the native app through the WeChat SDK.',
        )
      case 'not_configured':
        return t('auth.oauthFlow.wechatNotConfigured')
      default:
        return ''
    }
  }
  const disabledHint = resolveDisabledHint()

  useEffect(() => {
    const appStore = useAppStore.getState()
    if (!appStore.cachedPublicSettings && !appStore.publicSettingsLoaded) {
      void appStore.fetchPublicSettings()
    }
  }, [])

  function startLogin(): void {
    if (buttonDisabled || !resolvedStart.mode) {
      return
    }
    const redirectTo = searchParams.get('redirect') || '/dashboard'
    storeOAuthAffiliateCode(resolveAffiliateReferralCode(affCode, searchParams.get('aff'), searchParams.get('aff_code')))
    const mode = resolvedStart.mode
    onStart({
      provider: 'wechat',
      params: { mode, redirect: redirectTo }
    })
  }

  return (
    <div className={styles.section}>
      <Button type="button" variant="secondary" disabled={buttonDisabled} className={styles.fullWidth} onClick={startLogin}>
        <span className={`${styles.initial} ${styles.initialWechat}`} aria-hidden="true">W</span>
        {t('auth.oidc.signIn', { providerName })}
      </Button>

      {disabledHint && (
        <p data-testid="wechat-oauth-hint" className={styles.hint}>
          {disabledHint}
        </p>
      )}

      {showDivider && <OAuthDivider />}
    </div>
  )
}
