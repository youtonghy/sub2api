/**
 * 服务商实例创建 / 编辑表单，对应 Vue 版 PaymentProviderDialog.vue。
 * 表单较长，改为右侧抽屉（AccountFormDrawer）；父组件通过 ref 调用 reset / loadProvider（Vue 版 defineExpose）。
 */
import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import { useId, useImperativeHandle, useState, type FormEvent, type Ref } from 'react'

import { Button } from '@/components/arc/button/button'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { AccountFormDrawer, FormField, FormNotice, FormSection } from '@/components/account/AccountFormLayout'
import HelpTooltip from '@/components/common/HelpTooltip'
import Input from '@/components/common/Input'
import Select, { type SelectOption } from '@/components/common/Select'
import TextArea from '@/components/common/TextArea'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { ProviderInstance } from '@/types/payment'
import type { ConfigFieldDef, EasyPayCustomMethod, TypeOption } from './providerConfig'
import {
  extractBaseUrl,
  getAvailableTypes,
  parseEasyPayCustomMethods,
  PAYMENT_MODE_POPUP,
  PAYMENT_MODE_QRCODE,
  PAYMENT_MODE_REDIRECT,
  PROVIDER_CALLBACK_PATHS,
  PROVIDER_CONFIG_FIELDS,
  PROVIDER_SUPPORTED_TYPES,
  serializeEasyPayCustomMethods,
  STRIPE_SDK_API_VERSION,
  WEBHOOK_PATHS
} from './providerConfig'
import ToggleSwitch from './ToggleSwitch'
import styles from './PaymentProviderDialog.module.css'

/** Default payment_mode per provider key — "" means "no preference, use
 * provider's built-in default behavior". */
function defaultPaymentMode(providerKey: string): string {
  if (providerKey === 'easypay') return PAYMENT_MODE_QRCODE
  return ''
}

/** Provider keys whose admin UI exposes a payment_mode selector.
 * Other providers always send payment_mode = ''. */
function providerSupportsPaymentMode(providerKey: string): boolean {
  return providerKey === 'easypay' || providerKey === 'alipay'
}

/** Allowed payment_mode values per provider. Used to coerce DB values
 * from a different provider (or stale data) back to the default. */
function isValidPaymentMode(providerKey: string, mode: string): boolean {
  if (providerKey === 'easypay') {
    return mode === PAYMENT_MODE_QRCODE || mode === PAYMENT_MODE_POPUP
  }
  if (providerKey === 'alipay') {
    return mode === '' || mode === PAYMENT_MODE_REDIRECT
  }
  return mode === ''
}

function normalizeEasyPayCustomMethodCode(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeEasyPayCustomMethods(methods: EasyPayCustomMethod[]): EasyPayCustomMethod[] {
  return methods
    .map((method) => ({
      type: normalizeEasyPayCustomMethodCode(method.type),
      upstreamType: normalizeEasyPayCustomMethodCode(method.upstreamType),
      displayName: method.displayName.trim()
    }))
    .filter((method) => method.type || method.upstreamType || method.displayName)
}

/** 有字段使用默认值时填入（不覆盖已有值） */
function withDefaults(providerKey: string, config: Record<string, string>): Record<string, string> {
  const next = { ...config }
  for (const f of PROVIDER_CONFIG_FIELDS[providerKey] || []) {
    if (f.defaultValue && !next[f.key]) next[f.key] = f.defaultValue
  }
  return next
}

export interface PaymentProviderSavePayload {
  provider_key: string
  name: string
  supported_types: string[]
  enabled: boolean
  payment_mode: string
  refund_enabled: boolean
  allow_user_refund: boolean
  config: Record<string, string>
  limits: string
}

/** Vue 版 defineExpose({ reset, loadProvider }) */
export interface PaymentProviderDialogHandle {
  reset: (defaultKey: string) => void
  loadProvider: (provider: ProviderInstance) => void
}

export interface PaymentProviderDialogProps {
  show: boolean
  saving: boolean
  editing: ProviderInstance | null
  allKeyOptions: TypeOption[]
  enabledKeyOptions: TypeOption[]
  allPaymentTypes: TypeOption[]
  redirectLabel: string
  onClose?: () => void
  onSave?: (payload: PaymentProviderSavePayload) => void
  ref?: Ref<PaymentProviderDialogHandle>
}

interface PaymentGuideItem {
  title: string
  open: string
  call: string
  fallback: string
}

interface PaymentGuide {
  summary: string
  items: PaymentGuideItem[]
  note?: string
}

interface ProviderForm {
  name: string
  provider_key: string
  supported_types: string[]
  enabled: boolean
  payment_mode: string
  refund_enabled: boolean
  allow_user_refund: boolean
}

type LimitField = 'singleMin' | 'singleMax' | 'dailyLimit'
const LIMIT_FIELDS: { field: LimitField; labelKey: string }[] = [
  { field: 'singleMin', labelKey: 'admin.settings.payment.limitSingleMin' },
  { field: 'singleMax', labelKey: 'admin.settings.payment.limitSingleMax' },
  { field: 'dailyLimit', labelKey: 'admin.settings.payment.limitDaily' }
]

const providerWebhookHintMap: Record<string, string> = {
  stripe: 'admin.settings.payment.stripeWebhookHint',
  airwallex: 'admin.settings.payment.airwallexWebhookHint'
}

function emitValidationError(msg: string) {
  useAppStore.getState().showError(msg)
}

export default function PaymentProviderDialog({
  show,
  saving,
  editing,
  allKeyOptions,
  enabledKeyOptions,
  allPaymentTypes,
  redirectLabel,
  onClose,
  onSave,
  ref
}: PaymentProviderDialogProps) {
  const { t } = useI18n()
  const formId = useId()

  // --- Form state ---
  const [form, setForm] = useState<ProviderForm>({
    name: '',
    provider_key: 'easypay',
    supported_types: [],
    enabled: true,
    payment_mode: PAYMENT_MODE_QRCODE,
    refund_enabled: false,
    allow_user_refund: false
  })
  const [config, setConfig] = useState<Record<string, string>>({})
  const [limits, setLimits] = useState<Record<string, Record<string, number>>>({})
  // 限额输入框的原始文本：允许输入 "1." 等中间态，Vue 版输入框不受控所以没有这个问题
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({})
  const [notifyBaseUrl, setNotifyBaseUrl] = useState('')
  const [returnBaseUrl, setReturnBaseUrl] = useState('')
  const [limitsExpanded, setLimitsExpanded] = useState(false)
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({})
  const [easyPayCustomMethods, setEasyPayCustomMethods] = useState<EasyPayCustomMethod[]>([])

  // --- Computed ---
  const defaultBaseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  const webhookPath = WEBHOOK_PATHS[form.provider_key]
  const providerWebhookUrl = providerWebhookHintMap[form.provider_key] && webhookPath ? defaultBaseUrl + webhookPath : ''
  const providerWebhookHint = providerWebhookHintMap[form.provider_key] || 'admin.settings.payment.stripeWebhookHint'

  const callbackPaths = PROVIDER_CALLBACK_PATHS[form.provider_key] || null
  const supportsPaymentMode = providerSupportsPaymentMode(form.provider_key)

  const paymentModeOptions =
    form.provider_key === 'alipay'
      ? // For Alipay official: "" = default (precreate → page.pay fallback);
        // "redirect" = always open the Alipay checkout page in a new tab.
        [
          { value: '', label: t('admin.settings.payment.modeQRCode') },
          { value: PAYMENT_MODE_REDIRECT, label: t('admin.settings.payment.modeRedirect') }
        ]
      : [
          { value: PAYMENT_MODE_QRCODE, label: t('admin.settings.payment.modeQRCode') },
          { value: PAYMENT_MODE_POPUP, label: t('admin.settings.payment.modePopup') }
        ]

  const availableTypes = (() => {
    const base = getAvailableTypes(form.provider_key, allPaymentTypes, redirectLabel)
    if (form.provider_key === 'easypay') {
      for (const method of normalizeEasyPayCustomMethods(easyPayCustomMethods)) {
        if (!base.some((opt) => opt.value === method.type)) {
          base.push({ value: method.type, label: method.displayName || method.type })
        }
      }
    }
    // Resolve i18n labels for types not in allPaymentTypes (e.g. card, link inside stripe)
    return base.map((opt) =>
      opt.label === opt.value ? { ...opt, label: t(`payment.methods.${opt.value}`, opt.value) } : opt
    )
  })()

  const resolvedFields = (PROVIDER_CONFIG_FIELDS[form.provider_key] || []).map((f) => ({
    ...f,
    label: f.label || t(`admin.settings.payment.field_${f.key}`)
  }))

  const paymentGuide: PaymentGuide | null = (() => {
    if (form.provider_key === 'alipay') {
      return {
        summary: t('admin.settings.payment.alipayGuideSummary'),
        items: [
          {
            title: t('admin.settings.payment.alipayGuideFaceToFaceTitle'),
            open: t('admin.settings.payment.alipayGuideFaceToFaceOpen'),
            call: t('admin.settings.payment.alipayGuideFaceToFaceCall'),
            fallback: t('admin.settings.payment.alipayGuideFaceToFaceFallback')
          },
          {
            title: t('admin.settings.payment.alipayGuidePagePayTitle'),
            open: t('admin.settings.payment.alipayGuidePagePayOpen'),
            call: t('admin.settings.payment.alipayGuidePagePayCall'),
            fallback: t('admin.settings.payment.alipayGuidePagePayFallback')
          },
          {
            title: t('admin.settings.payment.alipayGuideWapTitle'),
            open: t('admin.settings.payment.alipayGuideWapOpen'),
            call: t('admin.settings.payment.alipayGuideWapCall'),
            fallback: t('admin.settings.payment.alipayGuideWapFallback')
          }
        ]
      }
    }
    if (form.provider_key === 'wxpay') {
      return {
        summary: t('admin.settings.payment.wxpayGuideSummary'),
        note: t('admin.settings.payment.wxpayGuideNote'),
        items: [
          {
            title: t('admin.settings.payment.wxpayGuideNativeTitle'),
            open: t('admin.settings.payment.wxpayGuideNativeOpen'),
            call: t('admin.settings.payment.wxpayGuideNativeCall'),
            fallback: t('admin.settings.payment.wxpayGuideNativeFallback')
          },
          {
            title: t('admin.settings.payment.wxpayGuideJsapiTitle'),
            open: t('admin.settings.payment.wxpayGuideJsapiOpen'),
            call: t('admin.settings.payment.wxpayGuideJsapiCall'),
            fallback: t('admin.settings.payment.wxpayGuideJsapiFallback')
          },
          {
            title: t('admin.settings.payment.wxpayGuideH5Title'),
            open: t('admin.settings.payment.wxpayGuideH5Open'),
            call: t('admin.settings.payment.wxpayGuideH5Call'),
            fallback: t('admin.settings.payment.wxpayGuideH5Fallback')
          }
        ]
      }
    }
    if (form.provider_key === 'airwallex') {
      return {
        summary: t('admin.settings.payment.airwallexGuideSummary'),
        note: t('admin.settings.payment.airwallexGuideNote'),
        items: []
      }
    }
    return null
  })()

  const limitableTypes: TypeOption[] = (() => {
    // Stripe: single "stripe" entry (one set of shared limits)
    if (form.provider_key === 'stripe') {
      return [{ value: 'stripe', label: 'Stripe' }]
    }
    const selected = form.supported_types.filter((type) => type !== 'easypay')
    return selected.map((v) => allPaymentTypes.find((pt) => pt.value === v) || { value: v, label: v })
  })()

  // --- Methods ---
  const isTypeSelected = (type: string) => form.supported_types.includes(type)

  const toggleType = (type: string) => {
    setForm((prev) => ({
      ...prev,
      supported_types: prev.supported_types.includes(type)
        ? prev.supported_types.filter((item) => item !== type)
        : [...prev.supported_types, type]
    }))
  }

  const addEasyPayCustomMethod = () => {
    setEasyPayCustomMethods((prev) => [...prev, { type: '', upstreamType: '', displayName: '' }])
  }

  const removeEasyPayCustomMethod = (index: number) => {
    setEasyPayCustomMethods((prev) => prev.filter((_, i) => i !== index))
  }

  const updateEasyPayCustomMethod = (index: number, patch: Partial<EasyPayCustomMethod>) => {
    setEasyPayCustomMethods((prev) => prev.map((method, i) => (i === index ? { ...method, ...patch } : method)))
  }

  const clearConfig = () => {
    setLimits({})
    setLimitDrafts({})
    setVisibleFields({})
    setNotifyBaseUrl('')
    setReturnBaseUrl('')
    setLimitsExpanded(false)
    setEasyPayCustomMethods([])
  }

  const onKeyChange = (providerKey: string) => {
    setForm((prev) => ({
      ...prev,
      provider_key: providerKey,
      supported_types: [...(PROVIDER_SUPPORTED_TYPES[providerKey] || [])],
      payment_mode: defaultPaymentMode(providerKey)
    }))
    clearConfig()
    setConfig(withDefaults(providerKey, {}))
  }

  const getLimitVal = (paymentType: string, field: string): string => {
    const draft = limitDrafts[`${paymentType}.${field}`]
    if (draft !== undefined) return draft
    const val = limits[paymentType]?.[field]
    return val && val > 0 ? String(val) : ''
  }

  /** Returns true if any limit field for this payment type has a value */
  const hasAnyLimit = (paymentType: string): boolean => {
    const l = limits[paymentType]
    if (!l) return false
    return l.singleMin > 0 || l.singleMax > 0 || l.dailyLimit > 0
  }

  /** Dynamic placeholder: "不限制" if sibling has value, "使用全局配置" if all empty */
  const limitPlaceholder = (paymentType: string): string =>
    hasAnyLimit(paymentType) ? t('admin.settings.payment.limitsNoLimit') : t('admin.settings.payment.limitsUseGlobal')

  const setLimitVal = (paymentType: string, field: string, val: string) => {
    setLimitDrafts((prev) => ({ ...prev, [`${paymentType}.${field}`]: val }))
    const num = Number(val)
    // Empty → clear the field (use global); reject ≤0
    if (val === '' || isNaN(num)) {
      setLimits((prev) => {
        const fields = { ...(prev[paymentType] || {}) }
        delete fields[field]
        return { ...prev, [paymentType]: fields }
      })
      return
    }
    if (num <= 0) {
      setLimits((prev) => (prev[paymentType] ? prev : { ...prev, [paymentType]: {} }))
      return
    }
    setLimits((prev) => ({ ...prev, [paymentType]: { ...(prev[paymentType] || {}), [field]: num } }))
  }

  const serializeLimits = (): string => {
    const result: Record<string, Record<string, number>> = {}
    for (const [pt, fields] of Object.entries(limits)) {
      const clean: Record<string, number> = {}
      for (const [k, v] of Object.entries(fields)) {
        if (v > 0) clean[k] = v
      }
      if (Object.keys(clean).length > 0) result[pt] = clean
    }
    return Object.keys(result).length > 0 ? JSON.stringify(result) : ''
  }

  const syncEasyPayCustomMethods = (supportedTypes: string[]): string[] => {
    const baseTypes = new Set(PROVIDER_SUPPORTED_TYPES.easypay || [])
    const customTypes: string[] = []
    const seen = new Set<string>()
    for (const method of normalizeEasyPayCustomMethods(easyPayCustomMethods)) {
      if (!method.type || !method.upstreamType) continue
      if (seen.has(method.type)) continue
      seen.add(method.type)
      customTypes.push(method.type)
    }
    const next = supportedTypes
      .map((type) => normalizeEasyPayCustomMethodCode(type))
      .filter((type) => baseTypes.has(type) || customTypes.includes(type))
    for (const customType of customTypes) {
      if (!next.includes(customType)) next.push(customType)
    }
    return next
  }

  const validateEasyPayCustomMethods = (): string | null => {
    const seen = new Set<string>()
    for (const method of normalizeEasyPayCustomMethods(easyPayCustomMethods)) {
      const hasAnyValue = Boolean(method.type || method.upstreamType || method.displayName)
      if (!hasAnyValue) continue
      if (!method.type || !method.upstreamType) {
        return t('admin.settings.payment.validationEasyPayCustomMethodRequired')
      }
      if (!/^[a-z0-9_-]+$/.test(method.type)) {
        return t('admin.settings.payment.validationEasyPayCustomMethodTypeInvalid')
      }
      if (!/^[a-z0-9_.-]+$/.test(method.upstreamType)) {
        return t('admin.settings.payment.validationEasyPayCustomMethodUpstreamTypeInvalid')
      }
      if ((PROVIDER_SUPPORTED_TYPES.easypay || []).includes(method.type)) {
        return t('admin.settings.payment.validationEasyPayCustomMethodReserved')
      }
      if (method.type.startsWith('alipay') || method.type.startsWith('wxpay')) {
        return t('admin.settings.payment.validationEasyPayCustomMethodPrefixReserved')
      }
      if (seen.has(method.type)) {
        return t('admin.settings.payment.validationEasyPayCustomMethodDuplicate')
      }
      seen.add(method.type)
    }
    return null
  }

  const handleSave = (event?: FormEvent) => {
    event?.preventDefault()
    // Validate required fields
    if (!form.name.trim()) {
      emitValidationError(t('admin.settings.payment.validationNameRequired'))
      return
    }
    let supportedTypes = form.supported_types
    if (form.provider_key === 'easypay') {
      const validationError = validateEasyPayCustomMethods()
      if (validationError) {
        emitValidationError(validationError)
        return
      }
      supportedTypes = syncEasyPayCustomMethods(supportedTypes)
      setForm((prev) => ({ ...prev, supported_types: supportedTypes }))
    }
    // Validate required config fields — all non-optional fields must be filled.
    // In edit mode, sensitive fields may be left blank to preserve the stored
    // value (backend merges blanks by preserving the existing secret).
    for (const f of PROVIDER_CONFIG_FIELDS[form.provider_key] || []) {
      if (f.optional) continue
      if (editing && f.sensitive) continue
      const val = (config[f.key] || '').trim()
      if (!val) {
        const label = f.label || t(`admin.settings.payment.field_${f.key}`)
        emitValidationError(t('admin.settings.payment.validationFieldRequired', { field: label }))
        return
      }
    }

    const clearableConfigKeys = new Set(
      (PROVIDER_CONFIG_FIELDS[form.provider_key] || []).filter((field) => field.clearable).map((field) => field.key)
    )
    const filteredConfig: Record<string, string> = {}
    for (const [k, v] of Object.entries(config)) {
      if (!v || !v.trim()) {
        if (clearableConfigKeys.has(k)) {
          filteredConfig[k] = ''
        }
        continue
      }
      filteredConfig[k] = v
    }
    if (form.provider_key === 'easypay') {
      filteredConfig.customMethods = serializeEasyPayCustomMethods(normalizeEasyPayCustomMethods(easyPayCustomMethods))
    }

    // Inject computed callback URLs (each URL = independent base + fixed path)
    // If base URL is empty, auto-fill with current domain
    const paths = PROVIDER_CALLBACK_PATHS[form.provider_key]
    if (paths) {
      const notifyBase = (notifyBaseUrl.trim() || defaultBaseUrl).replace(/\/+$/, '')
      const returnBase = (returnBaseUrl.trim() || defaultBaseUrl).replace(/\/+$/, '')
      setNotifyBaseUrl(notifyBase)
      setReturnBaseUrl(returnBase)
      if (paths.notifyUrl) filteredConfig['notifyUrl'] = notifyBase + paths.notifyUrl
      if (paths.returnUrl) filteredConfig['returnUrl'] = returnBase + paths.returnUrl
    }

    onSave?.({
      provider_key: form.provider_key,
      name: form.name,
      supported_types: supportedTypes,
      enabled: form.enabled,
      payment_mode: supportsPaymentMode ? form.payment_mode : '',
      refund_enabled: form.refund_enabled,
      allow_user_refund: form.refund_enabled ? form.allow_user_refund : false,
      config: filteredConfig,
      limits: serializeLimits()
    })
  }

  // --- Public API for parent to call ---
  useImperativeHandle(ref, () => ({
    reset(defaultKey: string) {
      setForm({
        name: '',
        provider_key: defaultKey,
        supported_types: [...(PROVIDER_SUPPORTED_TYPES[defaultKey] || [])],
        enabled: true,
        payment_mode: defaultPaymentMode(defaultKey),
        refund_enabled: false,
        allow_user_refund: false
      })
      clearConfig()
      setConfig(withDefaults(defaultKey, {}))
    },
    loadProvider(provider: ProviderInstance) {
      setForm({
        name: provider.name,
        provider_key: provider.provider_key,
        supported_types: Array.isArray(provider.supported_types) ? [...provider.supported_types] : [],
        enabled: provider.enabled,
        // Coerce to a valid value for this provider. Guards against stale data
        // (e.g. "popup" written by an older client) showing up as an unselected
        // button in the dialog.
        payment_mode: isValidPaymentMode(provider.provider_key, provider.payment_mode || '')
          ? provider.payment_mode || ''
          : defaultPaymentMode(provider.provider_key),
        refund_enabled: provider.refund_enabled,
        allow_user_refund: provider.allow_user_refund
      })
      clearConfig()
      // Pre-fill config from API response. Backend omits sensitive fields entirely,
      // so those inputs stay blank — submitting blank preserves the stored secret.
      const nextConfig: Record<string, string> = {}
      const customMethods: EasyPayCustomMethod[] = []
      if (provider.config) {
        for (const [k, v] of Object.entries(provider.config)) {
          // Skip notifyUrl/returnUrl — they are derived from callbackBaseUrl
          if (k === 'notifyUrl' || k === 'returnUrl') continue
          if (k === 'customMethods' && provider.provider_key === 'easypay') {
            customMethods.push(...parseEasyPayCustomMethods(v))
            continue
          }
          nextConfig[k] = v
        }
        // Extract base URLs from existing callback URLs
        const paths = PROVIDER_CALLBACK_PATHS[provider.provider_key]
        if (paths?.notifyUrl && provider.config['notifyUrl']) {
          setNotifyBaseUrl(extractBaseUrl(provider.config['notifyUrl'], paths.notifyUrl))
        }
        if (paths?.returnUrl && provider.config['returnUrl']) {
          setReturnBaseUrl(extractBaseUrl(provider.config['returnUrl'], paths.returnUrl))
        }
      }
      setEasyPayCustomMethods(customMethods)
      setConfig(withDefaults(provider.provider_key, nextConfig))
      // Parse existing limits
      if (provider.limits) {
        try {
          const parsed = JSON.parse(provider.limits) as Record<string, Record<string, number>>
          const nextLimits: Record<string, Record<string, number>> = {}
          for (const [pt, fields] of Object.entries(parsed)) {
            nextLimits[pt] = { ...fields }
          }
          setLimits(nextLimits)
          setLimitsExpanded(Object.keys(nextLimits).length > 0)
        } catch {
          /* ignore */
        }
      }
    }
  }))

  const setConfigValue = (key: string, value: string) => setConfig((prev) => ({ ...prev, [key]: value }))

  const keyOptions = (editing ? allKeyOptions : enabledKeyOptions) as SelectOption[]

  return (
    <AccountFormDrawer
      show={show}
      title={editing ? t('admin.settings.payment.editProvider') : t('admin.settings.payment.createProvider')}
      width="wide"
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
      <form id={formId} className={styles.form} onSubmit={handleSave}>
        <FormSection>
          {/* Name + Key */}
          <div className={styles.pair}>
            <Input
              label={t('admin.settings.payment.providerName')}
              required
              value={form.name}
              onChange={(value) => setForm((prev) => ({ ...prev, name: value }))}
            />
            <FormField label={t('admin.settings.payment.providerKey')} required>
              <Select
                value={form.provider_key}
                options={keyOptions}
                disabled={!!editing}
                aria-label={t('admin.settings.payment.providerKey')}
                onChange={(value) => onKeyChange(String(value ?? ''))}
              />
            </FormField>
          </div>

          {/* Toggles + Payment mode + Supported types (single row) */}
          <div className={styles.toggles}>
            <ToggleSwitch
              label={t('common.enabled')}
              checked={form.enabled}
              onToggle={() => setForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
            />
            <ToggleSwitch
              label={t('admin.settings.payment.refundEnabled')}
              checked={form.refund_enabled}
              onToggle={() =>
                setForm((prev) => ({
                  ...prev,
                  refund_enabled: !prev.refund_enabled,
                  allow_user_refund: prev.refund_enabled ? false : prev.allow_user_refund
                }))
              }
            />
            {form.refund_enabled && (
              <ToggleSwitch
                label={t('admin.settings.payment.allowUserRefund')}
                checked={form.allow_user_refund}
                onToggle={() => setForm((prev) => ({ ...prev, allow_user_refund: !prev.allow_user_refund }))}
              />
            )}
            {supportsPaymentMode && (
              <div className={styles.inline}>
                <span className={styles.inlineLabel}>{t('admin.settings.payment.paymentMode')}</span>
                <SegmentedControl
                  label={t('admin.settings.payment.paymentMode')}
                  options={paymentModeOptions}
                  value={form.payment_mode}
                  onValueChange={(mode) => setForm((prev) => ({ ...prev, payment_mode: mode }))}
                />
              </div>
            )}
            {availableTypes.length > 1 && (
              <div className={styles.inline} role="group" aria-label={t('admin.settings.payment.supportedTypes')}>
                <span className={styles.inlineLabel}>{t('admin.settings.payment.supportedTypes')}</span>
                <div className={styles.chips}>
                  {availableTypes.map((pt) => (
                    <button
                      key={pt.value}
                      type="button"
                      className={styles.chip}
                      aria-pressed={isTypeSelected(pt.value)}
                      onClick={() => toggleType(pt.value)}
                    >
                      {pt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </FormSection>

        {form.provider_key === 'easypay' && (
          <FormSection
            title={t('admin.settings.payment.easypayCustomMethods')}
            description={t('admin.settings.payment.easypayCustomMethodsHint')}
            action={
              <Button type="button" variant="secondary" size="sm" onClick={addEasyPayCustomMethod}>
                {t('admin.settings.payment.addCustomMethod')}
              </Button>
            }
          >
            {easyPayCustomMethods.length > 0 && (
              <div className={styles.methods}>
                {easyPayCustomMethods.map((method, index) => (
                  <div key={index} className={styles.methodRow}>
                    <Input
                      label={t('admin.settings.payment.customMethodType')}
                      value={method.type}
                      placeholder="credit_card"
                      onChange={(value) => updateEasyPayCustomMethod(index, { type: value })}
                    />
                    <Input
                      label={t('admin.settings.payment.customMethodUpstreamType')}
                      value={method.upstreamType}
                      placeholder="credit_card"
                      onChange={(value) => updateEasyPayCustomMethod(index, { upstreamType: value })}
                    />
                    <Input
                      label={t('admin.settings.payment.customMethodDisplayName')}
                      value={method.displayName}
                      placeholder={t('admin.settings.payment.customMethodDisplayNamePlaceholder')}
                      onChange={(value) => updateEasyPayCustomMethod(index, { displayName: value })}
                    />
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => removeEasyPayCustomMethod(index)}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </FormSection>
        )}

        {/* Config fields */}
        <FormSection
          title={
            <span className={styles.titleRow}>
              {t('admin.settings.payment.providerConfig')}
              {paymentGuide && (
                <HelpTooltip
                  trigger="click"
                  width="20rem"
                  triggerContent={
                    <button
                      type="button"
                      className={styles.guideTrigger}
                      aria-label={t('admin.settings.payment.paymentGuideTrigger')}
                      title={t('admin.settings.payment.paymentGuideTrigger')}
                    >
                      ?
                    </button>
                  }
                >
                  <div className={styles.guide}>
                    <p className={styles.guideStrong}>{paymentGuide.summary}</p>
                    {paymentGuide.items.map((item) => (
                      <div key={item.title} className={styles.guideItem}>
                        <p className={styles.guideStrong}>{item.title}</p>
                        <p>
                          <span className={styles.guideLabel}>{t('admin.settings.payment.guideOpenLabel')}</span>
                          {item.open}
                        </p>
                        <p>
                          <span className={styles.guideLabel}>{t('admin.settings.payment.guideCallLabel')}</span>
                          {item.call}
                        </p>
                        <p>
                          <span className={styles.guideLabel}>{t('admin.settings.payment.guideFallbackLabel')}</span>
                          {item.fallback}
                        </p>
                      </div>
                    ))}
                    {paymentGuide.note && <p className={styles.guideNote}>{paymentGuide.note}</p>}
                  </div>
                </HelpTooltip>
              )}
            </span>
          }
          description={paymentGuide ? paymentGuide.summary : undefined}
        >
          {resolvedFields.map((field) => (
            <ConfigFieldControl
              key={field.key}
              field={field}
              value={config[field.key] ?? ''}
              editing={!!editing}
              visible={!!visibleFields[field.key]}
              onChange={(value) => setConfigValue(field.key, value)}
              onToggleVisible={() => setVisibleFields((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
            />
          ))}

          {/* Callback URLs (each = editable URL + fixed path) */}
          {callbackPaths && (
            <>
              {callbackPaths.notifyUrl && (
                <CallbackUrlField
                  label={t('admin.settings.payment.field_notifyUrl')}
                  value={notifyBaseUrl}
                  placeholder={defaultBaseUrl}
                  path={callbackPaths.notifyUrl}
                  onChange={setNotifyBaseUrl}
                />
              )}
              {callbackPaths.returnUrl && (
                <CallbackUrlField
                  label={t('admin.settings.payment.field_returnUrl')}
                  value={returnBaseUrl}
                  placeholder={defaultBaseUrl}
                  path={callbackPaths.returnUrl}
                  onChange={setReturnBaseUrl}
                />
              )}
            </>
          )}

          {/* 服务商 Webhook 提示 */}
          {providerWebhookUrl && (
            <FormNotice tone="info">
              <p className={styles.noticeText}>{t(providerWebhookHint)}</p>
              <code className={styles.code}>{providerWebhookUrl}</code>
              {form.provider_key === 'stripe' && (
                <p className={styles.noticeText}>
                  {t('admin.settings.payment.stripeWebhookApiVersionHint', { version: STRIPE_SDK_API_VERSION })}
                </p>
              )}
            </FormNotice>
          )}
        </FormSection>

        {/* Per-type limits (collapsible) */}
        {limitableTypes.length > 0 && (
          <FormSection>
            <button
              type="button"
              className={styles.collapse}
              aria-expanded={limitsExpanded}
              onClick={() => setLimitsExpanded((prev) => !prev)}
            >
              <span className={styles.collapseTitle}>{t('admin.settings.payment.limitsTitle')}</span>
              <ChevronDown size={16} className={styles.chevron} data-open={limitsExpanded || undefined} aria-hidden="true" />
            </button>
            {limitsExpanded && (
              <div className={styles.limits}>
                {limitableTypes.map((lt) => (
                  <div key={lt.value} className={styles.limitGroup}>
                    <p className={styles.limitTitle}>{lt.label}</p>
                    <div className={styles.limitFields}>
                      {LIMIT_FIELDS.map(({ field, labelKey }) => (
                        <Input
                          key={field}
                          label={t(labelKey)}
                          type="number"
                          min="1"
                          step="0.01"
                          value={getLimitVal(lt.value, field)}
                          placeholder={limitPlaceholder(lt.value)}
                          onChange={(value) => setLimitVal(lt.value, field, value)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <p className={styles.hint}>{t('admin.settings.payment.limitsHint')}</p>
              </div>
            )}
          </FormSection>
        )}
      </form>
    </AccountFormDrawer>
  )
}

interface CallbackUrlFieldProps {
  label: string
  value: string
  placeholder: string
  path: string
  onChange: (value: string) => void
}

/** 回调地址：可编辑的基础 URL + 固定路径 */
function CallbackUrlField({ label, value, placeholder, path, onChange }: CallbackUrlFieldProps) {
  const id = useId()
  return (
    <FormField label={label} htmlFor={id} required>
      <div className={styles.addonGroup}>
        <input
          id={id}
          type="text"
          className={styles.addonInput}
          value={value}
          placeholder={placeholder}
          data-callback-base=""
          onChange={(event) => onChange(event.target.value)}
        />
        <span className={styles.addon}>{path}</span>
      </div>
    </FormField>
  )
}

interface ConfigFieldControlProps {
  field: ConfigFieldDef & { label: string }
  value: string
  editing: boolean
  visible: boolean
  onChange: (value: string) => void
  onToggleVisible: () => void
}

/**
 * 单个配置字段。必填只显示星号，不设置原生 required（与 Vue 版一致：
 * 编辑时敏感字段可留空以保留原值，必填校验由 handleSave 负责）。
 */
function ConfigFieldControl({ field, value, editing, visible, onChange, onToggleVisible }: ConfigFieldControlProps) {
  const { t } = useI18n()
  const id = useId()
  const label = (
    <>
      {field.label}
      {field.optional && <span className={styles.optional}> ({t('common.optional')})</span>}
    </>
  )
  const hint = field.hintKey ? t(field.hintKey) : undefined
  const secretProps = {
    autoComplete: 'new-password',
    'data-1p-ignore': '',
    'data-lpignore': 'true',
    'data-bwignore': 'true',
    spellCheck: false
  }

  let control
  if (field.sensitive && field.key.toLowerCase().includes('key') && field.key !== 'pkey') {
    control = (
      <TextArea
        id={id}
        value={value}
        onChange={onChange}
        rows={3}
        className={styles.monoInput}
        placeholder={editing ? t('admin.accounts.leaveEmptyToKeep') : ''}
        {...secretProps}
      />
    )
  } else if (field.sensitive) {
    control = (
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={editing ? t('admin.accounts.leaveEmptyToKeep') : field.defaultValue || ''}
        {...secretProps}
        suffix={
          <button
            type="button"
            className={styles.reveal}
            aria-label={visible ? t('authUi.hidePassword') : t('authUi.showPassword')}
            aria-pressed={visible}
            onClick={onToggleVisible}
          >
            {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        }
      />
    )
  } else if (field.options?.length) {
    control = (
      <Select
        id={id}
        value={value}
        options={field.options as SelectOption[]}
        searchable={field.options.length > 5}
        onChange={(next) => onChange(String(next ?? ''))}
      />
    )
  } else {
    control = (
      <Input id={id} type="text" value={value} onChange={onChange} placeholder={field.defaultValue || ''} />
    )
  }

  return (
    <FormField label={label} htmlFor={id} required={!field.optional} hint={hint}>
      {control}
    </FormField>
  )
}
