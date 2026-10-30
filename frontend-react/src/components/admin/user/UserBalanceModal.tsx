/**
 * 充值 / 退款弹窗，对应 Vue 版 UserBalanceModal.vue。
 * 打开时重置表单；退款金额不能超过当前余额；失败时提示接口错误并保持弹窗打开。
 */
import { useEffect, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import TextArea from '@/components/common/TextArea'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminUser } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import { UserAvatar } from './UserAvatar'
import styles from './userModals.module.css'

export interface UserBalanceModalProps {
  show: boolean
  user: AdminUser | null
  operation: 'add' | 'subtract'
  onClose?: () => void
  onSuccess?: () => void
}

// 格式化余额：显示完整精度，去除尾部多余的0
const formatBalance = (value: number) => {
  if (value === 0) return '0.00'
  // 最多保留8位小数，去除尾部的0
  const formatted = value.toFixed(8).replace(/\.?0+$/, '')
  // 确保至少有2位小数
  const parts = formatted.split('.')
  if (parts.length === 1) return formatted + '.00'
  if (parts[1].length === 1) return formatted + '0'
  return formatted
}

/** 与 Vue 版 v-model.number 一致：能解析为数字时取数字，空输入视为 0 */
const parseAmount = (raw: string): number => {
  const parsed = parseFloat(raw)
  return Number.isNaN(parsed) ? 0 : parsed
}

export default function UserBalanceModal({ show, user, operation, onClose, onSuccess }: UserBalanceModalProps) {
  const { t } = useI18n()
  const [submitting, setSubmitting] = useState(false)
  const [amountInput, setAmountInput] = useState('0')
  const [notes, setNotes] = useState('')
  const amount = parseAmount(amountInput)

  useEffect(() => {
    if (!show) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时重置表单
    setAmountInput('0')
    setNotes('')
  }, [show])

  // 填入全部余额
  const fillAllBalance = () => {
    if (user) setAmountInput(String(user.balance))
  }

  const calculateNewBalance = () => {
    if (!user) return 0
    const result = operation === 'add' ? user.balance + amount : user.balance - amount
    // 避免浮点数精度问题导致的 -0.00 显示
    return Math.abs(result) < 1e-10 ? 0 : result
  }

  const handleBalanceSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!user) return
    const appStore = useAppStore.getState()
    if (!amount || amount <= 0) {
      appStore.showError(t('admin.users.amountRequired'))
      return
    }
    // 退款时验证金额不超过实际余额
    if (operation === 'subtract' && amount > user.balance) {
      appStore.showError(t('admin.users.insufficientBalance'))
      return
    }
    setSubmitting(true)
    try {
      await adminAPI.users.updateBalance(user.id, amount, operation, notes)
      appStore.showSuccess(t('common.success'))
      onSuccess?.()
      onClose?.()
    } catch (e: any) {
      console.error('Failed to update balance:', e)
      appStore.showError(extractApiErrorMessage(e, t('common.error')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <BaseDialog
      show={show}
      title={operation === 'add' ? t('admin.users.deposit') : t('admin.users.withdraw')}
      width="narrow"
      onClose={() => onClose?.()}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onClose?.()}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="balance-form"
            variant={operation === 'add' ? 'primary' : 'danger'}
            disabled={submitting || !amount}
            data-testid="balance-submit"
          >
            {submitting ? t('common.saving') : t('common.confirm')}
          </Button>
        </>
      }
    >
      {user && (
        <form id="balance-form" className={styles.form} onSubmit={(event) => void handleBalanceSubmit(event)}>
          <div className={styles.userHeader}>
            <UserAvatar email={user.email} />
            <div className={styles.userMeta}>
              <p className={styles.userEmail}>{user.email}</p>
              <p className={styles.userSub}>
                {t('admin.users.currentBalance')}: ${formatBalance(user.balance)}
              </p>
            </div>
          </div>
          <div className={styles.inputRow}>
            <Input
              label={operation === 'add' ? t('admin.users.depositAmount') : t('admin.users.withdrawAmount')}
              type="number"
              step="any"
              min="0"
              required
              prefix={<span aria-hidden="true">$</span>}
              value={amountInput}
              onChange={setAmountInput}
            />
            {operation === 'subtract' && (
              <Button type="button" variant="secondary" onClick={fillAllBalance}>
                {t('admin.users.withdrawAll')}
              </Button>
            )}
          </div>
          <TextArea label={t('admin.users.notes')} rows={3} value={notes} onChange={setNotes} />
          {amount > 0 && (
            <div className={styles.preview}>
              <span className={styles.previewLabel}>{t('admin.users.newBalance')}:</span>
              <span className={styles.previewValue}>${formatBalance(calculateNewBalance())}</span>
            </div>
          )}
        </form>
      )}
    </BaseDialog>
  )
}
