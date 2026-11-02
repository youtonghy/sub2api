import { useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { OtpInput } from '@/components/arc/otp-input/otp-input'
import { PasswordField } from '@/components/arc/password-field/password-field'
import CaptchaChallenge, { type CaptchaChallengeHandle } from '@/components/captcha/CaptchaChallenge'
import { getPublicSettings, sendPendingOAuthVerifyCode } from '@/api/auth'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './PendingOAuthCreateAccountForm.module.css'

export type PendingOAuthCreateAccountPayload = {
  email: string
  password: string
  verifyCode: string
  turnstileToken?: string
  tencentCaptchaTicket?: string
  tencentCaptchaRandstr?: string
  invitationCode?: string
}

export interface PendingOAuthCreateAccountFormProps {
  initialEmail: string
  testIdPrefix: string
  isSubmitting: boolean
  errorMessage?: string
  onSubmit: (payload: PendingOAuthCreateAccountPayload) => void
  onSwitchToBind: (email: string) => void
}

interface CaptchaSettings {
  invitationCodeEnabled: boolean
  emailVerifyEnabled: boolean
  turnstileEnabled: boolean
  turnstileSiteKey: string
  tencentCaptchaEnabled: boolean
  tencentCaptchaAppId: string
  tencentCaptchaRegion: string
  aliyunCaptchaEnabled: boolean
  aliyunCaptchaSceneId: string
  aliyunCaptchaPrefix: string
  aliyunCaptchaRegion: string
}

const DEFAULT_SETTINGS: CaptchaSettings = {
  invitationCodeEnabled: false,
  emailVerifyEnabled: true,
  turnstileEnabled: false,
  turnstileSiteKey: '',
  tencentCaptchaEnabled: false,
  tencentCaptchaAppId: '',
  tencentCaptchaRegion: 'cn',
  aliyunCaptchaEnabled: false,
  aliyunCaptchaSceneId: '',
  aliyunCaptchaPrefix: '',
  aliyunCaptchaRegion: 'cn'
}

function getRequestErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string; response?: { data?: { detail?: string; message?: string } } }
  return err.response?.data?.detail || err.response?.data?.message || err.message || fallback
}

export default function PendingOAuthCreateAccountForm({
  initialEmail,
  testIdPrefix,
  isSubmitting,
  errorMessage,
  onSubmit,
  onSwitchToBind
}: PendingOAuthCreateAccountFormProps) {
  const { t } = useI18n()

  const [email, setEmail] = useState(initialEmail || '')
  const [syncedInitialEmail, setSyncedInitialEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [sendCodeSuccess, setSendCodeSuccess] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [settings, setSettings] = useState<CaptchaSettings>(DEFAULT_SETTINGS)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [tencentCaptchaRandstr, setTencentCaptchaRandstr] = useState('')
  const turnstileRef = useRef<CaptchaChallengeHandle>(null)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const disposed = useRef(false)
  const lastSendCodeError = useRef('')

  // 父组件更新 initialEmail 时同步到输入框（Vue 版 watch immediate）
  if (syncedInitialEmail !== initialEmail) {
    setSyncedInitialEmail(initialEmail)
    setEmail(initialEmail || '')
  }

  const {
    invitationCodeEnabled,
    emailVerifyEnabled,
    turnstileEnabled,
    turnstileSiteKey,
    tencentCaptchaEnabled,
    tencentCaptchaAppId,
    tencentCaptchaRegion,
    aliyunCaptchaEnabled,
    aliyunCaptchaSceneId,
    aliyunCaptchaPrefix,
    aliyunCaptchaRegion
  } = settings
  const aliyunCaptchaReady = aliyunCaptchaEnabled && Boolean(aliyunCaptchaSceneId) && Boolean(aliyunCaptchaPrefix)
  // 动作触发式验证码（腾讯/阿里云）：发送验证码、提交时弹窗验证
  const actionCaptchaEnabled = (tencentCaptchaEnabled && Boolean(tencentCaptchaAppId)) || aliyunCaptchaReady
  const captchaEnabled = (turnstileEnabled && Boolean(turnstileSiteKey)) || actionCaptchaEnabled

  /** sendCodeError 变为新的非空值时弹出提示，与 Vue 版 watch 相同 */
  const setSendCodeError = (value: string) => {
    if (value && value !== lastSendCodeError.current) {
      useAppStore.getState().showError(value)
    }
    lastSendCodeError.current = value
  }

  function clearCountdown() {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current)
      countdownTimer.current = null
    }
  }

  function startCountdown(seconds: number) {
    clearCountdown()
    let remaining = Math.max(0, seconds)
    setCountdown(remaining)

    if (remaining <= 0) {
      return
    }

    countdownTimer.current = setInterval(() => {
      if (remaining <= 1) {
        remaining = 0
        setCountdown(0)
        clearCountdown()
        return
      }

      remaining -= 1
      setCountdown(remaining)
    }, 1000)
  }

  function resetTurnstile() {
    setTurnstileToken('')
    setTencentCaptchaRandstr('')
    turnstileRef.current?.reset()
  }

  const latestCaptchaEnabled = useRef(captchaEnabled)
  useEffect(() => {
    latestCaptchaEnabled.current = captchaEnabled
  })

  // 父组件传入的错误：弹提示并让验证码失效
  useEffect(() => {
    if (errorMessage) {
      useAppStore.getState().showError(errorMessage)
      if (latestCaptchaEnabled.current) {
        turnstileRef.current?.reset()
        setTurnstileToken('')
        setTencentCaptchaRandstr('')
      }
    }
  }, [errorMessage])

  function onTurnstileVerify(token: string, randstr = '') {
    setTurnstileToken(token)
    setTencentCaptchaRandstr(randstr)
    setSendCodeError('')
  }

  function onTurnstileExpire() {
    setTurnstileToken('')
    setTencentCaptchaRandstr('')
    setSendCodeError(t('auth.turnstileExpired'))
  }

  function onTurnstileError() {
    setTurnstileToken('')
    setTencentCaptchaRandstr('')
    setSendCodeError(t('auth.turnstileFailed'))
  }

  async function acquireActionProof(): Promise<{ token: string; randstr: string } | null | true> {
    if (!actionCaptchaEnabled) return true

    const proof = await turnstileRef.current?.verifyAction()
    if (!proof) return null

    setTurnstileToken(proof.token)
    setTencentCaptchaRandstr(proof.randstr)
    return proof
  }

  async function handleSendCode() {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      return
    }

    if (turnstileEnabled && !turnstileToken) {
      setSendCodeError(t('auth.completeVerification'))
      return
    }

    const proof = await acquireActionProof()
    if (!proof) {
      return
    }
    const token = proof === true ? turnstileToken : proof.token
    const randstr = proof === true ? tencentCaptchaRandstr : proof.randstr

    setIsSendingCode(true)
    setSendCodeError('')
    setSendCodeSuccess(false)

    try {
      const response = await sendPendingOAuthVerifyCode({
        email: trimmedEmail,
        turnstile_token: turnstileEnabled || aliyunCaptchaEnabled ? token : undefined,
        tencent_captcha_ticket: tencentCaptchaEnabled ? token : undefined,
        tencent_captcha_randstr: tencentCaptchaEnabled ? randstr : undefined
      })
      if (disposed.current) return
      setSendCodeSuccess(true)
      startCountdown(response.countdown)
    } catch (error: unknown) {
      setSendCodeError(getRequestErrorMessage(error, t('auth.sendCodeFailed')))
    } finally {
      if (captchaEnabled) {
        resetTurnstile()
      }
      setIsSendingCode(false)
    }
  }

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail || password.length < 6) {
      return
    }

    // Turnstile 票据一次性：发送验证码已消耗上一枚，reset 后要等新票据回调。
    // 缺票时不能提交——create-account 端点会校验验证码，空 token 直接被判失败。
    // 表单的隐式提交（输入框回车）绕得过按钮的 disabled，所以这里必须再挡一次。
    if (turnstileEnabled && !turnstileToken) {
      setSendCodeError(t('auth.completeVerification'))
      return
    }

    const proof = await acquireActionProof()
    if (!proof) {
      return
    }
    const token = proof === true ? turnstileToken : proof.token
    const randstr = proof === true ? tencentCaptchaRandstr : proof.randstr

    onSubmit({
      email: trimmedEmail,
      password,
      verifyCode: emailVerifyEnabled ? verifyCode.trim() : '',
      ...((turnstileEnabled || aliyunCaptchaEnabled) && token
        ? { turnstileToken: token }
        : {}),
      ...(tencentCaptchaEnabled && token
        ? {
            tencentCaptchaTicket: token,
            tencentCaptchaRandstr: randstr
          }
        : {}),
      invitationCode: invitationCode.trim() || undefined
    })

    if (actionCaptchaEnabled) {
      resetTurnstile()
    }
  }

  function emitSwitchToBind() {
    onSwitchToBind(email.trim())
  }

  useEffect(() => {
    disposed.current = false
    getPublicSettings()
      .then((publicSettings) => {
        if (disposed.current) return
        setSettings({
          invitationCodeEnabled: publicSettings.invitation_code_enabled === true,
          emailVerifyEnabled: publicSettings.email_verify_enabled !== false,
          turnstileEnabled: publicSettings.turnstile_enabled === true,
          turnstileSiteKey: publicSettings.turnstile_site_key || '',
          tencentCaptchaEnabled: publicSettings.tencent_captcha_enabled === true,
          tencentCaptchaAppId: publicSettings.tencent_captcha_app_id || '',
          tencentCaptchaRegion: publicSettings.tencent_captcha_region || 'cn',
          aliyunCaptchaEnabled: publicSettings.aliyun_captcha_enabled === true,
          aliyunCaptchaSceneId: publicSettings.aliyun_captcha_scene_id || '',
          aliyunCaptchaPrefix: publicSettings.aliyun_captcha_prefix || '',
          aliyunCaptchaRegion: publicSettings.aliyun_captcha_region || 'cn'
        })
      })
      .catch(() => {
        if (!disposed.current) setSettings(DEFAULT_SETTINGS)
      })
    return () => {
      disposed.current = true
      if (countdownTimer.current) {
        clearInterval(countdownTimer.current)
        countdownTimer.current = null
      }
    }
  }, [])

  const sendCodeDisabled =
    isSubmitting || isSendingCode || countdown > 0 || !email.trim() || (turnstileEnabled && !turnstileToken)
  const submitDisabled =
    !email.trim() ||
    password.length < 6 ||
    (invitationCodeEnabled && !invitationCode.trim()) ||
    (turnstileEnabled && !turnstileToken)

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <Input
        label={t('auth.emailLabel')}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        data-testid={`${testIdPrefix}-create-account-email`}
        type="email"
        autoComplete="email"
        placeholder={t('auth.emailPlaceholder')}
        disabled={isSubmitting || isSendingCode}
      />
      <PasswordField
        label={t('auth.passwordLabel')}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        data-testid={`${testIdPrefix}-create-account-password`}
        autoComplete="new-password"
        placeholder={t('auth.passwordPlaceholder')}
        disabled={isSubmitting}
        messages={{ showPassword: t('authUi.showPassword'), hidePassword: t('authUi.hidePassword') }}
      />
      {captchaEnabled && (
        <CaptchaChallenge
          ref={turnstileRef}
          turnstileEnabled={turnstileEnabled}
          turnstileSiteKey={turnstileSiteKey}
          tencentEnabled={tencentCaptchaEnabled}
          tencentAppId={tencentCaptchaAppId}
          tencentRegion={tencentCaptchaRegion}
          aliyunEnabled={aliyunCaptchaEnabled}
          aliyunSceneId={aliyunCaptchaSceneId}
          aliyunPrefix={aliyunCaptchaPrefix}
          aliyunRegion={aliyunCaptchaRegion}
          onVerify={onTurnstileVerify}
          onExpire={onTurnstileExpire}
          onError={onTurnstileError}
        />
      )}
      {emailVerifyEnabled && (
        <div className={styles.codeBlock}>
          <div data-testid={`${testIdPrefix}-create-account-verify-code`}>
            <OtpInput
              label={t('auth.verificationCode')}
              value={verifyCode}
              onChange={setVerifyCode}
              disabled={isSubmitting}
              description={sendCodeSuccess ? undefined : t('auth.verificationCodeHint')}
            />
          </div>
          <div className={styles.codeActions}>
            {sendCodeSuccess && <p className={styles.success}>{t('auth.codeSentSuccess')}</p>}
            <Button
              data-testid={`${testIdPrefix}-create-account-send-code`}
              type="button"
              variant="secondary"
              size="sm"
              loading={isSendingCode}
              disabled={sendCodeDisabled && !isSendingCode}
              onClick={() => void handleSendCode()}
            >
              {isSendingCode
                ? t('auth.sendingCode')
                : countdown > 0
                  ? t('auth.resendCountdown', { countdown })
                  : t('auth.sendCode')}
            </Button>
          </div>
        </div>
      )}
      {invitationCodeEnabled && (
        <Input
          label={t('auth.invitationCodeLabel')}
          value={invitationCode}
          onChange={(event) => setInvitationCode(event.target.value)}
          data-testid={`${testIdPrefix}-create-account-invitation-code`}
          type="text"
          placeholder={t('auth.invitationCodePlaceholder')}
          disabled={isSubmitting}
        />
      )}
      <Button
        data-testid={`${testIdPrefix}-create-account-submit`}
        type="submit"
        className={styles.fullWidth}
        loading={isSubmitting}
        disabled={submitDisabled && !isSubmitting}
      >
        {isSubmitting ? t('common.processing') : t('auth.createAccount')}
      </Button>
      <Button type="button" variant="secondary" className={styles.fullWidth} disabled={isSubmitting} onClick={emitSwitchToBind}>
        {t('auth.alreadyHaveAccount')}
      </Button>
    </form>
  )
}
