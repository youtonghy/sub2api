/** 用户 Tab：注册默认值（余额、并发、默认订阅、平台限额）与按认证来源的默认值 */
import type {
  AuthSourceDefaultsValue,
  AuthSourceType,
  DefaultPlatformQuotasMap,
  DefaultSubscriptionSetting,
  PlatformQuotaLimits
} from '@/api/admin/settings'
import { Button } from '@/components/arc/button/button'
import { Field, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import GroupBadge from '@/components/common/GroupBadge'
import GroupOptionItem from '@/components/common/GroupOptionItem'
import Select, { type SelectOption } from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import type { AdminGroup } from '@/types'
import { authSourceDefaultsMeta } from './authSourceMeta'
import { useSettings } from './settingsContext'
import { platformQuotaRows } from './settingsHelpers'

interface GroupOption extends SelectOption {
  value: number
  description: string | null
  platform: AdminGroup['platform']
  subscriptionType: AdminGroup['subscription_type']
  rate: number
}

function SubscriptionList({
  items,
  onChange,
  options,
  emptyText,
  keyPrefix
}: {
  items: DefaultSubscriptionSetting[]
  onChange: (items: DefaultSubscriptionSetting[]) => void
  options: GroupOption[]
  emptyText: string
  keyPrefix: string
}) {
  const { t } = useI18n()
  if (items.length === 0) return <p className={s.empty}>{emptyText}</p>
  const update = (index: number, patch: Partial<DefaultSubscriptionSetting>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  return (
    <div className={s.columnTight}>
      {items.map((item, index) => (
        <div key={`${keyPrefix}-sub-${index}`} className={cx(s.item, s.grid3)} style={{ alignItems: 'end' }}>
          <Field label={t('admin.settings.defaults.subscriptionGroup')}>
            <Select
              value={item.group_id}
              options={options}
              placeholder={t('admin.settings.defaults.subscriptionGroup')}
              onChange={(value) => update(index, { group_id: Number(value) })}
              renderSelected={(option) => {
                const o = option as GroupOption | null
                return o ? (
                  <GroupBadge name={o.label} platform={o.platform} subscriptionType={o.subscriptionType} rateMultiplier={o.rate} />
                ) : (
                  <span className={s.muted}>{t('admin.settings.defaults.subscriptionGroup')}</span>
                )
              }}
              renderOption={(option, selected) => {
                const o = option as GroupOption
                return (
                  <GroupOptionItem
                    name={o.label}
                    platform={o.platform}
                    subscriptionType={o.subscriptionType}
                    rateMultiplier={o.rate}
                    description={o.description}
                    selected={selected}
                  />
                )
              }}
            />
          </Field>
          <Field label={t('admin.settings.defaults.subscriptionValidityDays')}>
            <input
              type="number"
              min="1"
              max="36500"
              className={s.input}
              value={item.validity_days}
              onChange={(e) => update(index, { validity_days: numberInputValue(e.target.value) as number })}
            />
          </Field>
          <div>
            <Button type="button" variant="danger" size="sm" onClick={() => onChange(items.filter((_, i) => i !== index))}>
              {t('common.delete')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function PlatformQuotaTable({ map, onChange }: { map: DefaultPlatformQuotasMap; onChange: (map: DefaultPlatformQuotasMap) => void }) {
  const { t } = useI18n()
  const windows: Array<keyof PlatformQuotaLimits> = ['daily', 'weekly', 'monthly']
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>{t('admin.settings.platformQuota.platform')}</th>
            <th>{t('admin.settings.platformQuota.daily')}</th>
            <th>{t('admin.settings.platformQuota.weekly')}</th>
            <th>{t('admin.settings.platformQuota.monthly')}</th>
          </tr>
        </thead>
        <tbody>
          {platformQuotaRows(map).map((platform) => {
            const key = platform as keyof DefaultPlatformQuotasMap
            const row = map[key]!
            return (
              <tr key={platform}>
                <td>
                  <span className={s.mono}>{platform}</span>
                </td>
                {windows.map((window) => (
                  <td key={window}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className={s.input}
                      aria-label={`${platform} ${t(`admin.settings.platformQuota.${window}`)}`}
                      placeholder={t('admin.settings.platformQuota.placeholder')}
                      value={row[window] ?? ''}
                      onChange={(e) =>
                        // 与 v-model.number 一致：清空时为 ""，提交时由 sanitizePlatformQuotasMap 清洗为 null
                        onChange({ ...map, [key]: { ...row, [window]: numberInputValue(e.target.value) as number | null } })
                      }
                    />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function UsersTab() {
  const { t } = useI18n()
  const { form, updateForm, draft, updateDraft, subscriptionGroups, localText } = useSettings()
  const options: GroupOption[] = subscriptionGroups.map((group) => ({
    value: group.id,
    label: group.name,
    description: group.description,
    platform: group.platform,
    subscriptionType: group.subscription_type,
    rate: group.rate_multiplier
  }))

  function nextCandidate(existing: number[]): AdminGroup | undefined {
    const set = new Set(existing)
    return subscriptionGroups.find((group) => !set.has(group.id))
  }
  function updateSource(source: AuthSourceType, patch: Partial<AuthSourceDefaultsValue>) {
    updateDraft((d) => ({
      authSourceDefaults: { ...d.authSourceDefaults, [source]: { ...d.authSourceDefaults[source], ...patch } }
    }))
  }

  return (
    <>
      <SettingsRegion title={t('admin.settings.defaults.title')} description={t('admin.settings.defaults.description')}>
        <div className={s.grid3}>
          <Field label={t('admin.settings.defaults.defaultBalance')} hint={t('admin.settings.defaults.defaultBalanceHint')}>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              className={s.input}
              value={form.default_balance}
              onChange={(e) => updateForm({ default_balance: numberInputValue(e.target.value) as number })}
            />
          </Field>
          <Field label={t('admin.settings.defaults.defaultConcurrency')} hint={t('admin.settings.defaults.defaultConcurrencyHint')}>
            <input
              type="number"
              min="1"
              placeholder="1"
              className={s.input}
              value={form.default_concurrency}
              onChange={(e) => updateForm({ default_concurrency: numberInputValue(e.target.value) as number })}
            />
          </Field>
          <Field label={t('admin.settings.defaults.defaultUserRpmLimit')} hint={t('admin.settings.defaults.defaultUserRpmLimitHint')}>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="0"
              className={s.input}
              value={form.default_user_rpm_limit}
              onChange={(e) => updateForm({ default_user_rpm_limit: numberInputValue(e.target.value) as number })}
            />
          </Field>
        </div>
        <Field
          label={t('admin.settings.defaults.defaultSubscriptions')}
          labelExtra={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={subscriptionGroups.length === 0}
              onClick={() => {
                const candidate = nextCandidate(form.default_subscriptions.map((item) => item.group_id))
                if (!candidate) return
                updateForm((f) => ({ default_subscriptions: [...f.default_subscriptions, { group_id: candidate.id, validity_days: 30 }] }))
              }}
            >
              {t('admin.settings.defaults.addDefaultSubscription')}
            </Button>
          }
        >
          <p className={s.hint}>{t('admin.settings.defaults.defaultSubscriptionsHint')}</p>
          <SubscriptionList
            keyPrefix="default"
            items={form.default_subscriptions}
            options={options}
            emptyText={t('admin.settings.defaults.defaultSubscriptionsEmpty')}
            onChange={(items) => updateForm({ default_subscriptions: items })}
          />
        </Field>
        {/* 系统全局默认平台限额矩阵 */}
        <Field label={t('admin.settings.defaults.defaultPlatformQuotas')}>
          <p className={s.hint}>{t('admin.settings.defaults.defaultPlatformQuotasHint')}</p>
          <p className={s.warningText}>{t('admin.settings.defaults.platformQuotaNotice')}</p>
          <PlatformQuotaTable map={form.default_platform_quotas} onChange={(map) => updateForm({ default_platform_quotas: map })} />
        </Field>
      </SettingsRegion>

      <SettingsRegion title={t('admin.settings.authSourceDefaults.title')} description={t('admin.settings.authSourceDefaults.description')}>
        <ToggleRow
          label={t('admin.settings.authSourceDefaults.requireEmailLabel')}
          description={t('admin.settings.authSourceDefaults.requireEmailHint')}
          checked={form.force_email_on_third_party_signup}
          onChange={(value) => updateForm({ force_email_on_third_party_signup: value })}
        />
        {authSourceDefaultsMeta(t, localText).map((authSource) => {
          const value = draft.authSourceDefaults[authSource.source]
          return (
            <ToggleRow
              key={authSource.source}
              label={authSource.title}
              description={authSource.description}
              checked={value.grant_on_signup}
              onChange={(grant_on_signup) => updateSource(authSource.source, { grant_on_signup })}
              switchTestId={`auth-source-${authSource.source}-enabled`}
            >
              {value.grant_on_signup ? (
                <div className={s.column} data-testid={`auth-source-${authSource.source}-panel`}>
                  <p className={s.hint}>{t('admin.settings.authSourceDefaults.enabledHint')}</p>
                  <div className={s.grid2}>
                    <Field label={t('admin.settings.defaults.defaultBalance')}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className={s.input}
                        value={value.balance}
                        onChange={(e) => updateSource(authSource.source, { balance: numberInputValue(e.target.value) as number })}
                      />
                    </Field>
                    <Field label={t('admin.settings.defaults.defaultConcurrency')}>
                      <input
                        type="number"
                        min="1"
                        placeholder="5"
                        className={s.input}
                        value={value.concurrency}
                        onChange={(e) => updateSource(authSource.source, { concurrency: numberInputValue(e.target.value) as number })}
                      />
                    </Field>
                  </div>
                  <ToggleRow
                    label={t('admin.settings.authSourceDefaults.grantOnFirstBindLabel')}
                    description={t('admin.settings.authSourceDefaults.grantOnFirstBindHint')}
                    checked={value.grant_on_first_bind}
                    onChange={(grant_on_first_bind) => updateSource(authSource.source, { grant_on_first_bind })}
                  />
                  <Field
                    label={t('admin.settings.authSourceDefaults.defaultSubscriptionsLabel')}
                    labelExtra={
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={subscriptionGroups.length === 0}
                        onClick={() => {
                          const candidate = nextCandidate(value.subscriptions.map((item) => item.group_id))
                          if (!candidate) return
                          updateSource(authSource.source, {
                            subscriptions: [...value.subscriptions, { group_id: candidate.id, validity_days: 30 }]
                          })
                        }}
                      >
                        {t('admin.settings.defaults.addDefaultSubscription')}
                      </Button>
                    }
                  >
                    <p className={s.hint}>{t('admin.settings.authSourceDefaults.defaultSubscriptionsHint')}</p>
                    <SubscriptionList
                      keyPrefix={authSource.source}
                      items={value.subscriptions}
                      options={options}
                      emptyText={t('admin.settings.authSourceDefaults.noSourceSubscriptions')}
                      onChange={(subscriptions) => updateSource(authSource.source, { subscriptions })}
                    />
                  </Field>
                  {/* auth source 平台限额覆盖区块 */}
                  <Field label={t('admin.settings.authSourceDefaults.platformQuotasOverride')}>
                    <p className={s.hint}>{t('admin.settings.authSourceDefaults.platformQuotasOverrideHint')}</p>
                    <PlatformQuotaTable
                      map={value.platform_quotas}
                      onChange={(platform_quotas) => updateSource(authSource.source, { platform_quotas })}
                    />
                  </Field>
                </div>
              ) : null}
            </ToggleRow>
          )
        })}
      </SettingsRegion>
    </>
  )
}
