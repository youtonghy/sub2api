import { useEffect, useRef, useState } from 'react'

import { totpAPI } from '@/api'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'

/**
 * TOTP 启用/停用弹窗共用的身份验证逻辑（对应 Vue 版两个组件中重复的 loadVerificationMethod / handleSendCode）：
 * 挂载时读取验证方式（失败则提示并关闭），发送邮箱验证码后 60 秒冷却；卸载时清理定时器，
 * 卸载后才返回的发送请求不再启动冷却也不提示。
 */
export function useTotpVerification(onClose?: () => void) {
  const { t } = useI18n()
  const [methodLoading, setMethodLoading] = useState(true)
  const [verificationMethod, setVerificationMethod] = useState<'email' | 'password'>('password')
  const [sendingCode, setSendingCode] = useState(false)
  const [codeCooldown, setCodeCooldown] = useState(0)
  const cooldownTimer = useRef<number | null>(null)
  const disposed = useRef(false)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    disposed.current = false
    let active = true
    totpAPI
      .getVerificationMethod()
      .then((method) => {
        if (active) setVerificationMethod(method.method)
      })
      .catch((err: unknown) => {
        if (!active) return
        useAppStore.getState().showError(extractApiErrorMessage(err, t('common.error')))
        onCloseRef.current?.()
      })
      .finally(() => {
        if (active) setMethodLoading(false)
      })
    return () => {
      active = false
      disposed.current = true
      if (cooldownTimer.current) {
        window.clearInterval(cooldownTimer.current)
        cooldownTimer.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载时读取验证方式（Vue 版 onMounted）
  }, [])

  const handleSendCode = async () => {
    setSendingCode(true)
    try {
      await totpAPI.sendVerifyCode()
      if (disposed.current) return
      useAppStore.getState().showSuccess(t('profile.totp.codeSent'))
      // Start cooldown
      let remaining = 60
      setCodeCooldown(remaining)
      if (cooldownTimer.current) {
        window.clearInterval(cooldownTimer.current)
        cooldownTimer.current = null
      }
      cooldownTimer.current = window.setInterval(() => {
        remaining -= 1
        setCodeCooldown(remaining)
        if (remaining <= 0 && cooldownTimer.current) {
          window.clearInterval(cooldownTimer.current)
          cooldownTimer.current = null
        }
      }, 1000)
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('profile.totp.sendCodeFailed')))
    } finally {
      if (!disposed.current) setSendingCode(false)
    }
  }

  return { methodLoading, verificationMethod, sendingCode, codeCooldown, handleSendCode }
}
