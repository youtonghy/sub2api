import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { CreditCard, Plus, Sparkles, X, Zap } from 'lucide-react'

import { adminAPI } from '@/api/admin'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { RadioCards } from '@/components/arc/radio-cards/radio-cards'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import GroupSelector from '@/components/common/GroupSelector'
import HelpTooltip from '@/components/common/HelpTooltip'
import ProxyAdBanner from '@/components/common/ProxyAdBanner'
import ProxySelector from '@/components/common/ProxySelector'
import Select from '@/components/common/Select'
import {
  commonErrorCodes,
  getPresetMappingsByPlatform,
  isValidWildcardPattern
} from '@/composables/useModelWhitelist'
import { useQuotaNotifyState } from '@/composables/useQuotaNotifyState'
import { VERTEX_LOCATION_OPTIONS } from '@/constants/account'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type {
  Account,
  AdminGroup,
  CheckMixedChannelResponse,
  GrokMediaEligibilityMode,
  GrokMediaEligibilityState,
  Group,
  OllamaCloudUsageState,
  OpenAICompactMode,
  OpenAIEndpointCapability,
  OpenAIResponsesMode,
  OpenCodeGoUsageState,
  Proxy
} from '@/types'
import { supportsAccountQuota } from '@/utils/accountQuota'
import { extractApiErrorMessage, extractI18nErrorMessage } from '@/utils/apiError'
import {
  formatDateTime,
  formatDateTimeLocalInput,
  getBrowserTimeZone,
  parseDateTimeLocalInput
} from '@/utils/format'
import { isOfficialGeminiBaseUrl } from '@/utils/geminiExplicitCache'
import {
  OPENAI_WS_MODE_CTX_POOL,
  OPENAI_WS_MODE_HTTP_BRIDGE,
  OPENAI_WS_MODE_OFF,
  OPENAI_WS_MODE_PASSTHROUGH,
  resolveOpenAIWSModeHintKey,
  type OpenAIWSMode
} from '@/utils/openaiWsMode'
import { getAccountExpiryTimestamp } from './accountExpiry'
import { AccountFormDrawer, FormField, FormNotice, FormSection } from './AccountFormLayout'
import formStyles from './AccountForm.module.css'
import styles from './EditAccountModal.module.css'
import {
  AddRowButton,
  ChoiceButtons,
  MappingRowsEditor,
  ModelRestrictionEditor,
  NumberInput,
  OpenCodeGoUsagePanel,
  PoolModeSection,
  PresetMappingButtons,
  SwitchRow,
  TempUnschedRulesEditor
} from './EditAccountModal.parts'
import {
  DEFAULT_POOL_MODE_RETRY_COUNT,
  DEFAULT_POOL_MODE_RETRY_STATUS_CODES,
  MAX_POOL_MODE_RETRY_COUNT,
  applyEditPatch,
  buildEditUpdatePayload,
  cnPresetPlatformOf,
  createInitialEditState,
  currentOpenCodeOrCNMode,
  editAdaptiveProtocolOptions,
  isBedrockAPIKeyMode,
  isCNApiKeyAccount,
  isGenericMultiProtocolAccount,
  isGrokOAuthAccount,
  isSparkShadowAccount,
  isVertexAPIKeyMode,
  modeFromGrokMediaExtra,
  normalizeOpenAIEndpointCapabilities,
  supportsAccountSchedulingThresholdOverridePlatform,
  syncEditStateFromAccount,
  type AnthropicAPIKeyAuthScheme,
  type CodexFingerprintMode,
  type CodexImageToolMode,
  type EditAccountForm,
  type EditState,
  type ModelMapping
} from './EditAccountModal.state'
import {
  buildPlanTypeOptions,
  cnSupportsNativeResponses,
  isCNProviderPlatform,
  isHeaderOverrideCapable,
  providerAccountModes,
  providerModeLabel,
  providerRoutesByModel,
  type CnAccountMode,
  type CnApiProtocol,
  type OpenCodeAccountMode
} from './credentialsBuilder'
import CnBaseUrlPresets from './CnBaseUrlPresets'
import GrokBaseUrlPresets from './GrokBaseUrlPresets'
import HeaderOverrideEditor from './HeaderOverrideEditor'
import { allSelectedGroupsEnableLongContextPricing } from './longContextBilling'
import OllamaCloudUsageSettings from './OllamaCloudUsageSettings'
import OpenCodeGoProtocolRulesEditor from './OpenCodeGoProtocolRulesEditor'
import QuotaLimitCard, { type QuotaLimitCardValues } from './QuotaLimitCard'
import UpstreamRequestIdHeaderField from './UpstreamRequestIdHeaderField'
import { useConfirmDialog } from './useConfirmDialog'

export interface EditAccountModalProps {
  show: boolean
  account: Account | null
  proxies: Proxy[]
  groups: AdminGroup[]
  onClose: () => void
  onUpdated: (account: Account) => void
}

interface MixedChannelDetails {
  groupName: string
  currentPlatform: string
  otherPlatform: string
}

const isOpenAIType = (account: Account | null) =>
  account?.platform === 'openai' &&
  (account?.type === 'oauth' || account?.type === 'setup-token' || account?.type === 'apikey')

/** 编辑账号（对应 Vue 版 EditAccountModal.vue），右侧宽抽屉 */
export default function EditAccountModal({ show, account, proxies, groups, onClose, onUpdated }: EditAccountModalProps) {
  const { t } = useI18n()
  const quotaNotify = useQuotaNotifyState()
  const { confirm, confirmDialog } = useConfirmDialog()
  const browserTimeZone = getBrowserTimeZone()
  const idPrefix = useId()

  const [s, setS] = useState<EditState>(createInitialEditState)
  /** 用户修改：按 Vue 版 watcher 语义运行模式/协议联动 */
  const update = (patch: Partial<EditState>) => setS((prev) => applyEditPatch(prev, patch, account))
  const updateForm = (patch: Partial<EditAccountForm>) => setS((prev) => ({ ...prev, form: { ...prev.form, ...patch } }))

  const [submitting, setSubmitting] = useState(false)
  const [tlsFingerprintProfiles, setTlsFingerprintProfiles] = useState<{ id: number; name: string }[]>([])
  const [webSearchGlobalEnabled, setWebSearchGlobalEnabled] = useState(false)
  const [isSyncingAntigravityUpstream, setIsSyncingAntigravityUpstream] = useState(false)

  // Grok OAuth media generation eligibility override
  const [grokMediaEligibilityMode, setGrokMediaEligibilityMode] = useState<GrokMediaEligibilityMode>('auto')
  const [grokMediaEligibilityInitialMode, setGrokMediaEligibilityInitialMode] = useState<GrokMediaEligibilityMode>('auto')
  const [grokMediaEligibilityState, setGrokMediaEligibilityState] = useState<GrokMediaEligibilityState | null>(null)
  const [grokMediaEligibilityLoading, setGrokMediaEligibilityLoading] = useState(false)
  const [grokMediaEligibilityError, setGrokMediaEligibilityError] = useState('')
  const grokMediaEligibilityRequestVersion = useRef(0)

  // Mixed channel warning
  const [showMixedChannelWarning, setShowMixedChannelWarning] = useState(false)
  const [mixedChannelWarningDetails, setMixedChannelWarningDetails] = useState<MixedChannelDetails | null>(null)
  const [mixedChannelWarningRawMessage, setMixedChannelWarningRawMessage] = useState('')
  const mixedChannelWarningAction = useRef<(() => Promise<void>) | null>(null)
  const antigravityMixedChannelConfirmed = useRef(false)

  // OpenCode Go usage panel state
  const [opencodeGoState, setOpencodeGoState] = useState<OpenCodeGoUsageState | null>(account?.opencode_go_usage ?? null)
  const [opencodeGoLoading, setOpencodeGoLoading] = useState(false)
  const [opencodeGoSaving, setOpencodeGoSaving] = useState(false)
  const [opencodeGoRefreshing, setOpencodeGoRefreshing] = useState(false)

  // ── 派生值（Vue 版 computed） ──
  const selectableGroups = (() => {
    const map = new Map<number, Group>(groups.map((group) => [group.id, group]))
    const assignedIds = new Set(account?.group_ids ?? [])
    for (const group of account?.groups ?? []) {
      if (assignedIds.has(group.id) && !map.has(group.id)) {
        map.set(group.id, group)
      }
    }
    return Array.from(map.values())
  })()
  const isSparkShadow = isSparkShadowAccount(account)
  const hideAccountLongContextBilling = allSelectedGroupsEnableLongContextPricing(s.form.group_ids, groups)
  const cnApiKeyAccount = isCNApiKeyAccount(account)
  const genericMultiProtocolAccount = isGenericMultiProtocolAccount(account)
  const genericAccountModes = providerAccountModes(account?.platform ?? '')
  const cnPresetPlatform = cnPresetPlatformOf(account)
  // 国产厂商的接入模式只有 payg / coding。
  const cnPresetMode: CnAccountMode = s.editAccountMode === 'coding' ? 'coding' : 'payg'
  const currentMode = currentOpenCodeOrCNMode(s, account)
  const cnAccountModeOptions: Array<{ value: CnAccountMode; labelKey: 'payg' | 'coding' }> =
    // DeepSeek 无 coding 套餐（与创建弹窗一致），仅保留按量付费。
    account?.platform === 'deepseek'
      ? [{ value: 'payg', labelKey: 'payg' }]
      : [
          { value: 'payg', labelKey: 'payg' },
          { value: 'coding', labelKey: 'coding' }
        ]
  const adaptiveProtocolOptions = editAdaptiveProtocolOptions(s, account)
  const cnProtocolOptions: Array<{ value: CnApiProtocol; labelKey: string }> = [
    { value: 'adaptive', labelKey: 'adaptive' },
    ...adaptiveProtocolOptions
  ]
  const cnProtocolDescKey = cnProtocolOptions.find((o) => o.value === s.editApiProtocol)?.labelKey ?? 'chatCompletions'
  const vertexAPIKeyMode = isVertexAPIKeyMode(account)
  const bedrockAPIKeyMode = isBedrockAPIKeyMode(account)
  const grokOAuthAccount = isGrokOAuthAccount(account)
  const headerOverrideCapable = !!account && isHeaderOverrideCapable(account.platform, account.type)
  const supportsAccountSchedulingThresholdOverride = supportsAccountSchedulingThresholdOverridePlatform(account?.platform)
  const presetMappings = getPresetMappingsByPlatform(account?.platform || 'anthropic')
  const antigravityPresetMappings = getPresetMappingsByPlatform('antigravity')
  const bedrockPresets = getPresetMappingsByPlatform('bedrock')
  const openAITextGenerationCapabilityEnabled = s.openAIEndpointCapabilities.includes('chat_completions')
  const isOpenAIModelRestrictionDisabled = account?.platform === 'openai' && s.openaiPassthroughEnabled
  const accountExtra = account?.extra as Record<string, unknown> | undefined

  // Platform-specific hint for Base URL
  const baseUrlHint = !account
    ? t('admin.accounts.baseUrlHint')
    : account.platform === 'openai'
      ? t('admin.accounts.openai.baseUrlHint')
      : account.platform === 'gemini'
        ? t('admin.accounts.gemini.baseUrlHint')
        : account.platform === 'grok'
          ? ''
          : t('admin.accounts.baseUrlHint')

  const umqModeOptions = [
    { value: '', label: t('admin.accounts.quotaControl.rpmLimit.umqModeOff') },
    { value: 'throttle', label: t('admin.accounts.quotaControl.rpmLimit.umqModeThrottle') },
    { value: 'serialize', label: t('admin.accounts.quotaControl.rpmLimit.umqModeSerialize') }
  ]
  const codexFingerprintModeOptions = [
    { value: 'off', label: t('admin.accounts.openai.codexFingerprintOff') },
    { value: 'device', label: t('admin.accounts.openai.codexFingerprintDevice') },
    { value: 'session', label: t('admin.accounts.openai.codexFingerprintSession') },
    { value: 'full', label: t('admin.accounts.openai.codexFingerprintFull') }
  ]
  const openAIWSModeOptions = [
    { value: OPENAI_WS_MODE_OFF, label: t('admin.accounts.openai.wsModeOff') },
    { value: OPENAI_WS_MODE_CTX_POOL, label: t('admin.accounts.openai.wsModeCtxPool') },
    { value: OPENAI_WS_MODE_PASSTHROUGH, label: t('admin.accounts.openai.wsModePassthrough') },
    { value: OPENAI_WS_MODE_HTTP_BRIDGE, label: t('admin.accounts.openai.wsModeHttpBridge') }
  ]
  const openaiResponsesWebSocketV2Mode =
    account?.type === 'apikey' ? s.openaiAPIKeyResponsesWebSocketV2Mode : s.openaiOAuthResponsesWebSocketV2Mode
  const setOpenaiResponsesWebSocketV2Mode = (mode: OpenAIWSMode) => {
    if (account?.type === 'apikey') {
      update({ openaiAPIKeyResponsesWebSocketV2Mode: mode })
      return
    }
    update({ openaiOAuthResponsesWebSocketV2Mode: mode })
  }
  const openAIWSModeHintKey = resolveOpenAIWSModeHintKey(openaiResponsesWebSocketV2Mode)

  const codexImageToolOptions: Array<{ value: CodexImageToolMode; label: string; description: string }> = [
    {
      value: 'inherit',
      label: t('admin.accounts.openai.codexImageToolInherit'),
      description: t('admin.accounts.openai.codexImageToolInheritDesc')
    },
    {
      value: 'enabled',
      label: t('admin.accounts.openai.codexImageToolEnabled'),
      description: t('admin.accounts.openai.codexImageToolEnabledDesc')
    },
    {
      value: 'disabled',
      label: t('admin.accounts.openai.codexImageToolDisabled'),
      description: t('admin.accounts.openai.codexImageToolDisabledDesc')
    },
    {
      value: 'block',
      label: t('admin.accounts.openai.codexImageToolBlock'),
      description: t('admin.accounts.openai.codexImageToolBlockDesc')
    }
  ]
  const codexImageToolBadge: { label: string; tone: BadgeTone } = (() => {
    switch (s.codexImageToolMode) {
      case 'enabled':
        return { label: t('admin.accounts.openai.codexImageToolBadgeEnabled'), tone: 'success' }
      case 'disabled':
        return { label: t('admin.accounts.openai.codexImageToolBadgeDisabled'), tone: 'warning' }
      case 'block':
        return { label: t('admin.accounts.openai.codexImageToolBadgeBlock'), tone: 'danger' }
      default:
        return { label: t('admin.accounts.openai.codexImageToolBadgeInherit'), tone: 'neutral' }
    }
  })()
  const openAICompactModeOptions = [
    { value: 'auto', label: t('admin.accounts.openai.compactModeAuto') },
    { value: 'force_on', label: t('admin.accounts.openai.compactModeForceOn') },
    { value: 'force_off', label: t('admin.accounts.openai.compactModeForceOff') }
  ]
  // OpenAI 订阅档位手动覆盖选项(清空 + Plus/Pro/Free;别名/自定义值友好显示且保留 canonical)
  const planTypeOptions = buildPlanTypeOptions(s.editPlanType, t('admin.accounts.openai.planTypeClear'))
  const openAIResponsesModeOptions = [
    { value: 'auto', label: t('admin.accounts.openai.responsesModeAuto') },
    { value: 'force_responses', label: t('admin.accounts.openai.responsesModeForceResponses') },
    { value: 'force_chat_completions', label: t('admin.accounts.openai.responsesModeForceChatCompletions') }
  ]
  const openAITextEndpointCapabilityLabel = (() => {
    if (s.openAIResponsesMode === 'force_responses') return t('admin.accounts.openai.capabilityResponses')
    if (s.openAIResponsesMode === 'force_chat_completions') return t('admin.accounts.openai.capabilityChatCompletions')
    if (accountExtra?.openai_responses_supported === true) return t('admin.accounts.openai.capabilityResponsesAuto')
    if (accountExtra?.openai_responses_supported === false) return t('admin.accounts.openai.capabilityChatCompletionsAuto')
    return t('admin.accounts.openai.capabilityTextAuto')
  })()
  const openAIEndpointCapabilityOptions: { value: OpenAIEndpointCapability; label: string }[] = [
    { value: 'chat_completions', label: openAITextEndpointCapabilityLabel },
    { value: 'embeddings', label: t('admin.accounts.openai.capabilityEmbeddings') },
    { value: 'seedance', label: 'Seedance (Ark)' }
  ]
  const openAIResponsesStatusKey = (() => {
    if (s.openAIResponsesMode === 'force_responses') return 'admin.accounts.openai.responsesStatusForcedResponses'
    if (s.openAIResponsesMode === 'force_chat_completions') return 'admin.accounts.openai.responsesStatusForcedChatCompletions'
    if (accountExtra?.openai_responses_supported === true) return 'admin.accounts.openai.responsesStatusAutoSupported'
    if (accountExtra?.openai_responses_supported === false) return 'admin.accounts.openai.responsesStatusAutoUnsupported'
    return 'admin.accounts.openai.responsesStatusAutoUnknown'
  })()
  const openAICompactStatusKey = (() => {
    if (!account || account.platform !== 'openai') return ''
    const mode = typeof accountExtra?.openai_compact_mode === 'string' ? accountExtra.openai_compact_mode : 'auto'
    if (mode === 'force_on') return 'admin.accounts.openai.compactSupported'
    if (mode === 'force_off') return 'admin.accounts.openai.compactUnsupported'
    if (typeof accountExtra?.openai_compact_supported === 'boolean') {
      return accountExtra.openai_compact_supported
        ? 'admin.accounts.openai.compactSupported'
        : 'admin.accounts.openai.compactUnsupported'
    }
    return 'admin.accounts.openai.compactAuto'
  })()
  const statusOptions = [
    { value: 'active', label: t('common.active') },
    { value: 'inactive', label: t('common.inactive') },
    ...(s.form.status === 'error' ? [{ value: 'error', label: t('admin.accounts.status.error') }] : [])
  ]
  const vertexLocationOptions = VERTEX_LOCATION_OPTIONS.flatMap((group) => [
    { value: `__group__${group.label}`, label: group.label, kind: 'group', disabled: true },
    ...group.options
  ])
  const tlsProfileOptions = [
    { value: null, label: t('admin.accounts.quotaControl.tlsFingerprint.defaultProfile') },
    ...(tlsFingerprintProfiles.length > 0
      ? [{ value: -1, label: t('admin.accounts.quotaControl.tlsFingerprint.randomProfile') }]
      : []),
    ...tlsFingerprintProfiles.map((p) => ({ value: p.id, label: p.name }))
  ]
  const mixedChannelWarningMessageText = mixedChannelWarningDetails
    ? t('admin.accounts.mixedChannelWarning', mixedChannelWarningDetails)
    : mixedChannelWarningRawMessage

  // ── OpenCode Go ──
  const applyOpenCodeGoState = (next: OpenCodeGoUsageState) => {
    setOpencodeGoState(next)
    if (account) onUpdated({ ...account, opencode_go_usage: next })
  }

  const loadOpenCodeGoUsage = useEffectEvent(async () => {
    if (!account) return
    setOpencodeGoLoading(true)
    try {
      applyOpenCodeGoState(await adminAPI.accounts.getOpenCodeGoUsage(account.id))
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.accounts.opencodeGo.loadFailed')))
    } finally {
      setOpencodeGoLoading(false)
    }
  })

  const setOpenCodeGoAutoRefresh = async (enabled: boolean) => {
    if (!account) return
    setOpencodeGoSaving(true)
    try {
      applyOpenCodeGoState(await adminAPI.accounts.setOpenCodeGoUsageAutoRefresh(account.id, enabled))
    } catch (error) {
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.accounts.opencodeGo.autoRefreshFailed')))
    } finally {
      setOpencodeGoSaving(false)
    }
  }

  const refreshOpenCodeGoUsage = async () => {
    if (!account) return
    setOpencodeGoRefreshing(true)
    try {
      applyOpenCodeGoState(await adminAPI.accounts.refreshOpenCodeGoUsage(account.id))
      useAppStore.getState().showSuccess(t('admin.accounts.opencodeGo.refreshSuccess'))
    } catch (error) {
      useAppStore
        .getState()
        .showError(
          extractI18nErrorMessage(error, t, 'admin.accounts.opencodeGo.errors', t('admin.accounts.opencodeGo.refreshFailed'))
        )
    } finally {
      setOpencodeGoRefreshing(false)
    }
  }

  // 对应 Vue 版 onMounted + watch(() => props.account?.id)
  const syncOpenCodeGoState = useEffectEvent(() => {
    const next = account?.opencode_go_usage ?? null
    setOpencodeGoState(next)
    if (next && !next.snapshot) void loadOpenCodeGoUsage()
  })
  const accountId = account?.id
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 对应 Vue 版 watch(account.id)：换账号时重置用量面板
    syncOpenCodeGoState()
  }, [accountId])

  // Load global feature states once
  const loadGlobalStates = useEffectEvent(() => {
    adminAPI.settings
      .getWebSearchEmulationConfig()
      .then((cfg) => {
        setWebSearchGlobalEnabled(cfg?.enabled === true && (cfg?.providers?.length ?? 0) > 0)
      })
      .catch(() => {
        setWebSearchGlobalEnabled(false)
      })
    quotaNotify.loadGlobalState()
  })
  useEffect(() => {
    loadGlobalStates()
  }, [])

  // ── Grok 媒体生成资格 ──
  const loadGrokMediaEligibility = async (
    target: Account | null,
    accountID: number
  ): Promise<GrokMediaEligibilityState | null> => {
    if (!isGrokOAuthAccount(target) || typeof adminAPI.accounts.getGrokMediaEligibility !== 'function') {
      return null
    }
    const requestVersion = ++grokMediaEligibilityRequestVersion.current
    setGrokMediaEligibilityLoading(true)
    setGrokMediaEligibilityError('')
    try {
      const state = await adminAPI.accounts.getGrokMediaEligibility(accountID)
      if (requestVersion !== grokMediaEligibilityRequestVersion.current) return null
      setGrokMediaEligibilityState(state)
      setGrokMediaEligibilityMode(state.mode)
      setGrokMediaEligibilityInitialMode(state.mode)
      return state
    } catch (error: any) {
      if (requestVersion !== grokMediaEligibilityRequestVersion.current) return null
      setGrokMediaEligibilityError(error?.message || t('admin.accounts.grokMediaEligibility.loadFailed'))
      return null
    } finally {
      if (requestVersion === grokMediaEligibilityRequestVersion.current) {
        setGrokMediaEligibilityLoading(false)
      }
    }
  }

  // ── 混合渠道 ──
  const clearMixedChannelDialog = () => {
    setShowMixedChannelWarning(false)
    setMixedChannelWarningDetails(null)
    setMixedChannelWarningRawMessage('')
    mixedChannelWarningAction.current = null
  }

  const loadTLSProfiles = async () => {
    try {
      const profiles = await adminAPI.tlsFingerprintProfiles.list()
      setTlsFingerprintProfiles(profiles.map((p) => ({ id: p.id, name: p.name })))
    } catch {
      setTlsFingerprintProfiles([])
    }
  }

  /** Vue 版 syncFormFromAccount + loadTLSProfiles */
  const syncFormFromAccount = useEffectEvent((newAccount: Account) => {
    antigravityMixedChannelConfirmed.current = false
    clearMixedChannelDialog()
    setS((prev) => syncEditStateFromAccount(prev, newAccount))

    const extra = newAccount.extra as Record<string, unknown> | undefined
    // Load quota notify config
    if (supportsAccountQuota(newAccount.type)) {
      quotaNotify.loadFromExtra(extra)
    } else {
      quotaNotify.reset()
    }
    // Load quota notify for bedrock
    if (newAccount.type === 'bedrock' && newAccount.credentials) {
      quotaNotify.loadFromExtra((newAccount.extra as Record<string, unknown>) || {})
    }

    const mode = modeFromGrokMediaExtra(extra)
    setGrokMediaEligibilityMode(mode)
    setGrokMediaEligibilityInitialMode(mode)
    setGrokMediaEligibilityState(null)
    setGrokMediaEligibilityError('')
    if (newAccount.platform === 'grok' && newAccount.type === 'oauth') {
      void loadGrokMediaEligibility(newAccount, newAccount.id)
    } else {
      grokMediaEligibilityRequestVersion.current++
    }
    void loadTLSProfiles()
  })

  // 对应 Vue 版 watch([show, account], ..., { immediate: true })：打开或换账号时回填
  const prevShowRef = useRef(false)
  const prevAccountRef = useRef<Account | null>(null)
  useLayoutEffect(() => {
    const wasShow = prevShowRef.current
    const previousAccount = prevAccountRef.current
    prevShowRef.current = show
    prevAccountRef.current = account
    if (!show || !account) return
    if (!wasShow || account !== previousAccount) {
      syncFormFromAccount(account)
    }
  }, [show, account])

  // ── 模型映射 / 错误码 / Antigravity 同步 ──
  const addPresetMapping = (from: string, to: string) => {
    const exists = s.modelMappings.some((m) => m.from === from)
    if (exists) {
      useAppStore.getState().showInfo(t('admin.accounts.mappingExists', { model: from }))
      return
    }
    update({ modelMappings: [...s.modelMappings, { from, to }] })
  }

  const addAntigravityPresetMapping = (from: string, to: string) => {
    const exists = s.antigravityModelMappings.some((m) => m.from === from)
    if (exists) {
      useAppStore.getState().showInfo(t('admin.accounts.mappingExists', { model: from }))
      return
    }
    update({ antigravityModelMappings: [...s.antigravityModelMappings, { from, to }] })
  }

  const syncAntigravityUpstreamModels = async () => {
    if (!account?.id || isSyncingAntigravityUpstream) return

    const appStore = useAppStore.getState()
    setIsSyncingAntigravityUpstream(true)
    try {
      const result = await adminAPI.accounts.syncUpstreamModels(account.id)
      const upstreamModels = result.models.map((model) => model.trim()).filter(Boolean)
      if (upstreamModels.length === 0) {
        appStore.showInfo(t('admin.accounts.syncUpstreamModelsEmpty'))
        return
      }

      // 以函数式更新合并，避免覆盖请求期间用户的修改
      let addedCount = 0
      const additions: ModelMapping[] = []
      const existing = new Set(s.antigravityModelMappings.map((mapping) => mapping.from))
      for (const model of upstreamModels) {
        if (!existing.has(model)) {
          existing.add(model)
          additions.push({ from: model, to: model })
          addedCount += 1
        }
      }
      if (additions.length > 0) {
        setS((prev) => {
          const present = new Set(prev.antigravityModelMappings.map((mapping) => mapping.from))
          const fresh = additions.filter((mapping) => !present.has(mapping.from))
          return { ...prev, antigravityModelMappings: [...prev.antigravityModelMappings, ...fresh] }
        })
      }

      const warnings = result.warnings ?? []
      const hasPartialMetadata = warnings.some((warning) => warning.code === 'upstream_model_metadata_partial')
      const hasIncompleteMetadata = warnings.some((warning) => warning.code === 'upstream_model_metadata_incomplete')
      if (hasIncompleteMetadata) {
        appStore.showWarning(t('admin.accounts.syncUpstreamModelsMetadataIncomplete'))
        return
      }
      if (addedCount > 0) {
        appStore.showSuccess(t('admin.accounts.syncUpstreamModelsSuccess', { count: addedCount, total: upstreamModels.length }))
      } else {
        appStore.showInfo(t('admin.accounts.syncUpstreamModelsNoChanges', { count: upstreamModels.length }))
      }
      if (hasPartialMetadata) {
        appStore.showWarning(t('admin.accounts.syncUpstreamModelsMetadataPartial'))
      }
    } catch (error) {
      const message = extractApiErrorMessage(error, t('admin.accounts.syncUpstreamModelsFailed'))
      appStore.showError(t('admin.accounts.syncUpstreamModelsError', { message }))
    } finally {
      setIsSyncingAntigravityUpstream(false)
    }
  }

  /** 429 / 529 需要确认（Vue 版使用原生 confirm） */
  const confirmRiskyErrorCode = async (code: number) => {
    if (code === 429) return confirm(t('admin.accounts.customErrorCodes429Warning'))
    if (code === 529) return confirm(t('admin.accounts.customErrorCodes529Warning'))
    return true
  }

  // Error code toggle helper
  const toggleErrorCode = async (code: number) => {
    if (s.selectedErrorCodes.includes(code)) {
      setS((prev) => ({ ...prev, selectedErrorCodes: prev.selectedErrorCodes.filter((value) => value !== code) }))
      return
    }
    // Adding code - check for 429/529 warning
    if (!(await confirmRiskyErrorCode(code))) return
    setS((prev) =>
      prev.selectedErrorCodes.includes(code) ? prev : { ...prev, selectedErrorCodes: [...prev.selectedErrorCodes, code] }
    )
  }

  // Add custom error code from input
  const addCustomErrorCode = async () => {
    const code = s.customErrorCodeInput
    if (code === null || code === '' || code < 100 || code > 599) {
      useAppStore.getState().showError(t('admin.accounts.invalidErrorCode'))
      return
    }
    if (s.selectedErrorCodes.includes(code)) {
      useAppStore.getState().showInfo(t('admin.accounts.errorCodeExists'))
      return
    }
    // Check for 429/529 warning
    if (!(await confirmRiskyErrorCode(code))) return
    setS((prev) => ({
      ...prev,
      selectedErrorCodes: prev.selectedErrorCodes.includes(code) ? prev.selectedErrorCodes : [...prev.selectedErrorCodes, code],
      customErrorCodeInput: null
    }))
  }

  const toggleOpenAIEndpointCapability = (capability: OpenAIEndpointCapability) => {
    if (s.openAIEndpointCapabilities.includes(capability)) {
      // 至少保留一项（受控勾选框不变即保持勾选）
      if (s.openAIEndpointCapabilities.length <= 1) return
      const next = s.openAIEndpointCapabilities.filter((value) => value !== capability)
      update({
        openAIEndpointCapabilities: next,
        ...(next.includes('chat_completions') ? {} : { openAIResponsesMode: 'auto' as OpenAIResponsesMode })
      })
      return
    }
    update({ openAIEndpointCapabilities: normalizeOpenAIEndpointCapabilities([...s.openAIEndpointCapabilities, capability]) })
  }

  const handleUpstreamBillingRateSyncChange = (enabled: boolean) => {
    update(enabled ? { upstreamBillingRateSyncEnabled: true, upstreamBillingAutoProbeEnabled: true } : { upstreamBillingRateSyncEnabled: false })
  }

  const handleUpstreamBillingAutoProbeChange = (enabled: boolean) => {
    update(enabled ? { upstreamBillingAutoProbeEnabled: true } : { upstreamBillingAutoProbeEnabled: false, upstreamBillingRateSyncEnabled: false })
  }

  // 点击预设端点：回填 base url 与对应模式/协议。
  const onCnPresetSelect = (preset: { mode: CnAccountMode; protocol: CnApiProtocol; url: string }) => {
    update({ editAccountMode: preset.mode, editApiProtocol: preset.protocol, editBaseUrl: preset.url })
  }

  const quotaValues: QuotaLimitCardValues = {
    totalLimit: s.editQuotaLimit,
    dailyLimit: s.editQuotaDailyLimit,
    weeklyLimit: s.editQuotaWeeklyLimit,
    dailyResetMode: s.editDailyResetMode,
    dailyResetHour: s.editDailyResetHour,
    weeklyResetMode: s.editWeeklyResetMode,
    weeklyResetDay: s.editWeeklyResetDay,
    weeklyResetHour: s.editWeeklyResetHour,
    resetTimezone: s.editResetTimezone,
    quotaNotifyDailyEnabled: quotaNotify.state.daily.enabled,
    quotaNotifyDailyThreshold: quotaNotify.state.daily.threshold,
    quotaNotifyDailyThresholdType: quotaNotify.state.daily.thresholdType,
    quotaNotifyWeeklyEnabled: quotaNotify.state.weekly.enabled,
    quotaNotifyWeeklyThreshold: quotaNotify.state.weekly.threshold,
    quotaNotifyWeeklyThresholdType: quotaNotify.state.weekly.thresholdType,
    quotaNotifyTotalEnabled: quotaNotify.state.total.enabled,
    quotaNotifyTotalThreshold: quotaNotify.state.total.threshold,
    quotaNotifyTotalThresholdType: quotaNotify.state.total.thresholdType
  }
  const handleQuotaUpdate = (patch: Partial<QuotaLimitCardValues>) => {
    const next: Partial<EditState> = {}
    if ('totalLimit' in patch) next.editQuotaLimit = patch.totalLimit ?? null
    if ('dailyLimit' in patch) next.editQuotaDailyLimit = patch.dailyLimit ?? null
    if ('weeklyLimit' in patch) next.editQuotaWeeklyLimit = patch.weeklyLimit ?? null
    if ('dailyResetMode' in patch) next.editDailyResetMode = patch.dailyResetMode ?? null
    if ('dailyResetHour' in patch) next.editDailyResetHour = patch.dailyResetHour ?? null
    if ('weeklyResetMode' in patch) next.editWeeklyResetMode = patch.weeklyResetMode ?? null
    if ('weeklyResetDay' in patch) next.editWeeklyResetDay = patch.weeklyResetDay ?? null
    if ('weeklyResetHour' in patch) next.editWeeklyResetHour = patch.weeklyResetHour ?? null
    if ('resetTimezone' in patch) next.editResetTimezone = patch.resetTimezone ?? null
    if (Object.keys(next).length > 0) update(next)
    for (const dim of ['daily', 'weekly', 'total'] as const) {
      const prefix = `quotaNotify${dim[0].toUpperCase()}${dim.slice(1)}` as 'quotaNotifyDaily'
      const dimPatch: { enabled?: boolean | null; threshold?: number | null; thresholdType?: any } = {}
      if (`${prefix}Enabled` in patch) dimPatch.enabled = patch[`${prefix}Enabled`] ?? null
      if (`${prefix}Threshold` in patch) dimPatch.threshold = patch[`${prefix}Threshold`] ?? null
      if (`${prefix}ThresholdType` in patch) dimPatch.thresholdType = patch[`${prefix}ThresholdType`] ?? null
      if (Object.keys(dimPatch).length > 0) quotaNotify.setDim(dim, dimPatch)
    }
  }

  // ── 提交 ──
  const handleClose = () => {
    antigravityMixedChannelConfirmed.current = false
    clearMixedChannelDialog()
    onClose()
  }

  const needsMixedChannelCheck = () => account?.platform === 'antigravity' || account?.platform === 'anthropic'

  const buildMixedChannelDetails = (resp?: CheckMixedChannelResponse): MixedChannelDetails | null => {
    const details = resp?.details
    if (!details) {
      return null
    }
    return {
      groupName: details.group_name || 'Unknown',
      currentPlatform: details.current_platform || 'Unknown',
      otherPlatform: details.other_platform || 'Unknown'
    }
  }

  const openMixedChannelDialog = (opts: {
    response?: CheckMixedChannelResponse
    message?: string
    onConfirm: () => Promise<void>
  }) => {
    setMixedChannelWarningDetails(buildMixedChannelDetails(opts.response))
    setMixedChannelWarningRawMessage(opts.message || opts.response?.message || t('admin.accounts.failedToUpdate'))
    mixedChannelWarningAction.current = opts.onConfirm
    setShowMixedChannelWarning(true)
  }

  const withAntigravityConfirmFlag = (payload: Record<string, unknown>) => {
    if (needsMixedChannelCheck() && antigravityMixedChannelConfirmed.current) {
      return {
        ...payload,
        confirm_mixed_channel_risk: true
      }
    }
    const cloned = { ...payload }
    delete cloned.confirm_mixed_channel_risk
    return cloned
  }

  const ensureAntigravityMixedChannelConfirmed = async (onConfirm: () => Promise<void>): Promise<boolean> => {
    if (!needsMixedChannelCheck()) {
      return true
    }
    if (antigravityMixedChannelConfirmed.current) {
      return true
    }
    if (!account) {
      return false
    }

    try {
      const result = await adminAPI.accounts.checkMixedChannelRisk({
        platform: account.platform,
        group_ids: s.form.group_ids,
        account_id: account.id
      })
      if (!result.has_risk) {
        return true
      }
      openMixedChannelDialog({
        response: result,
        onConfirm: async () => {
          antigravityMixedChannelConfirmed.current = true
          await onConfirm()
        }
      })
      return false
    } catch (error: any) {
      useAppStore.getState().showError(error.message || t('admin.accounts.failedToUpdate'))
      return false
    }
  }

  const persistGrokMediaEligibility = async (accountID: number, updatedAccount: Account): Promise<Account> => {
    if (
      !grokOAuthAccount ||
      grokMediaEligibilityMode === grokMediaEligibilityInitialMode ||
      typeof adminAPI.accounts.updateGrokMediaEligibility !== 'function'
    ) {
      return updatedAccount
    }

    const applyMode = (mode: GrokMediaEligibilityMode) => {
      const nextExtra = { ...((updatedAccount.extra as Record<string, unknown> | undefined) || {}) }
      if (mode === 'auto') {
        delete nextExtra.grok_media_eligible
      } else {
        nextExtra.grok_media_eligible = mode === 'enabled'
      }
      updatedAccount = { ...updatedAccount, extra: nextExtra as Account['extra'] }
    }

    try {
      const state = await adminAPI.accounts.updateGrokMediaEligibility(accountID, grokMediaEligibilityMode)
      setGrokMediaEligibilityState(state)
      setGrokMediaEligibilityInitialMode(state.mode)
      applyMode(state.mode)
    } catch {
      useAppStore.getState().showError(t('admin.accounts.grokMediaEligibility.partialSave'))
      try {
        const state = await loadGrokMediaEligibility(account, accountID)
        if (state) applyMode(state.mode)
      } catch {
        // The original save result remains useful even when the refresh fails.
      }
    }
    return updatedAccount
  }

  const submitUpdateAccount = async (accountID: number, updatePayload: Record<string, unknown>): Promise<void> => {
    setSubmitting(true)
    try {
      let updatedAccount = await adminAPI.accounts.update(accountID, withAntigravityConfirmFlag(updatePayload))
      updatedAccount = await persistGrokMediaEligibility(accountID, updatedAccount)
      useAppStore.getState().showSuccess(t('admin.accounts.accountUpdated'))
      onUpdated(updatedAccount)
      handleClose()
    } catch (error: any) {
      if (error?.status === 409 && error?.error === 'mixed_channel_warning' && needsMixedChannelCheck()) {
        openMixedChannelDialog({
          message: error.message,
          onConfirm: async () => {
            antigravityMixedChannelConfirmed.current = true
            await submitUpdateAccount(accountID, updatePayload)
          }
        })
        return
      }
      useAppStore.getState().showError(error?.message || t('admin.accounts.failedToUpdate'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    if (!account) return
    const accountID = account.id

    try {
      const result = buildEditUpdatePayload(s, account, {
        t,
        writeQuotaNotifyToExtra: quotaNotify.writeToExtra
      })
      if (!result.ok) {
        useAppStore.getState().showError(result.message)
        return
      }
      const updatePayload = result.payload

      const canContinue = await ensureAntigravityMixedChannelConfirmed(async () => {
        await submitUpdateAccount(accountID, updatePayload)
      })
      if (!canContinue) {
        return
      }

      await submitUpdateAccount(accountID, updatePayload)
    } catch (error: any) {
      useAppStore.getState().showError(error?.message || t('admin.accounts.failedToUpdate'))
    }
  }

  // Handle mixed channel warning confirmation
  const handleMixedChannelConfirm = async () => {
    const action = mixedChannelWarningAction.current
    if (!action) {
      clearMixedChannelDialog()
      return
    }
    clearMixedChannelDialog()
    setSubmitting(true)
    try {
      await action()
    } finally {
      setSubmitting(false)
    }
  }

  const handleOllamaCloudUsageUpdated = (state: OllamaCloudUsageState) => {
    if (account) onUpdated({ ...account, ollama_cloud_usage: state })
  }

  const fieldId = (name: string) => `${idPrefix}-${name}`

  // ── 渲染 ──
  const renderModelRestriction = (variant: 'default' | 'bedrock' = 'default', keyPrefix = 'edit-model-mapping') => (
    <ModelRestrictionEditor
      mode={s.modelRestrictionMode}
      onModeChange={(mode) => update({ modelRestrictionMode: mode })}
      allowedModels={s.allowedModels}
      onAllowedModelsChange={(models) => update({ allowedModels: models })}
      mappings={s.modelMappings}
      onMappingsChange={(rows) => update({ modelMappings: rows })}
      platform={variant === 'bedrock' ? 'anthropic' : account?.platform || 'anthropic'}
      accountId={variant === 'bedrock' ? undefined : account?.id}
      presets={variant === 'bedrock' ? bedrockPresets : presetMappings}
      onPreset={
        variant === 'bedrock'
          ? (from, to) => update({ modelMappings: [...s.modelMappings, { from, to }] })
          : addPresetMapping
      }
      keyPrefix={keyPrefix}
      variant={variant}
    />
  )

  const apiKeyPlaceholder =
    account?.platform === 'openai'
      ? 'sk-proj-...'
      : account?.platform === 'gemini'
        ? 'AQ.Ab...'
        : account?.platform === 'antigravity'
          ? 'sk-...'
          : account?.platform === 'grok'
            ? 'xai-...'
            : 'sk-ant-...'
  const baseUrlPlaceholder =
    account?.platform === 'openai'
      ? 'https://api.openai.com'
      : account?.platform === 'gemini'
        ? 'https://generativelanguage.googleapis.com'
        : account?.platform === 'antigravity'
          ? 'https://cloudcode-pa.googleapis.com'
          : account?.platform === 'grok'
            ? 'https://api.x.ai/v1'
            : 'https://api.anthropic.com'

  const footer = account ? (
    <>
      <Button type="button" variant="secondary" onClick={handleClose}>
        {t('common.cancel')}
      </Button>
      <Button
        type="submit"
        form="edit-account-form"
        disabled={submitting}
        loading={submitting}
        data-tour="account-form-submit"
      >
        {submitting ? t('admin.accounts.updating') : t('common.update')}
      </Button>
    </>
  ) : null

  return (
    <>
      <AccountFormDrawer show={show} title={t('admin.accounts.editAccount')} width="wide" onClose={handleClose} footer={footer}>
        {account ? (
          <form
            id="edit-account-form"
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            <FormSection>
              <FormField label={t('common.name')} htmlFor={fieldId('name')}>
                <input
                  id={fieldId('name')}
                  type="text"
                  required
                  className={formStyles.input}
                  data-tour="edit-account-form-name"
                  value={s.form.name}
                  onChange={(event) => updateForm({ name: event.target.value })}
                />
              </FormField>
              <FormField label={t('admin.accounts.notes')} htmlFor={fieldId('notes')} hint={t('admin.accounts.notesHint')}>
                <textarea
                  id={fieldId('notes')}
                  rows={3}
                  className={formStyles.textarea}
                  placeholder={t('admin.accounts.notesPlaceholder')}
                  value={s.form.notes}
                  onChange={(event) => updateForm({ notes: event.target.value })}
                />
              </FormField>
            </FormSection>

            {/* API Key fields (only for apikey type) */}
            {account.type === 'apikey' ? (
              <>
                <FormSection title={t('admin.accounts.apiKey')}>
                  {!cnApiKeyAccount || s.editApiProtocol !== 'adaptive' ? (
                    <FormField label={t('admin.accounts.baseUrl')} htmlFor={fieldId('base-url')} hint={baseUrlHint || undefined}>
                      <input
                        id={fieldId('base-url')}
                        type="text"
                        className={formStyles.input}
                        placeholder={baseUrlPlaceholder}
                        value={s.editBaseUrl}
                        onChange={(event) => update({ editBaseUrl: event.target.value })}
                      />
                      {account.platform === 'grok' ? (
                        <GrokBaseUrlPresets onSelect={(url) => update({ editBaseUrl: url })} />
                      ) : null}
                      {cnApiKeyAccount && isCNProviderPlatform(account.platform) ? (
                        <CnBaseUrlPresets
                          platform={cnPresetPlatform}
                          mode={cnPresetMode}
                          protocol={s.editApiProtocol}
                          currentUrl={s.editBaseUrl}
                          onSelect={onCnPresetSelect}
                        />
                      ) : null}
                    </FormField>
                  ) : (
                    <FormField
                      label={t('admin.accounts.cnProviders.apiProtocol.endpoints')}
                      hint={
                        !cnSupportsNativeResponses(account.platform, currentMode)
                          ? t('admin.accounts.cnProviders.apiProtocol.responsesFallbackDesc')
                          : undefined
                      }
                    >
                      <div className={formStyles.stack}>
                        {adaptiveProtocolOptions.map((item) => (
                          <FormField
                            key={item.value}
                            label={t(`admin.accounts.cnProviders.apiProtocol.${item.labelKey}`)}
                            htmlFor={fieldId(`adaptive-${item.value}`)}
                          >
                            <input
                              id={fieldId(`adaptive-${item.value}`)}
                              type="text"
                              className={formStyles.input}
                              value={s.editAdaptiveBaseUrls[item.value]}
                              onChange={(event) =>
                                update({ editAdaptiveBaseUrls: { ...s.editAdaptiveBaseUrls, [item.value]: event.target.value } })
                              }
                            />
                          </FormField>
                        ))}
                      </div>
                    </FormField>
                  )}

                  {/* OpenCode Zen vs GO */}
                  {cnApiKeyAccount && account.platform === 'opencode_go' ? (
                    <FormField label={t('admin.accounts.cnProviders.accountMode.title')}>
                      <RadioCards
                        aria-label={t('admin.accounts.cnProviders.accountMode.title')}
                        value={s.editOpenCodeAccountMode}
                        onValueChange={(value) => update({ editOpenCodeAccountMode: value as OpenCodeAccountMode })}
                        options={[
                          {
                            value: 'zen',
                            label: t('admin.accounts.opencodeGo.accountMode.zen'),
                            description: t('admin.accounts.opencodeGo.accountMode.zenDesc'),
                            icon: <CreditCard size={16} strokeWidth={1.75} aria-hidden="true" />
                          },
                          {
                            value: 'go',
                            label: t('admin.accounts.opencodeGo.accountMode.go'),
                            description: t('admin.accounts.opencodeGo.accountMode.goDesc'),
                            icon: <Zap size={16} strokeWidth={1.75} aria-hidden="true" />
                          }
                        ]}
                      />
                    </FormField>
                  ) : null}

                  {/* Account Mode Selection (providers using the generic form) */}
                  {genericMultiProtocolAccount && genericAccountModes.length > 1 ? (
                    <FormField label={t('admin.accounts.cnProviders.accountMode.title')}>
                      <ChoiceButtons
                        testId="edit-generic-account-mode"
                        ariaLabel={t('admin.accounts.cnProviders.accountMode.title')}
                        options={genericAccountModes.map((mode) => ({ value: mode, label: providerModeLabel(mode, t) }))}
                        value={s.editAccountMode}
                        onSelect={(mode) => update({ editAccountMode: mode })}
                      />
                    </FormField>
                  ) : null}

                  {/* Account Mode Selection (CN providers) */}
                  {cnApiKeyAccount && isCNProviderPlatform(account.platform) ? (
                    <FormField
                      label={t('admin.accounts.cnProviders.accountMode.title')}
                      hint={t(`admin.accounts.cnProviders.accountMode.${s.editAccountMode}Desc`)}
                    >
                      <ChoiceButtons
                        ariaLabel={t('admin.accounts.cnProviders.accountMode.title')}
                        options={cnAccountModeOptions.map((opt) => ({
                          value: opt.value,
                          label: t(`admin.accounts.cnProviders.accountMode.${opt.labelKey}`)
                        }))}
                        value={s.editAccountMode}
                        onSelect={(mode) => update({ editAccountMode: mode })}
                      />
                    </FormField>
                  ) : null}

                  {/* API Protocol Selection (CN providers / OpenCode) */}
                  {cnApiKeyAccount ? (
                    <FormField
                      label={t('admin.accounts.cnProviders.apiProtocol.title')}
                      hint={t(`admin.accounts.cnProviders.apiProtocol.${cnProtocolDescKey}Desc`)}
                    >
                      <ChoiceButtons
                        ariaLabel={t('admin.accounts.cnProviders.apiProtocol.title')}
                        options={cnProtocolOptions.map((opt) => ({
                          value: opt.value,
                          label: t(`admin.accounts.cnProviders.apiProtocol.${opt.labelKey}`)
                        }))}
                        value={s.editApiProtocol}
                        onSelect={(protocol) => update({ editApiProtocol: protocol })}
                      />
                    </FormField>
                  ) : null}

                  {cnApiKeyAccount && providerRoutesByModel(account.platform) && s.editApiProtocol === 'adaptive' ? (
                    <OpenCodeGoProtocolRulesEditor
                      rows={s.editOpenCodeGoProtocolRules}
                      onChange={(rows) => update({ editOpenCodeGoProtocolRules: rows })}
                      platform={account.platform}
                      plan={currentMode}
                    />
                  ) : null}

                  {/* Zhipu 团队版 Coding Plan：组织/项目 ID（可选，填写后用量查询走团队版端点） */}
                  {account.platform === 'zhipu' && s.editAccountMode === 'coding' ? (
                    <FormField
                      label={t('admin.accounts.cnProviders.zhipuTeam.title')}
                      labelExtra={
                        <HelpTooltip trigger="click" width="20rem">
                          <p>{t('admin.accounts.cnProviders.zhipuTeam.help.title')}</p>
                          <ol className={styles.helpList}>
                            <li>{t('admin.accounts.cnProviders.zhipuTeam.help.step1')}</li>
                            <li>{t('admin.accounts.cnProviders.zhipuTeam.help.step2')}</li>
                            <li>{t('admin.accounts.cnProviders.zhipuTeam.help.step3')}</li>
                            <li>{t('admin.accounts.cnProviders.zhipuTeam.help.step4')}</li>
                          </ol>
                          <p className={styles.helpExample}>{t('admin.accounts.cnProviders.zhipuTeam.help.example')}</p>
                        </HelpTooltip>
                      }
                      hint={t('admin.accounts.cnProviders.zhipuTeam.hint')}
                    >
                      <div className={formStyles.grid2}>
                        <FormField label={t('admin.accounts.cnProviders.zhipuTeam.organization')} htmlFor={fieldId('zhipu-org')}>
                          <input
                            id={fieldId('zhipu-org')}
                            type="text"
                            className={formStyles.input}
                            placeholder={t('admin.accounts.cnProviders.zhipuTeam.organizationPlaceholder')}
                            value={s.editZhipuOrganization}
                            onChange={(event) => update({ editZhipuOrganization: event.target.value })}
                          />
                        </FormField>
                        <FormField label={t('admin.accounts.cnProviders.zhipuTeam.project')} htmlFor={fieldId('zhipu-project')}>
                          <input
                            id={fieldId('zhipu-project')}
                            type="text"
                            className={formStyles.input}
                            placeholder={t('admin.accounts.cnProviders.zhipuTeam.projectPlaceholder')}
                            value={s.editZhipuProject}
                            onChange={(event) => update({ editZhipuProject: event.target.value })}
                          />
                        </FormField>
                      </div>
                    </FormField>
                  ) : null}

                  <FormField label={t('admin.accounts.apiKey')} htmlFor={fieldId('api-key')} hint={t('admin.accounts.leaveEmptyToKeep')}>
                    <input
                      id={fieldId('api-key')}
                      type="password"
                      className={[formStyles.input, formStyles.mono].join(' ')}
                      autoComplete="new-password"
                      data-1p-ignore
                      data-lpignore="true"
                      data-bwignore="true"
                      placeholder={apiKeyPlaceholder}
                      value={s.editApiKey}
                      onChange={(event) => update({ editApiKey: event.target.value })}
                    />
                  </FormField>
                </FormSection>

                {/* Model Restriction Section (不适用于 Antigravity) */}
                {account.platform !== 'antigravity' ? (
                  <FormSection title={t('admin.accounts.modelRestriction')}>
                    {isOpenAIModelRestrictionDisabled ? (
                      <FormNotice tone="warning">
                        <p>{t('admin.accounts.openai.modelRestrictionDisabledByPassthrough')}</p>
                      </FormNotice>
                    ) : (
                      renderModelRestriction()
                    )}
                  </FormSection>
                ) : null}

                {/* Pool Mode Section */}
                <FormSection>
                  <PoolModeSection
                    enabled={s.poolModeEnabled}
                    onEnabledChange={(value) => update({ poolModeEnabled: value })}
                    retryCount={s.poolModeRetryCount}
                    onRetryCountChange={(value) => update({ poolModeRetryCount: value })}
                    retryStatusCodes={s.poolModeRetryStatusCodesInput}
                    onRetryStatusCodesChange={(value) => update({ poolModeRetryStatusCodesInput: value })}
                    defaultRetryCount={DEFAULT_POOL_MODE_RETRY_COUNT}
                    maxRetryCount={MAX_POOL_MODE_RETRY_COUNT}
                    defaultStatusCodes={DEFAULT_POOL_MODE_RETRY_STATUS_CODES}
                  />
                </FormSection>

                {/* Gemini 显式缓存上游开关：仅自定义地址的 Gemini API Key 账号 */}
                {account.platform === 'gemini' && !isOfficialGeminiBaseUrl(s.editBaseUrl) ? (
                  <FormSection>
                    <div data-testid="explicit-cache-upstream-section">
                      <SwitchRow
                        label={t('admin.accounts.explicitCacheUpstream')}
                        description={t('admin.accounts.explicitCacheUpstreamHint')}
                        checked={s.explicitCacheUpstreamEnabled}
                        onChange={(value) => update({ explicitCacheUpstreamEnabled: value })}
                        testId="explicit-cache-upstream-toggle"
                      >
                        {s.explicitCacheUpstreamEnabled ? (
                          <>
                            <FormNotice tone="info">
                              <p>{t('admin.accounts.explicitCacheUpstreamInfo')}</p>
                            </FormNotice>
                            <FormField
                              label={t('admin.accounts.explicitCacheUpstreamMaxTTL')}
                              htmlFor={fieldId('cache-ttl')}
                              hint={t('admin.accounts.explicitCacheUpstreamMaxTTLHint')}
                            >
                              <NumberInput
                                id={fieldId('cache-ttl')}
                                testId="explicit-cache-upstream-max-ttl"
                                value={s.explicitCacheUpstreamMaxTTL}
                                onChange={(value) => update({ explicitCacheUpstreamMaxTTL: value })}
                                min={1}
                                step={1}
                                placeholder="86400"
                              />
                            </FormField>
                          </>
                        ) : null}
                      </SwitchRow>
                    </div>
                  </FormSection>
                ) : null}

                {/* Custom Error Codes Section */}
                <FormSection>
                  <SwitchRow
                    label={t('admin.accounts.customErrorCodes')}
                    description={t('admin.accounts.customErrorCodesHint')}
                    checked={s.customErrorCodesEnabled}
                    onChange={(value) => update({ customErrorCodesEnabled: value })}
                  >
                    {s.customErrorCodesEnabled ? (
                      <>
                        <FormNotice tone="warning">
                          <p>{t('admin.accounts.customErrorCodesWarning')}</p>
                        </FormNotice>
                        {/* Error Code Buttons */}
                        <div className={formStyles.choiceGroup}>
                          {commonErrorCodes.map((code) => (
                            <button
                              key={code.value}
                              type="button"
                              className={formStyles.choice}
                              aria-pressed={s.selectedErrorCodes.includes(code.value)}
                              onClick={() => void toggleErrorCode(code.value)}
                            >
                              {code.value} {code.label}
                            </button>
                          ))}
                        </div>
                        {/* Manual input */}
                        <div className={formStyles.editRow}>
                          <NumberInput
                            value={s.customErrorCodeInput}
                            onChange={(value) => update({ customErrorCodeInput: value })}
                            min={100}
                            max={599}
                            placeholder={t('admin.accounts.enterErrorCode')}
                            aria-label={t('admin.accounts.enterErrorCode')}
                            onEnter={() => void addCustomErrorCode()}
                          />
                          <button
                            type="button"
                            className={formStyles.iconButton}
                            aria-label={t('admin.accounts.enterErrorCode')}
                            onClick={() => void addCustomErrorCode()}
                          >
                            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        </div>
                        {/* Selected codes summary */}
                        <div className={formStyles.chips}>
                          {[...s.selectedErrorCodes]
                            .sort((a, b) => a - b)
                            .map((code) => (
                              <span key={code} className={styles.errorChip}>
                                {code}
                                <button
                                  type="button"
                                  aria-label={t('common.delete')}
                                  onClick={() =>
                                    setS((prev) => ({
                                      ...prev,
                                      selectedErrorCodes: prev.selectedErrorCodes.filter((value) => value !== code)
                                    }))
                                  }
                                >
                                  <X size={12} strokeWidth={1.75} aria-hidden="true" />
                                </button>
                              </span>
                            ))}
                          {s.selectedErrorCodes.length === 0 ? (
                            <span className={formStyles.hint}>{t('admin.accounts.noneSelectedUsesDefault')}</span>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </SwitchRow>
                </FormSection>
              </>
            ) : null}

            {/* Grok OAuth client-tool prompt cache opt-in */}
            {account.platform === 'grok' && account.type === 'oauth' ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.grokClientToolCache.title')}
                  description={t('admin.accounts.grokClientToolCache.hint')}
                  checked={s.grokClientToolCacheEnabled}
                  onChange={(value) => update({ grokClientToolCacheEnabled: value })}
                  testId="grok-client-tool-cache-toggle"
                />
              </FormSection>
            ) : null}

            {/* Grok OAuth media generation eligibility override */}
            {grokOAuthAccount ? (
              <FormSection
                title={t('admin.accounts.grokMediaEligibility.title')}
                description={t('admin.accounts.grokMediaEligibility.hint')}
              >
                <div className={formStyles.stack} data-testid="grok-media-eligibility-card">
                  <Select
                    data-testid="grok-media-eligibility-mode"
                    aria-label={t('admin.accounts.grokMediaEligibility.title')}
                    value={grokMediaEligibilityMode}
                    disabled={grokMediaEligibilityLoading}
                    options={[
                      { value: 'auto', label: t('admin.accounts.grokMediaEligibility.auto') },
                      { value: 'enabled', label: t('admin.accounts.grokMediaEligibility.enabled') },
                      { value: 'disabled', label: t('admin.accounts.grokMediaEligibility.disabled') }
                    ]}
                    onChange={(value) => setGrokMediaEligibilityMode(value as GrokMediaEligibilityMode)}
                  />
                  {grokMediaEligibilityLoading ? (
                    <p className={formStyles.hint}>{t('admin.accounts.grokMediaEligibility.loading')}</p>
                  ) : grokMediaEligibilityError ? (
                    <p className={formStyles.error}>{grokMediaEligibilityError}</p>
                  ) : grokMediaEligibilityState ? (
                    <p className={styles.statusLine}>
                      <strong>{t('admin.accounts.grokMediaEligibility.current')}</strong>{' '}
                      <span data-testid="grok-media-eligibility-status">
                        {grokMediaEligibilityState.eligible
                          ? t('admin.accounts.grokMediaEligibility.eligible')
                          : t('admin.accounts.grokMediaEligibility.ineligible')}
                        {' · '}
                        {t(`admin.accounts.grokMediaEligibility.reasons.${grokMediaEligibilityState.reason}`)}
                      </span>
                    </p>
                  ) : null}
                  {grokMediaEligibilityMode === 'enabled' ? (
                    <FormNotice tone="warning">
                      <p>{t('admin.accounts.grokMediaEligibility.forceEnableWarning')}</p>
                    </FormNotice>
                  ) : grokMediaEligibilityMode === 'auto' ? (
                    <p className={formStyles.hint}>{t('admin.accounts.grokMediaEligibility.autoHint')}</p>
                  ) : null}
                </div>
              </FormSection>
            ) : null}

            {/* Grok OAuth Custom Upstream URL (仅改写转发端点，OAuth 授权/刷新不受影响) */}
            {account.platform === 'grok' && account.type === 'oauth' ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.grokCustomBaseUrl.title')}
                  description={t('admin.accounts.grokCustomBaseUrl.hint')}
                  checked={s.grokOAuthCustomBaseUrlEnabled}
                  onChange={(value) => update({ grokOAuthCustomBaseUrlEnabled: value })}
                  testId="grok-custom-base-url-toggle"
                >
                  {s.grokOAuthCustomBaseUrlEnabled ? (
                    <>
                      <input
                        type="text"
                        className={formStyles.input}
                        data-testid="grok-custom-base-url-input"
                        aria-label={t('admin.accounts.grokCustomBaseUrl.title')}
                        placeholder={t('admin.accounts.grokCustomBaseUrl.placeholder')}
                        value={s.grokOAuthBaseUrl}
                        onChange={(event) => update({ grokOAuthBaseUrl: event.target.value })}
                      />
                      <GrokBaseUrlPresets onSelect={(url) => update({ grokOAuthBaseUrl: url })} />
                    </>
                  ) : null}
                </SwitchRow>
              </FormSection>
            ) : null}

            {/* Header Override Section (eligible API-key platforms + grok OAuth) */}
            {headerOverrideCapable ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.headerOverride.title')}
                  description={t('admin.accounts.headerOverride.hint')}
                  checked={s.headerOverrideEnabled}
                  onChange={(value) => update({ headerOverrideEnabled: value })}
                >
                  {s.headerOverrideEnabled ? (
                    <>
                      <FormNotice tone="info">
                        <p>{t('admin.accounts.headerOverride.info')}</p>
                      </FormNotice>
                      <HeaderOverrideEditor rows={s.headerOverrideRows} onChange={(rows) => update({ headerOverrideRows: rows })} />
                    </>
                  ) : null}
                </SwitchRow>
              </FormSection>
            ) : null}

            {/* OpenAI/Grok OAuth Model Mapping (OAuth 类型没有 apikey 容器，需要独立的模型映射区域) */}
            {(account.platform === 'openai' || account.platform === 'grok') && account.type === 'oauth' ? (
              <FormSection title={t('admin.accounts.modelRestriction')}>
                {isOpenAIModelRestrictionDisabled ? (
                  <FormNotice tone="warning">
                    <p>{t('admin.accounts.openai.modelRestrictionDisabledByPassthrough')}</p>
                  </FormNotice>
                ) : (
                  renderModelRestriction('default', 'edit-oauth-model-mapping')
                )}
              </FormSection>
            ) : null}

            {/* Upstream fields (only for upstream type) */}
            {account.type === 'upstream' ? (
              <FormSection>
                <FormField
                  label={t('admin.accounts.upstream.baseUrl')}
                  htmlFor={fieldId('upstream-base-url')}
                  hint={t('admin.accounts.upstream.baseUrlHint')}
                >
                  <input
                    id={fieldId('upstream-base-url')}
                    type="text"
                    className={formStyles.input}
                    placeholder="https://cloudcode-pa.googleapis.com"
                    value={s.editBaseUrl}
                    onChange={(event) => update({ editBaseUrl: event.target.value })}
                  />
                </FormField>
                <FormField
                  label={t('admin.accounts.upstream.apiKey')}
                  htmlFor={fieldId('upstream-api-key')}
                  hint={t('admin.accounts.leaveEmptyToKeep')}
                >
                  <input
                    id={fieldId('upstream-api-key')}
                    type="password"
                    className={[formStyles.input, formStyles.mono].join(' ')}
                    placeholder="sk-..."
                    value={s.editApiKey}
                    onChange={(event) => update({ editApiKey: event.target.value })}
                  />
                </FormField>
              </FormSection>
            ) : null}

            {/* Vertex Service Account */}
            {(account.platform === 'gemini' || account.platform === 'anthropic') && account.type === 'service_account' ? (
              <>
                <FormSection>
                  {vertexAPIKeyMode ? (
                    <FormField label="API Key" htmlFor={fieldId('vertex-api-key')} hint={t('admin.accounts.vertexApiKeyHint')}>
                      <input
                        id={fieldId('vertex-api-key')}
                        type="password"
                        className={[formStyles.input, formStyles.mono].join(' ')}
                        data-testid="edit-vertex-api-key-input"
                        placeholder={t('admin.accounts.leaveEmptyToKeep')}
                        value={s.editVertexApiKey}
                        onChange={(event) => update({ editVertexApiKey: event.target.value })}
                      />
                    </FormField>
                  ) : null}
                  <div className={formStyles.grid2}>
                    {vertexAPIKeyMode ? (
                      <FormField
                        label="Project ID"
                        htmlFor={fieldId('vertex-project')}
                        hint={t('admin.accounts.vertexApiKeyProjectIdHint')}
                      >
                        <input
                          id={fieldId('vertex-project')}
                          type="text"
                          className={[formStyles.input, formStyles.mono].join(' ')}
                          data-testid="edit-vertex-api-key-project-id-input"
                          placeholder={t('admin.accounts.vertexApiKeyProjectIdPlaceholder')}
                          value={s.editVertexProjectId}
                          onChange={(event) => update({ editVertexProjectId: event.target.value })}
                        />
                      </FormField>
                    ) : (
                      <FormField label="Project ID" htmlFor={fieldId('vertex-project')} hint={t('admin.accounts.vertexSaJsonEditHint')}>
                        <input
                          id={fieldId('vertex-project')}
                          type="text"
                          readOnly
                          className={[formStyles.input, formStyles.mono].join(' ')}
                          placeholder={t('admin.accounts.vertexProjectIdPlaceholder')}
                          value={s.editVertexProjectId}
                        />
                      </FormField>
                    )}
                    {!vertexAPIKeyMode || s.editVertexProjectId.trim() ? (
                      <FormField label="Location" hint={t('admin.accounts.vertexLocationHint')}>
                        <Select
                          aria-label="Location"
                          value={s.editVertexLocation}
                          options={vertexLocationOptions}
                          searchable
                          onChange={(value) => update({ editVertexLocation: String(value ?? '') })}
                        />
                      </FormField>
                    ) : null}
                  </div>
                </FormSection>

                {/* Model Restriction Section for Service Account */}
                <FormSection title={t('admin.accounts.modelRestriction')}>{renderModelRestriction()}</FormSection>
              </>
            ) : null}

            {/* Bedrock fields (for bedrock type, both SigV4 and API Key modes) */}
            {account.type === 'bedrock' ? (
              <>
                <FormSection>
                  {/* SigV4 fields */}
                  {!bedrockAPIKeyMode ? (
                    <>
                      <FormField label={t('admin.accounts.bedrockAccessKeyId')} htmlFor={fieldId('bedrock-ak')}>
                        <input
                          id={fieldId('bedrock-ak')}
                          type="text"
                          className={[formStyles.input, formStyles.mono].join(' ')}
                          placeholder="AKIA..."
                          value={s.editBedrockAccessKeyId}
                          onChange={(event) => update({ editBedrockAccessKeyId: event.target.value })}
                        />
                      </FormField>
                      <FormField
                        label={t('admin.accounts.bedrockSecretAccessKey')}
                        htmlFor={fieldId('bedrock-sk')}
                        hint={t('admin.accounts.bedrockSecretKeyLeaveEmpty')}
                      >
                        <input
                          id={fieldId('bedrock-sk')}
                          type="password"
                          className={[formStyles.input, formStyles.mono].join(' ')}
                          placeholder={t('admin.accounts.bedrockSecretKeyLeaveEmpty')}
                          value={s.editBedrockSecretAccessKey}
                          onChange={(event) => update({ editBedrockSecretAccessKey: event.target.value })}
                        />
                      </FormField>
                      <FormField
                        label={t('admin.accounts.bedrockSessionToken')}
                        htmlFor={fieldId('bedrock-token')}
                        hint={t('admin.accounts.bedrockSessionTokenHint')}
                      >
                        <input
                          id={fieldId('bedrock-token')}
                          type="password"
                          className={[formStyles.input, formStyles.mono].join(' ')}
                          placeholder={t('admin.accounts.bedrockSecretKeyLeaveEmpty')}
                          value={s.editBedrockSessionToken}
                          onChange={(event) => update({ editBedrockSessionToken: event.target.value })}
                        />
                      </FormField>
                    </>
                  ) : null}

                  {/* API Key field */}
                  {bedrockAPIKeyMode ? (
                    <FormField
                      label={t('admin.accounts.bedrockApiKeyInput')}
                      htmlFor={fieldId('bedrock-api-key')}
                      hint={t('admin.accounts.bedrockApiKeyLeaveEmpty')}
                    >
                      <input
                        id={fieldId('bedrock-api-key')}
                        type="password"
                        className={[formStyles.input, formStyles.mono].join(' ')}
                        placeholder={t('admin.accounts.bedrockApiKeyLeaveEmpty')}
                        value={s.editBedrockApiKeyValue}
                        onChange={(event) => update({ editBedrockApiKeyValue: event.target.value })}
                      />
                    </FormField>
                  ) : null}

                  {/* Shared: Region */}
                  <FormField
                    label={t('admin.accounts.bedrockRegion')}
                    htmlFor={fieldId('bedrock-region')}
                    hint={t('admin.accounts.bedrockRegionHint')}
                  >
                    <input
                      id={fieldId('bedrock-region')}
                      type="text"
                      className={formStyles.input}
                      placeholder="us-east-1"
                      value={s.editBedrockRegion}
                      onChange={(event) => update({ editBedrockRegion: event.target.value })}
                    />
                  </FormField>

                  {/* Shared: Force Global */}
                  <div className={formStyles.stackTight}>
                    <Checkbox
                      label={t('admin.accounts.bedrockForceGlobal')}
                      checked={s.editBedrockForceGlobal}
                      onCheckedChange={(checked) => update({ editBedrockForceGlobal: checked === true })}
                    />
                    <p className={formStyles.hint}>{t('admin.accounts.bedrockForceGlobalHint')}</p>
                  </div>
                </FormSection>

                {/* Model Restriction for Bedrock */}
                <FormSection title={t('admin.accounts.modelRestriction')}>
                  {renderModelRestriction('bedrock', 'edit-bedrock-model-mapping')}
                </FormSection>

                {/* Pool Mode Section for Bedrock */}
                <FormSection>
                  <PoolModeSection
                    enabled={s.poolModeEnabled}
                    onEnabledChange={(value) => update({ poolModeEnabled: value })}
                    retryCount={s.poolModeRetryCount}
                    onRetryCountChange={(value) => update({ poolModeRetryCount: value })}
                    retryStatusCodes={s.poolModeRetryStatusCodesInput}
                    onRetryStatusCodesChange={(value) => update({ poolModeRetryStatusCodesInput: value })}
                    defaultRetryCount={DEFAULT_POOL_MODE_RETRY_COUNT}
                    maxRetryCount={MAX_POOL_MODE_RETRY_COUNT}
                    defaultStatusCodes={DEFAULT_POOL_MODE_RETRY_STATUS_CODES}
                  />
                </FormSection>
              </>
            ) : null}

            {account.platform === 'antigravity' && account.type === 'oauth' ? (
              <FormSection>
                <FormField
                  label={t('admin.accounts.antigravityProjectIdLabel')}
                  htmlFor={fieldId('antigravity-project')}
                  hint={t('admin.accounts.antigravityProjectIdHint')}
                >
                  <input
                    id={fieldId('antigravity-project')}
                    data-testid="antigravity-project-id-input"
                    type="text"
                    className={[formStyles.input, formStyles.mono].join(' ')}
                    placeholder={t('admin.accounts.antigravityProjectIdPlaceholder')}
                    value={s.antigravityProjectId}
                    onChange={(event) => update({ antigravityProjectId: event.target.value })}
                  />
                </FormField>
              </FormSection>
            ) : null}

            {/* Antigravity model restriction (applies to all antigravity types) */}
            {/* Antigravity 只支持模型映射模式，不支持白名单模式 */}
            {account.platform === 'antigravity' ? (
              <FormSection title={t('admin.accounts.modelRestriction')}>
                <FormNotice tone="info">
                  <p>{t('admin.accounts.mapRequestModels')}</p>
                </FormNotice>
                <div className={formStyles.row}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isSyncingAntigravityUpstream || !account.id}
                    onClick={() => void syncAntigravityUpstreamModels()}
                  >
                    {isSyncingAntigravityUpstream
                      ? t('admin.accounts.syncUpstreamModelsLoading')
                      : t('admin.accounts.syncUpstreamModels')}
                  </Button>
                </div>
                <MappingRowsEditor
                  rows={s.antigravityModelMappings}
                  onChange={(rows) => update({ antigravityModelMappings: rows })}
                  keyPrefix="edit-antigravity-model-mapping"
                  fromPlaceholder={t('admin.accounts.requestModel')}
                  toPlaceholder={t('admin.accounts.actualModel')}
                  validateWildcard={isValidWildcardPattern}
                />
                <AddRowButton
                  label={t('admin.accounts.addMapping')}
                  onClick={() => update({ antigravityModelMappings: [...s.antigravityModelMappings, { from: '', to: '' }] })}
                />
                <PresetMappingButtons presets={antigravityPresetMappings} onSelect={addAntigravityPresetMapping} />
              </FormSection>
            ) : null}

            {/* Temp Unschedulable Rules */}
            <FormSection>
              <TempUnschedRulesEditor
                enabled={s.tempUnschedEnabled}
                onEnabledChange={(value) => update({ tempUnschedEnabled: value })}
                rules={s.tempUnschedRules}
                onRulesChange={(rules) => update({ tempUnschedRules: rules })}
              />
            </FormSection>

            {supportsAccountSchedulingThresholdOverride ? (
              <FormSection>
                <div className={formStyles.stack} data-testid="account-scheduling-threshold-section">
                  <div className={formStyles.toggleHead}>
                    <div className={formStyles.toggleText}>
                      <span className={formStyles.label}>{t('admin.accounts.accountSchedulingThresholdOverride')}</span>
                      <p className={formStyles.hint}>{t('admin.accounts.accountSchedulingThresholdOverrideHint')}</p>
                    </div>
                    <Checkbox
                      data-testid="account-scheduling-threshold-override-enabled"
                      aria-label={t('admin.accounts.accountSchedulingThresholdOverride')}
                      checked={s.accountSchedulingThresholdOverrideEnabled}
                      onCheckedChange={(checked) => update({ accountSchedulingThresholdOverrideEnabled: checked === true })}
                    />
                  </div>
                  {s.accountSchedulingThresholdOverrideEnabled ? (
                    <FormField
                      label={t('admin.accounts.accountSchedulingThresholdOverrideValue')}
                      htmlFor={fieldId('threshold-value')}
                      hint={t('admin.accounts.accountSchedulingThresholdOverrideDisabledHint')}
                    >
                      <NumberInput
                        id={fieldId('threshold-value')}
                        testId="account-scheduling-threshold-override-value"
                        value={s.accountSchedulingThresholdOverrideValue}
                        onChange={(value) => update({ accountSchedulingThresholdOverrideValue: value })}
                        min={1}
                        max={100}
                      />
                    </FormField>
                  ) : null}
                </div>
              </FormSection>
            ) : null}

            {/* Intercept Warmup Requests (Anthropic/Antigravity) */}
            {account.platform === 'anthropic' || account.platform === 'antigravity' ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.interceptWarmupRequests')}
                  description={t('admin.accounts.interceptWarmupRequestsDesc')}
                  checked={s.interceptWarmupRequests}
                  onChange={(value) => update({ interceptWarmupRequests: value })}
                />
              </FormSection>
            ) : null}

            <FormSection>
              {!isSparkShadow ? (
                <FormField label={t('admin.accounts.proxy')} labelExtra={<ProxyAdBanner />}>
                  <ProxySelector value={s.form.proxy_id} onChange={(value) => updateForm({ proxy_id: value })} proxies={proxies} />
                </FormField>
              ) : null}

              <UpstreamRequestIdHeaderField
                value={s.upstreamRequestIdHeader}
                onChange={(value) => update({ upstreamRequestIdHeader: value })}
                platform={account.platform}
                type={account.type}
              />

              <div className={formStyles.grid3}>
                <FormField label={t('admin.accounts.concurrency')} htmlFor={fieldId('concurrency')}>
                  <input
                    id={fieldId('concurrency')}
                    type="number"
                    min={1}
                    className={formStyles.input}
                    value={s.form.concurrency}
                    onChange={(event) => {
                      const value = parseFloat(event.target.value)
                      updateForm({ concurrency: Math.max(1, (Number.isNaN(value) ? 0 : value) || 1) })
                    }}
                  />
                </FormField>
                <FormField label={t('admin.accounts.loadFactor')} htmlFor={fieldId('load-factor')} hint={t('admin.accounts.loadFactorHint')}>
                  <input
                    id={fieldId('load-factor')}
                    type="number"
                    min={1}
                    className={formStyles.input}
                    placeholder={String(s.form.concurrency || 1)}
                    value={s.form.load_factor ?? ''}
                    onChange={(event) => {
                      const value = parseFloat(event.target.value)
                      updateForm({ load_factor: !Number.isNaN(value) && value >= 1 ? value : null })
                    }}
                  />
                </FormField>
                <FormField
                  label={t('admin.accounts.billingRateMultiplier')}
                  htmlFor={fieldId('rate-multiplier')}
                  hint={t(
                    s.upstreamBillingRateSyncEnabled
                      ? 'admin.accounts.upstreamBilling.syncRateManagedHint'
                      : 'admin.accounts.billingRateMultiplierHint'
                  )}
                >
                  <NumberInput
                    id={fieldId('rate-multiplier')}
                    testId="account-rate-multiplier"
                    value={s.form.rate_multiplier}
                    onChange={(value) => updateForm({ rate_multiplier: value })}
                    min={0}
                    step={0.001}
                    disabled={s.upstreamBillingRateSyncEnabled}
                  />
                </FormField>
              </div>
              {account.type === 'apikey' ? (
                <SwitchRow
                  label={t('admin.accounts.upstreamBilling.syncRate')}
                  description={t('admin.accounts.upstreamBilling.syncRateHint')}
                  checked={s.upstreamBillingRateSyncEnabled}
                  onChange={handleUpstreamBillingRateSyncChange}
                  testId="upstream-billing-rate-sync"
                />
              ) : null}
            </FormSection>

            <FormSection>
              <FormField
                label={t('admin.accounts.expiresAt')}
                htmlFor={fieldId('expires-at')}
                hint={`${t('admin.accounts.expiresAtHint')} ${t('admin.accounts.expiresAtTimezoneHint', { timezone: browserTimeZone })}`}
              >
                <input
                  id={fieldId('expires-at')}
                  type="datetime-local"
                  className={formStyles.input}
                  value={formatDateTimeLocalInput(s.form.expires_at)}
                  onChange={(event) => updateForm({ expires_at: parseDateTimeLocalInput(event.target.value) })}
                />
                <div className={formStyles.row}>
                  <Button type="button" variant="secondary" size="sm" onClick={() => updateForm({ expires_at: getAccountExpiryTimestamp(1) })}>
                    {t('payment.oneMonth')}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => updateForm({ expires_at: getAccountExpiryTimestamp(12) })}>
                    {t('payment.oneYear')}
                  </Button>
                </div>
              </FormField>
            </FormSection>

            {/* OpenAI 自动透传开关（OAuth/API Key） */}
            {isOpenAIType(account) ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.openai.oauthPassthrough')}
                  description={t('admin.accounts.openai.oauthPassthroughDesc')}
                  checked={s.openaiPassthroughEnabled}
                  onChange={(value) => update({ openaiPassthroughEnabled: value })}
                />
              </FormSection>
            ) : null}

            {/* OpenAI Codex namespace 工具摊平（兼容开关，仅 OAuth） */}
            {account.platform === 'openai' && account.type === 'oauth' ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.openai.flattenNamespaces')}
                  description={t('admin.accounts.openai.flattenNamespacesDesc')}
                  checked={s.openaiFlattenNamespacesEnabled}
                  onChange={(value) => update({ openaiFlattenNamespacesEnabled: value })}
                  testId="edit-openai-flatten-namespaces-toggle"
                />
              </FormSection>
            ) : null}

            {/* OpenAI Codex hosted image_generation bridge policy */}
            {isOpenAIType(account) ? (
              <FormSection
                title={
                  <span className={formStyles.row}>
                    <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
                    {t('admin.accounts.openai.codexImageTool')}
                    <Badge tone={codexImageToolBadge.tone} size="sm">
                      {codexImageToolBadge.label}
                    </Badge>
                  </span>
                }
                description={t('admin.accounts.openai.codexImageToolDesc')}
              >
                <RadioCards
                  aria-label={t('admin.accounts.openai.codexImageTool')}
                  data-testid="codex-image-tool"
                  options={codexImageToolOptions}
                  value={s.codexImageToolMode}
                  onValueChange={(value) => update({ codexImageToolMode: value as CodexImageToolMode })}
                  minColumnWidth={220}
                />
              </FormSection>
            ) : null}

            {/* OpenAI WS Mode 三态（off/ctx_pool/passthrough） */}
            {isOpenAIType(account) ? (
              <FormSection>
                <div className={formStyles.toggleHead}>
                  <div className={formStyles.toggleText}>
                    <span className={formStyles.label}>{t('admin.accounts.openai.wsMode')}</span>
                    <p className={formStyles.hint}>{t('admin.accounts.openai.wsModeDesc')}</p>
                    {openAIWSModeHintKey ? <p className={formStyles.hint}>{t(openAIWSModeHintKey)}</p> : null}
                  </div>
                  <div className={styles.inlineSelect}>
                    <Select
                      data-testid="edit-openai-ws-mode-select"
                      aria-label={t('admin.accounts.openai.wsMode')}
                      value={openaiResponsesWebSocketV2Mode}
                      options={openAIWSModeOptions}
                      onChange={(value) => setOpenaiResponsesWebSocketV2Mode(value as OpenAIWSMode)}
                    />
                  </div>
                </div>
              </FormSection>
            ) : null}

            {/* OpenAI APIKey Responses API support mode */}
            {account.platform === 'openai' && account.type === 'apikey' ? (
              <FormSection>
                <div className={formStyles.toggleHead}>
                  <div className={formStyles.toggleText}>
                    <span className={formStyles.label}>{t('admin.accounts.openai.responsesMode')}</span>
                    <p className={formStyles.hint}>{t('admin.accounts.openai.responsesModeDesc')}</p>
                  </div>
                  <div className={styles.inlineSelect}>
                    <Select
                      data-testid="openai-responses-mode-select"
                      aria-label={t('admin.accounts.openai.responsesMode')}
                      value={s.openAIResponsesMode}
                      options={openAIResponsesModeOptions}
                      disabled={!openAITextGenerationCapabilityEnabled}
                      onChange={(value) => update({ openAIResponsesMode: value as OpenAIResponsesMode })}
                    />
                  </div>
                </div>
                {openAITextGenerationCapabilityEnabled ? (
                  <p className={styles.statusLine}>
                    <strong>{t(openAIResponsesStatusKey)}</strong>
                  </p>
                ) : (
                  <div data-testid="openai-responses-mode-not-applicable">
                    <FormNotice tone="warning">
                      <p>{t('admin.accounts.openai.responsesModeTextDisabledHint')}</p>
                    </FormNotice>
                  </div>
                )}
                <FormField label={t('admin.accounts.openai.endpointCapabilities')} hint={t('admin.accounts.openai.endpointCapabilitiesDesc')}>
                  <div className={styles.checkGrid}>
                    {openAIEndpointCapabilityOptions.map((option) => (
                      <Checkbox
                        key={option.value}
                        data-testid={`openai-endpoint-capability-${option.value}`}
                        label={option.label}
                        checked={s.openAIEndpointCapabilities.includes(option.value)}
                        onCheckedChange={() => toggleOpenAIEndpointCapability(option.value)}
                      />
                    ))}
                  </div>
                </FormField>
              </FormSection>
            ) : null}

            {/* OpenAI APIKey images: backfill b64_json from url */}
            {account.platform === 'openai' && account.type === 'apikey' ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.openai.imagesUrlToB64Json')}
                  description={t('admin.accounts.openai.imagesUrlToB64JsonDesc')}
                  checked={s.openAIImagesUrlToB64JsonEnabled}
                  onChange={(value) => update({ openAIImagesUrlToB64JsonEnabled: value })}
                  testId="openai-images-url-to-b64-json-toggle"
                />
              </FormSection>
            ) : null}

            {account.type === 'apikey' ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.upstreamBilling.autoProbe')}
                  description={t('admin.accounts.upstreamBilling.autoProbeHint')}
                  checked={s.upstreamBillingAutoProbeEnabled}
                  onChange={handleUpstreamBillingAutoProbeChange}
                  testId="upstream-billing-auto-probe"
                />
              </FormSection>
            ) : null}

            {account.ollama_cloud_usage?.eligible ? (
              <FormSection>
                <OllamaCloudUsageSettings account={account} onUpdated={handleOllamaCloudUsageUpdated} />
              </FormSection>
            ) : null}

            {account.opencode_go_usage?.eligible ? (
              <FormSection>
                <OpenCodeGoUsagePanel
                  state={opencodeGoState}
                  loading={opencodeGoLoading}
                  saving={opencodeGoSaving}
                  refreshing={opencodeGoRefreshing}
                  onRefresh={() => void refreshOpenCodeGoUsage()}
                  onAutoRefreshChange={(enabled) => void setOpenCodeGoAutoRefresh(enabled)}
                />
              </FormSection>
            ) : null}

            {/* Anthropic API Key 自动透传开关 */}
            {account.platform === 'anthropic' && account.type === 'apikey' ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.anthropic.apiKeyPassthrough')}
                  description={t('admin.accounts.anthropic.apiKeyPassthroughDesc')}
                  checked={s.anthropicPassthroughEnabled}
                  onChange={(value) => update({ anthropicPassthroughEnabled: value })}
                />
                <div className={formStyles.toggleHead}>
                  <div className={formStyles.toggleText}>
                    <span className={formStyles.label}>{t('admin.accounts.anthropic.apiKeyAuthScheme')}</span>
                    <p className={formStyles.hint}>{t('admin.accounts.anthropic.apiKeyAuthSchemeDesc')}</p>
                  </div>
                  <div className={styles.inlineSelect}>
                    <Select
                      aria-label={t('admin.accounts.anthropic.apiKeyAuthScheme')}
                      value={s.anthropicAPIKeyAuthScheme}
                      options={[
                        { value: 'x_api_key', label: t('admin.accounts.anthropic.apiKeyAuthSchemeXApiKey') },
                        { value: 'authorization_bearer', label: t('admin.accounts.anthropic.apiKeyAuthSchemeBearer') }
                      ]}
                      onChange={(value) => update({ anthropicAPIKeyAuthScheme: value as AnthropicAPIKeyAuthScheme })}
                    />
                  </div>
                </div>
              </FormSection>
            ) : null}

            {/* Anthropic / OpenAI API Key: Web Search Emulation (hidden when global disabled) */}
            {(account.platform === 'anthropic' || account.platform === 'openai') &&
            account.type === 'apikey' &&
            webSearchGlobalEnabled ? (
              <FormSection>
                <div className={formStyles.toggleHead}>
                  <div className={formStyles.toggleText}>
                    <span className={formStyles.label}>{t('admin.accounts.anthropic.webSearchEmulation')}</span>
                    <p className={formStyles.hint}>{t('admin.accounts.anthropic.webSearchEmulationDesc')}</p>
                  </div>
                  <div className={styles.inlineSelect}>
                    <Select
                      aria-label={t('admin.accounts.anthropic.webSearchEmulation')}
                      value={s.webSearchEmulationMode}
                      options={[
                        { value: 'default', label: t('admin.accounts.anthropic.webSearchDefault') },
                        { value: 'enabled', label: t('admin.accounts.anthropic.webSearchEnabled') },
                        { value: 'disabled', label: t('admin.accounts.anthropic.webSearchDisabled') }
                      ]}
                      onChange={(value) => update({ webSearchEmulationMode: String(value) })}
                    />
                  </div>
                </div>
              </FormSection>
            ) : null}

            {/* 配额控制 (Anthropic apikey/bedrock: 配额限制 + 亲和) / (非 Anthropic apikey/bedrock，以及 Vertex service_account) */}
            {(account.platform === 'anthropic' && (account.type === 'apikey' || account.type === 'bedrock')) ||
            supportsAccountQuota(account.type) ? (
              <FormSection
                title={t('admin.accounts.quotaControl.title')}
                description={
                  account.platform === 'anthropic' && (account.type === 'apikey' || account.type === 'bedrock')
                    ? t('admin.accounts.quotaControl.hint')
                    : t('admin.accounts.quotaLimitHint')
                }
              >
                <div data-testid="quota-limit-card">
                  <QuotaLimitCard
                    {...quotaValues}
                    quotaNotifyGlobalEnabled={quotaNotify.globalEnabled}
                    onUpdate={handleQuotaUpdate}
                  />
                </div>
              </FormSection>
            ) : null}

            {/* OpenAI API 长上下文计费开关 */}
            {isOpenAIType(account) && !isSparkShadow && !hideAccountLongContextBilling ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.openai.longContextBilling')}
                  description={t('admin.accounts.openai.longContextBillingDesc')}
                  checked={s.openAILongContextBillingEnabled}
                  onChange={(value) => update({ openAILongContextBillingEnabled: value })}
                  testId="openai-long-context-billing-toggle"
                />
              </FormSection>
            ) : null}

            {account.platform === 'openai' && (account.type === 'oauth' || account.type === 'setup-token') ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.openai.codexCLIOnly')}
                  description={t('admin.accounts.openai.codexCLIOnlyDesc')}
                  checked={s.codexCLIOnlyEnabled}
                  onChange={(value) => update({ codexCLIOnlyEnabled: value })}
                >
                  {s.codexCLIOnlyEnabled ? (
                    <SwitchRow
                      label={t('admin.accounts.openai.codexCLIOnlyAppServer')}
                      description={t('admin.accounts.openai.codexCLIOnlyAppServerDesc')}
                      checked={s.codexCLIOnlyAppServerEnabled}
                      onChange={(value) => update({ codexCLIOnlyAppServerEnabled: value })}
                    />
                  ) : null}
                </SwitchRow>
              </FormSection>
            ) : null}

            {/* Codex 指纹收敛模式（仅 OpenAI OAuth） */}
            {account.platform === 'openai' && account.type === 'oauth' ? (
              <FormSection>
                <div className={formStyles.toggleHead}>
                  <div className={formStyles.toggleText}>
                    <span className={formStyles.label}>{t('admin.accounts.openai.codexFingerprintMode')}</span>
                    <p className={formStyles.hint}>{t('admin.accounts.openai.codexFingerprintModeDesc')}</p>
                  </div>
                  <div className={styles.inlineSelect}>
                    <Select
                      data-testid="edit-codex-fingerprint-mode-select"
                      aria-label={t('admin.accounts.openai.codexFingerprintMode')}
                      value={s.codexFingerprintMode}
                      options={codexFingerprintModeOptions}
                      onChange={(value) => update({ codexFingerprintMode: value as CodexFingerprintMode })}
                    />
                  </div>
                </div>
              </FormSection>
            ) : null}

            {/* OpenAI 订阅档位手动覆盖（Plus/Pro/Free），仅 OAuth 非影子账号 */}
            {account.platform === 'openai' && account.type === 'oauth' && !isSparkShadow ? (
              <FormSection>
                <div className={formStyles.toggleHead}>
                  <div className={formStyles.toggleText}>
                    <span className={formStyles.label}>{t('admin.accounts.openai.planType')}</span>
                    <p className={formStyles.hint}>{t('admin.accounts.openai.planTypeDesc')}</p>
                  </div>
                  <div className={styles.inlineSelect}>
                    <Select
                      aria-label={t('admin.accounts.openai.planType')}
                      value={s.editPlanType}
                      options={planTypeOptions}
                      onChange={(value) => update({ editPlanType: String(value ?? '') })}
                    />
                  </div>
                </div>
              </FormSection>
            ) : null}

            {isOpenAIType(account) ? (
              <FormSection>
                <div className={formStyles.toggleHead}>
                  <div className={formStyles.toggleText}>
                    <span className={formStyles.label}>{t('admin.accounts.openai.compactMode')}</span>
                    <p className={formStyles.hint}>{t('admin.accounts.openai.compactModeDesc')}</p>
                  </div>
                  <div className={styles.inlineSelect}>
                    <Select
                      aria-label={t('admin.accounts.openai.compactMode')}
                      value={s.openAICompactMode}
                      options={openAICompactModeOptions}
                      onChange={(value) => update({ openAICompactMode: value as OpenAICompactMode })}
                    />
                  </div>
                </div>
                <p className={styles.statusLine}>
                  <strong>{t(openAICompactStatusKey)}</strong>
                  {accountExtra?.openai_compact_checked_at ? (
                    <span>
                      {t('admin.accounts.openai.compactLastChecked')}:{' '}
                      {formatDateTime(new Date(String(accountExtra.openai_compact_checked_at)))}
                    </span>
                  ) : null}
                </p>
                <FormField label={t('admin.accounts.openai.compactModelMapping')} hint={t('admin.accounts.openai.compactModelMappingDesc')}>
                  <MappingRowsEditor
                    rows={s.openAICompactModelMappings}
                    onChange={(rows) => update({ openAICompactModelMappings: rows })}
                    keyPrefix="edit-openai-compact-model-mapping"
                    fromPlaceholder={t('admin.accounts.fromModel')}
                    toPlaceholder={t('admin.accounts.toModel')}
                  />
                  <AddRowButton
                    label={t('admin.accounts.addMapping')}
                    onClick={() => update({ openAICompactModelMappings: [...s.openAICompactModelMappings, { from: '', to: '' }] })}
                  />
                </FormField>
              </FormSection>
            ) : null}

            <FormSection>
              <SwitchRow
                label={t('admin.accounts.autoPauseOnExpired')}
                description={t('admin.accounts.autoPauseOnExpiredDesc')}
                checked={s.autoPauseOnExpired}
                onChange={(value) => update({ autoPauseOnExpired: value })}
              />
            </FormSection>

            {account.platform === 'openai' ? (
              <FormSection>
                <SwitchRow
                  label={t('admin.accounts.autoPause5hDisabled')}
                  description={t('admin.accounts.autoPauseDisabledHint')}
                  checked={s.autoPause5hDisabled}
                  onChange={(value) => update({ autoPause5hDisabled: value })}
                  testId="auto-pause-5h-disabled"
                />
                <FormField
                  label={t('admin.accounts.autoPause5hThreshold')}
                  htmlFor={fieldId('auto-pause-5h')}
                  hint={t('admin.accounts.autoPauseThresholdHint')}
                >
                  <NumberInput
                    id={fieldId('auto-pause-5h')}
                    testId="auto-pause-5h-threshold"
                    value={s.autoPause5hThreshold}
                    onChange={(value) => update({ autoPause5hThreshold: value })}
                    min={0}
                    max={100}
                    step={0.1}
                    disabled={s.autoPause5hDisabled}
                  />
                </FormField>
                <SwitchRow
                  label={t('admin.accounts.autoPause7dDisabled')}
                  description={t('admin.accounts.autoPauseDisabledHint')}
                  checked={s.autoPause7dDisabled}
                  onChange={(value) => update({ autoPause7dDisabled: value })}
                  testId="auto-pause-7d-disabled"
                />
                <FormField
                  label={t('admin.accounts.autoPause7dThreshold')}
                  htmlFor={fieldId('auto-pause-7d')}
                  hint={t('admin.accounts.autoPauseThresholdHint')}
                >
                  <NumberInput
                    id={fieldId('auto-pause-7d')}
                    testId="auto-pause-7d-threshold"
                    value={s.autoPause7dThreshold}
                    onChange={(value) => update({ autoPause7dThreshold: value })}
                    min={0}
                    max={100}
                    step={0.1}
                    disabled={s.autoPause7dDisabled}
                  />
                </FormField>
              </FormSection>
            ) : null}

            {account.platform === 'openai' && account.type === 'oauth' && !isSparkShadow ? (
              <FormSection>
                <div className={formStyles.stack} data-testid="auto-reset-credit-settings">
                  <SwitchRow
                    label={t('admin.accounts.autoResetCredit.title')}
                    description={t('admin.accounts.autoResetCredit.hint')}
                    checked={s.autoResetCreditEnabled}
                    onChange={(value) => update({ autoResetCreditEnabled: value })}
                    testId="auto-reset-credit-enabled"
                  />
                  <div className={formStyles.grid2}>
                    <FormField label={t('admin.accounts.autoResetCredit.threshold5h')} htmlFor={fieldId('reset-5h')}>
                      <NumberInput
                        id={fieldId('reset-5h')}
                        testId="auto-reset-credit-5h-threshold"
                        value={s.autoResetCredit5hThreshold}
                        onChange={(value) => update({ autoResetCredit5hThreshold: value })}
                        min={0.1}
                        max={100}
                        step={0.1}
                        disabled={!s.autoResetCreditEnabled}
                      />
                    </FormField>
                    <FormField label={t('admin.accounts.autoResetCredit.threshold7d')} htmlFor={fieldId('reset-7d')}>
                      <NumberInput
                        id={fieldId('reset-7d')}
                        testId="auto-reset-credit-7d-threshold"
                        value={s.autoResetCredit7dThreshold}
                        onChange={(value) => update({ autoResetCredit7dThreshold: value })}
                        min={0.1}
                        max={100}
                        step={0.1}
                        disabled={!s.autoResetCreditEnabled}
                      />
                    </FormField>
                  </div>
                  <p className={formStyles.hint}>{t('admin.accounts.autoResetCredit.thresholdHint')}</p>
                </div>
              </FormSection>
            ) : null}

            {/* 配额控制 (Anthropic OAuth/SetupToken: 亲和 + 窗口费用 + 会话 + RPM 等) */}
            {account.platform === 'anthropic' && (account.type === 'oauth' || account.type === 'setup-token') ? (
              <FormSection title={t('admin.accounts.quotaControl.title')} description={t('admin.accounts.quotaControl.hint')}>
                {/* Window Cost Limit */}
                <SwitchRow
                  label={t('admin.accounts.quotaControl.windowCost.label')}
                  description={t('admin.accounts.quotaControl.windowCost.hint')}
                  checked={s.windowCostEnabled}
                  onChange={(value) => update({ windowCostEnabled: value })}
                >
                  {s.windowCostEnabled ? (
                    <div className={formStyles.grid2}>
                      <FormField
                        label={t('admin.accounts.quotaControl.windowCost.limit')}
                        htmlFor={fieldId('window-cost')}
                        hint={t('admin.accounts.quotaControl.windowCost.limitHint')}
                      >
                        <div className={styles.inputAffix}>
                          <span className={styles.affixStart} aria-hidden="true">$</span>
                          <NumberInput
                            id={fieldId('window-cost')}
                            value={s.windowCostLimit}
                            onChange={(value) => update({ windowCostLimit: value })}
                            min={0}
                            step={1}
                            placeholder={t('admin.accounts.quotaControl.windowCost.limitPlaceholder')}
                          />
                        </div>
                      </FormField>
                      <FormField
                        label={t('admin.accounts.quotaControl.windowCost.stickyReserve')}
                        htmlFor={fieldId('sticky-reserve')}
                        hint={t('admin.accounts.quotaControl.windowCost.stickyReserveHint')}
                      >
                        <div className={styles.inputAffix}>
                          <span className={styles.affixStart} aria-hidden="true">$</span>
                          <NumberInput
                            id={fieldId('sticky-reserve')}
                            value={s.windowCostStickyReserve}
                            onChange={(value) => update({ windowCostStickyReserve: value })}
                            min={0}
                            step={1}
                            placeholder={t('admin.accounts.quotaControl.windowCost.stickyReservePlaceholder')}
                          />
                        </div>
                      </FormField>
                    </div>
                  ) : null}
                </SwitchRow>

                {/* Session Limit */}
                <SwitchRow
                  className={styles.subGroup}
                  label={t('admin.accounts.quotaControl.sessionLimit.label')}
                  description={t('admin.accounts.quotaControl.sessionLimit.hint')}
                  checked={s.sessionLimitEnabled}
                  onChange={(value) => update({ sessionLimitEnabled: value })}
                >
                  {s.sessionLimitEnabled ? (
                    <div className={formStyles.grid2}>
                      <FormField
                        label={t('admin.accounts.quotaControl.sessionLimit.maxSessions')}
                        htmlFor={fieldId('max-sessions')}
                        hint={t('admin.accounts.quotaControl.sessionLimit.maxSessionsHint')}
                      >
                        <NumberInput
                          id={fieldId('max-sessions')}
                          value={s.maxSessions}
                          onChange={(value) => update({ maxSessions: value })}
                          min={1}
                          step={1}
                          placeholder={t('admin.accounts.quotaControl.sessionLimit.maxSessionsPlaceholder')}
                        />
                      </FormField>
                      <FormField
                        label={t('admin.accounts.quotaControl.sessionLimit.idleTimeout')}
                        htmlFor={fieldId('idle-timeout')}
                        hint={t('admin.accounts.quotaControl.sessionLimit.idleTimeoutHint')}
                      >
                        <div className={styles.inputAffix}>
                          <NumberInput
                            id={fieldId('idle-timeout')}
                            className={styles.suffixed}
                            value={s.sessionIdleTimeout}
                            onChange={(value) => update({ sessionIdleTimeout: value })}
                            min={1}
                            step={1}
                            placeholder={t('admin.accounts.quotaControl.sessionLimit.idleTimeoutPlaceholder')}
                          />
                          <span className={styles.affixEnd} aria-hidden="true">{t('common.minutes')}</span>
                        </div>
                      </FormField>
                    </div>
                  ) : null}
                </SwitchRow>

                {/* RPM Limit */}
                <SwitchRow
                  className={styles.subGroup}
                  label={t('admin.accounts.quotaControl.rpmLimit.label')}
                  description={t('admin.accounts.quotaControl.rpmLimit.hint')}
                  checked={s.rpmLimitEnabled}
                  onChange={(value) => update({ rpmLimitEnabled: value })}
                >
                  {s.rpmLimitEnabled ? (
                    <>
                      <FormField
                        label={t('admin.accounts.quotaControl.rpmLimit.baseRpm')}
                        htmlFor={fieldId('base-rpm')}
                        hint={t('admin.accounts.quotaControl.rpmLimit.baseRpmHint')}
                      >
                        <NumberInput
                          id={fieldId('base-rpm')}
                          value={s.baseRpm}
                          onChange={(value) => update({ baseRpm: value })}
                          min={1}
                          max={1000}
                          step={1}
                          placeholder={t('admin.accounts.quotaControl.rpmLimit.baseRpmPlaceholder')}
                        />
                      </FormField>
                      <FormField label={t('admin.accounts.quotaControl.rpmLimit.strategy')}>
                        <div className={styles.strategyButtons}>
                          {(['tiered', 'sticky_exempt'] as const).map((strategy) => (
                            <button
                              key={strategy}
                              type="button"
                              className={[formStyles.choice, styles.strategyButton].join(' ')}
                              aria-pressed={s.rpmStrategy === strategy}
                              onClick={() => update({ rpmStrategy: strategy })}
                            >
                              <span>
                                {t(
                                  strategy === 'tiered'
                                    ? 'admin.accounts.quotaControl.rpmLimit.strategyTiered'
                                    : 'admin.accounts.quotaControl.rpmLimit.strategyStickyExempt'
                                )}
                              </span>
                              <span className={styles.strategyHint}>
                                {t(
                                  strategy === 'tiered'
                                    ? 'admin.accounts.quotaControl.rpmLimit.strategyTieredHint'
                                    : 'admin.accounts.quotaControl.rpmLimit.strategyStickyExemptHint'
                                )}
                              </span>
                            </button>
                          ))}
                        </div>
                      </FormField>
                      {s.rpmStrategy === 'tiered' ? (
                        <FormField
                          label={t('admin.accounts.quotaControl.rpmLimit.stickyBuffer')}
                          htmlFor={fieldId('sticky-buffer')}
                          hint={t('admin.accounts.quotaControl.rpmLimit.stickyBufferHint')}
                        >
                          <NumberInput
                            id={fieldId('sticky-buffer')}
                            value={s.rpmStickyBuffer}
                            onChange={(value) => update({ rpmStickyBuffer: value })}
                            min={1}
                            step={1}
                            placeholder={t('admin.accounts.quotaControl.rpmLimit.stickyBufferPlaceholder')}
                          />
                        </FormField>
                      ) : null}
                    </>
                  ) : null}
                </SwitchRow>

                {/* 用户消息限速模式（独立于 RPM 开关，始终可见） */}
                <FormField
                  label={t('admin.accounts.quotaControl.rpmLimit.userMsgQueue')}
                  hint={t('admin.accounts.quotaControl.rpmLimit.userMsgQueueHint')}
                >
                  <ChoiceButtons
                    ariaLabel={t('admin.accounts.quotaControl.rpmLimit.userMsgQueue')}
                    options={umqModeOptions}
                    value={s.userMsgQueueMode}
                    onSelect={(value) => update({ userMsgQueueMode: value })}
                  />
                </FormField>

                {/* TLS Fingerprint */}
                <SwitchRow
                  className={styles.subGroup}
                  label={t('admin.accounts.quotaControl.tlsFingerprint.label')}
                  description={t('admin.accounts.quotaControl.tlsFingerprint.hint')}
                  checked={s.tlsFingerprintEnabled}
                  onChange={(value) => update({ tlsFingerprintEnabled: value })}
                >
                  {/* Profile selector */}
                  {s.tlsFingerprintEnabled ? (
                    <Select
                      aria-label={t('admin.accounts.quotaControl.tlsFingerprint.label')}
                      value={s.tlsFingerprintProfileId}
                      options={tlsProfileOptions}
                      onChange={(value) => update({ tlsFingerprintProfileId: value == null ? null : Number(value) })}
                    />
                  ) : null}
                </SwitchRow>

                {/* Session ID Masking */}
                <SwitchRow
                  className={styles.subGroup}
                  label={t('admin.accounts.quotaControl.sessionIdMasking.label')}
                  description={t('admin.accounts.quotaControl.sessionIdMasking.hint')}
                  checked={s.sessionIdMaskingEnabled}
                  onChange={(value) => update({ sessionIdMaskingEnabled: value })}
                />

                {/* Cache TTL Override */}
                <SwitchRow
                  className={styles.subGroup}
                  label={t('admin.accounts.quotaControl.cacheTTLOverride.label')}
                  description={t('admin.accounts.quotaControl.cacheTTLOverride.hint')}
                  checked={s.cacheTTLOverrideEnabled}
                  onChange={(value) => update({ cacheTTLOverrideEnabled: value })}
                >
                  {s.cacheTTLOverrideEnabled ? (
                    <FormField
                      label={t('admin.accounts.quotaControl.cacheTTLOverride.target')}
                      hint={t('admin.accounts.quotaControl.cacheTTLOverride.targetHint')}
                    >
                      <Select
                        aria-label={t('admin.accounts.quotaControl.cacheTTLOverride.target')}
                        value={s.cacheTTLOverrideTarget}
                        options={[
                          { value: '5m', label: '5m' },
                          { value: '1h', label: '1h' }
                        ]}
                        onChange={(value) => update({ cacheTTLOverrideTarget: String(value) })}
                      />
                    </FormField>
                  ) : null}
                </SwitchRow>

                {/* Custom Base URL Relay */}
                <SwitchRow
                  className={styles.subGroup}
                  label={t('admin.accounts.quotaControl.customBaseUrl.label')}
                  description={t('admin.accounts.quotaControl.customBaseUrl.hint')}
                  checked={s.customBaseUrlEnabled}
                  onChange={(value) => update({ customBaseUrlEnabled: value })}
                >
                  {s.customBaseUrlEnabled ? (
                    <input
                      type="text"
                      className={formStyles.input}
                      aria-label={t('admin.accounts.quotaControl.customBaseUrl.label')}
                      placeholder={t('admin.accounts.quotaControl.customBaseUrl.urlHint')}
                      value={s.customBaseUrl}
                      onChange={(event) => update({ customBaseUrl: event.target.value })}
                    />
                  ) : null}
                </SwitchRow>
              </FormSection>
            ) : null}

            <FormSection>
              <FormField label={t('common.status')}>
                <Select
                  aria-label={t('common.status')}
                  value={s.form.status}
                  options={statusOptions}
                  onChange={(value) => updateForm({ status: value as EditAccountForm['status'] })}
                />
              </FormField>

              {/* Mixed Scheduling (only for antigravity accounts, read-only in edit mode) */}
              {account.platform === 'antigravity' ? (
                <div className={styles.checkRow}>
                  <Checkbox label={t('admin.accounts.mixedScheduling')} checked={s.mixedScheduling} disabled />
                  <HelpTooltip content={t('admin.accounts.mixedSchedulingTooltip')} width="18rem" />
                </div>
              ) : null}
              {account.platform === 'antigravity' ? (
                <div className={styles.checkRow}>
                  <Checkbox
                    label={t('admin.accounts.allowOverages')}
                    checked={s.allowOverages}
                    onCheckedChange={(checked) => update({ allowOverages: checked === true })}
                  />
                  <HelpTooltip content={t('admin.accounts.allowOveragesTooltip')} width="18rem" />
                </div>
              ) : null}
            </FormSection>

            {/* Group Selection - 仅标准模式显示 */}
            <FormSection>
              <div data-tour="account-form-groups">
                <GroupSelector
                  value={s.form.group_ids}
                  onChange={(value) => updateForm({ group_ids: value })}
                  groups={selectableGroups}
                  platform={account.platform}
                  mixedScheduling={s.mixedScheduling}
                />
              </div>
            </FormSection>
          </form>
        ) : null}
      </AccountFormDrawer>

      {/* Mixed Channel Warning Dialog */}
      <ConfirmDialog
        show={showMixedChannelWarning}
        title={t('admin.accounts.mixedChannelWarningTitle')}
        message={mixedChannelWarningMessageText}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void handleMixedChannelConfirm()}
        onCancel={clearMixedChannelDialog}
      />
      {confirmDialog}
    </>
  )
}
