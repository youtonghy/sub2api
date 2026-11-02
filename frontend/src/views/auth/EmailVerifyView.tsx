import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'
import { createStore, useStore } from 'zustand'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { OtpInput } from '@/components/arc/otp-input/otp-input'
import AuthHeading from '@/components/auth/AuthHeading'
import {
  EMPTY_CAPTCHA_SETTINGS,
  captchaChallengeProps,
  captchaFlags,
  readCaptchaSettings,
  type CaptchaSettings
} from '@/components/auth/authForm'
import CaptchaChallenge, { type CaptchaChallengeHandle } from '@/components/captcha/CaptchaChallenge'
import {
  persistOAuthTokenContext,
  getPublicSettings,
  isOAuthLoginCompletion,
  type PendingOAuthSendVerifyCodeResponse,
  sendPendingOAuthVerifyCode,
  sendVerifyCode,
} from '@/api/auth'
import { apiClient } from '@/api/client'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { AuthFooter } from '@/layouts/AuthLayout'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { buildAuthErrorMessage } from '@/utils/authError'
import { extractApiErrorCode } from '@/utils/apiError'
import {
  formatRegistrationEmailSuffixWhitelistForMessage,
  isRegistrationEmailSuffixAllowed,
  normalizeRegistrationEmailSuffixWhitelist
} from '@/utils/registrationEmailPolicy'
import {
  clearAllAffiliateReferralCodes,
  loadAffiliateReferralCode,
  oauthAffiliatePayload
} from '@/utils/oauthAffiliate'
import styles from './authView.module.css'

type PendingAuthTokenField = 'pending_auth_token' | 'pending_oauth_token'
type PendingOAuthCreateAccountResponse = {
  auth_result?: string
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  provider?: string
  redirect?: string
}

interface VerifyState {
  isLoading: boolean
  isSendingCode: boolean
  codeSent: boolean
  verifyCode: string
  countdown: number
  // Registration data from sessionStorage
  email: string
  password: string
  initialTurnstileToken: string
  initialTencentCaptchaRandstr: string
  promoCode: string
  invitationCode: string
  affCode: string
  pendingAuthToken: string
  pendingAuthTokenField: PendingAuthTokenField
  pendingProvider: string
  pendingRedirect: string
  pendingAdoptionDecision: { adoptDisplayName?: boolean; adoptAvatar?: boolean } | null
  hasRegisterData: boolean
  // Public settings
  captcha: CaptchaSettings
  siteName: string
  registrationEmailSuffixWhitelist: string[]
  // 域名限量注册开关：开启时非白名单域名可注册 1 个账户（由后端判定），前端不做白名单预检。
  emailDomainQuotaEnabled: boolean
  // Turnstile for resend
  resendTurnstileToken: string
  resendTencentCaptchaRandstr: string
  createAccountTurnstileToken: string
  createAccountTencentCaptchaRandstr: string
  showResendTurnstile: boolean
  errors: { code: string; turnstile: string }
}

export default function EmailVerifyView() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()

  const [store] = useState(() =>
    createStore<VerifyState>(() => ({
      isLoading: false,
      isSendingCode: false,
      codeSent: false,
      verifyCode: '',
      countdown: 0,
      email: '',
      password: '',
      initialTurnstileToken: '',
      initialTencentCaptchaRandstr: '',
      promoCode: '',
      invitationCode: '',
      affCode: '',
      pendingAuthToken: '',
      pendingAuthTokenField: 'pending_auth_token',
      pendingProvider: '',
      pendingRedirect: '',
      pendingAdoptionDecision: null,
      hasRegisterData: false,
      captcha: EMPTY_CAPTCHA_SETTINGS,
      siteName: 'RetooAi',
      registrationEmailSuffixWhitelist: [],
      emailDomainQuotaEnabled: false,
      resendTurnstileToken: '',
      resendTencentCaptchaRandstr: '',
      createAccountTurnstileToken: '',
      createAccountTencentCaptchaRandstr: '',
      showResendTurnstile: false,
      errors: { code: '', turnstile: '' }
    }))
  )
  const state = useStore(store)
  const get = store.getState
  const set = store.setState
  const turnstileRef = useRef<CaptchaChallengeHandle>(null)
  const createAccountTurnstileRef = useRef<CaptchaChallengeHandle>(null)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const setError = (key: 'code' | 'turnstile', value: string) => set({ errors: { ...get().errors, [key]: value } })
  const flags = () => captchaFlags(get().captcha)
  const isPendingOAuthFlow = () => Boolean(get().pendingProvider.trim())

  // 校验文案变为新的非空值时弹出提示（Vue 版 watch(validationToastMessage)）
  useEffect(() => store.subscribe((next, prev) => {
    const value = next.errors.code || next.errors.turnstile || ''
    const previous = prev.errors.code || prev.errors.turnstile || ''
    if (value && value !== previous) {
      useAppStore.getState().showError(value)
    }
  }), [store])

  useEffect(() => () => {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current)
      countdownTimer.current = null
    }
  }, [])

  // ==================== Lifecycle ====================

  useMountOnce(async () => {
    const activePendingSession = useAuthStore.getState().pendingAuthSession

    // Load registration data from sessionStorage
    const registerDataStr = sessionStorage.getItem('register_data')
    if (registerDataStr) {
      try {
        const registerData = JSON.parse(registerDataStr)
        const email = registerData.email || ''
        const password = registerData.password || ''
        set({
          email,
          password,
          initialTurnstileToken: registerData.tencent_captcha_ticket || registerData.turnstile_token || '',
          initialTencentCaptchaRandstr: registerData.tencent_captcha_randstr || '',
          promoCode: registerData.promo_code || '',
          invitationCode: registerData.invitation_code || '',
          affCode: registerData.aff_code || loadAffiliateReferralCode(),
          pendingAuthToken: registerData.pending_auth_token || activePendingSession?.token || '',
          pendingAuthTokenField: registerData.pending_auth_token_field || activePendingSession?.token_field || 'pending_auth_token',
          pendingProvider: registerData.pending_provider || activePendingSession?.provider || '',
          pendingRedirect: registerData.pending_redirect || activePendingSession?.redirect || '',
          pendingAdoptionDecision: registerData.pending_adoption_decision
            ? {
                adoptDisplayName: registerData.pending_adoption_decision.adopt_display_name === true,
                adoptAvatar: registerData.pending_adoption_decision.adopt_avatar === true
              }
            : null,
          hasRegisterData: !!(email && password)
        })
      } catch {
        set({ hasRegisterData: false })
      }
    } else if (activePendingSession) {
      set({
        pendingAuthToken: activePendingSession.token,
        pendingAuthTokenField: activePendingSession.token_field,
        pendingProvider: activePendingSession.provider,
        pendingRedirect: activePendingSession.redirect || ''
      })
    }

    // Load public settings
    try {
      const settings = await getPublicSettings()
      set({
        captcha: readCaptchaSettings(settings),
        siteName: settings.site_name || 'RetooAi',
        registrationEmailSuffixWhitelist: normalizeRegistrationEmailSuffixWhitelist(
          settings.registration_email_suffix_whitelist || []
        ),
        emailDomainQuotaEnabled: settings.registration_email_domain_quota_enabled === true
      })
    } catch (error) {
      console.error('Failed to load public settings:', error)
    }

    // Auto-send verification code if we have valid data
    if (get().hasRegisterData) {
      await sendCode()
    }
  })

  // ==================== Countdown ====================

  function startCountdown(seconds: number): void {
    set({ countdown: seconds })

    if (countdownTimer.current) {
      clearInterval(countdownTimer.current)
    }

    countdownTimer.current = setInterval(() => {
      if (get().countdown > 0) {
        set({ countdown: get().countdown - 1 })
      } else if (countdownTimer.current) {
        clearInterval(countdownTimer.current)
        countdownTimer.current = null
      }
    }, 1000)
  }

  // ==================== Turnstile Handlers ====================

  function onTurnstileVerify(token: string, randstr = ''): void {
    set({ resendTurnstileToken: token, resendTencentCaptchaRandstr: randstr })
    setError('turnstile', '')
  }

  function onTurnstileExpire(): void {
    set({ resendTurnstileToken: '', resendTencentCaptchaRandstr: '' })
    setError('turnstile', t('auth.turnstileExpired'))
  }

  function onTurnstileError(): void {
    set({ resendTurnstileToken: '', resendTencentCaptchaRandstr: '' })
    setError('turnstile', t('auth.turnstileFailed'))
  }

  function onCreateAccountTurnstileVerify(token: string, randstr = ''): void {
    set({ createAccountTurnstileToken: token, createAccountTencentCaptchaRandstr: randstr })
    setError('turnstile', '')
  }

  function onCreateAccountTurnstileExpire(): void {
    set({ createAccountTurnstileToken: '', createAccountTencentCaptchaRandstr: '' })
    setError('turnstile', t('auth.turnstileExpired'))
  }

  function onCreateAccountTurnstileError(): void {
    set({ createAccountTurnstileToken: '', createAccountTencentCaptchaRandstr: '' })
    setError('turnstile', t('auth.turnstileFailed'))
  }

  function resetCreateAccountTurnstile(): void {
    set({ createAccountTurnstileToken: '', createAccountTencentCaptchaRandstr: '' })
    createAccountTurnstileRef.current?.reset()
  }

  async function acquireResendActionProof(): Promise<boolean> {
    if (!flags().actionCaptchaEnabled) return true

    const proof = await turnstileRef.current?.verifyAction()
    if (!proof) return false

    set({ resendTurnstileToken: proof.token, resendTencentCaptchaRandstr: proof.randstr })
    return true
  }

  async function acquireCreateAccountActionProof(): Promise<boolean> {
    if (!isPendingOAuthFlow() || !flags().actionCaptchaEnabled) return true

    const proof = await createAccountTurnstileRef.current?.verifyAction()
    if (!proof) return false

    set({ createAccountTurnstileToken: proof.token, createAccountTencentCaptchaRandstr: proof.randstr })
    return true
  }

  // 域名限量注册开启时交由后端按额度判定；pending OAuth / 换绑流程沿用后端策略，前端不预检。
  function shouldBypassRegistrationEmailPolicy(): boolean {
    return get().emailDomainQuotaEnabled || isPendingOAuthFlow() || Boolean(get().pendingAuthToken.trim())
  }

  function resolvePendingOAuthCallbackRoute(provider: string): string {
    switch (provider.trim().toLowerCase()) {
      case 'linuxdo':
        return '/auth/linuxdo/callback'
      case 'oidc':
        return '/auth/oidc/callback'
      case 'wechat':
        return '/auth/wechat/callback'
      default:
        return '/auth/callback'
    }
  }

  function persistPendingOAuthSession(provider: string, redirect?: string): void {
    const current = get()
    useAuthStore.getState().setPendingAuthSession({
      token: current.pendingAuthToken,
      token_field: current.pendingAuthTokenField,
      provider: provider.trim() || current.pendingProvider.trim(),
      redirect: redirect || current.pendingRedirect || undefined,
    })
  }

  function buildEmailSuffixNotAllowedMessage(): string {
    const normalizedWhitelist = normalizeRegistrationEmailSuffixWhitelist(get().registrationEmailSuffixWhitelist)
    if (normalizedWhitelist.length === 0) {
      return t('auth.emailSuffixNotAllowed')
    }
    const separator = String(locale || '').toLowerCase().startsWith('zh') ? '、' : ', '
    return t('auth.emailSuffixNotAllowedWithAllowed', {
      suffixes: formatRegistrationEmailSuffixWhitelistForMessage(normalizedWhitelist, {
        separator,
        more: (count) => t('auth.emailSuffixAllowedMore', { count })
      })
    })
  }

  function buildRegistrationErrorMessage(error: unknown, fallback: string): string {
    if (extractApiErrorCode(error) === 'EMAIL_DOMAIN_REGISTRATION_LIMIT') {
      return t('auth.emailDomainRegistrationLimit')
    }
    return buildAuthErrorMessage(error, { fallback })
  }

  function clearStoredCaptchaProof(): void {
    const registerDataStr = sessionStorage.getItem('register_data')
    if (!registerDataStr) return

    try {
      const registerData = JSON.parse(registerDataStr) as Record<string, unknown>
      delete registerData.turnstile_token
      delete registerData.tencent_captcha_ticket
      delete registerData.tencent_captcha_randstr
      sessionStorage.setItem('register_data', JSON.stringify(registerData))
    } catch {
      // Invalid registration state is handled by the existing mount parser.
    }
  }

  // ==================== Send Code ====================

  async function sendCode(): Promise<void> {
    set({ isSendingCode: true })
    let requestSucceeded = false
    let captchaProofUsed = false

    try {
      const current = get()
      if (!shouldBypassRegistrationEmailPolicy() && !isRegistrationEmailSuffixAllowed(current.email, current.registrationEmailSuffixWhitelist)) {
        useAppStore.getState().showError(buildEmailSuffixNotAllowedMessage())
        return
      }

      const { captcha } = current
      const requestPayload = {
        email: current.email,
        [current.pendingAuthTokenField]: current.pendingAuthToken || undefined,
        // 优先使用重发时新获取的 token（因为初始 token 可能已被使用）
        turnstile_token:
          captcha.turnstileEnabled || captcha.aliyunCaptchaEnabled
            ? current.resendTurnstileToken || current.initialTurnstileToken || undefined
            : undefined,
        tencent_captcha_ticket: captcha.tencentCaptchaEnabled
          ? current.resendTurnstileToken || current.initialTurnstileToken || undefined
          : undefined,
        tencent_captcha_randstr: captcha.tencentCaptchaEnabled
          ? current.resendTencentCaptchaRandstr || current.initialTencentCaptchaRandstr || undefined
          : undefined
      } as Parameters<typeof sendVerifyCode>[0]
      captchaProofUsed = Boolean(requestPayload.turnstile_token || requestPayload.tencent_captcha_ticket)
      const response = isPendingOAuthFlow()
        ? await sendPendingOAuthVerifyCode(requestPayload)
        : await sendVerifyCode(requestPayload)
      requestSucceeded = true

      const pendingSendCodeSession = isPendingOAuthFlow()
        ? ((response as PendingOAuthSendVerifyCodeResponse).auth_result === 'pending_session'
            ? (response as PendingOAuthSendVerifyCodeResponse)
            : null)
        : null
      if (pendingSendCodeSession) {
        sessionStorage.removeItem('register_data')
        persistPendingOAuthSession(
          pendingSendCodeSession.provider || get().pendingProvider,
          pendingSendCodeSession.redirect,
        )
        await navigate(resolvePendingOAuthCallbackRoute(pendingSendCodeSession.provider || get().pendingProvider))
        return
      }

      set({ codeSent: true })
      startCountdown(response.countdown)
      set({ showResendTurnstile: false })
    } catch (error: unknown) {
      useAppStore.getState().showError(buildRegistrationErrorMessage(error, t('auth.sendCodeFailed')))
    } finally {
      if (captchaProofUsed) {
        clearStoredCaptchaProof()
        set({
          initialTurnstileToken: '',
          initialTencentCaptchaRandstr: '',
          resendTurnstileToken: '',
          resendTencentCaptchaRandstr: ''
        })
        turnstileRef.current?.reset()
        if (!requestSucceeded && get().captcha.turnstileEnabled) {
          set({ showResendTurnstile: true })
        }
      }
      set({ isSendingCode: false })
    }
  }

  // ==================== Handlers ====================

  async function handleResendCode(): Promise<void> {
    const current = get()
    // Turnstile stays staged; Tencent is acquired from this action.
    if (current.captcha.turnstileEnabled && !current.showResendTurnstile) {
      set({ showResendTurnstile: true })
      return
    }

    if (current.captcha.turnstileEnabled && !current.resendTurnstileToken) {
      setError('turnstile', t('auth.completeVerification'))
      return
    }

    if (!(await acquireResendActionProof())) {
      return
    }

    await sendCode()
  }

  function validateForm(): boolean {
    setError('code', '')
    const code = get().verifyCode.trim()

    if (!code) {
      setError('code', t('auth.codeRequired'))
      return false
    }

    if (!/^\d{6}$/.test(code)) {
      setError('code', t('auth.invalidCode'))
      return false
    }

    return true
  }

  async function handleVerify(event: FormEvent): Promise<void> {
    event.preventDefault()

    if (!validateForm()) {
      return
    }

    if (!shouldBypassRegistrationEmailPolicy() && !isRegistrationEmailSuffixAllowed(get().email, get().registrationEmailSuffixWhitelist)) {
      useAppStore.getState().showError(buildEmailSuffixNotAllowedMessage())
      return
    }

    if (!(await acquireCreateAccountActionProof())) {
      return
    }

    set({ isLoading: true })

    try {
      const current = get()
      const { captcha } = current
      if (isPendingOAuthFlow()) {
        const payload: Record<string, unknown> = {
          email: current.email,
          password: current.password,
          verify_code: current.verifyCode.trim(),
          ...((captcha.turnstileEnabled || captcha.aliyunCaptchaEnabled) && current.createAccountTurnstileToken
            ? { turnstile_token: current.createAccountTurnstileToken }
            : {}),
          ...(captcha.tencentCaptchaEnabled && current.createAccountTurnstileToken
            ? {
                tencent_captcha_ticket: current.createAccountTurnstileToken,
                tencent_captcha_randstr: current.createAccountTencentCaptchaRandstr
              }
            : {}),
          ...oauthAffiliatePayload(current.affCode || loadAffiliateReferralCode()),
        }
        if (current.invitationCode) {
          payload.invitation_code = current.invitationCode
        }
        if (current.pendingAdoptionDecision?.adoptDisplayName !== undefined) {
          payload.adopt_display_name = current.pendingAdoptionDecision.adoptDisplayName
        }
        if (current.pendingAdoptionDecision?.adoptAvatar !== undefined) {
          payload.adopt_avatar = current.pendingAdoptionDecision.adoptAvatar
        }

        const { data } = await apiClient.post<PendingOAuthCreateAccountResponse>(
          '/auth/oauth/pending/create-account',
          payload
        )
        if (data.auth_result === 'pending_session') {
          sessionStorage.removeItem('register_data')
          persistPendingOAuthSession(data.provider || current.pendingProvider, data.redirect)
          await navigate(resolvePendingOAuthCallbackRoute(data.provider || current.pendingProvider))
          return
        }
        if (!isOAuthLoginCompletion(data)) {
          throw new Error(t('auth.verifyFailed'))
        }

        persistOAuthTokenContext(data)
        await useAuthStore.getState().setToken(data.access_token)
        useAuthStore.getState().clearPendingAuthSession?.()
      } else {
        // Register with verification code
        await useAuthStore.getState().register({
          email: current.email,
          password: current.password,
          verify_code: current.verifyCode.trim(),
          turnstile_token:
            captcha.turnstileEnabled || captcha.aliyunCaptchaEnabled
              ? current.initialTurnstileToken || undefined
              : undefined,
          tencent_captcha_ticket: captcha.tencentCaptchaEnabled ? current.initialTurnstileToken || undefined : undefined,
          tencent_captcha_randstr: captcha.tencentCaptchaEnabled ? current.initialTencentCaptchaRandstr || undefined : undefined,
          promo_code: current.promoCode || undefined,
          invitation_code: current.invitationCode || undefined,
          ...(current.affCode ? { aff_code: current.affCode } : {})
        })
      }

      // Clear session data
      sessionStorage.removeItem('register_data')
      clearAllAffiliateReferralCodes()

      useAppStore.getState().showSuccess(t('auth.accountCreatedSuccess', { siteName: current.siteName }))

      await navigate(current.pendingRedirect || '/dashboard')
    } catch (error: unknown) {
      useAppStore.getState().showError(buildRegistrationErrorMessage(error, t('auth.verifyFailed')))
    } finally {
      set({ initialTurnstileToken: '', initialTencentCaptchaRandstr: '' })
      if (isPendingOAuthFlow() && flags().captchaEnabled) {
        resetCreateAccountTurnstile()
      }
      set({ isLoading: false })
    }
  }

  function handleBack(): void {
    // Clear session data
    sessionStorage.removeItem('register_data')

    // Go back to registration
    void navigate('/register')
  }

  const { actionCaptchaEnabled, captchaEnabled } = captchaFlags(state.captcha)
  const turnstileEnabled = state.captcha.turnstileEnabled
  const pendingOAuthFlow = Boolean(state.pendingProvider.trim())
  const pendingOAuthCreateTurnstileRequired = pendingOAuthFlow && turnstileEnabled
  const pendingOAuthCreateCaptchaEnabled = pendingOAuthFlow && captchaEnabled

  return (
    <div className={styles.page}>
      <AuthHeading title={t('auth.verifyYourEmail')}>
        {t('auth.sendCodeDesc')} <span className={styles.emphasis}>{state.email}</span>
      </AuthHeading>

      {!state.hasRegisterData ? (
        <Alert tone="warning" title={t('auth.sessionExpired')}>
          {t('auth.sessionExpiredDesc')}
        </Alert>
      ) : (
        <form className={styles.form} onSubmit={(event) => void handleVerify(event)} noValidate>
          <div data-testid="verify-code">
            <OtpInput
              label={t('auth.verificationCode')}
              description={t('auth.verificationCodeHint')}
              value={state.verifyCode}
              onChange={(value) => set({ verifyCode: value })}
              disabled={state.isLoading}
              autoFocus
            />
          </div>

          {state.codeSent && <Alert tone="success" title={t('auth.codeSentSuccess')} />}

          {(actionCaptchaEnabled || (turnstileEnabled && state.showResendTurnstile)) && (
            <CaptchaChallenge
              ref={turnstileRef}
              {...captchaChallengeProps(state.captcha)}
              onVerify={onTurnstileVerify}
              onExpire={onTurnstileExpire}
              onError={onTurnstileError}
            />
          )}

          {pendingOAuthCreateCaptchaEnabled && (
            <CaptchaChallenge
              ref={createAccountTurnstileRef}
              {...captchaChallengeProps(state.captcha)}
              onVerify={onCreateAccountTurnstileVerify}
              onExpire={onCreateAccountTurnstileExpire}
              onError={onCreateAccountTurnstileError}
            />
          )}

          <Button
            type="submit"
            className={styles.fullWidth}
            loading={state.isLoading}
            disabled={
              !state.isLoading &&
              (!state.verifyCode || (pendingOAuthCreateTurnstileRequired && !state.createAccountTurnstileToken))
            }
          >
            {state.isLoading ? t('auth.verifying') : t('auth.verifyAndCreate')}
          </Button>

          <div className={styles.center}>
            {state.countdown > 0 ? (
              <button type="button" disabled className={styles.resend}>
                {t('auth.resendCountdown', { countdown: state.countdown })}
              </button>
            ) : (
              <button
                type="button"
                className={styles.resend}
                onClick={() => void handleResendCode()}
                disabled={
                  state.isSendingCode || (turnstileEnabled && state.showResendTurnstile && !state.resendTurnstileToken)
                }
              >
                {state.isSendingCode
                  ? t('auth.sendingCode')
                  : captchaEnabled && !state.showResendTurnstile
                    ? t('auth.clickToResend')
                    : t('auth.resendCode')}
              </button>
            )}
          </div>
        </form>
      )}

      <AuthFooter>
        <button type="button" className={styles.footerButton} onClick={handleBack}>
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          {t('auth.backToRegistration')}
        </button>
      </AuthFooter>
    </div>
  )
}
