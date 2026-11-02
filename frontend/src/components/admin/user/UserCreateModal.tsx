/**
 * 新建用户弹窗，对应 Vue 版 UserCreateModal.vue。
 * 创建管理员账号时后端要求 step-up 2FA，弹出 TOTP 验证后自动重试。
 */
import { RefreshCw } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import { Button } from '@/components/arc/button/button'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import { isStepUpBlocked, isStepUpCancelled, stepUpBlockReason, useStepUp } from '@/composables/useStepUp'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { generateRandomPassword, looseToNumber } from './formUtils'
import styles from './userModals.module.css'

export interface UserCreateModalProps {
  show: boolean
  onClose?: () => void
  onSuccess?: () => void
}

interface CreateForm {
  email: string
  password: string
  username: string
  notes: string
  role: 'user' | 'admin'
  balance: string
  concurrency: string
  rpm_limit: string
}

const initialForm = (): CreateForm => ({
  email: '',
  password: '',
  username: '',
  notes: '',
  role: 'user',
  balance: '',
  concurrency: '1',
  rpm_limit: '0'
})

export default function UserCreateModal({ show, onClose, onSuccess }: UserCreateModalProps) {
  const { t } = useI18n()
  const stepUp = useStepUp()
  const [form, setForm] = useState<CreateForm>(initialForm)
  const [loading, setLoading] = useState(false)

  const patch = (next: Partial<CreateForm>) => setForm((prev) => ({ ...prev, ...next }))

  useEffect(() => {
    if (!show) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：打开时重置表单
    setForm(initialForm())
  }, [show])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    const appStore = useAppStore.getState()
    try {
      const balance = form.balance.trim()
      const payload: {
        email: string
        password: string
        username: string
        notes: string
        role: 'user' | 'admin'
        concurrency: number
        rpm_limit: number
        balance?: number
      } = {
        email: form.email,
        password: form.password,
        username: form.username,
        notes: form.notes,
        role: form.role,
        // 与 Vue 版 v-model.number 一致：清空时原样提交空字符串
        concurrency: looseToNumber(form.concurrency) as number,
        rpm_limit: looseToNumber(form.rpm_limit) as number
      }
      if (balance !== '') {
        payload.balance = Number(balance)
      }
      // 创建管理员属敏感操作：后端返回 STEP_UP_REQUIRED 时弹 TOTP 验证并重试
      await stepUp.run(() => adminAPI.users.create(payload))
      appStore.showSuccess(t('admin.users.userCreated'))
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
        appStore.showError(e?.message || t('admin.users.failedToCreate'))
      }
    } finally {
      setLoading(false)
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
        title={t('admin.users.createUser')}
        width="normal"
        onClose={() => onClose?.()}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => onClose?.()}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="create-user-form" variant="primary" disabled={loading} loading={loading}>
              {loading ? t('admin.users.creating') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="create-user-form" className={styles.form} onSubmit={(event) => void submit(event)}>
          <Input
            label={t('admin.users.email')}
            type="email"
            required
            placeholder={t('admin.users.enterEmail')}
            value={form.email}
            onChange={(email) => patch({ email })}
          />
          <div className={styles.inputRow}>
            <Input
              label={t('admin.users.password')}
              type="text"
              required
              placeholder={t('admin.users.enterPassword')}
              value={form.password}
              onChange={(password) => patch({ password })}
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
          <Input
            label={t('admin.users.username')}
            type="text"
            placeholder={t('admin.users.enterUsername')}
            value={form.username}
            onChange={(username) => patch({ username })}
          />
          <div className={styles.field}>
            <span className={styles.label}>{t('admin.users.form.roleLabel')}</span>
            <Select
              value={form.role}
              options={roleOptions}
              searchable={false}
              aria-label={t('admin.users.form.roleLabel')}
              onChange={(role) => patch({ role: role as CreateForm['role'] })}
            />
          </div>
          <div className={styles.grid2}>
            <Input
              label={t('admin.users.columns.balance')}
              type="number"
              step="any"
              value={form.balance}
              onChange={(balance) => patch({ balance })}
            />
            <Input
              label={t('admin.users.columns.concurrency')}
              type="number"
              value={form.concurrency}
              onChange={(concurrency) => patch({ concurrency })}
            />
          </div>
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
        </form>
      </BaseDialog>

      {/* 创建管理员账号时后端要求 step-up 2FA，弹出 TOTP 验证后自动重试 */}
      <TotpStepUpDialog controller={stepUp} />
    </>
  )
}
