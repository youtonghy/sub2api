import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, CircleCheck, Info, Plus, Trash2, TriangleAlert, X } from 'lucide-react'

import { adminAPI } from '@/api/admin'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { Switch } from '@/components/arc/switch/switch'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import GroupSelector from '@/components/common/GroupSelector'
import Input from '@/components/common/Input'
import ProxySelector from '@/components/common/ProxySelector'
import Select from '@/components/common/Select'
import {
  buildModelMappingObject as buildModelMappingPayload,
  getPresetMappingsByPlatform
} from '@/composables/useModelWhitelist'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type {
  AccountPlatform,
  AccountType,
  AdminGroup,
  OpenAICompactMode,
  OpenAIEndpointCapability,
  OpenAIResponsesMode,
  Proxy as ProxyConfig
} from '@/types'
import {
  OPENAI_WS_MODE_CTX_POOL,
  OPENAI_WS_MODE_HTTP_BRIDGE,
  OPENAI_WS_MODE_OFF,
  OPENAI_WS_MODE_PASSTHROUGH,
  isOpenAIWSModeEnabled,
  resolveOpenAIWSModeHintKey,
  type OpenAIWSMode
} from '@/utils/openaiWsMode'
import { AccountFormDrawer, FormNotice } from './AccountFormLayout'
import formStyles from './AccountForm.module.css'
import styles from './BulkEditAccountModal.module.css'
import {
  buildHeaderOverridesObject,
  isHeaderOverrideCapable,
  validateHeaderOverrideRows,
  HEADER_OVERRIDE_ENABLED_CREDENTIAL_KEY,
  HEADER_OVERRIDES_CREDENTIAL_KEY,
  type HeaderOverrideRow
} from './credentialsBuilder'
import GrokBaseUrlPresets from './GrokBaseUrlPresets'
import HeaderOverrideEditor from './HeaderOverrideEditor'
import ModelWhitelistSelector from './ModelWhitelistSelector'
import { useConfirmDialog } from '@/composables/useConfirmDialog'

export interface BulkEditTarget {
  mode: 'selected' | 'filtered'
  filters?: Record<string, unknown>
  previewCount?: number
  selectedPlatforms?: AccountPlatform[]
  selectedTypes?: AccountType[]
}

export interface BulkEditAccountModalProps {
  show: boolean
  accountIds: number[]
  selectedPlatforms: AccountPlatform[]
  selectedTypes: AccountType[]
  target?: BulkEditTarget
  proxies: ProxyConfig[]
  groups: AdminGroup[]
  onClose: () => void
  onUpdated: () => void
}

// Model mapping type
interface ModelMapping {
  from: string
  to: string
}

type CodexFingerprintMode = 'off' | 'device' | 'session' | 'full'

interface BulkEditState {
  // State - field enable flags
  enableBaseUrl: boolean
  enableModelRestriction: boolean
  enableCustomErrorCodes: boolean
  enableInterceptWarmup: boolean
  enableHeaderOverride: boolean
  enableProxy: boolean
  enableConcurrency: boolean
  enableLoadFactor: boolean
  enableRateMultiplier: boolean
  enableStatus: boolean
  enableGroups: boolean
  enableOpenAIPassthrough: boolean
  enableOpenAIFlattenNamespaces: boolean
  enableOpenAILongContextBilling: boolean
  enableOpenAIEndpointCapabilities: boolean
  enableOpenAIResponsesMode: boolean
  enableOpenAIWSMode: boolean
  enableOpenAIAPIKeyWSMode: boolean
  enableUpstreamBillingAutoProbe: boolean
  enableCodexCLIOnly: boolean
  enableCodexCLIOnlyAppServer: boolean
  enableCodexFingerprintMode: boolean
  enableOpenAICompactMode: boolean
  enableOpenAICompactModelMapping: boolean
  enableRpmLimit: boolean
  // State - field values
  baseUrl: string
  modelRestrictionMode: 'whitelist' | 'mapping'
  allowedModels: string[]
  modelMappings: ModelMapping[]
  selectedErrorCodes: number[]
  customErrorCodeInput: number | null
  interceptWarmupRequests: boolean
  headerOverrideEnabled: boolean
  headerOverrideRows: HeaderOverrideRow[]
  proxyId: number | null
  concurrency: number
  loadFactor: number | null
  /** v-model.number：清空输入时为 ''（与 Vue 版一致，原样提交） */
  rateMultiplier: number | ''
  status: 'active' | 'inactive'
  groupIds: number[]
  openaiPassthroughEnabled: boolean
  // Codex namespace 工具摊平兼容开关（仅 OAuth），缺省关闭即原样保留
  openaiFlattenNamespacesEnabled: boolean
  openAILongContextBillingEnabled: boolean
  openAIEndpointCapabilities: OpenAIEndpointCapability[]
  openAIResponsesMode: OpenAIResponsesMode
  openaiOAuthResponsesWebSocketV2Mode: OpenAIWSMode
  openaiAPIKeyResponsesWebSocketV2Mode: OpenAIWSMode
  upstreamBillingAutoProbeMode: 'enabled' | 'disabled'
  codexCLIOnlyEnabled: boolean
  codexCLIOnlyAppServerEnabled: boolean
  codexFingerprintMode: CodexFingerprintMode
  openAICompactMode: OpenAICompactMode
  openAICompactModelMappings: ModelMapping[]
  rpmLimitEnabled: boolean
  bulkBaseRpm: number | null
  bulkRpmStrategy: 'tiered' | 'sticky_exempt'
  bulkRpmStickyBuffer: number | null
  userMsgQueueMode: string | null
}

const createInitialState = (): BulkEditState => ({
  enableBaseUrl: false,
  enableModelRestriction: false,
  enableCustomErrorCodes: false,
  enableInterceptWarmup: false,
  enableHeaderOverride: false,
  enableProxy: false,
  enableConcurrency: false,
  enableLoadFactor: false,
  enableRateMultiplier: false,
  enableStatus: false,
  enableGroups: false,
  enableOpenAIPassthrough: false,
  enableOpenAIFlattenNamespaces: false,
  enableOpenAILongContextBilling: false,
  enableOpenAIEndpointCapabilities: false,
  enableOpenAIResponsesMode: false,
  enableOpenAIWSMode: false,
  enableOpenAIAPIKeyWSMode: false,
  enableUpstreamBillingAutoProbe: false,
  enableCodexCLIOnly: false,
  enableCodexCLIOnlyAppServer: false,
  enableCodexFingerprintMode: false,
  enableOpenAICompactMode: false,
  enableOpenAICompactModelMapping: false,
  enableRpmLimit: false,
  baseUrl: '',
  modelRestrictionMode: 'whitelist',
  allowedModels: [],
  modelMappings: [],
  selectedErrorCodes: [],
  customErrorCodeInput: null,
  interceptWarmupRequests: false,
  headerOverrideEnabled: false,
  headerOverrideRows: [],
  proxyId: null,
  concurrency: 1,
  loadFactor: null,
  rateMultiplier: 1,
  status: 'active',
  groupIds: [],
  openaiPassthroughEnabled: false,
  openaiFlattenNamespacesEnabled: false,
  openAILongContextBillingEnabled: false,
  openAIEndpointCapabilities: ['chat_completions', 'embeddings'],
  openAIResponsesMode: 'auto',
  openaiOAuthResponsesWebSocketV2Mode: OPENAI_WS_MODE_OFF,
  openaiAPIKeyResponsesWebSocketV2Mode: OPENAI_WS_MODE_OFF,
  upstreamBillingAutoProbeMode: 'enabled',
  codexCLIOnlyEnabled: false,
  codexCLIOnlyAppServerEnabled: false,
  codexFingerprintMode: 'off',
  openAICompactMode: 'auto',
  openAICompactModelMappings: [],
  rpmLimitEnabled: false,
  bulkBaseRpm: null,
  bulkRpmStrategy: 'tiered',
  bulkRpmStickyBuffer: null,
  userMsgQueueMode: null
})

/** Vue v-model.number：可解析为数字时取数字，空串保持 '' */
const toNumberModel = (raw: string): number | '' => {
  if (raw === '') return ''
  const parsed = parseFloat(raw)
  return Number.isNaN(parsed) ? '' : parsed
}
/** 数字输入：空串视为 null */
const toNullableNumber = (raw: string): number | null => {
  const value = toNumberModel(raw)
  return value === '' ? null : value
}

// Common HTTP error codes
const commonErrorCodes = [
  { value: 401, label: 'Unauthorized' },
  { value: 403, label: 'Forbidden' },
  { value: 429, label: 'Rate Limit' },
  { value: 500, label: 'Server Error' },
  { value: 502, label: 'Bad Gateway' },
  { value: 503, label: 'Unavailable' },
  { value: 529, label: 'Overloaded' }
]

const sortCodes = (codes: number[]) => [...codes].sort((a, b) => a - b)

const normalizeOpenAIEndpointCapabilities = (values: OpenAIEndpointCapability[]) => {
  const allowed: OpenAIEndpointCapability[] = ['chat_completions', 'embeddings', 'seedance']
  const selected = allowed.filter((value) => values.includes(value))
  return selected.length > 0 ? selected : (['chat_completions', 'embeddings'] as OpenAIEndpointCapability[])
}

interface BulkFieldProps {
  /** 基础 id：标签为 `${id}-label`，启用勾选框为 `${id}-enabled` */
  id: string
  label: ReactNode
  description?: ReactNode
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  /** 勾选框 aria-controls 指向的元素 id */
  controls?: string
  ariaLabel: string
  children?: ReactNode
  className?: string
}

/** 批量编辑的单个字段：左侧标签与说明，右侧“编辑该项”勾选框，下方为字段内容 */
function BulkField({
  id,
  label,
  description,
  enabled,
  onEnabledChange,
  controls,
  ariaLabel,
  children,
  className
}: BulkFieldProps) {
  return (
    <section className={[formStyles.section, className].filter(Boolean).join(' ')}>
      <div className={formStyles.sectionHeader}>
        <div className={formStyles.sectionHeading}>
          <label id={`${id}-label`} className={styles.fieldTitle} htmlFor={`${id}-enabled`}>
            {label}
          </label>
          {description ? <p className={formStyles.sectionDescription}>{description}</p> : null}
        </div>
        <div className={formStyles.sectionAction}>
          <Checkbox
            id={`${id}-enabled`}
            checked={enabled}
            onCheckedChange={(next) => onEnabledChange(next === true)}
            aria-controls={controls}
            aria-label={ariaLabel}
          />
        </div>
      </div>
      {children}
    </section>
  )
}

/** 字段主体：未启用时变淡并屏蔽指针（与 Vue 版 pointer-events-none opacity-50 一致） */
function FieldBody({
  id,
  enabled,
  children,
  labelledBy,
  group = false
}: {
  id?: string
  enabled: boolean
  children: ReactNode
  labelledBy?: string
  group?: boolean
}) {
  return (
    <div
      id={id}
      className={[styles.fieldBody, enabled ? undefined : styles.inactive].filter(Boolean).join(' ')}
      role={group ? 'group' : undefined}
      aria-labelledby={group ? labelledBy : undefined}
    >
      {children}
    </div>
  )
}

/** 批量编辑账号（对应 Vue 版 BulkEditAccountModal.vue） */
export default function BulkEditAccountModal({
  show,
  accountIds,
  selectedPlatforms,
  selectedTypes,
  target,
  proxies,
  groups,
  onClose,
  onUpdated
}: BulkEditAccountModalProps) {
  const { t } = useI18n()
  const { confirm, confirmDialog } = useConfirmDialog()

  const [form, setForm] = useState<BulkEditState>(createInitialState)
  const update = (patch: Partial<BulkEditState>) => setForm((prev) => ({ ...prev, ...patch }))

  const [submitting, setSubmitting] = useState(false)
  const [showMixedChannelWarning, setShowMixedChannelWarning] = useState(false)
  const [mixedChannelWarningMessage, setMixedChannelWarningMessage] = useState('')
  const pendingUpdatesForConfirm = useRef<Record<string, unknown> | null>(null)
  const mixedChannelConfirmed = useRef(false)

  // Platform awareness
  const targetMode = target?.mode ?? 'selected'
  const targetPreviewCount = target?.previewCount ?? accountIds.length
  const targetSelectedPlatforms = target?.selectedPlatforms ?? selectedPlatforms
  const targetSelectedTypes = target?.selectedTypes ?? selectedTypes
  // Grok 快捷端点仅在所选账号全部为 grok 平台时展示（其他平台不显示）
  const allTargetsGrok = targetSelectedPlatforms.length > 0 && targetSelectedPlatforms.every((p) => p === 'grok')
  const isMixedPlatform = targetSelectedPlatforms.length > 1

  const allOpenAIPassthroughCapable =
    targetSelectedPlatforms.length === 1 &&
    targetSelectedPlatforms[0] === 'openai' &&
    targetSelectedTypes.length > 0 &&
    targetSelectedTypes.every((ty) => ty === 'oauth' || ty === 'setup-token' || ty === 'apikey')

  const allOpenAIOAuth =
    targetSelectedPlatforms.length === 1 &&
    targetSelectedPlatforms[0] === 'openai' &&
    targetSelectedTypes.length > 0 &&
    targetSelectedTypes.every((ty) => ty === 'oauth' || ty === 'setup-token')

  // 严格 OAuth（不含 setup-token）：namespace 摊平兼容开关只对 OAuth 账号生效
  const allOpenAIOAuthOnly =
    targetSelectedPlatforms.length === 1 &&
    targetSelectedPlatforms[0] === 'openai' &&
    targetSelectedTypes.length > 0 &&
    targetSelectedTypes.every((ty) => ty === 'oauth')

  const allOpenAIAPIKey =
    targetSelectedPlatforms.length === 1 &&
    targetSelectedPlatforms[0] === 'openai' &&
    targetSelectedTypes.length > 0 &&
    targetSelectedTypes.every((ty) => ty === 'apikey')

  // 上游倍率自动探测已放宽到全部 API-key 平台：只要求所选类型全为 apikey，
  // 平台不限（sub2api 上游即可应答 /v1/sub2api/billing）。
  const allBillingProbeCapable = targetSelectedTypes.length > 0 && targetSelectedTypes.every((ty) => ty === 'apikey')

  // 是否全部为支持请求头覆写的平台/账号类型
  // 所选平台 × 所选类型的全组合均需具备覆写资格（实际选中账号是该组合的子集，
  // 按交叉积判定偏保守但绝不放行不合资格的账号）
  const allHeaderOverrideCapable =
    targetSelectedPlatforms.length > 0 &&
    targetSelectedTypes.length > 0 &&
    targetSelectedPlatforms.every((p) => targetSelectedTypes.every((ty) => isHeaderOverrideCapable(p, ty)))

  // 是否全部为 Anthropic OAuth/SetupToken（RPM 配置仅在此条件下显示）
  const allAnthropicOAuthOrSetupToken =
    targetSelectedPlatforms.length === 1 &&
    targetSelectedPlatforms[0] === 'anthropic' &&
    targetSelectedTypes.every((ty) => ty === 'oauth' || ty === 'setup-token')

  const filteredPresets = (() => {
    if (targetSelectedPlatforms.length === 0) return []

    const dedupedPresets = new Map<string, ReturnType<typeof getPresetMappingsByPlatform>[number]>()
    for (const platform of targetSelectedPlatforms) {
      for (const preset of getPresetMappingsByPlatform(platform)) {
        const key = `${preset.from}=>${preset.to}`
        if (!dedupedPresets.has(key)) {
          dedupedPresets.set(key, preset)
        }
      }
    }

    return Array.from(dedupedPresets.values())
  })()

  const codexFingerprintModeOptions = [
    { value: 'off', label: t('admin.accounts.openai.codexFingerprintOff') },
    { value: 'device', label: t('admin.accounts.openai.codexFingerprintDevice') },
    { value: 'session', label: t('admin.accounts.openai.codexFingerprintSession') },
    { value: 'full', label: t('admin.accounts.openai.codexFingerprintFull') }
  ]
  const umqModeOptions = [
    { value: '', label: t('admin.accounts.quotaControl.rpmLimit.umqModeOff') },
    { value: 'throttle', label: t('admin.accounts.quotaControl.rpmLimit.umqModeThrottle') },
    { value: 'serialize', label: t('admin.accounts.quotaControl.rpmLimit.umqModeSerialize') }
  ]
  const statusOptions = [
    { value: 'active', label: t('common.active') },
    { value: 'inactive', label: t('common.inactive') }
  ]
  const upstreamBillingAutoProbeOptions = [
    { value: 'enabled', label: t('common.enabled') },
    { value: 'disabled', label: t('common.disabled') }
  ]
  const isOpenAIModelRestrictionDisabled =
    allOpenAIPassthroughCapable && form.enableOpenAIPassthrough && form.openaiPassthroughEnabled

  const openAIWSModeOptions = [
    { value: OPENAI_WS_MODE_OFF, label: t('admin.accounts.openai.wsModeOff') },
    { value: OPENAI_WS_MODE_CTX_POOL, label: t('admin.accounts.openai.wsModeCtxPool') },
    { value: OPENAI_WS_MODE_PASSTHROUGH, label: t('admin.accounts.openai.wsModePassthrough') },
    { value: OPENAI_WS_MODE_HTTP_BRIDGE, label: t('admin.accounts.openai.wsModeHttpBridge') }
  ]
  const openAICompactModeOptions = [
    { value: 'auto', label: t('admin.accounts.openai.compactModeAuto') },
    { value: 'force_on', label: t('admin.accounts.openai.compactModeForceOn') },
    { value: 'force_off', label: t('admin.accounts.openai.compactModeForceOff') }
  ]
  const openAIResponsesModeOptions = [
    { value: 'auto', label: t('admin.accounts.openai.responsesModeAuto') },
    { value: 'force_responses', label: t('admin.accounts.openai.responsesModeForceResponses') },
    { value: 'force_chat_completions', label: t('admin.accounts.openai.responsesModeForceChatCompletions') }
  ]
  const openAITextEndpointCapabilityLabel =
    form.openAIResponsesMode === 'force_responses'
      ? t('admin.accounts.openai.capabilityResponses')
      : form.openAIResponsesMode === 'force_chat_completions'
        ? t('admin.accounts.openai.capabilityChatCompletions')
        : t('admin.accounts.openai.capabilityTextAuto')
  const openAIEndpointCapabilityOptions: Array<{ value: OpenAIEndpointCapability; label: string }> = [
    { value: 'chat_completions', label: openAITextEndpointCapabilityLabel },
    { value: 'embeddings', label: t('admin.accounts.openai.capabilityEmbeddings') },
    { value: 'seedance', label: 'Seedance (Ark)' }
  ]
  const openAITextGenerationCapabilityEnabled = form.openAIEndpointCapabilities.includes('chat_completions')
  const openAIResponsesModeApplicable =
    !form.enableOpenAIEndpointCapabilities || openAITextGenerationCapabilityEnabled

  const toggleOpenAIEndpointCapability = (capability: OpenAIEndpointCapability) => {
    const current = form.openAIEndpointCapabilities
    if (current.includes(capability)) {
      // 至少保留一个端点能力（受控勾选框保持勾选）
      if (current.length <= 1) return
      const next = current.filter((value) => value !== capability)
      const patch: Partial<BulkEditState> = { openAIEndpointCapabilities: next }
      if (!next.includes('chat_completions')) {
        patch.openAIResponsesMode = 'auto'
      }
      update(patch)
      return
    }
    update({ openAIEndpointCapabilities: normalizeOpenAIEndpointCapabilities([...current, capability]) })
  }
  const openAIWSModeHintKey = resolveOpenAIWSModeHintKey(form.openaiOAuthResponsesWebSocketV2Mode)
  const openAIAPIKeyWSModeHintKey = resolveOpenAIWSModeHintKey(form.openaiAPIKeyResponsesWebSocketV2Mode)

  // Model mapping helpers
  const addModelMapping = () => {
    update({ modelMappings: [...form.modelMappings, { from: '', to: '' }] })
  }

  const removeModelMapping = (index: number) => {
    update({ modelMappings: form.modelMappings.filter((_, i) => i !== index) })
  }

  const updateModelMapping = (index: number, patch: Partial<ModelMapping>) => {
    update({ modelMappings: form.modelMappings.map((m, i) => (i === index ? { ...m, ...patch } : m)) })
  }

  const addOpenAICompactModelMapping = () => {
    update({ openAICompactModelMappings: [...form.openAICompactModelMappings, { from: '', to: '' }] })
  }

  const removeOpenAICompactModelMapping = (index: number) => {
    update({ openAICompactModelMappings: form.openAICompactModelMappings.filter((_, i) => i !== index) })
  }

  const updateOpenAICompactModelMapping = (index: number, patch: Partial<ModelMapping>) => {
    update({
      openAICompactModelMappings: form.openAICompactModelMappings.map((m, i) => (i === index ? { ...m, ...patch } : m))
    })
  }

  const addPresetMapping = (from: string, to: string) => {
    const exists = form.modelMappings.some((m) => m.from === from)
    if (exists) {
      useAppStore.getState().showInfo(t('admin.accounts.mappingExists', { model: from }))
      return
    }
    update({ modelMappings: [...form.modelMappings, { from, to }] })
  }

  // Error code helpers
  const toggleErrorCode = async (code: number) => {
    const index = form.selectedErrorCodes.indexOf(code)
    if (index === -1) {
      // Adding code - check for 429/529 warning
      if (code === 429) {
        if (!(await confirm(t('admin.accounts.customErrorCodes429Warning')))) {
          return
        }
      } else if (code === 529) {
        if (!(await confirm(t('admin.accounts.customErrorCodes529Warning')))) {
          return
        }
      }
      setForm((prev) =>
        prev.selectedErrorCodes.includes(code)
          ? prev
          : { ...prev, selectedErrorCodes: sortCodes([...prev.selectedErrorCodes, code]) }
      )
    } else {
      setForm((prev) => ({ ...prev, selectedErrorCodes: prev.selectedErrorCodes.filter((c) => c !== code) }))
    }
  }

  const addCustomErrorCode = async () => {
    const code = form.customErrorCodeInput
    if (code === null || code < 100 || code > 599) {
      useAppStore.getState().showError(t('admin.accounts.invalidErrorCode'))
      return
    }
    if (form.selectedErrorCodes.includes(code)) {
      useAppStore.getState().showInfo(t('admin.accounts.errorCodeExists'))
      return
    }
    // Check for 429/529 warning
    if (code === 429) {
      if (!(await confirm(t('admin.accounts.customErrorCodes429Warning')))) {
        return
      }
    } else if (code === 529) {
      if (!(await confirm(t('admin.accounts.customErrorCodes529Warning')))) {
        return
      }
    }
    setForm((prev) => ({
      ...prev,
      selectedErrorCodes: prev.selectedErrorCodes.includes(code)
        ? prev.selectedErrorCodes
        : sortCodes([...prev.selectedErrorCodes, code]),
      customErrorCodeInput: null
    }))
  }

  const removeErrorCode = (code: number) => {
    update({ selectedErrorCodes: form.selectedErrorCodes.filter((c) => c !== code) })
  }

  const buildModelMappingObject = (): Record<string, string> | null => {
    return buildModelMappingPayload(form.modelRestrictionMode, form.allowedModels, form.modelMappings)
  }

  const buildOpenAICompactModelMapping = (): Record<string, string> | null => {
    return buildModelMappingPayload('mapping', [], form.openAICompactModelMappings)
  }

  const buildUpdatePayload = (): Record<string, unknown> | null => {
    const updates: Record<string, unknown> = {}
    const credentials: Record<string, unknown> = {}
    let credentialsChanged = false
    const applyOpenAILongContextBilling = form.enableOpenAILongContextBilling && allOpenAIPassthroughCapable
    const applyOpenAIEndpointCapabilities = form.enableOpenAIEndpointCapabilities && allOpenAIAPIKey
    const applyOpenAIResponsesMode = form.enableOpenAIResponsesMode && allOpenAIAPIKey
    const ensureExtra = (): Record<string, unknown> => {
      if (!updates.extra) {
        updates.extra = {}
      }
      return updates.extra as Record<string, unknown>
    }

    if (form.enableProxy) {
      // 后端期望 proxy_id: 0 表示清除代理，而不是 null
      updates.proxy_id = form.proxyId === null ? 0 : form.proxyId
    }

    if (form.enableConcurrency) {
      updates.concurrency = form.concurrency
    }

    if (form.enableLoadFactor) {
      // 空值/NaN/0 时发送 0（后端约定 <= 0 表示清除）
      const lf = form.loadFactor
      updates.load_factor = lf != null && !Number.isNaN(lf) && lf > 0 ? lf : 0
    }

    if (form.enableRateMultiplier) {
      updates.rate_multiplier = form.rateMultiplier
    }

    if (form.enableStatus) {
      updates.status = form.status
    }

    if (form.enableGroups) {
      updates.group_ids = form.groupIds
    }

    if (form.enableBaseUrl) {
      const baseUrlValue = form.baseUrl.trim()
      if (baseUrlValue) {
        credentials.base_url = baseUrlValue
        credentialsChanged = true
      }
    }

    if (form.enableOpenAIPassthrough) {
      const extra = ensureExtra()
      extra.openai_passthrough = form.openaiPassthroughEnabled
      if (!form.openaiPassthroughEnabled) {
        extra.openai_oauth_passthrough = false
      }
    }

    // 同时校验可见性：勾选后又改了目标筛选条件时，不应把该键写到非 OAuth 账号上
    if (form.enableOpenAIFlattenNamespaces && allOpenAIOAuthOnly) {
      const extra = ensureExtra()
      extra.openai_responses_flatten_namespaces = form.openaiFlattenNamespacesEnabled
    }

    if (applyOpenAILongContextBilling) {
      const extra = ensureExtra()
      extra.openai_long_context_billing_enabled = form.openAILongContextBillingEnabled
    }

    if (applyOpenAIEndpointCapabilities) {
      credentials.openai_capabilities =
        form.openAIEndpointCapabilities.length === 2 && !form.openAIEndpointCapabilities.includes('seedance')
          ? null
          : [...form.openAIEndpointCapabilities]
      credentialsChanged = true
    }

    if (applyOpenAIResponsesMode || (applyOpenAIEndpointCapabilities && !openAITextGenerationCapabilityEnabled)) {
      const extra = ensureExtra()
      extra.openai_responses_mode =
        !openAIResponsesModeApplicable || form.openAIResponsesMode === 'auto' ? null : form.openAIResponsesMode
    }

    if (form.enableModelRestriction && !isOpenAIModelRestrictionDisabled) {
      // 统一使用 model_mapping 字段
      if (form.modelRestrictionMode === 'whitelist') {
        // 白名单模式：将模型转换为 model_mapping 格式（key=value）
        // 空白名单表示“支持所有模型”，需显式发送空对象以覆盖已有限制。
        const mapping: Record<string, string> = {}
        for (const m of form.allowedModels) {
          mapping[m] = m
        }
        credentials.model_mapping = mapping
        credentialsChanged = true
      } else {
        // 映射模式下空配置同样表示“支持所有模型”。
        const modelMapping = buildModelMappingObject()
        credentials.model_mapping = modelMapping ?? {}
        credentialsChanged = true
      }
    }

    if (form.enableCustomErrorCodes) {
      credentials.custom_error_codes_enabled = true
      credentials.custom_error_codes = [...form.selectedErrorCodes]
      credentialsChanged = true
    }

    if (form.enableInterceptWarmup) {
      credentials.intercept_warmup_requests = form.interceptWarmupRequests
      credentialsChanged = true
    }

    if (form.enableHeaderOverride) {
      // 后端使用 JSONB || merge 语义：关闭时显式写入 false + 空对象以清除旧配置
      credentials[HEADER_OVERRIDE_ENABLED_CREDENTIAL_KEY] = form.headerOverrideEnabled
      credentials[HEADER_OVERRIDES_CREDENTIAL_KEY] = form.headerOverrideEnabled
        ? buildHeaderOverridesObject(form.headerOverrideRows)
        : {}
      credentialsChanged = true
    }

    if (form.enableOpenAIWSMode) {
      const extra = ensureExtra()
      extra.openai_oauth_responses_websockets_v2_mode = form.openaiOAuthResponsesWebSocketV2Mode
      extra.openai_oauth_responses_websockets_v2_enabled = isOpenAIWSModeEnabled(
        form.openaiOAuthResponsesWebSocketV2Mode
      )
    }

    if (form.enableOpenAIAPIKeyWSMode) {
      const extra = ensureExtra()
      extra.openai_apikey_responses_websockets_v2_mode = form.openaiAPIKeyResponsesWebSocketV2Mode
      extra.openai_apikey_responses_websockets_v2_enabled = isOpenAIWSModeEnabled(
        form.openaiAPIKeyResponsesWebSocketV2Mode
      )
    }

    if (form.enableUpstreamBillingAutoProbe) {
      updates.upstream_billing_probe_enabled = form.upstreamBillingAutoProbeMode === 'enabled'
    }

    if (form.enableCodexCLIOnly) {
      const extra = ensureExtra()
      extra.codex_cli_only = form.codexCLIOnlyEnabled
    }

    // 子开关从属于 codex_cli_only：仅当同一次批量编辑也把父开关设为开启时才写入，
    // 与 Create/Edit 语义对齐，避免在父开关关闭的账号上写入无意义的孤立字段。
    if (form.enableCodexCLIOnlyAppServer && form.enableCodexCLIOnly && form.codexCLIOnlyEnabled) {
      const extra = ensureExtra()
      extra.codex_cli_only_allow_app_server = form.codexCLIOnlyAppServerEnabled
    }

    if (form.enableCodexFingerprintMode) {
      const extra = ensureExtra()
      // off 必须显式落键，不能靠删本地键表达。批量更新走 JSONB 顶层合并
      // （extra = COALESCE(extra,'{}') || payload），删掉 payload 里的键只表示
      // "本次不更新该键"，清不掉账号上已有的 device/session/full；而且只删不写会让
      // 整个 payload 退化成 {extra:{}}，被后端 len(req.Extra) > 0 判为空更新直接 400
      // "No updates provided"（#6327）。
      //
      // Create/Edit 那两个表单可以删键，是因为它们提交完整 extra 对象、后端整体
      // SetExtra 覆盖；批量接口只合并增量键，两种持久化语义不能共用同一套写法。
      //
      // 显式 off 与不设置在读取侧完全等价：codexFingerprintModeFromExtra 对空值/
      // 非法值走 default 回落 off，对 "off" 命中同一分支，所以 #5610 定下的
      // "不显式 opt-in 就保持旧客户端身份" 不受影响；ShouldEnsureCodexFingerprintSeed-
      // ForExtraUpdates 同样只在 device/session/full 时要种子，off 不会触发。
      //
      // 与本函数里其它"关闭/清除"字段的写法一致：codex_cli_only 直接落 false，
      // load_factor 落 0，proxy_id 落 0 —— 批量路径一律用显式哨兵值，不用省略。
      extra.codex_fingerprint_mode = form.codexFingerprintMode
    }

    if (form.enableOpenAICompactMode) {
      const extra = ensureExtra()
      extra.openai_compact_mode = form.openAICompactMode
    }

    if (form.enableOpenAICompactModelMapping) {
      credentials.compact_model_mapping = buildOpenAICompactModelMapping() ?? {}
      credentialsChanged = true
    }

    // RPM limit settings (写入 extra 字段)
    if (form.enableRpmLimit) {
      const extra = ensureExtra()
      if (form.rpmLimitEnabled && form.bulkBaseRpm != null && form.bulkBaseRpm > 0) {
        extra.base_rpm = form.bulkBaseRpm
        extra.rpm_strategy = form.bulkRpmStrategy
        if (form.bulkRpmStickyBuffer != null && form.bulkRpmStickyBuffer > 0) {
          extra.rpm_sticky_buffer = form.bulkRpmStickyBuffer
        }
      } else {
        // 关闭 RPM 限制 - 设置 base_rpm 为 0，并用空值覆盖关联字段
        // 后端使用 JSONB || merge 语义，不会删除已有 key，
        // 所以必须显式发送空值来重置（后端读取时会 fallback 到默认值）
        extra.base_rpm = 0
        extra.rpm_strategy = ''
        extra.rpm_sticky_buffer = 0
      }
      updates.extra = extra
    }

    // UMQ mode（独立于 RPM 保存）
    if (form.userMsgQueueMode !== null) {
      const umqExtra = ensureExtra()
      umqExtra.user_msg_queue_mode = form.userMsgQueueMode // '' = 清除账号级覆盖
      umqExtra.user_msg_queue_enabled = false // 清理旧字段（JSONB merge）
    }

    if (credentialsChanged) {
      updates.credentials = credentials
    }

    return Object.keys(updates).length > 0 ? updates : null
  }

  // 是否需要预检查：改了分组 + 全是单一的 antigravity 或 anthropic 平台
  // 多平台混合的情况由 submitBulkUpdate 的 409 catch 兜底
  const canPreCheck = () =>
    form.enableGroups &&
    form.groupIds.length > 0 &&
    targetSelectedPlatforms.length === 1 &&
    (targetSelectedPlatforms[0] === 'antigravity' || targetSelectedPlatforms[0] === 'anthropic')

  const handleClose = () => {
    setShowMixedChannelWarning(false)
    setMixedChannelWarningMessage('')
    pendingUpdatesForConfirm.current = null
    mixedChannelConfirmed.current = false
    onClose()
  }

  // 预检查：提交前调接口检测，有风险就弹窗阻止，返回 false 表示需要用户确认
  const preCheckMixedChannelRisk = async (built: Record<string, unknown>): Promise<boolean> => {
    if (!canPreCheck()) return true
    if (mixedChannelConfirmed.current) return true

    try {
      const result = await adminAPI.accounts.checkMixedChannelRisk({
        platform: targetSelectedPlatforms[0],
        group_ids: form.groupIds
      })
      if (!result.has_risk) return true

      pendingUpdatesForConfirm.current = built
      setMixedChannelWarningMessage(result.message || t('admin.accounts.bulkEdit.failed'))
      setShowMixedChannelWarning(true)
      return false
    } catch (error: any) {
      useAppStore.getState().showError(error.message || t('admin.accounts.bulkEdit.failed'))
      return false
    }
  }

  const submitBulkUpdate = async (baseUpdates: Record<string, unknown>) => {
    const appStore = useAppStore.getState()
    // 无论是预检查确认还是 409 兜底确认，只要 mixedChannelConfirmed 为 true 就带上 flag
    const updates = mixedChannelConfirmed.current ? { ...baseUpdates, confirm_mixed_channel_risk: true } : baseUpdates

    setSubmitting(true)

    try {
      const res =
        targetMode === 'filtered' && target?.filters
          ? await adminAPI.accounts.bulkUpdate({
              filters: target.filters,
              ...updates
            })
          : await adminAPI.accounts.bulkUpdate(accountIds, updates)
      const success = res.success || 0
      const failed = res.failed || 0
      const inherited = res.long_context_inherited_count || 0

      if (success > 0 && failed === 0) {
        if (inherited > 0) {
          appStore.showSuccess(
            t('admin.accounts.bulkEdit.successWithInherited', {
              count: success,
              inherited
            })
          )
        } else {
          appStore.showSuccess(t('admin.accounts.bulkEdit.success', { count: success }))
        }
      } else if (success > 0) {
        const key =
          inherited > 0 ? 'admin.accounts.bulkEdit.partialSuccessWithInherited' : 'admin.accounts.bulkEdit.partialSuccess'
        appStore.showError(t(key, { success, failed, inherited }))
      } else {
        appStore.showError(t('admin.accounts.bulkEdit.failed'))
      }

      if (success > 0) {
        pendingUpdatesForConfirm.current = null
        onUpdated()
        handleClose()
      }
    } catch (error: any) {
      // 兜底：多平台混合场景下，预检查跳过，由后端 409 触发确认框
      if (error.status === 409 && error.error === 'mixed_channel_warning') {
        pendingUpdatesForConfirm.current = baseUpdates
        setMixedChannelWarningMessage(error.message)
        setShowMixedChannelWarning(true)
      } else if (error.reason === 'UPSTREAM_BILLING_RATE_SYNC_BULK_CONFLICT') {
        appStore.showError(
          t('admin.accounts.bulkEdit.rateSyncConflict', {
            count: error.metadata?.count ?? 1
          })
        )
      } else if (error.reason === 'OPENAI_LONG_CONTEXT_PARENT_REQUIRED') {
        appStore.showError(t('admin.accounts.bulkEdit.longContextParentRequired'))
      } else {
        appStore.showError(error.message || t('admin.accounts.bulkEdit.failed'))
        console.error('Error bulk updating accounts:', error)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    const appStore = useAppStore.getState()
    if (targetMode === 'selected' && accountIds.length === 0) {
      appStore.showError(t('admin.accounts.bulkEdit.noSelection'))
      return
    }

    const hasAnyFieldEnabled =
      form.enableBaseUrl ||
      form.enableOpenAIPassthrough ||
      form.enableOpenAIFlattenNamespaces ||
      (form.enableOpenAILongContextBilling && allOpenAIPassthroughCapable) ||
      (form.enableOpenAIEndpointCapabilities && allOpenAIAPIKey) ||
      (form.enableOpenAIResponsesMode && allOpenAIAPIKey) ||
      form.enableModelRestriction ||
      form.enableCustomErrorCodes ||
      form.enableInterceptWarmup ||
      form.enableHeaderOverride ||
      form.enableProxy ||
      form.enableConcurrency ||
      form.enableLoadFactor ||
      form.enableRateMultiplier ||
      form.enableStatus ||
      form.enableGroups ||
      form.enableOpenAIWSMode ||
      form.enableOpenAIAPIKeyWSMode ||
      form.enableUpstreamBillingAutoProbe ||
      form.enableCodexCLIOnly ||
      form.enableCodexCLIOnlyAppServer ||
      form.enableCodexFingerprintMode ||
      form.enableOpenAICompactMode ||
      form.enableOpenAICompactModelMapping ||
      form.enableRpmLimit ||
      form.userMsgQueueMode !== null

    if (!hasAnyFieldEnabled) {
      appStore.showError(t('admin.accounts.bulkEdit.noFieldsSelected'))
      return
    }

    // base_url 现在也会作用于 Grok OAuth 订阅账号的转发端点；坏值会让请求期
    // 校验失败、账号请求全挂，因此保存前强制格式校验（与单账号编辑一致）。
    if (form.enableBaseUrl) {
      const trimmedBaseUrl = form.baseUrl.trim()
      if (trimmedBaseUrl && !/^https?:\/\//i.test(trimmedBaseUrl)) {
        appStore.showError(t('admin.accounts.grokCustomBaseUrl.invalid'))
        return
      }
    }

    if (form.enableHeaderOverride && form.headerOverrideEnabled) {
      // 批量保存对 header_overrides 是整键替换：开启但没有任何有效行会把所选账号的
      // 既有覆写配置静默清空，必须显式拦截（清空请走关闭开关的路径，有专门提示）
      if (!form.headerOverrideRows.some((row) => row.name.trim())) {
        appStore.showError(t('admin.accounts.headerOverride.bulkEmptyRows'))
        return
      }
      const headerError = validateHeaderOverrideRows(form.headerOverrideRows)
      if (headerError) {
        appStore.showError(t(`admin.accounts.headerOverride.${headerError}`))
        return
      }
    }

    const built = buildUpdatePayload()
    if (!built) {
      appStore.showError(t('admin.accounts.bulkEdit.noFieldsSelected'))
      return
    }

    const canContinue = await preCheckMixedChannelRisk(built)
    if (!canContinue) return

    await submitBulkUpdate(built)
  }

  const handleMixedChannelConfirm = async () => {
    setShowMixedChannelWarning(false)
    mixedChannelConfirmed.current = true
    if (pendingUpdatesForConfirm.current) {
      await submitBulkUpdate(pendingUpdatesForConfirm.current)
    }
  }

  const handleMixedChannelCancel = () => {
    setShowMixedChannelWarning(false)
    pendingUpdatesForConfirm.current = null
  }

  // Reset form when modal closes
  useEffect(() => {
    if (show) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(show)：关闭时重置全部字段
    setForm(createInitialState())
    // Reset mixed channel warning state
    setShowMixedChannelWarning(false)
    setMixedChannelWarningMessage('')
    pendingUpdatesForConfirm.current = null
    mixedChannelConfirmed.current = false
  }, [show])

  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleSubmit()
  }

  return (
    <>
      <AccountFormDrawer
        show={show}
        title={t('admin.accounts.bulkEdit.title')}
        width="wide"
        onClose={handleClose}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="bulk-edit-account-form" variant="primary" disabled={submitting} loading={submitting}>
              {submitting ? t('admin.accounts.bulkEdit.updating') : t('admin.accounts.bulkEdit.submit')}
            </Button>
          </>
        }
      >
        <form id="bulk-edit-account-form" className={styles.form} onSubmit={onFormSubmit} noValidate>
          {/* Info */}
          <FormNotice tone="info">
            <p className={styles.noticeLine}>
              <Info size={16} aria-hidden="true" className={styles.noticeIcon} />
              {t('admin.accounts.bulkEdit.selectionInfo', {
                count: targetMode === 'filtered' ? targetPreviewCount : accountIds.length
              })}
            </p>
          </FormNotice>

          {/* Mixed platform warning */}
          {isMixedPlatform ? (
            <FormNotice tone="warning">
              <p className={styles.noticeLine}>
                <TriangleAlert size={16} aria-hidden="true" className={styles.noticeIcon} />
                {t('admin.accounts.bulkEdit.mixedPlatformWarning', { platforms: targetSelectedPlatforms.join(', ') })}
              </p>
            </FormNotice>
          ) : null}

          {/* OpenAI passthrough */}
          {allOpenAIPassthroughCapable ? (
            <BulkField
              id="bulk-edit-openai-passthrough"
              label={t('admin.accounts.openai.oauthPassthrough')}
              ariaLabel={t('admin.accounts.openai.oauthPassthrough')}
              description={t('admin.accounts.openai.oauthPassthroughDesc')}
              enabled={form.enableOpenAIPassthrough}
              onEnabledChange={(v) => update({ enableOpenAIPassthrough: v })}
              controls="bulk-edit-openai-passthrough-body"
            >
              <FieldBody
                id="bulk-edit-openai-passthrough-body"
                enabled={form.enableOpenAIPassthrough}
                group
                labelledBy="bulk-edit-openai-passthrough-label"
              >
                <Switch
                  id="bulk-edit-openai-passthrough-toggle"
                  checked={form.openaiPassthroughEnabled}
                  onCheckedChange={(v) => update({ openaiPassthroughEnabled: v })}
                  aria-label={t('admin.accounts.openai.oauthPassthrough')}
                />
              </FieldBody>
            </BulkField>
          ) : null}

          {/* OpenAI Codex namespace 工具摊平（兼容开关，仅 OAuth） */}
          {allOpenAIOAuthOnly ? (
            <BulkField
              id="bulk-edit-openai-flatten-namespaces"
              label={t('admin.accounts.openai.flattenNamespaces')}
              ariaLabel={t('admin.accounts.openai.flattenNamespaces')}
              description={t('admin.accounts.openai.flattenNamespacesDesc')}
              enabled={form.enableOpenAIFlattenNamespaces}
              onEnabledChange={(v) => update({ enableOpenAIFlattenNamespaces: v })}
              controls="bulk-edit-openai-flatten-namespaces-body"
            >
              <FieldBody
                id="bulk-edit-openai-flatten-namespaces-body"
                enabled={form.enableOpenAIFlattenNamespaces}
                group
                labelledBy="bulk-edit-openai-flatten-namespaces-label"
              >
                <Switch
                  id="bulk-edit-openai-flatten-namespaces-toggle"
                  checked={form.openaiFlattenNamespacesEnabled}
                  onCheckedChange={(v) => update({ openaiFlattenNamespacesEnabled: v })}
                  aria-label={t('admin.accounts.openai.flattenNamespaces')}
                />
              </FieldBody>
            </BulkField>
          ) : null}

          {/* OpenAI API long-context billing */}
          {allOpenAIPassthroughCapable ? (
            <BulkField
              id="bulk-edit-openai-long-context-billing"
              label={t('admin.accounts.openai.longContextBilling')}
              ariaLabel={t('admin.accounts.openai.longContextBilling')}
              description={t('admin.accounts.openai.longContextBillingDesc')}
              enabled={form.enableOpenAILongContextBilling}
              onEnabledChange={(v) => update({ enableOpenAILongContextBilling: v })}
              controls="bulk-edit-openai-long-context-billing-body"
            >
              <FieldBody
                id="bulk-edit-openai-long-context-billing-body"
                enabled={form.enableOpenAILongContextBilling}
                group
                labelledBy="bulk-edit-openai-long-context-billing-label"
              >
                <Switch
                  data-testid="bulk-edit-openai-long-context-billing-toggle"
                  disabled={!form.enableOpenAILongContextBilling}
                  checked={form.openAILongContextBillingEnabled}
                  onCheckedChange={(v) => update({ openAILongContextBillingEnabled: v })}
                  aria-label={t('admin.accounts.openai.longContextBilling')}
                />
              </FieldBody>
              <FormNotice tone="warning">
                <p className={styles.noticeLine} data-testid="bulk-edit-openai-long-context-shadow-hint">
                  {t('admin.accounts.bulkEdit.longContextShadowHint')}
                </p>
              </FormNotice>
            </BulkField>
          ) : null}

          {/* Base URL (API Key only) */}
          <BulkField
            id="bulk-edit-base-url"
            label={t('admin.accounts.baseUrl')}
            ariaLabel={t('admin.accounts.baseUrl')}
            enabled={form.enableBaseUrl}
            onEnabledChange={(v) => update({ enableBaseUrl: v })}
            controls="bulk-edit-base-url"
          >
            <div className={formStyles.stackTight}>
              <Input
                id="bulk-edit-base-url"
                value={form.baseUrl}
                onChange={(v) => update({ baseUrl: v })}
                disabled={!form.enableBaseUrl}
                placeholder={t('admin.accounts.bulkEdit.baseUrlPlaceholder')}
                aria-labelledby="bulk-edit-base-url-label"
              />
              {allTargetsGrok ? (
                <GrokBaseUrlPresets onSelect={(url) => update({ baseUrl: url, enableBaseUrl: true })} />
              ) : null}
              <p className={formStyles.hint}>{t('admin.accounts.bulkEdit.baseUrlNotice')}</p>
            </div>
          </BulkField>

          {/* Model restriction */}
          <BulkField
            id="bulk-edit-model-restriction"
            label={t('admin.accounts.modelRestriction')}
            ariaLabel={t('admin.accounts.modelRestriction')}
            enabled={form.enableModelRestriction}
            onEnabledChange={(v) => update({ enableModelRestriction: v })}
            controls="bulk-edit-model-restriction-body"
          >
            <FieldBody
              id="bulk-edit-model-restriction-body"
              enabled={form.enableModelRestriction}
              group
              labelledBy="bulk-edit-model-restriction-label"
            >
              {isOpenAIModelRestrictionDisabled ? (
                <FormNotice tone="warning">
                  <p>{t('admin.accounts.openai.modelRestrictionDisabledByPassthrough')}</p>
                </FormNotice>
              ) : (
                <div className={formStyles.stack}>
                  {/* Mode Toggle */}
                  <div className={styles.modeToggle}>
                    <button
                      type="button"
                      className={formStyles.choice}
                      aria-pressed={form.modelRestrictionMode === 'whitelist'}
                      onClick={() => update({ modelRestrictionMode: 'whitelist' })}
                    >
                      <CircleCheck size={16} aria-hidden="true" />
                      {t('admin.accounts.modelWhitelist')}
                    </button>
                    <button
                      type="button"
                      className={formStyles.choice}
                      aria-pressed={form.modelRestrictionMode === 'mapping'}
                      onClick={() => update({ modelRestrictionMode: 'mapping' })}
                    >
                      <ArrowRight size={16} aria-hidden="true" />
                      {t('admin.accounts.modelMapping')}
                    </button>
                  </div>

                  {form.modelRestrictionMode === 'whitelist' ? (
                    /* Whitelist Mode */
                    <div className={formStyles.stack}>
                      <FormNotice tone="info">
                        <p>{t('admin.accounts.selectAllowedModels')}</p>
                      </FormNotice>

                      <ModelWhitelistSelector
                        value={form.allowedModels}
                        onChange={(value) => update({ allowedModels: value })}
                        modelMappings={form.modelMappings}
                        platforms={targetSelectedPlatforms}
                      />

                      <p className={formStyles.hint}>
                        {t('admin.accounts.selectedModels', { count: form.allowedModels.length })}
                        {form.allowedModels.length === 0 ? <span>{t('admin.accounts.supportsAllModels')}</span> : null}
                      </p>
                    </div>
                  ) : (
                    /* Mapping Mode */
                    <div className={formStyles.stack}>
                      <FormNotice tone="info">
                        <p>{t('admin.accounts.mapRequestModels')}</p>
                      </FormNotice>

                      {/* Model Mapping List */}
                      {form.modelMappings.length > 0 ? (
                        <div className={formStyles.editRows}>
                          {form.modelMappings.map((mapping, index) => (
                            <div key={index} className={formStyles.editRow}>
                              <Input
                                value={mapping.from}
                                onChange={(v) => updateModelMapping(index, { from: v })}
                                placeholder={t('admin.accounts.requestModel')}
                                aria-label={t('admin.accounts.requestModel')}
                              />
                              <ArrowRight size={16} aria-hidden="true" className={styles.arrow} />
                              <Input
                                value={mapping.to}
                                onChange={(v) => updateModelMapping(index, { to: v })}
                                placeholder={t('admin.accounts.actualModel')}
                                aria-label={t('admin.accounts.actualModel')}
                              />
                              <button
                                type="button"
                                className={formStyles.iconButton}
                                data-tone="danger"
                                aria-label={t('common.delete')}
                                onClick={() => removeModelMapping(index)}
                              >
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <button type="button" className={styles.addButton} onClick={addModelMapping}>
                        <Plus size={16} aria-hidden="true" />
                        {t('admin.accounts.addMapping')}
                      </button>

                      {/* Quick Add Buttons */}
                      <div className={formStyles.chips}>
                        {filteredPresets.map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            className={styles.presetButton}
                            onClick={() => addPresetMapping(preset.from, preset.to)}
                          >
                            + {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </FieldBody>
          </BulkField>

          {/* Custom error codes */}
          <BulkField
            id="bulk-edit-custom-error-codes"
            label={t('admin.accounts.customErrorCodes')}
            ariaLabel={t('admin.accounts.customErrorCodes')}
            description={t('admin.accounts.customErrorCodesHint')}
            enabled={form.enableCustomErrorCodes}
            onEnabledChange={(v) => update({ enableCustomErrorCodes: v })}
            controls="bulk-edit-custom-error-codes-body"
          >
            {form.enableCustomErrorCodes ? (
              <div id="bulk-edit-custom-error-codes-body" className={formStyles.stack}>
                <FormNotice tone="warning">
                  <p className={styles.noticeLine}>
                    <TriangleAlert size={16} aria-hidden="true" className={styles.noticeIcon} />
                    {t('admin.accounts.customErrorCodesWarning')}
                  </p>
                </FormNotice>

                {/* Error Code Buttons */}
                <div className={formStyles.choiceGroup}>
                  {commonErrorCodes.map((code) => (
                    <button
                      key={code.value}
                      type="button"
                      className={formStyles.choice}
                      aria-pressed={form.selectedErrorCodes.includes(code.value)}
                      onClick={() => void toggleErrorCode(code.value)}
                    >
                      {code.value} {code.label}
                    </button>
                  ))}
                </div>

                {/* Manual input */}
                <div className={formStyles.editRow}>
                  <Input
                    id="bulk-edit-custom-error-code-input"
                    type="number"
                    min={100}
                    max={599}
                    value={form.customErrorCodeInput}
                    onChange={(v) => update({ customErrorCodeInput: toNullableNumber(v) })}
                    onEnter={() => void addCustomErrorCode()}
                    placeholder={t('admin.accounts.enterErrorCode')}
                    aria-labelledby="bulk-edit-custom-error-codes-label"
                  />
                  <button
                    type="button"
                    className={formStyles.iconButton}
                    aria-label={t('admin.accounts.enterErrorCode')}
                    onClick={() => void addCustomErrorCode()}
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </div>

                {/* Selected codes summary */}
                <div className={formStyles.chips}>
                  {form.selectedErrorCodes.map((code) => (
                    <span key={code} className={formStyles.chip}>
                      {code}
                      <button
                        type="button"
                        className={formStyles.chipRemove}
                        aria-label={`${t('common.delete')} ${code}`}
                        onClick={() => removeErrorCode(code)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  {form.selectedErrorCodes.length === 0 ? (
                    <span className={formStyles.hint}>{t('admin.accounts.noneSelectedUsesDefault')}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </BulkField>

          {/* Intercept warmup requests (Anthropic only) */}
          <BulkField
            id="bulk-edit-intercept-warmup"
            label={t('admin.accounts.interceptWarmupRequests')}
            ariaLabel={t('admin.accounts.interceptWarmupRequests')}
            description={t('admin.accounts.interceptWarmupRequestsDesc')}
            enabled={form.enableInterceptWarmup}
            onEnabledChange={(v) => update({ enableInterceptWarmup: v })}
            controls="bulk-edit-intercept-warmup-body"
          >
            {form.enableInterceptWarmup ? (
              <div id="bulk-edit-intercept-warmup-body">
                <Switch
                  checked={form.interceptWarmupRequests}
                  onCheckedChange={(v) => update({ interceptWarmupRequests: v })}
                  aria-label={t('admin.accounts.interceptWarmupRequests')}
                />
              </div>
            ) : null}
          </BulkField>

          {/* Header Override (eligible API-key platforms + grok OAuth) */}
          {allHeaderOverrideCapable ? (
            <BulkField
              id="bulk-edit-header-override"
              label={t('admin.accounts.headerOverride.title')}
              ariaLabel={t('admin.accounts.headerOverride.title')}
              description={t('admin.accounts.headerOverride.hint')}
              enabled={form.enableHeaderOverride}
              onEnabledChange={(v) => update({ enableHeaderOverride: v })}
              controls="bulk-edit-header-override-body"
            >
              {form.enableHeaderOverride ? (
                <div id="bulk-edit-header-override-body" className={formStyles.stack}>
                  <Switch
                    checked={form.headerOverrideEnabled}
                    onCheckedChange={(v) => update({ headerOverrideEnabled: v })}
                    aria-label={t('admin.accounts.headerOverride.title')}
                  />

                  {form.headerOverrideEnabled ? (
                    <div className={formStyles.stack}>
                      <FormNotice tone="info">
                        <p className={styles.noticeLine}>
                          <Info size={16} aria-hidden="true" className={styles.noticeIcon} />
                          {t('admin.accounts.headerOverride.info')}
                        </p>
                      </FormNotice>

                      <p className={styles.warningText}>{t('admin.accounts.headerOverride.bulkReplaceHint')}</p>

                      <HeaderOverrideEditor
                        rows={form.headerOverrideRows}
                        onChange={(rows) => update({ headerOverrideRows: rows })}
                      />
                    </div>
                  ) : (
                    <p className={formStyles.hint}>{t('admin.accounts.headerOverride.bulkDisableHint')}</p>
                  )}
                </div>
              ) : null}
            </BulkField>
          ) : null}

          {/* Proxy */}
          <BulkField
            id="bulk-edit-proxy"
            label={t('admin.accounts.proxy')}
            ariaLabel={t('admin.accounts.proxy')}
            enabled={form.enableProxy}
            onEnabledChange={(v) => update({ enableProxy: v })}
            controls="bulk-edit-proxy-body"
          >
            <FieldBody id="bulk-edit-proxy-body" enabled={form.enableProxy}>
              <ProxySelector value={form.proxyId} onChange={(v) => update({ proxyId: v })} proxies={proxies} />
            </FieldBody>
          </BulkField>

          {/* Concurrency & Priority */}
          <section className={formStyles.section}>
            <div className={styles.numberGrid}>
              <BulkField
                id="bulk-edit-concurrency"
                className={styles.inlineField}
                label={t('admin.accounts.concurrency')}
                ariaLabel={t('admin.accounts.concurrency')}
                enabled={form.enableConcurrency}
                onEnabledChange={(v) => update({ enableConcurrency: v })}
                controls="bulk-edit-concurrency"
              >
                <Input
                  id="bulk-edit-concurrency"
                  type="number"
                  min={1}
                  value={form.concurrency}
                  disabled={!form.enableConcurrency}
                  aria-labelledby="bulk-edit-concurrency-label"
                  onChange={(v) => {
                    const parsed = toNumberModel(v)
                    update({ concurrency: Math.max(1, (parsed === '' ? 0 : parsed) || 1) })
                  }}
                />
              </BulkField>
              <BulkField
                id="bulk-edit-load-factor"
                className={styles.inlineField}
                label={t('admin.accounts.loadFactor')}
                ariaLabel={t('admin.accounts.loadFactor')}
                enabled={form.enableLoadFactor}
                onEnabledChange={(v) => update({ enableLoadFactor: v })}
                controls="bulk-edit-load-factor"
              >
                <Input
                  id="bulk-edit-load-factor"
                  type="number"
                  min={1}
                  value={form.loadFactor}
                  disabled={!form.enableLoadFactor}
                  aria-labelledby="bulk-edit-load-factor-label"
                  hint={t('admin.accounts.loadFactorHint')}
                  onChange={(v) => {
                    const parsed = toNullableNumber(v)
                    update({ loadFactor: parsed && parsed >= 1 ? parsed : null })
                  }}
                />
              </BulkField>
              <BulkField
                id="bulk-edit-rate-multiplier"
                className={styles.inlineField}
                label={t('admin.accounts.billingRateMultiplier')}
                ariaLabel={t('admin.accounts.billingRateMultiplier')}
                enabled={form.enableRateMultiplier}
                onEnabledChange={(v) => update({ enableRateMultiplier: v })}
                controls="bulk-edit-rate-multiplier"
              >
                <Input
                  id="bulk-edit-rate-multiplier"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.rateMultiplier}
                  disabled={!form.enableRateMultiplier}
                  aria-labelledby="bulk-edit-rate-multiplier-label"
                  hint={t('admin.accounts.billingRateMultiplierHint')}
                  onChange={(v) => update({ rateMultiplier: toNumberModel(v) })}
                />
                {form.enableRateMultiplier ? (
                  <p className={styles.warningLine} data-testid="bulk-rate-sync-warning">
                    <TriangleAlert size={14} aria-hidden="true" className={styles.noticeIcon} />
                    <span>{t('admin.accounts.bulkEdit.rateSyncWarning')}</span>
                  </p>
                ) : null}
              </BulkField>
            </div>
          </section>

          {/* Status */}
          <BulkField
            id="bulk-edit-status"
            label={t('common.status')}
            ariaLabel={t('common.status')}
            enabled={form.enableStatus}
            onEnabledChange={(v) => update({ enableStatus: v })}
            controls="bulk-edit-status"
          >
            <FieldBody id="bulk-edit-status" enabled={form.enableStatus}>
              <Select
                value={form.status}
                onChange={(v) => update({ status: v as 'active' | 'inactive' })}
                options={statusOptions}
                aria-label={t('common.status')}
              />
            </FieldBody>
          </BulkField>

          {/* OpenAI OAuth WS mode */}
          {allOpenAIOAuth ? (
            <BulkField
              id="bulk-edit-openai-ws-mode"
              label={t('admin.accounts.openai.wsMode')}
              ariaLabel={t('admin.accounts.openai.wsMode')}
              enabled={form.enableOpenAIWSMode}
              onEnabledChange={(v) => update({ enableOpenAIWSMode: v })}
              controls="bulk-edit-openai-ws-mode"
            >
              <FieldBody id="bulk-edit-openai-ws-mode" enabled={form.enableOpenAIWSMode}>
                <p className={formStyles.hint}>{t('admin.accounts.openai.wsModeDesc')}</p>
                {openAIWSModeHintKey ? <p className={formStyles.hint}>{t(openAIWSModeHintKey)}</p> : null}
                <Select
                  value={form.openaiOAuthResponsesWebSocketV2Mode}
                  data-testid="bulk-edit-openai-ws-mode-select"
                  onChange={(v) => update({ openaiOAuthResponsesWebSocketV2Mode: v as OpenAIWSMode })}
                  options={openAIWSModeOptions}
                  aria-label={t('admin.accounts.openai.wsMode')}
                />
              </FieldBody>
            </BulkField>
          ) : null}

          {/* OpenAI OAuth Codex CLI only */}
          {allOpenAIOAuth ? (
            <BulkField
              id="bulk-edit-openai-codex-cli-only"
              label={t('admin.accounts.openai.codexCLIOnly')}
              ariaLabel={t('admin.accounts.openai.codexCLIOnly')}
              enabled={form.enableCodexCLIOnly}
              onEnabledChange={(v) => update({ enableCodexCLIOnly: v })}
              controls="bulk-edit-openai-codex-cli-only"
            >
              <FieldBody id="bulk-edit-openai-codex-cli-only" enabled={form.enableCodexCLIOnly}>
                <p className={formStyles.hint}>{t('admin.accounts.openai.codexCLIOnlyDesc')}</p>
                <Switch
                  id="bulk-edit-openai-codex-cli-only-toggle"
                  checked={form.codexCLIOnlyEnabled}
                  onCheckedChange={(v) => update({ codexCLIOnlyEnabled: v })}
                  aria-label={t('admin.accounts.openai.codexCLIOnly')}
                />
              </FieldBody>
            </BulkField>
          ) : null}

          {/* OpenAI OAuth: Codex app-server */}
          {allOpenAIOAuth ? (
            <BulkField
              id="bulk-edit-openai-codex-app-server"
              label={t('admin.accounts.openai.codexCLIOnlyAppServer')}
              ariaLabel={t('admin.accounts.openai.codexCLIOnlyAppServer')}
              enabled={form.enableCodexCLIOnlyAppServer}
              onEnabledChange={(v) => update({ enableCodexCLIOnlyAppServer: v })}
              controls="bulk-edit-openai-codex-app-server"
            >
              <FieldBody id="bulk-edit-openai-codex-app-server" enabled={form.enableCodexCLIOnlyAppServer}>
                <p className={formStyles.hint}>{t('admin.accounts.openai.codexCLIOnlyAppServerDesc')}</p>
                <Switch
                  id="bulk-edit-openai-codex-app-server-toggle"
                  checked={form.codexCLIOnlyAppServerEnabled}
                  onCheckedChange={(v) => update({ codexCLIOnlyAppServerEnabled: v })}
                  aria-label={t('admin.accounts.openai.codexCLIOnlyAppServer')}
                />
              </FieldBody>
            </BulkField>
          ) : null}

          {/* Codex 指纹收敛模式（仅 OpenAI OAuth） */}
          {allOpenAIOAuth ? (
            <BulkField
              id="bulk-edit-openai-codex-fingerprint-mode"
              label={t('admin.accounts.openai.codexFingerprintMode')}
              ariaLabel={t('admin.accounts.openai.codexFingerprintMode')}
              enabled={form.enableCodexFingerprintMode}
              onEnabledChange={(v) => update({ enableCodexFingerprintMode: v })}
            >
              <FieldBody enabled={form.enableCodexFingerprintMode}>
                <p className={formStyles.hint}>{t('admin.accounts.openai.codexFingerprintModeDesc')}</p>
                <Select
                  value={form.codexFingerprintMode}
                  data-testid="bulk-codex-fingerprint-mode-select"
                  onChange={(v) => update({ codexFingerprintMode: v as CodexFingerprintMode })}
                  options={codexFingerprintModeOptions}
                  aria-label={t('admin.accounts.openai.codexFingerprintMode')}
                />
              </FieldBody>
            </BulkField>
          ) : null}

          {/* Upstream billing auto probe (any API-key platform) */}
          {allBillingProbeCapable ? (
            <BulkField
              id="bulk-edit-upstream-billing-auto-probe"
              label={t('admin.accounts.upstreamBilling.autoProbe')}
              ariaLabel={t('admin.accounts.upstreamBilling.autoProbe')}
              description={t('admin.accounts.upstreamBilling.autoProbeHint')}
              enabled={form.enableUpstreamBillingAutoProbe}
              onEnabledChange={(v) => update({ enableUpstreamBillingAutoProbe: v })}
              controls="bulk-edit-upstream-billing-auto-probe"
            >
              <FieldBody
                id="bulk-edit-upstream-billing-auto-probe"
                enabled={form.enableUpstreamBillingAutoProbe}
                group
                labelledBy="bulk-edit-upstream-billing-auto-probe-label"
              >
                <Select
                  value={form.upstreamBillingAutoProbeMode}
                  disabled={!form.enableUpstreamBillingAutoProbe}
                  data-testid="bulk-edit-upstream-billing-auto-probe-select"
                  onChange={(v) => update({ upstreamBillingAutoProbeMode: v as 'enabled' | 'disabled' })}
                  options={upstreamBillingAutoProbeOptions}
                  aria-label={t('admin.accounts.upstreamBilling.autoProbe')}
                />
              </FieldBody>
            </BulkField>
          ) : null}

          {/* OpenAI API Key endpoint capabilities */}
          {allOpenAIAPIKey ? (
            <BulkField
              id="bulk-edit-openai-endpoint-capabilities"
              label={t('admin.accounts.openai.endpointCapabilities')}
              ariaLabel={t('admin.accounts.openai.endpointCapabilities')}
              description={t('admin.accounts.openai.endpointCapabilitiesDesc')}
              enabled={form.enableOpenAIEndpointCapabilities}
              onEnabledChange={(v) => update({ enableOpenAIEndpointCapabilities: v })}
              controls="bulk-edit-openai-endpoint-capabilities-body"
            >
              <FieldBody
                id="bulk-edit-openai-endpoint-capabilities-body"
                enabled={form.enableOpenAIEndpointCapabilities}
                group
                labelledBy="bulk-edit-openai-endpoint-capabilities-label"
              >
                <div className={styles.capabilityGrid}>
                  {openAIEndpointCapabilityOptions.map((option) => (
                    <div key={option.value} className={styles.capabilityOption}>
                      <Checkbox
                        label={option.label}
                        disabled={!form.enableOpenAIEndpointCapabilities}
                        data-testid={`bulk-edit-openai-endpoint-capability-${option.value}`}
                        checked={form.openAIEndpointCapabilities.includes(option.value)}
                        onCheckedChange={() => toggleOpenAIEndpointCapability(option.value)}
                      />
                    </div>
                  ))}
                </div>
              </FieldBody>
            </BulkField>
          ) : null}

          {/* OpenAI API Key Responses route */}
          {allOpenAIAPIKey ? (
            <BulkField
              id="bulk-edit-openai-responses-mode"
              label={t('admin.accounts.openai.responsesMode')}
              ariaLabel={t('admin.accounts.openai.responsesMode')}
              description={t('admin.accounts.openai.responsesModeDesc')}
              enabled={form.enableOpenAIResponsesMode}
              onEnabledChange={(v) => update({ enableOpenAIResponsesMode: v })}
              controls="bulk-edit-openai-responses-mode-body"
            >
              <FieldBody
                id="bulk-edit-openai-responses-mode-body"
                enabled={form.enableOpenAIResponsesMode}
                group
                labelledBy="bulk-edit-openai-responses-mode-label"
              >
                <Select
                  value={form.openAIResponsesMode}
                  disabled={!form.enableOpenAIResponsesMode || !openAIResponsesModeApplicable}
                  data-testid="bulk-edit-openai-responses-mode-select"
                  onChange={(v) => update({ openAIResponsesMode: v as OpenAIResponsesMode })}
                  options={openAIResponsesModeOptions}
                  aria-label={t('admin.accounts.openai.responsesMode')}
                />
                {form.enableOpenAIEndpointCapabilities && !openAITextGenerationCapabilityEnabled ? (
                  <FormNotice tone="warning">
                    <p data-testid="bulk-edit-openai-responses-mode-not-applicable">
                      {t('admin.accounts.openai.responsesModeTextDisabledHint')}
                    </p>
                  </FormNotice>
                ) : null}
              </FieldBody>
            </BulkField>
          ) : null}

          {/* OpenAI API Key WS mode */}
          {allOpenAIAPIKey ? (
            <BulkField
              id="bulk-edit-openai-apikey-ws-mode"
              label={t('admin.accounts.openai.wsMode')}
              ariaLabel={t('admin.accounts.openai.wsMode')}
              enabled={form.enableOpenAIAPIKeyWSMode}
              onEnabledChange={(v) => update({ enableOpenAIAPIKeyWSMode: v })}
              controls="bulk-edit-openai-apikey-ws-mode"
            >
              <FieldBody id="bulk-edit-openai-apikey-ws-mode" enabled={form.enableOpenAIAPIKeyWSMode}>
                <p className={formStyles.hint}>{t('admin.accounts.openai.wsModeDesc')}</p>
                {openAIAPIKeyWSModeHintKey ? <p className={formStyles.hint}>{t(openAIAPIKeyWSModeHintKey)}</p> : null}
                <Select
                  value={form.openaiAPIKeyResponsesWebSocketV2Mode}
                  data-testid="bulk-edit-openai-apikey-ws-mode-select"
                  onChange={(v) => update({ openaiAPIKeyResponsesWebSocketV2Mode: v as OpenAIWSMode })}
                  options={openAIWSModeOptions}
                  aria-label={t('admin.accounts.openai.wsMode')}
                />
              </FieldBody>
            </BulkField>
          ) : null}

          {/* OpenAI Compact mode */}
          {allOpenAIPassthroughCapable ? (
            <BulkField
              id="bulk-edit-openai-compact-mode"
              label={t('admin.accounts.openai.compactMode')}
              ariaLabel={t('admin.accounts.openai.compactMode')}
              description={t('admin.accounts.openai.compactModeDesc')}
              enabled={form.enableOpenAICompactMode}
              onEnabledChange={(v) => update({ enableOpenAICompactMode: v })}
              controls="bulk-edit-openai-compact-mode"
            >
              <FieldBody id="bulk-edit-openai-compact-mode" enabled={form.enableOpenAICompactMode}>
                <Select
                  value={form.openAICompactMode}
                  data-testid="bulk-edit-openai-compact-mode-select"
                  onChange={(v) => update({ openAICompactMode: v as OpenAICompactMode })}
                  options={openAICompactModeOptions}
                  aria-label={t('admin.accounts.openai.compactMode')}
                />
              </FieldBody>
            </BulkField>
          ) : null}

          {/* OpenAI Compact model mapping */}
          {allOpenAIPassthroughCapable ? (
            <BulkField
              id="bulk-edit-openai-compact-model-mapping"
              label={t('admin.accounts.openai.compactModelMapping')}
              ariaLabel={t('admin.accounts.openai.compactModelMapping')}
              description={t('admin.accounts.openai.compactModelMappingDesc')}
              enabled={form.enableOpenAICompactModelMapping}
              onEnabledChange={(v) => update({ enableOpenAICompactModelMapping: v })}
              controls="bulk-edit-openai-compact-model-mapping"
            >
              <FieldBody id="bulk-edit-openai-compact-model-mapping" enabled={form.enableOpenAICompactModelMapping}>
                {form.openAICompactModelMappings.length > 0 ? (
                  <div className={formStyles.editRows}>
                    {form.openAICompactModelMappings.map((mapping, index) => (
                      <div key={index} className={formStyles.editRow}>
                        <Input
                          value={mapping.from}
                          onChange={(v) => updateOpenAICompactModelMapping(index, { from: v })}
                          placeholder={t('admin.accounts.fromModel')}
                          aria-label={t('admin.accounts.fromModel')}
                          data-testid="bulk-edit-openai-compact-model-mapping-input"
                        />
                        <span className={styles.arrow}>→</span>
                        <Input
                          value={mapping.to}
                          onChange={(v) => updateOpenAICompactModelMapping(index, { to: v })}
                          placeholder={t('admin.accounts.toModel')}
                          aria-label={t('admin.accounts.toModel')}
                          data-testid="bulk-edit-openai-compact-model-mapping-input"
                        />
                        <button
                          type="button"
                          className={formStyles.iconButton}
                          data-tone="danger"
                          aria-label={t('common.delete')}
                          onClick={() => removeOpenAICompactModelMapping(index)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={styles.addButton}
                  data-testid="bulk-edit-openai-compact-model-mapping-add"
                  onClick={addOpenAICompactModelMapping}
                >
                  + {t('admin.accounts.addMapping')}
                </button>
              </FieldBody>
            </BulkField>
          ) : null}

          {/* RPM Limit (仅全部为 Anthropic OAuth/SetupToken 时显示) */}
          {allAnthropicOAuthOrSetupToken ? (
            <BulkField
              id="bulk-edit-rpm-limit"
              label={t('admin.accounts.quotaControl.rpmLimit.label')}
              ariaLabel={t('admin.accounts.quotaControl.rpmLimit.label')}
              enabled={form.enableRpmLimit}
              onEnabledChange={(v) => update({ enableRpmLimit: v })}
              controls="bulk-edit-rpm-limit-body"
            >
              <FieldBody
                id="bulk-edit-rpm-limit-body"
                enabled={form.enableRpmLimit}
                group
                labelledBy="bulk-edit-rpm-limit-label"
              >
                <div className={styles.switchRow}>
                  <span className={styles.switchLabel}>{t('admin.accounts.quotaControl.rpmLimit.hint')}</span>
                  <Switch
                    checked={form.rpmLimitEnabled}
                    onCheckedChange={(v) => update({ rpmLimitEnabled: v })}
                    aria-label={t('admin.accounts.quotaControl.rpmLimit.hint')}
                  />
                </div>

                {form.rpmLimitEnabled ? (
                  <div className={formStyles.stack}>
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      step="1"
                      label={t('admin.accounts.quotaControl.rpmLimit.baseRpm')}
                      value={form.bulkBaseRpm}
                      onChange={(v) => update({ bulkBaseRpm: toNullableNumber(v) })}
                      placeholder={t('admin.accounts.quotaControl.rpmLimit.baseRpmPlaceholder')}
                      hint={t('admin.accounts.quotaControl.rpmLimit.baseRpmHint')}
                    />

                    <div className={formStyles.field}>
                      <span className={formStyles.label}>{t('admin.accounts.quotaControl.rpmLimit.strategy')}</span>
                      <div className={styles.modeToggle}>
                        <button
                          type="button"
                          className={formStyles.choice}
                          aria-pressed={form.bulkRpmStrategy === 'tiered'}
                          onClick={() => update({ bulkRpmStrategy: 'tiered' })}
                        >
                          {t('admin.accounts.quotaControl.rpmLimit.strategyTiered')}
                        </button>
                        <button
                          type="button"
                          className={formStyles.choice}
                          aria-pressed={form.bulkRpmStrategy === 'sticky_exempt'}
                          onClick={() => update({ bulkRpmStrategy: 'sticky_exempt' })}
                        >
                          {t('admin.accounts.quotaControl.rpmLimit.strategyStickyExempt')}
                        </button>
                      </div>
                    </div>

                    {form.bulkRpmStrategy === 'tiered' ? (
                      <Input
                        type="number"
                        min={1}
                        step="1"
                        label={t('admin.accounts.quotaControl.rpmLimit.stickyBuffer')}
                        value={form.bulkRpmStickyBuffer}
                        onChange={(v) => update({ bulkRpmStickyBuffer: toNullableNumber(v) })}
                        placeholder={t('admin.accounts.quotaControl.rpmLimit.stickyBufferPlaceholder')}
                        hint={t('admin.accounts.quotaControl.rpmLimit.stickyBufferHint')}
                      />
                    ) : null}
                  </div>
                ) : null}
              </FieldBody>

              {/* 用户消息限速模式（独立于 RPM 开关，始终可见） */}
              <div className={formStyles.field}>
                <span className={formStyles.label}>{t('admin.accounts.quotaControl.rpmLimit.userMsgQueue')}</span>
                <p className={formStyles.hint}>{t('admin.accounts.quotaControl.rpmLimit.userMsgQueueHint')}</p>
                <div className={formStyles.choiceGroup}>
                  {umqModeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={formStyles.choice}
                      aria-pressed={form.userMsgQueueMode === opt.value}
                      onClick={() =>
                        update({ userMsgQueueMode: form.userMsgQueueMode === opt.value ? null : opt.value })
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </BulkField>
          ) : null}

          {/* Groups */}
          <BulkField
            id="bulk-edit-groups"
            label={t('nav.groups')}
            ariaLabel={t('nav.groups')}
            enabled={form.enableGroups}
            onEnabledChange={(v) => update({ enableGroups: v })}
            controls="bulk-edit-groups"
          >
            <FieldBody id="bulk-edit-groups" enabled={form.enableGroups}>
              <GroupSelector value={form.groupIds} onChange={(v) => update({ groupIds: v })} groups={groups} />
            </FieldBody>
          </BulkField>
        </form>
      </AccountFormDrawer>

      <ConfirmDialog
        show={showMixedChannelWarning}
        title={t('admin.accounts.mixedChannelWarningTitle')}
        message={mixedChannelWarningMessage}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void handleMixedChannelConfirm()}
        onCancel={handleMixedChannelCancel}
      />
      {confirmDialog}
    </>
  )
}
