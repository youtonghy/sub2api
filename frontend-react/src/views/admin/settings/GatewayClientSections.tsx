/** 网关 Tab：Claude Code 版本限制、Codex 客户端加固、用量记录（均随整表保存） */
import { SCHEDULING_THRESHOLD_PLATFORMS } from '@/api/admin/settings'
import type { FingerprintSignalRow, FingerprintSignalType } from '@/views/admin/codexFingerprintSignals'
import { Button } from '@/components/arc/button/button'
import { Field, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import { useI18n } from '@/i18n/useI18n'
import { useSettings } from './settingsContext'
import type { SettingsForm } from './settingsForm'
import type { CodexClientRow } from './settingsHelpers'

export function ClaudeCodeSection() {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  return (
    <SettingsRegion title={t('admin.settings.claudeCode.title')} description={t('admin.settings.claudeCode.description')}>
      <div className={s.column}>
        <Field label={t('admin.settings.claudeCode.minVersion')} hint={t('admin.settings.claudeCode.minVersionHint')}>
          <input
            type="text"
            className={cx(s.input, s.mono, s.inputMedium)}
            value={form.min_claude_code_version}
            placeholder={t('admin.settings.claudeCode.minVersionPlaceholder')}
            onChange={(e) => updateForm({ min_claude_code_version: e.target.value })}
          />
        </Field>
        <Field label={t('admin.settings.claudeCode.maxVersion')} hint={t('admin.settings.claudeCode.maxVersionHint')}>
          <input
            type="text"
            className={cx(s.input, s.mono, s.inputMedium)}
            value={form.max_claude_code_version}
            placeholder={t('admin.settings.claudeCode.maxVersionPlaceholder')}
            onChange={(e) => updateForm({ max_claude_code_version: e.target.value })}
          />
        </Field>
      </div>
    </SettingsRegion>
  )
}

function CodexRowsEditor({
  rows,
  onChange,
  whitelist
}: {
  rows: CodexClientRow[]
  onChange: (rows: CodexClientRow[]) => void
  whitelist?: boolean
}) {
  const { t } = useI18n()
  const update = (index: number, patch: Partial<CodexClientRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div className={s.columnTight}>
      {rows.map((row, i) => (
        <div key={i} className={s.inline}>
          <input
            type="text"
            className={cx(s.input, s.mono)}
            style={{ flex: '1 1 30%' }}
            value={row.originator}
            placeholder={t('admin.settings.gatewayForwarding.codexOriginatorPlaceholder')}
            onChange={(e) => update(i, { originator: e.target.value })}
          />
          <input
            type="text"
            className={cx(s.input, s.mono)}
            style={{ flex: '2 1 50%' }}
            value={row.uaContains}
            placeholder={t('admin.settings.gatewayForwarding.codexUaContainsPlaceholder')}
            onChange={(e) => update(i, { uaContains: e.target.value })}
          />
          {whitelist ? (
            <label className={s.checkboxLabel} title={t('admin.settings.gatewayForwarding.codexWhitelistSkipFingerprintTooltip')}>
              <input
                type="checkbox"
                checked={Boolean(row.skipEngineFingerprint)}
                onChange={(e) => update(i, { skipEngineFingerprint: e.target.checked })}
              />
              {t('admin.settings.gatewayForwarding.codexWhitelistSkipFingerprint')}
            </label>
          ) : null}
          <Button type="button" variant="danger" size="sm" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
            {t('admin.settings.gatewayForwarding.codexRemoveRow')}
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange([...rows, whitelist ? { originator: '', uaContains: '', skipEngineFingerprint: false } : { originator: '', uaContains: '' }])
          }
        >
          {t('admin.settings.gatewayForwarding.codexAddRow')}
        </Button>
      </div>
    </div>
  )
}

export function CodexHardeningSection() {
  const { t } = useI18n()
  const { form, updateForm, draft, updateDraft } = useSettings()
  const fingerprintRows = draft.codexFingerprintRows
  const setFingerprintRows = (rows: FingerprintSignalRow[]) => updateDraft({ codexFingerprintRows: rows })
  const updateFingerprint = (index: number, patch: Partial<FingerprintSignalRow>) =>
    setFingerprintRows(fingerprintRows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const noRequired = !fingerprintRows.some((r) => r.required)

  return (
    <SettingsRegion title={t('admin.settings.gatewayForwarding.codexHardeningTitle')}>
      <div className={s.column}>
        <div className={s.columnTight}>
          <h3 className={s.itemTitle}>{t('admin.settings.gatewayForwarding.codexClientRestrictionTitle')}</h3>
          <p className={s.hint}>{t('admin.settings.gatewayForwarding.codexHardeningDesc')}</p>
        </div>
        <div className={s.grid2}>
          <Field label={t('admin.settings.gatewayForwarding.minCodexVersion')}>
            <input
              type="text"
              className={cx(s.input, s.mono)}
              value={form.min_codex_version}
              placeholder={t('admin.settings.gatewayForwarding.minCodexVersionPlaceholder')}
              onChange={(e) => updateForm({ min_codex_version: e.target.value })}
            />
          </Field>
          <Field label={t('admin.settings.gatewayForwarding.maxCodexVersion')}>
            <input
              type="text"
              className={cx(s.input, s.mono)}
              value={form.max_codex_version}
              placeholder={t('admin.settings.gatewayForwarding.maxCodexVersionPlaceholder')}
              onChange={(e) => updateForm({ max_codex_version: e.target.value })}
            />
          </Field>
        </div>
        <p className={s.hint}>{t('admin.settings.gatewayForwarding.codexVersionHint')}</p>
      </div>

      <Field label={t('admin.settings.gatewayForwarding.codexFingerprintSignals')}>
        <p className={s.hint}>{t('admin.settings.gatewayForwarding.codexFingerprintSignalsDesc')}</p>
        <div className={s.columnTight}>
          {fingerprintRows.map((row, i) => (
            <div key={`codex-fp-${i}`} className={s.inline}>
              <select
                className={cx(s.select, s.inputNarrow)}
                value={row.type}
                aria-label={t('admin.settings.gatewayForwarding.codexFingerprintSignals')}
                onChange={(e) => updateFingerprint(i, { type: e.target.value as FingerprintSignalType })}
              >
                <option value="header_exact">{t('admin.settings.gatewayForwarding.codexFpTypeHeaderExact')}</option>
                <option value="header_prefix">{t('admin.settings.gatewayForwarding.codexFpTypeHeaderPrefix')}</option>
                <option value="body_path">{t('admin.settings.gatewayForwarding.codexFpTypeBodyPath')}</option>
              </select>
              <input
                type="text"
                className={cx(s.input, s.mono, s.grow)}
                style={{ flex: '1 1 12rem', width: 'auto' }}
                value={row.match}
                placeholder={t('admin.settings.gatewayForwarding.codexFpMatchPlaceholder')}
                onChange={(e) => updateFingerprint(i, { match: e.target.value })}
              />
              <label className={s.checkboxLabel}>
                <input type="checkbox" checked={row.required} onChange={(e) => updateFingerprint(i, { required: e.target.checked })} />
                {t('admin.settings.gatewayForwarding.codexFpRequired')}
              </label>
              <Button type="button" variant="danger" size="sm" onClick={() => setFingerprintRows(fingerprintRows.filter((_, idx) => idx !== i))}>
                {t('admin.settings.gatewayForwarding.codexRemoveRow')}
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setFingerprintRows([...fingerprintRows, { type: 'header_exact', match: '', required: false }])}
            >
              {t('admin.settings.gatewayForwarding.codexAddRow')}
            </Button>
          </div>
          {noRequired ? <p className={s.warningText}>{t('admin.settings.gatewayForwarding.codexFingerprintNoRequiredWarn')}</p> : null}
        </div>
      </Field>

      <ToggleRow
        label={t('admin.settings.gatewayForwarding.codexAllowAppServer')}
        description={t('admin.settings.gatewayForwarding.codexAllowAppServerDesc')}
        checked={form.codex_cli_only_allow_app_server_clients}
        onChange={(value) => updateForm({ codex_cli_only_allow_app_server_clients: value })}
      />

      <Field label={t('admin.settings.gatewayForwarding.codexBlacklist')}>
        <p className={s.hint}>{t('admin.settings.gatewayForwarding.codexBlacklistDesc')}</p>
        <CodexRowsEditor rows={draft.codexBlacklistRows} onChange={(rows) => updateDraft({ codexBlacklistRows: rows })} />
      </Field>

      <Field label={t('admin.settings.gatewayForwarding.codexWhitelist')}>
        <p className={s.hint}>{t('admin.settings.gatewayForwarding.codexWhitelistDesc')}</p>
        <CodexRowsEditor rows={draft.codexWhitelistRows} onChange={(rows) => updateDraft({ codexWhitelistRows: rows })} whitelist />
      </Field>
    </SettingsRegion>
  )
}

type AdvancedOverrideKey =
  | 'openai_advanced_scheduler_lb_top_k'
  | 'openai_advanced_scheduler_weight_priority'
  | 'openai_advanced_scheduler_weight_load'
  | 'openai_advanced_scheduler_weight_queue'
  | 'openai_advanced_scheduler_weight_error_rate'
  | 'openai_advanced_scheduler_weight_ttft'
  | 'openai_advanced_scheduler_weight_reset'
  | 'openai_advanced_scheduler_weight_quota_headroom'
  | 'openai_advanced_scheduler_weight_upstream_cost'
  | 'openai_advanced_scheduler_weight_previous_response'
  | 'openai_advanced_scheduler_weight_session_sticky'

const ADVANCED_WEIGHT_FIELDS: Array<{ key: AdvancedOverrideKey; labelKey: string; fallback: string }> = [
  { key: 'openai_advanced_scheduler_lb_top_k', labelKey: 'topKLabel', fallback: '7' },
  { key: 'openai_advanced_scheduler_weight_priority', labelKey: 'priorityWeight', fallback: '1' },
  { key: 'openai_advanced_scheduler_weight_load', labelKey: 'loadWeight', fallback: '1' },
  { key: 'openai_advanced_scheduler_weight_queue', labelKey: 'queueWeight', fallback: '0.7' },
  { key: 'openai_advanced_scheduler_weight_error_rate', labelKey: 'errorRateWeight', fallback: '0.8' },
  { key: 'openai_advanced_scheduler_weight_ttft', labelKey: 'ttftWeight', fallback: '0.5' },
  { key: 'openai_advanced_scheduler_weight_reset', labelKey: 'resetWeight', fallback: '0' },
  { key: 'openai_advanced_scheduler_weight_quota_headroom', labelKey: 'quotaHeadroomWeight', fallback: '0' },
  { key: 'openai_advanced_scheduler_weight_upstream_cost', labelKey: 'upstreamCostWeight', fallback: '0' },
  { key: 'openai_advanced_scheduler_weight_previous_response', labelKey: 'previousResponseWeight', fallback: '5' },
  { key: 'openai_advanced_scheduler_weight_session_sticky', labelKey: 'sessionStickyWeight', fallback: '3' }
]

function OAuthRateRow({ description }: { description: string }) {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  const value = form.openai_oauth_scheduling_rate_multiplier
  return (
    <div className={s.row}>
      <div className={s.rowHead}>
        <div className={s.rowText}>
          <label className={s.rowLabel} htmlFor="openai-oauth-scheduling-rate-multiplier">
            {t('admin.settings.openaiExperimentalScheduler.oauthRateTitle')}
          </label>
          <p className={s.rowDescription}>{description}</p>
        </div>
        <div className={cx(s.inputWithSuffix, s.inputNarrow)}>
          <input
            id="openai-oauth-scheduling-rate-multiplier"
            className={s.input}
            data-testid="openai-oauth-scheduling-rate-multiplier"
            min="0"
            step="0.01"
            type="number"
            value={value ?? ''}
            onChange={(e) => updateForm({ openai_oauth_scheduling_rate_multiplier: numberInputValue(e.target.value) })}
          />
          <span className={s.inputSuffix}>x</span>
        </div>
      </div>
    </div>
  )
}

export function SchedulingSection() {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  const advanced = form.openai_advanced_scheduler_enabled
  const effective = form as unknown as Record<string, unknown>

  return (
    <SettingsRegion title={t('admin.settings.scheduling.title')} description={t('admin.settings.scheduling.description')}>
      <ToggleRow
        label={t('admin.settings.scheduling.strictPriorityFallback')}
        description={t('admin.settings.scheduling.strictPriorityFallbackHint')}
        checked={form.strict_priority_fallback}
        onChange={(value) => updateForm({ strict_priority_fallback: value })}
        switchTestId="strict-priority-fallback-toggle"
      />
      <div className={s.grid2}>
        <Field
          label={t('admin.settings.scheduling.strictPriorityRetryCount')}
          htmlFor="strict-priority-retry-count"
          hint={t('admin.settings.scheduling.strictPriorityRetryCountHint')}
        >
          <input
            id="strict-priority-retry-count"
            type="number"
            min="0"
            max="10"
            step="1"
            className={cx(s.input, s.inputNarrow)}
            value={form.strict_priority_retry_count ?? ''}
            disabled={!form.strict_priority_fallback}
            data-testid="strict-priority-retry-count"
            onChange={(e) => updateForm({ strict_priority_retry_count: numberInputValue(e.target.value) as number })}
          />
        </Field>
        <Field
          label={t('admin.settings.scheduling.strictPriorityCooldownMinutes')}
          htmlFor="strict-priority-cooldown-minutes"
          hint={t('admin.settings.scheduling.strictPriorityCooldownMinutesHint')}
        >
          <input
            id="strict-priority-cooldown-minutes"
            type="number"
            min="0"
            max="1440"
            step="1"
            className={cx(s.input, s.inputNarrow)}
            value={form.strict_priority_cooldown_minutes ?? ''}
            disabled={!form.strict_priority_fallback}
            data-testid="strict-priority-cooldown-minutes"
            onChange={(e) => updateForm({ strict_priority_cooldown_minutes: numberInputValue(e.target.value) as number })}
          />
        </Field>
      </div>
      <ToggleRow
        label={t('admin.settings.scheduling.allowUngroupedKey')}
        description={t('admin.settings.scheduling.allowUngroupedKeyHint')}
        checked={form.allow_ungrouped_key_scheduling}
        onChange={(value) => updateForm({ allow_ungrouped_key_scheduling: value })}
      />
      <div className={s.column}>
        <div className={s.columnTight}>
          <span className={s.label}>{t('admin.settings.scheduling.accountSchedulingThresholdsTitle')}</span>
          <p className={s.hint}>{t('admin.settings.scheduling.accountSchedulingThresholdsDescription')}</p>
          <p className={s.hint}>{t('admin.settings.scheduling.accountSchedulingThresholdsGlobalHint')}</p>
          <p className={s.warningText}>{t('admin.settings.scheduling.accountSchedulingThresholdsDisabledHint')}</p>
        </div>
        <div className={s.grid3}>
          {SCHEDULING_THRESHOLD_PLATFORMS.map((platform) => (
            <div key={platform} className={s.item}>
              <div className={s.itemHead}>
                <div className={s.columnTight}>
                  <label className={cx(s.label, s.mono)} htmlFor={`account-scheduling-threshold-${platform}`}>
                    {platform}
                  </label>
                  <p className={s.hint}>{t('admin.settings.scheduling.accountSchedulingThresholdsRangeHint')}</p>
                </div>
                <span className={s.chip}>%</span>
              </div>
              <input
                id={`account-scheduling-threshold-${platform}`}
                type="number"
                min="1"
                max="100"
                step="1"
                className={s.input}
                placeholder="100"
                data-testid={`account-scheduling-threshold-${platform}`}
                value={form.account_scheduling_thresholds[platform] ?? ''}
                onChange={(e) =>
                  updateForm((f) => ({
                    account_scheduling_thresholds: {
                      ...f.account_scheduling_thresholds,
                      [platform]: numberInputValue(e.target.value) as number
                    }
                  }))
                }
              />
            </div>
          ))}
        </div>
      </div>
      {!advanced ? (
        <ToggleRow
          label={t('admin.settings.openaiExperimentalScheduler.lowRatePriorityTitle')}
          description={t('admin.settings.openaiExperimentalScheduler.lowRatePriorityDescription')}
          checked={form.openai_low_upstream_rate_priority_enabled}
          onChange={(value) => updateForm({ openai_low_upstream_rate_priority_enabled: value })}
          switchTestId="openai-low-rate-priority-toggle"
        />
      ) : null}
      {!advanced && form.openai_low_upstream_rate_priority_enabled ? (
        <OAuthRateRow description={t('admin.settings.openaiExperimentalScheduler.oauthRatePriorityDescription')} />
      ) : null}
      <ToggleRow
        label={t('admin.settings.openaiExperimentalScheduler.title')}
        description={t('admin.settings.openaiExperimentalScheduler.description')}
        checked={advanced}
        onChange={(value) => updateForm({ openai_advanced_scheduler_enabled: value })}
        switchTestId="openai-advanced-scheduler-toggle"
      />
      {advanced ? (
        <ToggleRow
          label={t('admin.settings.openaiExperimentalScheduler.stickyWeightedTitle')}
          description={t('admin.settings.openaiExperimentalScheduler.stickyWeightedDescription')}
          checked={form.openai_advanced_scheduler_sticky_weighted_enabled}
          onChange={(value) => updateForm({ openai_advanced_scheduler_sticky_weighted_enabled: value })}
        />
      ) : null}
      {advanced ? (
        <ToggleRow
          label={t('admin.settings.openaiExperimentalScheduler.subscriptionPriorityTitle')}
          description={t('admin.settings.openaiExperimentalScheduler.subscriptionPriorityDescription')}
          checked={form.openai_advanced_scheduler_subscription_priority_enabled}
          onChange={(value) => updateForm({ openai_advanced_scheduler_subscription_priority_enabled: value })}
        />
      ) : null}
      {advanced ? <OAuthRateRow description={t('admin.settings.openaiExperimentalScheduler.oauthRateWeightedDescription')} /> : null}
      {advanced ? (
        <div className={s.column}>
          <div className={s.columnTight}>
            <span className={s.label}>{t('admin.settings.openaiExperimentalScheduler.weightsTitle')}</span>
            <p className={s.hint}>{t('admin.settings.openaiExperimentalScheduler.weightsDescription')}</p>
          </div>
          <div className={s.grid4}>
            {ADVANCED_WEIGHT_FIELDS.map((field) => {
              const effectiveValue = String(effective[field.key.replace('openai_advanced_scheduler_', 'openai_advanced_scheduler_effective_')] ?? '').trim()
              const label = t(`admin.settings.openaiExperimentalScheduler.${field.labelKey}`)
              return (
                <label key={field.key} className={s.field}>
                  <span className={s.hint}>{label}</span>
                  <input
                    className={s.input}
                    inputMode="decimal"
                    type="text"
                    placeholder={t('admin.settings.openaiExperimentalScheduler.defaultPlaceholder', {
                      value: effectiveValue || field.fallback
                    })}
                    value={form[field.key]}
                    onChange={(e) => updateForm({ [field.key]: e.target.value } as Partial<SettingsForm>)}
                  />
                </label>
              )
            })}
          </div>
        </div>
      ) : null}
    </SettingsRegion>
  )
}

export function UsageRecordsSection() {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  return (
    <SettingsRegion title={t('admin.settings.usageRecords.title')} description={t('admin.settings.usageRecords.description')}>
      <ToggleRow
        label={t('admin.settings.user_error_view.label')}
        description={t('admin.settings.user_error_view.description')}
        checked={form.allow_user_view_error_requests}
        onChange={(value) => updateForm({ allow_user_view_error_requests: value })}
      />
    </SettingsRegion>
  )
}
