import { useEffect, useState, type KeyboardEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { PasswordField } from '@/components/arc/password-field/password-field'
import { sanitizeRedirectPath } from '@/components/auth/oauthCallback'
import { apiClient } from '@/api/client'
import { buildApiUrl } from '@/api/url'
import {
  exchangePendingOAuthCompletion,
  persistOAuthTokenContext,
  type OAuthTokenResponse
} from '@/api/auth'
import { useClipboard } from '@/composables/useClipboard'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import {
  clearAllAffiliateReferralCodes,
  loadOAuthAffiliateCode,
  oauthAffiliatePayload
} from '@/utils/oauthAffiliate'
import styles from './authView.module.css'

const EMAIL_OAUTH_PENDING_PROVIDER_KEY = 'email_oauth_pending_provider'

type EmailOAuthPendingCompletion = Partial<OAuthTokenResponse> & {
  error?: string
  provider?: string
  redirect?: string
  email?: string
  resolved_email?: string
  invitation_required?: boolean
}

function parseFragmentParams(): URLSearchParams {
  const raw = typeof window !== 'undefined' ? window.location.hash : ''
  const hash = raw.startsWith('#') ? raw.slice(1) : raw
  return new URLSearchParams(hash)
}

function readTokenResponse(params: URLSearchParams): OAuthTokenResponse | null {
  const accessToken = params.get('access_token')?.trim() || ''
  if (!accessToken) return null

  const response: OAuthTokenResponse = { access_token: accessToken }
  const refreshToken = params.get('refresh_token')?.trim() || ''
  if (refreshToken) response.refresh_token = refreshToken
  const expiresIn = Number.parseInt(params.get('expires_in')?.trim() || '', 10)
  if (Number.isFinite(expiresIn) && expiresIn > 0) response.expires_in = expiresIn
  const tokenType = params.get('token_type')?.trim() || ''
  if (tokenType) response.token_type = tokenType
  return response
}

function readPendingEmailOAuthProvider(): 'github' | 'google' | null {
  if (typeof window === 'undefined') return null
  const provider = window.sessionStorage.getItem(EMAIL_OAUTH_PENDING_PROVIDER_KEY)
  if (provider === 'github' || provider === 'google') return provider
  return null
}

function hasOAuthTokenResponse(value: Partial<OAuthTokenResponse>): value is OAuthTokenResponse {
  return typeof value.access_token === 'string' && value.access_token.trim() !== ''
}

/** 通用 OAuth 回调页：处理邮箱类 OAuth（GitHub/Google）的完成与补全注册，或展示授权码供手动复制 */
export default function OAuthCallbackView() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { copyToClipboard } = useClipboard()

  const [isProcessing, setIsProcessing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [needsRegistrationCompletion, setNeedsRegistrationCompletion] = useState(false)
  const [invitationRequired, setInvitationRequired] = useState(false)
  const [registrationEmail, setRegistrationEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [registrationError, setRegistrationError] = useState('')
  const [pendingProvider, setPendingProvider] = useState<'github' | 'google'>('github')
  const [redirectTo, setRedirectTo] = useState('/dashboard')
  const [invalidCallback, setInvalidCallback] = useState(false)

  const code = searchParams.get('code') || ''
  const state = searchParams.get('state') || ''
  const error = searchParams.get('error') || searchParams.get('error_description') || ''
  const fullUrl = typeof window === 'undefined' ? '' : window.location.href
  const providerName = pendingProvider === 'google' ? 'Google' : 'GitHub'
  const registrationHint = invitationRequired
    ? t('auth.oidc.invitationRequired', { providerName })
    : t('auth.oidc.completeRegistration')
  const canSubmitRegistration =
    Boolean(registrationEmail.trim()) &&
    password.length >= 6 &&
    password === confirmPassword &&
    (!invitationRequired || Boolean(invitationCode.trim()))

  function redirectProviderCallbackToBackend(provider: 'github' | 'google'): void {
    if (typeof window === 'undefined') return
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
    window.location.href = buildApiUrl(`/auth/oauth/${provider}/callback${suffix}`)
  }

  async function finalizeTokenResponse(tokenResponse: OAuthTokenResponse, redirect: string) {
    persistOAuthTokenContext(tokenResponse)
    await useAuthStore.getState().setToken(tokenResponse.access_token)
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(EMAIL_OAUTH_PENDING_PROVIDER_KEY)
    }
    clearAllAffiliateReferralCodes()
    useAppStore.getState().showSuccess(t('auth.loginSuccess'))
    await navigate(sanitizeRedirectPath(redirect), { replace: true })
  }

  async function resumePendingEmailOAuth() {
    setIsProcessing(true)
    let completionRequired = false
    try {
      const completion = await exchangePendingOAuthCompletion() as EmailOAuthPendingCompletion
      const completionRedirect = completion.redirect || '/dashboard'
      if (hasOAuthTokenResponse(completion)) {
        await finalizeTokenResponse(completion, completionRedirect)
        return
      }

      const provider = String(completion.provider || '').toLowerCase()
      if (provider === 'github' || provider === 'google') {
        setPendingProvider(provider)
      }
      setRedirectTo(sanitizeRedirectPath(completionRedirect))

      if (completion.error === 'invitation_required' || completion.error === 'registration_completion_required') {
        setInvitationRequired(completion.error === 'invitation_required' || completion.invitation_required === true)
        setRegistrationEmail(String(completion.resolved_email || completion.email || '').trim())
        setNeedsRegistrationCompletion(true)
        completionRequired = true
        setIsProcessing(false)
        return
      }

      useAppStore.getState().showError(completion.error || t('auth.loginFailed'))
    } catch (e: unknown) {
      const err = e as { message?: string; response?: { data?: { message?: string } } }
      useAppStore.getState().showError(err.response?.data?.message || err.message || t('auth.loginFailed'))
      setInvalidCallback(true)
    } finally {
      if (!completionRequired) {
        setIsProcessing(false)
      }
    }
  }

  async function handleSubmitRegistration() {
    setRegistrationError('')
    if (!registrationEmail.trim()) {
      setRegistrationError(t('auth.emailRequired'))
      return
    }
    if (password.length < 6) {
      setRegistrationError(t('auth.passwordMinLength'))
      return
    }
    if (password !== confirmPassword) {
      setRegistrationError(t('auth.passwordsDoNotMatch'))
      return
    }
    const trimmedCode = invitationCode.trim()
    if (invitationRequired && !trimmedCode) return

    setIsSubmitting(true)
    try {
      const payload: { password: string; invitation_code?: string; aff_code?: string } = {
        password,
        ...oauthAffiliatePayload(loadOAuthAffiliateCode())
      }
      if (invitationRequired) {
        payload.invitation_code = trimmedCode
      }
      const { data } = await apiClient.post<OAuthTokenResponse>(
        `/auth/oauth/${pendingProvider}/complete-registration`,
        payload
      )
      await finalizeTokenResponse(data, redirectTo)
    } catch (e: unknown) {
      const err = e as { message?: string; response?: { data?: { message?: string } } }
      setRegistrationError(err.response?.data?.message || err.message || t('auth.oidc.completeRegistrationFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  useMountOnce(async () => {
    const params = parseFragmentParams()
    const tokenResponse = readTokenResponse(params)
    const fragmentError = params.get('error') || ''
    const fragmentErrorDescription = params.get('error_description') || params.get('error_message') || ''

    if (fragmentError) {
      useAppStore.getState().showError(fragmentErrorDescription || fragmentError)
      return
    }
    if (!tokenResponse) {
      if (location.pathname === '/auth/oauth/callback') {
        const pendingEmailOAuthProvider = readPendingEmailOAuthProvider()
        if (pendingEmailOAuthProvider && code && state) {
          redirectProviderCallbackToBackend(pendingEmailOAuthProvider)
          return
        }
        await resumePendingEmailOAuth()
      }
      return
    }

    setIsProcessing(true)
    try {
      await finalizeTokenResponse(tokenResponse, params.get('redirect') || '/dashboard')
    } catch (err: unknown) {
      useAppStore.getState().showError((err as { message?: string })?.message || t('auth.loginFailed'))
      setIsProcessing(false)
    }
  })

  useEffect(() => {
    if (error) {
      useAppStore.getState().showError(error)
    }
  }, [error])

  const copy = (value: string) => {
    if (!value) return
    void copyToClipboard(value)
  }

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') void handleSubmitRegistration()
  }

  const passwordMessages = { showPassword: t('authUi.showPassword'), hidePassword: t('authUi.hidePassword') }

  let content
  if (isProcessing) {
    content = (
      <div className={`${styles.panel} ${styles.panelCentered}`}>
        <Loader2 className={styles.spinner} size={28} strokeWidth={1.75} aria-hidden="true" />
        <div className={styles.panelHeader}>
          <h1 className={styles.panelTitle}>{t('auth.oauth.callbackTitle')}</h1>
          <p className={styles.panelText}>{t('auth.oauth.callbackHint')}</p>
        </div>
      </div>
    )
  } else if (needsRegistrationCompletion) {
    content = (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h1 className={styles.panelTitle}>{t('auth.oidc.callbackTitle', { providerName })}</h1>
          <p className={styles.panelText}>{registrationHint}</p>
        </div>
        <Input label={t('auth.emailLabel')} type="email" value={registrationEmail} readOnly disabled />
        <PasswordField
          label={t('auth.passwordLabel')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t('auth.createPasswordPlaceholder')}
          disabled={isSubmitting}
          autoComplete="new-password"
          onKeyUp={submitOnEnter}
          messages={passwordMessages}
        />
        <PasswordField
          label={t('auth.confirmPassword')}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder={t('auth.confirmPasswordPlaceholder')}
          disabled={isSubmitting}
          autoComplete="new-password"
          onKeyUp={submitOnEnter}
          messages={passwordMessages}
        />
        {invitationRequired && (
          <Input
            label={t('auth.invitationCodeLabel')}
            type="text"
            value={invitationCode}
            onChange={(event) => setInvitationCode(event.target.value)}
            placeholder={t('auth.invitationCodePlaceholder')}
            disabled={isSubmitting}
            onKeyUp={submitOnEnter}
          />
        )}
        {registrationError && <p className={styles.inlineError} role="alert">{registrationError}</p>}
        <Button
          type="button"
          className={styles.fullWidth}
          loading={isSubmitting}
          disabled={!isSubmitting && !canSubmitRegistration}
          onClick={() => void handleSubmitRegistration()}
        >
          {isSubmitting ? t('common.processing') : t('auth.oidc.completeRegistration')}
        </Button>
      </div>
    )
  } else if (invalidCallback) {
    content = (
      <div className={`${styles.panel} ${styles.panelCentered}`}>
        <div className={styles.panelHeader}>
          <h1 className={styles.panelTitle}>{t('auth.oauth.invalidCallbackTitle')}</h1>
          <p className={styles.panelText}>{t('auth.oauth.invalidCallbackHint')}</p>
        </div>
        <Button type="button" onClick={() => void navigate('/login', { replace: true })}>
          {t('auth.backToLogin')}
        </Button>
      </div>
    )
  } else {
    content = (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h1 className={styles.panelTitle}>{t('auth.oauth.callbackTitle')}</h1>
          <p className={styles.panelText}>{t('auth.oauth.callbackHint')}</p>
        </div>
        {[
          { label: t('auth.oauth.code'), value: code },
          { label: t('auth.oauth.state'), value: state },
          { label: t('auth.oauth.fullUrl'), value: fullUrl }
        ].map((item) => (
          <div key={item.label} className={styles.copyRow}>
            <Input label={item.label} className={styles.mono} value={item.value} readOnly />
            <Button type="button" variant="secondary" disabled={!item.value} onClick={() => copy(item.value)}>
              {t('common.copy')}
            </Button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={styles.standalone}>
      <div className={styles.standaloneInner}>{content}</div>
    </div>
  )
}
