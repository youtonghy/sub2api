import { useSearchParams } from 'react-router'

import { Button } from '@/components/arc/button/button'
import type { OAuthLoginStart } from '@/api/auth'
import { useI18n } from '@/i18n/useI18n'
import { resolveAffiliateReferralCode, storeOAuthAffiliateCode } from '@/utils/oauthAffiliate'
import OAuthDivider from './OAuthDivider'
import styles from './oauth.module.css'

export interface DingTalkOAuthSectionProps {
  disabled?: boolean
  affCode?: string
  showDivider?: boolean
  onStart: (request: OAuthLoginStart) => void
}

/** 钉钉品牌图标，与 Vue 版相同 */
function DingTalkMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1677FF" />
      <text x="12" y="17" fontFamily="sans-serif" fontSize="13" fontWeight="bold" fill="white" textAnchor="middle">D</text>
    </svg>
  )
}

export default function DingTalkOAuthSection({ disabled, affCode, showDivider = true, onStart }: DingTalkOAuthSectionProps) {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()

  function startLogin(): void {
    const redirectTo = searchParams.get('redirect') || '/dashboard'
    storeOAuthAffiliateCode(resolveAffiliateReferralCode(affCode, searchParams.get('aff'), searchParams.get('aff_code')))
    onStart({ provider: 'dingtalk', params: { redirect: redirectTo } })
  }

  return (
    <div className={styles.section}>
      <Button type="button" variant="secondary" disabled={disabled} className={styles.fullWidth} onClick={startLogin}>
        <DingTalkMark />
        {t('auth.dingtalk.signIn')}
      </Button>
      {showDivider && <OAuthDivider />}
    </div>
  )
}
