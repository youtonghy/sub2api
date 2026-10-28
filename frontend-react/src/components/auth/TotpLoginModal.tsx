import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog'
import { OtpInput } from '@/components/arc/otp-input/otp-input'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './TotpLoginModal.module.css'

export interface TotpLoginModalProps {
  tempToken: string
  userEmailMasked?: string
  onVerify: (code: string) => void
  onCancel: () => void
}

/** 与 Vue 版 defineExpose 相同的命令式接口 */
export interface TotpLoginModalHandle {
  setVerifying: (value: boolean) => void
  setError: (message: string) => void
}

const TotpLoginModal = forwardRef<TotpLoginModalHandle, TotpLoginModalProps>(function TotpLoginModal(
  { userEmailMasked, onVerify, onCancel },
  ref
) {
  const { t } = useI18n()
  const [verifying, setVerifying] = useState(false)
  const [code, setCode] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)
  const verifyingRef = useRef(false)
  const groupRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    setVerifying: (value: boolean) => {
      verifyingRef.current = value
      setVerifying(value)
    },
    setError: (message: string) => {
      if (message) {
        useAppStore.getState().showError(message)
      }
      setCode('')
      setFocusRequest((value) => value + 1)
    }
  }), [])

  // 出错清空后把焦点放回第一格
  useEffect(() => {
    if (focusRequest > 0) {
      groupRef.current?.querySelector('input')?.focus()
    }
  }, [focusRequest])

  // 输满 6 位自动提交
  const handleChange = (next: string) => {
    setCode(next)
    if (next.length === 6 && next !== code && !verifyingRef.current) {
      onVerify(next)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !verifying) onCancel() }}>
      <DialogContent
        title={t('profile.totp.loginTitle')}
        description={t('profile.totp.loginHint')}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <div className={styles.body}>
          {userEmailMasked && <p className={styles.email}>{userEmailMasked}</p>}
          <div ref={groupRef}>
            <OtpInput
              label={t('profile.totp.loginTitle')}
              value={code}
              onChange={handleChange}
              disabled={verifying}
              autoFocus
            />
          </div>
          {verifying && (
            <div className={styles.verifying} role="status">
              <Loader2 className={styles.spinner} size={16} strokeWidth={1.75} aria-hidden="true" />
              {t('common.verifying')}
            </div>
          )}
          <Button type="button" variant="secondary" className={styles.fullWidth} disabled={verifying} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
})

export default TotpLoginModal
