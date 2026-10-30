/**
 * 支付 Tab：支付系统参数（随整表保存）、充值优惠阶梯，以及支付服务商管理（即时接口调用）。
 * 服务商保存成功后会自动保存整张设置表单，与 Vue 版一致。
 */
import { useRef, useState } from 'react'

import { adminAPI } from '@/api'
import RechargeBonusTierEditor from '@/components/admin/settings/RechargeBonusTierEditor'
import { Field, SettingSwitch, SettingsRegion, ToggleRow } from '@/components/admin/settings/SettingsLayout'
import s from '@/components/admin/settings/SettingsLayout.module.css'
import { cx, numberInputValue } from '@/components/admin/settings/settingsUtils'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import ImageUpload from '@/components/common/ImageUpload'
import Select from '@/components/common/Select'
import PaymentProviderDialog, { type PaymentProviderDialogHandle } from '@/components/payment/PaymentProviderDialog'
import PaymentProviderList from '@/components/payment/PaymentProviderList'
import { normalizeVisibleMethod } from '@/components/payment/paymentFlow'
import { useMountOnce } from '@/composables/useMountOnce'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import type { ProviderInstance } from '@/types/payment'
import { extractI18nErrorMessage } from '@/utils/apiError'
import { useSettings } from './settingsContext'

type ProviderEnablementCandidate = Pick<ProviderInstance, 'id' | 'provider_key' | 'supported_types' | 'enabled' | 'name'>
type VisibleMethod = 'alipay' | 'wxpay'

function getProviderVisibleMethods(provider: ProviderEnablementCandidate): VisibleMethod[] {
  if (!provider.enabled) return []
  const supportedTypes = Array.isArray(provider.supported_types) ? provider.supported_types : []
  const methods = new Set<VisibleMethod>()
  const addMethod = (type: string) => {
    const method = normalizeVisibleMethod(type)
    if (method === 'alipay' || method === 'wxpay') methods.add(method)
  }
  if (provider.provider_key === 'alipay') {
    if (supportedTypes.length === 0) methods.add('alipay')
    else supportedTypes.forEach((type) => normalizeVisibleMethod(type) === 'alipay' && methods.add('alipay'))
  } else if (provider.provider_key === 'wxpay') {
    if (supportedTypes.length === 0) methods.add('wxpay')
    else supportedTypes.forEach((type) => normalizeVisibleMethod(type) === 'wxpay' && methods.add('wxpay'))
  } else if (provider.provider_key === 'easypay') {
    supportedTypes.forEach(addMethod)
  }
  return Array.from(methods)
}

function slog(...args: unknown[]) {
  console.warn('[payment]', ...args)
}

function usePaymentSystem() {
  const { t, locale } = useI18n()
  const { form, updateForm } = useSettings()
  const zh = locale.startsWith('zh')
  const paymentGuideHref = zh
    ? 'https://github.com/Wei-Shaw/sub2api/blob/main/docs/PAYMENT_CN.md'
    : 'https://github.com/Wei-Shaw/sub2api/blob/main/docs/PAYMENT.md'
  const paymentMethodsHref = zh
    ? 'https://github.com/Wei-Shaw/sub2api/blob/main/docs/PAYMENT_CN.md#支持的支付方式'
    : 'https://github.com/Wei-Shaw/sub2api/blob/main/docs/PAYMENT.md#supported-payment-methods'
  const allPaymentTypes = usePaymentTypes()
  const limitEnabled = form.payment_cancel_rate_limit_enabled

  const amountInput = (key: 'payment_min_amount' | 'payment_max_amount' | 'payment_daily_limit', label: string) => (
    <Field label={t(`admin.settings.payment.${label}`)}>
      <input
        type="number"
        step="0.01"
        min="0"
        className={s.input}
        value={form[key] || ''}
        placeholder={t('admin.settings.payment.noLimit')}
        onChange={(e) => updateForm({ [key]: parseFloat(e.target.value) || 0 })}
      />
    </Field>
  )

  function togglePaymentType(type: string, disableProviders: (type: string) => void) {
    if (form.payment_enabled_types.includes(type)) {
      updateForm({ payment_enabled_types: form.payment_enabled_types.filter((item) => item !== type) })
      // Disable all provider instances matching this type
      disableProviders(type)
    } else {
      updateForm({ payment_enabled_types: [...form.payment_enabled_types, type] })
    }
  }

  return { paymentGuideHref, paymentMethodsHref, allPaymentTypes, limitEnabled, amountInput, togglePaymentType }
}

function usePaymentTypes() {
  const { t } = useI18n()
  return [
    { value: 'easypay', label: t('payment.methods.easypay') },
    { value: 'alipay', label: t('payment.methods.alipay') },
    { value: 'wxpay', label: t('payment.methods.wxpay') },
    { value: 'stripe', label: t('payment.methods.stripe') },
    { value: 'airwallex', label: t('payment.methods.airwallex') }
  ]
}

export default function PaymentTab() {
  const { t } = useI18n()
  const { form, updateForm, saveSettings } = useSettings()
  const system = usePaymentSystem()
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providerSaving, setProviderSaving] = useState(false)
  const [providers, setProviders] = useState<ProviderInstance[]>([])
  const [showProviderDialog, setShowProviderDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderInstance | null>(null)
  const [deletingProviderId, setDeletingProviderId] = useState<number | null>(null)
  const providerDialogRef = useRef<PaymentProviderDialogHandle>(null)
  const providersRef = useRef<ProviderInstance[]>([])

  const showError = (err: unknown) =>
    useAppStore.getState().showError(extractI18nErrorMessage(err, t, 'payment.errors', t('common.error')))

  const providerKeyOptions = [
    { value: 'easypay', label: t('admin.settings.payment.providerEasypay') },
    { value: 'alipay', label: t('admin.settings.payment.providerAlipay') },
    { value: 'wxpay', label: t('admin.settings.payment.providerWxpay') },
    { value: 'stripe', label: t('admin.settings.payment.providerStripe') },
    { value: 'airwallex', label: t('admin.settings.payment.providerAirwallex') }
  ]
  const enabledProviderKeyOptions = providerKeyOptions.filter((opt) => form.payment_enabled_types.includes(opt.value))
  const loadBalanceOptions = [
    { value: 'round-robin', label: t('admin.settings.payment.strategyRoundRobin') },
    { value: 'least-amount', label: t('admin.settings.payment.strategyLeastAmount') }
  ]
  const cancelRateLimitUnitOptions = [
    { value: 'minute', label: t('admin.settings.payment.cancelRateLimitUnitMinute') },
    { value: 'hour', label: t('admin.settings.payment.cancelRateLimitUnitHour') },
    { value: 'day', label: t('admin.settings.payment.cancelRateLimitUnitDay') }
  ]
  const cancelRateLimitModeOptions = [
    { value: 'rolling', label: t('admin.settings.payment.cancelRateLimitWindowModeRolling') },
    { value: 'fixed', label: t('admin.settings.payment.cancelRateLimitWindowModeFixed') }
  ]

  async function loadProviders() {
    setProvidersLoading(true)
    try {
      const res = await adminAPI.payment.getProviders()
      // Normalize supported_types: backend returns null when the list is empty
      // (Go nil slice → JSON null). Without this, ProviderCard's isSelected()
      // throws TypeError on null.includes(), causing the card to vanish.
      const list = (res.data || []).map((p) => ({ ...p, supported_types: Array.isArray(p.supported_types) ? p.supported_types : [] }))
      providersRef.current = list
      setProviders(list)
    } catch (err: unknown) {
      showError(err)
    } finally {
      setProvidersLoading(false)
    }
  }

  useMountOnce(loadProviders)

  function findConflict(candidate: ProviderEnablementCandidate): { method: VisibleMethod; conflicting: ProviderInstance } | null {
    const claimed = getProviderVisibleMethods(candidate)
    if (claimed.length === 0) return null
    for (const other of providersRef.current) {
      if (other.id === candidate.id || !other.enabled) continue
      const otherMethods = getProviderVisibleMethods(other)
      const matched = claimed.find((method) => otherMethods.includes(method))
      if (matched) return { method: matched, conflicting: other }
    }
    return null
  }

  function showConflict(conflict: { method: VisibleMethod; conflicting: ProviderInstance }) {
    useAppStore.getState().showError(
      t('admin.settings.payment.enableConflict', {
        method: t(`payment.methods.${conflict.method}`),
        provider: conflict.conflicting.name
      })
    )
  }

  async function disableProvidersByType(type: string) {
    const matching = providersRef.current.filter((p) => p.provider_key === type && p.enabled)
    for (const p of matching) {
      try {
        await adminAPI.payment.updateProvider(p.id, { enabled: false })
        providersRef.current = providersRef.current.map((item) => (item.id === p.id ? { ...item, enabled: false } : item))
        setProviders(providersRef.current)
      } catch (err: unknown) {
        slog('disable provider failed', p.id, err)
      }
    }
  }

  function openCreateProvider() {
    setEditingProvider(null)
    providerDialogRef.current?.reset(enabledProviderKeyOptions[0]?.value || 'easypay')
    setShowProviderDialog(true)
  }

  function openEditProvider(provider: ProviderInstance) {
    setEditingProvider(provider)
    providerDialogRef.current?.loadProvider(provider)
    setShowProviderDialog(true)
  }

  async function handleSaveProvider(payload: Partial<ProviderInstance>) {
    setProviderSaving(true)
    try {
      const conflict = findConflict({
        id: editingProvider?.id ?? 0,
        provider_key: payload.provider_key ?? editingProvider?.provider_key ?? '',
        supported_types: payload.supported_types ?? editingProvider?.supported_types ?? [],
        enabled: payload.enabled ?? editingProvider?.enabled ?? false,
        name: payload.name ?? editingProvider?.name ?? ''
      })
      if (conflict) {
        showConflict(conflict)
        return
      }
      if (editingProvider) await adminAPI.payment.updateProvider(editingProvider.id, payload)
      else await adminAPI.payment.createProvider(payload)
      setShowProviderDialog(false)
      // Reload full list (API returns decrypted/formatted data with correct sort order)
      await loadProviders()
      // Auto-save settings so provider changes take effect immediately
      await saveSettings()
    } catch (err: unknown) {
      showError(err)
    } finally {
      setProviderSaving(false)
    }
  }

  async function handleToggleField(provider: ProviderInstance, field: 'enabled' | 'refund_enabled' | 'allow_user_refund') {
    const newValue = field === 'enabled' ? !provider.enabled : field === 'refund_enabled' ? !provider.refund_enabled : !provider.allow_user_refund
    if (field === 'enabled' && newValue) {
      const conflict = findConflict({
        id: provider.id,
        provider_key: provider.provider_key,
        supported_types: provider.supported_types,
        enabled: true,
        name: provider.name
      })
      if (conflict) {
        showConflict(conflict)
        return
      }
    }
    const payload: Record<string, boolean> = { [field]: newValue }
    // Cascade: turning off refund_enabled also turns off allow_user_refund
    if (field === 'refund_enabled' && !newValue) payload.allow_user_refund = false
    try {
      await adminAPI.payment.updateProvider(provider.id, payload)
      await loadProviders()
    } catch (err: unknown) {
      showError(err)
    }
  }

  async function handleToggleType(provider: ProviderInstance, type: string) {
    const currentTypes = Array.isArray(provider.supported_types) ? provider.supported_types : []
    const updated = currentTypes.includes(type) ? currentTypes.filter((item) => item !== type) : [...currentTypes, type]
    const conflict = findConflict({
      id: provider.id,
      provider_key: provider.provider_key,
      supported_types: updated,
      enabled: provider.enabled,
      name: provider.name
    })
    if (conflict) {
      showConflict(conflict)
      return
    }
    try {
      await adminAPI.payment.updateProvider(provider.id, { supported_types: updated })
      await loadProviders()
    } catch (err: unknown) {
      showError(err)
    }
  }

  async function handleReorderProviders(updates: { id: number; sort_order: number }[]) {
    try {
      await Promise.all(updates.map((u) => adminAPI.payment.updateProvider(u.id, { sort_order: u.sort_order })))
      await loadProviders()
    } catch (err: unknown) {
      showError(err)
      void loadProviders()
    }
  }

  async function handleDeleteProvider() {
    if (!deletingProviderId) return
    try {
      await adminAPI.payment.deleteProvider(deletingProviderId)
      useAppStore.getState().showSuccess(t('common.deleted'))
      setShowDeleteDialog(false)
      void loadProviders()
    } catch (err: unknown) {
      showError(err)
    }
  }

  const disabledText = !system.limitEnabled ? s.muted : undefined

  return (
    <>
      <SettingsRegion
        title={t('admin.settings.payment.title')}
        description={
          <>
            {t('admin.settings.payment.description')}{' '}
            <a href={system.paymentGuideHref} target="_blank" rel="noopener noreferrer" className={s.link}>
              {t('admin.settings.payment.configGuide')}
            </a>
          </>
        }
      >
        <ToggleRow
          label={t('admin.settings.payment.enabled')}
          description={t('admin.settings.payment.enabledHint')}
          checked={form.payment_enabled}
          onChange={(value) => updateForm({ payment_enabled: value })}
        />
        {form.payment_enabled ? (
          <div className={s.column}>
            <div className={s.grid3}>
              <Field label={t('admin.settings.payment.productNamePrefix')}>
                <input
                  type="text"
                  className={s.input}
                  placeholder="RetooAi"
                  value={form.payment_product_name_prefix}
                  onChange={(e) => updateForm({ payment_product_name_prefix: e.target.value })}
                />
              </Field>
              <Field label={t('admin.settings.payment.productNameSuffix')}>
                <input
                  type="text"
                  className={s.input}
                  placeholder="CNY"
                  value={form.payment_product_name_suffix}
                  onChange={(e) => updateForm({ payment_product_name_suffix: e.target.value })}
                />
              </Field>
              <Field label={t('admin.settings.payment.preview')}>
                <div className={cx(s.input, s.mono)}>
                  {(form.payment_product_name_prefix || 'RetooAi') + ' 100 ' + (form.payment_product_name_suffix || 'CNY')}
                </div>
              </Field>
            </div>
            <div className={s.grid3}>
              {system.amountInput('payment_min_amount', 'minAmount')}
              {system.amountInput('payment_max_amount', 'maxAmount')}
              {system.amountInput('payment_daily_limit', 'dailyLimit')}
            </div>
            <div className={s.grid3}>
              <Field
                label={t('admin.settings.payment.balanceRechargeMultiplier')}
                hint={
                  <>
                    {t('admin.settings.payment.balanceRechargeMultiplierHint')}
                    <br />
                    {t('admin.settings.payment.balanceRechargePreview', {
                      usd: (Number(form.payment_balance_recharge_multiplier) || 1).toFixed(2)
                    })}
                  </>
                }
              >
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={s.input}
                  value={form.payment_balance_recharge_multiplier || ''}
                  onChange={(e) => updateForm({ payment_balance_recharge_multiplier: parseFloat(e.target.value) || 1 })}
                />
              </Field>
              <Field label={t('admin.settings.payment.subscriptionUsdToCnyRate')} hint={t('admin.settings.payment.subscriptionUsdToCnyRateHint')}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={s.input}
                  value={form.payment_subscription_usd_to_cny_rate || ''}
                  placeholder={t('admin.settings.payment.subscriptionUsdToCnyRateDisabled')}
                  onChange={(e) => updateForm({ payment_subscription_usd_to_cny_rate: parseFloat(e.target.value) || 0 })}
                />
              </Field>
              <Field
                label={t('admin.settings.payment.rechargeFeeRate')}
                hint={
                  <>
                    {t('admin.settings.payment.rechargeFeeRateHint')}
                    {(Number(form.payment_recharge_fee_rate) || 0) > 0 ? (
                      <>
                        <br />
                        {t('admin.settings.payment.rechargeFeePreview', { fee: (Number(form.payment_recharge_fee_rate) || 0).toFixed(2) })}
                      </>
                    ) : null}
                  </>
                }
              >
                <div className={s.inputWithSuffix}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className={s.input}
                    value={form.payment_recharge_fee_rate ?? ''}
                    onChange={(e) =>
                      updateForm({
                        payment_recharge_fee_rate: Math.min(100, Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100) / 100))
                      })
                    }
                  />
                  <span className={s.inputSuffix}>%</span>
                </div>
              </Field>
            </div>
            <div className={s.grid3}>
              <Field label={`${t('admin.settings.payment.orderTimeout')} *`} hint={t('admin.settings.payment.orderTimeoutHint')}>
                <input
                  type="number"
                  min="1"
                  required
                  className={s.input}
                  value={form.payment_order_timeout_minutes}
                  onChange={(e) => updateForm({ payment_order_timeout_minutes: numberInputValue(e.target.value) as number })}
                />
              </Field>
              <Field label={t('admin.settings.payment.maxPendingOrders')}>
                <input
                  type="number"
                  min="1"
                  className={s.input}
                  value={form.payment_max_pending_orders}
                  onChange={(e) => updateForm({ payment_max_pending_orders: numberInputValue(e.target.value) as number })}
                />
              </Field>
              <Field label={t('admin.settings.payment.loadBalanceStrategy')}>
                <Select
                  value={form.payment_load_balance_strategy}
                  options={loadBalanceOptions}
                  onChange={(value) => updateForm({ payment_load_balance_strategy: String(value) })}
                />
              </Field>
            </div>
            <Field label={t('admin.settings.payment.cancelRateLimit')}>
              <div className={s.inline}>
                <SettingSwitch
                  checked={form.payment_cancel_rate_limit_enabled}
                  aria-label={t('admin.settings.payment.cancelRateLimit')}
                  onChange={(value) => updateForm({ payment_cancel_rate_limit_enabled: value })}
                />
                <div className={s.inputNarrow}>
                  <Select
                    value={form.payment_cancel_rate_limit_window_mode}
                    options={cancelRateLimitModeOptions}
                    disabled={!system.limitEnabled}
                    onChange={(value) => updateForm({ payment_cancel_rate_limit_window_mode: String(value) })}
                  />
                </div>
                <span className={disabledText}>{t('admin.settings.payment.cancelRateLimitEvery')}</span>
                <input
                  type="number"
                  min="1"
                  required
                  className={cx(s.input, s.inputNarrow)}
                  aria-label={t('admin.settings.payment.cancelRateLimitEvery')}
                  disabled={!system.limitEnabled}
                  value={form.payment_cancel_rate_limit_window}
                  onChange={(e) => updateForm({ payment_cancel_rate_limit_window: numberInputValue(e.target.value) as number })}
                />
                <div className={s.inputNarrow}>
                  <Select
                    value={form.payment_cancel_rate_limit_unit}
                    options={cancelRateLimitUnitOptions}
                    disabled={!system.limitEnabled}
                    onChange={(value) => updateForm({ payment_cancel_rate_limit_unit: String(value) })}
                  />
                </div>
                <span className={disabledText}>{t('admin.settings.payment.cancelRateLimitAllowMax')}</span>
                <input
                  type="number"
                  min="1"
                  required
                  className={cx(s.input, s.inputNarrow)}
                  aria-label={t('admin.settings.payment.cancelRateLimitAllowMax')}
                  disabled={!system.limitEnabled}
                  value={form.payment_cancel_rate_limit_max}
                  onChange={(e) => updateForm({ payment_cancel_rate_limit_max: numberInputValue(e.target.value) as number })}
                />
                <span className={disabledText}>{t('admin.settings.payment.cancelRateLimitTimes')}</span>
              </div>
            </Field>
            <ToggleRow
              label={t('admin.settings.payment.alipayForceQRCode')}
              description={t('admin.settings.payment.alipayForceQRCodeHint')}
              checked={Boolean(form.payment_alipay_force_qrcode)}
              onChange={(value) => updateForm({ payment_alipay_force_qrcode: value })}
            />
            <ToggleRow
              label={t('admin.settings.payment.alipayMobilePrecreateDeepLink')}
              description={t('admin.settings.payment.alipayMobilePrecreateDeepLinkHint')}
              checked={Boolean(form.payment_alipay_mobile_precreate_deep_link)}
              onChange={(value) => updateForm({ payment_alipay_mobile_precreate_deep_link: value })}
            />
            <Field
              label={t('admin.settings.payment.enabledPaymentTypes')}
              hint={
                <>
                  {t('admin.settings.payment.enabledPaymentTypesHint')}{' '}
                  <a href={system.paymentMethodsHref} target="_blank" rel="noopener noreferrer" className={s.link}>
                    {t('admin.settings.payment.findProvider')}
                  </a>
                </>
              }
            >
              <div className={s.choiceGroup}>
                {system.allPaymentTypes.map((pt) => (
                  <button
                    key={pt.value}
                    type="button"
                    className={s.choice}
                    aria-pressed={form.payment_enabled_types.includes(pt.value)}
                    onClick={() => system.togglePaymentType(pt.value, (type) => void disableProvidersByType(type))}
                  >
                    {pt.label}
                  </button>
                ))}
              </div>
            </Field>
            <div className={s.grid2}>
              <Field label={t('admin.settings.payment.helpImage')} hint={t('admin.settings.payment.helpImagePlaceholder')}>
                <ImageUpload
                  value={form.payment_help_image_url}
                  onChange={(value) => updateForm({ payment_help_image_url: value })}
                  uploadLabel={t('admin.settings.site.uploadImage')}
                  removeLabel={t('admin.settings.site.remove')}
                />
              </Field>
              <Field label={t('admin.settings.payment.helpText')}>
                <textarea
                  rows={3}
                  className={s.textarea}
                  value={form.payment_help_text}
                  placeholder={t('admin.settings.payment.helpTextPlaceholder')}
                  onChange={(e) => updateForm({ payment_help_text: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ) : null}
      </SettingsRegion>

      {/* 充值优惠阶梯（独立区域，与服务商管理同级） */}
      {form.payment_enabled ? (
        <RechargeBonusTierEditor
          value={form.payment_recharge_bonus_tiers}
          onChange={(value) => updateForm({ payment_recharge_bonus_tiers: value })}
          mode={form.payment_recharge_bonus_mode}
          onModeChange={(value) => updateForm({ payment_recharge_bonus_mode: value })}
          notice={form.payment_recharge_bonus_notice}
          onNoticeChange={(value) => updateForm({ payment_recharge_bonus_notice: value })}
        />
      ) : null}

      {/* Provider Management */}
      {form.payment_enabled ? (
        <PaymentProviderList
          providers={providers}
          loading={providersLoading}
          canCreate={form.payment_enabled_types.length > 0}
          enabledPaymentTypes={form.payment_enabled_types}
          allPaymentTypes={system.allPaymentTypes}
          redirectLabel={t('admin.settings.payment.easypayRedirect')}
          onRefresh={() => void loadProviders()}
          onCreate={openCreateProvider}
          onEdit={openEditProvider}
          onDelete={(provider) => {
            setDeletingProviderId(provider.id)
            setShowDeleteDialog(true)
          }}
          onToggleField={(provider, field) => void handleToggleField(provider, field)}
          onToggleType={(provider, type) => void handleToggleType(provider, type)}
          onReorder={(updates) => void handleReorderProviders(updates)}
        />
      ) : null}

      <PaymentProviderDialog
        ref={providerDialogRef}
        show={showProviderDialog}
        saving={providerSaving}
        editing={editingProvider}
        allKeyOptions={providerKeyOptions}
        enabledKeyOptions={enabledProviderKeyOptions}
        allPaymentTypes={system.allPaymentTypes}
        redirectLabel={t('admin.settings.payment.easypayRedirect')}
        onClose={() => setShowProviderDialog(false)}
        onSave={(payload) => void handleSaveProvider(payload)}
      />
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.settings.payment.deleteProvider')}
        message={t('admin.settings.payment.deleteProviderConfirm')}
        confirmText={t('common.delete')}
        danger
        onConfirm={() => void handleDeleteProvider()}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </>
  )
}
