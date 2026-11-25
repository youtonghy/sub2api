import { useLayoutEffect, useMemo, useRef } from 'react'
import { AlertCircle, Lock, Plus, ScanFace, Trash2 } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import styles from './AccountForm.module.css'
import editorStyles from './HeaderOverrideEditor.module.css'
import {
  HEADER_OVERRIDE_VARIABLES,
  HEADER_OVERRIDE_VARIABLE_SUGGESTED_NAMES,
  getHeaderOverrideRowErrors,
  headerOverrideHasVariable,
  headerOverrideVariableToken,
  parseHeaderOverrideTemplate,
  type HeaderOverrideRow,
  type HeaderOverrideRowError,
  type HeaderOverrideVariable
} from './credentialsBuilder'
import HeaderOverrideJsonTools from './HeaderOverrideJsonTools'

export interface HeaderOverrideEditorProps {
  rows: HeaderOverrideRow[]
  /** Vue 版 update:rows */
  onChange: (rows: HeaderOverrideRow[]) => void
  /** 账号是否允许使用身份上报变量（仅 api_key 账号） */
  allowVariables?: boolean
}

const VARIABLE_NOTES = ['unresolved', 'apiKeyOnly', 'websocket'] as const

/** 预览用的示例值：只为让管理员看清最终形态，不代表真实数据 */
const VARIABLE_SAMPLES: Record<HeaderOverrideVariable, string> = {
  user_id: '10086',
  api_key_id: '2048',
  group_id: '3',
  request_id: '6f1c2d3e-8a4b-4c5d-9e0f-a1b2c3d4e5f6'
}

const NAME_ERRORS: ReadonlySet<HeaderOverrideRowError> = new Set(['invalidName', 'blockedName', 'duplicateName'])

interface PreviewPart {
  text: string
  variable?: HeaderOverrideVariable
}

/** 请求头覆盖编辑器：逐行编辑名称 / 值，支持身份上报变量，附 JSON 导入与复制 */
export default function HeaderOverrideEditor({ rows, onChange, allowVariables = true }: HeaderOverrideEditorProps) {
  const { t } = useI18n()

  // 当前聚焦的值输入框（按行号）。变量按钮用 mousedown.preventDefault 保住焦点，
  // 因此"点击时焦点仍在某个值输入框"就等价于"用户想插到这里"。
  const valueInputs = useRef(new Map<number, HTMLInputElement>())
  const focusedValueIndex = useRef<number | null>(null)
  const pendingCaret = useRef<{ index: number; caret: number } | null>(null)

  useLayoutEffect(() => {
    const pending = pendingCaret.current
    if (!pending) return
    pendingCaret.current = null
    const input = valueInputs.current.get(pending.index)
    if (input?.isConnected) input.setSelectionRange(pending.caret, pending.caret)
  })

  // 行内只提示已填写名称的行：先填值后填名是正常的输入顺序，不该中途报错
  // （保存时的整体校验仍会拦截"有值无名"）。
  const rowErrors = useMemo(
    () =>
      getHeaderOverrideRowErrors(rows, { allowVariables }).map((error, index) =>
        rows[index].name.trim() ? error : null
      ),
    [rows, allowVariables]
  )

  /** 含变量的行给出"发送示例"，让替换结果一目了然 */
  const rowPreviews = useMemo<Array<PreviewPart[] | null>>(
    () =>
      rows.map((row) => {
        const value = row.value.trim()
        if (!row.name.trim() || !headerOverrideHasVariable(value)) return null
        const parts = parseHeaderOverrideTemplate(value)
        if (!parts) return null
        return parts.map((part) =>
          part.kind === 'variable' ? { text: VARIABLE_SAMPLES[part.name], variable: part.name } : { text: part.text }
        )
      }),
    [rows]
  )

  const addRow = () => {
    onChange([...rows, { name: '', value: '' }])
  }

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index))
  }

  const updateRow = (index: number, patch: Partial<HeaderOverrideRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const insertVariable = (variable: HeaderOverrideVariable) => {
    const token = headerOverrideVariableToken(variable)
    const index = focusedValueIndex.current
    const input = index === null ? undefined : valueInputs.current.get(index)
    if (index === null || !input || document.activeElement !== input || index >= rows.length) {
      // 没有正在编辑的值输入框：新增一行，带上建议的请求头名。
      // 建议名已被占用时：同值视为已添加（连点不产生重名行），否则留空名称由管理员自行命名。
      const suggested = HEADER_OVERRIDE_VARIABLE_SUGGESTED_NAMES[variable]
      const existing = rows.find((item) => item.name.trim().toLowerCase() === suggested)
      if (existing?.value.trim() === token) return
      onChange([...rows, { name: existing ? '' : suggested, value: token }])
      return
    }
    const row = rows[index]
    const current = row.value
    const start = Math.min(input.selectionStart ?? current.length, current.length)
    const end = Math.min(input.selectionEnd ?? current.length, current.length)
    pendingCaret.current = { index, caret: start + token.length }
    updateRow(index, {
      value: current.slice(0, start) + token + current.slice(end),
      ...(row.name.trim() ? {} : { name: HEADER_OVERRIDE_VARIABLE_SUGGESTED_NAMES[variable] })
    })
  }

  return (
    <>
      {rows.length > 0 ? (
        <div className={styles.editRows}>
          {rows.map((row, index) => {
            const error = rowErrors[index]
            const preview = rowPreviews[index]
            const nameError = error !== null && NAME_ERRORS.has(error)
            const valueError = error !== null && !NAME_ERRORS.has(error)
            return (
              // 受控输入、无内部状态：按位置作 key，编辑时替换行对象也不会丢失焦点
              <div key={index} className={editorStyles.rowBlock}>
                <div className={styles.editRow}>
                  <input
                    type="text"
                    className={styles.input}
                    value={row.name}
                    onChange={(e) => updateRow(index, { name: e.target.value })}
                    placeholder={t('admin.accounts.headerOverride.namePlaceholder')}
                    aria-invalid={nameError}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <input
                    ref={(el) => {
                      if (el) valueInputs.current.set(index, el)
                      else valueInputs.current.delete(index)
                    }}
                    type="text"
                    className={[styles.input, headerOverrideHasVariable(row.value) ? editorStyles.valueMono : '']
                      .filter(Boolean)
                      .join(' ')}
                    value={row.value}
                    onChange={(e) => updateRow(index, { value: e.target.value })}
                    onFocus={() => {
                      focusedValueIndex.current = index
                    }}
                    placeholder={t('admin.accounts.headerOverride.valuePlaceholder')}
                    aria-invalid={valueError}
                    spellCheck={false}
                    autoComplete="off"
                    data-testid="header-override-value"
                  />
                  <button
                    type="button"
                    className={styles.iconButton}
                    data-tone="danger"
                    aria-label={t('admin.accounts.headerOverride.removeRow')}
                    title={t('admin.accounts.headerOverride.removeRow')}
                    onClick={() => removeRow(index)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                {error ? (
                  <p className={editorStyles.rowMessage} data-tone="danger" data-testid="header-override-row-error">
                    <AlertCircle size={14} aria-hidden="true" />
                    <span>{t(`admin.accounts.headerOverride.${error}`)}</span>
                  </p>
                ) : preview ? (
                  <p className={editorStyles.rowMessage} data-tone="muted" data-testid="header-override-row-preview">
                    <span>{t('admin.accounts.headerOverride.previewLabel')}</span>
                    <code className={editorStyles.preview}>
                      <span className={editorStyles.previewName}>{row.name.trim().toLowerCase()}: </span>
                      {preview.map((part, partIndex) =>
                        part.variable ? (
                          <span
                            key={partIndex}
                            className={editorStyles.previewVariable}
                            title={t(`admin.accounts.headerOverride.variables.${part.variable}.label`)}
                          >
                            {part.text}
                          </span>
                        ) : (
                          <span key={partIndex}>{part.text}</span>
                        )
                      )}
                    </code>
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <Button type="button" variant="secondary" onClick={addRow}>
        <Plus size={16} aria-hidden="true" />
        {t('admin.accounts.headerOverride.addRow')}
      </Button>

      {allowVariables ? (
        <div className={editorStyles.variables} data-testid="header-override-variables">
          <p className={editorStyles.variablesTitle}>
            <ScanFace size={16} aria-hidden="true" />
            {t('admin.accounts.headerOverride.variablesTitle')}
          </p>
          <p className={styles.hint}>{t('admin.accounts.headerOverride.variablesHint')}</p>
          <div className={editorStyles.variableGrid}>
            {HEADER_OVERRIDE_VARIABLES.map((variable) => (
              <button
                key={variable}
                type="button"
                className={editorStyles.variableButton}
                data-testid={`header-override-variable-${variable}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertVariable(variable)}
              >
                <span className={editorStyles.variableHead}>
                  <code className={editorStyles.variableToken}>{headerOverrideVariableToken(variable)}</code>
                  {t(`admin.accounts.headerOverride.variables.${variable}.label`)}
                </span>
                <span className={editorStyles.variableDesc}>
                  {t(`admin.accounts.headerOverride.variables.${variable}.desc`)}
                </span>
              </button>
            ))}
          </div>
          <ul className={editorStyles.notes}>
            {VARIABLE_NOTES.map((note) => (
              <li key={note}>{t(`admin.accounts.headerOverride.variableNotes.${note}`)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={editorStyles.unavailable} data-testid="header-override-variables-unavailable">
          <Lock size={14} aria-hidden="true" />
          <span>{t('admin.accounts.headerOverride.variablesUnavailable')}</span>
        </p>
      )}

      <div className={styles.row}>
        <HeaderOverrideJsonTools rows={rows} onChange={onChange} />
      </div>

      <p className={styles.hint}>{t('admin.accounts.headerOverride.emptyValueHint')}</p>
    </>
  )
}
