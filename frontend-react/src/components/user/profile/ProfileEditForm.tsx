import { useState, type FormEvent } from 'react'

import { userAPI } from '@/api'
import { Button } from '@/components/arc/button/button'
import Input from '@/components/common/Input'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './Profile.module.css'

export interface ProfileEditFormProps {
  initialUsername: string
  embedded?: boolean
}

/** 修改用户名，对应 Vue 版 ProfileEditForm.vue；保存期间输入的草稿不会被服务端结果覆盖 */
export default function ProfileEditForm({ initialUsername, embedded = false }: ProfileEditFormProps) {
  const { t } = useI18n()
  const [username, setUsername] = useState(initialUsername)
  const [savedUsername, setSavedUsername] = useState(initialUsername)
  const [prevInitial, setPrevInitial] = useState(initialUsername)
  const [loading, setLoading] = useState(false)

  // 对应 Vue 版 watch(initialUsername)：输入框未被编辑时跟随外部更新
  if (initialUsername !== prevInitial) {
    setPrevInitial(initialUsername)
    if (username === savedUsername) setUsername(initialUsername)
    setSavedUsername(initialUsername)
  }

  const handleUpdateProfile = async (event: FormEvent) => {
    event.preventDefault()
    const appStore = useAppStore.getState()
    if (!username.trim()) {
      appStore.showError(t('profile.usernameRequired'))
      return
    }

    setLoading(true)
    const submittedUsername = username
    try {
      const updatedUser = await userAPI.updateProfile({ username: submittedUsername })
      setUsername((current) => (current === submittedUsername ? updatedUser.username : current))
      setSavedUsername(updatedUser.username)
      useAuthStore.setState({ user: updatedUser })
      appStore.showSuccess(t('profile.updateSuccess'))
    } catch (error: unknown) {
      appStore.showError(extractApiErrorMessage(error, t('profile.updateFailed')))
    } finally {
      setLoading(false)
    }
  }

  const form = (
    <form className={styles.form} onSubmit={(event) => void handleUpdateProfile(event)}>
      {embedded && <p className={styles.embeddedTitle}>{t('profile.editProfile')}</p>}
      <Input
        id="username"
        label={t('profile.username')}
        placeholder={t('profile.enterUsername')}
        value={username}
        onChange={setUsername}
      />
      <div className={styles.actions}>
        <Button type="submit" disabled={loading}>
          {loading ? t('profile.updating') : t('profile.updateProfile')}
        </Button>
      </div>
    </form>
  )

  if (embedded) return <div className={styles.stack}>{form}</div>

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{t('profile.editProfile')}</h2>
      </div>
      <div className={styles.panelBody}>{form}</div>
    </section>
  )
}
