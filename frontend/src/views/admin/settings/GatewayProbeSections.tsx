/** 网关 Tab 中独立保存的用量/倍率探测设置：上游倍率自动探测、Ollama Cloud 与 OpenCode Go 用量刷新 */
import type { KeyboardEvent } from 'react'

import { adminAPI } from '@/api'
import { Field, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import { useI18n } from '@/i18n/useI18n'
import type { OllamaCloudUsageSettings, OpenCodeGoUsageSettings, UpstreamBillingProbeSettings } from '@/types'
import IndependentSettingsRegion from './IndependentSettingsRegion'
import { useIndependentSettings } from './useIndependentSettings'

function enterToSave(save: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    save()
  }
}

function MinutesInput({
  id,
  label,
  hint,
  value,
  min,
  max,
  testId,
  onChange,
  onEnter
}: {
  id: string
  label: string
  hint: string
  value: number
  min: number
  max: number
  testId: string
  onChange: (value: number) => void
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        className={cx(s.input, s.inputNarrow)}
        value={value}
        data-testid={testId}
        onChange={(e) => onChange(numberInputValue(e.target.value) as number)}
        onKeyDown={onEnter}
      />
    </Field>
  )
}

export function UpstreamBillingProbeSection() {
  const { t } = useI18n()
  const { form, patch, loading, saving, save } = useIndependentSettings<UpstreamBillingProbeSettings>({
    defaults: { enabled: true, all_accounts: false, interval_minutes: 30 },
    load: () => adminAPI.accounts.getUpstreamBillingProbeSettings(),
    save: (f) => adminAPI.accounts.updateUpstreamBillingProbeSettings({ ...f }),
    savedKey: 'admin.settings.upstreamBillingProbe.saved',
    saveFailedKey: 'admin.settings.upstreamBillingProbe.saveFailed'
  })
  return (
    <IndependentSettingsRegion
      data-testid="upstream-billing-probe-settings"
      saveTestId="upstream-billing-probe-save"
      title={t('admin.settings.upstreamBillingProbe.title')}
      description={t('admin.settings.upstreamBillingProbe.description')}
      loading={loading}
      saving={saving}
      onSave={() => void save()}
    >
      <ToggleRow
        label={t('admin.settings.upstreamBillingProbe.enabled')}
        description={t('admin.settings.upstreamBillingProbe.enabledHint')}
        checked={form.enabled}
        onChange={(enabled) => patch({ enabled })}
        switchTestId="upstream-billing-probe-enabled"
      >
        {form.enabled ? (
          <>
            <ToggleRow
              label={t('admin.settings.upstreamBillingProbe.allAccounts')}
              description={t('admin.settings.upstreamBillingProbe.allAccountsHint')}
              checked={form.all_accounts}
              onChange={(all_accounts) => patch({ all_accounts })}
              switchTestId="upstream-billing-probe-all-accounts"
            />
            <MinutesInput
              id="upstream-billing-probe-interval"
              label={t('admin.settings.upstreamBillingProbe.intervalMinutes')}
              hint={t('admin.settings.upstreamBillingProbe.intervalHint')}
              value={form.interval_minutes}
              min={5}
              max={1440}
              testId="upstream-billing-probe-interval"
              onChange={(interval_minutes) => patch({ interval_minutes })}
              onEnter={enterToSave(() => void save())}
            />
          </>
        ) : null}
      </ToggleRow>
    </IndependentSettingsRegion>
  )
}

type UsageSettings = OllamaCloudUsageSettings | OpenCodeGoUsageSettings

function UsageRefreshSection({
  prefix,
  testPrefix,
  intervalMin,
  load,
  saveRequest
}: {
  prefix: 'ollamaCloudUsage' | 'opencodeGoUsage'
  testPrefix: string
  intervalMin: number
  load: () => Promise<UsageSettings>
  saveRequest: (form: UsageSettings) => Promise<UsageSettings>
}) {
  const { t } = useI18n()
  const { form, patch, loading, saving, save } = useIndependentSettings<UsageSettings>({
    // Keep the fail-safe disabled defaults when this optional setting cannot be loaded.
    defaults: { enabled: false, interval_minutes: prefix === 'ollamaCloudUsage' ? 60 : 15, debounce_minutes: 1 },
    load,
    save: (f) => saveRequest({ ...f }),
    savedKey: `admin.settings.${prefix}.saved`,
    saveFailedKey: `admin.settings.${prefix}.saveFailed`
  })
  const onEnter = enterToSave(() => void save())
  return (
    <IndependentSettingsRegion
      data-testid={`${testPrefix}-global-settings`}
      saveTestId={`${testPrefix}-global-save`}
      title={t(`admin.settings.${prefix}.title`)}
      description={t(`admin.settings.${prefix}.description`)}
      loading={loading}
      saving={saving}
      onSave={() => void save()}
    >
      <ToggleRow
        label={t(`admin.settings.${prefix}.enabled`)}
        description={t(`admin.settings.${prefix}.enabledHint`)}
        checked={form.enabled}
        onChange={(enabled) => patch({ enabled })}
        switchTestId={`${testPrefix}-global-enabled`}
      >
        {form.enabled ? (
          <>
            <MinutesInput
              id={`${testPrefix}-debounce`}
              label={t(`admin.settings.${prefix}.debounceMinutes`)}
              hint={t(`admin.settings.${prefix}.debounceHint`)}
              value={form.debounce_minutes}
              min={1}
              max={60}
              testId={`${testPrefix}-global-debounce`}
              onChange={(debounce_minutes) => patch({ debounce_minutes })}
              onEnter={onEnter}
            />
            <MinutesInput
              id={`${testPrefix}-interval`}
              label={t(`admin.settings.${prefix}.intervalMinutes`)}
              hint={t(`admin.settings.${prefix}.intervalHint`)}
              value={form.interval_minutes}
              min={intervalMin}
              max={1440}
              testId={`${testPrefix}-global-interval`}
              onChange={(interval_minutes) => patch({ interval_minutes })}
              onEnter={onEnter}
            />
          </>
        ) : null}
      </ToggleRow>
    </IndependentSettingsRegion>
  )
}

export function OllamaCloudUsageSection() {
  return (
    <UsageRefreshSection
      prefix="ollamaCloudUsage"
      testPrefix="ollama-cloud-usage"
      intervalMin={15}
      load={() => adminAPI.accounts.getOllamaCloudUsageSettings()}
      saveRequest={(f) => adminAPI.accounts.updateOllamaCloudUsageSettings(f)}
    />
  )
}

export function OpenCodeGoUsageSection() {
  return (
    <UsageRefreshSection
      prefix="opencodeGoUsage"
      testPrefix="opencode-go-usage"
      intervalMin={5}
      load={() => adminAPI.accounts.getOpenCodeGoUsageSettings()}
      saveRequest={(f) => adminAPI.accounts.updateOpenCodeGoUsageSettings(f)}
    />
  )
}
