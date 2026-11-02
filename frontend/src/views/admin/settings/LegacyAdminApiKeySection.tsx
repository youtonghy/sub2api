/**
 * 已有的全权 Admin API Key（安全 Tab 顶部）。已有密钥只提供轮换和删除入口，
 * 对应 Vue 版 SettingsView 中的 <details> 区块与 loadAdminApiKey 等方法。
 */
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import { adminAPI } from '@/api'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { Notice } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog'
import { useMountOnce } from '@/composables/useMountOnce'
import { isStepUpCancelled, useStepUp } from '@/composables/useStepUp'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import { extractApiErrorMessage } from '@/utils/apiError'
import styles from './SettingsView.module.css'

export default function LegacyAdminApiKeySection() {
  const { t } = useI18n()
  const stepUp = useStepUp()
  const [loading, setLoading] = useState(true)
  const [exists, setExists] = useState(false)
  const [masked, setMasked] = useState('')
  const [operating, setOperating] = useState(false)
  const [newKey, setNewKey] = useState('')

  useMountOnce(async () => {
    setLoading(true)
    try {
      const status = await adminAPI.settings.getAdminApiKey()
      setExists(status.exists)
      setMasked(status.masked_key)
    } catch {
      // Silent fail - admin API key status is non-critical
    } finally {
      setLoading(false)
    }
  })

  async function createAdminApiKey() {
    if (!exists) return
    setOperating(true)
    try {
      const result = await stepUp.run(() => adminAPI.settings.regenerateAdminApiKey())
      setNewKey(result.key)
      setExists(true)
      setMasked(result.key.substring(0, 10) + '...' + result.key.slice(-4))
      useAppStore.getState().showSuccess(t('admin.settings.adminApiKey.keyGenerated'))
    } catch (error: unknown) {
      if (isStepUpCancelled(error)) return
      useAppStore.getState().showError(extractApiErrorMessage(error, t('common.error')))
    } finally {
      setOperating(false)
    }
  }

  async function regenerateAdminApiKey() {
    if (!confirm(t('admin.settings.adminApiKey.regenerateConfirm'))) return
    await createAdminApiKey()
  }

  async function deleteAdminApiKey() {
    if (!confirm(t('admin.settings.adminApiKey.deleteConfirm'))) return
    setOperating(true)
    try {
      await stepUp.run(() => adminAPI.settings.deleteAdminApiKey())
      setExists(false)
      setMasked('')
      setNewKey('')
      useAppStore.getState().showSuccess(t('admin.settings.adminApiKey.keyDeleted'))
    } catch (error: unknown) {
      if (isStepUpCancelled(error)) return
      useAppStore.getState().showError(extractApiErrorMessage(error, t('common.error')))
    } finally {
      setOperating(false)
    }
  }

  function copyNewKey() {
    navigator.clipboard
      .writeText(newKey)
      .then(() => useAppStore.getState().showSuccess(t('admin.settings.adminApiKey.keyCopied')))
      .catch(() => useAppStore.getState().showError(t('common.copyFailed')))
  }

  return (
    <>
      {exists ? (
        <details className={styles.details}>
          <summary className={styles.summary}>{t('adminAccessKeys.legacy')}</summary>
          <div className={styles.detailsHeader}>
            <h2 className={styles.detailsTitle}>{t('admin.settings.adminApiKey.title')}</h2>
            <p className={s.hint}>{t('admin.settings.adminApiKey.description')}</p>
          </div>
          <div className={styles.detailsBody}>
            <Notice tone="warning">
              <p className={s.inline}>
                <AlertTriangle size={16} aria-hidden="true" />
                {t('admin.settings.adminApiKey.securityWarning')}
              </p>
            </Notice>
            {loading ? (
              <Skeleton label={t('common.loading')} lines={1} />
            ) : (
              <div className={s.column}>
                <div className={s.itemHead}>
                  <div className={s.columnTight}>
                    <span className={s.label}>{t('admin.settings.adminApiKey.currentKey')}</span>
                    <code className={s.code}>{masked}</code>
                  </div>
                  <div className={s.inline}>
                    <Button type="button" variant="secondary" size="sm" disabled={operating} onClick={() => void regenerateAdminApiKey()}>
                      {operating ? t('admin.settings.adminApiKey.regenerating') : t('admin.settings.adminApiKey.regenerate')}
                    </Button>
                    <Button type="button" variant="danger" size="sm" disabled={operating} onClick={() => void deleteAdminApiKey()}>
                      {t('admin.settings.adminApiKey.delete')}
                    </Button>
                  </div>
                </div>
                {newKey ? (
                  <Notice tone="success">
                    <p className={s.label}>{t('admin.settings.adminApiKey.keyWarning')}</p>
                    <div className={s.inline}>
                      <code className={s.codeBlock}>{newKey}</code>
                      <Button type="button" size="sm" onClick={copyNewKey}>
                        {t('admin.settings.adminApiKey.copyKey')}
                      </Button>
                    </div>
                    <p className={s.hint}>{t('admin.settings.adminApiKey.usage')}</p>
                  </Notice>
                ) : null}
              </div>
            )}
          </div>
        </details>
      ) : null}
      <TotpStepUpDialog controller={stepUp} />
    </>
  )
}
