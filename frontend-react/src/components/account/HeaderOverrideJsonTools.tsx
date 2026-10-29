import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/arc/button/button'
import { useClipboard } from '@/composables/useClipboard'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './AccountForm.module.css'
import own from './HeaderOverrideJsonTools.module.css'
import { parseHeaderOverridesJson, serializeHeaderOverrideRows, type HeaderOverrideRow } from './credentialsBuilder'

export interface HeaderOverrideJsonToolsProps {
  rows: HeaderOverrideRow[]
  /** Vue 版 update:rows */
  onChange: (rows: HeaderOverrideRow[]) => void
}

// JSON 示例语言中立，且花括号会被 vue-i18n 消息编译器当作插值占位符解析
// 导致渲染时抛 SyntaxError，因此不走 i18n。
const IMPORT_JSON_PLACEHOLDER = '{"user-agent": "my-client/1.0", "x-relay-token": "..."}'

/** 请求头覆盖的 JSON 导入 / 复制工具（渲染为片段，由父级的换行行容器排布） */
export default function HeaderOverrideJsonTools({ rows, onChange }: HeaderOverrideJsonToolsProps) {
  const { t } = useI18n()
  const { copyToClipboard } = useClipboard()
  const [showImportPanel, setShowImportPanel] = useState(false)
  const [importText, setImportText] = useState('')
  const importPanelRef = useRef<HTMLDivElement>(null)
  const importTextareaRef = useRef<HTMLTextAreaElement>(null)

  const hasNamedRows = rows.some((row) => row.name.trim())

  // 面板在抽屉滚动容器内向下展开，可能落在当前视野之外，
  // 打开后必须主动滚入视野，否则看起来像点击无效。
  useEffect(() => {
    if (!showImportPanel) return
    importPanelRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    importTextareaRef.current?.focus({ preventScroll: true })
  }, [showImportPanel])

  const closeImportPanel = () => {
    setShowImportPanel(false)
    setImportText('')
  }

  const applyImport = () => {
    const parsed = parseHeaderOverridesJson(importText)
    if (parsed === null) {
      useAppStore.getState().showError(t('admin.accounts.headerOverride.importJsonInvalid'))
      return
    }
    onChange(parsed)
    closeImportPanel()
  }

  const copyAsJson = () => {
    void copyToClipboard(serializeHeaderOverrideRows(rows))
  }

  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setShowImportPanel((v) => !v)}>
        {t('admin.accounts.headerOverride.importJson')}
      </Button>
      <Button type="button" size="sm" variant="secondary" disabled={!hasNamedRows} onClick={copyAsJson}>
        {t('admin.accounts.headerOverride.copyJson')}
      </Button>

      {showImportPanel ? (
        <div ref={importPanelRef} className={own.panel}>
          <textarea
            ref={importTextareaRef}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={5}
            className={`${styles.textarea} ${styles.mono}`}
            placeholder={IMPORT_JSON_PLACEHOLDER}
          />
          <div className={styles.row}>
            <Button type="button" size="sm" onClick={applyImport}>
              {t('admin.accounts.headerOverride.importJsonApply')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={closeImportPanel}>
              {t('admin.accounts.headerOverride.importJsonCancel')}
            </Button>
          </div>
          <p className={styles.hint}>{t('admin.accounts.headerOverride.importJsonHint')}</p>
        </div>
      ) : null}
    </>
  )
}
