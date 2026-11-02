import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import AuthHeading from '@/components/auth/AuthHeading'
import {
  EMAIL_PATTERN,
  EMPTY_CAPTCHA_SETTINGS,
  captchaChallengeProps,
  captchaFlags,
  readCaptchaSettings,
  useCaptchaProof,
  type CaptchaSettings
} from '@/components/auth/authForm'
import CaptchaChallenge, { type CaptchaChallengeHandle } from '@/components/captcha/CaptchaChallenge'
import { getPublicSettings, forgotPassword } from '@/api/auth'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { AuthFooter } from '@/layouts/AuthLayout'
import { useAppStore } from '@/stores/app'
import styles from './authView.module.css'

export default function ForgotPasswordView() {
  const { t } = useI18n()

  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [captcha, setCaptcha] = useState<CaptchaSettings>(EMPTY_CAPTCHA_SETTINGS)
  const turnstileRef = useRef<CaptchaChallengeHandle>(null)
  const { token: turnstileToken, proof, setProof } = useCaptchaProof()
  const { actionCaptchaEnabled, captchaEnabled } = captchaFlags(captcha)

  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState({ email: '', turnstile: '' })
  const validationToastMessage = errors.email || errors.turnstile || ''

  useEffect(() => {
    if (validationToastMessage) {
      useAppStore.getState().showError(validationToastMessage)
    }
  }, [validationToastMessage])

  useMountOnce(async () => {
    try {
      setCaptcha(readCaptchaSettings(await getPublicSettings()))
    } catch (error) {
      console.error('Failed to load public settings:', error)
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

  // ==================== Validation ====================

  function validateForm(): boolean {
    const nextErrors = { email: '', turnstile: '' }

    // Email validation
    if (!email.trim()) {
      nextErrors.email = t('auth.emailRequired')
    } else if (!EMAIL_PATTERN.test(email)) {
      nextErrors.email = t('auth.invalidEmail')
    }

    // Turnstile validation
    if (captcha.turnstileEnabled && !proof.current.token) {
      nextErrors.turnstile = t('auth.completeVerification')
    }

    setErrors(nextErrors)
    return !nextErrors.email && !nextErrors.turnstile
  }

  // ==================== Form Handlers ====================

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()

    if (!validateForm()) {
      return
    }

    if (!(await acquireActionProof())) {
      return
    }

    setIsLoading(true)

    try {
      const { token, randstr } = proof.current
      await forgotPassword({
        email,
        turnstile_token: captcha.turnstileEnabled || captcha.aliyunCaptchaEnabled ? token : undefined,
        tencent_captcha_ticket: captcha.tencentCaptchaEnabled ? token : undefined,
        tencent_captcha_randstr: captcha.tencentCaptchaEnabled ? randstr : undefined
      })

      setIsSubmitted(true)
      useAppStore.getState().showSuccess(t('auth.resetEmailSent'))
    } catch (error: unknown) {
      const err = error as { message?: string; response?: { data?: { detail?: string } } }
      useAppStore.getState().showError(err.response?.data?.detail || err.message || t('auth.sendResetLinkFailed'))
    } finally {
      if (captchaEnabled) {
        resetCaptchaProof()
      }
      setIsLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <AuthHeading title={t('auth.forgotPasswordTitle')}>{t('auth.forgotPasswordHint')}</AuthHeading>

      {isSubmitted ? (
        <>
          <Alert tone="success" title={t('auth.resetEmailSent')}>
            {t('auth.resetEmailSentHint')}
          </Alert>
          <div className={styles.center}>
            <Link to="/login" className={`${styles.link} ${styles.statusLine}`}>
              <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
              {t('auth.backToLogin')}
            </Link>
          </div>
        </>
      ) : (
        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Input
            id="email"
            label={t('auth.emailLabel')}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
            autoComplete="email"
            disabled={isLoading}
            aria-invalid={errors.email ? true : undefined}
            placeholder={t('auth.emailPlaceholder')}
          />

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
            disabled={!isLoading && captcha.turnstileEnabled && !turnstileToken}
          >
            {isLoading ? t('auth.sendingResetLink') : t('auth.sendResetLink')}
          </Button>
        </form>
      )}

      <AuthFooter>
        <p className={styles.footerText}>
          {t('auth.rememberedPassword')}{' '}
          <Link to="/login" className={styles.link}>
            {t('auth.signIn')}
          </Link>
        </p>
      </AuthFooter>
    </div>
  )
}
