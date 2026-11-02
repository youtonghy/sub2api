import { useEffect, useRef, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { PasswordField } from '@/components/arc/password-field/password-field'
import AuthHeading from '@/components/auth/AuthHeading'
import DingTalkOAuthSection from '@/components/auth/DingTalkOAuthSection'
import EmailOAuthButtons from '@/components/auth/EmailOAuthButtons'
import LinuxDoOAuthSection from '@/components/auth/LinuxDoOAuthSection'
import LoginAgreementPrompt from '@/components/auth/LoginAgreementPrompt'
import OAuthDivider from '@/components/auth/OAuthDivider'
import OidcOAuthSection from '@/components/auth/OidcOAuthSection'
import TotpLoginModal, { type TotpLoginModalHandle } from '@/components/auth/TotpLoginModal'
import WechatOAuthSection from '@/components/auth/WechatOAuthSection'
import {
  EMAIL_PATTERN,
  EMPTY_CAPTCHA_SETTINGS,
  captchaChallengeProps,
  captchaFlags,
  readCaptchaSettings,
  useCaptchaProof,
  useLoginAgreement,
  type CaptchaSettings
} from '@/components/auth/authForm'
import CaptchaChallenge, { type CaptchaChallengeHandle } from '@/components/captcha/CaptchaChallenge'
import {
  buildOAuthLoginStartURL,
  getPublicSettings,
  isTotp2FARequired,
  isWeChatWebOAuthEnabled,
  startOAuthLogin,
  type OAuthLoginStart
} from '@/api/auth'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { AuthFooter } from '@/layouts/AuthLayout'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { ActionCaptchaRequestProof, TotpLoginResponse } from '@/types'
import { extractI18nErrorMessage } from '@/utils/apiError'
import { clearAllAffiliateReferralCodes } from '@/utils/oauthAffiliate'
import styles from './authView.module.css'

interface LoginSettings {
  registrationEnabled: boolean
  linuxdoOAuthEnabled: boolean
  dingtalkOAuthEnabled: boolean
  wechatOAuthEnabled: boolean
  backendModeEnabled: boolean
  oidcOAuthEnabled: boolean
  oidcOAuthProviderName: string
  githubOAuthEnabled: boolean
  googleOAuthEnabled: boolean
  passwordResetEnabled: boolean
  passkeyEnabled: boolean
}

const DEFAULT_SETTINGS: LoginSettings = {
  registrationEnabled: false,
  linuxdoOAuthEnabled: false,
  dingtalkOAuthEnabled: false,
  wechatOAuthEnabled: false,
  backendModeEnabled: false,
  oidcOAuthEnabled: false,
  oidcOAuthProviderName: 'OIDC',
  githubOAuthEnabled: false,
  googleOAuthEnabled: false,
  passwordResetEnabled: false,
  passkeyEnabled: false
}

export default function LoginView() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [isLoading, setIsLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [publicSettingsLoaded, setPublicSettingsLoaded] = useState(false)
  const [settings, setSettings] = useState<LoginSettings>(DEFAULT_SETTINGS)
  const [captcha, setCaptcha] = useState<CaptchaSettings>(EMPTY_CAPTCHA_SETTINGS)
  const { agreement, gateActive: agreementGateActive, apply: applyLoginAgreementSettings, disable: disableAgreement, accept: acceptLoginAgreement, reject: rejectLoginAgreement, setShowModal: setShowAgreementModal } =
    useLoginAgreement('legal.loginAgreementPrompt.loginRejectedWarning')

  const turnstileRef = useRef<CaptchaChallengeHandle>(null)
  const { token: turnstileToken, proof, setProof } = useCaptchaProof()
  const { actionCaptchaEnabled, captchaEnabled } = captchaFlags(captcha)

  // 2FA state
  const [show2FAModal, setShow2FAModal] = useState(false)
  const [totpTempToken, setTotpTempToken] = useState('')
  const [totpUserEmailMasked, setTotpUserEmailMasked] = useState('')
  const totpModalRef = useRef<TotpLoginModalHandle>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({ email: '', password: '', turnstile: '' })

  const validationToastMessage = errors.email || errors.password || errors.turnstile || ''
  const authActionDisabled = isLoading || passkeyLoading || !publicSettingsLoaded || agreementGateActive
  const showPasskeyLogin = settings.passkeyEnabled && typeof window.PublicKeyCredential !== 'undefined'
  const showOAuthLogin =
    !settings.backendModeEnabled &&
    (settings.linuxdoOAuthEnabled ||
      settings.dingtalkOAuthEnabled ||
      settings.wechatOAuthEnabled ||
      settings.oidcOAuthEnabled ||
      settings.githubOAuthEnabled ||
      settings.googleOAuthEnabled)

  useEffect(() => {
    if (validationToastMessage) {
      useAppStore.getState().showError(validationToastMessage)
    }
  }, [validationToastMessage])

  const redirectTarget = () => searchParams.get('redirect') || '/dashboard'

  // ==================== Lifecycle ====================

  useMountOnce(async () => {
    const expiredFlag = sessionStorage.getItem('auth_expired')
    if (expiredFlag) {
      sessionStorage.removeItem('auth_expired')
      useAppStore.getState().showWarning(t('auth.reloginRequired'))
    }

    try {
      const publicSettings = await getPublicSettings()
      setCaptcha(readCaptchaSettings(publicSettings))
      setSettings({
        registrationEnabled: publicSettings.registration_enabled === true,
        linuxdoOAuthEnabled: publicSettings.linuxdo_oauth_enabled,
        dingtalkOAuthEnabled: publicSettings.dingtalk_oauth_enabled ?? false,
        wechatOAuthEnabled: isWeChatWebOAuthEnabled(publicSettings),
        backendModeEnabled: publicSettings.backend_mode_enabled,
        oidcOAuthEnabled: publicSettings.oidc_oauth_enabled,
        oidcOAuthProviderName: publicSettings.oidc_oauth_provider_name || 'OIDC',
        githubOAuthEnabled: publicSettings.github_oauth_enabled,
        googleOAuthEnabled: publicSettings.google_oauth_enabled,
        passwordResetEnabled: publicSettings.password_reset_enabled,
        passkeyEnabled: publicSettings.passkey_enabled === true
      })
      applyLoginAgreementSettings(publicSettings)
    } catch (error) {
      console.error('Failed to load public settings:', error)
      disableAgreement()
    } finally {
      setPublicSettingsLoaded(true)
    }
  })

  // ==================== Turnstile Handlers ====================

  function onTurnstileVerify(token: string, randstr = ''): void {
    setProof(token, randstr)
    setErrors((current) => ({ ...current, turnstile: '' }))
  }

  function onTurnstileExpire(): void {
    setProof('', '')
    setErrors((current) => ({ ...current, turnstile: t('auth.turnstileExpired') }))
  }

  function onTurnstileError(): void {
    setProof('', '')
    setErrors((current) => ({ ...current, turnstile: t('auth.turnstileFailed') }))
  }

  function resetCaptchaProof(): void {
    turnstileRef.current?.reset()
    setProof('', '')
    setErrors((current) => ({ ...current, turnstile: '' }))
  }

  async function acquireActionProof(): Promise<boolean> {
    if (!actionCaptchaEnabled) return true

    const result = await turnstileRef.current?.verifyAction()
    if (!result) return false

    setProof(result.token, result.randstr)
    return true
  }

  function warnAgreementRequired(): void {
    useAppStore.getState().showWarning(t('legal.loginAgreementPrompt.loginRequiredWarning'))
    if (agreement.mode !== 'checkbox') {
      setShowAgreementModal(true)
    }
  }

  // ==================== Validation ====================

  function validateForm(): boolean {
    const nextErrors = { email: '', password: '', turnstile: '' }

    if (agreementGateActive) {
      setErrors(nextErrors)
      warnAgreementRequired()
      return false
    }

    // Email validation
    if (!email.trim()) {
      nextErrors.email = t('auth.emailRequired')
    } else if (!EMAIL_PATTERN.test(email)) {
      nextErrors.email = t('auth.invalidEmail')
    }

    // Password validation
    if (!password) {
      nextErrors.password = t('auth.passwordRequired')
    } else if (password.length < 6) {
      nextErrors.password = t('auth.passwordMinLength')
    }

    // Turnstile validation
    if (captcha.turnstileEnabled && !proof.current.token) {
      nextErrors.turnstile = t('auth.completeVerification')
    }

    setErrors(nextErrors)
    return !nextErrors.email && !nextErrors.password && !nextErrors.turnstile
  }

  // ==================== Form Handlers ====================

  async function handleLogin(event: FormEvent): Promise<void> {
    event.preventDefault()

    if (!validateForm()) {
      return
    }

    if (!(await acquireActionProof())) {
      return
    }

    setIsLoading(true)

    try {
      // Call auth store login（阿里云 captchaVerifyParam 复用 turnstile_token 字段）
      const { token, randstr } = proof.current
      const response = await useAuthStore.getState().login({
        email,
        password,
        turnstile_token: captcha.turnstileEnabled || captcha.aliyunCaptchaEnabled ? token : undefined,
        tencent_captcha_ticket: captcha.tencentCaptchaEnabled ? token : undefined,
        tencent_captcha_randstr: captcha.tencentCaptchaEnabled ? randstr : undefined
      })

      // Check if 2FA is required
      if (isTotp2FARequired(response)) {
        const totpResponse = response as TotpLoginResponse
        setTotpTempToken(totpResponse.temp_token || '')
        setTotpUserEmailMasked(totpResponse.user_email_masked || '')
        setShow2FAModal(true)
        setIsLoading(false)
        return
      }

      clearAllAffiliateReferralCodes()
      useAppStore.getState().showSuccess(t('auth.loginSuccess'))

      // Redirect to dashboard or intended route
      await navigate(redirectTarget())
    } catch (error: unknown) {
      useAppStore.getState().showError(extractI18nErrorMessage(error, t, 'auth.errors', t('auth.loginFailed')))
    } finally {
      if (captchaEnabled) {
        resetCaptchaProof()
      }
      setIsLoading(false)
    }
  }

  async function handlePasskeyLogin(): Promise<void> {
    if (agreementGateActive) {
      warnAgreementRequired()
      return
    }

    setPasskeyLoading(true)
    try {
      let passkeyProof: ActionCaptchaRequestProof | undefined
      if (actionCaptchaEnabled) {
        const result = await turnstileRef.current?.verifyAction()
        if (!result) return
        passkeyProof = captcha.tencentCaptchaEnabled
          ? {
              tencent_captcha_ticket: result.token,
              tencent_captcha_randstr: result.randstr
            }
          : { turnstile_token: result.token }
      }

      await useAuthStore.getState().loginWithPasskey(passkeyProof)
      clearAllAffiliateReferralCodes()
      useAppStore.getState().showSuccess(t('auth.loginSuccess'))
      await navigate(redirectTarget())
    } catch (error: unknown) {
      const fallback = error instanceof DOMException && error.name === 'NotAllowedError'
        ? t('auth.passkeyCancelled')
        : t('auth.passkeyFailed')
      useAppStore.getState().showError(extractI18nErrorMessage(error, t, 'auth.errors', fallback))
    } finally {
      if (actionCaptchaEnabled) {
        resetCaptchaProof()
      }
      setPasskeyLoading(false)
    }
  }

  async function handleOAuthStart(request: OAuthLoginStart): Promise<void> {
    if (authActionDisabled) return

    if (!actionCaptchaEnabled) {
      window.location.href = buildOAuthLoginStartURL(request)
      return
    }

    setIsLoading(true)
    try {
      const result = await turnstileRef.current?.verifyAction()
      if (!result) return

      const started = await startOAuthLogin(
        request,
        captcha.tencentCaptchaEnabled
          ? {
              tencent_captcha_ticket: result.token,
              tencent_captcha_randstr: result.randstr
            }
          : { turnstile_token: result.token }
      )
      window.location.href = started.authorize_url
    } catch (error: unknown) {
      useAppStore.getState().showError(extractI18nErrorMessage(error, t, 'auth.errors', t('auth.turnstileFailed')))
    } finally {
      resetCaptchaProof()
      setIsLoading(false)
    }
  }

  // ==================== 2FA Handlers ====================

  async function handle2FAVerify(code: string): Promise<void> {
    totpModalRef.current?.setVerifying(true)

    try {
      await useAuthStore.getState().login2FA(totpTempToken, code)

      setShow2FAModal(false)
      clearAllAffiliateReferralCodes()
      useAppStore.getState().showSuccess(t('auth.loginSuccess'))
      await navigate(redirectTarget())
    } catch (error: unknown) {
      const err = error as { message?: string; response?: { data?: { message?: string } } }
      const message = err.response?.data?.message || err.message || t('profile.totp.loginFailed')

      totpModalRef.current?.setError(message)
      totpModalRef.current?.setVerifying(false)
    }
  }

  function handle2FACancel(): void {
    setShow2FAModal(false)
    setTotpTempToken('')
    setTotpUserEmailMasked('')
  }

  const passwordMessages = { showPassword: t('authUi.showPassword'), hidePassword: t('authUi.hidePassword') }

  return (
    <div className={styles.page}>
      <AuthHeading title={t('auth.welcomeBack')}>{t('auth.signInToAccount')}</AuthHeading>

      <form className={styles.form} onSubmit={(event) => void handleLogin(event)} noValidate>
        <Input
          id="email"
          label={t('auth.emailLabel')}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoFocus
          autoComplete="email"
          disabled={authActionDisabled}
          aria-invalid={errors.email ? true : undefined}
          placeholder={t('auth.emailPlaceholder')}
        />

        <div className={styles.field}>
          <PasswordField
            id="password"
            label={t('auth.passwordLabel')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
            disabled={authActionDisabled}
            aria-invalid={errors.password ? true : undefined}
            placeholder={t('auth.passwordPlaceholder')}
            messages={passwordMessages}
          />
          {settings.passwordResetEnabled && !settings.backendModeEnabled && (
            <div className={styles.fieldFooter}>
              <Link to="/forgot-password" className={styles.link}>
                {t('auth.forgotPassword')}
              </Link>
            </div>
          )}
        </div>

        {captchaEnabled && (
          <CaptchaChallenge
            ref={turnstileRef}
            {...captchaChallengeProps(captcha)}
            onVerify={onTurnstileVerify}
            onExpire={onTurnstileExpire}
            onError={onTurnstileError}
          />
        )}

        <Button
          type="submit"
          className={styles.fullWidth}
          loading={isLoading}
          disabled={!isLoading && (authActionDisabled || (captcha.turnstileEnabled && !turnstileToken))}
        >
          {isLoading ? t('auth.signingIn') : t('auth.signIn')}
        </Button>

        {agreement.enabled && (
          <LoginAgreementPrompt
            accepted={agreement.accepted}
            documents={agreement.documents}
            mode={agreement.mode}
            updatedAt={agreement.updatedAt}
            visible={agreement.showModal}
            onAccept={acceptLoginAgreement}
            onReject={rejectLoginAgreement}
            onOpen={() => setShowAgreementModal(true)}
            onDismiss={() => setShowAgreementModal(false)}
          />
        )}

        {(showPasskeyLogin || showOAuthLogin) && (
          <div className={styles.alternatives}>
            <OAuthDivider />

            {showPasskeyLogin && (
              <Button
                type="button"
                variant="secondary"
                className={styles.fullWidth}
                disabled={authActionDisabled}
                onClick={() => void handlePasskeyLogin()}
              >
                <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
                {passkeyLoading ? t('auth.passkeySigningIn') : t('auth.passkeySignIn')}
              </Button>
            )}

            <EmailOAuthButtons
              disabled={authActionDisabled}
              githubEnabled={settings.githubOAuthEnabled}
              googleEnabled={settings.googleOAuthEnabled}
              showDivider={false}
              onStart={(request) => void handleOAuthStart(request)}
            />

            {settings.linuxdoOAuthEnabled && (
              <LinuxDoOAuthSection disabled={authActionDisabled} showDivider={false} onStart={(request) => void handleOAuthStart(request)} />
            )}
            {settings.dingtalkOAuthEnabled && (
              <DingTalkOAuthSection disabled={authActionDisabled} showDivider={false} onStart={(request) => void handleOAuthStart(request)} />
            )}
            {settings.wechatOAuthEnabled && (
              <WechatOAuthSection disabled={authActionDisabled} showDivider={false} onStart={(request) => void handleOAuthStart(request)} />
            )}
            {settings.oidcOAuthEnabled && (
              <OidcOAuthSection
                disabled={authActionDisabled}
                providerName={settings.oidcOAuthProviderName}
                showDivider={false}
                onStart={(request) => void handleOAuthStart(request)}
              />
            )}
          </div>
        )}
      </form>

      {!settings.backendModeEnabled && publicSettingsLoaded && settings.registrationEnabled && (
        <AuthFooter>
          <p className={styles.footerText}>
            {t('auth.dontHaveAccount')}{' '}
            <Link to="/register" className={styles.link}>
              {t('auth.signUp')}
            </Link>
          </p>
        </AuthFooter>
      )}

      {show2FAModal && (
        <TotpLoginModal
          ref={totpModalRef}
          tempToken={totpTempToken}
          userEmailMasked={totpUserEmailMasked}
          onVerify={(code) => void handle2FAVerify(code)}
          onCancel={handle2FACancel}
        />
      )}
    </div>
  )
}
