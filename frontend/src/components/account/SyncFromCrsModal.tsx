/**
 * 从 CRS 同步账号，对应 Vue 版 SyncFromCrsModal.vue。三步：填写凭据 → 预览并勾选新账号 → 同步结果。
 * 每次打开都重置为第一步并清空表单；预览或同步进行中不允许关闭。
 */
import { useEffect, useState, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import type { PreviewFromCRSResult } from '@/api/admin/accounts'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import BaseDialog from '@/components/common/BaseDialog'
import Input from '@/components/common/Input'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './SyncFromCrsModal.module.css'

export interface SyncFromCrsModalProps {
  show: boolean
  onClose?: () => void
  onSynced?: () => void
}

type Step = 'input' | 'preview' | 'result'
type SyncResult = Awaited<ReturnType<typeof adminAPI.accounts.syncFromCrs>>

interface SyncForm {
  base_url: string
  username: string
  password: string
  sync_proxies: boolean
}

const emptyForm = (): SyncForm => ({ base_url: '', username: '', password: '', sync_proxies: true })

const FORM_ID = 'sync-from-crs-form'

export default function SyncFromCrsModal({ show, onClose, onSynced }: SyncFromCrsModalProps) {
  const { t } = useI18n()

  const [currentStep, setCurrentStep] = useState<Step>('input')
  const [previewing, setPreviewing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [previewResult, setPreviewResult] = useState<PreviewFromCRSResult | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [result, setResult] = useState<SyncResult | null>(null)
  const [form, setForm] = useState<SyncForm>(emptyForm)

  // 打开时重置（Vue 版 watch(show)）
  useEffect(() => {
    if (!show) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 每次打开重置为初始步骤
    setCurrentStep('input')
    setPreviewResult(null)
    setSelectedIds(new Set())
    setResult(null)
    setForm(emptyForm())
  }, [show])

  const updateForm = <K extends keyof SyncForm>(key: K, value: SyncForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const hasNewButNoneSelected = !!previewResult && previewResult.new_accounts.length > 0 && selectedIds.size === 0

  const errorItems = (result?.items ?? []).filter(
    (i) => i.action === 'failed' || (i.action === 'skipped' && i.error !== 'not selected')
  )

  const handleClose = () => {
    if (syncing || previewing) {
      return
    }
    onClose?.()
  }

  const handleBack = () => {
    setCurrentStep('input')
    setPreviewResult(null)
    setSelectedIds(new Set())
  }

  const selectAll = () => {
    if (!previewResult) return
    setSelectedIds(new Set(previewResult.new_accounts.map((a) => a.crs_account_id)))
  }

  const selectNone = () => setSelectedIds(new Set())

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  const missingFields = () => !form.base_url.trim() || !form.username.trim() || !form.password.trim()

  const handlePreview = async (event?: FormEvent) => {
    event?.preventDefault()
    if (missingFields()) {
      useAppStore.getState().showError(t('admin.accounts.syncMissingFields'))
      return
    }

    setPreviewing(true)
    try {
      const res = await adminAPI.accounts.previewFromCrs({
        base_url: form.base_url.trim(),
        username: form.username.trim(),
        password: form.password
      })
      setPreviewResult(res)
      // Auto-select all new accounts
      setSelectedIds(new Set(res.new_accounts.map((a) => a.crs_account_id)))
      setCurrentStep('preview')
    } catch (error: any) {
      useAppStore.getState().showError(error?.message || t('admin.accounts.crsPreviewFailed'))
    } finally {
      setPreviewing(false)
    }
  }

  const handleSync = async () => {
    if (missingFields()) {
      useAppStore.getState().showError(t('admin.accounts.syncMissingFields'))
      return
    }

    setSyncing(true)
    try {
      const res = await adminAPI.accounts.syncFromCrs({
        base_url: form.base_url.trim(),
        username: form.username.trim(),
        password: form.password,
        sync_proxies: form.sync_proxies,
        selected_account_ids: [...selectedIds]
      })
      setResult(res)
      setCurrentStep('result')

      if (res.failed > 0) {
        useAppStore.getState().showError(t('admin.accounts.syncCompletedWithErrors', res))
      } else {
        useAppStore.getState().showSuccess(t('admin.accounts.syncCompleted', res))
      }
      onSynced?.()
    } catch (error: any) {
      useAppStore.getState().showError(error?.message || t('admin.accounts.syncFailed'))
    } finally {
      setSyncing(false)
    }
  }

  let footer = null
  if (currentStep === 'input') {
    footer = (
      <>
        <Button variant="secondary" type="button" disabled={previewing} onClick={handleClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit" form={FORM_ID} disabled={previewing}>
          {previewing ? t('admin.accounts.crsPreviewing') : t('admin.accounts.crsPreview')}
        </Button>
      </>
    )
  } else if (currentStep === 'preview') {
    footer = (
      <>
        <Button variant="secondary" type="button" disabled={syncing} onClick={handleBack}>
          {t('admin.accounts.crsBack')}
        </Button>
        <Button variant="primary" type="button" disabled={syncing || hasNewButNoneSelected} onClick={handleSync}>
          {syncing ? t('admin.accounts.syncing') : t('admin.accounts.syncNow')}
        </Button>
      </>
    )
  } else if (currentStep === 'result') {
    footer = (
      <Button variant="secondary" type="button" onClick={handleClose}>
        {t('common.close')}
      </Button>
    )
  }

  return (
    <BaseDialog
      show={show}
      title={t('admin.accounts.syncFromCrsTitle')}
      width="normal"
      closeOnClickOutside
      onClose={handleClose}
      footer={footer}
    >
      {/* Step 1: Input credentials */}
      {currentStep === 'input' ? (
        <form id={FORM_ID} className={styles.stack} onSubmit={handlePreview}>
          <p className={styles.description}>{t('admin.accounts.syncFromCrsDesc')}</p>
          <p className={styles.note}>{t('admin.accounts.crsUpdateBehaviorNote')}</p>
          <p className={styles.warning}>{t('admin.accounts.crsVersionRequirement')}</p>

          <Input
            id="crs-base-url"
            label={t('admin.accounts.crsBaseUrl')}
            value={form.base_url}
            onChange={(value) => updateForm('base_url', value)}
            required
            placeholder={t('admin.accounts.crsBaseUrlPlaceholder')}
          />
          <div className={styles.pair}>
            <Input
              id="crs-username"
              label={t('admin.accounts.crsUsername')}
              value={form.username}
              onChange={(value) => updateForm('username', value)}
              required
              autoComplete="username"
            />
            <Input
              id="crs-password"
              type="password"
              label={t('admin.accounts.crsPassword')}
              value={form.password}
              onChange={(value) => updateForm('password', value)}
              required
              autoComplete="current-password"
            />
          </div>
          <Checkbox
            label={t('admin.accounts.syncProxies')}
            checked={form.sync_proxies}
            onCheckedChange={(checked) => updateForm('sync_proxies', checked === true)}
          />
        </form>
      ) : null}

      {/* Step 2: Preview & select */}
      {currentStep === 'preview' && previewResult ? (
        <div className={styles.stack}>
          {/* Existing accounts (read-only info) */}
          {previewResult.existing_accounts.length ? (
            <section className={styles.group}>
              <h3 className={styles.groupTitle}>
                {t('admin.accounts.crsExistingAccounts')}
                <span className={styles.count}>({previewResult.existing_accounts.length})</span>
              </h3>
              <div className={styles.existingList}>
                {previewResult.existing_accounts.map((acc) => (
                  <div key={acc.crs_account_id} className={styles.accountRow}>
                    <Badge size="sm" tone="info">{`${acc.platform} / ${acc.type}`}</Badge>
                    <span className={styles.accountName}>{acc.name}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* New accounts (selectable) */}
          {previewResult.new_accounts.length ? (
            <section>
              <div className={styles.newHeader}>
                <h3 className={styles.groupTitle}>
                  {t('admin.accounts.crsNewAccounts')}
                  <span className={styles.count}>({previewResult.new_accounts.length})</span>
                </h3>
                <div className={styles.headerActions}>
                  <Button type="button" variant="ghost" size="sm" onClick={selectAll}>
                    {t('admin.accounts.crsSelectAll')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={selectNone}>
                    {t('admin.accounts.crsSelectNone')}
                  </Button>
                </div>
              </div>
              <div className={styles.newList}>
                {previewResult.new_accounts.map((acc) => (
                  <div key={acc.crs_account_id} className={styles.selectRow}>
                    <Checkbox
                      checked={selectedIds.has(acc.crs_account_id)}
                      onCheckedChange={() => toggleSelect(acc.crs_account_id)}
                      aria-label={acc.name}
                    />
                    <Badge size="sm" tone="success">{`${acc.platform} / ${acc.type}`}</Badge>
                    <span className={styles.accountName}>{acc.name}</span>
                  </div>
                ))}
              </div>
              <div className={styles.hint}>{t('admin.accounts.crsSelectedCount', { count: selectedIds.size })}</div>
            </section>
          ) : null}

          {/* Sync options summary */}
          <div className={styles.summary}>
            <span>{t('admin.accounts.syncProxies')}:</span>
            <span data-state={form.sync_proxies ? 'on' : 'off'}>
              {form.sync_proxies ? t('common.yes') : t('common.no')}
            </span>
          </div>

          {/* No new accounts */}
          {!previewResult.new_accounts.length ? (
            <div className={styles.emptyNote}>
              {t('admin.accounts.crsNoNewAccounts')}
              {previewResult.existing_accounts.length ? (
                <span> {t('admin.accounts.crsWillUpdate', { count: previewResult.existing_accounts.length })}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Step 3: Result */}
      {currentStep === 'result' && result ? (
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{t('admin.accounts.syncResult')}</h3>
          <p className={styles.description}>
            {t('admin.accounts.syncResultSummary', result as unknown as Record<string, unknown>)}
          </p>

          {errorItems.length ? (
            <div>
              <div className={styles.errorTitle}>{t('admin.accounts.syncErrors')}</div>
              <div className={styles.errorList}>
                {errorItems.map((item, idx) => (
                  <div key={idx} className={styles.errorItem}>
                    {item.kind} {item.crs_account_id} — {item.action}
                    {item.error ? `: ${item.error}` : ''}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </BaseDialog>
  )
}
