/**
 * 备份设置（对应 Vue 版 BackupView.vue），嵌在系统设置的“备份”Tab 中。
 * S3 存储、异步图片对象存储、定时备份与备份记录各为一个带边框的区域；
 * R2 指南与分卷下载链接改用 BaseDialog。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { adminAPI } from '@/api'
import type {
  BackupDownloadPart,
  BackupMonthlyArchiveConfig,
  BackupRecord,
  BackupS3Config,
  BackupScheduleConfig,
  ImageStorageConfig
} from '@/api/admin/backup'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import BackupArchiveSettings from '@/components/admin/BackupArchiveSettings'
import { Field, Notice, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog'
import BaseDialog from '@/components/common/BaseDialog'
import { useMountOnce } from '@/composables/useMountOnce'
import { isStepUpBlocked, isStepUpCancelled, stepUpBlockReason, useStepUp } from '@/composables/useStepUp'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import styles from './BackupView.module.css'

const MAX_POLL_COUNT = 900

function cloneArchive(config: BackupMonthlyArchiveConfig): BackupMonthlyArchiveConfig {
  return { ...config, days: [...config.days] }
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
      return 'info'
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as { message?: string })?.message || fallback
}

export default function BackupView() {
  const { t } = useI18n()
  const backupStepUp = useStepUp()

  // 敏感操作被 2FA 门控拦截时的统一提示。
  const reportStepUpBlocked = useCallback(
    (error: unknown): boolean => {
      if (!isStepUpBlocked(error)) return false
      useAppStore
        .getState()
        .showError(
          stepUpBlockReason(error) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN' ? t('stepUp.adminApiKeyForbidden') : t('stepUp.notEnabled')
        )
      return true
    },
    [t]
  )

  // S3 config
  const [s3Form, setS3Form] = useState<BackupS3Config>({
    endpoint: '',
    region: 'auto',
    bucket: '',
    access_key_id: '',
    secret_access_key: '',
    prefix: 'backups/',
    force_path_style: false
  })
  const [s3SecretConfigured, setS3SecretConfigured] = useState(false)
  const [savingS3, setSavingS3] = useState(false)
  const [testingS3, setTestingS3] = useState(false)

  // Async image object storage. Shares the S3 client with backups, so the default is
  // to reuse the credentials configured above and only differ by prefix.
  const [imageStorageForm, setImageStorageForm] = useState<ImageStorageConfig>({
    enabled: false,
    reuse_backup_s3: true,
    bucket: '',
    prefix: 'images/',
    public_base_url: '',
    presign_expiry_hours: 24,
    max_download_bytes: 33554432,
    endpoint: '',
    region: 'auto',
    access_key_id: '',
    secret_access_key: '',
    force_path_style: false
  })
  const [imageStorageSecretConfigured, setImageStorageSecretConfigured] = useState(false)
  const [savingImageStorage, setSavingImageStorage] = useState(false)
  const [testingImageStorage, setTestingImageStorage] = useState(false)

  // Schedule config
  const [scheduleForm, setScheduleForm] = useState<BackupScheduleConfig>({
    enabled: false,
    cron_expr: '0 2 * * *',
    retain_days: 14,
    retain_count: 10
  })
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [archiveForm, setArchiveForm] = useState<BackupMonthlyArchiveConfig>({
    enabled: false,
    days: [1],
    include_month_end: false,
    retain_count: 0
  })
  // Disabling hides the archive parameters, so a save while disabled keeps the
  // persisted parameters and only turns the rule off.
  const [savedArchive, setSavedArchive] = useState<BackupMonthlyArchiveConfig>(() => cloneArchive(archiveForm))
  const archivePayload = useMemo<BackupMonthlyArchiveConfig>(
    () => (archiveForm.enabled ? cloneArchive(archiveForm) : { ...cloneArchive(savedArchive), enabled: false }),
    [archiveForm, savedArchive]
  )

  const scheduleValidationError = useMemo(() => {
    const counts = [scheduleForm.retain_days, scheduleForm.retain_count]
    if (archiveForm.enabled) counts.push(archiveForm.retain_count)
    if (!counts.every((value) => Number.isSafeInteger(value) && value >= 0)) {
      return t('admin.backup.archive.invalidRetention')
    }
    if (archiveForm.enabled && !archiveForm.days.length && !archiveForm.include_month_end) {
      return t('admin.backup.archive.selectDates')
    }
    return ''
  }, [scheduleForm, archiveForm, t])

  const retentionPreview = useMemo(() => {
    if (scheduleValidationError) return scheduleValidationError
    const { retain_days: days, retain_count: count } = scheduleForm
    const ordinary =
      days > 0 && count > 0
        ? t('admin.backup.schedule.previewBoth', { days, count })
        : days > 0
          ? t('admin.backup.schedule.previewDays', { days })
          : count > 0
            ? t('admin.backup.schedule.previewCount', { count })
            : t('admin.backup.schedule.previewUnlimited')
    if (!archiveForm.enabled) return ordinary
    const dates = [
      ...[...archiveForm.days].sort((a, b) => a - b).map((day) => t('admin.backup.archive.day', { day })),
      ...(archiveForm.include_month_end ? [t('admin.backup.archive.monthEnd')] : [])
    ].join(', ')
    const retention =
      archiveForm.retain_count === 0
        ? t('admin.backup.archive.forever')
        : t('admin.backup.archive.retainLatest', { count: archiveForm.retain_count })
    return `${ordinary} ${t('admin.backup.archive.preview', { dates, retention })}`
  }, [scheduleValidationError, scheduleForm, archiveForm, t])

  // Backups
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [restoringId, setRestoringId] = useState('')
  const [manualExpireDays, setManualExpireDays] = useState<number | ''>(14)
  const [downloadParts, setDownloadParts] = useState<BackupDownloadPart[]>([])
  const [downloadPartsModalOpen, setDownloadPartsModalOpen] = useState(false)

  // Polling
  const pollingTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const restoringPollingTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const disposed = useRef(false)

  // R2 guide
  const [showR2Guide, setShowR2Guide] = useState(false)
  const r2ConfigRows = [
    { field: t('admin.backup.s3.endpoint'), value: 'https://<account_id>.r2.cloudflarestorage.com' },
    { field: t('admin.backup.s3.region'), value: 'auto' },
    { field: t('admin.backup.s3.bucket'), value: t('admin.backup.r2Guide.step4.bucketValue') },
    { field: t('admin.backup.s3.prefix'), value: 'backups/' },
    { field: 'Access Key ID', value: t('admin.backup.r2Guide.step4.fromStep2') },
    { field: 'Secret Access Key', value: t('admin.backup.r2Guide.step4.fromStep2') },
    { field: t('admin.backup.s3.forcePathStyle'), value: t('admin.backup.r2Guide.step4.unchecked') }
  ]

  const updateRecordInList = useCallback((updated: BackupRecord) => {
    setBackups((prev) => prev.map((record) => (record.id === updated.id ? updated : record)))
  }, [])

  const loadBackups = useCallback(async (): Promise<BackupRecord[]> => {
    setLoadingBackups(true)
    try {
      const result = await adminAPI.backup.listBackups()
      const items = result.items || []
      setBackups(items)
      return items
    } catch (error) {
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
      return []
    } finally {
      setLoadingBackups(false)
    }
  }, [t])

  const stopPolling = useCallback(() => {
    if (pollingTimer.current) {
      clearInterval(pollingTimer.current)
      pollingTimer.current = null
    }
  }, [])

  const stopRestorePolling = useCallback(() => {
    if (restoringPollingTimer.current) {
      clearInterval(restoringPollingTimer.current)
      restoringPollingTimer.current = null
    }
  }, [])

  const startPolling = useCallback(
    (backupId: string) => {
      if (disposed.current) return
      stopPolling()
      let count = 0
      pollingTimer.current = setInterval(async () => {
        const appStore = useAppStore.getState()
        if (count++ >= MAX_POLL_COUNT) {
          stopPolling()
          setCreatingBackup(false)
          appStore.showWarning(t('admin.backup.operations.backupRunning'))
          return
        }
        try {
          const record = await adminAPI.backup.getBackup(backupId)
          updateRecordInList(record)
          if (record.status === 'completed' || record.status === 'failed') {
            stopPolling()
            setCreatingBackup(false)
            if (record.status === 'completed') {
              appStore.showSuccess(t('admin.backup.operations.backupCreated'))
            } else {
              appStore.showError(record.error_message || t('admin.backup.operations.backupFailed'))
            }
            await loadBackups()
          }
        } catch {
          // 轮询失败时不中断
        }
      }, 2000)
    },
    [loadBackups, stopPolling, t, updateRecordInList]
  )

  const startRestorePolling = useCallback(
    (backupId: string) => {
      if (disposed.current) return
      stopRestorePolling()
      let count = 0
      restoringPollingTimer.current = setInterval(async () => {
        const appStore = useAppStore.getState()
        if (count++ >= MAX_POLL_COUNT) {
          stopRestorePolling()
          setRestoringId('')
          appStore.showWarning(t('admin.backup.operations.restoreRunning'))
          return
        }
        try {
          const record = await adminAPI.backup.getBackup(backupId)
          updateRecordInList(record)
          if (record.restore_status === 'completed' || record.restore_status === 'failed') {
            stopRestorePolling()
            setRestoringId('')
            if (record.restore_status === 'completed') {
              appStore.showSuccess(t('admin.backup.actions.restoreSuccess'))
            } else {
              appStore.showError(record.restore_error || t('admin.backup.operations.restoreFailed'))
            }
            await loadBackups()
          }
        } catch {
          // 轮询失败时不中断
        }
      }, 2000)
    },
    [loadBackups, stopRestorePolling, t, updateRecordInList]
  )

  // 列表中仍有进行中的备份或恢复时继续轮询
  const resumeActiveOperations = useCallback(
    (items: BackupRecord[]) => {
      const running = items.find((r) => r.status === 'running')
      if (running) {
        setCreatingBackup(true)
        startPolling(running.id)
      }
      const restoring = items.find((r) => r.restore_status === 'running')
      if (restoring) {
        setRestoringId(restoring.id)
        startRestorePolling(restoring.id)
      }
    },
    [startPolling, startRestorePolling]
  )

  const loadS3Config = useCallback(async () => {
    try {
      const cfg = await adminAPI.backup.getS3Config()
      setS3Form({
        endpoint: cfg.endpoint || '',
        region: cfg.region || 'auto',
        bucket: cfg.bucket || '',
        access_key_id: cfg.access_key_id || '',
        secret_access_key: '',
        prefix: cfg.prefix || 'backups/',
        force_path_style: cfg.force_path_style
      })
      setS3SecretConfigured(Boolean(cfg.access_key_id))
    } catch (error) {
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
    }
  }, [t])

  const loadImageStorageConfig = useCallback(async () => {
    try {
      const { config, secret_configured } = await adminAPI.backup.getImageStorageConfig()
      setImageStorageForm({
        ...config,
        prefix: config.prefix || 'images/',
        region: config.region || 'auto',
        secret_access_key: ''
      })
      setImageStorageSecretConfigured(secret_configured)
    } catch (error) {
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
    }
  }, [t])

  const loadSchedule = useCallback(async () => {
    try {
      const cfg = await adminAPI.backup.getSchedule()
      setScheduleForm({
        enabled: cfg.enabled,
        cron_expr: cfg.cron_expr || '0 2 * * *',
        retain_days: cfg.retain_days ?? 14,
        retain_count: cfg.retain_count ?? 10
      })
      const archive: BackupMonthlyArchiveConfig = {
        enabled: cfg.monthly_archive?.enabled ?? false,
        days: cfg.monthly_archive?.days ?? [1],
        include_month_end: cfg.monthly_archive?.include_month_end ?? false,
        retain_count: cfg.monthly_archive?.retain_count ?? 0
      }
      setArchiveForm(archive)
      setSavedArchive(cloneArchive(archive))
    } catch (error) {
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
    }
  }, [t])

  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
      stopPolling()
      stopRestorePolling()
    }
  }, [stopPolling, stopRestorePolling])

  useMountOnce(async () => {
    const [, , , items] = await Promise.all([loadS3Config(), loadImageStorageConfig(), loadSchedule(), loadBackups()])
    // 如果有正在 running 的备份，恢复轮询
    resumeActiveOperations(items)
  })

  const visibilityHandler = useRef<() => void>(() => {})
  useEffect(() => {
    visibilityHandler.current = () => {
      if (document.hidden) {
        stopPolling()
        stopRestorePolling()
      } else {
        // 标签页恢复时刷新列表，检查是否仍有活跃操作
        void loadBackups().then(resumeActiveOperations)
      }
    }
  }, [loadBackups, resumeActiveOperations, stopPolling, stopRestorePolling])
  useEffect(() => {
    const handler = () => visibilityHandler.current()
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  async function saveS3Config() {
    setSavingS3(true)
    try {
      await backupStepUp.run(() => adminAPI.backup.updateS3Config(s3Form))
      useAppStore.getState().showSuccess(t('admin.backup.s3.saved'))
      await loadS3Config()
    } catch (error) {
      if (isStepUpCancelled(error)) return
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
    } finally {
      setSavingS3(false)
    }
  }

  async function saveImageStorageConfig() {
    setSavingImageStorage(true)
    try {
      await backupStepUp.run(() => adminAPI.backup.updateImageStorageConfig(imageStorageForm))
      useAppStore.getState().showSuccess(t('admin.backup.imageStorage.saved'))
      await loadImageStorageConfig()
    } catch (error) {
      if (isStepUpCancelled(error)) return
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
    } finally {
      setSavingImageStorage(false)
    }
  }

  async function testImageStorage() {
    setTestingImageStorage(true)
    try {
      const result = await adminAPI.backup.testImageStorageConnection(imageStorageForm)
      if (result.ok) {
        useAppStore.getState().showSuccess(result.message || t('admin.backup.s3.testSuccess'))
      } else {
        useAppStore.getState().showError(result.message || t('admin.backup.s3.testFailed'))
      }
    } catch (error) {
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
    } finally {
      setTestingImageStorage(false)
    }
  }

  async function testS3() {
    setTestingS3(true)
    try {
      const result = await adminAPI.backup.testS3Connection(s3Form)
      if (result.ok) {
        useAppStore.getState().showSuccess(result.message || t('admin.backup.s3.testSuccess'))
      } else {
        useAppStore.getState().showError(result.message || t('admin.backup.s3.testFailed'))
      }
    } catch (error) {
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
    } finally {
      setTestingS3(false)
    }
  }

  async function saveSchedule() {
    if (scheduleValidationError) return
    setSavingSchedule(true)
    try {
      const archive = archivePayload
      await adminAPI.backup.updateSchedule({ ...scheduleForm, monthly_archive: archive })
      setSavedArchive(cloneArchive(archive))
      useAppStore.getState().showSuccess(t('admin.backup.schedule.saved'))
    } catch (error) {
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
    } finally {
      setSavingSchedule(false)
    }
  }

  async function createBackup() {
    setCreatingBackup(true)
    try {
      const record = await backupStepUp.run(() =>
        // 与 Vue 版 v-model.number 一致：清空时原样提交空值，由后端校验
        adminAPI.backup.createBackup({ expire_days: manualExpireDays as number })
      )
      // 插入到列表顶部
      setBackups((prev) => [record, ...prev])
      startPolling(record.id)
    } catch (error) {
      setCreatingBackup(false)
      if (isStepUpCancelled(error)) return
      if (reportStepUpBlocked(error)) return
      const err = error as { message?: string; response?: { status?: number } }
      if (err?.response?.status === 409) {
        useAppStore.getState().showWarning(t('admin.backup.operations.alreadyInProgress'))
      } else {
        useAppStore.getState().showError(err?.message || t('errors.networkError'))
      }
    }
  }

  async function downloadBackup(id: string) {
    try {
      const result = await backupStepUp.run(() => adminAPI.backup.getDownloadURL(id))
      if (result.parts && result.parts.length > 0) {
        setDownloadParts(result.parts)
        setDownloadPartsModalOpen(true)
        return
      }
      if (!result.url) {
        throw new Error(t('admin.backup.actions.downloadFailed'))
      }
      // 预签名 URL 带 attachment disposition，同页 anchor 导航直接触发下载；
      // 不用 window.open：step-up 弹窗 await 会耗尽瞬态用户激活，新标签页会被浏览器拦截。
      const link = document.createElement('a')
      link.href = result.url
      link.rel = 'noopener'
      link.click()
    } catch (error) {
      if (isStepUpCancelled(error)) return
      if (reportStepUpBlocked(error)) return
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
    }
  }

  function closeDownloadParts() {
    setDownloadPartsModalOpen(false)
    setDownloadParts([])
  }

  async function restoreBackup(id: string) {
    if (!window.confirm(t('admin.backup.actions.restoreConfirm'))) return
    const password = window.prompt(t('admin.backup.actions.restorePasswordPrompt'))
    if (!password) return
    setRestoringId(id)
    try {
      const record = await backupStepUp.run(() => adminAPI.backup.restoreBackup(id, password))
      updateRecordInList(record)
      startRestorePolling(id)
    } catch (error) {
      setRestoringId('')
      if (isStepUpCancelled(error)) return
      if (reportStepUpBlocked(error)) return
      // apiClient 拦截器把 HTTP 错误归一化为顶层 { status } 平面对象（无 response 字段）
      const err = error as { message?: string; status?: number; response?: { status?: number } }
      if (err?.status === 409 || err?.response?.status === 409) {
        useAppStore.getState().showWarning(t('admin.backup.operations.restoreRunning'))
      } else {
        useAppStore.getState().showError(err?.message || t('errors.networkError'))
      }
    }
  }

  async function removeBackup(id: string) {
    const archived = !!backups.find((record) => record.id === id)?.monthly_archive
    if (!window.confirm(t(archived ? 'admin.backup.archive.deleteConfirm' : 'admin.backup.actions.deleteConfirm'))) return
    try {
      await adminAPI.backup.deleteBackup(id, archived)
      useAppStore.getState().showSuccess(t('admin.backup.actions.deleted'))
      await loadBackups()
    } catch (error) {
      useAppStore.getState().showError(errorMessage(error, t('errors.networkError')))
    }
  }

  const patchS3 = (patch: Partial<BackupS3Config>) => setS3Form((prev) => ({ ...prev, ...patch }))
  const patchImage = (patch: Partial<ImageStorageConfig>) => setImageStorageForm((prev) => ({ ...prev, ...patch }))
  const patchSchedule = (patch: Partial<BackupScheduleConfig>) => setScheduleForm((prev) => ({ ...prev, ...patch }))

  return (
    <div className={s.stack}>
      {/* S3 Storage Config */}
      <SettingsRegion
        title={t('admin.backup.s3.title')}
        description={
          <>
            {t('admin.backup.s3.descriptionPrefix')}{' '}
            <button type="button" className={styles.linkButton} onClick={() => setShowR2Guide(true)}>
              Cloudflare R2
            </button>{' '}
            {t('admin.backup.s3.descriptionSuffix')}
          </>
        }
      >
        <div className={s.column}>
          <div className={s.grid2}>
            <Field label={t('admin.backup.s3.endpoint')}>
              <input
                className={s.input}
                value={s3Form.endpoint}
                placeholder="https://<account_id>.r2.cloudflarestorage.com"
                onChange={(e) => patchS3({ endpoint: e.target.value })}
              />
            </Field>
            <Field label={t('admin.backup.s3.region')}>
              <input className={s.input} value={s3Form.region} placeholder="auto" onChange={(e) => patchS3({ region: e.target.value })} />
            </Field>
            <Field label={t('admin.backup.s3.bucket')}>
              <input className={s.input} value={s3Form.bucket} onChange={(e) => patchS3({ bucket: e.target.value })} />
            </Field>
            <Field label={t('admin.backup.s3.prefix')}>
              <input className={s.input} value={s3Form.prefix} placeholder="backups/" onChange={(e) => patchS3({ prefix: e.target.value })} />
            </Field>
            <Field label={t('admin.backup.s3.accessKeyId')}>
              <input className={s.input} value={s3Form.access_key_id} onChange={(e) => patchS3({ access_key_id: e.target.value })} />
            </Field>
            <Field label={t('admin.backup.s3.secretAccessKey')}>
              <input
                type="password"
                className={s.input}
                value={s3Form.secret_access_key}
                placeholder={s3SecretConfigured ? t('admin.backup.s3.secretConfigured') : ''}
                onChange={(e) => patchS3({ secret_access_key: e.target.value })}
              />
            </Field>
            <label className={cx(s.checkboxLabel, s.full)}>
              <input
                type="checkbox"
                checked={s3Form.force_path_style}
                onChange={(e) => patchS3({ force_path_style: e.target.checked })}
              />
              {t('admin.backup.s3.forcePathStyle')}
            </label>
          </div>
          <div className={s.inline}>
            <Button type="button" variant="secondary" size="sm" disabled={testingS3} onClick={() => void testS3()}>
              {testingS3 ? t('common.loading') : t('admin.backup.s3.testConnection')}
            </Button>
            <Button type="button" size="sm" disabled={savingS3} onClick={() => void saveS3Config()}>
              {savingS3 ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </div>
      </SettingsRegion>

      {/* Async image object storage */}
      <SettingsRegion title={t('admin.backup.imageStorage.title')} description={t('admin.backup.imageStorage.description')}>
        <ToggleRow
          label={t('admin.backup.imageStorage.enabled')}
          checked={imageStorageForm.enabled}
          onChange={(enabled) => patchImage({ enabled })}
        />
        <div className={s.column}>
          <label className={s.checkboxLabel}>
            <input
              type="checkbox"
              checked={imageStorageForm.reuse_backup_s3}
              onChange={(e) => patchImage({ reuse_backup_s3: e.target.checked })}
            />
            {t('admin.backup.imageStorage.reuseBackupS3')}
          </label>
          <div className={s.grid2}>
            <Field label={t('admin.backup.imageStorage.bucket')}>
              <input
                className={s.input}
                value={imageStorageForm.bucket}
                placeholder={imageStorageForm.reuse_backup_s3 ? t('admin.backup.imageStorage.bucketInherited') : ''}
                onChange={(e) => patchImage({ bucket: e.target.value })}
              />
            </Field>
            <Field label={t('admin.backup.imageStorage.prefix')}>
              <input
                className={s.input}
                value={imageStorageForm.prefix}
                placeholder="images/"
                onChange={(e) => patchImage({ prefix: e.target.value })}
              />
            </Field>
            {!imageStorageForm.reuse_backup_s3 ? (
              <>
                <Field label={t('admin.backup.s3.endpoint')}>
                  <input
                    className={s.input}
                    value={imageStorageForm.endpoint}
                    placeholder="https://<account_id>.r2.cloudflarestorage.com"
                    onChange={(e) => patchImage({ endpoint: e.target.value })}
                  />
                </Field>
                <Field label={t('admin.backup.s3.region')}>
                  <input
                    className={s.input}
                    value={imageStorageForm.region}
                    placeholder="auto"
                    onChange={(e) => patchImage({ region: e.target.value })}
                  />
                </Field>
                <Field label={t('admin.backup.s3.accessKeyId')}>
                  <input
                    className={s.input}
                    value={imageStorageForm.access_key_id}
                    onChange={(e) => patchImage({ access_key_id: e.target.value })}
                  />
                </Field>
                <Field label={t('admin.backup.s3.secretAccessKey')}>
                  <input
                    type="password"
                    className={s.input}
                    value={imageStorageForm.secret_access_key}
                    placeholder={imageStorageSecretConfigured ? t('admin.backup.s3.secretConfigured') : ''}
                    onChange={(e) => patchImage({ secret_access_key: e.target.value })}
                  />
                </Field>
                <label className={cx(s.checkboxLabel, s.full)}>
                  <input
                    type="checkbox"
                    checked={imageStorageForm.force_path_style}
                    onChange={(e) => patchImage({ force_path_style: e.target.checked })}
                  />
                  {t('admin.backup.s3.forcePathStyle')}
                </label>
              </>
            ) : null}
            <Field label={t('admin.backup.imageStorage.publicBaseUrl')}>
              <input
                className={s.input}
                value={imageStorageForm.public_base_url}
                placeholder={t('admin.backup.imageStorage.publicBaseUrlPlaceholder')}
                onChange={(e) => patchImage({ public_base_url: e.target.value })}
              />
            </Field>
            <Field label={t('admin.backup.imageStorage.presignExpiryHours')}>
              <input
                type="number"
                min="1"
                className={s.input}
                value={imageStorageForm.presign_expiry_hours}
                onChange={(e) => patchImage({ presign_expiry_hours: numberInputValue(e.target.value) as number })}
              />
            </Field>
          </div>
          <div className={s.inline}>
            <Button type="button" variant="secondary" size="sm" disabled={testingImageStorage} onClick={() => void testImageStorage()}>
              {testingImageStorage ? t('common.loading') : t('admin.backup.s3.testConnection')}
            </Button>
            <Button type="button" size="sm" disabled={savingImageStorage} onClick={() => void saveImageStorageConfig()}>
              {savingImageStorage ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </div>
      </SettingsRegion>

      {/* Schedule Config */}
      <SettingsRegion
        data-testid="backup-schedule"
        title={t('admin.backup.schedule.title')}
        description={t('admin.backup.schedule.description')}
      >
        <ToggleRow
          label={t('admin.backup.schedule.enabled')}
          checked={scheduleForm.enabled}
          onChange={(enabled) => patchSchedule({ enabled })}
        />
        <div className={s.column}>
          <div className={s.grid2}>
            <Field label={t('admin.backup.schedule.cronExpr')} hint={t('admin.backup.schedule.cronHint')}>
              <input
                className={s.input}
                value={scheduleForm.cron_expr}
                placeholder="0 2 * * *"
                onChange={(e) => patchSchedule({ cron_expr: e.target.value })}
              />
            </Field>
          </div>
          <h4 className={cx(s.label, styles.subheading)}>{t('admin.backup.schedule.ordinaryRetention')}</h4>
          <div className={s.grid2}>
            <Field label={t('admin.backup.schedule.retainDays')} hint={t('admin.backup.schedule.retainDaysHint')}>
              <input
                type="number"
                min="0"
                step="1"
                data-testid="backup-retain-days"
                className={s.input}
                value={scheduleForm.retain_days}
                onChange={(e) => patchSchedule({ retain_days: numberInputValue(e.target.value) as number })}
              />
            </Field>
            <Field label={t('admin.backup.schedule.retainCount')} hint={t('admin.backup.schedule.retainCountHint')}>
              <input
                type="number"
                min="0"
                step="1"
                data-testid="backup-retain-count"
                className={s.input}
                value={scheduleForm.retain_count}
                onChange={(e) => patchSchedule({ retain_count: numberInputValue(e.target.value) as number })}
              />
            </Field>
          </div>
          <p className={s.hint}>{t('admin.backup.schedule.ordinaryHint')}</p>
          <BackupArchiveSettings value={archiveForm} onChange={setArchiveForm} />
          {scheduleValidationError ? (
            <p className={s.error} role="alert">
              {scheduleValidationError}
            </p>
          ) : null}
          <div className={styles.preview} aria-live="polite">
            <p className={s.label}>{t('admin.backup.schedule.preview')}</p>
            <p>{retentionPreview}</p>
          </div>
          <div>
            <Button
              type="button"
              size="sm"
              data-testid="backup-schedule-save"
              disabled={savingSchedule || !!scheduleValidationError}
              onClick={() => void saveSchedule()}
            >
              {savingSchedule ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </div>
      </SettingsRegion>

      {/* Backup Operations */}
      <SettingsRegion
        title={t('admin.backup.operations.title')}
        description={t('admin.backup.operations.description')}
        actions={
          <>
            <label className={s.inline}>
              <span className={s.hint}>{t('admin.backup.operations.expireDays')}</span>
              <input
                type="number"
                min="0"
                className={cx(s.input, styles.expireInput)}
                value={manualExpireDays}
                onChange={(e) => setManualExpireDays(numberInputValue(e.target.value))}
              />
            </label>
            <Button type="button" size="sm" disabled={creatingBackup} onClick={() => void createBackup()}>
              {creatingBackup ? t('admin.backup.operations.backing') : t('admin.backup.operations.createBackup')}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={loadingBackups} onClick={() => void loadBackups()}>
              {loadingBackups ? t('common.loading') : t('common.refresh')}
            </Button>
          </>
        }
      >
        <div className={s.flush}>
          <div className={styles.tableScroll}>
            <table className={cx(s.table, styles.table)}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>{t('admin.backup.columns.status')}</th>
                  <th>{t('admin.backup.columns.fileName')}</th>
                  <th>{t('admin.backup.columns.size')}</th>
                  <th>{t('admin.backup.columns.parts')}</th>
                  <th>{t('admin.backup.columns.expiresAt')}</th>
                  <th>{t('admin.backup.columns.triggeredBy')}</th>
                  <th>{t('admin.backup.columns.startedAt')}</th>
                  <th>{t('admin.backup.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((record) => (
                  <tr key={record.id}>
                    <td className={s.mono}>{record.id}</td>
                    <td>
                      <Badge tone={statusTone(record.status)} size="sm">
                        {record.status === 'running' && record.progress
                          ? t(`admin.backup.progress.${record.progress}`)
                          : t(`admin.backup.status.${record.status}`)}
                      </Badge>
                    </td>
                    <td className={styles.small}>
                      {record.file_name}
                      {record.monthly_archive ? (
                        <>
                          {' '}
                          <Badge tone="info" size="sm">
                            {t('admin.backup.archive.badge')}
                          </Badge>
                          <div className={s.hint}>{record.monthly_archive.dates.join(' / ')}</div>
                        </>
                      ) : null}
                    </td>
                    <td className={styles.small}>{formatSize(record.size_bytes)}</td>
                    <td className={styles.small}>{record.parts?.length || (record.status === 'running' ? '-' : 1)}</td>
                    <td className={styles.small}>
                      {record.monthly_archive
                        ? record.monthly_archive.retain_count === 0
                          ? t('admin.backup.archive.forever')
                          : t('admin.backup.archive.retainLatest', { count: record.monthly_archive.retain_count })
                        : record.expires_at
                          ? formatDate(record.expires_at)
                          : t('admin.backup.neverExpire')}
                    </td>
                    <td className={styles.small}>
                      {record.triggered_by === 'scheduled' ? t('admin.backup.trigger.scheduled') : t('admin.backup.trigger.manual')}
                    </td>
                    <td className={styles.small}>{formatDate(record.started_at)}</td>
                    <td>
                      <div className={s.inline}>
                        {record.status === 'completed' ? (
                          <Button type="button" variant="secondary" size="sm" onClick={() => void downloadBackup(record.id)}>
                            {t('admin.backup.actions.download')}
                          </Button>
                        ) : null}
                        {record.status === 'completed' ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={restoringId === record.id}
                            onClick={() => void restoreBackup(record.id)}
                          >
                            {restoringId === record.id ? t('common.loading') : t('admin.backup.actions.restore')}
                          </Button>
                        ) : null}
                        {record.status !== 'running' ? (
                          <Button type="button" variant="danger" size="sm" onClick={() => void removeBackup(record.id)}>
                            {t('common.delete')}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {backups.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.empty}>
                      {t('admin.backup.empty')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </SettingsRegion>

      {/* Cloudflare R2 Setup Guide Modal */}
      <BaseDialog
        show={showR2Guide}
        title={t('admin.backup.r2Guide.title')}
        description={t('admin.backup.r2Guide.intro')}
        width="wide"
        closeOnClickOutside
        onClose={() => setShowR2Guide(false)}
        footer={
          <Button type="button" size="sm" onClick={() => setShowR2Guide(false)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={styles.guide}>
          {[
            { step: 1, lines: ['line1', 'line2', 'line3'] },
            { step: 2, lines: ['line1', 'line2', 'line3', 'line4'] }
          ].map(({ step, lines }) => (
            <section key={step} className={styles.guideStep}>
              <h3 className={styles.guideTitle}>
                <span className={styles.stepNumber}>{step}</span>
                {t(`admin.backup.r2Guide.step${step}.title`)}
              </h3>
              <ol className={styles.guideList}>
                {lines.map((line) => (
                  <li key={line}>{t(`admin.backup.r2Guide.step${step}.${line}`)}</li>
                ))}
              </ol>
              {step === 2 ? (
                <Notice tone="warning">
                  <p>{t('admin.backup.r2Guide.step2.warning')}</p>
                </Notice>
              ) : null}
            </section>
          ))}
          <section className={styles.guideStep}>
            <h3 className={styles.guideTitle}>
              <span className={styles.stepNumber}>3</span>
              {t('admin.backup.r2Guide.step3.title')}
            </h3>
            <p className={styles.guideText}>{t('admin.backup.r2Guide.step3.desc')}</p>
            <code className={s.codeBlock}>{`https://<${t('admin.backup.r2Guide.step3.accountId')}>.r2.cloudflarestorage.com`}</code>
          </section>
          <section className={styles.guideStep}>
            <h3 className={styles.guideTitle}>
              <span className={styles.stepNumber}>4</span>
              {t('admin.backup.r2Guide.step4.title')}
            </h3>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <tbody>
                  {r2ConfigRows.map((row, i) => (
                    <tr key={i}>
                      <th scope="row">{row.field}</th>
                      <td>
                        <code className={s.code}>{row.value}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <Notice tone="success">
            <p>{t('admin.backup.r2Guide.freeTier')}</p>
          </Notice>
        </div>
      </BaseDialog>

      {/* 分卷下载链接 */}
      <BaseDialog
        show={downloadPartsModalOpen}
        title={t('admin.backup.actions.downloadParts')}
        description={t('admin.backup.actions.downloadPartsHint')}
        closeOnClickOutside
        onClose={closeDownloadParts}
        footer={
          <Button type="button" size="sm" onClick={closeDownloadParts}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={s.columnTight}>
          {downloadParts.map((part) => (
            <div key={part.index} className={styles.part}>
              <span>
                {t('admin.backup.actions.partLabel', { index: part.index })}
                <span className={cx(s.hint, styles.partSize)}>{formatSize(part.size_bytes)}</span>
              </span>
              <a href={part.url} className={styles.partLink} rel="noopener">
                {t('admin.backup.actions.download')}
              </a>
            </div>
          ))}
        </div>
      </BaseDialog>
      <TotpStepUpDialog controller={backupStepUp} />
    </div>
  )
}
