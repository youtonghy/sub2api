import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import AuthHeading from '@/components/auth/AuthHeading'
import PendingOAuthCreateAccountForm, {
  type PendingOAuthCreateAccountPayload
} from '@/components/auth/PendingOAuthCreateAccountForm'
import { getRequestErrorMessage, sanitizeRedirectPath } from '@/components/auth/oauthCallback'
import { apiClient } from '@/api/client'
import { persistOAuthTokenContext, type PendingOAuthExchangeResponse } from '@/api/auth'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { clearAllAffiliateReferralCodes } from '@/utils/oauthAffiliate'
import styles from './authView.module.css'

/** 钉钉账户没有邮箱时补填邮箱并创建账户 */
export default function DingTalkEmailCompletionView() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [accountActionError, setAccountActionError] = useState('')
  const [initialEmail] = useState(() => searchParams.get('email') || '')

  function navigateToBindLogin(email: string) {
    const query: Record<string, string> = { bind: '1' }
    if (email) query.email = email
    const redirect = searchParams.get('redirect')
    if (redirect) query.redirect = redirect
    void navigate(`/auth/dingtalk/callback?${new URLSearchParams(query).toString()}`, { replace: true })
  }

  async function handleCreateAccount(payload: PendingOAuthCreateAccountPayload) {
    setAccountActionError('')
    if (!payload.email || !payload.password) return

    setIsSubmitting(true)
    try {
      const { data } = await apiClient.post<
        PendingOAuthExchangeResponse & {
          step?: string
          redirect?: string
          existing_account_bindable?: boolean
        }
      >(
        '/auth/oauth/pending/create-account',
        {
          email: payload.email,
          password: payload.password,
          verify_code: payload.verifyCode || undefined,
          ...(payload.turnstileToken ? { turnstile_token: payload.turnstileToken } : {}),
          ...(payload.tencentCaptchaTicket
            ? {
                tencent_captcha_ticket: payload.tencentCaptchaTicket,
                tencent_captcha_randstr: payload.tencentCaptchaRandstr
              }
            : {}),
          invitation_code: payload.invitationCode || undefined
        }
      )

      const redirect = sanitizeRedirectPath(data.redirect || searchParams.get('redirect'))

      if (data.access_token) {
        persistOAuthTokenContext(data)
        await useAuthStore.getState().setToken(data.access_token)
        clearAllAffiliateReferralCodes()
        useAppStore.getState().showSuccess(t('auth.loginSuccess'))
        await navigate(redirect, { replace: true })
        return
      }

      // 后端把 pending session 转到 choice 状态（用户填的 email 已在系统内）→ 跳回 callback view 走绑定流程
      if (data.step === 'choose_account_action_required' || data.existing_account_bindable === true) {
        navigateToBindLogin(payload.email)
        return
      }

      setAccountActionError(t('auth.loginFailed'))
    } catch (e: unknown) {
      // 全局"开放注册"关闭且未开启钉钉企业模式豁免时，引导用户去绑定已有账户而非死路
      const err = e as { response?: { data?: { reason?: string } } }
      if (err.response?.data?.reason === 'REGISTRATION_DISABLED') {
        useAppStore.getState().showInfo(t('auth.dingtalk.registrationDisabledRedirectToBind'))
        navigateToBindLogin(payload.email)
        return
      }
      setAccountActionError(getRequestErrorMessage(e, t('auth.loginFailed')))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <AuthHeading title={t('auth.dingtalk.createAccountTitle')}>{t('auth.oauthFlow.createAccountHint')}</AuthHeading>

      <PendingOAuthCreateAccountForm
        testIdPrefix="dingtalk"
        initialEmail={initialEmail}
        isSubmitting={isSubmitting}
        errorMessage={accountActionError}
        onSubmit={(payload) => void handleCreateAccount(payload)}
        onSwitchToBind={navigateToBindLogin}
      />
    </div>
  )
}
