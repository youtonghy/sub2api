import { useSearchParams } from 'react-router'

import { Button } from '@/components/arc/button/button'
import type { OAuthLoginStart } from '@/api/auth'
import { useI18n } from '@/i18n/useI18n'
import { resolveAffiliateReferralCode, storeOAuthAffiliateCode } from '@/utils/oauthAffiliate'
import OAuthDivider from './OAuthDivider'
import styles from './oauth.module.css'

export interface OidcOAuthSectionProps {
  disabled?: boolean
  affCode?: string
  providerName?: string
  showDivider?: boolean
  onStart: (request: OAuthLoginStart) => void
}

export default function OidcOAuthSection({ disabled, affCode, providerName = 'OIDC', showDivider = true, onStart }: OidcOAuthSectionProps) {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  const normalizedProviderName = providerName?.trim() || 'OIDC'
  const providerInitial = normalizedProviderName.charAt(0).toUpperCase() || 'O'

  function startLogin(): void {
    const redirectTo = searchParams.get('redirect') || '/dashboard'
    storeOAuthAffiliateCode(resolveAffiliateReferralCode(affCode, searchParams.get('aff'), searchParams.get('aff_code')))
    onStart({ provider: 'oidc', params: { redirect: redirectTo } })
  }

  return (
    <div className={styles.section}>
      <Button type="button" variant="secondary" disabled={disabled} className={styles.fullWidth} onClick={startLogin}>
        <span className={styles.initial} aria-hidden="true">{providerInitial}</span>
        {t('auth.oidc.signIn', { providerName: normalizedProviderName })}
      </Button>
      {showDivider && <OAuthDivider />}
    </div>
  )
}
