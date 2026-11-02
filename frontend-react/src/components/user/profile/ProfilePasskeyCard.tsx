import { KeyRound } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { passkeyAPI, type PasskeyCredentialSummary } from '@/api'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './ProfilePasskeyCard.module.css'
import shared from './Profile.module.css'

export interface ProfilePasskeyCardProps {
  enabled: boolean
}

// apiClient 拦截器把错误规范化为 { code, reason, message }；
// 透出后端消息（如密码错误），否则回退到通用文案。
function extractErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: string }).message
  return typeof message === 'string' && message.length > 0 ? message : fallback
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value))
}

/** Passkey 管理（添加、重命名、删除需验证密码），对应 Vue 版 ProfilePasskeyCard.vue */
export default function ProfilePasskeyCard({ enabled }: ProfilePasskeyCardProps) {
  const { t } = useI18n()
  const [supported] = useState(() => passkeyAPI.isSupported())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<PasskeyCredentialSummary | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [credentials, setCredentials] = useState<PasskeyCredentialSummary[]>([])

  const loadCredentials = useCallback(async () => {
    if (!enabled) {
      setCredentials([])
      return
    }
    setLoading(true)
    try {
      setCredentials(await passkeyAPI.list())
    } catch (error) {
      // 字符串错误码在 reason 字段（code 是数字状态码）；
      // 设置变更竞态下后端仍可能返回 PASSKEY_DISABLED，静默处理
      const reason = (error as { reason?: string }).reason
      if (reason !== 'PASSKEY_DISABLED') {
        useAppStore.getState().showError(t('profile.passkey.loadFailed'))
      }
    } finally {
      setLoading(false)
    }
  }, [enabled, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(enabled, { immediate: true })
    void loadCredentials()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在开关变化时重新加载
  }, [enabled])

  function cancelAdd() {
    setShowAddForm(false)
    setNewName('')
    setNewPassword('')
  }

  async function addPasskey(event: FormEvent) {
    event.preventDefault()
    if (newPassword.length === 0) return
    setBusy(true)
    try {
      await passkeyAPI.register(newName.trim(), newPassword)
      useAppStore.getState().showSuccess(t('profile.passkey.added'))
      cancelAdd()
      await loadCredentials()
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
        useAppStore.getState().showError(extractErrorMessage(error, t('profile.passkey.addFailed')))
      }
    } finally {
      setBusy(false)
    }
  }

  async function renamePasskey(credential: PasskeyCredentialSummary) {
    const name = window.prompt(t('profile.passkey.renamePrompt'), credential.name)?.trim()
    if (!name || name === credential.name) return
    setBusy(true)
    try {
      await passkeyAPI.rename(credential.id, name)
      setCredentials((list) => list.map((item) => (item.id === credential.id ? { ...item, name } : item)))
      useAppStore.getState().showSuccess(t('profile.passkey.renamed'))
    } catch {
      useAppStore.getState().showError(t('profile.passkey.renameFailed'))
    } finally {
      setBusy(false)
    }
  }

  function closeDeleteDialog() {
    setDeleteTarget(null)
    setDeletePassword('')
  }

  async function confirmDelete(event: FormEvent) {
    event.preventDefault()
    const credential = deleteTarget
    if (!credential || deletePassword.length === 0) return
    setBusy(true)
    try {
      await passkeyAPI.remove(credential.id, deletePassword)
      setCredentials((list) => list.filter((item) => item.id !== credential.id))
      useAppStore.getState().showSuccess(t('profile.passkey.deleted'))
      closeDeleteDialog()
    } catch (error) {
      // 密码错误等失败保持对话框打开，允许重试
      useAppStore.getState().showError(extractErrorMessage(error, t('profile.passkey.deleteFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={shared.panel}>
      <div className={shared.panelHeader}>
        <div>
          <h2 className={shared.panelTitle}>{t('profile.passkey.title')}</h2>
          <p className={shared.panelDescription}>{t('profile.passkey.description')}</p>
        </div>
        {enabled && supported && !showAddForm && (
          <Button type="button" disabled={busy} onClick={() => setShowAddForm(true)}>
            {t('profile.passkey.add')}
          </Button>
        )}
      </div>

      <div className={`${shared.panelBody} ${shared.stack}`}>
        {!enabled && <p className={shared.muted}>{t('profile.passkey.featureDisabled')}</p>}
        {enabled && !supported && <p className={`${shared.muted} ${shared.warningText}`}>{t('profile.passkey.unsupported')}</p>}

        {enabled && supported && showAddForm && (
          <form className={styles.addForm} onSubmit={(event) => void addPasskey(event)}>
            <div className={styles.addGrid}>
              <Input
                id="passkey-name"
                maxLength={100}
                label={t('profile.passkey.name')}
                placeholder={t('profile.passkey.namePlaceholder')}
                autoFocus
                value={newName}
                onChange={setNewName}
              />
              <Input
                id="passkey-add-password"
                type="password"
                autoComplete="current-password"
                label={t('profile.currentPassword')}
                placeholder={t('profile.passkey.passwordPlaceholder')}
                value={newPassword}
                onChange={setNewPassword}
              />
            </div>
            <div className={shared.actions}>
              <Button type="button" variant="secondary" disabled={busy} onClick={cancelAdd}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy || newPassword.length === 0}>
                {busy ? t('common.processing') : t('profile.passkey.continue')}
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className={shared.loadingRow}>
            <LoadingSpinner size="lg" />
          </div>
        ) : credentials.length === 0 ? (
          <div className={shared.emptyBox}>{t('profile.passkey.empty')}</div>
        ) : (
          <div className={styles.list}>
            {credentials.map((credential) => (
              <div key={credential.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>
                    <KeyRound size={16} strokeWidth={1.75} className={styles.keyIcon} aria-hidden="true" />
                    <p className={styles.itemName}>{credential.name}</p>
                    {credential.backup && (
                      <Badge size="sm" tone="success">
                        {t('profile.passkey.synced')}
                      </Badge>
                    )}
                  </div>
                  <p className={shared.hint}>
                    {t('profile.passkey.createdAt', { date: formatDate(credential.created_at) })}
                    {credential.last_used_at &&
                      ` · ${t('profile.passkey.lastUsed', { date: formatDate(credential.last_used_at) })}`}
                  </p>
                </div>
                <div className={styles.itemActions}>
                  <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void renamePasskey(credential)}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setDeleteTarget(credential)
                      setDeletePassword('')
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 删除确认：吊销凭据需验证当前密码，防止被窃会话静默移除 Passkey */}
      <BaseDialog
        show={deleteTarget !== null}
        title={t('profile.passkey.deleteTitle')}
        description={deleteTarget ? t('profile.passkey.deleteConfirm', { name: deleteTarget.name }) : undefined}
        width="narrow"
        closeOnClickOutside
        onClose={closeDeleteDialog}
      >
        <form className={shared.form} onSubmit={(event) => void confirmDelete(event)}>
          <Input
            id="passkey-delete-password"
            type="password"
            autoComplete="current-password"
            label={t('profile.currentPassword')}
            placeholder={t('profile.passkey.passwordPlaceholder')}
            autoFocus
            value={deletePassword}
            onChange={setDeletePassword}
          />
          <div className={shared.actions}>
            <Button type="button" variant="secondary" disabled={busy} onClick={closeDeleteDialog}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={busy || deletePassword.length === 0}>
              {busy ? t('common.processing') : t('common.delete')}
            </Button>
          </div>
        </form>
      </BaseDialog>
    </section>
  )
}
