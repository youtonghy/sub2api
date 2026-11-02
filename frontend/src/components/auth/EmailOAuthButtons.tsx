import { useSearchParams } from 'react-router'

import { Button } from '@/components/arc/button/button'
import type { OAuthLoginStart } from '@/api/auth'
import { useI18n } from '@/i18n/useI18n'
import { resolveAffiliateReferralCode, storeOAuthAffiliateCode } from '@/utils/oauthAffiliate'
import GitHubMark from './GitHubMark'
import GoogleMark from './GoogleMark'
import OAuthDivider from './OAuthDivider'
import styles from './oauth.module.css'

type EmailOAuthProvider = 'github' | 'google'
const EMAIL_OAUTH_PENDING_PROVIDER_KEY = 'email_oauth_pending_provider'

export interface EmailOAuthButtonsProps {
  disabled?: boolean
  affCode?: string
  promoCode?: string
  githubEnabled?: boolean
  googleEnabled?: boolean
  showDivider?: boolean
  onStart: (request: OAuthLoginStart) => void
}

export default function EmailOAuthButtons({
  disabled,
  affCode,
  promoCode,
  githubEnabled,
  googleEnabled,
  showDivider = true,
  onStart
}: EmailOAuthButtonsProps) {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()

  const visibleProviders: EmailOAuthProvider[] = []
  if (githubEnabled) visibleProviders.push('github')
  if (googleEnabled) visibleProviders.push('google')
  const hasMultipleProviders = visibleProviders.length > 1

  function providerLabel(provider: EmailOAuthProvider): string {
    const name = provider === 'github' ? 'GitHub' : 'Google'
    return hasMultipleProviders ? name : t('auth.emailOAuth.signIn', { providerName: name })
  }

  function startLogin(provider: EmailOAuthProvider): void {
    const redirectTo = searchParams.get('redirect') || '/dashboard'
    const affiliateCode = resolveAffiliateReferralCode(affCode, searchParams.get('aff'), searchParams.get('aff_code'))
    storeOAuthAffiliateCode(affiliateCode)
    window.sessionStorage.setItem(EMAIL_OAUTH_PENDING_PROVIDER_KEY, provider)
    const params: Record<string, string> = { redirect: redirectTo }
    if (affiliateCode) {
      params.aff_code = affiliateCode
    }
    const trimmedPromoCode = promoCode?.trim()
    if (trimmedPromoCode) {
      params.promo_code = trimmedPromoCode
    }
    onStart({ provider, params })
  }

  if (visibleProviders.length === 0) {
    return null
  }

  return (
    <div className={styles.section}>
      {showDivider && <OAuthDivider />}

      <div className={styles.providerGrid} data-columns={hasMultipleProviders ? 2 : 1}>
        {visibleProviders.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="secondary"
            disabled={disabled}
            className={styles.providerButton}
            onClick={() => startLogin(provider)}
          >
            {provider === 'github' ? <GitHubMark className={styles.mark} /> : <GoogleMark className={styles.mark} />}
            <span>{providerLabel(provider)}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}
