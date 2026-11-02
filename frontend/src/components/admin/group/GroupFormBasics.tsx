/**
 * 分组表单：基本信息（名称、描述、从分组复制账号）、倍率与限制（倍率、RPM、推理强度策略、专属、状态）、订阅配置。
 */
import { Lightbulb, X } from 'lucide-react'

import { FormSection } from '@/components/account/AccountFormLayout'
import Select, { type SelectOption } from '@/components/common/Select'
import { useI18n } from '@/i18n/useI18n'
import { supportsReasoningEffortPolicyPlatform } from '@/views/admin/groupsReasoningEffort'
import GroupI18nField from './GroupI18nField'
import { HelpLabel, NumberField, SwitchRow } from './GroupFormControls'
import styles from './GroupForm.module.css'
import ReasoningEffortPolicyFields from './ReasoningEffortPolicyFields'
import type { GroupFormController } from './useGroupForm'

export interface GroupOption {
  value: number
  label: string
}

export function GroupIdentitySection({
  ctl,
  isSimpleMode,
  copyAccountsOptions
}: {
  ctl: GroupFormController
  isSimpleMode: boolean
  copyAccountsOptions: GroupOption[]
}) {
  const { t } = useI18n()
  const { form, update, mode } = ctl
  const isEdit = mode === 'edit'
  const selectedIds = form.copy_accounts_from_group_ids

  return (
    <FormSection>
      <GroupI18nField
        label={t('admin.groups.form.name')}
        field="name"
        required
        modelValue={form.name}
        onModelValueChange={(name) => update({ name })}
        i18n={form.i18n}
        onI18nChange={(i18n) => update({ i18n })}
        placeholder={isEdit ? undefined : t('admin.groups.enterGroupName')}
        data-tour={isEdit ? 'edit-group-form-name' : 'group-form-name'}
      />
      <GroupI18nField
        label={t('admin.groups.form.description')}
        field="description"
        multiline
        rows={3}
        modelValue={form.description}
        onModelValueChange={(description) => update({ description })}
        i18n={form.i18n}
        onI18nChange={(i18n) => update({ i18n })}
        placeholder={isEdit ? undefined : t('admin.groups.optionalDescription')}
      />
      {/* 从分组复制账号 */}
      {!isSimpleMode && copyAccountsOptions.length > 0 ? (
        <div className={styles.field}>
          <HelpLabel
            label={t('admin.groups.copyAccounts.title')}
            help={t(isEdit ? 'admin.groups.copyAccounts.tooltipEdit' : 'admin.groups.copyAccounts.tooltip')}
          />
          {/* 已选分组标签 */}
          {selectedIds.length > 0 ? (
            <div className={styles.chips}>
              {selectedIds.map((groupId) => (
                <span key={groupId} className={styles.chip}>
                  {copyAccountsOptions.find((o) => o.value === groupId)?.label || `#${groupId}`}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={t('common.delete')}
                    onClick={() =>
                      update({ copy_accounts_from_group_ids: selectedIds.filter((id) => id !== groupId) })
                    }
                  >
                    <X size={12} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {/* 分组选择下拉：选中后追加并恢复占位 */}
          <Select
            value={null}
            options={copyAccountsOptions.map((opt) => ({ ...opt, disabled: selectedIds.includes(opt.value) }))}
            placeholder={t('admin.groups.copyAccounts.selectPlaceholder')}
            aria-label={t('admin.groups.copyAccounts.title')}
            onChange={(value) => {
              const val = Number(value)
              if (val && !selectedIds.includes(val)) {
                update({ copy_accounts_from_group_ids: [...selectedIds, val] })
              }
            }}
          />
          <p className={styles.hint}>
            {t(isEdit ? 'admin.groups.copyAccounts.hintEdit' : 'admin.groups.copyAccounts.hint')}
          </p>
        </div>
      ) : null}
    </FormSection>
  )
}

export function GroupLimitsSection({
  ctl,
  statusOptions
}: {
  ctl: GroupFormController
  statusOptions: SelectOption[]
}) {
  const { t } = useI18n()
  const { form, update, mode, bindReasoning } = ctl
  const isEdit = mode === 'edit'

  return (
    <FormSection>
      <NumberField
        label={t('admin.groups.form.rateMultiplier')}
        value={form.rate_multiplier}
        onChange={(rate_multiplier) => update({ rate_multiplier })}
        step="0.001"
        min="0.001"
        required
        data-tour="group-form-multiplier"
        hint={isEdit ? undefined : t('admin.groups.rateMultiplierHint')}
      />
      <NumberField
        label={t('admin.groups.form.rpmLimit')}
        value={form.rpm_limit}
        onChange={(rpm_limit) => update({ rpm_limit })}
        min="0"
        step="1"
        placeholder={t('admin.groups.form.rpmLimitPlaceholder')}
        hint={t('admin.groups.form.rpmLimitHint')}
      />
      {supportsReasoningEffortPolicyPlatform(form.platform) ? (
        <ReasoningEffortPolicyFields
          ref={bindReasoning}
          idPrefix={`${mode}-group-reasoning`}
          platform={form.platform}
          maxEffort={form.max_reasoning_effort}
          onMaxEffortChange={(max_reasoning_effort) => update({ max_reasoning_effort })}
          overLimit={form.max_reasoning_effort_over_limit}
          onOverLimitChange={(max_reasoning_effort_over_limit) => update({ max_reasoning_effort_over_limit })}
          mappings={form.reasoning_effort_mappings}
          onMappingsChange={(reasoning_effort_mappings) => update({ reasoning_effort_mappings })}
        />
      ) : null}
      {form.subscription_type !== 'subscription' ? (
        <div data-tour={isEdit ? undefined : 'group-form-exclusive'}>
          <SwitchRow
            label={t('admin.groups.form.exclusive')}
            help={
              <div className={styles.block}>
                <p className={styles.label}>{t('admin.groups.exclusiveTooltip.title')}</p>
                <p className={styles.hint}>{t('admin.groups.exclusiveTooltip.description')}</p>
                <p className={styles.hint}>
                  <Lightbulb size={12} strokeWidth={1.75} aria-hidden="true" /> {t('admin.groups.exclusiveTooltip.example')}{' '}
                  {t('admin.groups.exclusiveTooltip.exampleContent')}
                </p>
              </div>
            }
            description={form.is_exclusive ? t('admin.groups.exclusive') : t('admin.groups.public')}
            ariaLabel={t('admin.groups.form.exclusive')}
            checked={form.is_exclusive}
            onChange={(is_exclusive) => update({ is_exclusive })}
          />
        </div>
      ) : null}
      {isEdit ? (
        <div className={styles.field}>
          <span className={styles.label}>{t('admin.groups.form.status')}</span>
          <Select
            value={form.status ?? 'active'}
            options={statusOptions}
            aria-label={t('admin.groups.form.status')}
            onChange={(value) => update({ status: value as 'active' | 'inactive' })}
          />
        </div>
      ) : null}
    </FormSection>
  )
}

export function GroupSubscriptionSection({
  ctl,
  subscriptionTypeOptions
}: {
  ctl: GroupFormController
  subscriptionTypeOptions: SelectOption[]
}) {
  const { t } = useI18n()
  const { form, update, mode } = ctl
  const isEdit = mode === 'edit'

  return (
    <FormSection title={t('admin.groups.subscription.type')}>
      <div className={styles.field}>
        <Select
          value={form.subscription_type}
          options={subscriptionTypeOptions}
          disabled={isEdit}
          aria-label={t('admin.groups.subscription.type')}
          onChange={(value) => update({ subscription_type: value as 'standard' | 'subscription' })}
        />
        <p className={styles.hint}>
          {isEdit ? t('admin.groups.subscription.typeNotEditable') : t('admin.groups.subscription.typeHint')}
        </p>
      </div>

      {/* Subscription limits (only show when subscription type is selected) */}
      {form.subscription_type === 'subscription' ? (
        <div className={styles.indented}>
          <NumberField
            label={t('admin.groups.subscription.dailyLimit')}
            value={form.daily_limit_usd}
            onChange={(daily_limit_usd) => update({ daily_limit_usd })}
            step="0.01"
            min="0"
            placeholder={t('admin.groups.subscription.noLimit')}
          />
          <NumberField
            label={t('admin.groups.subscription.weeklyLimit')}
            value={form.weekly_limit_usd}
            onChange={(weekly_limit_usd) => update({ weekly_limit_usd })}
            step="0.01"
            min="0"
            placeholder={t('admin.groups.subscription.noLimit')}
          />
          <NumberField
            label={t('admin.groups.subscription.monthlyLimit')}
            value={form.monthly_limit_usd}
            onChange={(monthly_limit_usd) => update({ monthly_limit_usd })}
            step="0.01"
            min="0"
            placeholder={t('admin.groups.subscription.noLimit')}
          />
        </div>
      ) : null}
    </FormSection>
  )
}
