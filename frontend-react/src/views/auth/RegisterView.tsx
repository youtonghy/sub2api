import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CircleCheck, Gift, Loader2 } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { PasswordField } from '@/components/arc/password-field/password-field'
import AuthHeading from '@/components/auth/AuthHeading'
import EmailOAuthButtons from '@/components/auth/EmailOAuthButtons'
import LinuxDoOAuthSection from '@/components/auth/LinuxDoOAuthSection'
import LoginAgreementPrompt from '@/components/auth/LoginAgreementPrompt'
import OAuthDivider from '@/components/auth/OAuthDivider'
import OidcOAuthSection from '@/components/auth/OidcOAuthSection'
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
  isWeChatWebOAuthEnabled,
  startOAuthLogin,
  type OAuthLoginStart,
  validatePromoCode,
  validateInvitationCode
} from '@/api/auth'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { AuthFooter } from '@/layouts/AuthLayout'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { buildAuthErrorMessage } from '@/utils/authError'
import { extractApiErrorCode, extractI18nErrorMessage } from '@/utils/apiError'
import {
  formatRegistrationEmailSuffixWhitelistForMessage,
  isRegistrationEmailSuffixAllowed,
  normalizeRegistrationEmailSuffixWhitelist
} from '@/utils/registrationEmailPolicy'
import {
  clearAffiliateReferralCode,
  loadAffiliateReferralCode,
  resolveAffiliateReferralCode
} from '@/utils/oauthAffiliate'
import styles from './authView.module.css'

interface RegisterSettings {
  registrationEnabled: boolean
  emailVerifyEnabled: boolean
  invitationCodeEnabled: boolean
  affiliateEnabled: boolean
  siteName: string
  linuxdoOAuthEnabled: boolean
  wechatOAuthEnabled: boolean
  oidcOAuthEnabled: boolean
  oidcOAuthProviderName: string
  githubOAuthEnabled: boolean
  googleOAuthEnabled: boolean
  registrationEmailSuffixWhitelist: string[]
  // 域名限量注册开关：开启时非白名单域名可注册 1 个账户（由后端判定），前端不做白名单预检。
  emailDomainQuotaEnabled: boolean
}

const DEFAULT_SETTINGS: RegisterSettings = {
  registrationEnabled: true,
  emailVerifyEnabled: false,
  invitationCodeEnabled: false,
  affiliateEnabled: false,
  siteName: 'RetooAi',
  linuxdoOAuthEnabled: false,
  wechatOAuthEnabled: false,
  oidcOAuthEnabled: false,
  oidcOAuthProviderName: 'OIDC',
  githubOAuthEnabled: false,
  googleOAuthEnabled: false,
  registrationEmailSuffixWhitelist: [],
  emailDomainQuotaEnabled: false
}

interface PromoValidation {
  valid: boolean
  invalid: boolean
  bonusAmount: number | null
  message: string
}

interface InvitationValidation {
  valid: boolean
  invalid: boolean
  message: string
}

const EMPTY_PROMO: PromoValidation = { valid: false, invalid: false, bonusAmount: null, message: '' }
const EMPTY_INVITATION: InvitationValidation = { valid: false, invalid: false, message: '' }

export default function RegisterView() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [isLoading, setIsLoading] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settings, setSettings] = useState<RegisterSettings>(DEFAULT_SETTINGS)
  // Public settings are injected into the app store before the app mounts. Use that
  // value for the first render so a disabled promo-code field never flashes
  // while the async settings request is still in flight. If injection is
  // unavailable, fail closed until the request explicitly enables the field.
  const [promoCodeEnabled, setPromoCodeEnabled] = useState(
    () => useAppStore.getState().cachedPublicSettings?.promo_code_enabled === true
  )
  const [captcha, setCaptcha] = useState<CaptchaSettings>(EMPTY_CAPTCHA_SETTINGS)
  const { agreement, gateActive: agreementGateActive, apply: applyLoginAgreementSettings, disable: disableAgreement, accept: acceptLoginAgreement, reject: rejectLoginAgreement, setShowModal: setShowAgreementModal } =
    useLoginAgreement('legal.loginAgreementPrompt.registerRejectedWarning')

  const turnstileRef = useRef<CaptchaChallengeHandle>(null)
  const { token: turnstileToken, proof, setProof } = useCaptchaProof()
  const { actionCaptchaEnabled, captchaEnabled } = captchaFlags(captcha)

  // Promo code validation
  const [promoValidating, setPromoValidating] = useState(false)
  const [promoValidation, setPromoValidation] = useState<PromoValidation>(EMPTY_PROMO)
  const promoValidateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Invitation code validation
  const [invitationValidating, setInvitationValidating] = useState(false)
  const [invitationValidation, setInvitationValidation] = useState<InvitationValidation>(EMPTY_INVITATION)
  const invitationValidateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [affCode, setAffCode] = useState(() =>
    resolveAffiliateReferralCode(searchParams.get('aff'), searchParams.get('aff_code'))
  )
  const [errors, setErrors] = useState({ email: '', password: '', confirmPassword: '', turnstile: '', invitation_code: '' })

  // 查询参数里的推广码变化时同步到输入框（Vue 版 watch route.query.aff / aff_code）
  const affQueryKey = `${searchParams.get('aff') ?? ''}\n${searchParams.get('aff_code') ?? ''}`
  const [syncedAffQueryKey, setSyncedAffQueryKey] = useState(affQueryKey)
  if (syncedAffQueryKey !== affQueryKey) {
    setSyncedAffQueryKey(affQueryKey)
    const code = resolveAffiliateReferralCode(searchParams.get('aff'), searchParams.get('aff_code'))
    if (code) setAffCode(code)
  }

  const validationToastMessage =
    errors.email ||
    errors.password ||
    errors.confirmPassword ||
    (invitationValidation.invalid ? invitationValidation.message : '') ||
    errors.invitation_code ||
    (promoValidation.invalid ? promoValidation.message : '') ||
    errors.turnstile ||
    ''

  const showOAuthLogin =
    settings.linuxdoOAuthEnabled ||
    settings.wechatOAuthEnabled ||
    settings.oidcOAuthEnabled ||
    settings.githubOAuthEnabled ||
    settings.googleOAuthEnabled

  const registrationActionDisabled = isLoading || !settingsLoaded || agreementGateActive

  useEffect(() => {
    if (validationToastMessage) {
      useAppStore.getState().showError(validationToastMessage)
    }
  }, [validationToastMessage])

  useEffect(() => () => {
    if (promoValidateTimeout.current) {
      clearTimeout(promoValidateTimeout.current)
    }
    if (invitationValidateTimeout.current) {
      clearTimeout(invitationValidateTimeout.current)
    }
  }, [])

  // ==================== Lifecycle ====================

  useMountOnce(async () => {
    try {
      const publicSettings = await getPublicSettings()
      const nextPromoCodeEnabled = publicSettings.promo_code_enabled
      setSettings({
        registrationEnabled: publicSettings.registration_enabled,
        emailVerifyEnabled: publicSettings.email_verify_enabled,
        invitationCodeEnabled: publicSettings.invitation_code_enabled,
        affiliateEnabled: publicSettings.affiliate_enabled === true,
        siteName: publicSettings.site_name || 'RetooAi',
        linuxdoOAuthEnabled: publicSettings.linuxdo_oauth_enabled,
        wechatOAuthEnabled: isWeChatWebOAuthEnabled(publicSettings),
        oidcOAuthEnabled: publicSettings.oidc_oauth_enabled,
        oidcOAuthProviderName: publicSettings.oidc_oauth_provider_name || 'OIDC',
        githubOAuthEnabled: publicSettings.github_oauth_enabled,
        googleOAuthEnabled: publicSettings.google_oauth_enabled,
        registrationEmailSuffixWhitelist: normalizeRegistrationEmailSuffixWhitelist(
          publicSettings.registration_email_suffix_whitelist || []
        ),
        emailDomainQuotaEnabled: publicSettings.registration_email_domain_quota_enabled === true
      })
      setPromoCodeEnabled(nextPromoCodeEnabled)
      setCaptcha(readCaptchaSettings(publicSettings))
      applyLoginAgreementSettings(publicSettings)

      // Read promo code from URL parameter only if promo code is enabled
      if (nextPromoCodeEnabled) {
        const promoParam = searchParams.get('promo')
        if (promoParam) {
          setPromoCode(promoParam)
          // Validate the promo code from URL
          await validatePromoCodeDebounced(promoParam)
        }
      }
      const code = resolveAffiliateReferralCode(searchParams.get('aff'), searchParams.get('aff_code'))
      if (code) setAffCode(code)
    } catch (error) {
      console.error('Failed to load public settings:', error)
      disableAgreement()
    } finally {
      setSettingsLoaded(true)
    }
  })

  // ==================== Promo Code Validation ====================

  function handlePromoCodeInput(value: string): void {
    setPromoCode(value)
    const code = value.trim()

    // Clear previous validation
    setPromoValidation(EMPTY_PROMO)

    if (!code) {
      setPromoValidating(false)
      return
    }

    // Debounce validation
    if (promoValidateTimeout.current) {
      clearTimeout(promoValidateTimeout.current)
    }

    promoValidateTimeout.current = setTimeout(() => {
      void validatePromoCodeDebounced(code)
    }, 500)
  }

  async function validatePromoCodeDebounced(code: string): Promise<void> {
    if (!code.trim()) return

    setPromoValidating(true)

    try {
      const result = await validatePromoCode(code)

      if (result.valid) {
        setPromoValidation({ valid: true, invalid: false, bonusAmount: result.bonus_amount || 0, message: '' })
      } else {
        // 根据错误码显示对应的翻译
        setPromoValidation({ valid: false, invalid: true, bonusAmount: null, message: getPromoErrorMessage(result.error_code) })
      }
    } catch (error) {
      console.error('Failed to validate promo code:', error)
      setPromoValidation((current) => ({ ...current, valid: false, invalid: true, message: t('auth.promoCodeInvalid') }))
    } finally {
      setPromoValidating(false)
    }
  }

  function getPromoErrorMessage(errorCode?: string): string {
    switch (errorCode) {
      case 'PROMO_CODE_NOT_FOUND':
        return t('auth.promoCodeNotFound')
      case 'PROMO_CODE_EXPIRED':
        return t('auth.promoCodeExpired')
      case 'PROMO_CODE_DISABLED':
        return t('auth.promoCodeDisabled')
      case 'PROMO_CODE_MAX_USED':
        return t('auth.promoCodeMaxUsed')
      case 'PROMO_CODE_ALREADY_USED':
        return t('auth.promoCodeAlreadyUsed')
      default:
        return t('auth.promoCodeInvalid')
    }
  }

  // ==================== Invitation Code Validation ====================

  function handleInvitationCodeInput(value: string): void {
    setInvitationCode(value)
    const code = value.trim()

    // Clear previous validation
    setInvitationValidation(EMPTY_INVITATION)
    setErrors((current) => ({ ...current, invitation_code: '' }))

    if (!code) {
      return
    }

    // Debounce validation
    if (invitationValidateTimeout.current) {
      clearTimeout(invitationValidateTimeout.current)
    }

    invitationValidateTimeout.current = setTimeout(() => {
      void validateInvitationCodeDebounced(code)
    }, 500)
  }

  /** 返回邀请码是否有效，供提交流程在 await 后直接判断 */
  async function validateInvitationCodeDebounced(code: string): Promise<boolean> {
    setInvitationValidating(true)

    try {
      const result = await validateInvitationCode(code)

      if (result.valid) {
        setInvitationValidation({ valid: true, invalid: false, message: '' })
        return true
      }
      // 各错误码目前都显示同一条提示
      setInvitationValidation({ valid: false, invalid: true, message: t('auth.invitationCodeInvalid') })
      return false
    } catch {
      setInvitationValidation({ valid: false, invalid: true, message: t('auth.invitationCodeInvalid') })
      return false
    } finally {
      setInvitationValidating(false)
    }
  }

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

  async function handleOAuthStart(request: OAuthLoginStart): Promise<void> {
    if (registrationActionDisabled) return

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

  // ==================== Validation ====================

  function buildEmailSuffixNotAllowedMessage(): string {
    const normalizedWhitelist = normalizeRegistrationEmailSuffixWhitelist(settings.registrationEmailSuffixWhitelist)
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

  function validateForm(): boolean {
    const nextErrors = { email: '', password: '', confirmPassword: '', turnstile: '', invitation_code: '' }

    if (agreementGateActive) {
      setErrors(nextErrors)
      useAppStore.getState().showWarning(t('legal.loginAgreementPrompt.registerRequiredWarning'))
      if (agreement.mode !== 'checkbox') {
        setShowAgreementModal(true)
      }
      return false
    }

    // Email validation
    if (!email.trim()) {
      nextErrors.email = t('auth.emailRequired')
    } else if (!EMAIL_PATTERN.test(email)) {
      nextErrors.email = t('auth.invalidEmail')
    } else if (
      !settings.emailDomainQuotaEnabled &&
      !isRegistrationEmailSuffixAllowed(email, settings.registrationEmailSuffixWhitelist)
    ) {
      // 域名限量注册关闭时保持严格白名单预检；开启时交给后端按域名额度判定
      nextErrors.email = buildEmailSuffixNotAllowedMessage()
    }

    // Password validation
    if (!password) {
      nextErrors.password = t('auth.passwordRequired')
    } else if (password.length < 6) {
      nextErrors.password = t('auth.passwordMinLength')
    }

    // Confirm password validation
    if (!confirmPassword) {
      nextErrors.confirmPassword = t('auth.confirmPasswordRequired')
    } else if (password !== confirmPassword) {
      nextErrors.confirmPassword = t('auth.passwordsDoNotMatch')
    }

    // Invitation code validation (required when enabled)
    if (settings.invitationCodeEnabled && !invitationCode.trim()) {
      nextErrors.invitation_code = t('auth.invitationCodeRequired')
    }

    // Turnstile validation
    if (captcha.turnstileEnabled && !proof.current.token) {
      nextErrors.turnstile = t('auth.completeVerification')
    }

    setErrors(nextErrors)
    return Object.values(nextErrors).every((value) => !value)
  }

  // ==================== Form Handlers ====================

  async function handleRegister(event: FormEvent): Promise<void> {
    event.preventDefault()

    if (!validateForm()) {
      return
    }

    // Check promo code validation status：校验中或无效时阻止提交（Vue 版同样不额外提示）
    if (promoCode.trim()) {
      if (promoValidating || promoValidation.invalid) {
        return
      }
    }

    // Check invitation code validation status (if enabled and code provided)
    if (settings.invitationCodeEnabled) {
      if (invitationValidating || invitationValidation.invalid) {
        return
      }
      // If invitation code is required but not validated yet
      if (invitationCode.trim() && !invitationValidation.valid) {
        if (!(await validateInvitationCodeDebounced(invitationCode.trim()))) {
          return
        }
      }
    }

    if (!(await acquireActionProof())) {
      return
    }

    setIsLoading(true)

    try {
      const resolvedAffCode = affCode.trim() || loadAffiliateReferralCode()
      if (resolvedAffCode) {
        setAffCode(resolvedAffCode)
      }
      const { token, randstr } = proof.current
      const registration = {
        email,
        password,
        turnstile_token: captcha.turnstileEnabled || captcha.aliyunCaptchaEnabled ? token : undefined,
        tencent_captcha_ticket: captcha.tencentCaptchaEnabled ? token : undefined,
        tencent_captcha_randstr: captcha.tencentCaptchaEnabled ? randstr : undefined,
        promo_code: promoCode || undefined,
        invitation_code: invitationCode || undefined,
        ...(resolvedAffCode ? { aff_code: resolvedAffCode } : {})
      }

      // If email verification is enabled, redirect to verification page
      if (settings.emailVerifyEnabled) {
        // Store registration data in sessionStorage
        sessionStorage.setItem('register_data', JSON.stringify(registration))

        // Navigate to email verification page
        await navigate('/email-verify')
        return
      }

      // Otherwise, directly register
      await useAuthStore.getState().register(registration)
      clearAffiliateReferralCode()

      useAppStore.getState().showSuccess(t('auth.accountCreatedSuccess', { siteName: settings.siteName }))

      await navigate('/dashboard')
    } catch (error: unknown) {
      useAppStore.getState().showError(buildRegistrationErrorMessage(error, t('auth.registrationFailed')))
    } finally {
      if (captchaEnabled) {
        resetCaptchaProof()
      }
      setIsLoading(false)
    }
  }

  function buildRegistrationErrorMessage(error: unknown, fallback: string): string {
    if (extractApiErrorCode(error) === 'EMAIL_DOMAIN_REGISTRATION_LIMIT') {
      return t('auth.emailDomainRegistrationLimit')
    }
    return buildAuthErrorMessage(error, { fallback })
  }

  const passwordMessages = { showPassword: t('authUi.showPassword'), hidePassword: t('authUi.hidePassword') }
  const optionalSuffix = ` (${t('common.optional')})`

  return (
    <div className={styles.page}>
      <AuthHeading title={t('auth.createAccount')}>{t('auth.signUpToStart', { siteName: settings.siteName })}</AuthHeading>

      {!settings.registrationEnabled && settingsLoaded ? (
        <Alert tone="warning" title={t('auth.registrationDisabled')} />
      ) : (
        <form className={styles.form} onSubmit={(event) => void handleRegister(event)} noValidate>
          <Input
            id="email"
            label={t('auth.emailLabel')}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
            autoComplete="email"
            disabled={registrationActionDisabled}
            aria-invalid={errors.email ? true : undefined}
            placeholder={t('auth.emailPlaceholder')}
          />

          <PasswordField
            id="password"
            label={t('auth.passwordLabel')}
            description={t('auth.passwordHint')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="new-password"
            disabled={registrationActionDisabled}
            aria-invalid={errors.password ? true : undefined}
            placeholder={t('auth.createPasswordPlaceholder')}
            messages={passwordMessages}
          />

          <PasswordField
            id="confirmPassword"
            label={t('auth.confirmPassword')}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            autoComplete="new-password"
            disabled={registrationActionDisabled}
            aria-invalid={errors.confirmPassword ? true : undefined}
            placeholder={t('auth.confirmPasswordPlaceholder')}
            messages={passwordMessages}
          />

          {settings.invitationCodeEnabled ? (
            <div className={styles.field}>
              <Input
                id="invitation_code"
                label={t('auth.invitationCodeLabel')}
                type="text"
                value={invitationCode}
                onChange={(event) => handleInvitationCodeInput(event.target.value)}
                disabled={registrationActionDisabled}
                aria-invalid={invitationValidation.invalid || errors.invitation_code ? true : undefined}
                placeholder={t('auth.invitationCodePlaceholder')}
              />
              {invitationValidating ? (
                <p className={`${styles.statusLine} ${styles.statusPending}`} role="status">
                  <Loader2 className={styles.spinner} size={14} strokeWidth={1.75} aria-hidden="true" />
                  {t('auth.invitationCodeValidating')}
                </p>
              ) : invitationValidation.valid ? (
                <p className={`${styles.statusLine} ${styles.statusValid}`}>
                  <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
                  {t('auth.invitationCodeValid')}
                </p>
              ) : null}
            </div>
          ) : settings.affiliateEnabled ? (
            <div data-testid="affiliate-invitation-field">
              <Input
                id="affiliate_code"
                label={`${t('auth.invitationCodeLabel')}${optionalSuffix}`}
                type="text"
                value={affCode}
                onChange={(event) => setAffCode(event.target.value)}
                disabled={registrationActionDisabled}
                placeholder={t('auth.invitationCodePlaceholder')}
              />
            </div>
          ) : null}

          {promoCodeEnabled && (
            <div className={styles.field}>
              <Input
                id="promo_code"
                label={`${t('auth.promoCodeLabel')}${optionalSuffix}`}
                type="text"
                value={promoCode}
                onChange={(event) => handlePromoCodeInput(event.target.value)}
                disabled={registrationActionDisabled}
                aria-invalid={promoValidation.invalid ? true : undefined}
                placeholder={t('auth.promoCodePlaceholder')}
              />
              {promoValidating ? (
                <p className={`${styles.statusLine} ${styles.statusPending}`} role="status">
                  <Loader2 className={styles.spinner} size={14} strokeWidth={1.75} aria-hidden="true" />
                  {t('auth.promoCodeValidating')}
                </p>
              ) : promoValidation.valid ? (
                <p className={`${styles.statusLine} ${styles.statusValid}`}>
                  <Gift size={14} strokeWidth={1.75} aria-hidden="true" />
                  {t('auth.promoCodeValid', { amount: promoValidation.bonusAmount?.toFixed(2) ?? '' })}
                </p>
              ) : null}
            </div>
          )}

          {captchaEnabled && (
            <div data-testid="registration-turnstile">
              <CaptchaChallenge
                ref={turnstileRef}
                {...captchaChallengeProps(captcha)}
                onVerify={onTurnstileVerify}
                onExpire={onTurnstileExpire}
                onError={onTurnstileError}
              />
            </div>
          )}

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

          <Button
            type="submit"
            className={styles.fullWidth}
            loading={isLoading}
            disabled={!isLoading && (registrationActionDisabled || (captcha.turnstileEnabled && !turnstileToken))}
          >
            {isLoading
              ? t('auth.processing')
              : settings.emailVerifyEnabled
                ? t('auth.continue')
                : t('auth.createAccount')}
          </Button>
        </form>
      )}

      {showOAuthLogin && (
        <div className={styles.alternatives}>
          <OAuthDivider />

          <EmailOAuthButtons
            disabled={registrationActionDisabled}
            affCode={affCode}
            promoCode={promoCode}
            githubEnabled={settings.githubOAuthEnabled}
            googleEnabled={settings.googleOAuthEnabled}
            showDivider={false}
            onStart={(request) => void handleOAuthStart(request)}
          />

          {settings.linuxdoOAuthEnabled && (
            <LinuxDoOAuthSection
              disabled={registrationActionDisabled}
              affCode={affCode}
              promoCode={promoCode}
              showDivider={false}
              onStart={(request) => void handleOAuthStart(request)}
            />
          )}
          {settings.wechatOAuthEnabled && (
            <WechatOAuthSection
              disabled={registrationActionDisabled}
              affCode={affCode}
              showDivider={false}
              onStart={(request) => void handleOAuthStart(request)}
            />
          )}
          {settings.oidcOAuthEnabled && (
            <OidcOAuthSection
              disabled={registrationActionDisabled}
              providerName={settings.oidcOAuthProviderName}
              affCode={affCode}
              showDivider={false}
              onStart={(request) => void handleOAuthStart(request)}
            />
          )}
        </div>
      )}

      <AuthFooter>
        <p className={styles.footerText}>
          {t('auth.alreadyHaveAccount')}{' '}
          <Link to="/login" className={styles.link}>
            {t('auth.signIn')}
          </Link>
        </p>
      </AuthFooter>
    </div>
  )
}
