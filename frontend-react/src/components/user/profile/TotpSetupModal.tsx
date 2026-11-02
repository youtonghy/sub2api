import { Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import QRCode from 'qrcode'

import { totpAPI } from '@/api'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { TotpSetupResponse } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import { useTotpVerification } from './useTotpVerification'
import styles from './TotpSetupModal.module.css'
import shared from './Profile.module.css'

export interface TotpSetupModalProps {
  onClose?: () => void
  onSuccess?: () => void
}

const emptyCode = ['', '', '', '', '', '']

/** 启用两步验证：身份验证 → 扫码 → 输入 6 位动态码，对应 Vue 版 TotpSetupModal.vue；挂载即显示 */
export default function TotpSetupModal({ onClose, onSuccess }: TotpSetupModalProps) {
  const { t } = useI18n()
  const { methodLoading, verificationMethod, sendingCode, codeCooldown, handleSendCode } = useTotpVerification(onClose)

  // Step: 0 = verify identity, 1 = QR code, 2 = verify TOTP code
  const [step, setStep] = useState(0)
  const [verifyForm, setVerifyForm] = useState({ emailCode: '', password: '' })
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupData, setSetupData] = useState<TotpSetupResponse | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [code, setCode] = useState<string[]>(emptyCode)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const pendingFocus = useRef<number | null>(null)

  // 对应 Vue 版 nextTick(() => focus())：渲染完成后聚焦指定格子
  useEffect(() => {
    if (pendingFocus.current === null) return
    inputRefs.current[pendingFocus.current]?.focus()
    pendingFocus.current = null
  })

  let stepDescription = ''
  if (step === 0) {
    stepDescription =
      verificationMethod === 'email' ? t('profile.totp.verifyEmailFirst') : t('profile.totp.verifyPasswordFirst')
  } else if (step === 1) {
    stepDescription = t('profile.totp.setupStep1')
  } else if (step === 2) {
    stepDescription = t('profile.totp.setupStep2')
  }

  const canProceedFromVerify =
    verificationMethod === 'email' ? verifyForm.emailCode.length === 6 : verifyForm.password.length > 0

  // Generate QR code as base64 when setupData changes
  const qrCodeUrl = setupData?.qr_code_url
  useEffect(() => {
    if (!qrCodeUrl) return
    let active = true
    QRCode.toDataURL(qrCodeUrl, { width: 200, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => {
        if (active) setQrCodeDataUrl(url)
      })
      .catch((err: unknown) => {
        console.error('Failed to generate QR code:', err)
      })
    return () => {
      active = false
    }
  }, [qrCodeUrl])

  const focusCell = (index: number) => {
    pendingFocus.current = index
  }

  const handleCodeInput = (value: string, index: number) => {
    const digits = value.replace(/[^0-9]/g, '')
    setCode((prev) => prev.map((item, i) => (i === index ? digits : item)))
    if (digits && index < 5) focusCell(index + 1)
  }

  const handleKeydown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Backspace') {
      // If current cell is empty and not the first, move to previous cell
      if (!event.currentTarget.value && index > 0) {
        event.preventDefault()
        inputRefs.current[index - 1]?.focus()
      }
      // Otherwise, let the browser handle the backspace naturally
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    const pastedData = event.clipboardData?.getData('text') || ''
    const digits = pastedData.replace(/[^0-9]/g, '').slice(0, 6).split('')
    // Clear remaining inputs if pasted less than 6 digits
    setCode(emptyCode.map((_, i) => digits[i] ?? ''))
    focusCell(Math.min(digits.length, 5))
  }

  const copySecret = async () => {
    if (!setupData) return
    try {
      await navigator.clipboard.writeText(setupData.secret)
      useAppStore.getState().showSuccess(t('common.copied'))
    } catch {
      useAppStore.getState().showError(t('common.copyFailed'))
    }
  }

  const handleVerifyAndSetup = async () => {
    setSetupLoading(true)
    try {
      const request =
        verificationMethod === 'email' ? { email_code: verifyForm.emailCode } : { password: verifyForm.password }
      setSetupData(await totpAPI.initiateSetup(request))
      setStep(1)
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('profile.totp.setupFailed')))
    } finally {
      setSetupLoading(false)
    }
  }

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault()
    const totpCode = code.join('')
    if (totpCode.length !== 6 || !setupData) return

    setVerifying(true)
    try {
      await totpAPI.enable({ totp_code: totpCode, setup_token: setupData.setup_token })
      useAppStore.getState().showSuccess(t('profile.totp.enableSuccess'))
      onSuccess?.()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('profile.totp.verifyFailed')))
      setCode(emptyCode)
      focusCell(0)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <BaseDialog
      show
      title={t('profile.totp.setupTitle')}
      description={stepDescription}
      width="narrow"
      closeOnClickOutside
      onClose={onClose}
    >
      {/* Step 0: Identity Verification */}
      {step === 0 &&
        (methodLoading ? (
          <div className={shared.loadingRow}>
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <div className={shared.form}>
            {verificationMethod === 'email' ? (
              <div className={shared.stack}>
                <span className={shared.label}>{t('profile.totp.emailCode')}</span>
                <div className={shared.codeRow}>
                  <Input
                    type="text"
                    maxLength={6}
                    inputMode="numeric"
                    aria-label={t('profile.totp.emailCode')}
                    placeholder={t('profile.totp.enterEmailCode')}
                    value={verifyForm.emailCode}
                    onChange={(value) => setVerifyForm((prev) => ({ ...prev, emailCode: value }))}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={sendingCode || codeCooldown > 0}
                    onClick={() => void handleSendCode()}
                  >
                    {codeCooldown > 0 ? `${codeCooldown}s` : sendingCode ? t('common.sending') : t('profile.totp.sendCode')}
                  </Button>
                </div>
              </div>
            ) : (
              <Input
                type="password"
                autoComplete="current-password"
                label={t('profile.currentPassword')}
                placeholder={t('profile.totp.enterPassword')}
                value={verifyForm.password}
                onChange={(value) => setVerifyForm((prev) => ({ ...prev, password: value }))}
              />
            )}

            <div className={shared.actions}>
              <Button type="button" variant="secondary" onClick={() => onClose?.()}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                data-testid="totp-setup-next"
                disabled={!canProceedFromVerify || setupLoading}
                onClick={() => void handleVerifyAndSetup()}
              >
                {setupLoading ? t('common.loading') : t('common.next')}
              </Button>
            </div>
          </div>
        ))}

      {/* Step 1: Show QR Code */}
      {step === 1 && (
        <div className={shared.form}>
          {setupData && (
            <>
              <div className={styles.qrWrap}>
                <div className={styles.qrFrame}>
                  <img src={qrCodeDataUrl || undefined} alt="QR Code" className={styles.qr} />
                </div>
              </div>
              <div className={styles.secretBlock}>
                <p className={shared.muted}>{t('profile.totp.manualEntry')}</p>
                <div className={styles.secretRow}>
                  <code className={styles.secret}>{setupData.secret}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('common.copy')}
                    onClick={() => void copySecret()}
                  >
                    <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </>
          )}

          <div className={shared.actions}>
            <Button type="button" variant="secondary" onClick={() => onClose?.()}>
              {t('common.cancel')}
            </Button>
            <Button type="button" data-testid="totp-setup-next" disabled={!setupData} onClick={() => setStep(2)}>
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Verify Code */}
      {step === 2 && (
        <form className={shared.form} onSubmit={(event) => void handleVerify(event)}>
          <div className={styles.codeBlock}>
            <span className={shared.label}>{t('profile.totp.enterCode')}</span>
            <div className={styles.codeCells}>
              {code.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputRefs.current[index] = el
                  }}
                  value={digit}
                  type="text"
                  maxLength={1}
                  inputMode="numeric"
                  pattern="[0-9]"
                  aria-label={`${t('profile.totp.enterCode')} ${index + 1}`}
                  className={styles.codeCell}
                  onChange={(event) => handleCodeInput(event.target.value, index)}
                  onKeyDown={(event) => handleKeydown(event, index)}
                  onPaste={handlePaste}
                />
              ))}
            </div>
          </div>

          <div className={shared.actions}>
            <Button type="button" variant="secondary" onClick={() => setStep(1)}>
              {t('common.back')}
            </Button>
            <Button type="submit" disabled={verifying || code.join('').length !== 6}>
              {verifying ? t('common.verifying') : t('profile.totp.verify')}
            </Button>
          </div>
        </form>
      )}
    </BaseDialog>
  )
}
