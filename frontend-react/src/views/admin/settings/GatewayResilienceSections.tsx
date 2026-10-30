/**
 * 网关 Tab 中独立保存的容错类设置：过载冷却（529）、限流冷却（429）、流超时、请求整流与 Beta 策略。
 * 每个区域各自加载、各自保存，不参与页面底部的整表保存。
 */
import { Plus, X } from 'lucide-react'

import { adminAPI } from '@/api'
import type {
  BetaPolicyRule,
  OverloadCooldownSettings,
  RateLimit429CooldownSettings,
  RectifierSettings,
  StreamTimeoutSettings
} from '@/api/admin/settings'
import { Field, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import Select from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import IndependentSettingsRegion from './IndependentSettingsRegion'
import { useIndependentSettings } from './useIndependentSettings'

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
  testId
}: {
  label: string
  hint?: string
  value: number | ''
  min?: number
  max?: number
  onChange: (value: number) => void
  testId?: string
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={min}
        max={max}
        className={cx(s.input, s.inputNarrow)}
        value={value}
        data-testid={testId}
        aria-label={label}
        onChange={(e) => onChange(numberInputValue(e.target.value) as number)}
      />
    </Field>
  )
}

export function OverloadCooldownSection() {
  const { t } = useI18n()
  const { form, patch, loading, saving, save } = useIndependentSettings<OverloadCooldownSettings>({
    defaults: { enabled: true, cooldown_minutes: 10 },
    load: () => adminAPI.settings.getOverloadCooldownSettings(),
    save: (f) => adminAPI.settings.updateOverloadCooldownSettings({ enabled: f.enabled, cooldown_minutes: f.cooldown_minutes }),
    savedKey: 'admin.settings.overloadCooldown.saved',
    saveFailedKey: 'admin.settings.overloadCooldown.saveFailed'
  })
  return (
    <IndependentSettingsRegion
      title={t('admin.settings.overloadCooldown.title')}
      description={t('admin.settings.overloadCooldown.description')}
      loading={loading}
      saving={saving}
      onSave={() => void save()}
    >
      <ToggleRow
        label={t('admin.settings.overloadCooldown.enabled')}
        description={t('admin.settings.overloadCooldown.enabledHint')}
        checked={form.enabled}
        onChange={(enabled) => patch({ enabled })}
      >
        {form.enabled ? (
          <NumberField
            label={t('admin.settings.overloadCooldown.cooldownMinutes')}
            hint={t('admin.settings.overloadCooldown.cooldownMinutesHint')}
            value={form.cooldown_minutes}
            min={1}
            max={120}
            onChange={(cooldown_minutes) => patch({ cooldown_minutes })}
          />
        ) : null}
      </ToggleRow>
    </IndependentSettingsRegion>
  )
}

export function RateLimit429CooldownSection() {
  const { t } = useI18n()
  const { form, patch, loading, saving, save } = useIndependentSettings<RateLimit429CooldownSettings>({
    defaults: { enabled: true, cooldown_seconds: 5 },
    load: () => adminAPI.settings.getRateLimit429CooldownSettings(),
    save: (f) =>
      adminAPI.settings.updateRateLimit429CooldownSettings({ enabled: f.enabled, cooldown_seconds: f.cooldown_seconds }),
    savedKey: 'admin.settings.rateLimit429Cooldown.saved',
    saveFailedKey: 'admin.settings.rateLimit429Cooldown.saveFailed'
  })
  return (
    <IndependentSettingsRegion
      title={t('admin.settings.rateLimit429Cooldown.title')}
      description={t('admin.settings.rateLimit429Cooldown.description')}
      loading={loading}
      saving={saving}
      onSave={() => void save()}
    >
      <ToggleRow
        label={t('admin.settings.rateLimit429Cooldown.enabled')}
        description={t('admin.settings.rateLimit429Cooldown.enabledHint')}
        checked={form.enabled}
        onChange={(enabled) => patch({ enabled })}
      >
        {form.enabled ? (
          <NumberField
            label={t('admin.settings.rateLimit429Cooldown.cooldownSeconds')}
            hint={t('admin.settings.rateLimit429Cooldown.cooldownSecondsHint')}
            value={form.cooldown_seconds}
            min={1}
            max={7200}
            onChange={(cooldown_seconds) => patch({ cooldown_seconds })}
          />
        ) : null}
      </ToggleRow>
    </IndependentSettingsRegion>
  )
}

export function StreamTimeoutSection() {
  const { t } = useI18n()
  const { form, patch, loading, saving, save } = useIndependentSettings<StreamTimeoutSettings>({
    defaults: { enabled: true, action: 'temp_unsched', temp_unsched_minutes: 5, threshold_count: 3, threshold_window_minutes: 10 },
    load: () => adminAPI.settings.getStreamTimeoutSettings(),
    save: (f) =>
      adminAPI.settings.updateStreamTimeoutSettings({
        enabled: f.enabled,
        action: f.action,
        temp_unsched_minutes: f.temp_unsched_minutes,
        threshold_count: f.threshold_count,
        threshold_window_minutes: f.threshold_window_minutes
      }),
    savedKey: 'admin.settings.streamTimeout.saved',
    saveFailedKey: 'admin.settings.streamTimeout.saveFailed'
  })
  return (
    <IndependentSettingsRegion
      title={t('admin.settings.streamTimeout.title')}
      description={t('admin.settings.streamTimeout.description')}
      loading={loading}
      saving={saving}
      onSave={() => void save()}
    >
      <ToggleRow
        label={t('admin.settings.streamTimeout.enabled')}
        description={t('admin.settings.streamTimeout.enabledHint')}
        checked={form.enabled}
        onChange={(enabled) => patch({ enabled })}
      >
        {form.enabled ? (
          <>
            <Field label={t('admin.settings.streamTimeout.action')} hint={t('admin.settings.streamTimeout.actionHint')}>
              <select
                className={cx(s.select, s.inputMedium)}
                value={form.action}
                aria-label={t('admin.settings.streamTimeout.action')}
                onChange={(e) => patch({ action: e.target.value as StreamTimeoutSettings['action'] })}
              >
                <option value="temp_unsched">{t('admin.settings.streamTimeout.actionTempUnsched')}</option>
                <option value="error">{t('admin.settings.streamTimeout.actionError')}</option>
                <option value="none">{t('admin.settings.streamTimeout.actionNone')}</option>
              </select>
            </Field>
            {form.action === 'temp_unsched' ? (
              <NumberField
                label={t('admin.settings.streamTimeout.tempUnschedMinutes')}
                hint={t('admin.settings.streamTimeout.tempUnschedMinutesHint')}
                value={form.temp_unsched_minutes}
                min={1}
                max={60}
                onChange={(temp_unsched_minutes) => patch({ temp_unsched_minutes })}
              />
            ) : null}
            <NumberField
              label={t('admin.settings.streamTimeout.thresholdCount')}
              hint={t('admin.settings.streamTimeout.thresholdCountHint')}
              value={form.threshold_count}
              min={1}
              max={10}
              onChange={(threshold_count) => patch({ threshold_count })}
            />
            <NumberField
              label={t('admin.settings.streamTimeout.thresholdWindowMinutes')}
              hint={t('admin.settings.streamTimeout.thresholdWindowMinutesHint')}
              value={form.threshold_window_minutes}
              min={1}
              max={60}
              onChange={(threshold_window_minutes) => patch({ threshold_window_minutes })}
            />
          </>
        ) : null}
      </ToggleRow>
    </IndependentSettingsRegion>
  )
}

/** 字符串列表编辑：每行一个输入框与删除按钮，底部“添加” */
export function StringListEditor({
  values,
  onChange,
  placeholder,
  addLabel,
  removeLabel,
  inputTestId
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  addLabel: string
  removeLabel?: string
  inputTestId?: string
}) {
  return (
    <div className={s.columnTight}>
      {values.map((value, index) => (
        <div key={index} className={s.inline}>
          <input
            type="text"
            className={cx(s.input, s.grow)}
            value={value}
            placeholder={placeholder}
            data-testid={inputTestId}
            onChange={(e) => onChange(values.map((item, i) => (i === index ? e.target.value : item)))}
          />
          <button
            type="button"
            className={cx(s.iconButton, s.iconButtonDanger)}
            aria-label={removeLabel ?? addLabel}
            onClick={() => onChange(values.filter((_, i) => i !== index))}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <div>
        <button type="button" className={cx(s.chip, s.chipButton)} onClick={() => onChange([...values, ''])}>
          <Plus size={12} aria-hidden="true" />
          {addLabel}
        </button>
      </div>
    </div>
  )
}

function normalizeRectifier(form: RectifierSettings): RectifierSettings {
  // 确保 patterns 是数组（旧数据可能为 null）
  return Array.isArray(form.apikey_signature_patterns) ? form : { ...form, apikey_signature_patterns: [] }
}

export function RectifierSection() {
  const { t } = useI18n()
  const { form, patch, loading, saving, save } = useIndependentSettings<RectifierSettings>({
    defaults: {
      enabled: true,
      thinking_signature_enabled: true,
      thinking_budget_enabled: true,
      apikey_signature_enabled: false,
      apikey_signature_patterns: []
    },
    load: () => adminAPI.settings.getRectifierSettings(),
    save: (f) =>
      adminAPI.settings.updateRectifierSettings({
        enabled: f.enabled,
        thinking_signature_enabled: f.thinking_signature_enabled,
        thinking_budget_enabled: f.thinking_budget_enabled,
        apikey_signature_enabled: f.apikey_signature_enabled,
        apikey_signature_patterns: f.apikey_signature_patterns.filter((p) => p.trim() !== '')
      }),
    normalize: normalizeRectifier,
    savedKey: 'admin.settings.rectifier.saved',
    saveFailedKey: 'admin.settings.rectifier.saveFailed'
  })
  return (
    <IndependentSettingsRegion
      title={t('admin.settings.rectifier.title')}
      description={t('admin.settings.rectifier.description')}
      loading={loading}
      saving={saving}
      onSave={() => void save()}
    >
      <ToggleRow
        label={t('admin.settings.rectifier.enabled')}
        description={t('admin.settings.rectifier.enabledHint')}
        checked={form.enabled}
        onChange={(enabled) => patch({ enabled })}
      >
        {form.enabled ? (
          <>
            <ToggleRow
              label={t('admin.settings.rectifier.thinkingSignature')}
              description={t('admin.settings.rectifier.thinkingSignatureHint')}
              checked={form.thinking_signature_enabled}
              onChange={(thinking_signature_enabled) => patch({ thinking_signature_enabled })}
            />
            <ToggleRow
              label={t('admin.settings.rectifier.thinkingBudget')}
              description={t('admin.settings.rectifier.thinkingBudgetHint')}
              checked={form.thinking_budget_enabled}
              onChange={(thinking_budget_enabled) => patch({ thinking_budget_enabled })}
            />
            <ToggleRow
              label={t('admin.settings.rectifier.apikeySignature')}
              description={t('admin.settings.rectifier.apikeySignatureHint')}
              checked={form.apikey_signature_enabled}
              onChange={(apikey_signature_enabled) => patch({ apikey_signature_enabled })}
            >
              {form.apikey_signature_enabled ? (
                <Field label={t('admin.settings.rectifier.apikeyPatterns')} hint={t('admin.settings.rectifier.apikeyPatternsHint')}>
                  <StringListEditor
                    values={form.apikey_signature_patterns}
                    onChange={(apikey_signature_patterns) => patch({ apikey_signature_patterns })}
                    placeholder={t('admin.settings.rectifier.apikeyPatternPlaceholder')}
                    addLabel={t('admin.settings.rectifier.addPattern')}
                  />
                </Field>
              ) : null}
            </ToggleRow>
          </>
        ) : null}
      </ToggleRow>
    </IndependentSettingsRegion>
  )
}

// Beta Policy 方法
const betaDisplayNames: Record<string, string> = {
  'fast-mode-2026-02-01': 'Fast Mode',
  'context-1m-2025-08-07': 'Context 1M'
}

// 常用模型模式（具体 ID + 通配符示例）
const commonModelPatterns = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-*', 'claude-sonnet-*']

type BetaAction = BetaPolicyRule['action']

export function BetaPolicySection() {
  const { t } = useI18n()
  const { form, setForm, loading, saving, save } = useIndependentSettings<{ rules: BetaPolicyRule[] }>({
    defaults: { rules: [] },
    load: async () => {
      const settings = await adminAPI.settings.getBetaPolicySettings()
      return { rules: settings.rules ?? [] }
    },
    save: async (f) => {
      // Clean up empty patterns before saving
      const cleanedRules = f.rules.map((rule) => {
        const whitelist = rule.model_whitelist?.filter((p) => p.trim() !== '')
        const hasWhitelist = whitelist && whitelist.length > 0
        return {
          beta_token: rule.beta_token,
          action: rule.action,
          scope: rule.scope,
          error_message: rule.error_message,
          model_whitelist: hasWhitelist ? whitelist : undefined,
          fallback_action: hasWhitelist ? rule.fallback_action || 'pass' : undefined,
          fallback_error_message: hasWhitelist && rule.fallback_action === 'block' ? rule.fallback_error_message : undefined
        }
      })
      const updated = await adminAPI.settings.updateBetaPolicySettings({ rules: cleanedRules })
      return { rules: updated.rules ?? [] }
    },
    savedKey: 'admin.settings.betaPolicy.saved',
    saveFailedKey: 'admin.settings.betaPolicy.saveFailed'
  })

  const actionOptions = [
    { value: 'pass', label: t('admin.settings.betaPolicy.actionPass') },
    { value: 'filter', label: t('admin.settings.betaPolicy.actionFilter') },
    { value: 'block', label: t('admin.settings.betaPolicy.actionBlock') }
  ]
  const scopeOptions = [
    { value: 'all', label: t('admin.settings.betaPolicy.scopeAll') },
    { value: 'oauth', label: t('admin.settings.betaPolicy.scopeOAuth') },
    { value: 'apikey', label: t('admin.settings.betaPolicy.scopeAPIKey') },
    { value: 'bedrock', label: t('admin.settings.betaPolicy.scopeBedrock') }
  ]
  // 快捷预设：按 beta_token 定义预设方案
  const betaPresets: Record<
    string,
    Array<{ label: string; description: string; action: BetaAction; model_whitelist: string[]; fallback_action: BetaAction }>
  > = {
    'context-1m-2025-08-07': [
      {
        label: t('admin.settings.betaPolicy.presetOpusOnly'),
        description: t('admin.settings.betaPolicy.presetOpusOnlyDesc'),
        action: 'pass',
        model_whitelist: ['claude-opus-4-6'],
        fallback_action: 'filter'
      }
    ]
  }

  function updateRule(index: number, patchValue: Partial<BetaPolicyRule>) {
    setForm((prev) => ({ rules: prev.rules.map((rule, i) => (i === index ? { ...rule, ...patchValue } : rule)) }))
  }

  return (
    <IndependentSettingsRegion
      title={t('admin.settings.betaPolicy.title')}
      description={t('admin.settings.betaPolicy.description')}
      loading={loading}
      saving={saving}
      onSave={() => void save()}
    >
      {form.rules.length ? (
        <div className={s.column}>
          {form.rules.map((rule, index) => {
            const whitelist = rule.model_whitelist || []
            return (
              <div key={rule.beta_token} className={s.item}>
                <div className={s.inline}>
                  <span className={s.itemTitle}>{betaDisplayNames[rule.beta_token] || rule.beta_token}</span>
                  <code className={s.code}>{rule.beta_token}</code>
                </div>
                <div className={s.grid2}>
                  <Field label={t('admin.settings.betaPolicy.action')}>
                    <Select
                      value={rule.action}
                      options={actionOptions}
                      onChange={(value) => updateRule(index, { action: value as BetaAction })}
                    />
                  </Field>
                  <Field label={t('admin.settings.betaPolicy.scope')}>
                    <Select
                      value={rule.scope}
                      options={scopeOptions}
                      onChange={(value) => updateRule(index, { scope: value as BetaPolicyRule['scope'] })}
                    />
                  </Field>
                </div>
                {rule.action === 'block' ? (
                  <Field label={t('admin.settings.betaPolicy.errorMessage')} hint={t('admin.settings.betaPolicy.errorMessageHint')}>
                    <input
                      type="text"
                      className={s.input}
                      value={rule.error_message ?? ''}
                      placeholder={t('admin.settings.betaPolicy.errorMessagePlaceholder')}
                      onChange={(e) => updateRule(index, { error_message: e.target.value })}
                    />
                  </Field>
                ) : null}
                {betaPresets[rule.beta_token]?.length ? (
                  <Field label={t('admin.settings.betaPolicy.quickPresets')}>
                    <div className={s.chips}>
                      {betaPresets[rule.beta_token]!.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          className={cx(s.chip, s.chipButton)}
                          title={preset.description}
                          onClick={() =>
                            updateRule(index, {
                              action: preset.action,
                              model_whitelist: [...preset.model_whitelist],
                              fallback_action: preset.fallback_action
                            })
                          }
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                ) : null}
                <Field label={t('admin.settings.betaPolicy.modelWhitelist')} hint={t('admin.settings.betaPolicy.modelWhitelistHint')}>
                  <StringListEditor
                    values={whitelist}
                    onChange={(model_whitelist) => updateRule(index, { model_whitelist })}
                    placeholder={t('admin.settings.betaPolicy.modelPatternPlaceholder')}
                    addLabel={t('admin.settings.betaPolicy.addModelPattern')}
                  />
                  <div className={s.chips}>
                    <span className={s.hint}>{t('admin.settings.betaPolicy.commonPatterns')}:</span>
                    {commonModelPatterns.map((pattern) => (
                      <button
                        key={pattern}
                        type="button"
                        className={cx(s.chip, s.chipButton)}
                        onClick={() => {
                          if (!whitelist.includes(pattern)) updateRule(index, { model_whitelist: [...whitelist, pattern] })
                        }}
                      >
                        {pattern}
                      </button>
                    ))}
                  </div>
                </Field>
                {whitelist.length > 0 ? (
                  <Field label={t('admin.settings.betaPolicy.fallbackAction')} hint={t('admin.settings.betaPolicy.fallbackActionHint')}>
                    <Select
                      value={rule.fallback_action || 'pass'}
                      options={actionOptions}
                      onChange={(value) => updateRule(index, { fallback_action: value as BetaAction })}
                    />
                    {rule.fallback_action === 'block' ? (
                      <>
                        <input
                          type="text"
                          className={s.input}
                          value={rule.fallback_error_message ?? ''}
                          placeholder={t('admin.settings.betaPolicy.fallbackErrorMessagePlaceholder')}
                          onChange={(e) => updateRule(index, { fallback_error_message: e.target.value })}
                        />
                        <p className={s.hint}>{t('admin.settings.betaPolicy.errorMessageHint')}</p>
                      </>
                    ) : null}
                  </Field>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </IndependentSettingsRegion>
  )
}
