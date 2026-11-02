/**
 * EditAccountModal 的展示片段：开关行、数字输入、模型限制（白名单/映射）、映射行编辑、
 * 池模式与临时不可调度规则。状态全部由 EditAccountModal 持有，这里只负责渲染与回调。
 */
import { ArrowRight, ChevronDown, ChevronUp, Info, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { RadioCards } from '@/components/arc/radio-cards/radio-cards'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Switch } from '@/components/arc/switch/switch'
import { useI18n } from '@/i18n/useI18n'
import type { OpenCodeGoUsageState, OpenCodeGoUsageWindow, TempUnschedulableScope } from '@/types'
import { FormNotice } from './AccountFormLayout'
import formStyles from './AccountForm.module.css'
import styles from './EditAccountModal.module.css'
import {
  rowKey,
  toNumInput,
  type ModelMapping,
  type NumInput,
  type TempUnschedRuleForm
} from './EditAccountModal.state'
import ModelWhitelistSelector from './ModelWhitelistSelector'

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

export interface SwitchRowProps {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (value: boolean) => void
  /** 开关的无障碍名称；label 不是纯文本时必须提供 */
  ariaLabel?: string
  disabled?: boolean
  testId?: string
  labelExtra?: ReactNode
  /** 显示在开关行下方的内容（例如开启后的配置项） */
  children?: ReactNode
  className?: string
}

/** 开关行：标签与说明在左，Arc 开关在右（role="switch"、aria-checked，可带 data-testid） */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  ariaLabel,
  disabled,
  testId,
  labelExtra,
  children,
  className
}: SwitchRowProps) {
  return (
    <div className={cx(formStyles.toggleRow, className)}>
      <div className={formStyles.toggleHead}>
        <div className={formStyles.toggleText}>
          <div className={formStyles.labelRow}>
            <span className={formStyles.label}>{label}</span>
            {labelExtra}
          </div>
          {description ? <p className={formStyles.hint}>{description}</p> : null}
        </div>
        <Switch
          checked={checked}
          onCheckedChange={(next) => onChange(next)}
          disabled={disabled}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          data-testid={testId}
        />
      </div>
      {children ? <div className={styles.switchBody}>{children}</div> : null}
    </div>
  )
}

export interface NumberInputProps {
  value: NumInput
  onChange: (value: number | '') => void
  min?: number | string
  max?: number | string
  step?: number | string
  placeholder?: string
  disabled?: boolean
  id?: string
  testId?: string
  className?: string
  'aria-label'?: string
  onEnter?: () => void
}

/** 数字输入（Vue 版 v-model.number）：可解析为数字时回调数字，清空时回调 '' */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  disabled,
  id,
  testId,
  className,
  'aria-label': ariaLabel,
  onEnter
}: NumberInputProps) {
  return (
    <input
      id={id}
      type="number"
      className={cx(formStyles.input, className)}
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
      onChange={(event) => onChange(toNumInput(event.target.value))}
      onKeyUp={
        onEnter
          ? (event) => {
              if (event.key === 'Enter') onEnter()
            }
          : undefined
      }
    />
  )
}

/** 互斥小按钮组（模式 / 协议等），选中项 aria-pressed */
export function ChoiceButtons<T extends string>({
  options,
  value,
  onSelect,
  testId,
  ariaLabel
}: {
  options: Array<{ value: T; label: string }>
  value: string
  onSelect: (value: T) => void
  testId?: string
  ariaLabel?: string
}) {
  return (
    <div className={formStyles.choiceGroup} data-testid={testId} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={formStyles.choice}
          aria-pressed={value === option.value}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** 预设映射按钮（getPresetMappingsByPlatform 的结果） */
export interface PresetMapping {
  label: string
  from: string
  to: string
}

export function PresetMappingButtons({
  presets,
  onSelect
}: {
  presets: PresetMapping[]
  onSelect: (from: string, to: string) => void
}) {
  return (
    <div className={formStyles.chips}>
      {presets.map((preset) => (
        <button key={preset.label} type="button" className={styles.presetButton} onClick={() => onSelect(preset.from, preset.to)}>
          + {preset.label}
        </button>
      ))}
    </div>
  )
}

export interface MappingRowsEditorProps {
  rows: ModelMapping[]
  onChange: (rows: ModelMapping[]) => void
  keyPrefix: string
  fromPlaceholder: string
  toPlaceholder: string
  /** 通配符校验（Antigravity）：请求模型只允许末尾 *，实际模型不允许 * */
  validateWildcard?: (pattern: string) => boolean
}

/** 模型映射行（请求模型 → 实际模型），行内编辑、删除 */
export function MappingRowsEditor({
  rows,
  onChange,
  keyPrefix,
  fromPlaceholder,
  toPlaceholder,
  validateWildcard
}: MappingRowsEditorProps) {
  const { t } = useI18n()
  if (rows.length === 0) return null
  const patch = (index: number, value: Partial<ModelMapping>) => onChange(patchRowAt(rows, index, value))
  return (
    <div className={formStyles.editRows}>
      {rows.map((mapping, index) => {
        const fromInvalid = validateWildcard ? !validateWildcard(mapping.from) : false
        const toInvalid = validateWildcard ? mapping.to.includes('*') : false
        return (
          <div key={rowKey(mapping, keyPrefix)} className={formStyles.stackTight}>
            <div className={formStyles.editRow}>
              <input
                type="text"
                className={formStyles.input}
                value={mapping.from}
                placeholder={fromPlaceholder}
                aria-invalid={fromInvalid || undefined}
                onChange={(event) => patch(index, { from: event.target.value })}
              />
              <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" className={styles.arrow} />
              <input
                type="text"
                className={formStyles.input}
                value={mapping.to}
                placeholder={toPlaceholder}
                aria-invalid={toInvalid || undefined}
                onChange={(event) => patch(index, { to: event.target.value })}
              />
              <button
                type="button"
                className={formStyles.iconButton}
                data-tone="danger"
                aria-label={t('common.delete')}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            {/* 校验错误提示 */}
            {fromInvalid ? <p className={formStyles.error}>{t('admin.accounts.wildcardOnlyAtEnd')}</p> : null}
            {toInvalid ? <p className={formStyles.error}>{t('admin.accounts.targetNoWildcard')}</p> : null}
          </div>
        )
      })}
    </div>
  )
}

/** 替换第 index 行并沿用原行的稳定 key（输入框不会因对象替换而重新挂载） */
function patchRowAt<T extends object>(rows: T[], index: number, value: Partial<T>): T[] {
  return rows.map((row, i) => (i === index ? carryRowKey(row, { ...row, ...value }) : row))
}

function carryRowKey<T extends object>(prev: T, next: T): T {
  rowKey.carry(prev, next)
  return next
}

export interface ModelRestrictionEditorProps {
  mode: 'whitelist' | 'mapping'
  onModeChange: (mode: 'whitelist' | 'mapping') => void
  allowedModels: string[]
  onAllowedModelsChange: (models: string[]) => void
  mappings: ModelMapping[]
  onMappingsChange: (rows: ModelMapping[]) => void
  platform: string
  accountId?: number
  presets: PresetMapping[]
  /** 预设按钮的处理（默认按 Vue 版 addPresetMapping：已存在同名请求模型时提示） */
  onPreset: (from: string, to: string) => void
  keyPrefix: string
  /** Bedrock 版本使用 fromModel / toModel 占位文案且不显示映射说明 */
  variant?: 'default' | 'bedrock'
}

/** 模型限制：白名单 / 映射两种模式（对应 Vue 版多处重复的 Model Restriction 区块） */
export function ModelRestrictionEditor({
  mode,
  onModeChange,
  allowedModels,
  onAllowedModelsChange,
  mappings,
  onMappingsChange,
  platform,
  accountId,
  presets,
  onPreset,
  keyPrefix,
  variant = 'default'
}: ModelRestrictionEditorProps) {
  const { t } = useI18n()
  const bedrock = variant === 'bedrock'
  return (
    <div className={formStyles.stack}>
      <SegmentedControl
        label={t('admin.accounts.modelRestriction')}
        options={[
          { value: 'whitelist', label: t('admin.accounts.modelWhitelist') },
          { value: 'mapping', label: t('admin.accounts.modelMapping') }
        ]}
        value={mode}
        onValueChange={(value) => onModeChange(value as 'whitelist' | 'mapping')}
      />

      {mode === 'whitelist' ? (
        <div className={formStyles.stackTight}>
          <ModelWhitelistSelector
            value={allowedModels}
            onChange={onAllowedModelsChange}
            modelMappings={mappings}
            platform={platform}
            accountId={accountId}
          />
          <p className={formStyles.hint}>
            {t('admin.accounts.selectedModels', { count: allowedModels.length })}
            {allowedModels.length === 0 && mappings.length === 0 ? <span> {t('admin.accounts.supportsAllModels')}</span> : null}
          </p>
        </div>
      ) : (
        <div className={formStyles.stack}>
          {!bedrock ? (
            <FormNotice tone="info">
              <p className={styles.noticeLine}>
                <Info size={14} strokeWidth={1.75} aria-hidden="true" />
                {t('admin.accounts.mapRequestModels')}
              </p>
            </FormNotice>
          ) : null}
          <MappingRowsEditor
            rows={mappings}
            onChange={onMappingsChange}
            keyPrefix={keyPrefix}
            fromPlaceholder={t(bedrock ? 'admin.accounts.fromModel' : 'admin.accounts.requestModel')}
            toPlaceholder={t(bedrock ? 'admin.accounts.toModel' : 'admin.accounts.actualModel')}
          />
          <AddRowButton label={t('admin.accounts.addMapping')} onClick={() => onMappingsChange([...mappings, { from: '', to: '' }])} />
          {/* Quick Add Buttons */}
          <PresetMappingButtons presets={presets} onSelect={onPreset} />
        </div>
      )}
    </div>
  )
}

export function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.addRow} onClick={onClick}>
      <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
      {label}
    </button>
  )
}

export interface PoolModeSectionProps {
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  retryCount: NumInput
  onRetryCountChange: (value: number | '') => void
  retryStatusCodes: string
  onRetryStatusCodesChange: (value: string) => void
  defaultRetryCount: number
  maxRetryCount: number
  defaultStatusCodes: number[]
}

/** 池模式（API Key 与 Bedrock 共用） */
export function PoolModeSection({
  enabled,
  onEnabledChange,
  retryCount,
  onRetryCountChange,
  retryStatusCodes,
  onRetryStatusCodesChange,
  defaultRetryCount,
  maxRetryCount,
  defaultStatusCodes
}: PoolModeSectionProps) {
  const { t } = useI18n()
  const countId = useId()
  const codesId = useId()
  return (
    <SwitchRow
      label={t('admin.accounts.poolMode')}
      description={t('admin.accounts.poolModeHint')}
      checked={enabled}
      onChange={onEnabledChange}
    >
      {enabled ? (
        <>
          <FormNotice tone="info">
            <p>{t('admin.accounts.poolModeInfo')}</p>
          </FormNotice>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor={countId}>
              {t('admin.accounts.poolModeRetryCount')}
            </label>
            <NumberInput id={countId} value={retryCount} onChange={onRetryCountChange} min={0} max={maxRetryCount} step={1} />
            <p className={formStyles.hint}>
              {t('admin.accounts.poolModeRetryCountHint', { default: defaultRetryCount, max: maxRetryCount })}
            </p>
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor={codesId}>
              {t('admin.accounts.poolModeRetryStatusCodes')}
            </label>
            <input
              id={codesId}
              type="text"
              className={formStyles.input}
              value={retryStatusCodes}
              placeholder={defaultStatusCodes.join(', ')}
              onChange={(event) => onRetryStatusCodesChange(event.target.value)}
            />
            <p className={formStyles.hint}>
              {t('admin.accounts.poolModeRetryStatusCodesHint', { default: defaultStatusCodes.join(', ') })}
            </p>
          </div>
        </>
      ) : null}
    </SwitchRow>
  )
}

export interface TempUnschedRulesEditorProps {
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  rules: TempUnschedRuleForm[]
  onRulesChange: (rules: TempUnschedRuleForm[]) => void
}

/** 临时不可调度规则：预设、增删、上下移动、作用范围卡片 */
export function TempUnschedRulesEditor({ enabled, onEnabledChange, rules, onRulesChange }: TempUnschedRulesEditorProps) {
  const { t } = useI18n()
  const idPrefix = useId()

  const scopeOptions: Array<{ value: TempUnschedulableScope; label: string; description: string }> = [
    {
      value: 'model',
      label: t('admin.accounts.tempUnschedulable.scopeModel'),
      description: t('admin.accounts.tempUnschedulable.scopeModelDesc')
    },
    {
      value: 'account',
      label: t('admin.accounts.tempUnschedulable.scopeAccount'),
      description: t('admin.accounts.tempUnschedulable.scopeAccountDesc')
    }
  ]

  const presets: Array<{ label: string; rule: TempUnschedRuleForm }> = [
    {
      label: t('admin.accounts.tempUnschedulable.presets.overloadLabel'),
      rule: {
        error_code: 529,
        keywords: 'overloaded, too many',
        duration_minutes: 60,
        description: t('admin.accounts.tempUnschedulable.presets.overloadDesc'),
        scope: 'model'
      }
    },
    {
      label: t('admin.accounts.tempUnschedulable.presets.rateLimitLabel'),
      rule: {
        error_code: 429,
        keywords: 'rate limit, too many requests',
        duration_minutes: 10,
        description: t('admin.accounts.tempUnschedulable.presets.rateLimitDesc'),
        scope: 'model'
      }
    },
    {
      label: t('admin.accounts.tempUnschedulable.presets.unavailableLabel'),
      rule: {
        error_code: 503,
        keywords: 'unavailable, maintenance',
        duration_minutes: 30,
        description: t('admin.accounts.tempUnschedulable.presets.unavailableDesc'),
        scope: 'model'
      }
    }
  ]

  const addRule = (preset?: TempUnschedRuleForm) => {
    if (preset) {
      onRulesChange([...rules, { ...preset }])
      return
    }
    onRulesChange([...rules, { error_code: null, keywords: '', duration_minutes: 30, description: '', scope: 'model' }])
  }

  const moveRule = (index: number, direction: number) => {
    const target = index + direction
    if (target < 0 || target >= rules.length) return
    const next = [...rules]
    const current = next[index]
    next[index] = next[target]
    next[target] = current
    onRulesChange(next)
  }

  const patch = (index: number, value: Partial<TempUnschedRuleForm>) => onRulesChange(patchRowAt(rules, index, value))

  return (
    <SwitchRow
      label={t('admin.accounts.tempUnschedulable.title')}
      description={t('admin.accounts.tempUnschedulable.hint')}
      checked={enabled}
      onChange={onEnabledChange}
    >
      {enabled ? (
        <>
          <FormNotice tone="info">
            <p>{t('admin.accounts.tempUnschedulable.notice')}</p>
          </FormNotice>

          <div className={formStyles.chips}>
            {presets.map((preset) => (
              <button key={preset.label} type="button" className={styles.presetButton} onClick={() => addRule(preset.rule)}>
                + {preset.label}
              </button>
            ))}
          </div>

          {rules.length > 0 ? (
            <div className={styles.ruleList}>
              {rules.map((rule, index) => {
                const base = `${idPrefix}-${index}`
                return (
                  <div key={rowKey(rule, 'edit-temp-unsched-rule')} className={styles.rule}>
                    <div className={styles.ruleHead}>
                      <span className={formStyles.hint}>
                        {t('admin.accounts.tempUnschedulable.ruleIndex', { index: index + 1 })}
                      </span>
                      <div className={formStyles.row}>
                        <button
                          type="button"
                          className={formStyles.iconButton}
                          disabled={index === 0}
                          aria-label={t('admin.settings.customMenu.moveUp')}
                          onClick={() => moveRule(index, -1)}
                        >
                          <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={formStyles.iconButton}
                          disabled={index === rules.length - 1}
                          aria-label={t('admin.settings.customMenu.moveDown')}
                          onClick={() => moveRule(index, 1)}
                        >
                          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={formStyles.iconButton}
                          data-tone="danger"
                          aria-label={t('common.delete')}
                          onClick={() => onRulesChange(rules.filter((_, i) => i !== index))}
                        >
                          <X size={16} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className={formStyles.grid2}>
                      <div className={formStyles.field}>
                        <label className={formStyles.label} htmlFor={`${base}-code`}>
                          {t('admin.accounts.tempUnschedulable.errorCode')}
                        </label>
                        <NumberInput
                          id={`${base}-code`}
                          value={rule.error_code}
                          onChange={(value) => patch(index, { error_code: value })}
                          min={100}
                          max={599}
                          placeholder={t('admin.accounts.tempUnschedulable.errorCodePlaceholder')}
                        />
                      </div>
                      <div className={formStyles.field}>
                        <label className={formStyles.label} htmlFor={`${base}-duration`}>
                          {t('admin.accounts.tempUnschedulable.durationMinutes')}
                        </label>
                        <NumberInput
                          id={`${base}-duration`}
                          value={rule.duration_minutes}
                          onChange={(value) => patch(index, { duration_minutes: value })}
                          min={1}
                          placeholder={t('admin.accounts.tempUnschedulable.durationPlaceholder')}
                        />
                      </div>
                    </div>
                    <div className={formStyles.field}>
                      <span className={formStyles.label}>{t('admin.accounts.tempUnschedulable.scope')}</span>
                      <RadioCards
                        aria-label={t('admin.accounts.tempUnschedulable.scope')}
                        data-testid="temp-unsched-scope"
                        options={scopeOptions}
                        value={rule.scope}
                        onValueChange={(value) => patch(index, { scope: value as TempUnschedulableScope })}
                        minColumnWidth={200}
                      />
                      <p className={formStyles.hint}>{t('admin.accounts.tempUnschedulable.scopeHint')}</p>
                    </div>
                    <div className={formStyles.field}>
                      <label className={formStyles.label} htmlFor={`${base}-keywords`}>
                        {t('admin.accounts.tempUnschedulable.keywords')}
                      </label>
                      <input
                        id={`${base}-keywords`}
                        type="text"
                        className={formStyles.input}
                        value={rule.keywords}
                        placeholder={t('admin.accounts.tempUnschedulable.keywordsPlaceholder')}
                        onChange={(event) => patch(index, { keywords: event.target.value })}
                      />
                      <p className={formStyles.hint}>{t('admin.accounts.tempUnschedulable.keywordsHint')}</p>
                    </div>
                    <div className={formStyles.field}>
                      <label className={formStyles.label} htmlFor={`${base}-description`}>
                        {t('admin.accounts.tempUnschedulable.description')}
                      </label>
                      <input
                        id={`${base}-description`}
                        type="text"
                        className={formStyles.input}
                        value={rule.description}
                        placeholder={t('admin.accounts.tempUnschedulable.descriptionPlaceholder')}
                        onChange={(event) => patch(index, { description: event.target.value })}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}

          <AddRowButton label={t('admin.accounts.tempUnschedulable.addRule')} onClick={() => addRule()} />
        </>
      ) : null}
    </SwitchRow>
  )
}

export interface OpenCodeGoUsagePanelProps {
  state: OpenCodeGoUsageState | null
  loading: boolean
  saving: boolean
  refreshing: boolean
  onRefresh: () => void
  onAutoRefreshChange: (enabled: boolean) => void
}

/** OpenCode Go 用量面板（Vue 版 section[data-testid=opencode-go-usage-settings]） */
export function OpenCodeGoUsagePanel({
  state,
  loading,
  saving,
  refreshing,
  onRefresh,
  onAutoRefreshChange
}: OpenCodeGoUsagePanelProps) {
  const { t } = useI18n()
  const snapshot = state?.snapshot
  const statusOk = snapshot?.status === 'ok'
  const statusLabel = !snapshot
    ? t('admin.accounts.opencodeGo.notRefreshed')
    : snapshot.status === 'unauthorized'
      ? t('admin.accounts.opencodeGo.unauthorized')
      : snapshot.status === 'failed'
        ? t('admin.accounts.opencodeGo.failed')
        : t('admin.accounts.opencodeGo.ok')
  const formatPercent = (value?: number) =>
    typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(value % 1 ? 1 : 0)}%` : '-'
  const formatDate = (value?: string) => {
    if (!value) return '-'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  }
  const windowSummary = (window?: OpenCodeGoUsageWindow) => {
    if (!window) return '-'
    const reset = window.resets_at ? formatDate(window.resets_at) : null
    return reset
      ? t('admin.accounts.opencodeGo.windowWithReset', { percent: formatPercent(window.percent), reset })
      : formatPercent(window.percent)
  }

  return (
    <div className={formStyles.stack} data-testid="opencode-go-usage-settings">
      <div className={formStyles.sectionHeader}>
        <div className={formStyles.sectionHeading}>
          <h3 className={formStyles.sectionTitle}>{t('admin.accounts.opencodeGo.title')}</h3>
          <p className={formStyles.sectionDescription}>{t('admin.accounts.opencodeGo.panelHint')}</p>
        </div>
        <Badge tone={statusOk ? 'success' : 'neutral'}>{statusLabel}</Badge>
      </div>

      {loading ? (
        <div className={styles.loadingRow} role="status" aria-label={t('common.loading')}>
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" className={styles.spin} />
        </div>
      ) : (
        <>
          {snapshot ? (
            <div className={styles.usageDetails} data-testid="opencode-go-usage-details">
              <dl className={styles.usageGrid}>
                <dt>{t('admin.accounts.opencodeGo.rolling')}</dt>
                <dd>{windowSummary(snapshot.data?.rolling)}</dd>
                <dt>{t('admin.accounts.opencodeGo.weekly')}</dt>
                <dd>{windowSummary(snapshot.data?.weekly)}</dd>
                <dt>{t('admin.accounts.opencodeGo.monthly')}</dt>
                <dd>{windowSummary(snapshot.data?.monthly)}</dd>
                <dt>{t('admin.accounts.opencodeGo.status')}</dt>
                <dd className={styles.strong}>{statusLabel}</dd>
                <dt>{t('admin.accounts.opencodeGo.updatedAt')}</dt>
                <dd>{formatDate(snapshot.fetched_at || snapshot.last_attempt_at)}</dd>
              </dl>
              {snapshot.last_error ? (
                <p className={styles.usageError}>
                  {t(`admin.accounts.opencodeGo.errors.${snapshot.last_error}`, snapshot.last_error)}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className={formStyles.row}>
            <Button type="button" variant="secondary" size="sm" disabled={refreshing} data-testid="opencode-go-refresh" onClick={onRefresh}>
              <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" className={refreshing ? styles.spin : undefined} />
              {t('admin.accounts.opencodeGo.refreshNow')}
            </Button>
          </div>

          <SwitchRow
            label={t('admin.accounts.opencodeGo.autoRefresh')}
            description={t('admin.accounts.opencodeGo.autoRefreshHint')}
            checked={state?.auto_refresh_enabled ?? false}
            onChange={onAutoRefreshChange}
            disabled={saving}
            testId="opencode-go-auto-refresh"
          />
        </>
      )}
    </div>
  )
}
