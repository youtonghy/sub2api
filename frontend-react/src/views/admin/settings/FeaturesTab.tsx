/** 功能开关 Tab：渠道监控、可用渠道、模型广场、站点类型、插件管理、风控与邀请返利 */
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { Field, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import Select from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import {
  SITE_BILLING_MODES,
  SITE_BILLING_MODE_I18N_KEYS,
  billingModeToSettings,
  resolveSiteBillingMode,
  type SiteBillingMode
} from '@/utils/siteBillingMode'
import AffiliateCustomUsersSection from './AffiliateCustomUsersSection'
import OpenAIFastPolicyUserSelector from './OpenAIFastPolicyUserSelector'
import { useSettings } from './settingsContext'
import type { SettingsForm } from './settingsForm'

function ConfigureLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={s.link}>
      {children} <span aria-hidden="true">→</span>
    </Link>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  suffix,
  label
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: string
  placeholder?: string
  suffix?: string
  label: string
}) {
  const input = (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={label}
      className={s.input}
      value={value}
      onChange={(e) => onChange(numberInputValue(e.target.value) as number)}
    />
  )
  return suffix ? (
    <div className={s.inputWithSuffix}>
      {input}
      <span className={s.inputSuffix}>{suffix}</span>
    </div>
  ) : (
    input
  )
}

export default function FeaturesTab() {
  const { t } = useI18n()
  const { form, updateForm } = useSettings()
  const set = (patch: Partial<SettingsForm>) => updateForm(patch)
  const v1 = form.channel_monitor_mode === 'v1'

  // 站点类型：由 subscription_enabled 与 payment_balance_disabled 两个开关派生的单选，
  // 保存时同时写回两者，避免出现「既无充值也无订阅」的组合。
  const siteBillingMode = resolveSiteBillingMode(form)
  const siteBillingModeOptions = SITE_BILLING_MODES.map((mode) => ({
    value: mode,
    label: t(`admin.settings.features.siteBillingMode.options.${SITE_BILLING_MODE_I18N_KEYS[mode]}`)
  }))

  // Keep the settings API representation as user IDs; the selector displays emails.
  const riskControlAllowlistedUserIds = Array.from(
    new Set(
      form.cyber_policy_user_allowlist
        .split(/[,\s]+/)
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    )
  )

  return (
    <>
      <SettingsRegion
        title={t('admin.settings.features.channelMonitor.title')}
        description={
          <>
            {t('admin.settings.features.channelMonitor.description')}{' '}
            <ConfigureLink to="/admin/channels/monitor">{t('admin.settings.features.channelMonitor.configureLink')}</ConfigureLink>
          </>
        }
      >
        <ToggleRow
          label={t('admin.settings.features.channelMonitor.enabled')}
          description={t('admin.settings.features.channelMonitor.enabledHint')}
          checked={form.channel_monitor_enabled}
          onChange={(value) => set({ channel_monitor_enabled: value })}
        >
          {form.channel_monitor_enabled ? (
            <>
              <Field
                label={t('admin.settings.features.channelMonitor.mode')}
                hint={
                  <>
                    {v1 ? t('admin.settings.features.channelMonitor.modeV1Hint') : t('admin.settings.features.channelMonitor.modeV2Hint')}
                    <br />
                    {t('admin.settings.features.channelMonitor.modeHint')}
                  </>
                }
              >
                <div className={s.choiceGroup}>
                  <button type="button" className={s.choice} aria-pressed={!v1} onClick={() => set({ channel_monitor_mode: 'v2' })}>
                    {t('admin.settings.features.channelMonitor.modeV2')}
                  </button>
                  <button type="button" className={s.choice} aria-pressed={v1} onClick={() => set({ channel_monitor_mode: 'v1' })}>
                    {t('admin.settings.features.channelMonitor.modeV1')}
                  </button>
                </div>
              </Field>
              {v1 ? (
                <Field
                  label={`${t('admin.settings.features.channelMonitor.defaultInterval')} *`}
                  hint={t('admin.settings.features.channelMonitor.defaultIntervalHint')}
                >
                  <div className={s.inputNarrow}>
                    <NumberInput
                      label={t('admin.settings.features.channelMonitor.defaultInterval')}
                      value={form.channel_monitor_default_interval_seconds}
                      min={15}
                      max={3600}
                      onChange={(value) => set({ channel_monitor_default_interval_seconds: value })}
                    />
                  </div>
                </Field>
              ) : (
                <>
                  <ToggleRow
                    label={t('admin.settings.features.channelMonitor.hideThroughput')}
                    description={t('admin.settings.features.channelMonitor.hideThroughputHint')}
                    checked={form.channel_monitor_hide_throughput}
                    onChange={(value) => set({ channel_monitor_hide_throughput: value })}
                  />
                  <ToggleRow
                    label={t('admin.settings.features.channelMonitor.hideUserRanking')}
                    description={t('admin.settings.features.channelMonitor.hideUserRankingHint')}
                    checked={form.channel_monitor_hide_user_ranking}
                    onChange={(value) => set({ channel_monitor_hide_user_ranking: value })}
                  />
                </>
              )}
              {v1 ? (
                <ToggleRow
                  label={t('admin.settings.features.channelMonitor.showQuota')}
                  description={t('admin.settings.features.channelMonitor.showQuotaHint')}
                  checked={form.channel_monitor_show_quota}
                  onChange={(value) => set({ channel_monitor_show_quota: value })}
                />
              ) : null}
            </>
          ) : null}
        </ToggleRow>
      </SettingsRegion>

      <SettingsRegion
        title={t('admin.settings.features.availableChannels.title')}
        description={
          <>
            {t('admin.settings.features.availableChannels.description')}{' '}
            <ConfigureLink to="/admin/channels/pricing">{t('admin.settings.features.availableChannels.configureLink')}</ConfigureLink>
          </>
        }
      >
        <ToggleRow
          label={t('admin.settings.features.availableChannels.enabled')}
          description={t('admin.settings.features.availableChannels.enabledHint')}
          checked={form.available_channels_enabled}
          onChange={(value) => set({ available_channels_enabled: value })}
        />
      </SettingsRegion>

      <SettingsRegion title={t('admin.settings.features.modelPlaza.title')} description={t('admin.settings.features.modelPlaza.description')}>
        <ToggleRow
          label={t('admin.settings.features.modelPlaza.enabled')}
          description={t('admin.settings.features.modelPlaza.enabledHint')}
          checked={form.model_plaza_enabled}
          onChange={(value) => set({ model_plaza_enabled: value })}
        >
          {form.model_plaza_enabled ? (
            <>
              <ToggleRow
                label={t('admin.settings.features.modelPlaza.requireAuth')}
                description={t('admin.settings.features.modelPlaza.requireAuthHint')}
                checked={form.model_plaza_require_auth}
                onChange={(value) => set({ model_plaza_require_auth: value })}
              />
              <Field label={t('admin.settings.features.modelPlaza.priceDescription')} hint={t('admin.settings.features.modelPlaza.priceDescriptionHint')}>
                <textarea
                  rows={6}
                  className={s.textarea}
                  value={form.model_plaza_description}
                  onChange={(e) => set({ model_plaza_description: e.target.value })}
                />
              </Field>
            </>
          ) : null}
        </ToggleRow>
      </SettingsRegion>

      <SettingsRegion
        title={t('admin.settings.features.siteBillingMode.title')}
        description={t('admin.settings.features.siteBillingMode.description')}
      >
        <Field label={t('admin.settings.features.siteBillingMode.label')}>
          <p className={s.hint}>{t(`admin.settings.features.siteBillingMode.hints.${SITE_BILLING_MODE_I18N_KEYS[siteBillingMode]}`)}</p>
          <div className={s.inputMedium}>
            <Select
              value={siteBillingMode}
              options={siteBillingModeOptions}
              onChange={(value) => set(billingModeToSettings(value as SiteBillingMode))}
            />
          </div>
        </Field>
      </SettingsRegion>

      <SettingsRegion
        title={t('admin.settings.features.pluginManagement.title')}
        description={t('admin.settings.features.pluginManagement.description')}
      >
        <ToggleRow
          label={t('admin.settings.features.pluginManagement.enabled')}
          description={t('admin.settings.features.pluginManagement.enabledHint')}
          checked={form.plugin_management_enabled}
          onChange={(value) => set({ plugin_management_enabled: value })}
        />
      </SettingsRegion>

      <SettingsRegion
        title={t('admin.settings.features.riskControl.title')}
        description={
          <>
            {t('admin.settings.features.riskControl.description')}{' '}
            <ConfigureLink to="/admin/risk-control">{t('admin.settings.features.riskControl.configureLink')}</ConfigureLink>
          </>
        }
      >
        <ToggleRow
          label={t('admin.settings.features.riskControl.enabled')}
          description={t('admin.settings.features.riskControl.enabledHint')}
          checked={form.risk_control_enabled}
          onChange={(value) => set({ risk_control_enabled: value })}
        />
        <Field
          label={t('admin.settings.features.riskControl.riskControlUserAllowlist')}
          hint={t('admin.settings.features.riskControl.riskControlUserAllowlistHint')}
        >
          <OpenAIFastPolicyUserSelector
            value={riskControlAllowlistedUserIds}
            onChange={(ids) => set({ cyber_policy_user_allowlist: ids.join(',') })}
          />
        </Field>
        <ToggleRow
          label={t('admin.settings.features.riskControl.cyberSessionBlock')}
          description={t('admin.settings.features.riskControl.cyberSessionBlockHint')}
          checked={form.cyber_session_block_enabled}
          onChange={(value) => set({ cyber_session_block_enabled: value })}
        >
          {form.cyber_session_block_enabled ? (
            <Field label={`${t('admin.settings.features.riskControl.cyberSessionBlockTTL')} *`}>
              <div className={s.inputNarrow}>
                <NumberInput
                  label={t('admin.settings.features.riskControl.cyberSessionBlockTTL')}
                  value={form.cyber_session_block_ttl_seconds}
                  min={1}
                  onChange={(value) => set({ cyber_session_block_ttl_seconds: value })}
                />
              </div>
            </Field>
          ) : null}
        </ToggleRow>
      </SettingsRegion>

      {/* Affiliate (邀请返利) feature card */}
      <SettingsRegion title={t('admin.settings.features.affiliate.title')} description={t('admin.settings.features.affiliate.description')}>
        <ToggleRow
          label={t('admin.settings.features.affiliate.enabled')}
          description={t('admin.settings.features.affiliate.enabledHint')}
          checked={form.affiliate_enabled}
          onChange={(value) => set({ affiliate_enabled: value })}
        />
        {form.affiliate_enabled ? (
          <div className={s.column}>
            <ToggleRow
              label={t('admin.settings.features.affiliate.adminRechargeRebate')}
              description={t('admin.settings.features.affiliate.adminRechargeRebateHint')}
              checked={form.affiliate_admin_recharge_enabled}
              onChange={(value) => set({ affiliate_admin_recharge_enabled: value })}
            />
            <div className={s.grid2}>
              <Field label={t('admin.settings.features.affiliate.rebateRate')} hint={t('admin.settings.features.affiliate.rebateRateHint')}>
                <NumberInput
                  label={t('admin.settings.features.affiliate.rebateRate')}
                  value={form.affiliate_rebate_rate}
                  step="0.01"
                  min={0}
                  max={100}
                  placeholder="20"
                  suffix="%"
                  onChange={(value) => set({ affiliate_rebate_rate: value })}
                />
              </Field>
              <Field label={t('admin.settings.features.affiliate.freezeHours')} hint={t('admin.settings.features.affiliate.freezeHoursDesc')}>
                <NumberInput
                  label={t('admin.settings.features.affiliate.freezeHours')}
                  value={form.affiliate_rebate_freeze_hours}
                  step="1"
                  min={0}
                  max={720}
                  onChange={(value) => set({ affiliate_rebate_freeze_hours: value })}
                />
              </Field>
              <Field label={t('admin.settings.features.affiliate.durationDays')} hint={t('admin.settings.features.affiliate.durationDaysDesc')}>
                <NumberInput
                  label={t('admin.settings.features.affiliate.durationDays')}
                  value={form.affiliate_rebate_duration_days}
                  step="1"
                  min={0}
                  max={3650}
                  onChange={(value) => set({ affiliate_rebate_duration_days: value })}
                />
              </Field>
              <Field label={t('admin.settings.features.affiliate.perInviteeCap')} hint={t('admin.settings.features.affiliate.perInviteeCapDesc')}>
                <NumberInput
                  label={t('admin.settings.features.affiliate.perInviteeCap')}
                  value={form.affiliate_rebate_per_invitee_cap}
                  step="0.01"
                  min={0}
                  onChange={(value) => set({ affiliate_rebate_per_invitee_cap: value })}
                />
              </Field>
            </div>
            {/* 专属用户管理 */}
            <div className={cx(s.column)}>
              <AffiliateCustomUsersSection enabled={form.affiliate_enabled} />
            </div>
          </div>
        ) : null}
      </SettingsRegion>
    </>
  )
}
