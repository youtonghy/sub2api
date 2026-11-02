/**
 * 代理数据导入弹窗，对应 Vue 版 components/admin/proxy/ImportDataModal.vue。
 * 选择一个 JSON 文件提交到 adminAPI.proxies.importData；部分失败时保留弹窗并在关闭时通知父组件刷新。
 */
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'

import { adminAPI } from '@/api/admin'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminDataImportResult } from '@/types'
import styles from './ImportDataModal.module.css'

export interface ImportDataModalProps {
  show: boolean
  onClose: () => void
  onImported: () => void
}

export default function ImportDataModal({ show, onClose, onImported }: ImportDataModalProps) {
  const { t } = useI18n()

  const [importing, setImportingState] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<AdminDataImportResult | null>(null)
  const importingRef = useRef(false)
  const hasImportedData = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const formId = 'import-proxy-data-form'

  const setImporting = (value: boolean) => {
    importingRef.current = value
    setImportingState(value)
  }

  const fileName = file?.name || ''
  const errorItems = result?.errors || []

  useEffect(() => {
    if (!show) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 watch(show) 一致：每次打开时重置表单
    setFile(null)
    hasImportedData.current = false
    setResult(null)
    if (fileInput.current) {
      fileInput.current.value = ''
    }
  }, [show])

  const openFilePicker = () => {
    fileInput.current?.click()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] || null)
  }

  const handleClose = () => {
    if (importingRef.current) return
    if (hasImportedData.current) {
      hasImportedData.current = false
      onImported()
    }
    onClose()
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
      reader.onerror = () => reject(reader.error || new Error(t('common.fileReadFailed')))
      reader.readAsText(sourceFile)
    })
  }

  const handleImport = async (event?: FormEvent) => {
    event?.preventDefault()
    const appStore = useAppStore.getState()
    if (!file) {
      appStore.showError(t('admin.proxies.dataImportSelectFile'))
      return
    }

    setImporting(true)
    try {
      const text = await readFileAsText(file)
      const dataPayload = JSON.parse(text)

      const res = await adminAPI.proxies.importData({ data: dataPayload })

      setResult(res)

      const msgParams: Record<string, unknown> = {
        proxy_created: res.proxy_created,
        proxy_reused: res.proxy_reused,
        proxy_failed: res.proxy_failed
      }

      if (res.proxy_failed > 0) {
        hasImportedData.current ||= res.proxy_created > 0 || res.proxy_reused > 0
        appStore.showError(t('admin.proxies.dataImportCompletedWithErrors', msgParams))
      } else {
        hasImportedData.current = false
        appStore.showSuccess(t('admin.proxies.dataImportSuccess', msgParams))
        onImported()
      }
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        appStore.showError(t('admin.proxies.dataImportParseFailed'))
      } else {
        appStore.showError(error?.message || t('admin.proxies.dataImportFailed'))
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <BaseDialog
      show={show}
      title={t('admin.proxies.dataImportTitle')}
      width="normal"
      closeOnClickOutside
      onClose={handleClose}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" disabled={importing} onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={importing}>
            {importing ? t('admin.proxies.dataImporting') : t('admin.proxies.dataImportButton')}
          </Button>
        </div>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(event) => void handleImport(event)}>
        <div className={styles.hint}>{t('admin.proxies.dataImportHint')}</div>
        <div className={styles.warning}>{t('admin.proxies.dataImportWarning')}</div>

        <div>
          <span className={styles.label}>{t('admin.proxies.dataImportFile')}</span>
          <div className={styles.dropzone}>
            <div className={styles.fileInfo}>
              <div className={styles.fileName}>{fileName || t('admin.proxies.dataImportSelectFile')}</div>
              <div className={styles.fileMeta}>JSON (.json)</div>
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
            data-testid="proxy-import-file-input"
            onChange={handleFileChange}
          />
        </div>

        {result ? (
          <div className={styles.result}>
            <div className={styles.resultTitle}>{t('admin.proxies.dataImportResult')}</div>
            <div className={styles.resultSummary}>
              {t('admin.proxies.dataImportResultSummary', result as unknown as Record<string, unknown>)}
            </div>

            {errorItems.length ? (
              <div className={styles.errors}>
                <div className={styles.errorsTitle}>{t('admin.proxies.dataImportErrors')}</div>
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
