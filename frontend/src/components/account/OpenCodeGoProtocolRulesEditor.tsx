import { Trash2 } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { useI18n } from '@/i18n/useI18n'
import styles from './AccountForm.module.css'
import own from './OpenCodeGoProtocolRulesEditor.module.css'
import {
  cloneOpenCodeGoProtocolRules,
  defaultProviderProtocolRules,
  providerHasModelCatalog,
  providerNativeProtocols,
  type CnNativeApiProtocol,
  type OpenCodeGoProtocolRule
} from './credentialsBuilder'

export interface OpenCodeGoProtocolRulesEditorProps {
  rows: OpenCodeGoProtocolRule[]
  /** Vue 版 update:rows */
  onChange: (rows: OpenCodeGoProtocolRule[]) => void
  /** 默认 'opencode_go' */
  platform?: string
  /** 默认 'go' */
  plan?: string
}

const PROTOCOL_ORDER: Array<{ value: CnNativeApiProtocol; labelKey: string }> = [
  { value: 'chat_completions', labelKey: 'chatCompletions' },
  { value: 'responses', labelKey: 'responses' },
  { value: 'anthropic', labelKey: 'anthropic' }
]

// 规则的协议集合：首选协议 + 也支持的协议；入站协议在集合中时同协议直通。
const hasExtraProtocol = (row: OpenCodeGoProtocolRule, protocol: CnNativeApiProtocol) =>
  row.extraProtocols?.includes(protocol) ?? false

const withExtraProtocols = (row: OpenCodeGoProtocolRule, extra: CnNativeApiProtocol[]): OpenCodeGoProtocolRule => {
  const next = { ...row }
  if (extra.length > 0) next.extraProtocols = extra
  else delete next.extraProtocols
  return next
}

const toggleExtraProtocol = (row: OpenCodeGoProtocolRule, protocol: CnNativeApiProtocol) => {
  const extra = row.extraProtocols ?? []
  return withExtraProtocols(
    row,
    extra.includes(protocol)
      ? extra.filter((item) => item !== protocol)
      : PROTOCOL_ORDER.map((option) => option.value).filter((value) => value === protocol || extra.includes(value))
  )
}

// 切换首选协议：新协议原本就在“也支持”中时只调换顺序（原首选转入“也支持”），
// 否则替换原首选协议。
const setPrimaryProtocol = (row: OpenCodeGoProtocolRule, protocol: CnNativeApiProtocol) => {
  const previous = row.protocol
  if (protocol === previous) return row
  const extra = row.extraProtocols ?? []
  const next = { ...row, protocol }
  if (!extra.includes(protocol)) return next
  const set = new Set<CnNativeApiProtocol>([...extra.filter((item) => item !== protocol), previous])
  return withExtraProtocols(next, PROTOCOL_ORDER.map((option) => option.value).filter((value) => set.has(value)))
}

// 按模型分流的供应商（OpenCode 与后端新登记的聚合平台）的分流规则编辑器；
// 默认规则与可选协议来自平台清单中该供应商 / 接入模式的 profile。
export default function OpenCodeGoProtocolRulesEditor({
  rows,
  onChange,
  platform = 'opencode_go',
  plan = 'go'
}: OpenCodeGoProtocolRulesEditorProps) {
  const { t } = useI18n()

  const addRow = () => {
    onChange([...rows, { pattern: '', protocol: 'chat_completions' }])
  }

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index))
  }

  const replaceRow = (index: number, next: OpenCodeGoProtocolRule) => {
    onChange(rows.map((row, i) => (i === index ? next : row)))
  }

  // 仅列出该接入模式提供原生端点的协议；已有规则使用的协议保留，避免编辑时丢值。
  const supported = new Set<CnNativeApiProtocol>(providerNativeProtocols(platform, plan))
  for (const row of rows) {
    supported.add(row.protocol)
    for (const protocol of row.extraProtocols ?? []) supported.add(protocol)
  }
  const filteredOptions = PROTOCOL_ORDER.filter((option) => supported.has(option.value))
  const protocolOptions = filteredOptions.length > 0 ? filteredOptions : PROTOCOL_ORDER

  const hasModelCatalog = providerHasModelCatalog(platform)

  const restoreDefaults = () => {
    onChange(cloneOpenCodeGoProtocolRules(defaultProviderProtocolRules(platform, plan)))
  }

  return (
    <div className={styles.stackTight}>
      <div className={own.header}>
        <span className={styles.label}>{t('admin.accounts.opencodeGo.protocolRules.title')}</span>
        <button type="button" className={own.linkButton} onClick={restoreDefaults}>
          {t('admin.accounts.opencodeGo.protocolRules.restoreDefaults')}
        </button>
      </div>
      <p className={styles.hint}>{t('admin.accounts.opencodeGo.protocolRules.hint')}</p>
      {rows.length > 0 ? (
        <div className={styles.editRows}>
          {rows.map((row, index) => (
            // 受控输入、无内部状态：按位置作 key，编辑时替换行对象也不会丢失焦点
            <div key={index} className={own.rule}>
              <div className={styles.editRow}>
                <input
                  type="text"
                  value={row.pattern}
                  onChange={(e) => replaceRow(index, { ...row, pattern: e.target.value })}
                  className={`${styles.input} ${styles.mono}`}
                  placeholder={t('admin.accounts.opencodeGo.protocolRules.patternPlaceholder')}
                  data-testid={`opencode-go-protocol-pattern-${index}`}
                />
                <select
                  value={row.protocol}
                  className={`${styles.select} ${own.protocolSelect}`}
                  data-testid={`opencode-go-protocol-select-${index}`}
                  onChange={(e) => replaceRow(index, setPrimaryProtocol(row, e.target.value as CnNativeApiProtocol))}
                >
                  {protocolOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(`admin.accounts.cnProviders.apiProtocol.${option.labelKey}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={styles.iconButton}
                  data-tone="danger"
                  aria-label={t('admin.accounts.opencodeGo.protocolRules.remove')}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
              {protocolOptions.length > 1 ? (
                <div className={own.extras} title={t('admin.accounts.opencodeGo.protocolRules.alsoSupportsHint')}>
                  <span>{t('admin.accounts.opencodeGo.protocolRules.alsoSupports')}</span>
                  {protocolOptions
                    .filter((item) => item.value !== row.protocol)
                    .map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={own.extraChip}
                        aria-pressed={hasExtraProtocol(row, option.value)}
                        data-testid={`opencode-go-protocol-extra-${index}-${option.value}`}
                        onClick={() => replaceRow(index, toggleExtraProtocol(row, option.value))}
                      >
                        {t(`admin.accounts.cnProviders.apiProtocol.${option.labelKey}`)}
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className={own.fallback} data-testid="opencode-go-protocol-fallback">
        <span className={own.fallbackPattern}>*</span>
        <span>{t(`admin.accounts.opencodeGo.protocolRules.${hasModelCatalog ? 'catalogFallback' : 'fallback'}`)}</span>
      </div>
      <Button type="button" variant="secondary" data-testid="opencode-go-protocol-add-rule" onClick={addRow}>
        {t('admin.accounts.opencodeGo.protocolRules.add')}
      </Button>
    </div>
  )
}
