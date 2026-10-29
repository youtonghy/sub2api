/**
 * Step-up 二次验证弹窗，对应 Vue 版 components/auth/TotpStepUpDialog.vue。
 * 由 useStepUp 控制器驱动：输满 6 位自动提交 totpAPI.stepUp，成功后调用 onVerified，
 * 失败时提示错误、清空并重新聚焦；取消（按钮、Escape、点击遮罩）调用 onCancel，验证中不可取消。
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { totpAPI } from '@/api'
import { Button } from '@/components/arc/button/button'
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog'
import { OtpInput } from '@/components/arc/otp-input/otp-input'
import type { StepUpController } from '@/composables/useStepUp'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './TotpStepUpDialog.module.css'

export interface TotpStepUpDialogProps {
  controller: StepUpController
}

export default function TotpStepUpDialog({ controller }: TotpStepUpDialogProps) {
  const { t } = useI18n()
  const open = controller.visible
  const [verifying, setVerifying] = useState(false)
  const [code, setCode] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)
  const verifyingRef = useRef(false)
  const groupRef = useRef<HTMLDivElement>(null)

  // 每次打开时清空输入（OtpInput 的 autoFocus 负责聚焦第一格）
  const [lastOpen, setLastOpen] = useState(open)
  if (lastOpen !== open) {
    setLastOpen(open)
    if (open) setCode('')
  }

  // 验证失败清空后把焦点放回第一格
  useEffect(() => {
    if (focusRequest > 0) {
      groupRef.current?.querySelector('input')?.focus()
    }
  }, [focusRequest])

  const submit = async (otp: string) => {
    verifyingRef.current = true
    setVerifying(true)
    try {
      await totpAPI.stepUp(otp)
      verifyingRef.current = false
      setVerifying(false)
      setCode('')
      controller.onVerified()
    } catch (err: any) {
      verifyingRef.current = false
      setVerifying(false)
      useAppStore.getState().showError(err?.message || t('stepUp.verifyFailed'))
      setCode('')
      setFocusRequest((value) => value + 1)
    }
  }

  // 输满 6 位自动提交
  const handleChange = (next: string) => {
    const digits = next.replace(/[^0-9]/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6 && digits !== code && !verifyingRef.current) {
      void submit(digits)
    }
  }

  const handleCancel = () => {
    if (verifyingRef.current) return
    controller.onCancel()
  }

  if (!open) return null

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) handleCancel()
      }}
    >
      <DialogContent title={t('stepUp.title')} description={t('stepUp.hint')}>
        <div className={styles.body}>
          <div ref={groupRef}>
            <OtpInput label={t('stepUp.title')} value={code} onChange={handleChange} disabled={verifying} autoFocus />
          </div>
          {verifying && (
            <div className={styles.verifying} role="status">
              <Loader2 className={styles.spinner} size={16} strokeWidth={1.75} aria-hidden="true" />
              {t('common.verifying')}
            </div>
          )}
          <Button type="button" variant="secondary" className={styles.fullWidth} disabled={verifying} onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
