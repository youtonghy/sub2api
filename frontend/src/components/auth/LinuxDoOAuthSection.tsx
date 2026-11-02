import { useSearchParams } from 'react-router'

import { Button } from '@/components/arc/button/button'
import type { OAuthLoginStart } from '@/api/auth'
import { useI18n } from '@/i18n/useI18n'
import { resolveAffiliateReferralCode, storeOAuthAffiliateCode } from '@/utils/oauthAffiliate'
import LinuxDoMark from './LinuxDoMark'
import OAuthDivider from './OAuthDivider'
import styles from './oauth.module.css'

export interface LinuxDoOAuthSectionProps {
  disabled?: boolean
  affCode?: string
  promoCode?: string
  showDivider?: boolean
  onStart: (request: OAuthLoginStart) => void
}

export default function LinuxDoOAuthSection({ disabled, affCode, promoCode, showDivider = true, onStart }: LinuxDoOAuthSectionProps) {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()

  function startLogin(): void {
    const redirectTo = searchParams.get('redirect') || '/dashboard'
    storeOAuthAffiliateCode(resolveAffiliateReferralCode(affCode, searchParams.get('aff'), searchParams.get('aff_code')))
    const params: Record<string, string> = { redirect: redirectTo }
    const trimmedPromoCode = promoCode?.trim()
    if (trimmedPromoCode) {
      params.promo_code = trimmedPromoCode
    }
    onStart({ provider: 'linuxdo', params })
  }

  return (
    <div className={styles.section}>
      <Button type="button" variant="secondary" disabled={disabled} className={styles.fullWidth} onClick={startLogin}>
        <LinuxDoMark className={styles.mark} />
        {t('auth.linuxdo.signIn')}
      </Button>
      {showDivider && <OAuthDivider />}
    </div>
  )
}
