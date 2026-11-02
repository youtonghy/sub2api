/**
 * 编辑用户弹窗，对应 Vue 版 UserEditModal.vue：基本信息、角色、并发、RPM 与自定义属性。
 * 并发 0 表示不限制（与网关 AcquireUserSlot 及批量改限额一致），负数被拒绝。
 * 角色提升为管理员时后端要求 step-up 2FA，弹出 TOTP 验证后自动重试。
 */
import { Check, Copy, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import { Button } from '@/components/arc/button/button'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import TextArea from '@/components/common/TextArea'
import UserAttributeForm from '@/components/user/UserAttributeForm'
import { useClipboard } from '@/composables/useClipboard'
import { isStepUpBlocked, isStepUpCancelled, stepUpBlockReason, useStepUp } from '@/composables/useStepUp'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminUser, UserAttributeValuesMap } from '@/types'
import { generateRandomPassword, looseToNumber, toInputValue } from './formUtils'
import styles from './userModals.module.css'

export interface UserEditModalProps {
  show: boolean
  user: AdminUser | null
  onClose?: () => void
  onSuccess?: () => void
}

interface EditForm {
  email: string
  password: string
  username: string
  notes: string
  role: AdminUser['role']
  concurrency: string
  rpm_limit: string
  customAttributes: UserAttributeValuesMap
}

const formFromUser = (u: AdminUser): EditForm => ({
  email: u.email,
  password: '',
  username: u.username || '',
  notes: u.notes || '',
  role: u.role || 'user',
  concurrency: toInputValue(u.concurrency),
  rpm_limit: toInputValue(u.rpm_limit ?? 0),
  customAttributes: {}
})

const emptyForm = (): EditForm => ({
  email: '',
  password: '',
  username: '',
  notes: '',
  role: 'user',
  concurrency: '1',
  rpm_limit: '0',
  customAttributes: {}
})

export default function UserEditModal({ show, user, onClose, onSuccess }: UserEditModalProps) {
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()
  const stepUp = useStepUp()
  const [submitting, setSubmitting] = useState(false)
  const [passwordCopied, setPasswordCopied] = useState(false)
  const [form, setForm] = useState<EditForm>(() => (user ? formFromUser(user) : emptyForm()))
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const patch = (next: Partial<EditForm>) => setForm((prev) => ({ ...prev, ...next }))

  // 对应 Vue 版 watch(user, immediate)：切换用户时重置表单
  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换编辑对象时重置表单
    setForm(formFromUser(user))
    setPasswordCopied(false)
  }, [user])

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    []
  )

  const copyPassword = async () => {
    if (form.password && (await copyToClipboard(form.password, t('admin.users.passwordCopied')))) {
      setPasswordCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setPasswordCopied(false), 2000)
    }
  }

  const handleUpdateUser = async (event: FormEvent) => {
    event.preventDefault()
    if (!user) return
    const appStore = useAppStore.getState()
    if (!form.email.trim()) {
      appStore.showError(t('admin.users.emailRequired'))
      return
    }
    const concurrency = looseToNumber(form.concurrency)
    // 0 = 不限制，与网关 (AcquireUserSlot: maxConcurrency <= 0) 和批量改限额一致
    if (typeof concurrency !== 'number' || !Number.isInteger(concurrency) || concurrency < 0) {
      appStore.showError(t('admin.users.concurrencyNonNegative'))
      return
    }
    const userId = user.id
    setSubmitting(true)
    try {
      const data: any = {
        email: form.email,
        username: form.username,
        notes: form.notes,
        role: form.role,
        concurrency,
        rpm_limit: looseToNumber(form.rpm_limit)
      }
      if (form.password.trim()) data.password = form.password.trim()
      // 提升为管理员属敏感操作：后端返回 STEP_UP_REQUIRED 时弹 TOTP 验证并重试
      await stepUp.run(() => adminAPI.users.update(userId, data))
      if (Object.keys(form.customAttributes).length > 0) {
        await adminAPI.userAttributes.updateUserAttributeValues(userId, form.customAttributes)
      }
      appStore.showSuccess(t('admin.users.userUpdated'))
      onSuccess?.()
      onClose?.()
    } catch (e: any) {
      if (isStepUpCancelled(e)) {
        // 用户主动取消二次验证：静默返回，表单保持打开。
      } else if (isStepUpBlocked(e)) {
        appStore.showError(
          stepUpBlockReason(e) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN' ? t('stepUp.adminApiKeyForbidden') : t('stepUp.notEnabled')
        )
      } else {
        appStore.showError(e?.message || t('admin.users.failedToUpdate'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const roleOptions = [
    { value: 'user', label: t('admin.users.roles.user') },
    { value: 'admin', label: t('admin.users.roles.admin') }
  ]

  return (
    <>
      <BaseDialog
        show={show}
        title={t('admin.users.editUser')}
        width="normal"
        onClose={() => onClose?.()}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => onClose?.()}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="edit-user-form" variant="primary" disabled={submitting} loading={submitting}>
              {submitting ? t('admin.users.updating') : t('common.update')}
            </Button>
          </>
        }
      >
        {user && (
          <form id="edit-user-form" className={styles.form} onSubmit={(event) => void handleUpdateUser(event)}>
            <Input label={t('admin.users.email')} type="email" value={form.email} onChange={(email) => patch({ email })} />
            <div className={styles.inputRow}>
              <Input
                label={t('admin.users.password')}
                type="text"
                placeholder={t('admin.users.enterNewPassword')}
                value={form.password}
                onChange={(password) => patch({ password })}
                suffix={
                  form.password ? (
                    <button
                      type="button"
                      className={styles.iconButton}
                      data-copied={passwordCopied ? '' : undefined}
                      title={t('admin.users.copyPassword')}
                      aria-label={t('admin.users.copyPassword')}
                      onClick={() => void copyPassword()}
                    >
                      {passwordCopied ? (
                        <Check size={16} strokeWidth={2} aria-hidden="true" />
                      ) : (
                        <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
                      )}
                    </button>
                  ) : undefined
                }
              />
              <Button
                type="button"
                variant="secondary"
                title={t('admin.users.generatePassword')}
                aria-label={t('admin.users.generatePassword')}
                onClick={() => patch({ password: generateRandomPassword() })}
              >
                <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </div>
            <Input label={t('admin.users.username')} type="text" value={form.username} onChange={(username) => patch({ username })} />
            <div className={styles.field}>
              <span className={styles.label}>{t('admin.users.form.roleLabel')}</span>
              <Select
                value={form.role}
                options={roleOptions}
                searchable={false}
                aria-label={t('admin.users.form.roleLabel')}
                onChange={(role) => patch({ role: role as AdminUser['role'] })}
              />
            </div>
            <TextArea label={t('admin.users.notes')} rows={3} value={form.notes} onChange={(notes) => patch({ notes })} />
            <Input
              label={t('admin.users.columns.concurrency')}
              type="number"
              min="0"
              step="1"
              placeholder={t('admin.users.form.concurrencyPlaceholder')}
              hint={t('admin.users.form.concurrencyHint')}
              data-test="concurrency-input"
              value={form.concurrency}
              onChange={(concurrency) => patch({ concurrency })}
            />
            <Input
              label={t('admin.users.form.rpmLimit')}
              type="number"
              min="0"
              step="1"
              placeholder={t('admin.users.form.rpmLimitPlaceholder')}
              hint={t('admin.users.form.rpmLimitHint')}
              value={form.rpm_limit}
              onChange={(rpm_limit) => patch({ rpm_limit })}
            />
            <UserAttributeForm
              userId={user.id}
              value={form.customAttributes}
              onChange={(customAttributes) => patch({ customAttributes })}
            />
          </form>
        )}
      </BaseDialog>

      {/* 角色提升为管理员时后端要求 step-up 2FA，弹出 TOTP 验证后自动重试 */}
      <TotpStepUpDialog controller={stepUp} />
    </>
  )
}
