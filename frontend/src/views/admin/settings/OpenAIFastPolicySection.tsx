/** OpenAI Fast/Flex 策略规则（随整表保存），对应 Vue 版网关 Tab 的同名卡片 */
import { Plus, X } from 'lucide-react'

import type { OpenAIFastPolicyRule } from '@/api/admin/settings'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Field, SettingsRegion } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx } from '@/components/admin/settings/settingsUtils'
import Select from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import { StringListEditor } from './GatewayResilienceSections'
import OpenAIFastPolicyUserSelector from './OpenAIFastPolicyUserSelector'
import { useSettings } from './settingsContext'
import styles from './SettingsView.module.css'

type FastAction = OpenAIFastPolicyRule['action']

function hasTargetModels(rule: OpenAIFastPolicyRule) {
  return Boolean(rule.model_whitelist?.some((pattern) => pattern.trim() !== ''))
}

export default function OpenAIFastPolicySection() {
  const { t } = useI18n()
  const { draft, updateDraft } = useSettings()
  const rules = draft.openaiFastPolicyRules

  const tierOptions = [
    { value: 'all', label: t('admin.settings.openaiFastPolicy.tierAll') },
    { value: 'priority', label: t('admin.settings.openaiFastPolicy.tierPriority') },
    { value: 'ultrafast', label: t('admin.settings.openaiFastPolicy.tierUltrafast') },
    { value: 'flex', label: t('admin.settings.openaiFastPolicy.tierFlex') },
    { value: 'missing', label: t('admin.settings.openaiFastPolicy.tierMissing') }
  ]
  const actionOptions = [
    { value: 'pass', label: t('admin.settings.openaiFastPolicy.actionPass') },
    { value: 'filter', label: t('admin.settings.openaiFastPolicy.actionFilter') },
    { value: 'force_priority', label: t('admin.settings.openaiFastPolicy.actionForcePriority') },
    { value: 'block', label: t('admin.settings.openaiFastPolicy.actionBlock') }
  ]
  const scopeOptions = [
    { value: 'all', label: t('admin.settings.openaiFastPolicy.scopeAll') },
    { value: 'oauth', label: t('admin.settings.openaiFastPolicy.scopeOAuth') },
    { value: 'apikey', label: t('admin.settings.openaiFastPolicy.scopeAPIKey') },
    { value: 'bedrock', label: t('admin.settings.openaiFastPolicy.scopeBedrock') }
  ]
  const actionSummary = (action: FastAction) => t(`admin.settings.openaiFastPolicy.summaryAction.${action}`)

  function setRules(next: (rules: OpenAIFastPolicyRule[]) => OpenAIFastPolicyRule[]) {
    updateDraft((d) => ({ openaiFastPolicyRules: next(d.openaiFastPolicyRules) }))
  }
  function updateRule(index: number, patch: Partial<OpenAIFastPolicyRule>) {
    setRules((list) => list.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)))
  }

  return (
    <SettingsRegion title={t('admin.settings.openaiFastPolicy.title')} description={t('admin.settings.openaiFastPolicy.description')}>
      <div className={s.column}>
        {rules.length === 0 ? <p className={s.empty}>{t('admin.settings.openaiFastPolicy.empty')}</p> : null}
        {rules.map((rule, ruleIndex) => {
          const targeted = hasTargetModels(rule)
          return (
            <div key={ruleIndex} className={s.item}>
              <div className={s.itemHead}>
                <span className={s.itemTitle}>{t('admin.settings.openaiFastPolicy.ruleHeader', { index: ruleIndex + 1 })}</span>
                <button
                  type="button"
                  className={cx(s.iconButton, s.iconButtonDanger)}
                  title={t('admin.settings.openaiFastPolicy.removeRule')}
                  aria-label={t('admin.settings.openaiFastPolicy.removeRule')}
                  onClick={() => setRules((list) => list.filter((_, i) => i !== ruleIndex))}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.summaryLine} data-testid={`openai-fast-policy-summary-${ruleIndex}`}>
                <span className={styles.summaryStrong}>
                  {t(
                    targeted
                      ? 'admin.settings.openaiFastPolicy.summaryTargetModels'
                      : 'admin.settings.openaiFastPolicy.summaryAllModels'
                  )}
                </span>
                <span aria-hidden="true">→</span>
                <Badge tone="info" size="sm">
                  {actionSummary(rule.action)}
                </Badge>
                {targeted ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={styles.summaryStrong}>{t('admin.settings.openaiFastPolicy.summaryOtherModels')}</span>
                    <span aria-hidden="true">→</span>
                    <Badge tone="neutral" size="sm">
                      {actionSummary(rule.fallback_action || 'pass')}
                    </Badge>
                  </>
                ) : null}
              </div>
              <div className={s.grid3}>
                <Field label={t('admin.settings.openaiFastPolicy.serviceTier')}>
                  <Select
                    value={rule.service_tier}
                    options={tierOptions}
                    onChange={(value) => updateRule(ruleIndex, { service_tier: value as OpenAIFastPolicyRule['service_tier'] })}
                  />
                </Field>
                <Field label={t('admin.settings.openaiFastPolicy.action')}>
                  <Select
                    value={rule.action}
                    options={actionOptions}
                    onChange={(value) => updateRule(ruleIndex, { action: value as FastAction })}
                  />
                </Field>
                <Field label={t('admin.settings.openaiFastPolicy.scope')}>
                  <Select
                    value={rule.scope}
                    options={scopeOptions}
                    onChange={(value) => updateRule(ruleIndex, { scope: value as OpenAIFastPolicyRule['scope'] })}
                  />
                </Field>
              </div>
              <Field label={t('admin.settings.openaiFastPolicy.userIds')} hint={t('admin.settings.openaiFastPolicy.userIdsHint')}>
                <OpenAIFastPolicyUserSelector value={rule.user_ids || []} onChange={(user_ids) => updateRule(ruleIndex, { user_ids })} />
              </Field>
              {rule.action === 'block' ? (
                <Field
                  label={t('admin.settings.openaiFastPolicy.errorMessage')}
                  hint={t('admin.settings.openaiFastPolicy.errorMessageHint')}
                >
                  <input
                    type="text"
                    className={s.input}
                    value={rule.error_message ?? ''}
                    placeholder={t('admin.settings.openaiFastPolicy.errorMessagePlaceholder')}
                    onChange={(e) => updateRule(ruleIndex, { error_message: e.target.value })}
                  />
                </Field>
              ) : null}
              <div
                className={s.field}
                role="group"
                aria-labelledby={`openai-fast-policy-models-label-${ruleIndex}`}
                aria-describedby={`openai-fast-policy-models-hint-${ruleIndex}`}
              >
                <span id={`openai-fast-policy-models-label-${ruleIndex}`} className={s.label}>
                  {t('admin.settings.openaiFastPolicy.modelWhitelist')}
                </span>
                <p id={`openai-fast-policy-models-hint-${ruleIndex}`} className={s.hint}>
                  {t('admin.settings.openaiFastPolicy.modelWhitelistHint')}
                </p>
                <StringListEditor
                  values={rule.model_whitelist || []}
                  onChange={(model_whitelist) => updateRule(ruleIndex, { model_whitelist })}
                  placeholder={t('admin.settings.openaiFastPolicy.modelPatternPlaceholder')}
                  addLabel={t('admin.settings.openaiFastPolicy.addModelPattern')}
                />
              </div>
              {targeted ? (
                <Field
                  label={t('admin.settings.openaiFastPolicy.fallbackAction')}
                  hint={t('admin.settings.openaiFastPolicy.fallbackActionHint')}
                >
                  <Select
                    value={rule.fallback_action || 'pass'}
                    options={actionOptions}
                    onChange={(value) => updateRule(ruleIndex, { fallback_action: value as FastAction })}
                  />
                  {rule.fallback_action === 'block' ? (
                    <input
                      type="text"
                      className={s.input}
                      value={rule.fallback_error_message ?? ''}
                      placeholder={t('admin.settings.openaiFastPolicy.fallbackErrorMessagePlaceholder')}
                      onChange={(e) => updateRule(ruleIndex, { fallback_error_message: e.target.value })}
                    />
                  ) : null}
                </Field>
              ) : null}
            </div>
          )
        })}
        <div className={s.columnTight}>
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setRules((list) => [
                  ...list,
                  {
                    service_tier: 'priority',
                    action: 'filter',
                    scope: 'all',
                    user_ids: [],
                    error_message: '',
                    model_whitelist: [],
                    fallback_action: 'pass',
                    fallback_error_message: ''
                  }
                ])
              }
            >
              <Plus size={14} aria-hidden="true" />
              {t('admin.settings.openaiFastPolicy.addRule')}
            </Button>
          </div>
          <p className={s.hint}>{t('admin.settings.openaiFastPolicy.saveHint')}</p>
        </div>
      </div>
    </SettingsRegion>
  )
}
