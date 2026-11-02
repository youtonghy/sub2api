import { useState, type FormEvent } from 'react'

import { totpAPI } from '@/api'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import { useTotpVerification } from './useTotpVerification'
import shared from './Profile.module.css'

export interface TotpDisableDialogProps {
  onClose?: () => void
  onSuccess?: () => void
}

/** 停用两步验证（邮箱验证码或当前密码确认），对应 Vue 版 TotpDisableDialog.vue；挂载即显示 */
export default function TotpDisableDialog({ onClose, onSuccess }: TotpDisableDialogProps) {
  const { t } = useI18n()
  const { methodLoading, verificationMethod, sendingCode, codeCooldown, handleSendCode } = useTotpVerification(onClose)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ emailCode: '', password: '' })

  const canSubmit = verificationMethod === 'email' ? form.emailCode.length === 6 : form.password.length > 0

  const handleDisable = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    try {
      const request = verificationMethod === 'email' ? { email_code: form.emailCode } : { password: form.password }
      await totpAPI.disable(request)
      useAppStore.getState().showSuccess(t('profile.totp.disableSuccess'))
      onSuccess?.()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('profile.totp.disableFailed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <BaseDialog
      show
      title={t('profile.totp.disableTitle')}
      description={t('profile.totp.disableWarning')}
      width="narrow"
      closeOnClickOutside
      onClose={onClose}
    >
      {methodLoading ? (
        <div className={shared.loadingRow}>
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <form className={shared.form} onSubmit={(event) => void handleDisable(event)}>
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
                  value={form.emailCode}
                  onChange={(value) => setForm((prev) => ({ ...prev, emailCode: value }))}
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
              id="password"
              type="password"
              autoComplete="current-password"
              label={t('profile.currentPassword')}
              placeholder={t('profile.totp.enterPassword')}
              value={form.password}
              onChange={(value) => setForm((prev) => ({ ...prev, password: value }))}
            />
          )}

          <div className={shared.actions}>
            <Button type="button" variant="secondary" onClick={() => onClose?.()}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={loading || !canSubmit}>
              {loading ? t('common.processing') : t('profile.totp.confirmDisable')}
            </Button>
          </div>
        </form>
      )}
    </BaseDialog>
  )
}
