/**
 * 账号数据导入弹窗，对应 Vue 版 ImportDataModal.vue。
 * 支持多选或拖入多个 JSON 文件，逐文件校验类型与版本后合并为一个 payload 提交。
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminDataImportResult, AdminDataPayload } from '@/types'
import styles from './ImportDataModal.module.css'

export interface ImportDataModalProps {
  show: boolean
  onClose: () => void
  onImported: () => void
}

const SUPPORTED_DATA_TYPES = ['sub2api-data', 'sub2api-bundle']
const SUPPORTED_DATA_VERSION = 1

const isJsonFile = (sourceFile: File) => {
  const name = sourceFile.name.toLowerCase()
  return name.endsWith('.json') || sourceFile.type === 'application/json'
}

const readFileAsText = async (sourceFile: File): Promise<string> => {
  if (typeof sourceFile.text === 'function') {
    return sourceFile.text()
  }

  if (typeof sourceFile.arrayBuffer === 'function') {
    const buffer = await sourceFile.arrayBuffer()
    return new TextDecoder().decode(buffer)
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsText(sourceFile)
  })
}

// 与后端 validateDataHeader 对齐:合并前逐文件校验,避免坏文件混入合并 payload 后
// 报错无法定位来源,或绕过后端本会对单文件做的 type/version 检查。
const isValidDataPayload = (payload: unknown): payload is AdminDataPayload => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const candidate = payload as Record<string, unknown>
  if (candidate.type !== undefined && candidate.type !== '' && !SUPPORTED_DATA_TYPES.includes(candidate.type as string)) {
    return false
  }
  if (candidate.version !== undefined && candidate.version !== 0 && candidate.version !== SUPPORTED_DATA_VERSION) {
    return false
  }
  return Array.isArray(candidate.proxies) && Array.isArray(candidate.accounts)
}

const mergeDataPayloads = (payloads: AdminDataPayload[]): AdminDataPayload => {
  const [firstPayload] = payloads
  if (payloads.length === 1 && firstPayload) return firstPayload

  return {
    type: payloads.find((item) => typeof item.type === 'string')?.type,
    version: payloads.find((item) => typeof item.version === 'number')?.version,
    exported_at: new Date().toISOString(),
    proxies: payloads.flatMap((item) => item.proxies),
    accounts: payloads.flatMap((item) => item.accounts),
    skipped_shadows: payloads.reduce((sum, item) => {
      const count = Number(item.skipped_shadows || 0)
      return Number.isFinite(count) ? sum + count : sum
    }, 0)
  }
}

export default function ImportDataModal({ show, onClose, onImported }: ImportDataModalProps) {
  const { t } = useI18n()

  const [importing, setImportingState] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [dragDepth, setDragDepth] = useState(0)
  const [result, setResult] = useState<AdminDataImportResult | null>(null)
  const importingRef = useRef(false)
  const hasCreatedData = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const formId = 'import-data-form'

  const dragActive = dragDepth > 0
  const setImporting = (value: boolean) => {
    importingRef.current = value
    setImportingState(value)
  }

  const selectedFilesLabel =
    files.length === 0 ? '' : files.length === 1 ? files[0]?.name || '' : t('admin.accounts.selectedCount', { count: files.length })
  const fileListTitle = files.map((item) => item.name).join(', ')
  const errorItems = result?.errors || []

  useEffect(() => {
    if (!show) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 watch(show) 一致：每次打开时重置表单
    setFiles([])
    setDragDepth(0)
    hasCreatedData.current = false
    setResult(null)
    if (fileInput.current) {
      fileInput.current.value = ''
    }
  }, [show])

  const openFilePicker = () => {
    fileInput.current?.click()
  }

  const setSelectedFiles = (sourceFiles: FileList | File[] | null | undefined) => {
    if (importingRef.current) return
    const appStore = useAppStore.getState()
    const incoming = Array.from(sourceFiles || [])
    const picked = incoming.filter(isJsonFile)
    if (!picked.length) {
      appStore.showError(t('admin.accounts.dataImportSelectFile'))
      return
    }
    if (picked.length < incoming.length) {
      appStore.showWarning(t('admin.accounts.dataImportIgnoredFiles', { count: incoming.length - picked.length }))
    }
    setFiles(picked)
    setResult(null)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const target = event.target
    setSelectedFiles(target.files)
    target.value = ''
  }

  const handleClose = () => {
    if (importingRef.current) return
    if (hasCreatedData.current) {
      hasCreatedData.current = false
      onImported()
    }
    onClose()
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (importingRef.current) return
    setDragDepth((depth) => depth + 1)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragDepth((depth) => Math.max(0, depth - 1))
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragDepth(0)
    if (importingRef.current) return
    setSelectedFiles(event.dataTransfer?.files)
  }

  const handleImport = async (event?: FormEvent) => {
    event?.preventDefault()
    const appStore = useAppStore.getState()
    if (files.length === 0) {
      appStore.showError(t('admin.accounts.dataImportSelectFile'))
      return
    }

    setImporting(true)
    try {
      const dataPayloads: AdminDataPayload[] = []
      for (const sourceFile of files) {
        let parsed: unknown
        try {
          parsed = JSON.parse(await readFileAsText(sourceFile))
        } catch {
          appStore.showError(t('admin.accounts.dataImportParseFailedFile', { name: sourceFile.name }))
          return
        }
        if (!isValidDataPayload(parsed)) {
          appStore.showError(t('admin.accounts.dataImportInvalidFile', { name: sourceFile.name }))
          return
        }
        dataPayloads.push(parsed)
      }
      const dataPayload = mergeDataPayloads(dataPayloads)

      const res = await adminAPI.accounts.importData({
        data: dataPayload,
        skip_default_group_bind: true
      })

      setResult(res)

      const msgParams: Record<string, unknown> = {
        account_created: res.account_created,
        account_failed: res.account_failed,
        proxy_created: res.proxy_created,
        proxy_reused: res.proxy_reused,
        proxy_failed: res.proxy_failed
      }
      if (res.account_failed > 0 || res.proxy_failed > 0) {
        // 部分成功也创建了数据;弹窗关闭时通过 imported 通知父组件刷新列表
        if (res.account_created > 0 || res.proxy_created > 0) {
          hasCreatedData.current = true
        }
        appStore.showError(t('admin.accounts.dataImportCompletedWithErrors', msgParams))
      } else {
        appStore.showSuccess(t('admin.accounts.dataImportSuccess', msgParams))
        onImported()
      }
    } catch (error: any) {
      appStore.showError(error?.message || t('admin.accounts.dataImportFailed'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <BaseDialog
      show={show}
      title={t('admin.accounts.dataImportTitle')}
      width="normal"
      closeOnClickOutside
      onClose={handleClose}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" disabled={importing} onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={importing}>
            {importing ? t('admin.accounts.dataImporting') : t('admin.accounts.dataImportButton')}
          </Button>
        </div>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(event) => void handleImport(event)}>
        <div className={styles.hint}>{t('admin.accounts.dataImportHint')}</div>
        <div className={styles.warning}>{t('admin.accounts.dataImportWarning')}</div>

        <div>
          <span className={styles.label}>{t('admin.accounts.dataImportFile')}</span>
          <div
            className={styles.dropzone}
            data-active={dragActive ? 'true' : 'false'}
            data-testid="import-dropzone"
            onDragEnter={handleDragEnter}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className={styles.fileInfo}>
              <div className={styles.fileName} title={fileListTitle}>
                {selectedFilesLabel || t('admin.accounts.dataImportSelectFile')}
              </div>
              <div className={styles.fileMeta}>
                JSON (.json)
                {files.length > 1 ? <span> · {fileListTitle}</span> : null}
              </div>
            </div>
            <Button type="button" variant="secondary" onClick={openFilePicker}>
              {t('common.chooseFile')}
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            className={styles.hidden}
            accept="application/json,.json"
            multiple
            data-testid="import-file-input"
            onChange={handleFileChange}
          />
        </div>

        {result ? (
          <div className={styles.result}>
            <div className={styles.resultTitle}>{t('admin.accounts.dataImportResult')}</div>
            <div className={styles.resultSummary}>
              {t('admin.accounts.dataImportResultSummary', result as unknown as Record<string, unknown>)}
            </div>

            {errorItems.length ? (
              <div className={styles.errors}>
                <div className={styles.errorsTitle}>{t('admin.accounts.dataImportErrors')}</div>
                <div className={styles.errorList}>
                  {errorItems.map((item, idx) => (
                    <div key={idx} className={styles.errorItem}>
                      {item.kind} {item.name || item.proxy_key || '-'} — {item.message}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
    </BaseDialog>
  )
}
