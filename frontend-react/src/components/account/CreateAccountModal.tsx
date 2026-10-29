import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  ArrowRight,
  Bolt,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cloud,
  CreditCard,
  Info,
  KeyRound,
  MessageSquare,
  Plus,
  Repeat,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  X
} from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { RadioCards, type RadioCardOption } from '@/components/arc/radio-cards/radio-cards'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import BaseDialog from '@/components/common/BaseDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import GroupSelector from '@/components/common/GroupSelector'
import HelpTooltip from '@/components/common/HelpTooltip'
import Input from '@/components/common/Input'
import PlatformIcon from '@/components/common/PlatformIcon'
import ProxyAdBanner from '@/components/common/ProxyAdBanner'
import ProxySelector from '@/components/common/ProxySelector'
import Select from '@/components/common/Select'
import { useAccountOAuth } from '@/composables/useAccountOAuth'
import { useAntigravityOAuth } from '@/composables/useAntigravityOAuth'
import { useGeminiOAuth } from '@/composables/useGeminiOAuth'
import { useGrokOAuth } from '@/composables/useGrokOAuth'
import { commonErrorCodes, getPresetMappingsByPlatform, isValidWildcardPattern } from '@/composables/useModelWhitelist'
import { useObservable } from '@/composables/useObservableState'
import { useOpenAIOAuth } from '@/composables/useOpenAIOAuth'
import { useQuotaNotifyState } from '@/composables/useQuotaNotifyState'
import { VERTEX_LOCATION_OPTIONS } from '@/constants/account'
import { useI18n } from '@/i18n/useI18n'
import type { AdminGroup, GroupPlatform, OpenAIEndpointCapability, Proxy, TempUnschedulableScope } from '@/types'
import { supportsAccountQuota } from '@/utils/accountQuota'
import { formatDateTimeLocalInput, getBrowserTimeZone, parseDateTimeLocalInput } from '@/utils/format'
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
import { AccountFormDrawer, FormField, FormNotice, FormSection, ToggleRow } from './AccountFormLayout'
import formStyles from './AccountForm.module.css'
import CnBaseUrlPresets from './CnBaseUrlPresets'
import {
  DEFAULT_POOL_MODE_RETRY_COUNT,
  DEFAULT_POOL_MODE_RETRY_STATUS_CODES,
  MAX_POOL_MODE_RETRY_COUNT,
  cnAdaptiveProtocolOptions,
  cnPresetMode,
  cnPresetPlatform,
  cnProtocolOptions,
  createCreateAccountController,
  currentOpenCodeOrCNMode,
  extraMultiProtocolPlatforms,
  genericAccountModes,
  isCNPlatform,
  isGenericMultiProtocolPlatform,
  isGrokSSOInputMethod,
  isManualInputMethod,
  isMultiProtocolPlatform,
  isOAuthFlow,
  isOpenAIModelRestrictionDisabled,
  isOpenCodeGoPlatform,
  openAITextGenerationCapabilityEnabled,
  openaiResponsesWebSocketV2Mode,
  routesByModel,
  syncPreviewCredentials,
  vertexUsesApiKey,
  type AccountCategory,
  type CreateAccountController,
  type CreateAccountState,
  type ModelMapping
} from './CreateAccountModal.controller'
import styles from './CreateAccountModal.module.css'
import { cnSupportsNativeResponses, defaultCNBaseUrl, isHeaderOverrideCapable, providerModeLabel } from './credentialsBuilder'
import GrokBaseUrlPresets from './GrokBaseUrlPresets'
import HeaderOverrideEditor from './HeaderOverrideEditor'
import { allSelectedGroupsEnableLongContextPricing } from './longContextBilling'
import ModelWhitelistSelector from './ModelWhitelistSelector'
import OAuthAuthorizationFlow, { type OAuthFlowHandle } from './OAuthAuthorizationFlow'
import OpenCodeGoProtocolRulesEditor from './OpenCodeGoProtocolRulesEditor'
import QuotaLimitCard, { type QuotaLimitCardValues } from './QuotaLimitCard'
import UpstreamRequestIdHeaderField from './UpstreamRequestIdHeaderField'
import { useConfirmDialog } from './useConfirmDialog'

export interface CreateAccountModalProps {
  show: boolean
  proxies: Proxy[]
  groups: AdminGroup[]
  onClose: () => void
  onCreated: () => void
}

/** Vue v-model.number：空串或无法解析时回落 null */
const toNumber = (value: string): number | null => {
  if (value === '') return null
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) ? null : parsed
}

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

const geminiQuotaDocs = {
  codeAssist: 'https://developers.google.com/gemini-code-assist/resources/quotas',
  aiStudio: 'https://ai.google.dev/pricing',
  vertex: 'https://cloud.google.com/vertex-ai/generative-ai/docs/quotas'
}

const geminiHelpLinks = {
  apiKey: 'https://aistudio.google.com/app/apikey',
  aiStudioPricing: 'https://ai.google.dev/pricing',
  gcpProject: 'https://console.cloud.google.com/welcome/new',
  geminiWebActivation: 'https://gemini.google.com/gems/create?hl=en-US&pli=1',
  countryCheck: 'https://policies.google.com/terms',
  countryChange: 'https://policies.google.com/country-association-form'
}

const BEDROCK_REGIONS: { label: string; options: [string, string][] }[] = [
  {
    label: 'US',
    options: [
      ['us-east-1', 'us-east-1 (N. Virginia)'],
      ['us-east-2', 'us-east-2 (Ohio)'],
      ['us-west-1', 'us-west-1 (N. California)'],
      ['us-west-2', 'us-west-2 (Oregon)'],
      ['us-gov-east-1', 'us-gov-east-1 (GovCloud US-East)'],
      ['us-gov-west-1', 'us-gov-west-1 (GovCloud US-West)']
    ]
  },
  {
    label: 'Europe',
    options: [
      ['eu-west-1', 'eu-west-1 (Ireland)'],
      ['eu-west-2', 'eu-west-2 (London)'],
      ['eu-west-3', 'eu-west-3 (Paris)'],
      ['eu-central-1', 'eu-central-1 (Frankfurt)'],
      ['eu-central-2', 'eu-central-2 (Zurich)'],
      ['eu-south-1', 'eu-south-1 (Milan)'],
      ['eu-south-2', 'eu-south-2 (Spain)'],
      ['eu-north-1', 'eu-north-1 (Stockholm)']
    ]
  },
  {
    label: 'Asia Pacific',
    options: [
      ['ap-northeast-1', 'ap-northeast-1 (Tokyo)'],
      ['ap-northeast-2', 'ap-northeast-2 (Seoul)'],
      ['ap-northeast-3', 'ap-northeast-3 (Osaka)'],
      ['ap-south-1', 'ap-south-1 (Mumbai)'],
      ['ap-south-2', 'ap-south-2 (Hyderabad)'],
      ['ap-southeast-1', 'ap-southeast-1 (Singapore)'],
      ['ap-southeast-2', 'ap-southeast-2 (Sydney)']
    ]
  },
  { label: 'Canada', options: [['ca-central-1', 'ca-central-1 (Canada)']] },
  { label: 'South America', options: [['sa-east-1', 'sa-east-1 (São Paulo)']] }
]

/** 卡片标签：带 data-testid 的文本（点击冒泡到卡片） */
function CardLabel({ testId, children }: { testId?: string; children: ReactNode }) {
  return (
    <span className={styles.cardLabel} data-testid={testId}>
      {children}
    </span>
  )
}

function Badges({ items }: { items: string[] }) {
  return (
    <span className={styles.cardBadges}>
      {items.map((item) => (
        <span key={item} className={styles.cardBadge}>
          {item}
        </span>
      ))}
    </span>
  )
}

interface MappingRowsProps {
  rows: ModelMapping[]
  fromPlaceholder: string
  toPlaceholder: string
  onUpdate: (index: number, patch: Partial<Pick<ModelMapping, 'from' | 'to'>>) => void
  onRemove: (index: number) => void
  /** Antigravity：实时校验通配符 */
  validate?: boolean
  wildcardError?: string
  targetError?: string
  removeLabel: string
}

/** 模型映射行列表（请求模型 → 实际模型） */
function MappingRows({
  rows,
  fromPlaceholder,
  toPlaceholder,
  onUpdate,
  onRemove,
  validate,
  wildcardError,
  targetError,
  removeLabel
}: MappingRowsProps) {
  if (rows.length === 0) return null
  return (
    <div className={formStyles.editRows}>
      {rows.map((mapping, index) => {
        const fromInvalid = validate && !isValidWildcardPattern(mapping.from)
        const toInvalid = validate && mapping.to.includes('*')
        return (
          <div key={mapping.key} className={styles.mappingRow}>
            <div className={formStyles.editRow}>
              <input
                value={mapping.from}
                onChange={(event) => onUpdate(index, { from: event.target.value })}
                type="text"
                className={formStyles.input}
                aria-invalid={fromInvalid || undefined}
                placeholder={fromPlaceholder}
              />
              <ArrowRight size={16} aria-hidden="true" className={styles.arrow} />
              <input
                value={mapping.to}
                onChange={(event) => onUpdate(index, { to: event.target.value })}
                type="text"
                className={formStyles.input}
                aria-invalid={toInvalid || undefined}
                placeholder={toPlaceholder}
              />
              <button
                type="button"
                className={formStyles.iconButton}
                data-tone="danger"
                aria-label={removeLabel}
                onClick={() => onRemove(index)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
            {/* 校验错误提示 */}
            {fromInvalid ? <p className={styles.rowError}>{wildcardError}</p> : null}
            {toInvalid ? <p className={styles.rowError}>{targetError}</p> : null}
          </div>
        )
      })}
    </div>
  )
}

function PresetButtons({
  presets,
  onAdd
}: {
  presets: { label: string; from: string; to: string }[]
  onAdd: (from: string, to: string) => void
}) {
  return (
    <div className={formStyles.choiceGroup}>
      {presets.map((preset) => (
        <button key={preset.label} type="button" className={formStyles.choice} onClick={() => onAdd(preset.from, preset.to)}>
          + {preset.label}
        </button>
      ))}
    </div>
  )
}

/** 创建账号（对应 Vue 版 CreateAccountModal.vue） */
export default function CreateAccountModal({ show, proxies, groups, onClose, onCreated }: CreateAccountModalProps) {
  const { t } = useI18n()
  const browserTimeZone = getBrowserTimeZone()

  // OAuth composables
  const oauth = useAccountOAuth()
  const openaiOAuth = useOpenAIOAuth()
  const geminiOAuth = useGeminiOAuth()
  const antigravityOAuth = useAntigravityOAuth()
  const grokOAuth = useGrokOAuth()
  const quotaNotify = useQuotaNotifyState()
  const { confirm, confirmDialog } = useConfirmDialog()

  const [ctl] = useState<CreateAccountController>(() =>
    createCreateAccountController({
      t,
      initialShow: show,
      oauth,
      openaiOAuth,
      geminiOAuth,
      antigravityOAuth,
      grokOAuth,
      quotaNotify,
      confirm: (message) => confirm(message)
    })
  )
  const s = useSyncExternalStore(ctl.store.subscribe, ctl.store.get, ctl.store.get)
  useLayoutEffect(() => {
    ctl.setCallbacks({ onClose, onCreated })
  }, [ctl, onClose, onCreated])
  const quotaNotifySnapshot = useObservable(quotaNotify.observable)

  // props.show 同步到状态容器（Vue 版 watch(() => props.show)）
  useLayoutEffect(() => {
    if (ctl.get().show !== show) ctl.set({ show })
  }, [ctl, show])

  // Load global feature states once
  useEffect(() => {
    ctl.loadGlobalStates()
  }, [ctl])

  const vertexFileInputRef = useRef<HTMLInputElement>(null)
  const attachFlowHandle = useCallback((handle: OAuthFlowHandle | null) => ctl.attachFlowHandle(handle), [ctl])

  const { form } = s
  const set = ctl.set
  const setForm = ctl.setForm
  const platform = form.platform
  const client = ctl.currentClient(platform)
  const currentOAuthLoading = client.loading
  const oauthFlow = s.step === 2 ? s.flowState : null

  // ── Computed ──
  const oauthOAuthFlow = isOAuthFlow(s)
  const multiProtocol = isMultiProtocolPlatform(s)
  const cnPlatform = isCNPlatform(s)
  const openCodeGo = isOpenCodeGoPlatform(s)
  const hideAccountLongContextBilling = allSelectedGroupsEnableLongContextPricing(form.group_ids, groups)
  const restrictionDisabled = isOpenAIModelRestrictionDisabled(s)
  const previewCredentials = syncPreviewCredentials(s)
  const wsMode = openaiResponsesWebSocketV2Mode(s)
  const openAIWSModeHintKey = resolveOpenAIWSModeHintKey(wsMode)
  const textCapabilityEnabled = openAITextGenerationCapabilityEnabled(s)
  const presetMappings = getPresetMappingsByPlatform(platform)
  const officialGeminiBaseUrl = isOfficialGeminiBaseUrl(s.apiKeyBaseUrl)

  const oauthStepTitle = (() => {
    if (platform === 'openai') return t('admin.accounts.oauth.openai.title')
    if (platform === 'gemini') return t('admin.accounts.oauth.gemini.title')
    if (platform === 'antigravity') return t('admin.accounts.oauth.antigravity.title')
    if (platform === 'grok') return t('admin.accounts.oauth.grok.title')
    return t('admin.accounts.oauth.title')
  })()

  // Platform-specific hints for API Key type
  const baseUrlHint = (() => {
    if (platform === 'openai') return t('admin.accounts.openai.baseUrlHint')
    if (platform === 'gemini') return t('admin.accounts.gemini.baseUrlHint')
    if (platform === 'grok') return ''
    return t('admin.accounts.baseUrlHint')
  })()

  const apiKeyHint = (() => {
    if (platform === 'openai') return t('admin.accounts.openai.apiKeyHint')
    if (platform === 'gemini') return t('admin.accounts.gemini.apiKeyHint')
    // Grok 与多协议供应商没有对应的说明文案；通用文案指 Claude Console Key。
    if (platform === 'grok' || multiProtocol) return ''
    return t('admin.accounts.apiKeyHint')
  })()

  // Base URL / API Key 占位符：国产供应商随账号类型变化。
  const apiKeyBaseUrlPlaceholder = (() => {
    if (multiProtocol) {
      const mode = platform === 'opencode_go' ? s.openCodeAccountMode : s.accountMode
      return defaultCNBaseUrl(platform, mode, s.apiProtocol) || 'https://api.example.com'
    }
    switch (platform) {
      case 'openai':
        return 'https://api.openai.com'
      case 'gemini':
        return 'https://generativelanguage.googleapis.com'
      case 'grok':
        return 'https://api.x.ai/v1'
      case 'typesafe':
        return 'https://api.typesafe.ai'
      default:
        return 'https://api.anthropic.com'
    }
  })()

  const apiKeyValuePlaceholder = (() => {
    switch (platform) {
      case 'openai':
        return 'sk-proj-...'
      case 'gemini':
        return 'AQ.Ab...'
      case 'grok':
        return 'xai-...'
      case 'kimi':
        return 'sk-...'
      case 'zhipu':
        return '<api-key>.<secret>'
      case 'deepseek':
        return 'sk-...'
      case 'minimax':
      case 'opencode_go':
        return 'sk-...'
      case 'typesafe':
        return 'ts-...'
      default:
        return multiProtocol ? 'sk-...' : 'sk-ant-...'
    }
  })()

  const mixedChannelWarningMessageText = s.mixedChannelWarningDetails
    ? t('admin.accounts.mixedChannelWarning', s.mixedChannelWarningDetails)
    : s.mixedChannelWarningRawMessage

  const canExchangeCode = Boolean((oauthFlow?.authCode || '').trim() && client.sessionId && !client.loading)

  // ── 选项 ──
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
    s.openAIResponsesMode === 'force_responses'
      ? t('admin.accounts.openai.capabilityResponses')
      : s.openAIResponsesMode === 'force_chat_completions'
        ? t('admin.accounts.openai.capabilityChatCompletions')
        : t('admin.accounts.openai.capabilityTextAuto')
  const openAIEndpointCapabilityOptions: { value: OpenAIEndpointCapability; label: string }[] = [
    { value: 'chat_completions', label: openAITextEndpointCapabilityLabel },
    { value: 'embeddings', label: t('admin.accounts.openai.capabilityEmbeddings') },
    { value: 'seedance', label: 'Seedance (Ark)' }
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
  const umqModeOptions = [
    { value: '', label: t('admin.accounts.quotaControl.rpmLimit.umqModeOff') },
    { value: 'throttle', label: t('admin.accounts.quotaControl.rpmLimit.umqModeThrottle') },
    { value: 'serialize', label: t('admin.accounts.quotaControl.rpmLimit.umqModeSerialize') }
  ]
  const tempUnschedScopeOptions: Array<{ value: TempUnschedulableScope; label: string; description: string }> = [
    {
      value: 'model',
      label: t('admin.accounts.tempUnschedulable.scopeModel'),
      description: t('admin.accounts.tempUnschedulable.scopeModelDesc')
    },
    {
      value: 'account',
      label: t('admin.accounts.tempUnschedulable.scopeAccount'),
      description: t('admin.accounts.tempUnschedulable.scopeAccountDesc')
    }
  ]
  const tempUnschedPresets = [
    {
      label: t('admin.accounts.tempUnschedulable.presets.overloadLabel'),
      rule: {
        error_code: 529,
        keywords: 'overloaded, too many',
        duration_minutes: 60,
        description: t('admin.accounts.tempUnschedulable.presets.overloadDesc'),
        scope: 'model' as const
      }
    },
    {
      label: t('admin.accounts.tempUnschedulable.presets.rateLimitLabel'),
      rule: {
        error_code: 429,
        keywords: 'rate limit, too many requests',
        duration_minutes: 10,
        description: t('admin.accounts.tempUnschedulable.presets.rateLimitDesc'),
        scope: 'model' as const
      }
    },
    {
      label: t('admin.accounts.tempUnschedulable.presets.unavailableLabel'),
      rule: {
        error_code: 503,
        keywords: 'unavailable, maintenance',
        duration_minutes: 30,
        description: t('admin.accounts.tempUnschedulable.presets.unavailableDesc'),
        scope: 'model' as const
      }
    }
  ]

  // ── 平台卡片 ──
  const platformCard = (value: string, label: string, icon: ReactNode): RadioCardOption => ({
    value,
    label: <CardLabel testId={`platform-button-${value}`}>{label}</CardLabel>,
    icon
  })
  const platformIcon = (id: string) => <PlatformIcon platform={id as GroupPlatform} size="sm" />
  const primaryPlatforms: RadioCardOption[] = [
    platformCard('anthropic', 'Anthropic', <Sparkles size={16} />),
    platformCard('openai', 'OpenAI', <Bolt size={16} />),
    platformCard('gemini', 'Gemini', <Sparkles size={16} />),
    platformCard('antigravity', 'Antigravity', <Cloud size={16} />),
    platformCard('grok', 'Grok', platformIcon('grok')),
    platformCard('typesafe', 'TypeSafe / Jev', platformIcon('typesafe'))
  ]
  // 国产厂商：Kimi / Zhipu GLM / DeepSeek / MiniMax
  const cnPlatforms: RadioCardOption[] = [
    platformCard('kimi', 'Kimi', platformIcon('kimi')),
    platformCard('zhipu', 'Zhipu GLM', platformIcon('zhipu')),
    platformCard('deepseek', 'DeepSeek', platformIcon('deepseek')),
    platformCard('minimax', 'MiniMax', platformIcon('minimax'))
  ]
  // 多模型聚合平台：OpenCode 与平台清单中登记的其他多协议供应商
  const aggregatorSpecs = extraMultiProtocolPlatforms()
  const aggregatorPlatforms: RadioCardOption[] = [
    platformCard('opencode_go', 'OpenCode', platformIcon('opencode_go')),
    // 没有专属界面的多协议供应商：通用表单（模式 / 协议 / 端点来自 profile）
    ...aggregatorSpecs.map((spec) => platformCard(spec.id, spec.display_name, platformIcon(spec.id)))
  ]

  const selectPrimaryPlatform = (value: string) => {
    if (value === 'typesafe') ctl.selectTypeSafePlatform()
    else setForm({ platform: value })
  }
  const selectAggregatorPlatform = (value: string) => {
    if (value === 'opencode_go') ctl.selectOpenCodeGoPlatform()
    else ctl.selectGenericMultiProtocolPlatform(value)
  }

  const typeCard = (value: AccountCategory, label: string, description: ReactNode, icon: ReactNode, testId?: string) => ({
    value,
    label: <CardLabel testId={testId}>{label}</CardLabel>,
    description,
    icon
  })

  // ── 公共片段 ──
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
    quotaNotifyDailyEnabled: quotaNotifySnapshot.state.daily.enabled,
    quotaNotifyDailyThreshold: quotaNotifySnapshot.state.daily.threshold,
    quotaNotifyDailyThresholdType: quotaNotifySnapshot.state.daily.thresholdType,
    quotaNotifyWeeklyEnabled: quotaNotifySnapshot.state.weekly.enabled,
    quotaNotifyWeeklyThreshold: quotaNotifySnapshot.state.weekly.threshold,
    quotaNotifyWeeklyThresholdType: quotaNotifySnapshot.state.weekly.thresholdType,
    quotaNotifyTotalEnabled: quotaNotifySnapshot.state.total.enabled,
    quotaNotifyTotalThreshold: quotaNotifySnapshot.state.total.threshold,
    quotaNotifyTotalThresholdType: quotaNotifySnapshot.state.total.thresholdType
  }
  const onQuotaUpdate = (patch: Partial<QuotaLimitCardValues>) => {
    const next: Partial<CreateAccountState> = {}
    if ('totalLimit' in patch) next.editQuotaLimit = patch.totalLimit ?? null
    if ('dailyLimit' in patch) next.editQuotaDailyLimit = patch.dailyLimit ?? null
    if ('weeklyLimit' in patch) next.editQuotaWeeklyLimit = patch.weeklyLimit ?? null
    if ('dailyResetMode' in patch) next.editDailyResetMode = patch.dailyResetMode ?? null
    if ('dailyResetHour' in patch) next.editDailyResetHour = patch.dailyResetHour ?? null
    if ('weeklyResetMode' in patch) next.editWeeklyResetMode = patch.weeklyResetMode ?? null
    if ('weeklyResetDay' in patch) next.editWeeklyResetDay = patch.weeklyResetDay ?? null
    if ('weeklyResetHour' in patch) next.editWeeklyResetHour = patch.weeklyResetHour ?? null
    if ('resetTimezone' in patch) next.editResetTimezone = patch.resetTimezone ?? null
    if (Object.keys(next).length > 0) set(next)
    if ('quotaNotifyDailyEnabled' in patch) quotaNotify.setDim('daily', { enabled: patch.quotaNotifyDailyEnabled ?? null })
    if ('quotaNotifyDailyThreshold' in patch)
      quotaNotify.setDim('daily', { threshold: patch.quotaNotifyDailyThreshold ?? null })
    if ('quotaNotifyDailyThresholdType' in patch)
      quotaNotify.setDim('daily', { thresholdType: patch.quotaNotifyDailyThresholdType ?? null })
    if ('quotaNotifyWeeklyEnabled' in patch)
      quotaNotify.setDim('weekly', { enabled: patch.quotaNotifyWeeklyEnabled ?? null })
    if ('quotaNotifyWeeklyThreshold' in patch)
      quotaNotify.setDim('weekly', { threshold: patch.quotaNotifyWeeklyThreshold ?? null })
    if ('quotaNotifyWeeklyThresholdType' in patch)
      quotaNotify.setDim('weekly', { thresholdType: patch.quotaNotifyWeeklyThresholdType ?? null })
    if ('quotaNotifyTotalEnabled' in patch) quotaNotify.setDim('total', { enabled: patch.quotaNotifyTotalEnabled ?? null })
    if ('quotaNotifyTotalThreshold' in patch)
      quotaNotify.setDim('total', { threshold: patch.quotaNotifyTotalThreshold ?? null })
    if ('quotaNotifyTotalThresholdType' in patch)
      quotaNotify.setDim('total', { thresholdType: patch.quotaNotifyTotalThresholdType ?? null })
  }
  const quotaLimitCard = (
    <QuotaLimitCard {...quotaValues} quotaNotifyGlobalEnabled={quotaNotifySnapshot.globalEnabled} onUpdate={onQuotaUpdate} />
  )

  const restrictionModeToggle = (
    <SegmentedControl
      label={t('admin.accounts.modelRestriction')}
      value={s.modelRestrictionMode}
      onValueChange={(value) => set({ modelRestrictionMode: value as 'whitelist' | 'mapping' })}
      options={[
        { value: 'whitelist', label: t('admin.accounts.modelWhitelist') },
        { value: 'mapping', label: t('admin.accounts.modelMapping') }
      ]}
    />
  )

  const whitelistBlock = (whitelistPlatform: string) => (
    <div className={formStyles.stackTight}>
      <ModelWhitelistSelector
        value={s.allowedModels}
        onChange={(value) => set({ allowedModels: value })}
        modelMappings={s.modelMappings}
        platform={whitelistPlatform}
        syncCredentials={previewCredentials}
        onUpstreamSynced={() => set({ upstreamModelsPreviewed: true })}
      />
      <p className={formStyles.hint}>
        {t('admin.accounts.selectedModels', { count: s.allowedModels.length })}
        {s.allowedModels.length === 0 ? <span> {t('admin.accounts.supportsAllModels')}</span> : null}
      </p>
    </div>
  )

  const mappingRows = (fromKey: string, toKey: string) => (
    <MappingRows
      rows={s.modelMappings}
      fromPlaceholder={t(fromKey)}
      toPlaceholder={t(toKey)}
      onUpdate={(index, patch) => ctl.updateMappingRow('modelMappings', index, patch)}
      onRemove={(index) => ctl.removeMappingRow('modelMappings', index)}
      removeLabel={t('common.delete')}
    />
  )

  const addMappingButton = (onClick: () => void) => (
    <button type="button" className={styles.addRow} onClick={onClick}>
      <Plus size={16} aria-hidden="true" />
      {t('admin.accounts.addMapping')}
    </button>
  )

  /** 模型限制（API Key 区块与 OpenAI/Grok OAuth 区块共用） */
  const modelRestrictionSection = (
    <FormSection title={t('admin.accounts.modelRestriction')}>
      {restrictionDisabled ? (
        <FormNotice tone="warning">
          <p>{t('admin.accounts.openai.modelRestrictionDisabledByPassthrough')}</p>
        </FormNotice>
      ) : (
        <>
          {/* Mode Toggle */}
          {restrictionModeToggle}
          {s.modelRestrictionMode === 'whitelist' ? (
            whitelistBlock(platform)
          ) : (
            <div className={formStyles.stack}>
              <FormNotice tone="info">
                <p>{t('admin.accounts.mapRequestModels')}</p>
              </FormNotice>
              {/* Model Mapping List */}
              {mappingRows('admin.accounts.requestModel', 'admin.accounts.actualModel')}
              {addMappingButton(() => ctl.addMappingRow('modelMappings'))}
              {/* Quick Add Buttons */}
              <PresetButtons presets={presetMappings} onAdd={(from, to) => ctl.addPresetMapping(from, to)} />
            </div>
          )}
        </>
      )}
    </FormSection>
  )

  const poolModeSection = (
    <FormSection>
      <ToggleRow
        label={t('admin.accounts.poolMode')}
        description={t('admin.accounts.poolModeHint')}
        checked={s.poolModeEnabled}
        onChange={(value) => set({ poolModeEnabled: value })}
      >
        {s.poolModeEnabled ? (
          <>
            <FormNotice tone="info">
              <p>{t('admin.accounts.poolModeInfo')}</p>
            </FormNotice>
            <Input
              label={t('admin.accounts.poolModeRetryCount')}
              type="number"
              min={0}
              max={MAX_POOL_MODE_RETRY_COUNT}
              step={1}
              value={s.poolModeRetryCount}
              onChange={(value) => set({ poolModeRetryCount: toNumber(value) })}
              hint={t('admin.accounts.poolModeRetryCountHint', {
                default: DEFAULT_POOL_MODE_RETRY_COUNT,
                max: MAX_POOL_MODE_RETRY_COUNT
              })}
            />
            <Input
              label={t('admin.accounts.poolModeRetryStatusCodes')}
              value={s.poolModeRetryStatusCodesInput}
              onChange={(value) => set({ poolModeRetryStatusCodesInput: value })}
              placeholder={DEFAULT_POOL_MODE_RETRY_STATUS_CODES.join(', ')}
              hint={t('admin.accounts.poolModeRetryStatusCodesHint', {
                default: DEFAULT_POOL_MODE_RETRY_STATUS_CODES.join(', ')
              })}
            />
          </>
        ) : null}
      </ToggleRow>
    </FormSection>
  )

  const headerOverrideToggle = (
    <ToggleRow
      label={t('admin.accounts.headerOverride.title')}
      description={t('admin.accounts.headerOverride.hint')}
      checked={s.headerOverrideEnabled}
      onChange={(value) => set({ headerOverrideEnabled: value })}
    >
      {s.headerOverrideEnabled ? (
        <>
          <FormNotice tone="info">
            <p>{t('admin.accounts.headerOverride.info')}</p>
          </FormNotice>
          <HeaderOverrideEditor rows={s.headerOverrideRows} onChange={(rows) => set({ headerOverrideRows: rows })} />
        </>
      ) : null}
    </ToggleRow>
  )

  const vertexLocationSelect = (
    <FormField label="Location" htmlFor="create-vertex-location" hint={t('admin.accounts.vertexLocationHint')}>
      <select
        id="create-vertex-location"
        value={s.vertexLocation}
        onChange={(event) => set({ vertexLocation: event.target.value })}
        required
        className={cx(formStyles.select, formStyles.mono)}
      >
        {VERTEX_LOCATION_OPTIONS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </FormField>
  )

  const numberField = (
    label: string,
    value: number | null,
    onChange: (value: number | null) => void,
    opts: { placeholder?: string; hint?: string; min?: number; max?: number; prefix?: string; suffix?: string } = {}
  ) => (
    <FormField label={label} hint={opts.hint}>
      <div className={styles.affixInput}>
        {opts.prefix ? <span className={styles.prefix}>{opts.prefix}</span> : null}
        <input
          value={value ?? ''}
          onChange={(event) => onChange(toNumber(event.target.value))}
          type="number"
          min={opts.min}
          max={opts.max}
          step={1}
          aria-label={label}
          className={cx(formStyles.input, opts.prefix && styles.withPrefix, opts.suffix && styles.withSuffix)}
          placeholder={opts.placeholder}
        />
        {opts.suffix ? <span className={styles.suffix}>{opts.suffix}</span> : null}
      </div>
    </FormField>
  )

  // ── Step 1：基本信息 ──
  const renderBasicInfo = () => (
    <form
      id="create-account-form"
      className={formStyles.stack}
      onSubmit={(event) => {
        event.preventDefault()
        void ctl.handleSubmit()
      }}
    >
      <FormSection>
        <Input
          label={t('admin.accounts.accountName')}
          value={form.name}
          onChange={(value) => setForm({ name: value })}
          required={!isGrokSSOInputMethod(s)}
          placeholder={t('admin.accounts.enterAccountName')}
          data-tour="account-form-name"
        />
        <FormField label={t('admin.accounts.notes')} htmlFor="create-account-notes" hint={t('admin.accounts.notesHint')}>
          <textarea
            id="create-account-notes"
            value={form.notes}
            onChange={(event) => setForm({ notes: event.target.value })}
            rows={3}
            className={formStyles.textarea}
            placeholder={t('admin.accounts.notesPlaceholder')}
          />
        </FormField>
      </FormSection>

      {/* Platform Selection */}
      <FormSection title={t('admin.accounts.platform')} data-tour="account-form-platform">
        <div className={styles.platformRows}>
          <RadioCards
            aria-label={t('admin.accounts.platform')}
            options={primaryPlatforms}
            value={platform}
            onValueChange={selectPrimaryPlatform}
            minColumnWidth={140}
          />
          <RadioCards
            aria-label={t('admin.accounts.platform')}
            options={cnPlatforms}
            value={platform}
            onValueChange={(value) => ctl.selectCNPlatform(value as 'kimi' | 'zhipu' | 'deepseek' | 'minimax')}
            minColumnWidth={140}
            data-testid="platform-row-cn"
          />
          <RadioCards
            aria-label={t('admin.accounts.platform')}
            options={aggregatorPlatforms}
            value={platform}
            onValueChange={selectAggregatorPlatform}
            minColumnWidth={140}
            data-testid="platform-row-aggregators"
          />
        </div>
      </FormSection>

      {/* Account Type Selection (Anthropic) */}
      {platform === 'anthropic' ? (
        <FormSection title={t('admin.accounts.accountType')}>
          <RadioCards
            aria-label={t('admin.accounts.accountType')}
            data-tour="account-form-type"
            value={s.accountCategory}
            onValueChange={(value) => set({ accountCategory: value as AccountCategory })}
            minColumnWidth={160}
            options={[
              typeCard('oauth-based', t('admin.accounts.claudeCode'), t('admin.accounts.oauthSetupToken'), <Sparkles size={16} />),
              typeCard('apikey', t('admin.accounts.claudeConsole'), t('admin.accounts.apiKey'), <KeyRound size={16} />),
              typeCard('bedrock', t('admin.accounts.bedrockLabel'), t('admin.accounts.bedrockDesc'), <Cloud size={16} />),
              typeCard('service_account', t('admin.accounts.vertexLabel'), t('admin.accounts.vertexDesc'), <Cloud size={16} />)
            ]}
          />
          {s.accountCategory === 'service_account' ? (
            <FormNotice tone="info">
              <p>{t('admin.accounts.vertexAnthropicHint')}</p>
            </FormNotice>
          ) : null}
        </FormSection>
      ) : null}

      {/* Account Type Selection (OpenAI) */}
      {platform === 'openai' ? (
        <FormSection title={t('admin.accounts.accountType')}>
          <RadioCards
            aria-label={t('admin.accounts.accountType')}
            data-tour="account-form-type"
            value={s.accountCategory}
            onValueChange={(value) => set({ accountCategory: value as AccountCategory })}
            options={[
              typeCard('oauth-based', 'OAuth', t('admin.accounts.types.chatgptOauth'), <KeyRound size={16} />),
              typeCard('apikey', 'API Key', t('admin.accounts.types.responsesApi'), <KeyRound size={16} />)
            ]}
          />
        </FormSection>
      ) : null}

      {/* Account Type Selection (Grok) */}
      {platform === 'grok' ? (
        <FormSection title={t('admin.accounts.accountType')}>
          <RadioCards
            aria-label={t('admin.accounts.accountType')}
            data-tour="account-form-type"
            value={s.accountCategory}
            onValueChange={(value) => set({ accountCategory: value as AccountCategory })}
            options={[
              typeCard('oauth-based', 'OAuth', t('admin.accounts.types.grokOauth'), platformIcon('grok')),
              typeCard(
                'apikey',
                'API Key',
                t('admin.accounts.types.responsesApi'),
                <KeyRound size={16} />,
                'grok-account-type-api-key'
              )
            ]}
          />
        </FormSection>
      ) : null}

      {/* OpenCode Zen vs Go */}
      {openCodeGo ? (
        <FormSection title={t('admin.accounts.cnProviders.accountMode.title')}>
          <RadioCards
            aria-label={t('admin.accounts.cnProviders.accountMode.title')}
            value={s.openCodeAccountMode}
            onValueChange={(value) => set({ openCodeAccountMode: value as 'zen' | 'go' })}
            options={[
              {
                value: 'zen',
                label: t('admin.accounts.opencodeGo.accountMode.zen'),
                description: t('admin.accounts.opencodeGo.accountMode.zenDesc'),
                icon: <CreditCard size={16} />
              },
              {
                value: 'go',
                label: t('admin.accounts.opencodeGo.accountMode.go'),
                description: t('admin.accounts.opencodeGo.accountMode.goDesc'),
                icon: <Bolt size={16} />
              }
            ]}
          />
        </FormSection>
      ) : null}

      {/* Account Mode Selection (providers using the generic form) */}
      {isGenericMultiProtocolPlatform(s) && genericAccountModes(s).length > 1 ? (
        <FormSection title={t('admin.accounts.cnProviders.accountMode.title')}>
          <RadioCards
            aria-label={t('admin.accounts.cnProviders.accountMode.title')}
            data-testid="generic-account-mode"
            value={s.accountMode}
            onValueChange={(value) => set({ accountMode: value })}
            options={genericAccountModes(s).map((mode) => ({
              value: mode,
              label: providerModeLabel(mode, t),
              icon: <CreditCard size={16} />
            }))}
          />
        </FormSection>
      ) : null}

      {/* Account Mode Selection (Kimi / Zhipu / DeepSeek) */}
      {cnPlatform && !openCodeGo ? (
        <FormSection title={t('admin.accounts.cnProviders.accountMode.title')}>
          <RadioCards
            aria-label={t('admin.accounts.cnProviders.accountMode.title')}
            data-tour="account-form-mode"
            value={s.accountMode}
            onValueChange={(value) => set({ accountMode: value })}
            options={[
              // Pay-as-you-go (token balance)
              {
                value: 'payg',
                label: t('admin.accounts.cnProviders.accountMode.payg'),
                description: t('admin.accounts.cnProviders.accountMode.paygDesc'),
                icon: <CreditCard size={16} />
              },
              // Coding Plan (kimi / zhipu only — DeepSeek has no coding plan)
              ...(platform !== 'deepseek'
                ? [
                    {
                      value: 'coding',
                      label: t('admin.accounts.cnProviders.accountMode.coding'),
                      description: t('admin.accounts.cnProviders.accountMode.codingDesc'),
                      icon: <Bolt size={16} />
                    }
                  ]
                : [])
            ]}
          />
        </FormSection>
      ) : null}

      {/* API Protocol Selection (Kimi / Zhipu / DeepSeek / OpenCode) */}
      {multiProtocol ? (
        <FormSection title={t('admin.accounts.cnProviders.apiProtocol.title')}>
          <RadioCards
            aria-label={t('admin.accounts.cnProviders.apiProtocol.title')}
            value={s.apiProtocol}
            onValueChange={(value) => set({ apiProtocol: value as CreateAccountState['apiProtocol'] })}
            options={cnProtocolOptions(s).map((opt) => ({
              value: opt.value,
              label: t(`admin.accounts.cnProviders.apiProtocol.${opt.labelKey}`),
              description: t(`admin.accounts.cnProviders.apiProtocol.${opt.labelKey}Desc`),
              icon:
                opt.value === 'adaptive' ? (
                  <Repeat size={16} />
                ) : opt.value === 'anthropic' ? (
                  <Sparkles size={16} />
                ) : opt.value === 'responses' ? (
                  <Terminal size={16} />
                ) : (
                  <MessageSquare size={16} />
                )
            }))}
          />
        </FormSection>
      ) : null}

      {/* Zhipu 团队版 Coding Plan：组织/项目 ID（可选，填写后额度探测走团队版端点） */}
      {platform === 'zhipu' && s.accountMode === 'coding' ? (
        <FormSection
          title={
            <span className={styles.cardLabel}>
              {t('admin.accounts.cnProviders.zhipuTeam.title')}
              <HelpTooltip trigger="click" width="20rem">
                <p>{t('admin.accounts.cnProviders.zhipuTeam.help.title')}</p>
                <ol className={styles.helpList}>
                  <li>{t('admin.accounts.cnProviders.zhipuTeam.help.step1')}</li>
                  <li>{t('admin.accounts.cnProviders.zhipuTeam.help.step2')}</li>
                  <li>{t('admin.accounts.cnProviders.zhipuTeam.help.step3')}</li>
                  <li>{t('admin.accounts.cnProviders.zhipuTeam.help.step4')}</li>
                </ol>
                <p className={formStyles.code}>{t('admin.accounts.cnProviders.zhipuTeam.help.example')}</p>
              </HelpTooltip>
            </span>
          }
          description={t('admin.accounts.cnProviders.zhipuTeam.hint')}
        >
          <div className={formStyles.grid2}>
            <Input
              label={t('admin.accounts.cnProviders.zhipuTeam.organization')}
              value={s.zhipuOrganization}
              onChange={(value) => set({ zhipuOrganization: value })}
              placeholder={t('admin.accounts.cnProviders.zhipuTeam.organizationPlaceholder')}
            />
            <Input
              label={t('admin.accounts.cnProviders.zhipuTeam.project')}
              value={s.zhipuProject}
              onChange={(value) => set({ zhipuProject: value })}
              placeholder={t('admin.accounts.cnProviders.zhipuTeam.projectPlaceholder')}
            />
          </div>
        </FormSection>
      ) : null}

      {/* Account Type Selection (Gemini) */}
      {platform === 'gemini' ? (
        <FormSection
          title={t('admin.accounts.accountType')}
          action={
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ showGeminiHelpDialog: true })}>
              <Info size={16} aria-hidden="true" />
              {t('admin.accounts.gemini.helpButton')}
            </Button>
          }
        >
          <RadioCards
            aria-label={t('admin.accounts.accountType')}
            data-tour="account-form-type"
            value={s.accountCategory}
            onValueChange={(value) => set({ accountCategory: value as AccountCategory })}
            minColumnWidth={160}
            options={[
              typeCard(
                'oauth-based',
                t('admin.accounts.gemini.accountType.oauthTitle'),
                t('admin.accounts.gemini.accountType.oauthDesc'),
                <KeyRound size={16} />
              ),
              typeCard(
                'apikey',
                t('admin.accounts.gemini.accountType.apiKeyTitle'),
                t('admin.accounts.gemini.accountType.apiKeyDesc'),
                <KeyRound size={16} />
              ),
              typeCard('service_account', t('admin.accounts.vertexLabel'), t('admin.accounts.vertexGeminiDesc'), <Cloud size={16} />)
            ]}
          />

          {s.accountCategory === 'apikey' && officialGeminiBaseUrl ? (
            <div data-testid="gemini-apikey-note">
              <FormNotice tone="info">
                <p>{t('admin.accounts.gemini.accountType.apiKeyNote')}</p>
                <p>
                  <a href={geminiHelpLinks.apiKey} className={formStyles.link} target="_blank" rel="noreferrer">
                    {t('admin.accounts.gemini.accountType.apiKeyLink')}
                  </a>
                </p>
              </FormNotice>
            </div>
          ) : null}

          {s.accountCategory === 'service_account' ? (
            <FormNotice tone="info">
              <p>{t('admin.accounts.vertexGeminiHint')}</p>
            </FormNotice>
          ) : null}

          {/* OAuth Type Selection (only show when oauth-based is selected) */}
          {s.accountCategory === 'oauth-based' ? (
            <FormField label={t('admin.accounts.oauth.gemini.oauthTypeLabel')}>
              <RadioCards
                aria-label={t('admin.accounts.oauth.gemini.oauthTypeLabel')}
                value={s.geminiOAuthType}
                onValueChange={(value) => ctl.handleSelectGeminiOAuthType(value as 'google_one' | 'code_assist')}
                options={[
                  {
                    value: 'google_one',
                    label: 'Google One',
                    icon: <User size={16} />,
                    description: (
                      <>
                        {t('admin.accounts.gemini.oauthType.googleOneDesc')}
                        <Badges
                          items={[
                            t('admin.accounts.gemini.oauthType.badges.individuals'),
                            t('admin.accounts.gemini.oauthType.badges.noGcp')
                          ]}
                        />
                      </>
                    )
                  },
                  {
                    value: 'code_assist',
                    label: 'GCP Code Assist',
                    icon: <Cloud size={16} />,
                    description: (
                      <>
                        {t('admin.accounts.gemini.oauthType.codeAssistDesc')}{' '}
                        {t('admin.accounts.gemini.oauthType.codeAssistRequirement')}{' '}
                        <a href={geminiHelpLinks.gcpProject} className={formStyles.link} target="_blank" rel="noreferrer">
                          {t('admin.accounts.gemini.oauthType.gcpProjectLink')}
                        </a>
                        <Badges
                          items={[
                            t('admin.accounts.gemini.oauthType.badges.enterprise'),
                            t('admin.accounts.gemini.oauthType.badges.highConcurrency')
                          ]}
                        />
                      </>
                    )
                  }
                ]}
              />

              {/* Advanced Options Toggle */}
              <button
                type="button"
                className={formStyles.choice}
                style={{ alignSelf: 'flex-start' }}
                aria-expanded={s.showAdvancedOAuth}
                onClick={() => set({ showAdvancedOAuth: !s.showAdvancedOAuth })}
              >
                {s.showAdvancedOAuth ? (
                  <ChevronDown size={16} aria-hidden="true" />
                ) : (
                  <ChevronRight size={16} aria-hidden="true" />
                )}
                {s.showAdvancedOAuth
                  ? t('admin.accounts.gemini.oauthType.hideAdvanced')
                  : t('admin.accounts.gemini.oauthType.showAdvanced')}
              </button>

              {/* Custom OAuth Client (Advanced) */}
              {s.showAdvancedOAuth ? (
                <RadioCards
                  aria-label={t('admin.accounts.gemini.oauthType.customTitle')}
                  value={s.geminiOAuthType}
                  onValueChange={(value) => ctl.handleSelectGeminiOAuthType(value as 'ai_studio')}
                  layout="list"
                  options={[
                    {
                      value: 'ai_studio',
                      label: t('admin.accounts.gemini.oauthType.customTitle'),
                      icon: <Sparkles size={16} />,
                      disabled: !s.geminiAIStudioOAuthEnabled,
                      disabledReason: t('admin.accounts.oauth.gemini.aiStudioNotConfiguredTip'),
                      meta: !s.geminiAIStudioOAuthEnabled
                        ? t('admin.accounts.oauth.gemini.aiStudioNotConfiguredShort')
                        : undefined,
                      description: (
                        <>
                          {t('admin.accounts.gemini.oauthType.customDesc')}{' '}
                          {t('admin.accounts.gemini.oauthType.customRequirement')}
                          <Badges
                            items={[
                              t('admin.accounts.gemini.oauthType.badges.orgManaged'),
                              t('admin.accounts.gemini.oauthType.badges.adminRequired')
                            ]}
                          />
                        </>
                      )
                    }
                  ]}
                />
              ) : null}
            </FormField>
          ) : null}

          {/* Tier selection (used as fallback when auto-detection is unavailable/fails) */}
          {s.accountCategory === 'oauth-based' ? (
            <FormField
              label={t('admin.accounts.gemini.tier.label')}
              htmlFor="create-gemini-oauth-tier"
              hint={t('admin.accounts.gemini.tier.hint')}
            >
              <div data-testid="gemini-oauth-tier">
                {s.geminiOAuthType === 'google_one' ? (
                  <select
                    id="create-gemini-oauth-tier"
                    value={s.geminiTierGoogleOne}
                    onChange={(event) =>
                      set({ geminiTierGoogleOne: event.target.value as CreateAccountState['geminiTierGoogleOne'] })
                    }
                    className={formStyles.select}
                  >
                    <option value="google_one_free">{t('admin.accounts.gemini.tier.googleOne.free')}</option>
                    <option value="google_ai_pro">{t('admin.accounts.gemini.tier.googleOne.pro')}</option>
                    <option value="google_ai_ultra">{t('admin.accounts.gemini.tier.googleOne.ultra')}</option>
                  </select>
                ) : s.geminiOAuthType === 'code_assist' ? (
                  <select
                    id="create-gemini-oauth-tier"
                    value={s.geminiTierGcp}
                    onChange={(event) => set({ geminiTierGcp: event.target.value as CreateAccountState['geminiTierGcp'] })}
                    className={formStyles.select}
                  >
                    <option value="gcp_standard">{t('admin.accounts.gemini.tier.gcp.standard')}</option>
                    <option value="gcp_enterprise">{t('admin.accounts.gemini.tier.gcp.enterprise')}</option>
                  </select>
                ) : (
                  <select
                    id="create-gemini-oauth-tier"
                    value={s.geminiTierAIStudio}
                    onChange={(event) =>
                      set({ geminiTierAIStudio: event.target.value as CreateAccountState['geminiTierAIStudio'] })
                    }
                    className={formStyles.select}
                  >
                    <option value="aistudio_free">{t('admin.accounts.gemini.tier.aiStudio.free')}</option>
                    <option value="aistudio_paid">{t('admin.accounts.gemini.tier.aiStudio.paid')}</option>
                  </select>
                )}
              </div>
            </FormField>
          ) : null}
        </FormSection>
      ) : null}

      {/* Account Type Selection (Antigravity - OAuth or Upstream) */}
      {platform === 'antigravity' ? (
        <FormSection title={t('admin.accounts.accountType')}>
          <RadioCards
            aria-label={t('admin.accounts.accountType')}
            value={s.antigravityAccountType}
            onValueChange={(value) => set({ antigravityAccountType: value as 'oauth' | 'upstream' })}
            options={[
              {
                value: 'oauth',
                label: 'OAuth',
                description: t('admin.accounts.types.antigravityOauth'),
                icon: <KeyRound size={16} />
              },
              {
                value: 'upstream',
                label: 'API Key',
                description: t('admin.accounts.types.antigravityApikey'),
                icon: <Cloud size={16} />
              }
            ]}
          />

          {s.antigravityAccountType === 'oauth' ? (
            <Input
              label={t('admin.accounts.antigravityProjectIdLabel')}
              value={s.antigravityProjectId}
              onChange={(value) => set({ antigravityProjectId: value })}
              data-testid="antigravity-project-id-input"
              className={formStyles.mono}
              placeholder={t('admin.accounts.antigravityProjectIdPlaceholder')}
              hint={t('admin.accounts.antigravityProjectIdHint')}
            />
          ) : null}

          {/* Upstream config (only for Antigravity upstream type) */}
          {s.antigravityAccountType === 'upstream' ? (
            <>
              <Input
                label={t('admin.accounts.upstream.baseUrl')}
                value={s.upstreamBaseUrl}
                onChange={(value) => set({ upstreamBaseUrl: value })}
                required
                placeholder="https://cloudcode-pa.googleapis.com"
                hint={t('admin.accounts.upstream.baseUrlHint')}
              />
              <Input
                label={t('admin.accounts.upstream.apiKey')}
                type="password"
                value={s.upstreamApiKey}
                onChange={(value) => set({ upstreamApiKey: value })}
                required
                className={formStyles.mono}
                placeholder="sk-..."
                hint={t('admin.accounts.upstream.apiKeyHint')}
              />
              {/* 上游倍率自动探测：antigravity upstream 也是 API-key 账号 */}
              <ToggleRow
                data-testid="upstream-billing-auto-probe-antigravity"
                label={t('admin.accounts.upstreamBilling.autoProbe')}
                description={t('admin.accounts.upstreamBilling.autoProbeHint')}
                checked={s.upstreamBillingAutoProbeEnabled}
                onChange={(value) => set({ upstreamBillingAutoProbeEnabled: value })}
              />
            </>
          ) : null}
        </FormSection>
      ) : null}

      {/* Vertex Service Account */}
      {(platform === 'gemini' || platform === 'anthropic') && s.accountCategory === 'service_account' ? (
        <FormSection>
          {platform === 'gemini' ? (
            <RadioGroup
              label={t('admin.accounts.vertexAuthMode')}
              name="create-vertex-auth-mode"
              value={s.vertexAuthMode}
              onValueChange={(value) => set({ vertexAuthMode: value as 'service_account' | 'apikey' })}
              options={[
                { value: 'service_account', label: t('admin.accounts.vertexAuthModeServiceAccount') },
                { value: 'apikey', label: t('admin.accounts.vertexAuthModeApiKey') }
              ]}
            />
          ) : null}

          {vertexUsesApiKey(s) ? (
            <>
              <Input
                label="API Key"
                type="password"
                value={s.vertexApiKey}
                onChange={(value) => set({ vertexApiKey: value })}
                required
                className={formStyles.mono}
                data-testid="vertex-api-key-input"
                hint={t('admin.accounts.vertexApiKeyHint')}
              />
              <div className={formStyles.grid2}>
                <Input
                  label="Project ID"
                  value={s.vertexProjectId}
                  onChange={(value) => set({ vertexProjectId: value })}
                  className={formStyles.mono}
                  data-testid="vertex-api-key-project-id-input"
                  placeholder={t('admin.accounts.vertexApiKeyProjectIdPlaceholder')}
                  hint={t('admin.accounts.vertexApiKeyProjectIdHint')}
                />
                {s.vertexProjectId.trim() ? vertexLocationSelect : null}
              </div>
            </>
          ) : (
            <>
              <FormField label="Service Account JSON" hint={t('admin.accounts.vertexSaJsonUploadHint')}>
                <input
                  ref={vertexFileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className={styles.hidden}
                  onChange={(event) => void ctl.handleVertexServiceAccountFile(event.currentTarget)}
                />
                <div
                  className={styles.dropZone}
                  data-active={s.vertexServiceAccountDragActive}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    set({ vertexServiceAccountDragActive: true })
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    set({ vertexServiceAccountDragActive: true })
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    set({ vertexServiceAccountDragActive: false })
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    void ctl.handleVertexServiceAccountDrop(event.dataTransfer?.files?.[0])
                  }}
                >
                  <div className={styles.dropHead}>
                    <div>
                      <div className={styles.dropTitle}>
                        <Upload size={16} aria-hidden="true" />
                        <span>
                          {s.vertexClientEmail ? t('admin.accounts.vertexSaJsonLoaded') : t('admin.accounts.vertexSaJsonDrop')}
                        </span>
                      </div>
                      <p className={formStyles.hint}>
                        {s.vertexClientEmail
                          ? t('admin.accounts.vertexSaJsonKeyHidden')
                          : t('admin.accounts.vertexSaJsonDropHint')}
                      </p>
                    </div>
                    <Button type="button" variant="secondary" size="sm" onClick={() => vertexFileInputRef.current?.click()}>
                      <Upload size={16} aria-hidden="true" />
                      {t('admin.accounts.vertexSaJsonSelectBtn')}
                    </Button>
                  </div>
                  {s.vertexClientEmail ? (
                    <div className={styles.dropInfo}>
                      <span>
                        Project ID: <span className={formStyles.mono}>{s.vertexProjectId}</span>
                      </span>
                      <span>
                        Client Email: <span className={formStyles.mono}>{s.vertexClientEmail}</span>
                      </span>
                    </div>
                  ) : null}
                </div>
              </FormField>

              <div className={formStyles.grid2}>
                <Input
                  label="Project ID"
                  value={s.vertexProjectId}
                  onChange={(value) => set({ vertexProjectId: value })}
                  className={formStyles.mono}
                  readOnly
                  placeholder={t('admin.accounts.vertexProjectIdPlaceholder')}
                />
                {vertexLocationSelect}
              </div>
            </>
          )}
        </FormSection>
      ) : null}

      {/* Antigravity model restriction (applies to OAuth + Upstream) */}
      {/* Antigravity 只支持模型映射模式，不支持白名单模式 */}
      {platform === 'antigravity' ? (
        <FormSection title={t('admin.accounts.modelRestriction')}>
          {/* Mapping Mode Only (no toggle for Antigravity) */}
          <FormNotice tone="info">
            <p>{t('admin.accounts.mapRequestModels')}</p>
          </FormNotice>
          <MappingRows
            rows={s.antigravityModelMappings}
            fromPlaceholder={t('admin.accounts.requestModel')}
            toPlaceholder={t('admin.accounts.actualModel')}
            onUpdate={(index, patch) => ctl.updateMappingRow('antigravityModelMappings', index, patch)}
            onRemove={(index) => ctl.removeMappingRow('antigravityModelMappings', index)}
            validate
            wildcardError={t('admin.accounts.wildcardOnlyAtEnd')}
            targetError={t('admin.accounts.targetNoWildcard')}
            removeLabel={t('common.delete')}
          />
          {addMappingButton(() => ctl.addMappingRow('antigravityModelMappings'))}
          <PresetButtons
            presets={getPresetMappingsByPlatform('antigravity')}
            onAdd={(from, to) => ctl.addAntigravityPresetMapping(from, to)}
          />
        </FormSection>
      ) : null}

      {/* Add Method (only for Anthropic OAuth-based type) */}
      {platform === 'anthropic' && oauthOAuthFlow ? (
        <FormSection>
          <RadioGroup
            label={t('admin.accounts.addMethod')}
            name="create-add-method"
            value={s.addMethod}
            onValueChange={(value) => set({ addMethod: value as 'oauth' | 'setup-token' })}
            options={[
              { value: 'oauth', label: t('admin.accounts.types.oauth') },
              { value: 'setup-token', label: t('admin.accounts.setupTokenLongLived') }
            ]}
          />
        </FormSection>
      ) : null}

      {/* API Key input (only for apikey type, excluding Antigravity which has its own fields) */}
      {form.type === 'apikey' && platform !== 'antigravity' ? (
        <>
          <FormSection>
            {!multiProtocol || s.apiProtocol !== 'adaptive' ? (
              <div className={formStyles.stackTight}>
                <Input
                  label={t('admin.accounts.baseUrl')}
                  value={s.apiKeyBaseUrl}
                  onChange={(value) => set({ apiKeyBaseUrl: value })}
                  placeholder={apiKeyBaseUrlPlaceholder}
                  hint={baseUrlHint || undefined}
                />
                {platform === 'grok' ? <GrokBaseUrlPresets onSelect={(url) => set({ apiKeyBaseUrl: url })} /> : null}
                {cnPlatform && !openCodeGo ? (
                  <CnBaseUrlPresets
                    platform={cnPresetPlatform(s)}
                    mode={cnPresetMode(s)}
                    protocol={s.apiProtocol}
                    currentUrl={s.apiKeyBaseUrl}
                    onSelect={(preset) => ctl.onCnPresetSelect(preset)}
                  />
                ) : null}
              </div>
            ) : (
              <FormField
                label={t('admin.accounts.cnProviders.apiProtocol.endpoints')}
                hint={
                  !cnSupportsNativeResponses(platform, currentOpenCodeOrCNMode(s))
                    ? t('admin.accounts.cnProviders.apiProtocol.responsesFallbackDesc')
                    : undefined
                }
              >
                <div className={formStyles.stack}>
                  {cnAdaptiveProtocolOptions(s).map((item) => (
                    <Input
                      key={item.value}
                      label={t(`admin.accounts.cnProviders.apiProtocol.${item.labelKey}`)}
                      value={s.adaptiveBaseUrls[item.value]}
                      onChange={(value) => set({ adaptiveBaseUrls: { ...ctl.get().adaptiveBaseUrls, [item.value]: value } })}
                      data-testid={`cn-adaptive-base-url-${item.value}`}
                    />
                  ))}
                </div>
              </FormField>
            )}
            {routesByModel(s) && s.apiProtocol === 'adaptive' ? (
              <OpenCodeGoProtocolRulesEditor
                rows={s.openCodeGoProtocolRules}
                onChange={(rows) => set({ openCodeGoProtocolRules: rows })}
                platform={platform}
                plan={currentOpenCodeOrCNMode(s)}
              />
            ) : null}
            <Input
              label={t('admin.accounts.apiKeyRequired')}
              type="password"
              value={s.apiKeyValue}
              onChange={(value) => set({ apiKeyValue: value })}
              required
              className={formStyles.mono}
              placeholder={apiKeyValuePlaceholder}
              hint={apiKeyHint || undefined}
            />

            {/* 上游倍率自动探测：全部 API-key 平台可用（所在区块已限定 apikey 类型） */}
            <ToggleRow
              data-testid="upstream-billing-auto-probe"
              label={t('admin.accounts.upstreamBilling.autoProbe')}
              description={t('admin.accounts.upstreamBilling.autoProbeHint')}
              checked={s.upstreamBillingAutoProbeEnabled}
              onChange={(value) => set({ upstreamBillingAutoProbeEnabled: value })}
            />

            {/* Gemini API Key tier selection */}
            {platform === 'gemini' && officialGeminiBaseUrl ? (
              <FormField
                label={t('admin.accounts.gemini.tier.label')}
                htmlFor="create-gemini-apikey-tier"
                hint={t('admin.accounts.gemini.tier.aiStudioHint')}
              >
                <select
                  id="create-gemini-apikey-tier"
                  value={s.geminiTierAIStudio}
                  onChange={(event) =>
                    set({ geminiTierAIStudio: event.target.value as CreateAccountState['geminiTierAIStudio'] })
                  }
                  className={formStyles.select}
                  data-testid="gemini-apikey-tier"
                >
                  <option value="aistudio_free">{t('admin.accounts.gemini.tier.aiStudio.free')}</option>
                  <option value="aistudio_paid">{t('admin.accounts.gemini.tier.aiStudio.paid')}</option>
                </select>
              </FormField>
            ) : null}
          </FormSection>

          {/* Model Restriction Section (Antigravity 已在上层条件排除) */}
          {modelRestrictionSection}

          {/* Pool Mode Section */}
          {poolModeSection}

          {/* Gemini 显式缓存上游开关：仅自定义地址的 Gemini API Key 账号 */}
          {platform === 'gemini' && !officialGeminiBaseUrl ? (
            <FormSection>
              <div data-testid="explicit-cache-upstream-section">
                <ToggleRow
                  data-testid="explicit-cache-upstream-toggle"
                  label={t('admin.accounts.explicitCacheUpstream')}
                  description={t('admin.accounts.explicitCacheUpstreamHint')}
                  checked={s.explicitCacheUpstreamEnabled}
                  onChange={(value) => set({ explicitCacheUpstreamEnabled: value })}
                />
                {s.explicitCacheUpstreamEnabled ? (
                  <div className={formStyles.stack} style={{ marginTop: 'var(--space-3)' }}>
                    <FormNotice tone="info">
                      <p>{t('admin.accounts.explicitCacheUpstreamInfo')}</p>
                    </FormNotice>
                    <Input
                      label={t('admin.accounts.explicitCacheUpstreamMaxTTL')}
                      type="number"
                      min={1}
                      step={1}
                      value={s.explicitCacheUpstreamMaxTTL}
                      onChange={(value) => set({ explicitCacheUpstreamMaxTTL: value })}
                      data-testid="explicit-cache-upstream-max-ttl"
                      placeholder="86400"
                      hint={t('admin.accounts.explicitCacheUpstreamMaxTTLHint')}
                    />
                  </div>
                ) : null}
              </div>
            </FormSection>
          ) : null}

          {/* Custom Error Codes Section */}
          <FormSection>
            <ToggleRow
              label={t('admin.accounts.customErrorCodes')}
              description={t('admin.accounts.customErrorCodesHint')}
              checked={s.customErrorCodesEnabled}
              onChange={(value) => set({ customErrorCodesEnabled: value })}
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
                        onClick={() => void ctl.toggleErrorCode(code.value)}
                      >
                        {code.value} {code.label}
                      </button>
                    ))}
                  </div>
                  {/* Manual input */}
                  <div className={formStyles.editRow}>
                    <input
                      value={s.customErrorCodeInput ?? ''}
                      onChange={(event) => set({ customErrorCodeInput: toNumber(event.target.value) })}
                      onKeyUp={(event) => {
                        if (event.key === 'Enter') void ctl.addCustomErrorCode()
                      }}
                      type="number"
                      min={100}
                      max={599}
                      className={formStyles.input}
                      aria-label={t('admin.accounts.enterErrorCode')}
                      placeholder={t('admin.accounts.enterErrorCode')}
                    />
                    <button
                      type="button"
                      className={formStyles.iconButton}
                      aria-label={t('admin.accounts.enterErrorCode')}
                      onClick={() => void ctl.addCustomErrorCode()}
                    >
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {/* Selected codes summary */}
                  <div className={formStyles.chips}>
                    {s.selectedErrorCodes.map((code) => (
                      <span key={code} className={formStyles.chip}>
                        {code}
                        <button
                          type="button"
                          className={formStyles.chipRemove}
                          aria-label={`${t('common.delete')} ${code}`}
                          onClick={() => ctl.removeErrorCode(code)}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    {s.selectedErrorCodes.length === 0 ? (
                      <span className={formStyles.hint}>{t('admin.accounts.noneSelectedUsesDefault')}</span>
                    ) : null}
                  </div>
                </>
              ) : null}
            </ToggleRow>
          </FormSection>

          {/* Header Override Section (eligible API-key platforms) */}
          {isHeaderOverrideCapable(platform, 'apikey') ? <FormSection>{headerOverrideToggle}</FormSection> : null}
        </>
      ) : null}

      {/* Bedrock credentials (only for Anthropic Bedrock type) */}
      {platform === 'anthropic' && s.accountCategory === 'bedrock' ? (
        <>
          <FormSection>
            {/* Auth Mode Radio */}
            <RadioGroup
              label={t('admin.accounts.bedrockAuthMode')}
              name="create-bedrock-auth-mode"
              value={s.bedrockAuthMode}
              onValueChange={(value) => set({ bedrockAuthMode: value as 'sigv4' | 'apikey' })}
              options={[
                { value: 'sigv4', label: t('admin.accounts.bedrockAuthModeSigv4') },
                { value: 'apikey', label: t('admin.accounts.bedrockAuthModeApikey') }
              ]}
            />

            {/* SigV4 fields */}
            {s.bedrockAuthMode === 'sigv4' ? (
              <>
                <Input
                  label={t('admin.accounts.bedrockAccessKeyId')}
                  value={s.bedrockAccessKeyId}
                  onChange={(value) => set({ bedrockAccessKeyId: value })}
                  required
                  className={formStyles.mono}
                  placeholder="AKIA..."
                />
                <Input
                  label={t('admin.accounts.bedrockSecretAccessKey')}
                  type="password"
                  value={s.bedrockSecretAccessKey}
                  onChange={(value) => set({ bedrockSecretAccessKey: value })}
                  required
                  className={formStyles.mono}
                />
                <Input
                  label={t('admin.accounts.bedrockSessionToken')}
                  type="password"
                  value={s.bedrockSessionToken}
                  onChange={(value) => set({ bedrockSessionToken: value })}
                  className={formStyles.mono}
                  hint={t('admin.accounts.bedrockSessionTokenHint')}
                />
              </>
            ) : null}

            {/* API Key field */}
            {s.bedrockAuthMode === 'apikey' ? (
              <Input
                label={t('admin.accounts.bedrockApiKeyInput')}
                type="password"
                value={s.bedrockApiKeyValue}
                onChange={(value) => set({ bedrockApiKeyValue: value })}
                required
                className={formStyles.mono}
              />
            ) : null}

            {/* Shared: Region */}
            <FormField
              label={t('admin.accounts.bedrockRegion')}
              htmlFor="create-bedrock-region"
              hint={t('admin.accounts.bedrockRegionHint')}
            >
              <select
                id="create-bedrock-region"
                value={s.bedrockRegion}
                onChange={(event) => set({ bedrockRegion: event.target.value })}
                className={formStyles.select}
              >
                {BEDROCK_REGIONS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </FormField>

            {/* Shared: Force Global */}
            <FormField hint={t('admin.accounts.bedrockForceGlobalHint')}>
              <Checkbox
                checked={s.bedrockForceGlobal}
                onCheckedChange={(value) => set({ bedrockForceGlobal: value === true })}
                label={t('admin.accounts.bedrockForceGlobal')}
              />
            </FormField>
          </FormSection>

          {/* Model Restriction Section for Bedrock */}
          <FormSection title={t('admin.accounts.modelRestriction')}>
            {restrictionModeToggle}
            {s.modelRestrictionMode === 'whitelist' ? (
              whitelistBlock('anthropic')
            ) : (
              <div className={formStyles.stack}>
                {mappingRows('admin.accounts.fromModel', 'admin.accounts.toModel')}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => ctl.addMappingRow('modelMappings')}
                >
                  + {t('admin.accounts.addMapping')}
                </Button>
                {/* Bedrock Preset Mappings */}
                <PresetButtons presets={getPresetMappingsByPlatform('bedrock')} onAdd={(from, to) => ctl.addPresetMapping(from, to)} />
              </div>
            )}
          </FormSection>

          {/* Pool Mode Section for Bedrock */}
          {poolModeSection}
        </>
      ) : null}

      {/* 配额控制 (Anthropic apikey/bedrock: 配额限制 + 亲和) */}
      {platform === 'anthropic' && (form.type === 'apikey' || form.type === 'bedrock') ? (
        <FormSection title={t('admin.accounts.quotaControl.title')} description={t('admin.accounts.quotaControl.hint')}>
          {quotaLimitCard}
        </FormSection>
      ) : supportsAccountQuota(form.type) ? (
        /* 配额控制 (非 Anthropic apikey/bedrock，以及 Vertex service_account) */
        <FormSection title={t('admin.accounts.quotaControl.title')} description={t('admin.accounts.quotaLimitHint')}>
          {quotaLimitCard}
        </FormSection>
      ) : null}

      {/* Grok OAuth Custom Upstream URL (仅改写转发端点，OAuth 授权/刷新不受影响) */}
      {platform === 'grok' && oauthOAuthFlow ? (
        <FormSection>
          <ToggleRow
            data-testid="grok-custom-base-url-toggle"
            label={t('admin.accounts.grokCustomBaseUrl.title')}
            description={t('admin.accounts.grokCustomBaseUrl.hint')}
            checked={s.grokOAuthCustomBaseUrlEnabled}
            onChange={(value) => set({ grokOAuthCustomBaseUrlEnabled: value })}
          >
            {s.grokOAuthCustomBaseUrlEnabled ? (
              <>
                <Input
                  aria-label={t('admin.accounts.grokCustomBaseUrl.title')}
                  value={s.grokOAuthBaseUrl}
                  onChange={(value) => set({ grokOAuthBaseUrl: value })}
                  data-testid="grok-custom-base-url-input"
                  placeholder={t('admin.accounts.grokCustomBaseUrl.placeholder')}
                />
                <GrokBaseUrlPresets onSelect={(url) => set({ grokOAuthBaseUrl: url })} />
              </>
            ) : null}
          </ToggleRow>
        </FormSection>
      ) : null}

      {/* Grok OAuth Header Override (OAuth 类型没有 apikey 容器，需要独立区域) */}
      {platform === 'grok' && oauthOAuthFlow ? <FormSection>{headerOverrideToggle}</FormSection> : null}

      {/* OpenAI OAuth Model Mapping (OAuth 类型没有 apikey 容器，需要独立的模型映射区域) */}
      {(platform === 'openai' || platform === 'grok') && oauthOAuthFlow ? modelRestrictionSection : null}

      {/* Temp Unschedulable Rules */}
      <FormSection>
        <ToggleRow
          label={t('admin.accounts.tempUnschedulable.title')}
          description={t('admin.accounts.tempUnschedulable.hint')}
          checked={s.tempUnschedEnabled}
          onChange={(value) => set({ tempUnschedEnabled: value })}
        >
          {s.tempUnschedEnabled ? (
            <>
              <FormNotice tone="info">
                <p>{t('admin.accounts.tempUnschedulable.notice')}</p>
              </FormNotice>
              <div className={formStyles.choiceGroup}>
                {tempUnschedPresets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={formStyles.choice}
                    onClick={() => ctl.addTempUnschedRule(preset.rule)}
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
              {s.tempUnschedRules.map((rule, index) => (
                <div key={rule.key} className={styles.ruleItem}>
                  <div className={styles.ruleHeader}>
                    <span className={styles.ruleIndex}>
                      {t('admin.accounts.tempUnschedulable.ruleIndex', { index: index + 1 })}
                    </span>
                    <div className={formStyles.row}>
                      <button
                        type="button"
                        className={formStyles.iconButton}
                        disabled={index === 0}
                        aria-label="Move up"
                        onClick={() => ctl.moveTempUnschedRule(index, -1)}
                      >
                        <ChevronUp size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={formStyles.iconButton}
                        disabled={index === s.tempUnschedRules.length - 1}
                        aria-label="Move down"
                        onClick={() => ctl.moveTempUnschedRule(index, 1)}
                      >
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={formStyles.iconButton}
                        data-tone="danger"
                        aria-label={t('common.delete')}
                        onClick={() => ctl.removeTempUnschedRule(index)}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className={formStyles.grid2}>
                    <Input
                      label={t('admin.accounts.tempUnschedulable.errorCode')}
                      type="number"
                      min={100}
                      max={599}
                      value={rule.error_code}
                      onChange={(value) => ctl.updateTempUnschedRule(index, { error_code: toNumber(value) })}
                      placeholder={t('admin.accounts.tempUnschedulable.errorCodePlaceholder')}
                    />
                    <Input
                      label={t('admin.accounts.tempUnschedulable.durationMinutes')}
                      type="number"
                      min={1}
                      value={rule.duration_minutes}
                      onChange={(value) => ctl.updateTempUnschedRule(index, { duration_minutes: toNumber(value) })}
                      placeholder={t('admin.accounts.tempUnschedulable.durationPlaceholder')}
                    />
                    <FormField
                      label={t('admin.accounts.tempUnschedulable.scope')}
                      hint={t('admin.accounts.tempUnschedulable.scopeHint')}
                      className={styles.span2}
                    >
                      <RadioCards
                        aria-label={t('admin.accounts.tempUnschedulable.scope')}
                        value={rule.scope}
                        onValueChange={(value) =>
                          ctl.updateTempUnschedRule(index, { scope: value as TempUnschedulableScope })
                        }
                        options={tempUnschedScopeOptions.map((option) => ({
                          value: option.value,
                          label: <CardLabel testId={`temp-unsched-scope-${option.value}`}>{option.label}</CardLabel>,
                          description: option.description
                        }))}
                      />
                    </FormField>
                    <div className={styles.span2}>
                      <Input
                        label={t('admin.accounts.tempUnschedulable.keywords')}
                        value={rule.keywords}
                        onChange={(value) => ctl.updateTempUnschedRule(index, { keywords: value })}
                        placeholder={t('admin.accounts.tempUnschedulable.keywordsPlaceholder')}
                        hint={t('admin.accounts.tempUnschedulable.keywordsHint')}
                      />
                    </div>
                    <div className={styles.span2}>
                      <Input
                        label={t('admin.accounts.tempUnschedulable.description')}
                        value={rule.description}
                        onChange={(value) => ctl.updateTempUnschedRule(index, { description: value })}
                        placeholder={t('admin.accounts.tempUnschedulable.descriptionPlaceholder')}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" className={styles.addRow} onClick={() => ctl.addTempUnschedRule()}>
                <Plus size={16} aria-hidden="true" />
                {t('admin.accounts.tempUnschedulable.addRule')}
              </button>
            </>
          ) : null}
        </ToggleRow>
      </FormSection>

      {/* Intercept Warmup Requests (Anthropic/Antigravity) */}
      {platform === 'anthropic' || platform === 'antigravity' ? (
        <FormSection>
          <ToggleRow
            label={t('admin.accounts.interceptWarmupRequests')}
            description={t('admin.accounts.interceptWarmupRequestsDesc')}
            checked={s.interceptWarmupRequests}
            onChange={(value) => set({ interceptWarmupRequests: value })}
          />
        </FormSection>
      ) : null}

      {/* 配额控制 (Anthropic OAuth/SetupToken: 亲和 + 窗口费用 + 会话 + RPM 等) */}
      {platform === 'anthropic' && s.accountCategory === 'oauth-based' ? (
        <FormSection title={t('admin.accounts.quotaControl.title')} description={t('admin.accounts.quotaControl.hint')}>
          {/* Window Cost Limit */}
          <ToggleRow
            label={t('admin.accounts.quotaControl.windowCost.label')}
            description={t('admin.accounts.quotaControl.windowCost.hint')}
            checked={s.windowCostEnabled}
            onChange={(value) => set({ windowCostEnabled: value })}
          >
            {s.windowCostEnabled ? (
              <div className={formStyles.grid2}>
                {numberField(t('admin.accounts.quotaControl.windowCost.limit'), s.windowCostLimit, (v) => set({ windowCostLimit: v }), {
                  min: 0,
                  prefix: '$',
                  placeholder: t('admin.accounts.quotaControl.windowCost.limitPlaceholder'),
                  hint: t('admin.accounts.quotaControl.windowCost.limitHint')
                })}
                {numberField(
                  t('admin.accounts.quotaControl.windowCost.stickyReserve'),
                  s.windowCostStickyReserve,
                  (v) => set({ windowCostStickyReserve: v }),
                  {
                    min: 0,
                    prefix: '$',
                    placeholder: t('admin.accounts.quotaControl.windowCost.stickyReservePlaceholder'),
                    hint: t('admin.accounts.quotaControl.windowCost.stickyReserveHint')
                  }
                )}
              </div>
            ) : null}
          </ToggleRow>

          {/* Session Limit */}
          <ToggleRow
            label={t('admin.accounts.quotaControl.sessionLimit.label')}
            description={t('admin.accounts.quotaControl.sessionLimit.hint')}
            checked={s.sessionLimitEnabled}
            onChange={(value) => set({ sessionLimitEnabled: value })}
          >
            {s.sessionLimitEnabled ? (
              <div className={formStyles.grid2}>
                {numberField(t('admin.accounts.quotaControl.sessionLimit.maxSessions'), s.maxSessions, (v) => set({ maxSessions: v }), {
                  min: 1,
                  placeholder: t('admin.accounts.quotaControl.sessionLimit.maxSessionsPlaceholder'),
                  hint: t('admin.accounts.quotaControl.sessionLimit.maxSessionsHint')
                })}
                {numberField(
                  t('admin.accounts.quotaControl.sessionLimit.idleTimeout'),
                  s.sessionIdleTimeout,
                  (v) => set({ sessionIdleTimeout: v }),
                  {
                    min: 1,
                    suffix: t('common.minutes'),
                    placeholder: t('admin.accounts.quotaControl.sessionLimit.idleTimeoutPlaceholder'),
                    hint: t('admin.accounts.quotaControl.sessionLimit.idleTimeoutHint')
                  }
                )}
              </div>
            ) : null}
          </ToggleRow>

          {/* RPM Limit */}
          <ToggleRow
            label={t('admin.accounts.quotaControl.rpmLimit.label')}
            description={t('admin.accounts.quotaControl.rpmLimit.hint')}
            checked={s.rpmLimitEnabled}
            onChange={(value) => set({ rpmLimitEnabled: value })}
          >
            {s.rpmLimitEnabled ? (
              <>
                {numberField(t('admin.accounts.quotaControl.rpmLimit.baseRpm'), s.baseRpm, (v) => set({ baseRpm: v }), {
                  min: 1,
                  max: 1000,
                  placeholder: t('admin.accounts.quotaControl.rpmLimit.baseRpmPlaceholder'),
                  hint: t('admin.accounts.quotaControl.rpmLimit.baseRpmHint')
                })}
                <FormField label={t('admin.accounts.quotaControl.rpmLimit.strategy')}>
                  <RadioCards
                    aria-label={t('admin.accounts.quotaControl.rpmLimit.strategy')}
                    value={s.rpmStrategy}
                    onValueChange={(value) => set({ rpmStrategy: value as 'tiered' | 'sticky_exempt' })}
                    options={[
                      {
                        value: 'tiered',
                        label: t('admin.accounts.quotaControl.rpmLimit.strategyTiered'),
                        description: t('admin.accounts.quotaControl.rpmLimit.strategyTieredHint')
                      },
                      {
                        value: 'sticky_exempt',
                        label: t('admin.accounts.quotaControl.rpmLimit.strategyStickyExempt'),
                        description: t('admin.accounts.quotaControl.rpmLimit.strategyStickyExemptHint')
                      }
                    ]}
                  />
                </FormField>
                {s.rpmStrategy === 'tiered'
                  ? numberField(
                      t('admin.accounts.quotaControl.rpmLimit.stickyBuffer'),
                      s.rpmStickyBuffer,
                      (v) => set({ rpmStickyBuffer: v }),
                      {
                        min: 1,
                        placeholder: t('admin.accounts.quotaControl.rpmLimit.stickyBufferPlaceholder'),
                        hint: t('admin.accounts.quotaControl.rpmLimit.stickyBufferHint')
                      }
                    )
                  : null}
              </>
            ) : null}
          </ToggleRow>

          {/* 用户消息限速模式（独立于 RPM 开关，始终可见） */}
          <FormField
            label={t('admin.accounts.quotaControl.rpmLimit.userMsgQueue')}
            hint={t('admin.accounts.quotaControl.rpmLimit.userMsgQueueHint')}
          >
            <SegmentedControl
              label={t('admin.accounts.quotaControl.rpmLimit.userMsgQueue')}
              value={s.userMsgQueueMode}
              onValueChange={(value) => set({ userMsgQueueMode: value })}
              options={umqModeOptions}
            />
          </FormField>

          {/* TLS Fingerprint */}
          <ToggleRow
            label={t('admin.accounts.quotaControl.tlsFingerprint.label')}
            description={t('admin.accounts.quotaControl.tlsFingerprint.hint')}
            checked={s.tlsFingerprintEnabled}
            onChange={(value) => set({ tlsFingerprintEnabled: value })}
          >
            {/* Profile selector */}
            {s.tlsFingerprintEnabled ? (
              <select
                value={s.tlsFingerprintProfileId === null ? '' : String(s.tlsFingerprintProfileId)}
                onChange={(event) =>
                  set({ tlsFingerprintProfileId: event.target.value === '' ? null : Number(event.target.value) })
                }
                aria-label={t('admin.accounts.quotaControl.tlsFingerprint.label')}
                className={formStyles.select}
              >
                <option value="">{t('admin.accounts.quotaControl.tlsFingerprint.defaultProfile')}</option>
                {s.tlsFingerprintProfiles.length > 0 ? (
                  <option value="-1">{t('admin.accounts.quotaControl.tlsFingerprint.randomProfile')}</option>
                ) : null}
                {s.tlsFingerprintProfiles.map((profile) => (
                  <option key={profile.id} value={String(profile.id)}>
                    {profile.name}
                  </option>
                ))}
              </select>
            ) : null}
          </ToggleRow>

          {/* Session ID Masking */}
          <ToggleRow
            label={t('admin.accounts.quotaControl.sessionIdMasking.label')}
            description={t('admin.accounts.quotaControl.sessionIdMasking.hint')}
            checked={s.sessionIdMaskingEnabled}
            onChange={(value) => set({ sessionIdMaskingEnabled: value })}
          />

          {/* Cache TTL Override */}
          <ToggleRow
            label={t('admin.accounts.quotaControl.cacheTTLOverride.label')}
            description={t('admin.accounts.quotaControl.cacheTTLOverride.hint')}
            checked={s.cacheTTLOverrideEnabled}
            onChange={(value) => set({ cacheTTLOverrideEnabled: value })}
          >
            {s.cacheTTLOverrideEnabled ? (
              <FormField
                label={t('admin.accounts.quotaControl.cacheTTLOverride.target')}
                htmlFor="create-cache-ttl-target"
                hint={t('admin.accounts.quotaControl.cacheTTLOverride.targetHint')}
              >
                <select
                  id="create-cache-ttl-target"
                  value={s.cacheTTLOverrideTarget}
                  onChange={(event) => set({ cacheTTLOverrideTarget: event.target.value })}
                  className={formStyles.select}
                >
                  <option value="5m">5m</option>
                  <option value="1h">1h</option>
                </select>
              </FormField>
            ) : null}
          </ToggleRow>

          {/* Custom Base URL Relay */}
          <ToggleRow
            label={t('admin.accounts.quotaControl.customBaseUrl.label')}
            description={t('admin.accounts.quotaControl.customBaseUrl.hint')}
            checked={s.customBaseUrlEnabled}
            onChange={(value) => set({ customBaseUrlEnabled: value })}
          >
            {s.customBaseUrlEnabled ? (
              <Input
                aria-label={t('admin.accounts.quotaControl.customBaseUrl.label')}
                value={s.customBaseUrl}
                onChange={(value) => set({ customBaseUrl: value })}
                placeholder={t('admin.accounts.quotaControl.customBaseUrl.urlHint')}
              />
            ) : null}
          </ToggleRow>
        </FormSection>
      ) : null}

      <FormSection>
        <FormField label={t('admin.accounts.proxy')} labelExtra={<ProxyAdBanner />}>
          <ProxySelector value={form.proxy_id} onChange={(value) => setForm({ proxy_id: value })} proxies={proxies} />
        </FormField>

        <UpstreamRequestIdHeaderField
          value={s.upstreamRequestIdHeader}
          onChange={(value) => set({ upstreamRequestIdHeader: value })}
          platform={platform}
          type={form.type}
        />

        <div className={formStyles.grid3}>
          <Input
            label={t('admin.accounts.concurrency')}
            type="number"
            min={1}
            value={form.concurrency}
            onChange={(value) => setForm({ concurrency: Math.max(1, toNumber(value) || 1) })}
          />
          <Input
            label={t('admin.accounts.loadFactor')}
            type="number"
            min={1}
            value={form.load_factor}
            placeholder={String(form.concurrency || 1)}
            onChange={(value) => {
              const parsed = toNumber(value)
              setForm({ load_factor: parsed && parsed >= 1 ? parsed : null })
            }}
            hint={t('admin.accounts.loadFactorHint')}
          />
          <Input
            label={t('admin.accounts.billingRateMultiplier')}
            type="number"
            min={0}
            step={0.001}
            value={form.rate_multiplier}
            onChange={(value) => setForm({ rate_multiplier: (toNumber(value) ?? '') as number })}
            hint={t('admin.accounts.billingRateMultiplierHint')}
          />
        </div>
      </FormSection>

      <FormSection>
        <FormField
          label={t('admin.accounts.expiresAt')}
          htmlFor="create-account-expires-at"
          hint={`${t('admin.accounts.expiresAtHint')} ${t('admin.accounts.expiresAtTimezoneHint', { timezone: browserTimeZone })}`}
        >
          <input
            id="create-account-expires-at"
            value={formatDateTimeLocalInput(form.expires_at)}
            onChange={(event) => setForm({ expires_at: parseDateTimeLocalInput(event.target.value) })}
            type="datetime-local"
            className={formStyles.input}
          />
          <div className={formStyles.row}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setForm({ expires_at: getAccountExpiryTimestamp(1) })}
            >
              {t('payment.oneMonth')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setForm({ expires_at: getAccountExpiryTimestamp(12) })}
            >
              {t('payment.oneYear')}
            </Button>
          </div>
        </FormField>
      </FormSection>

      {/* OpenAI 自动透传开关（OAuth/API Key） */}
      {platform === 'openai' ? (
        <FormSection>
          <ToggleRow
            label={t('admin.accounts.openai.oauthPassthrough')}
            description={t('admin.accounts.openai.oauthPassthroughDesc')}
            checked={s.openaiPassthroughEnabled}
            onChange={(value) => set({ openaiPassthroughEnabled: value })}
          />
        </FormSection>
      ) : null}

      {/* OpenAI Codex namespace 工具摊平（兼容开关，仅 OAuth） */}
      {platform === 'openai' && form.type === 'oauth' ? (
        <FormSection>
          <ToggleRow
            data-testid="create-openai-flatten-namespaces-toggle"
            label={t('admin.accounts.openai.flattenNamespaces')}
            description={t('admin.accounts.openai.flattenNamespacesDesc')}
            checked={s.openaiFlattenNamespacesEnabled}
            onChange={(value) => set({ openaiFlattenNamespacesEnabled: value })}
          />
        </FormSection>
      ) : null}

      {/* OpenAI WS Mode 三态（off/ctx_pool/passthrough） */}
      {platform === 'openai' && (s.accountCategory === 'oauth-based' || s.accountCategory === 'apikey') ? (
        <FormSection
          title={t('admin.accounts.openai.wsMode')}
          description={
            <>
              {t('admin.accounts.openai.wsModeDesc')}
              {openAIWSModeHintKey ? (
                <>
                  <br />
                  {t(openAIWSModeHintKey)}
                </>
              ) : null}
            </>
          }
          action={
            <div data-testid="create-openai-ws-mode" style={{ width: '13rem' }}>
              <Select
                aria-label={t('admin.accounts.openai.wsMode')}
                value={wsMode}
                options={openAIWSModeOptions}
                onChange={(value) => {
                  const mode = value as OpenAIWSMode
                  if (platform === 'openai' && s.accountCategory === 'apikey') {
                    set({ openaiAPIKeyResponsesWebSocketV2Mode: mode })
                  } else {
                    set({ openaiOAuthResponsesWebSocketV2Mode: mode })
                  }
                }}
              />
            </div>
          }
        />
      ) : null}

      {/* Anthropic API Key 自动透传开关 */}
      {platform === 'anthropic' && s.accountCategory === 'apikey' ? (
        <FormSection>
          <ToggleRow
            label={t('admin.accounts.anthropic.apiKeyPassthrough')}
            description={t('admin.accounts.anthropic.apiKeyPassthroughDesc')}
            checked={s.anthropicPassthroughEnabled}
            onChange={(value) => set({ anthropicPassthroughEnabled: value })}
          />
        </FormSection>
      ) : null}

      {platform === 'anthropic' && s.accountCategory === 'apikey' ? (
        <FormSection
          title={t('admin.accounts.anthropic.apiKeyAuthScheme')}
          description={t('admin.accounts.anthropic.apiKeyAuthSchemeDesc')}
          action={
            <select
              value={s.anthropicAPIKeyAuthScheme}
              onChange={(event) =>
                set({ anthropicAPIKeyAuthScheme: event.target.value as CreateAccountState['anthropicAPIKeyAuthScheme'] })
              }
              aria-label={t('admin.accounts.anthropic.apiKeyAuthScheme')}
              className={formStyles.select}
              style={{ width: '13rem' }}
            >
              <option value="x_api_key">{t('admin.accounts.anthropic.apiKeyAuthSchemeXApiKey')}</option>
              <option value="authorization_bearer">{t('admin.accounts.anthropic.apiKeyAuthSchemeBearer')}</option>
            </select>
          }
        />
      ) : null}

      {/* Anthropic API Key: Web Search Emulation (hidden when global disabled) */}
      {platform === 'anthropic' && s.accountCategory === 'apikey' && s.webSearchGlobalEnabled ? (
        <FormSection
          title={t('admin.accounts.anthropic.webSearchEmulation')}
          description={t('admin.accounts.anthropic.webSearchEmulationDesc')}
          action={
            <select
              value={s.webSearchEmulationMode}
              onChange={(event) => set({ webSearchEmulationMode: event.target.value })}
              aria-label={t('admin.accounts.anthropic.webSearchEmulation')}
              className={formStyles.select}
              style={{ width: '8rem' }}
            >
              <option value="default">{t('admin.accounts.anthropic.webSearchDefault')}</option>
              <option value="enabled">{t('admin.accounts.anthropic.webSearchEnabled')}</option>
              <option value="disabled">{t('admin.accounts.anthropic.webSearchDisabled')}</option>
            </select>
          }
        />
      ) : null}

      {/* OpenAI API 长上下文计费开关 */}
      {platform === 'openai' &&
      !hideAccountLongContextBilling &&
      (s.accountCategory === 'oauth-based' || s.accountCategory === 'apikey') ? (
        <FormSection>
          <ToggleRow
            data-testid="openai-long-context-billing-toggle"
            label={t('admin.accounts.openai.longContextBilling')}
            description={t('admin.accounts.openai.longContextBillingDesc')}
            checked={s.openAILongContextBillingEnabled}
            onChange={() => ctl.toggleOpenAILongContextBilling()}
          />
        </FormSection>
      ) : null}

      {platform === 'openai' && s.accountCategory === 'oauth-based' ? (
        <FormSection>
          <ToggleRow
            label={t('admin.accounts.openai.codexCLIOnly')}
            description={t('admin.accounts.openai.codexCLIOnlyDesc')}
            checked={s.codexCLIOnlyEnabled}
            onChange={(value) => set({ codexCLIOnlyEnabled: value })}
          >
            {s.codexCLIOnlyEnabled ? (
              <ToggleRow
                label={t('admin.accounts.openai.codexCLIOnlyAppServer')}
                description={t('admin.accounts.openai.codexCLIOnlyAppServerDesc')}
                checked={s.codexCLIOnlyAppServerEnabled}
                onChange={(value) => set({ codexCLIOnlyAppServerEnabled: value })}
              />
            ) : null}
          </ToggleRow>
        </FormSection>
      ) : null}

      {/* Codex 指纹收敛模式（仅 OpenAI OAuth） */}
      {platform === 'openai' && s.accountCategory === 'oauth-based' ? (
        <FormSection
          title={t('admin.accounts.openai.codexFingerprintMode')}
          description={t('admin.accounts.openai.codexFingerprintModeDesc')}
          action={
            <div data-testid="create-codex-fingerprint-mode-select" style={{ width: '13rem' }}>
              <Select
                aria-label={t('admin.accounts.openai.codexFingerprintMode')}
                value={s.codexFingerprintMode}
                options={codexFingerprintModeOptions}
                onChange={(value) => set({ codexFingerprintMode: value as CreateAccountState['codexFingerprintMode'] })}
              />
            </div>
          }
        />
      ) : null}

      {/* OpenAI Compact 能力配置 */}
      {platform === 'openai' && (s.accountCategory === 'oauth-based' || s.accountCategory === 'apikey') ? (
        <FormSection
          title={t('admin.accounts.openai.compactMode')}
          description={t('admin.accounts.openai.compactModeDesc')}
          action={
            <div style={{ width: '11rem' }}>
              <Select
                aria-label={t('admin.accounts.openai.compactMode')}
                value={s.openAICompactMode}
                options={openAICompactModeOptions}
                onChange={(value) => set({ openAICompactMode: value as CreateAccountState['openAICompactMode'] })}
              />
            </div>
          }
        >
          <FormField label={t('admin.accounts.openai.compactModelMapping')} hint={t('admin.accounts.openai.compactModelMappingDesc')}>
            <MappingRows
              rows={s.openAICompactModelMappings}
              fromPlaceholder={t('admin.accounts.fromModel')}
              toPlaceholder={t('admin.accounts.toModel')}
              onUpdate={(index, patch) => ctl.updateMappingRow('openAICompactModelMappings', index, patch)}
              onRemove={(index) => ctl.removeMappingRow('openAICompactModelMappings', index)}
              removeLabel={t('common.delete')}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => ctl.addMappingRow('openAICompactModelMappings')}
            >
              + {t('admin.accounts.addMapping')}
            </Button>
          </FormField>
        </FormSection>
      ) : null}

      {/* OpenAI APIKey Responses API support mode */}
      {platform === 'openai' && s.accountCategory === 'apikey' ? (
        <FormSection
          title={t('admin.accounts.openai.responsesMode')}
          description={t('admin.accounts.openai.responsesModeDesc')}
          action={
            <div data-testid="openai-responses-mode-select" style={{ width: '14rem' }}>
              <Select
                aria-label={t('admin.accounts.openai.responsesMode')}
                value={s.openAIResponsesMode}
                options={openAIResponsesModeOptions}
                disabled={!textCapabilityEnabled}
                onChange={(value) => set({ openAIResponsesMode: value as CreateAccountState['openAIResponsesMode'] })}
              />
            </div>
          }
        >
          {!textCapabilityEnabled ? (
            <div data-testid="openai-responses-mode-not-applicable">
              <FormNotice tone="warning">
                <p>{t('admin.accounts.openai.responsesModeTextDisabledHint')}</p>
              </FormNotice>
            </div>
          ) : null}
          <FormField label={t('admin.accounts.openai.endpointCapabilities')} hint={t('admin.accounts.openai.endpointCapabilitiesDesc')}>
            <div className={formStyles.grid2}>
              {openAIEndpointCapabilityOptions.map((option) => (
                <span key={option.value} data-testid={`openai-endpoint-capability-${option.value}`}>
                  <Checkbox
                    checked={s.openAIEndpointCapabilities.includes(option.value)}
                    onCheckedChange={() => ctl.toggleOpenAIEndpointCapability(option.value)}
                    label={option.label}
                  />
                </span>
              ))}
            </div>
          </FormField>
        </FormSection>
      ) : null}

      {/* OpenAI APIKey images: backfill b64_json from url */}
      {platform === 'openai' && s.accountCategory === 'apikey' ? (
        <FormSection>
          <ToggleRow
            data-testid="openai-images-url-to-b64-json-toggle"
            label={t('admin.accounts.openai.imagesUrlToB64Json')}
            description={t('admin.accounts.openai.imagesUrlToB64JsonDesc')}
            checked={s.openAIImagesUrlToB64JsonEnabled}
            onChange={(value) => set({ openAIImagesUrlToB64JsonEnabled: value })}
          />
        </FormSection>
      ) : null}

      <FormSection>
        <ToggleRow
          label={t('admin.accounts.autoPauseOnExpired')}
          description={t('admin.accounts.autoPauseOnExpiredDesc')}
          checked={s.autoPauseOnExpired}
          onChange={(value) => set({ autoPauseOnExpired: value })}
        />
      </FormSection>

      <FormSection>
        {/* Mixed Scheduling (only for antigravity accounts) */}
        {platform === 'antigravity' ? (
          <>
            <div className={styles.checkboxRow}>
              <Checkbox
                checked={s.mixedScheduling}
                onCheckedChange={(value) => set({ mixedScheduling: value === true })}
                label={t('admin.accounts.mixedScheduling')}
              />
              <HelpTooltip content={t('admin.accounts.mixedSchedulingTooltip')} width="18rem" />
            </div>
            <div className={styles.checkboxRow}>
              <Checkbox
                checked={s.allowOverages}
                onCheckedChange={(value) => set({ allowOverages: value === true })}
                label={t('admin.accounts.allowOverages')}
              />
              <HelpTooltip content={t('admin.accounts.allowOveragesTooltip')} width="18rem" />
            </div>
          </>
        ) : null}

        {/* Group Selection - 仅标准模式显示 */}
        <div data-tour="account-form-groups">
          <GroupSelector
            value={form.group_ids}
            onChange={(value) => setForm({ group_ids: value })}
            groups={groups}
            platform={platform as GroupPlatform}
            mixedScheduling={s.mixedScheduling}
          />
        </div>
      </FormSection>
    </form>
  )

  const footer =
    s.step === 1 ? (
      <>
        <Button type="button" variant="secondary" onClick={() => ctl.handleClose()}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          form="create-account-form"
          variant="primary"
          loading={s.submitting}
          disabled={s.submitting}
          data-tour="account-form-submit"
        >
          {oauthOAuthFlow ? t('common.next') : s.submitting ? t('admin.accounts.creating') : t('common.create')}
        </Button>
      </>
    ) : (
      <>
        <Button type="button" variant="secondary" onClick={() => ctl.goBackToBasicInfo()} style={{ marginRight: 'auto' }}>
          {t('common.back')}
        </Button>
        {isManualInputMethod(s) ? (
          <Button
            type="button"
            variant="primary"
            loading={currentOAuthLoading}
            disabled={!canExchangeCode}
            onClick={() => void ctl.handleExchangeCode()}
          >
            {currentOAuthLoading ? t('admin.accounts.oauth.verifying') : t('admin.accounts.oauth.completeAuth')}
          </Button>
        ) : null}
      </>
    )

  return (
    <>
      <AccountFormDrawer show={show} title={t('admin.accounts.createAccount')} width="wide" onClose={() => ctl.handleClose()} footer={footer}>
        {/* Step Indicator for OAuth accounts */}
        {oauthOAuthFlow ? (
          <div className={formStyles.steps}>
            <div className={formStyles.step} data-active={s.step >= 1}>
              <span className={formStyles.stepDot}>1</span>
              <span>{t('admin.accounts.oauth.authMethod')}</span>
            </div>
            <span className={formStyles.stepLine} aria-hidden="true" />
            <div className={formStyles.step} data-active={s.step >= 2}>
              <span className={formStyles.stepDot}>2</span>
              <span>{oauthStepTitle}</span>
            </div>
          </div>
        ) : null}

        {s.step === 1 ? (
          renderBasicInfo()
        ) : (
          /* Step 2: OAuth Authorization */
          <OAuthAuthorizationFlow
            ref={attachFlowHandle}
            addMethod={platform === 'anthropic' ? s.addMethod : 'oauth'}
            authUrl={client.authUrl}
            sessionId={client.sessionId}
            loading={currentOAuthLoading}
            error={client.error}
            showHelp={platform === 'anthropic'}
            showProxyWarning={platform !== 'openai' && platform !== 'grok' && !!form.proxy_id}
            allowMultiple={platform === 'anthropic'}
            showCookieOption={platform === 'anthropic'}
            showRefreshTokenOption={platform === 'openai' || platform === 'antigravity' || platform === 'grok'}
            showMobileRefreshTokenOption={platform === 'openai'}
            showSessionTokenOption={false}
            showAccessTokenOption={false}
            showCodexSessionImportOption={platform === 'openai'}
            showAgentIdentityOption={platform === 'openai'}
            showCodexPatOption={platform === 'openai'}
            showSsoOption={platform === 'grok'}
            showEmailPasswordOption={false}
            showManualOption={true}
            initialInputMethod="manual"
            platform={platform}
            showProjectId={s.geminiOAuthType === 'code_assist'}
            onGenerateUrl={() => void ctl.handleGenerateUrl()}
            onCookieAuth={(sessionKey) => void ctl.handleCookieAuth(sessionKey)}
            onValidateRefreshToken={(rt) => ctl.handleValidateRefreshToken(rt)}
            onValidateMobileRefreshToken={(rt) => void ctl.handleOpenAIValidateMobileRT(rt)}
            onValidateSessionToken={(token) => ctl.handleValidateSessionToken(token)}
            onImportCodexSession={(content) => void ctl.handleOpenAIImportCodexSession(content)}
            onImportCodexPat={(token) => void ctl.handleOpenAIImportCodexPAT(token)}
            onImportSso={(content) => void ctl.handleGrokImportSSO(content)}
            onAuthorizePassword={(input) => void ctl.handleGrokAuthorizePassword(input)}
            onStateChange={(flowState) => set({ flowState })}
          />
        )}
      </AccountFormDrawer>

      {/* Gemini Help Dialog */}
      <BaseDialog
        show={s.showGeminiHelpDialog}
        title={t('admin.accounts.gemini.helpDialog.title')}
        width="wide"
        onClose={() => set({ showGeminiHelpDialog: false })}
        footer={
          <Button type="button" variant="primary" onClick={() => set({ showGeminiHelpDialog: false })}>
            {t('common.close')}
          </Button>
        }
      >
        <div className={styles.helpBody}>
          {/* Setup Guide Section */}
          <section className={styles.helpSection}>
            <h3 className={styles.helpTitle}>{t('admin.accounts.gemini.setupGuide.title')}</h3>
            <p className={formStyles.label}>{t('admin.accounts.gemini.setupGuide.checklistTitle')}</p>
            <ul className={styles.helpList}>
              <li>{t('admin.accounts.gemini.setupGuide.checklistItems.usIp')}</li>
              <li>{t('admin.accounts.gemini.setupGuide.checklistItems.age')}</li>
            </ul>
            <p className={formStyles.label}>{t('admin.accounts.gemini.setupGuide.activationTitle')}</p>
            <ul className={styles.helpList}>
              <li>{t('admin.accounts.gemini.setupGuide.activationItems.geminiWeb')}</li>
              <li>{t('admin.accounts.gemini.setupGuide.activationItems.gcpProject')}</li>
            </ul>
            <div className={styles.helpLinks}>
              <a href={geminiHelpLinks.countryCheck} target="_blank" rel="noreferrer" className={formStyles.link}>
                {t('admin.accounts.gemini.setupGuide.links.countryCheck')}
              </a>
              <a href={geminiHelpLinks.countryChange} target="_blank" rel="noreferrer" className={formStyles.link}>
                {t('admin.accounts.gemini.setupGuide.links.countryChange')}
              </a>
              <a href={geminiHelpLinks.geminiWebActivation} target="_blank" rel="noreferrer" className={formStyles.link}>
                {t('admin.accounts.gemini.setupGuide.links.geminiWebActivation')}
              </a>
              <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className={formStyles.link}>
                {t('admin.accounts.gemini.setupGuide.links.gcpProject')}
              </a>
            </div>
          </section>

          {/* Quota Policy Section */}
          <section className={styles.helpSection}>
            <h3 className={styles.helpTitle}>{t('admin.accounts.gemini.quotaPolicy.title')}</h3>
            <p className={styles.warningText}>
              <TriangleAlert size={12} aria-hidden="true" /> {t('admin.accounts.gemini.quotaPolicy.note')}
            </p>
            <div className={styles.tableScroll}>
              <table className={styles.quotaTable}>
                <thead>
                  <tr>
                    <th>{t('admin.accounts.gemini.quotaPolicy.columns.channel')}</th>
                    <th>{t('admin.accounts.gemini.quotaPolicy.columns.account')}</th>
                    <th>{t('admin.accounts.gemini.quotaPolicy.columns.limits')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{t('admin.accounts.gemini.quotaPolicy.rows.googleOne.channel')}</td>
                    <td>Free</td>
                    <td>{t('admin.accounts.gemini.quotaPolicy.rows.googleOne.limitsFree')}</td>
                  </tr>
                  <tr>
                    <td />
                    <td>Pro</td>
                    <td>{t('admin.accounts.gemini.quotaPolicy.rows.googleOne.limitsPro')}</td>
                  </tr>
                  <tr>
                    <td />
                    <td>Ultra</td>
                    <td>{t('admin.accounts.gemini.quotaPolicy.rows.googleOne.limitsUltra')}</td>
                  </tr>
                  <tr>
                    <td>{t('admin.accounts.gemini.quotaPolicy.rows.gcp.channel')}</td>
                    <td>Standard</td>
                    <td>{t('admin.accounts.gemini.quotaPolicy.rows.gcp.limitsStandard')}</td>
                  </tr>
                  <tr>
                    <td />
                    <td>Enterprise</td>
                    <td>{t('admin.accounts.gemini.quotaPolicy.rows.gcp.limitsEnterprise')}</td>
                  </tr>
                  <tr>
                    <td>{t('admin.accounts.gemini.quotaPolicy.rows.aiStudio.channel')}</td>
                    <td>Free</td>
                    <td>{t('admin.accounts.gemini.quotaPolicy.rows.aiStudio.limitsFree')}</td>
                  </tr>
                  <tr>
                    <td />
                    <td>Paid</td>
                    <td>{t('admin.accounts.gemini.quotaPolicy.rows.aiStudio.limitsPaid')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={styles.helpLinks}>
              <a href={geminiQuotaDocs.codeAssist} target="_blank" rel="noreferrer" className={formStyles.link}>
                {t('admin.accounts.gemini.quotaPolicy.docs.codeAssist')}
              </a>
              <a href={geminiQuotaDocs.aiStudio} target="_blank" rel="noreferrer" className={formStyles.link}>
                {t('admin.accounts.gemini.quotaPolicy.docs.aiStudio')}
              </a>
              <a href={geminiQuotaDocs.vertex} target="_blank" rel="noreferrer" className={formStyles.link}>
                {t('admin.accounts.gemini.quotaPolicy.docs.vertex')}
              </a>
            </div>
          </section>

          {/* API Key Links Section */}
          <section className={styles.helpSection}>
            <h3 className={styles.helpTitle}>{t('admin.accounts.gemini.helpDialog.apiKeySection')}</h3>
            <div className={styles.helpLinks}>
              <a href={geminiHelpLinks.apiKey} target="_blank" rel="noreferrer" className={formStyles.link}>
                {t('admin.accounts.gemini.accountType.apiKeyLink')}
              </a>
              <a href={geminiHelpLinks.aiStudioPricing} target="_blank" rel="noreferrer" className={formStyles.link}>
                {t('admin.accounts.gemini.accountType.quotaLink')}
              </a>
            </div>
          </section>
        </div>
      </BaseDialog>

      {/* Mixed Channel Warning Dialog */}
      <ConfirmDialog
        show={s.showMixedChannelWarning}
        title={t('admin.accounts.mixedChannelWarningTitle')}
        message={mixedChannelWarningMessageText}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        danger={true}
        onConfirm={() => void ctl.handleMixedChannelConfirm()}
        onCancel={() => ctl.handleMixedChannelCancel()}
      />

      {/* 429/529 自定义错误码确认（替代 Vue 版 window.confirm） */}
      {confirmDialog}
    </>
  )
}
