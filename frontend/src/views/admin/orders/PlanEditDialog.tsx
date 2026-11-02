/**
 * 订阅套餐创建 / 编辑表单，对应 Vue 版 views/admin/orders/PlanEditDialog.vue。
 * 字段较多，改为右侧抽屉；打开时按 plan 重置表单（Vue 版 watch(show)）。
 */
import { Check } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { adminPaymentAPI, type AdminPaymentConfig } from '@/api/admin/payment'
import { Button } from '@/components/arc/button/button'
import { AccountFormDrawer, FormField, ToggleRow } from '@/components/account/AccountFormLayout'
import GroupBadge from '@/components/common/GroupBadge'
import Input from '@/components/common/Input'
import Select, { type SelectOption } from '@/components/common/Select'
import TextArea from '@/components/common/TextArea'
import { formatPaymentAmount } from '@/components/payment/currency'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup } from '@/types'
import type { SubscriptionPlan } from '@/types/payment'
import { extractApiErrorMessage } from '@/utils/apiError'
import { platformAccentColor } from '@/utils/platformColors'
import styles from './Orders.module.css'

export interface PlanEditDialogProps {
  show: boolean
  plan: SubscriptionPlan | null
  groups: AdminGroup[]
  paymentConfig?: AdminPaymentConfig | null
  onClose?: () => void
  onSaved?: () => void
}

/** 数值字段保存输入框原文（对应 v-model.number：空输入保持为空） */
interface PlanForm {
  name: string
  group_id: number | null
  description: string
  price: string
  original_price: string
  currency: string
  validity_days: string
  validity_unit: string
  sort_order: string
  for_sale: boolean
}

const emptyForm = (): PlanForm => ({
  name: '',
  group_id: null,
  description: '',
  price: '0',
  original_price: '0',
  currency: '',
  validity_days: '30',
  validity_unit: 'days',
  sort_order: '0',
  for_sale: true
})

function formFromPlan(plan: SubscriptionPlan | null): { form: PlanForm; features: string } {
  if (!plan) return { form: emptyForm(), features: '' }
  return {
    form: {
      name: plan.name,
      group_id: plan.group_id,
      description: plan.description,
      price: String(plan.price),
      original_price: String(plan.original_price || 0),
      currency: plan.currency || '',
      validity_days: String(plan.validity_days),
      validity_unit: plan.validity_unit || 'days',
      sort_order: String(plan.sort_order || 0),
      for_sale: plan.for_sale
    },
    features: (plan.features || []).join('\n')
  }
}

const toNumber = (text: string): number => (text.trim() === '' ? 0 : Number(text))

function roundCnyAmount(value: number): number {
  return Math.round(value * 100) / 100
}

function ceilCnyAmount(value: number): number {
  return Math.ceil(value * 100) / 100
}

export default function PlanEditDialog({ show, plan, groups, paymentConfig, onClose, onSaved }: PlanEditDialogProps) {
  const { t } = useI18n()
  const formId = useId()

  const [saving, setSaving] = useState(false)
  const [planForm, setPlanForm] = useState<PlanForm>(() => formFromPlan(show ? plan : null).form)
  const [planFeaturesText, setPlanFeaturesText] = useState(() => formFromPlan(show ? plan : null).features)

  // Reset form when dialog opens
  const [lastShow, setLastShow] = useState(show)
  if (lastShow !== show) {
    setLastShow(show)
    if (show) {
      const next = formFromPlan(plan)
      setPlanForm(next.form)
      setPlanFeaturesText(next.features)
    }
  }

  const patch = (next: Partial<PlanForm>) => setPlanForm((prev) => ({ ...prev, ...next }))

  const validityUnitOptions = [
    { value: 'days', label: t('payment.admin.days') },
    { value: 'weeks', label: t('payment.admin.weeks') },
    { value: 'months', label: t('payment.admin.months') }
  ]

  const groupOptions: SelectOption[] = groups
    .filter((g) => g.subscription_type === 'subscription')
    .map((g) => ({
      value: g.id,
      label: `${g.name} (${g.rate_multiplier}x)`,
      platform: g.platform
    }))

  const selectedGroupInfo = planForm.group_id ? groups.find((g) => g.id === planForm.group_id) || null : null

  const subscriptionCnyPreview = (() => {
    const price = Number(planForm.price) || 0
    const rate = Number(paymentConfig?.subscription_usd_to_cny_rate) || 0
    if (price <= 0 || rate <= 0) return null

    const amount = roundCnyAmount(price * rate)
    const feeRate = Number(paymentConfig?.recharge_fee_rate) || 0
    const fee = feeRate > 0 ? ceilCnyAmount((amount * feeRate) / 100) : 0
    const total = feeRate > 0 ? roundCnyAmount(amount + fee) : amount

    return {
      amount: formatPaymentAmount(amount, 'CNY'),
      feeRate,
      total: formatPaymentAmount(total, 'CNY')
    }
  })()

  /** Build request payload with snake_case keys matching backend JSON tags */
  function buildPlanPayload() {
    const features = planFeaturesText
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .join('\n')
    return {
      name: planForm.name,
      group_id: planForm.group_id,
      description: planForm.description,
      price: toNumber(planForm.price),
      original_price: toNumber(planForm.original_price) || 0,
      currency: planForm.currency.trim().toUpperCase(),
      validity_days: toNumber(planForm.validity_days),
      validity_unit: planForm.validity_unit,
      sort_order: toNumber(planForm.sort_order),
      for_sale: planForm.for_sale,
      features
    }
  }

  async function handleSavePlan(event: FormEvent) {
    event.preventDefault()
    const appStore = useAppStore.getState()
    if (!planForm.group_id) {
      appStore.showError(t('payment.admin.groupRequired'))
      return
    }
    const price = toNumber(planForm.price)
    if (!price || price <= 0) {
      appStore.showError(t('payment.admin.priceRequired'))
      return
    }
    const validityDays = toNumber(planForm.validity_days)
    if (!validityDays || validityDays < 1) {
      appStore.showError(t('payment.admin.validityRequired'))
      return
    }
    setSaving(true)
    try {
      const data = buildPlanPayload()
      if (plan) {
        await adminPaymentAPI.updatePlan(plan.id, data)
      } else {
        await adminPaymentAPI.createPlan(data)
      }
      appStore.showSuccess(t('common.saved'))
      onClose?.()
      onSaved?.()
    } catch (err: unknown) {
      appStore.showError(extractApiErrorMessage(err, t('common.error')))
    } finally {
      setSaving(false)
    }
  }

  const limitText = (value: number | null | undefined) =>
    value != null ? '$' + value : t('payment.admin.unlimited')

  const platformStyle = (option: SelectOption | null) =>
    option?.platform ? { color: platformAccentColor(String(option.platform)) } : undefined

  return (
    <AccountFormDrawer
      show={show}
      title={plan ? t('payment.admin.editPlan') : t('payment.admin.createPlan')}
      width="normal"
      onClose={() => onClose?.()}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onClose?.()}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={saving} loading={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(event) => void handleSavePlan(event)}>
        <div className={styles.pair}>
          <Input
            label={t('payment.admin.planName')}
            required
            value={planForm.name}
            onChange={(name) => patch({ name })}
          />
          <FormField label={t('payment.admin.group')} required>
            <Select
              value={planForm.group_id}
              options={groupOptions}
              placeholder={t('payment.admin.selectGroup')}
              aria-label={t('payment.admin.group')}
              onChange={(value) => patch({ group_id: value == null || value === '' ? null : Number(value) })}
              renderSelected={(option) =>
                option?.platform ? (
                  <span style={platformStyle(option)}>{option.label}</span>
                ) : (
                  <span>{option?.label || t('payment.admin.selectGroup')}</span>
                )
              }
              renderOption={(option, selected) => (
                <>
                  <span className={styles.optionLabel} style={platformStyle(option)}>
                    {option.label}
                  </span>
                  {selected && <Check size={16} className={styles.optionCheck} aria-hidden="true" />}
                </>
              )}
            />
          </FormField>
        </div>

        {/* Group Info Preview */}
        {selectedGroupInfo && (
          <div className={styles.groupPreview}>
            <div>
              <GroupBadge
                name={selectedGroupInfo.name}
                platform={selectedGroupInfo.platform}
                rateMultiplier={selectedGroupInfo.rate_multiplier}
              />
            </div>
            <dl className={styles.limitGrid}>
              <div>
                <dt>{t('payment.admin.dailyLimit')}:</dt>
                <dd>{limitText(selectedGroupInfo.daily_limit_usd)}</dd>
              </div>
              <div>
                <dt>{t('payment.admin.weeklyLimit')}:</dt>
                <dd>{limitText(selectedGroupInfo.weekly_limit_usd)}</dd>
              </div>
              <div>
                <dt>{t('payment.admin.monthlyLimit')}:</dt>
                <dd>{limitText(selectedGroupInfo.monthly_limit_usd)}</dd>
              </div>
            </dl>
          </div>
        )}

        <TextArea
          label={t('payment.admin.planDescription')}
          required
          rows={2}
          value={planForm.description}
          onChange={(description) => patch({ description })}
        />

        <div className={styles.pair}>
          <div className={styles.fieldStack}>
            <Input
              label={t('payment.admin.price')}
              required
              type="number"
              step="0.01"
              min="0.01"
              value={planForm.price}
              onChange={(price) => patch({ price })}
            />
            {subscriptionCnyPreview && (
              <p className={styles.preview}>
                {t('payment.admin.subscriptionCnyPayPreview', { amount: subscriptionCnyPreview.amount })}
                {subscriptionCnyPreview.feeRate > 0 && (
                  <span>
                    {' '}
                    {t('payment.admin.subscriptionCnyPayPreviewWithFee', {
                      feeRate: subscriptionCnyPreview.feeRate,
                      total: subscriptionCnyPreview.total
                    })}
                  </span>
                )}
              </p>
            )}
          </div>
          <Input
            label={t('payment.admin.originalPrice')}
            type="number"
            step="0.01"
            min="0"
            value={planForm.original_price}
            onChange={(original_price) => patch({ original_price })}
          />
        </div>

        <div className={styles.pair}>
          <Input
            label={t('payment.admin.validity')}
            required
            type="number"
            min="1"
            value={planForm.validity_days}
            onChange={(validity_days) => patch({ validity_days })}
          />
          <FormField label={t('payment.admin.validityUnit')} required>
            <Select
              value={planForm.validity_unit}
              options={validityUnitOptions}
              aria-label={t('payment.admin.validityUnit')}
              onChange={(value) => patch({ validity_unit: String(value ?? 'days') })}
            />
          </FormField>
        </div>

        <div className={styles.pair}>
          <Input
            label={t('payment.admin.sortOrder')}
            type="number"
            min="0"
            value={planForm.sort_order}
            onChange={(sort_order) => patch({ sort_order })}
          />
          <Input
            label={t('payment.admin.currency')}
            maxLength={3}
            value={planForm.currency}
            placeholder={t('payment.admin.currencyPlaceholder')}
            hint={t('payment.admin.currencyHint')}
            onChange={(currency) => patch({ currency: currency.toUpperCase() })}
          />
        </div>

        <TextArea
          label={t('payment.admin.features')}
          rows={3}
          value={planFeaturesText}
          placeholder={t('payment.admin.featuresPlaceholder')}
          hint={t('payment.admin.featuresHint')}
          onChange={setPlanFeaturesText}
        />

        <ToggleRow
          label={t('payment.admin.forSale')}
          checked={planForm.for_sale}
          onChange={(for_sale) => patch({ for_sale })}
        />
      </form>
    </AccountFormDrawer>
  )
}
