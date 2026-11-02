import { useState, type FormEvent } from 'react'

import { userAPI } from '@/api'
import { Button } from '@/components/arc/button/button'
import Input from '@/components/common/Input'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './Profile.module.css'

export interface ProfilePasswordFormProps {
  embedded?: boolean
}

const emptyForm = { old_password: '', new_password: '', confirm_password: '' }

/** 修改密码表单，对应 Vue 版 ProfilePasswordForm.vue；校验失败与接口错误都用 toast 提示 */
export default function ProfilePasswordForm({ embedded = false }: ProfilePasswordFormProps) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const handleChangePassword = async (event: FormEvent) => {
    event.preventDefault()
    const appStore = useAppStore.getState()
    if (form.new_password !== form.confirm_password) {
      appStore.showError(t('profile.passwordsNotMatch'))
      return
    }

    if (form.new_password.length < 8) {
      appStore.showError(t('profile.passwordTooShort'))
      return
    }

    setLoading(true)
    try {
      await userAPI.changePassword(form.old_password, form.new_password)
      setForm(emptyForm)
      appStore.showSuccess(t('profile.passwordChangeSuccess'))
    } catch (error: unknown) {
      appStore.showError(extractApiErrorMessage(error, t('profile.passwordChangeFailed')))
    } finally {
      setLoading(false)
    }
  }

  const body = (
    <form className={styles.form} onSubmit={(event) => void handleChangePassword(event)}>
      {embedded && <p className={styles.embeddedTitle}>{t('profile.changePassword')}</p>}
      <Input
        id="old_password"
        type="password"
        required
        autoComplete="current-password"
        label={t('profile.currentPassword')}
        value={form.old_password}
        onChange={(value) => setForm((prev) => ({ ...prev, old_password: value }))}
      />
      <Input
        id="new_password"
        type="password"
        required
        autoComplete="new-password"
        label={t('profile.newPassword')}
        hint={t('profile.passwordHint')}
        value={form.new_password}
        onChange={(value) => setForm((prev) => ({ ...prev, new_password: value }))}
      />
      <Input
        id="confirm_password"
        type="password"
        required
        autoComplete="new-password"
        label={t('profile.confirmNewPassword')}
        value={form.confirm_password}
        onChange={(value) => setForm((prev) => ({ ...prev, confirm_password: value }))}
      />
      <div className={styles.actions}>
        <Button type="submit" disabled={loading}>
          {loading ? t('profile.changingPassword') : t('profile.changePasswordButton')}
        </Button>
      </div>
    </form>
  )

  if (embedded) return <div className={styles.stack}>{body}</div>

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{t('profile.changePassword')}</h2>
      </div>
      <div className={styles.panelBody}>{body}</div>
    </section>
  )
}
