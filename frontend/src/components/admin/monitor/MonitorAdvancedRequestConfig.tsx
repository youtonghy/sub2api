/**
 * 监控请求的高级设置，对应 Vue 版 MonitorAdvancedRequestConfig.vue：
 * 自定义请求头（键值行，失焦提交）、请求体覆盖模式（关闭 / 合并 / 替换）与 JSON 请求体（失焦校验提交，可格式化）。
 * v-model:extraHeaders / bodyOverrideMode / bodyOverride 对应受控值 + onXChange。
 */
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

import type { APIMode, BodyOverrideMode, Provider } from '@/api/admin/channelMonitor'
import { FormField } from '@/components/account/AccountFormLayout'
import arcInput from '@/components/arc/input/input.module.css'
import { API_MODE_RESPONSES, DEFAULT_GROK_MODEL, PROVIDER_GROK, PROVIDER_OPENAI } from '@/constants/channelMonitor'
import { useI18n } from '@/i18n/useI18n'
import monitor from './monitor.module.css'
import styles from './MonitorAdvancedRequestConfig.module.css'

export interface MonitorAdvancedRequestConfigProps {
  provider?: Provider
  apiMode?: APIMode
  extraHeaders: Record<string, string>
  bodyOverrideMode: BodyOverrideMode
  bodyOverride: Record<string, unknown> | null
  onExtraHeadersChange?: (value: Record<string, string>) => void
  onBodyOverrideModeChange?: (value: BodyOverrideMode) => void
  onBodyOverrideChange?: (value: Record<string, unknown> | null) => void
}

// ---- Headers key-value rows ----
interface HeaderRow {
  name: string
  value: string
}

function toRows(h: Record<string, string>): HeaderRow[] {
  const entries = Object.entries(h || {})
  if (entries.length === 0) return [{ name: '', value: '' }]
  return entries.map(([name, value]) => ({ name, value }))
}

function toMap(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name === '') continue
    out[name] = row.value
  }
  return out
}

function isSameHeaderMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b || {})
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (a[k] !== b[k]) return false
  }
  return true
}

function serializeBody(body: Record<string, unknown> | null): string {
  if (!body || Object.keys(body).length === 0) return ''
  return JSON.stringify(body, null, 2)
}

export default function MonitorAdvancedRequestConfig({
  provider,
  apiMode,
  extraHeaders,
  bodyOverrideMode,
  bodyOverride,
  onExtraHeadersChange,
  onBodyOverrideModeChange,
  onBodyOverrideChange
}: MonitorAdvancedRequestConfigProps) {
  const { t } = useI18n()

  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => toRows(extraHeaders))
  const [headersError, setHeadersError] = useState('')
  const [bodyText, setBodyText] = useState(() => serializeBody(bodyOverride))
  const [bodyError, setBodyError] = useState('')

  // 外部重置时（切换平台 / 应用模板）同步行。同值不回写，避免每次 commit 都把行重排。
  const [lastHeaders, setLastHeaders] = useState(extraHeaders)
  if (lastHeaders !== extraHeaders) {
    setLastHeaders(extraHeaders)
    if (!isSameHeaderMap(toMap(headerRows), extraHeaders)) setHeaderRows(toRows(extraHeaders))
    setHeadersError('')
  }

  const [lastBody, setLastBody] = useState(bodyOverride)
  if (lastBody !== bodyOverride) {
    setLastBody(bodyOverride)
    setBodyText(serializeBody(bodyOverride))
    setBodyError('')
  }

  const commitHeaders = (rows: HeaderRow[] = headerRows) => {
    // 空白 name + 空白 value 的行允许保留作为"占位新行"，不报错；
    // name 非空但 value 为空（或反之）都视为用户正在编辑，同样不报错。
    // 只在 name 里含冒号这种明显不合法时兜一下。
    for (const row of rows) {
      const name = row.name.trim()
      if (name === '') continue
      if (name.includes(':') || /\s/.test(name)) {
        setHeadersError(t('admin.channelMonitor.advanced.headerNameInvalid', { name }))
        return
      }
    }
    setHeadersError('')
    onExtraHeadersChange?.(toMap(rows))
  }

  const updateRow = (index: number, patch: Partial<HeaderRow>) =>
    setHeaderRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const addRow = () => setHeaderRows((rows) => [...rows, { name: '', value: '' }])

  const removeRow = (index: number) => {
    const next = headerRows.filter((_row, i) => i !== index)
    if (next.length === 0) next.push({ name: '', value: '' })
    setHeaderRows(next)
    commitHeaders(next)
  }

  const jsonError = (e: unknown) =>
    t('admin.channelMonitor.advanced.bodyJsonError') + ': ' + (e instanceof Error ? e.message : String(e))

  const commitBody = () => {
    if (bodyOverrideMode === 'off') return
    const trimmed = bodyText.trim()
    if (trimmed === '') {
      onBodyOverrideChange?.(null)
      setBodyError('')
      return
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setBodyError(t('admin.channelMonitor.advanced.bodyJsonObjectError'))
        return
      }
      onBodyOverrideChange?.(parsed as Record<string, unknown>)
      setBodyError('')
    } catch (e) {
      setBodyError(jsonError(e))
    }
  }

  const formatBody = () => {
    const trimmed = bodyText.trim()
    if (trimmed === '') return
    try {
      const parsed = JSON.parse(trimmed)
      setBodyText(JSON.stringify(parsed, null, 2))
      setBodyError('')
      // 同步把校验过的对象提交，避免格式化后焦点未移走时父组件读到旧值
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        onBodyOverrideChange?.(parsed as Record<string, unknown>)
      }
    } catch (e) {
      setBodyError(jsonError(e))
    }
  }

  const updateBodyMode = (mode: BodyOverrideMode) => {
    onBodyOverrideModeChange?.(mode)
    // 切换到 off 时清掉 body（提示用户）
    if (mode === 'off') onBodyOverrideChange?.(null)
  }

  const bodyModeOptions: { value: BodyOverrideMode; label: string }[] = [
    { value: 'off', label: t('admin.channelMonitor.advanced.bodyModeOff') },
    { value: 'merge', label: t('admin.channelMonitor.advanced.bodyModeMerge') },
    { value: 'replace', label: t('admin.channelMonitor.advanced.bodyModeReplace') }
  ]

  const bodyModeHint =
    bodyOverrideMode === 'merge'
      ? t('admin.channelMonitor.advanced.bodyModeHintMerge')
      : bodyOverrideMode === 'replace'
        ? t('admin.channelMonitor.advanced.bodyModeHintReplace')
        : t('admin.channelMonitor.advanced.bodyModeHintOff')

  let bodyPlaceholder: string
  if (provider === PROVIDER_OPENAI && apiMode === API_MODE_RESPONSES) {
    bodyPlaceholder =
      bodyOverrideMode === 'merge'
        ? '{\n  "max_output_tokens": 20\n}'
        : '{\n  "model": "gpt-4o-mini",\n  "instructions": "You are a health check endpoint. Reply briefly.",\n  "input": "Reply with exactly: ok",\n  "max_output_tokens": 20,\n  "stream": false\n}'
  } else if (provider === PROVIDER_OPENAI || provider === PROVIDER_GROK) {
    const model = provider === PROVIDER_GROK ? DEFAULT_GROK_MODEL : 'gpt-4o-mini'
    bodyPlaceholder =
      bodyOverrideMode === 'merge'
        ? '{\n  "max_tokens": 20\n}'
        : `{\n  "model": "${model}",\n  "messages": [{"role":"user","content":"Reply with exactly: ok"}],\n  "max_tokens": 20,\n  "stream": false\n}`
  } else {
    bodyPlaceholder =
      bodyOverrideMode === 'merge'
        ? '{\n  "system": "You are Claude Code..."\n}'
        : '{\n  "model": "claude-x",\n  "messages": [{"role":"user","content":"hi"}],\n  "max_tokens": 10\n}'
  }

  return (
    <div className={styles.stack}>
      {/* Headers key-value rows */}
      <FormField
        label={t('admin.channelMonitor.advanced.headers')}
        error={headersError || undefined}
        hint={headersError ? undefined : t('admin.channelMonitor.advanced.headersHint')}
      >
        <div className={styles.rows}>
          {headerRows.map((row, i) => (
            <div key={i} className={styles.headerRow}>
              <input
                type="text"
                spellCheck={false}
                className={[arcInput.input, monitor.mono, styles.headerName].join(' ')}
                value={row.name}
                placeholder={t('admin.channelMonitor.advanced.headerNamePlaceholder')}
                aria-label={t('admin.channelMonitor.advanced.headerNamePlaceholder')}
                onChange={(event) => updateRow(i, { name: event.target.value })}
                onBlur={() => commitHeaders()}
              />
              <input
                type="text"
                spellCheck={false}
                className={[arcInput.input, monitor.mono, styles.headerValue].join(' ')}
                value={row.value}
                placeholder={t('admin.channelMonitor.advanced.headerValuePlaceholder')}
                aria-label={t('admin.channelMonitor.advanced.headerValuePlaceholder')}
                onChange={(event) => updateRow(i, { value: event.target.value })}
                onBlur={() => commitHeaders()}
              />
              <button
                type="button"
                className={styles.remove}
                title={t('common.delete')}
                aria-label={t('common.delete')}
                onClick={() => removeRow(i)}
              >
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className={styles.addRow} onClick={addRow}>
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
            {t('admin.channelMonitor.advanced.headerAddRow')}
          </button>
        </div>
      </FormField>

      {/* Body mode radio */}
      <FormField label={t('admin.channelMonitor.advanced.bodyMode')} hint={bodyModeHint}>
        <div className={monitor.choiceGrid} data-cols="3fixed">
          {bodyModeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={monitor.choice}
              aria-pressed={bodyOverrideMode === opt.value}
              onClick={() => updateBodyMode(opt.value)}
            >
              <span className={monitor.choiceTitle}>{opt.label}</span>
            </button>
          ))}
        </div>
      </FormField>

      {/* Body JSON (仅当 mode != off) */}
      {bodyOverrideMode !== 'off' ? (
        <FormField
          label={t('admin.channelMonitor.advanced.bodyJson')}
          labelExtra={
            <button type="button" className={styles.format} disabled={!bodyText.trim()} onClick={formatBody}>
              {t('admin.channelMonitor.advanced.bodyJsonFormat')}
            </button>
          }
          error={bodyError || undefined}
          hint={bodyError ? undefined : t('admin.channelMonitor.advanced.bodyJsonHint')}
        >
          <textarea
            className={[arcInput.input, monitor.mono, styles.body].join(' ')}
            rows={10}
            value={bodyText}
            placeholder={bodyPlaceholder}
            spellCheck={false}
            aria-label={t('admin.channelMonitor.advanced.bodyJson')}
            onChange={(event) => setBodyText(event.target.value)}
            onBlur={commitBody}
          />
        </FormField>
      ) : null}
    </div>
  )
}
