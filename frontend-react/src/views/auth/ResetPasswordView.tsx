import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { PasswordField } from '@/components/arc/password-field/password-field'
import AuthHeading from '@/components/auth/AuthHeading'
import { resetPassword } from '@/api/auth'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { AuthFooter } from '@/layouts/AuthLayout'
import { useAppStore } from '@/stores/app'
import styles from './authView.module.css'

export default function ResetPasswordView() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()

  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  // URL parameters
  const email = searchParams.get('email') || ''
  const token = searchParams.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState({ password: '', confirmPassword: '' })
  const validationToastMessage = errors.password || errors.confirmPassword || ''

  useEffect(() => {
    if (validationToastMessage) {
      useAppStore.getState().showError(validationToastMessage)
    }
  }, [validationToastMessage])

  // Check if the reset link is valid (has email and token)
  const isInvalidLink = !email || !token

  useMountOnce(() => {
    if (!email || !token) {
      useAppStore.getState().showError(t('auth.invalidResetLink'))
    }
  })

  // ==================== Validation ====================

  function validateForm(): boolean {
    const nextErrors = { password: '', confirmPassword: '' }

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

    setErrors(nextErrors)
    return !nextErrors.password && !nextErrors.confirmPassword
  }

  // ==================== Form Handlers ====================

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()

    if (!validateForm()) {
      return
    }

    setIsLoading(true)

    try {
      await resetPassword({
        email,
        token,
        new_password: password
      })

      setIsSuccess(true)
      useAppStore.getState().showSuccess(t('auth.passwordResetSuccess'))
    } catch (error: unknown) {
      const err = error as { message?: string; response?: { data?: { detail?: string; code?: string } } }

      // Check for invalid/expired token error
      let message: string
      if (err.response?.data?.code === 'INVALID_RESET_TOKEN') {
        message = t('auth.invalidOrExpiredToken')
      } else if (err.response?.data?.detail) {
        message = err.response.data.detail
      } else if (err.message) {
        message = err.message
      } else {
        message = t('auth.resetPasswordFailed')
      }
      useAppStore.getState().showError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const passwordMessages = { showPassword: t('authUi.showPassword'), hidePassword: t('authUi.hidePassword') }

  return (
    <div className={styles.page}>
      <AuthHeading title={t('auth.resetPasswordTitle')}>{t('auth.resetPasswordHint')}</AuthHeading>

      {isInvalidLink ? (
        <>
          <Alert tone="warning" title={t('auth.invalidResetLink')}>
            {t('auth.invalidResetLinkHint')}
          </Alert>
          <div className={styles.center}>
            <Link to="/forgot-password" className={styles.link}>
              {t('auth.requestNewResetLink')}
            </Link>
          </div>
        </>
      ) : isSuccess ? (
        <>
          <Alert tone="success" title={t('auth.passwordResetSuccess')}>
            {t('auth.passwordResetSuccessHint')}
          </Alert>
          <div className={styles.center}>
            <Link to="/login" className={styles.link}>
              {t('auth.signIn')}
            </Link>
          </div>
        </>
      ) : (
        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Input id="email" label={t('auth.emailLabel')} type="email" value={email} readOnly disabled />

          <PasswordField
            id="password"
            label={t('auth.newPassword')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="new-password"
            disabled={isLoading}
            aria-invalid={errors.password ? true : undefined}
            placeholder={t('auth.newPasswordPlaceholder')}
            messages={passwordMessages}
          />

          <PasswordField
            id="confirmPassword"
            label={t('auth.confirmPassword')}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            autoComplete="new-password"
            disabled={isLoading}
            aria-invalid={errors.confirmPassword ? true : undefined}
            placeholder={t('auth.confirmPasswordPlaceholder')}
            messages={passwordMessages}
          />

          <Button type="submit" className={styles.fullWidth} loading={isLoading}>
            {isLoading ? t('auth.resettingPassword') : t('auth.resetPassword')}
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
