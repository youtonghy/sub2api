/**
 * CreateAccountModal 的状态与处理逻辑（对应 Vue 版 CreateAccountModal.vue 的 <script setup>）。
 *
 * 每个组件实例创建一次控制器；状态放在 createReactiveStore 中，watch 回调与 Vue 版按相同顺序注册，
 * 处理函数总是通过 get() 读取最新值。派生值（computed）写成以状态为参数的纯函数，渲染与处理函数共用。
 */
import { adminAPI } from '@/api/admin'
import type { AccountOAuth, AddMethod } from '@/composables/useAccountOAuth'
import type { AntigravityOAuth } from '@/composables/useAntigravityOAuth'
import type { GeminiOAuth } from '@/composables/useGeminiOAuth'
import type { GrokOAuth } from '@/composables/useGrokOAuth'
import {
  buildModelMappingObject,
  claudeModels,
  fetchAntigravityDefaultMappings,
  getModelsByPlatform
} from '@/composables/useModelWhitelist'
import type { OpenAIOAuth } from '@/composables/useOpenAIOAuth'
import type { QuotaNotifyState } from '@/composables/useQuotaNotifyState'
import { listPlatforms } from '@/constants/platformCatalog'
import { useAppStore } from '@/stores/app'
import type {
  AccountPlatform,
  AccountType,
  CheckMixedChannelResponse,
  CodexSessionImportMessage,
  CreateAccountRequest,
  OpenAICompactMode,
  OpenAIEndpointCapability,
  OpenAIResponsesMode,
  TempUnschedulableScope
} from '@/types'
import { supportsAccountQuota } from '@/utils/accountQuota'
import { applyExplicitCacheUpstreamCredentials, isOfficialGeminiBaseUrl } from '@/utils/geminiExplicitCache'
import { OPENAI_WS_MODE_OFF, isOpenAIWSModeEnabled, type OpenAIWSMode } from '@/utils/openaiWsMode'
import { createReactiveStore, type ReactiveStore } from './CreateAccountModal.store'
import type { OAuthFlowHandle, OAuthFlowState } from './OAuthAuthorizationFlow'
import {
  applyAntigravityProjectID,
  applyHeaderOverride,
  applyInterceptWarmup,
  applyOpenCodeGoProtocolRules,
  cloneOpenCodeGoProtocolRules,
  defaultCNAdaptiveBaseUrls,
  defaultCNBaseUrl,
  defaultOpenCodeProtocolRules,
  defaultProviderProtocolRules,
  isCNProviderPlatform,
  isHeaderOverrideCapable,
  isMultiProtocolApiKeyPlatform,
  providerAccountModes,
  providerNativeProtocols,
  providerRoutesByModel,
  resolveProviderAccountMode,
  validateHeaderOverrideRows,
  type CnAccountMode,
  type CnApiProtocol,
  type CnNativeApiProtocol,
  type CnProviderPlatform,
  type HeaderOverrideRow,
  type OpenCodeAccountMode,
  type OpenCodeGoProtocolRule
} from './credentialsBuilder'

type TFn = (key: string, ...args: unknown[]) => string

// Model mapping type（key 仅用于列表渲染，构建请求时只读取 from/to）
export interface ModelMapping {
  key: string
  from: string
  to: string
}

export interface TempUnschedRuleForm {
  key: string
  error_code: number | null
  keywords: string
  duration_minutes: number | null
  description: string
  // 作用范围：account 暂停整个账号，model 只冷却本次请求的模型。
  scope: TempUnschedulableScope
}

export type AccountCategory = 'oauth-based' | 'apikey' | 'bedrock' | 'service_account'
export type CodexFingerprintMode = 'off' | 'device' | 'session' | 'full'
export type AnthropicAPIKeyAuthScheme = 'x_api_key' | 'authorization_bearer'
export type GeminiOAuthType = 'code_assist' | 'google_one' | 'ai_studio'
export type ResetMode = 'rolling' | 'fixed'

export interface CreateAccountForm {
  name: string
  notes: string
  platform: AccountPlatform
  type: AccountType
  credentials: Record<string, unknown>
  proxy_id: number | null
  concurrency: number
  load_factor: number | null
  priority: number
  rate_multiplier: number
  group_ids: number[]
  expires_at: number | null
}

export interface MixedChannelDetails {
  groupName: string
  currentPlatform: string
  otherPlatform: string
}

export const DEFAULT_POOL_MODE_RETRY_COUNT = 3
export const MAX_POOL_MODE_RETRY_COUNT = 10
export const DEFAULT_POOL_MODE_RETRY_STATUS_CODES = [401, 403, 429]
// OpenAI Mobile RT client_id
const OPENAI_MOBILE_RT_CLIENT_ID = 'app_LlGpXReQgckcGGUo2JrYvtJK'

let rowKeySeed = 0
export const nextRowKey = (prefix: string) => `${prefix}-${++rowKeySeed}`
export const newMapping = (from = '', to = ''): ModelMapping => ({ key: nextRowKey('create-model-mapping'), from, to })
const withMappingKeys = (items: { from: string; to: string }[]): ModelMapping[] =>
  items.map((item) => newMapping(item.from, item.to))

const initialForm = (): CreateAccountForm => ({
  name: '',
  notes: '',
  platform: 'anthropic',
  type: 'oauth', // Will be 'oauth', 'setup-token', or 'apikey'
  credentials: {},
  proxy_id: null,
  concurrency: 10,
  load_factor: null,
  priority: 1,
  rate_multiplier: 1,
  group_ids: [],
  expires_at: null
})

const createInitialState = (show: boolean) => ({
  show,
  step: 1,
  submitting: false,
  form: initialForm(),
  accountCategory: 'oauth-based' as AccountCategory, // UI selection for account category
  addMethod: 'oauth' as AddMethod, // For oauth-based: 'oauth' or 'setup-token'
  apiKeyBaseUrl: 'https://api.anthropic.com',
  apiKeyValue: '',
  upstreamBillingAutoProbeEnabled: true,
  // ── 国产供应商（Kimi / Zhipu / DeepSeek）账号类型、API 协议与端点 ──
  // 多协议供应商（国产厂商与走通用表单的供应商）的接入模式；OpenCode 用 openCodeAccountMode。
  accountMode: 'payg' as string,
  openCodeAccountMode: 'zen' as OpenCodeAccountMode,
  // API 协议决定转发端点与格式：cc=现有转换链，anthropic=原生直通（Claude Code），
  // responses=deepseek / kimi 原生 Responses 端点（Codex）。与账号类型正交。
  apiProtocol: 'adaptive' as CnApiProtocol,
  openCodeGoProtocolRules: cloneOpenCodeGoProtocolRules(defaultOpenCodeProtocolRules('zen')) as OpenCodeGoProtocolRule[],
  // 智谱团队版 Coding Plan：组织/项目 ID，写入 credentials 供额度探测切换团队端点
  zhipuOrganization: '',
  zhipuProject: '',
  adaptiveBaseUrls: { chat_completions: '', anthropic: '', responses: '' } as Record<CnNativeApiProtocol, string>,
  // 上游ID：直接上游声明请求标识的响应头名，留空不记录。
  upstreamRequestIdHeader: '',
  editQuotaLimit: null as number | null,
  editQuotaDailyLimit: null as number | null,
  editQuotaWeeklyLimit: null as number | null,
  editDailyResetMode: null as ResetMode | null,
  editDailyResetHour: null as number | null,
  editWeeklyResetMode: null as ResetMode | null,
  editWeeklyResetDay: null as number | null,
  editWeeklyResetHour: null as number | null,
  editResetTimezone: null as string | null,
  modelMappings: [] as ModelMapping[],
  openAICompactModelMappings: [] as ModelMapping[],
  modelRestrictionMode: 'whitelist' as 'whitelist' | 'mapping',
  allowedModels: [] as string[],
  upstreamModelsPreviewed: false,
  poolModeEnabled: false,
  explicitCacheUpstreamEnabled: false,
  explicitCacheUpstreamMaxTTL: '' as string | number,
  poolModeRetryCount: DEFAULT_POOL_MODE_RETRY_COUNT as number | null,
  poolModeRetryStatusCodesInput: '',
  customErrorCodesEnabled: false,
  selectedErrorCodes: [] as number[],
  customErrorCodeInput: null as number | null,
  headerOverrideEnabled: false,
  headerOverrideRows: [] as HeaderOverrideRow[],
  // Grok OAuth：自定义上游地址（base_url 仅改写转发端点，OAuth 授权/刷新不受影响）
  grokOAuthCustomBaseUrlEnabled: false,
  grokOAuthBaseUrl: '',
  interceptWarmupRequests: false,
  autoPauseOnExpired: true,
  openaiPassthroughEnabled: false,
  // OpenAI Codex namespace 工具摊平兼容开关（仅 OAuth），缺省关闭即原样保留
  openaiFlattenNamespacesEnabled: false,
  openAILongContextBillingEnabled: false,
  openAILongContextBillingTouched: false,
  openAICompactMode: 'auto' as OpenAICompactMode,
  openAIResponsesMode: 'auto' as OpenAIResponsesMode,
  // Images 非流式响应缺 b64_json 时由网关下载 url 回填（仅 OpenAI API Key）。
  openAIImagesUrlToB64JsonEnabled: false,
  openAIEndpointCapabilities: ['chat_completions', 'embeddings'] as OpenAIEndpointCapability[],
  openaiOAuthResponsesWebSocketV2Mode: OPENAI_WS_MODE_OFF as OpenAIWSMode,
  openaiAPIKeyResponsesWebSocketV2Mode: OPENAI_WS_MODE_OFF as OpenAIWSMode,
  codexCLIOnlyEnabled: false,
  codexCLIOnlyAppServerEnabled: false,
  codexFingerprintMode: 'off' as CodexFingerprintMode,
  anthropicPassthroughEnabled: false,
  anthropicAPIKeyAuthScheme: 'x_api_key' as AnthropicAPIKeyAuthScheme,
  webSearchEmulationMode: 'default',
  webSearchGlobalEnabled: false,
  mixedScheduling: false, // For antigravity accounts: enable mixed scheduling
  allowOverages: false, // For antigravity accounts: enable AI Credits overages
  antigravityAccountType: 'oauth' as 'oauth' | 'upstream', // For antigravity: oauth or upstream
  antigravityProjectId: '',
  upstreamBaseUrl: '', // For upstream type: base URL
  upstreamApiKey: '', // For upstream type: API key
  antigravityModelRestrictionMode: 'whitelist' as 'whitelist' | 'mapping',
  antigravityWhitelistModels: [] as string[],
  antigravityModelMappings: [] as ModelMapping[],
  // Bedrock credentials
  bedrockAuthMode: 'sigv4' as 'sigv4' | 'apikey',
  bedrockAccessKeyId: '',
  bedrockSecretAccessKey: '',
  bedrockSessionToken: '',
  bedrockRegion: 'us-east-1',
  bedrockForceGlobal: false,
  bedrockApiKeyValue: '',
  vertexServiceAccountJson: '',
  vertexProjectId: '',
  vertexClientEmail: '',
  vertexLocation: 'global',
  vertexServiceAccountDragActive: false,
  vertexAuthMode: 'service_account' as 'service_account' | 'apikey',
  vertexApiKey: '',
  tempUnschedEnabled: false,
  tempUnschedRules: [] as TempUnschedRuleForm[],
  geminiOAuthType: 'google_one' as GeminiOAuthType,
  geminiAIStudioOAuthEnabled: false,
  showMixedChannelWarning: false,
  mixedChannelWarningDetails: null as MixedChannelDetails | null,
  mixedChannelWarningRawMessage: '',
  mixedChannelWarningAction: null as (() => Promise<void>) | null,
  antigravityMixedChannelConfirmed: false,
  showAdvancedOAuth: false,
  showGeminiHelpDialog: false,
  // Quota control state (Anthropic OAuth/SetupToken only)
  windowCostEnabled: false,
  windowCostLimit: null as number | null,
  windowCostStickyReserve: null as number | null,
  sessionLimitEnabled: false,
  maxSessions: null as number | null,
  sessionIdleTimeout: null as number | null,
  rpmLimitEnabled: false,
  baseRpm: null as number | null,
  rpmStrategy: 'tiered' as 'tiered' | 'sticky_exempt',
  rpmStickyBuffer: null as number | null,
  userMsgQueueMode: '',
  tlsFingerprintEnabled: false,
  tlsFingerprintProfileId: null as number | null,
  tlsFingerprintProfiles: [] as { id: number; name: string }[],
  sessionIdMaskingEnabled: false,
  cacheTTLOverrideEnabled: false,
  cacheTTLOverrideTarget: '5m',
  customBaseUrlEnabled: false,
  customBaseUrl: '',
  // Gemini tier selection (used as fallback when auto-detection is unavailable/fails)
  geminiTierGoogleOne: 'google_one_free' as 'google_one_free' | 'google_ai_pro' | 'google_ai_ultra',
  geminiTierGcp: 'gcp_standard' as 'gcp_standard' | 'gcp_enterprise',
  geminiTierAIStudio: 'aistudio_free' as 'aistudio_free' | 'aistudio_paid',
  /** OAuthAuthorizationFlow 内部输入值镜像（Vue 版通过 flowHandle 读取） */
  flowState: null as OAuthFlowState | null
})

export type CreateAccountState = ReturnType<typeof createInitialState>

const NATIVE_PROTOCOL_LABEL_KEYS: Record<CnNativeApiProtocol, string> = {
  chat_completions: 'chatCompletions',
  anthropic: 'anthropic',
  responses: 'responses'
}

// ─────────────────────────── 派生值（Vue 版 computed） ───────────────────────────

export const isCNPlatform = (s: CreateAccountState) => isCNProviderPlatform(s.form.platform)
export const isOpenCodeGoPlatform = (s: CreateAccountState) => s.form.platform === 'opencode_go'
export const isMultiProtocolPlatform = (s: CreateAccountState) => isMultiProtocolApiKeyPlatform(s.form.platform)
// 前端没有专属界面、走通用表单的多协议供应商：模式、协议、默认端点
// 与分流规则全部来自平台清单中的 profile。
export const isGenericMultiProtocolPlatform = (s: CreateAccountState) =>
  isMultiProtocolPlatform(s) && !isCNPlatform(s) && !isOpenCodeGoPlatform(s)
export const extraMultiProtocolPlatforms = () =>
  listPlatforms().filter((spec) => !!spec.multi_protocol && !isCNProviderPlatform(spec.id) && spec.id !== 'opencode_go')
export const genericAccountModes = (s: CreateAccountState) => providerAccountModes(s.form.platform)
// 按模型分流的供应商（OpenCode 等）：adaptive 账号携带 protocol_rules。
export const routesByModel = (s: CreateAccountState) => providerRoutesByModel(s.form.platform)
export const currentOpenCodeOrCNMode = (s: CreateAccountState): string =>
  isOpenCodeGoPlatform(s) ? s.openCodeAccountMode : s.accountMode
export const cnPresetPlatform = (s: CreateAccountState): CnProviderPlatform =>
  isCNProviderPlatform(s.form.platform) ? s.form.platform : 'kimi'
// 国产厂商的接入模式只有 payg / coding（selectCNPlatform 已按 profile 规范化）。
export const cnPresetMode = (s: CreateAccountState): CnAccountMode => (s.accountMode === 'coding' ? 'coding' : 'payg')
const adaptivePresetPlatform = (s: CreateAccountState): string =>
  isMultiProtocolPlatform(s) ? s.form.platform : cnPresetPlatform(s)
// 当前平台与接入模式提供原生端点的协议（profile 中有默认基址的协议）。
export const cnAdaptiveProtocolOptions = (s: CreateAccountState) =>
  providerNativeProtocols(s.form.platform, currentOpenCodeOrCNMode(s)).map((value) => ({
    value,
    labelKey: NATIVE_PROTOCOL_LABEL_KEYS[value]
  }))
// 可选的协议档：adaptive 加上各原生协议（responses 仅 deepseek / kimi 等提供原生端点的供应商）。
export const cnProtocolOptions = (s: CreateAccountState): Array<{ value: CnApiProtocol; labelKey: string }> => [
  { value: 'adaptive', labelKey: 'adaptive' },
  ...cnAdaptiveProtocolOptions(s)
]

export const syncPreviewCredentials = (s: CreateAccountState) => {
  if (!s.apiKeyValue) return undefined
  const baseUrl =
    isMultiProtocolPlatform(s) && s.apiProtocol === 'adaptive'
      ? s.adaptiveBaseUrls.chat_completions.trim() || s.apiKeyBaseUrl.trim()
      : s.apiKeyBaseUrl.trim()
  const modelMapping = buildModelMappingObject(s.modelRestrictionMode, s.allowedModels, s.modelMappings)
  return {
    platform: s.form.platform,
    type: s.form.type,
    base_url: baseUrl || undefined,
    api_key: s.apiKeyValue,
    ...(modelMapping ? { model_mapping: modelMapping } : {})
  }
}

export const openAITextGenerationCapabilityEnabled = (s: CreateAccountState) =>
  s.openAIEndpointCapabilities.includes('chat_completions')

export const geminiSelectedTier = (s: CreateAccountState) => {
  if (s.form.platform !== 'gemini') return ''
  if (s.accountCategory === 'apikey') return s.geminiTierAIStudio
  switch (s.geminiOAuthType) {
    case 'google_one':
      return s.geminiTierGoogleOne
    case 'code_assist':
      return s.geminiTierGcp
    default:
      return s.geminiTierAIStudio
  }
}

export const openaiResponsesWebSocketV2Mode = (s: CreateAccountState): OpenAIWSMode =>
  s.form.platform === 'openai' && s.accountCategory === 'apikey'
    ? s.openaiAPIKeyResponsesWebSocketV2Mode
    : s.openaiOAuthResponsesWebSocketV2Mode

export const isOpenAIModelRestrictionDisabled = (s: CreateAccountState) =>
  s.form.platform === 'openai' && s.openaiPassthroughEnabled

// API Key 认证只对 Gemini 平台开放，Anthropic 平台的 Vertex 账号始终使用 Service Account JSON。
export const vertexUsesApiKey = (s: CreateAccountState) => s.form.platform === 'gemini' && s.vertexAuthMode === 'apikey'

// Helper to check if current type needs OAuth flow
export const isOAuthFlow = (s: CreateAccountState) => {
  // Antigravity upstream 类型不需要 OAuth 流程
  if (s.form.platform === 'antigravity' && s.antigravityAccountType === 'upstream') {
    return false
  }
  // Bedrock 类型不需要 OAuth 流程
  if (s.form.platform === 'anthropic' && s.accountCategory === 'bedrock') {
    return false
  }
  return s.accountCategory === 'oauth-based'
}

/** 授权流程只在第二步挂载；未挂载时等同于 Vue 版 flowHandle 为 null */
const mountedFlow = (s: CreateAccountState) => (s.step === 2 ? s.flowState : null)

export const isGrokSSOInputMethod = (s: CreateAccountState) =>
  s.form.platform === 'grok' && mountedFlow(s)?.inputMethod === 'sso_cookie'

export const isManualInputMethod = (s: CreateAccountState) => mountedFlow(s)?.inputMethod === 'manual'

// ─────────────────────────── 控制器 ───────────────────────────

export interface CreateAccountControllerDeps {
  t: TFn
  initialShow: boolean
  oauth: AccountOAuth // For Anthropic OAuth
  openaiOAuth: OpenAIOAuth // For OpenAI OAuth
  geminiOAuth: GeminiOAuth // For Gemini OAuth
  antigravityOAuth: AntigravityOAuth // For Antigravity OAuth
  grokOAuth: GrokOAuth // For Grok OAuth
  quotaNotify: QuotaNotifyState
  /** 429/529 自定义错误码的二次确认（替代 Vue 版 window.confirm） */
  confirm: (message: string) => Promise<boolean>
}

export function createCreateAccountController(deps: CreateAccountControllerDeps) {
  const { t, oauth, openaiOAuth, geminiOAuth, antigravityOAuth, grokOAuth, quotaNotify } = deps
  const store: ReactiveStore<CreateAccountState> = createReactiveStore(createInitialState(deps.initialShow))
  const get = store.get
  const set = store.set
  const setForm = (patch: Partial<CreateAccountForm>) => set({ form: { ...get().form, ...patch } })
  const appStore = () => useAppStore.getState()
  // 最新的 onClose / onCreated 回调（组件每次提交后通过 setCallbacks 更新）
  let callbacks: { onClose: () => void; onCreated: () => void } = { onClose: () => {}, onCreated: () => {} }
  const setCallbacks = (next: typeof callbacks) => {
    callbacks = next
  }
  const emitCreated = () => callbacks.onCreated()
  // Refs：OAuthAuthorizationFlow 的句柄（Vue 版 oauthFlowRef），通过回调 ref 挂载/卸载
  const flowHandle: { current: OAuthFlowHandle | null } = { current: null }
  const attachFlowHandle = (handle: OAuthFlowHandle | null) => {
    flowHandle.current = handle
  }

  // Computed: current OAuth state for template binding
  const currentClient = (platform = get().form.platform) => {
    if (platform === 'openai') return openaiOAuth
    if (platform === 'gemini') return geminiOAuth
    if (platform === 'antigravity') return antigravityOAuth
    if (platform === 'grok') return grokOAuth
    return oauth
  }

  const withUpstreamRequestIdHeader = <T extends Record<string, unknown> | undefined>(
    extra: T
  ): T | Record<string, unknown> => {
    const name = get().upstreamRequestIdHeader.trim()
    if (!name) return extra
    return { ...(extra || {}), upstream_request_id_header: name }
  }

  function resetAdaptiveBaseUrls(platform: string, mode: string) {
    set({ adaptiveBaseUrls: defaultCNAdaptiveBaseUrls(platform, mode) })
  }

  // 切换国产供应商平台：强制 apikey 类型，deepseek 无 coding 套餐故锁定 payg，
  // 协议回落 adaptive，并把 base url 重置为该平台默认端点。
  function selectCNPlatform(platform: CnProviderPlatform) {
    setForm({ platform, type: 'apikey' })
    // deepseek 无 coding 套餐（profile 仅 payg）；从其他供应商切换来的未知模式回落默认模式。
    const accountMode = resolveProviderAccountMode(platform, get().accountMode)
    set({
      accountCategory: 'apikey',
      apiProtocol: 'adaptive',
      accountMode,
      apiKeyBaseUrl: defaultCNBaseUrl(platform, accountMode, 'adaptive')
    })
    resetAdaptiveBaseUrls(platform, accountMode)
  }
  function selectOpenCodeGoPlatform() {
    setForm({ platform: 'opencode_go', type: 'apikey' })
    set({
      accountCategory: 'apikey',
      apiProtocol: 'adaptive',
      openCodeAccountMode: 'zen',
      apiKeyBaseUrl: defaultCNBaseUrl('opencode_go', 'zen', 'adaptive')
    })
    resetAdaptiveBaseUrls('opencode_go', 'zen')
    set({ openCodeGoProtocolRules: cloneOpenCodeGoProtocolRules(defaultOpenCodeProtocolRules('zen')) })
  }
  function selectTypeSafePlatform() {
    setForm({ platform: 'typesafe', type: 'apikey' })
    set({ accountCategory: 'apikey', apiKeyBaseUrl: 'https://api.typesafe.ai', allowedModels: ['jev-latest'] })
  }
  function selectGenericMultiProtocolPlatform(platform: string) {
    setForm({ platform, type: 'apikey' })
    const accountMode = resolveProviderAccountMode(platform, undefined)
    set({
      accountCategory: 'apikey',
      apiProtocol: 'adaptive',
      accountMode,
      apiKeyBaseUrl: defaultCNBaseUrl(platform, accountMode, 'adaptive')
    })
    resetAdaptiveBaseUrls(platform, accountMode)
    set({ openCodeGoProtocolRules: cloneOpenCodeGoProtocolRules(defaultProviderProtocolRules(platform, accountMode)) })
  }

  // 按协议回填 adaptive 端点：空值或仍是旧默认值的端点换成新默认值。
  const refreshAdaptiveDefaults = (platform: string, previousMode: string, mode: string) => {
    const s = get()
    const previousDefaults = defaultCNAdaptiveBaseUrls(platform, previousMode)
    const nextDefaults = defaultCNAdaptiveBaseUrls(platform, mode)
    const next = { ...s.adaptiveBaseUrls }
    for (const item of cnAdaptiveProtocolOptions(s)) {
      if (!next[item.value] || next[item.value] === previousDefaults[item.value]) {
        next[item.value] = nextDefaults[item.value]
      }
    }
    set({ adaptiveBaseUrls: next, apiKeyBaseUrl: next.chat_completions })
  }

  // 账号类型 / 协议变更时同步默认 base url。
  store.watch(
    (s) => s.openCodeAccountMode,
    (mode, previousMode) => {
      const s = get()
      if (!isOpenCodeGoPlatform(s)) return
      if (s.apiProtocol === 'adaptive') {
        refreshAdaptiveDefaults('opencode_go', previousMode, mode)
      } else {
        set({ apiKeyBaseUrl: defaultCNBaseUrl('opencode_go', mode, s.apiProtocol) })
      }
      const previousRules = JSON.stringify(defaultOpenCodeProtocolRules(previousMode))
      if (JSON.stringify(get().openCodeGoProtocolRules) === previousRules) {
        set({ openCodeGoProtocolRules: cloneOpenCodeGoProtocolRules(defaultOpenCodeProtocolRules(mode)) })
      }
    }
  )
  store.watch(
    (s) => s.accountMode,
    (mode, previousMode) => {
      const s = get()
      if (!isMultiProtocolPlatform(s) || isOpenCodeGoPlatform(s)) return
      if (routesByModel(s)) {
        const previousRules = JSON.stringify(defaultProviderProtocolRules(s.form.platform, previousMode))
        if (JSON.stringify(s.openCodeGoProtocolRules) === previousRules) {
          set({ openCodeGoProtocolRules: cloneOpenCodeGoProtocolRules(defaultProviderProtocolRules(s.form.platform, mode)) })
        }
      }
      if (s.apiProtocol === 'adaptive') {
        refreshAdaptiveDefaults(adaptivePresetPlatform(s), previousMode, mode)
        return
      }
      set({ apiKeyBaseUrl: defaultCNBaseUrl(s.form.platform, mode, s.apiProtocol) })
    }
  )
  store.watch(
    (s) => s.apiProtocol,
    (protocol) => {
      const s = get()
      if (!isMultiProtocolPlatform(s)) return
      if (protocol === 'adaptive') {
        const defaults = defaultCNAdaptiveBaseUrls(adaptivePresetPlatform(s), currentOpenCodeOrCNMode(s))
        const next = { ...s.adaptiveBaseUrls }
        for (const item of cnAdaptiveProtocolOptions(s)) {
          if (!next[item.value]) next[item.value] = defaults[item.value]
        }
        set({ adaptiveBaseUrls: next, apiKeyBaseUrl: next.chat_completions })
        return
      }
      set({ apiKeyBaseUrl: defaultCNBaseUrl(s.form.platform, currentOpenCodeOrCNMode(s), protocol) })
    }
  )
  // 点击预设端点：同时回填 base url、账号类型与协议。
  function onCnPresetSelect(preset: { mode: CnAccountMode; protocol: CnApiProtocol; url: string }) {
    set({ accountMode: preset.mode, apiProtocol: preset.protocol, apiKeyBaseUrl: preset.url })
  }

  // 两种认证方式的 Project ID 来源不同（JSON 读取 / 手填），切换时清空凭证字段避免串用。
  store.watch(
    (s) => s.vertexAuthMode,
    () => {
      set({ vertexServiceAccountJson: '', vertexProjectId: '', vertexClientEmail: '', vertexApiKey: '' })
    }
  )

  // Grok OAuth 三条创建路径（授权码/RT 批量/SSO 批量）共用的前置校验。
  // 授权码路径必须在兑换 code 之前调用，避免校验失败时白白消耗一次性授权码。
  const validateGrokOAuthUpstreamConfig = (): boolean => {
    const s = get()
    if (s.grokOAuthCustomBaseUrlEnabled) {
      const trimmed = s.grokOAuthBaseUrl.trim()
      if (!trimmed) {
        appStore().showError(t('admin.accounts.grokCustomBaseUrl.required'))
        return false
      }
      if (!/^https?:\/\//i.test(trimmed)) {
        appStore().showError(t('admin.accounts.grokCustomBaseUrl.invalid'))
        return false
      }
    }
    if (s.headerOverrideEnabled) {
      const headerError = validateHeaderOverrideRows(s.headerOverrideRows)
      if (headerError) {
        appStore().showError(t(`admin.accounts.headerOverride.${headerError}`))
        return false
      }
    }
    return true
  }

  // 把已通过校验的自定义上游地址与请求头覆写写入 credentials
  const applyGrokOAuthUpstreamConfig = (credentials: Record<string, unknown>) => {
    const s = get()
    if (s.grokOAuthCustomBaseUrlEnabled) {
      credentials.base_url = s.grokOAuthBaseUrl.trim()
    }
    applyHeaderOverride(credentials, s.headerOverrideEnabled, s.headerOverrideRows, 'create')
  }

  const toggleOpenAILongContextBilling = () => {
    set({ openAILongContextBillingEnabled: !get().openAILongContextBillingEnabled, openAILongContextBillingTouched: true })
  }

  /** 挂载时加载全局开关（Vue 版在 setup 中直接调用） */
  const loadGlobalStates = () => {
    // Load global feature states once
    adminAPI.settings
      .getWebSearchEmulationConfig()
      .then((cfg) => {
        set({ webSearchGlobalEnabled: cfg?.enabled === true && (cfg?.providers?.length ?? 0) > 0 })
      })
      .catch(() => {
        set({ webSearchGlobalEnabled: false })
      })
    quotaNotify.loadGlobalState()
  }

  const normalizeOpenAIEndpointCapabilities = (values: OpenAIEndpointCapability[]) => {
    const allowed: OpenAIEndpointCapability[] = ['chat_completions', 'embeddings', 'seedance']
    const selected = allowed.filter((value) => values.includes(value))
    return selected.length > 0 ? selected : (['chat_completions', 'embeddings'] as OpenAIEndpointCapability[])
  }

  /** 返回 false 表示最后一项不能取消（复选框保持勾选） */
  const toggleOpenAIEndpointCapability = (capability: OpenAIEndpointCapability): boolean => {
    const current = get().openAIEndpointCapabilities
    if (current.includes(capability)) {
      if (current.length <= 1) return false
      set({ openAIEndpointCapabilities: current.filter((value) => value !== capability) })
      if (!openAITextGenerationCapabilityEnabled(get())) {
        set({ openAIResponsesMode: 'auto' })
      }
      return true
    }
    set({ openAIEndpointCapabilities: normalizeOpenAIEndpointCapabilities([...current, capability]) })
    return true
  }

  const applyOpenAIEndpointCapabilities = (credentials: Record<string, unknown>) => {
    const capabilities = normalizeOpenAIEndpointCapabilities(get().openAIEndpointCapabilities)
    if (capabilities.length === 2 && !capabilities.includes('seedance')) {
      delete credentials.openai_capabilities
      return
    }
    credentials.openai_capabilities = capabilities
  }

  function buildAntigravityExtra(): Record<string, unknown> | undefined {
    const s = get()
    const extra: Record<string, unknown> = {}
    if (s.mixedScheduling) extra.mixed_scheduling = true
    if (s.allowOverages) extra.allow_overages = true
    return Object.keys(extra).length > 0 ? extra : undefined
  }

  const buildOpenAICompactModelMapping = () => buildModelMappingObject('mapping', [], get().openAICompactModelMappings)

  const currentModelMapping = () => {
    const s = get()
    return buildModelMappingObject(s.modelRestrictionMode, s.allowedModels, s.modelMappings)
  }

  // Watchers
  store.watch(
    (s) => s.show,
    (newVal) => {
      if (newVal) {
        // Load TLS fingerprint profiles
        adminAPI.tlsFingerprintProfiles
          .list()
          .then((profiles) => {
            set({ tlsFingerprintProfiles: profiles.map((p) => ({ id: p.id, name: p.name })) })
          })
          .catch(() => {
            set({ tlsFingerprintProfiles: [] })
          })
        // Modal opened - fill related models
        set({ allowedModels: [...getModelsByPlatform(get().form.platform)] })
        // Antigravity: 默认使用映射模式并填充默认映射
        if (get().form.platform === 'antigravity') {
          set({ antigravityModelRestrictionMode: 'mapping' })
          void fetchAntigravityDefaultMappings().then((mappings) => {
            set({ antigravityModelMappings: withMappingKeys(mappings) })
          })
          set({ antigravityWhitelistModels: [] })
        } else {
          set({ antigravityWhitelistModels: [], antigravityModelMappings: [], antigravityModelRestrictionMode: 'mapping' })
        }
      } else {
        resetForm()
      }
    }
  )

  // Sync form.type based on accountCategory, addMethod, and platform-specific type
  store.watch(
    (s) => [s.accountCategory, s.addMethod, s.antigravityAccountType, s.form.platform] as const,
    ([category, method, agType]) => {
      const platform = get().form.platform
      // Antigravity upstream 类型（实际创建为 apikey）
      if (platform === 'antigravity' && agType === 'upstream') {
        setForm({ type: 'apikey' })
        return
      }
      // Bedrock 类型
      if (platform === 'anthropic' && category === 'bedrock') {
        setForm({ type: 'bedrock' as AccountType })
        return
      }
      if ((platform === 'gemini' || platform === 'anthropic') && category === 'service_account') {
        setForm({ type: 'service_account' as AccountType })
      } else if (category === 'oauth-based') {
        setForm({ type: platform === 'anthropic' ? (method as AccountType) : 'oauth' })
      } else {
        setForm({ type: 'apikey' })
      }
    },
    { immediate: true }
  )

  // Reset platform-specific settings when platform changes
  store.watch(
    (s) => s.form.platform,
    (newPlatform) => {
      const s = get()
      // Reset base URL based on platform
      if (isMultiProtocolApiKeyPlatform(newPlatform)) {
        const mode = newPlatform === 'opencode_go' ? s.openCodeAccountMode : s.accountMode
        set({ apiKeyBaseUrl: defaultCNBaseUrl(newPlatform, mode, s.apiProtocol) })
      } else {
        set({
          apiKeyBaseUrl:
            newPlatform === 'openai'
              ? 'https://api.openai.com'
              : newPlatform === 'gemini'
                ? 'https://generativelanguage.googleapis.com'
                : newPlatform === 'grok'
                  ? 'https://api.x.ai/v1'
                  : newPlatform === 'typesafe'
                    ? 'https://api.typesafe.ai'
                    : 'https://api.anthropic.com'
        })
      }
      // Clear model-related settings
      set({ allowedModels: [], upstreamModelsPreviewed: false, modelMappings: [] })
      if (newPlatform === 'typesafe') {
        // Grok 等平台会把模式切到映射；TypeSafe 只用白名单写入 jev-latest。
        set({ accountCategory: 'apikey', modelRestrictionMode: 'whitelist', allowedModels: ['jev-latest'] })
      }
      // Antigravity: 默认使用映射模式并填充默认映射
      if (newPlatform === 'antigravity') {
        set({ antigravityModelRestrictionMode: 'mapping' })
        void fetchAntigravityDefaultMappings().then((mappings) => {
          set({ antigravityModelMappings: withMappingKeys(mappings) })
        })
        set({ antigravityWhitelistModels: [], accountCategory: 'oauth-based', antigravityAccountType: 'oauth' })
      } else {
        set({
          allowOverages: false,
          antigravityProjectId: '',
          antigravityWhitelistModels: [],
          antigravityModelMappings: [],
          antigravityModelRestrictionMode: 'mapping'
        })
      }
      if (newPlatform === 'grok') {
        set({ accountCategory: 'oauth-based', addMethod: 'oauth', modelRestrictionMode: 'mapping' })
        setForm({ concurrency: 1, load_factor: null })
      }
      if (newPlatform !== 'gemini' && newPlatform !== 'anthropic' && get().accountCategory === 'service_account') {
        set({ accountCategory: 'oauth-based' })
      }
      if (newPlatform !== 'anthropic' && get().accountCategory === 'bedrock') {
        set({ accountCategory: 'oauth-based' })
      }
      // Reset Bedrock fields when switching platforms
      set({
        bedrockAccessKeyId: '',
        bedrockSecretAccessKey: '',
        bedrockSessionToken: '',
        bedrockRegion: 'us-east-1',
        bedrockForceGlobal: false,
        bedrockAuthMode: 'sigv4',
        bedrockApiKeyValue: '',
        vertexServiceAccountJson: '',
        vertexProjectId: '',
        vertexClientEmail: '',
        vertexLocation: 'global',
        vertexAuthMode: 'service_account',
        vertexApiKey: ''
      })
      // Reset Anthropic/Antigravity-specific settings when switching to other platforms
      if (newPlatform !== 'anthropic' && newPlatform !== 'antigravity') {
        set({ interceptWarmupRequests: false })
      }
      if (newPlatform !== 'openai') {
        set({
          openaiPassthroughEnabled: false,
          openaiFlattenNamespacesEnabled: false,
          openAIEndpointCapabilities: ['chat_completions', 'embeddings'],
          openaiOAuthResponsesWebSocketV2Mode: OPENAI_WS_MODE_OFF,
          openaiAPIKeyResponsesWebSocketV2Mode: OPENAI_WS_MODE_OFF,
          codexCLIOnlyEnabled: false,
          codexCLIOnlyAppServerEnabled: false
        })
      }
      if (newPlatform !== 'anthropic') {
        set({ anthropicPassthroughEnabled: false, anthropicAPIKeyAuthScheme: 'x_api_key', webSearchEmulationMode: 'default' })
      }
      // 请求头覆写为平台相关配置（常用头集合不同），切换平台时清空，
      // 避免上一平台的配置行被提交到新平台账号
      set({
        headerOverrideEnabled: false,
        headerOverrideRows: [],
        openAIImagesUrlToB64JsonEnabled: false,
        grokOAuthCustomBaseUrlEnabled: false,
        grokOAuthBaseUrl: ''
      })
      // Reset OAuth states
      oauth.resetState()
      openaiOAuth.resetState()
      geminiOAuth.resetState()
      antigravityOAuth.resetState()
      grokOAuth.resetState()
    }
  )

  store.watch(
    (s) => [s.accountCategory, s.form.platform] as const,
    ([category, platform]) => {
      if (platform === 'openai' && category !== 'oauth-based') {
        set({ codexCLIOnlyEnabled: false, codexCLIOnlyAppServerEnabled: false })
      }
      if (platform !== 'anthropic' || category !== 'apikey') {
        set({ anthropicPassthroughEnabled: false, anthropicAPIKeyAuthScheme: 'x_api_key', webSearchEmulationMode: 'default' })
      }
    }
  )

  // Gemini AI Studio OAuth availability (requires operator-configured OAuth client)
  store.watch(
    (s) => [s.show, s.form.platform, s.accountCategory] as const,
    ([show, platform, category]) => {
      if (!show || platform !== 'gemini' || category !== 'oauth-based') {
        set({ geminiAIStudioOAuthEnabled: false })
        return
      }
      void geminiOAuth.getCapabilities().then((caps) => {
        set({ geminiAIStudioOAuthEnabled: !!caps?.ai_studio_oauth_enabled })
        if (!get().geminiAIStudioOAuthEnabled && get().geminiOAuthType === 'ai_studio') {
          set({ geminiOAuthType: 'code_assist' })
        }
      })
    },
    { immediate: true }
  )

  const handleSelectGeminiOAuthType = (oauthType: GeminiOAuthType) => {
    if (oauthType === 'ai_studio' && !get().geminiAIStudioOAuthEnabled) {
      appStore().showError(t('admin.accounts.oauth.gemini.aiStudioNotConfigured'))
      return
    }
    set({ geminiOAuthType: oauthType })
  }

  // Auto-fill related models when switching to whitelist mode or changing platform
  store.watch(
    (s) => [s.modelRestrictionMode, s.form.platform] as const,
    ([newMode]) => {
      if (newMode === 'whitelist') {
        set({ allowedModels: [...getModelsByPlatform(get().form.platform)] })
      }
    }
  )
  // Antigravity 默认不做限制：白名单留空表示允许所有（包含未来新增模型）。
  // 如果需要快速填充常用模型，可在组件内点“填充相关模型”。（Vue 版对应 watch 为空操作）

  // Model mapping helpers
  type MappingListKey = 'modelMappings' | 'openAICompactModelMappings' | 'antigravityModelMappings'
  const addMappingRow = (list: MappingListKey) => set({ [list]: [...get()[list], newMapping()] })
  const removeMappingRow = (list: MappingListKey, index: number) =>
    set({ [list]: get()[list].filter((_, i) => i !== index) })
  const updateMappingRow = (list: MappingListKey, index: number, patch: Partial<Pick<ModelMapping, 'from' | 'to'>>) =>
    set({ [list]: get()[list].map((item, i) => (i === index ? { ...item, ...patch } : item)) })

  const addPresetMapping = (from: string, to: string) => {
    if (get().modelMappings.some((m) => m.from === from)) {
      appStore().showInfo(t('admin.accounts.mappingExists', { model: from }))
      return
    }
    set({ modelMappings: [...get().modelMappings, newMapping(from, to)] })
  }

  const addAntigravityPresetMapping = (from: string, to: string) => {
    if (get().antigravityModelMappings.some((m) => m.from === from)) {
      appStore().showInfo(t('admin.accounts.mappingExists', { model: from }))
      return
    }
    set({ antigravityModelMappings: [...get().antigravityModelMappings, newMapping(from, to)] })
  }

  // Vue 模板渲染时 selectedErrorCodes.sort() 原地排序，这里写入时保持升序
  const sortCodes = (codes: number[]) => [...codes].sort((a, b) => a - b)

  // Error code toggle helper
  const toggleErrorCode = async (code: number) => {
    const selected = get().selectedErrorCodes
    const index = selected.indexOf(code)
    if (index === -1) {
      // Adding code - check for 429/529 warning
      if (code === 429) {
        if (!(await deps.confirm(t('admin.accounts.customErrorCodes429Warning')))) {
          return
        }
      } else if (code === 529) {
        if (!(await deps.confirm(t('admin.accounts.customErrorCodes529Warning')))) {
          return
        }
      }
      set({ selectedErrorCodes: sortCodes([...get().selectedErrorCodes, code]) })
    } else {
      set({ selectedErrorCodes: selected.filter((item) => item !== code) })
    }
  }

  // Add custom error code from input
  const addCustomErrorCode = async () => {
    const code = get().customErrorCodeInput
    if (code === null || code < 100 || code > 599) {
      appStore().showError(t('admin.accounts.invalidErrorCode'))
      return
    }
    if (get().selectedErrorCodes.includes(code)) {
      appStore().showInfo(t('admin.accounts.errorCodeExists'))
      return
    }
    // Check for 429/529 warning
    if (code === 429) {
      if (!(await deps.confirm(t('admin.accounts.customErrorCodes429Warning')))) {
        return
      }
    } else if (code === 529) {
      if (!(await deps.confirm(t('admin.accounts.customErrorCodes529Warning')))) {
        return
      }
    }
    set({ selectedErrorCodes: sortCodes([...get().selectedErrorCodes, code]), customErrorCodeInput: null })
  }

  // Remove error code
  const removeErrorCode = (code: number) => {
    set({ selectedErrorCodes: get().selectedErrorCodes.filter((item) => item !== code) })
  }

  const addTempUnschedRule = (preset?: Omit<TempUnschedRuleForm, 'key'>) => {
    const key = nextRowKey('create-temp-unsched-rule')
    if (preset) {
      set({ tempUnschedRules: [...get().tempUnschedRules, { ...preset, key }] })
      return
    }
    set({
      tempUnschedRules: [
        ...get().tempUnschedRules,
        { key, error_code: null, keywords: '', duration_minutes: 30, description: '', scope: 'model' }
      ]
    })
  }

  const removeTempUnschedRule = (index: number) => {
    set({ tempUnschedRules: get().tempUnschedRules.filter((_, i) => i !== index) })
  }

  const updateTempUnschedRule = (index: number, patch: Partial<TempUnschedRuleForm>) => {
    set({ tempUnschedRules: get().tempUnschedRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) })
  }

  const moveTempUnschedRule = (index: number, direction: number) => {
    const target = index + direction
    const rules = [...get().tempUnschedRules]
    if (target < 0 || target >= rules.length) return
    const current = rules[index]
    rules[index] = rules[target]
    rules[target] = current
    set({ tempUnschedRules: rules })
  }

  const splitTempUnschedKeywords = (value: string) => {
    return value
      .split(/[,;]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }

  const buildTempUnschedRules = (rules: TempUnschedRuleForm[]) => {
    const out: Array<{
      error_code: number
      keywords: string[]
      duration_minutes: number
      description: string
      scope: TempUnschedulableScope
    }> = []

    for (const rule of rules) {
      const errorCode = Number(rule.error_code)
      const duration = Number(rule.duration_minutes)
      const keywords = splitTempUnschedKeywords(rule.keywords)
      if (!Number.isFinite(errorCode) || errorCode < 100 || errorCode > 599) {
        continue
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        continue
      }
      if (keywords.length === 0) {
        continue
      }
      out.push({
        error_code: Math.trunc(errorCode),
        keywords,
        duration_minutes: Math.trunc(duration),
        description: rule.description.trim(),
        scope: rule.scope
      })
    }

    return out
  }

  const applyTempUnschedConfig = (credentials: Record<string, unknown>) => {
    const s = get()
    if (!s.tempUnschedEnabled) {
      delete credentials.temp_unschedulable_enabled
      delete credentials.temp_unschedulable_rules
      return true
    }

    const rules = buildTempUnschedRules(s.tempUnschedRules)
    if (rules.length === 0) {
      appStore().showError(t('admin.accounts.tempUnschedulable.rulesInvalid'))
      return false
    }

    credentials.temp_unschedulable_enabled = true
    credentials.temp_unschedulable_rules = rules
    return true
  }

  const needsMixedChannelCheck = (platform: AccountPlatform) => platform === 'antigravity' || platform === 'anthropic'

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

  const clearMixedChannelDialog = () => {
    set({
      showMixedChannelWarning: false,
      mixedChannelWarningDetails: null,
      mixedChannelWarningRawMessage: '',
      mixedChannelWarningAction: null
    })
  }

  const openMixedChannelDialog = (opts: {
    response?: CheckMixedChannelResponse
    message?: string
    onConfirm: () => Promise<void>
  }) => {
    set({
      mixedChannelWarningDetails: buildMixedChannelDetails(opts.response),
      mixedChannelWarningRawMessage: opts.message || opts.response?.message || t('admin.accounts.failedToCreate'),
      mixedChannelWarningAction: opts.onConfirm,
      showMixedChannelWarning: true
    })
  }

  const withAntigravityConfirmFlag = (payload: CreateAccountRequest): CreateAccountRequest => {
    if (needsMixedChannelCheck(payload.platform) && get().antigravityMixedChannelConfirmed) {
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
    const { form } = get()
    if (!needsMixedChannelCheck(form.platform)) {
      return true
    }
    if (get().antigravityMixedChannelConfirmed) {
      return true
    }

    try {
      const result = await adminAPI.accounts.checkMixedChannelRisk({
        platform: form.platform,
        group_ids: form.group_ids
      })
      if (!result.has_risk) {
        return true
      }
      openMixedChannelDialog({
        response: result,
        onConfirm: async () => {
          set({ antigravityMixedChannelConfirmed: true })
          await onConfirm()
        }
      })
      return false
    } catch (error: any) {
      appStore().showError(
        error.response?.data?.message || error.response?.data?.detail || t('admin.accounts.failedToCreate')
      )
      return false
    }
  }

  const submitCreateAccount = async (payload: CreateAccountRequest): Promise<void> => {
    set({ submitting: true })
    try {
      const account = await adminAPI.accounts.create(withAntigravityConfirmFlag(payload))
      const modelMapping = payload.credentials.model_mapping
      const hasConcreteMappedTarget =
        payload.type === 'apikey' &&
        typeof modelMapping === 'object' &&
        modelMapping !== null &&
        Object.values(modelMapping).some(
          (target) => typeof target === 'string' && target.trim() !== '' && !target.includes('*')
        )
      if (get().upstreamModelsPreviewed || hasConcreteMappedTarget) {
        try {
          const result = await adminAPI.accounts.syncUpstreamModels(account.id)
          const warnings = result.warnings ?? []
          if (warnings.some((warning) => warning.code === 'upstream_model_metadata_incomplete')) {
            appStore().showWarning(t('admin.accounts.syncUpstreamModelsMetadataIncomplete'))
          } else if (warnings.some((warning) => warning.code === 'upstream_model_metadata_partial')) {
            appStore().showWarning(t('admin.accounts.syncUpstreamModelsMetadataPartial'))
          }
        } catch {
          appStore().showWarning(t('admin.accounts.syncUpstreamModelsFailed'))
        }
      }
      if (payload.type === 'apikey' && payload.upstream_billing_probe_enabled === true) {
        try {
          await adminAPI.accounts.probeUpstreamBilling(account.id)
        } catch {
          appStore().showWarning(t('admin.accounts.upstreamBilling.probeFailed'))
        }
      }
      appStore().showSuccess(t('admin.accounts.accountCreated'))
      emitCreated()
      handleClose()
    } catch (error: any) {
      if (
        error.response?.status === 409 &&
        error.response?.data?.error === 'mixed_channel_warning' &&
        needsMixedChannelCheck(get().form.platform)
      ) {
        openMixedChannelDialog({
          message: error.response?.data?.message,
          onConfirm: async () => {
            set({ antigravityMixedChannelConfirmed: true })
            await submitCreateAccount(payload)
          }
        })
        return
      }
      appStore().showError(error.response?.data?.message || error.response?.data?.detail || t('admin.accounts.failedToCreate'))
    } finally {
      set({ submitting: false })
    }
  }

  // Methods
  const resetForm = () => {
    set({
      step: 1,
      form: initialForm(),
      accountCategory: 'oauth-based',
      addMethod: 'oauth',
      accountMode: 'payg',
      openCodeAccountMode: 'zen',
      apiProtocol: 'adaptive',
      openCodeGoProtocolRules: cloneOpenCodeGoProtocolRules(defaultOpenCodeProtocolRules('zen')),
      adaptiveBaseUrls: { chat_completions: '', anthropic: '', responses: '' },
      apiKeyBaseUrl: 'https://api.anthropic.com',
      apiKeyValue: '',
      upstreamRequestIdHeader: '',
      upstreamBillingAutoProbeEnabled: true,
      editQuotaLimit: null,
      editQuotaDailyLimit: null,
      editQuotaWeeklyLimit: null,
      editDailyResetMode: null,
      editDailyResetHour: null,
      editWeeklyResetMode: null,
      editWeeklyResetDay: null,
      editWeeklyResetHour: null,
      editResetTimezone: null,
      modelMappings: [],
      openAICompactModelMappings: [],
      modelRestrictionMode: 'whitelist',
      allowedModels: [...claudeModels], // Default fill related models
      antigravityModelRestrictionMode: 'mapping',
      antigravityWhitelistModels: []
    })
    void fetchAntigravityDefaultMappings().then((mappings) => {
      set({ antigravityModelMappings: withMappingKeys(mappings) })
    })
    set({
      poolModeEnabled: false,
      poolModeRetryCount: DEFAULT_POOL_MODE_RETRY_COUNT,
      poolModeRetryStatusCodesInput: '',
      explicitCacheUpstreamEnabled: false,
      explicitCacheUpstreamMaxTTL: '',
      customErrorCodesEnabled: false,
      selectedErrorCodes: [],
      customErrorCodeInput: null,
      headerOverrideEnabled: false,
      headerOverrideRows: [],
      openAIImagesUrlToB64JsonEnabled: false,
      grokOAuthCustomBaseUrlEnabled: false,
      grokOAuthBaseUrl: '',
      interceptWarmupRequests: false,
      autoPauseOnExpired: true,
      openaiPassthroughEnabled: false,
      openaiFlattenNamespacesEnabled: false,
      openAILongContextBillingEnabled: false,
      openAILongContextBillingTouched: false,
      openAICompactMode: 'auto',
      openAIResponsesMode: 'auto',
      openAIEndpointCapabilities: ['chat_completions', 'embeddings'],
      openaiOAuthResponsesWebSocketV2Mode: OPENAI_WS_MODE_OFF,
      openaiAPIKeyResponsesWebSocketV2Mode: OPENAI_WS_MODE_OFF,
      codexCLIOnlyEnabled: false,
      codexCLIOnlyAppServerEnabled: false,
      codexFingerprintMode: 'off',
      anthropicPassthroughEnabled: false,
      anthropicAPIKeyAuthScheme: 'x_api_key',
      webSearchEmulationMode: 'default',
      // Reset quota control state
      windowCostEnabled: false,
      windowCostLimit: null,
      windowCostStickyReserve: null,
      sessionLimitEnabled: false,
      maxSessions: null,
      sessionIdleTimeout: null,
      rpmLimitEnabled: false,
      baseRpm: null,
      rpmStrategy: 'tiered',
      rpmStickyBuffer: null,
      userMsgQueueMode: '',
      tlsFingerprintEnabled: false,
      tlsFingerprintProfileId: null,
      sessionIdMaskingEnabled: false,
      cacheTTLOverrideEnabled: false,
      cacheTTLOverrideTarget: '5m',
      customBaseUrlEnabled: false,
      customBaseUrl: '',
      allowOverages: false,
      antigravityAccountType: 'oauth',
      antigravityProjectId: '',
      upstreamBaseUrl: '',
      upstreamApiKey: '',
      vertexServiceAccountJson: '',
      vertexProjectId: '',
      vertexClientEmail: '',
      vertexLocation: 'global',
      vertexAuthMode: 'service_account',
      vertexApiKey: '',
      tempUnschedEnabled: false,
      tempUnschedRules: [],
      geminiOAuthType: 'code_assist',
      geminiTierGoogleOne: 'google_one_free',
      geminiTierGcp: 'gcp_standard',
      geminiTierAIStudio: 'aistudio_free'
    })
    oauth.resetState()
    openaiOAuth.resetState()
    geminiOAuth.resetState()
    antigravityOAuth.resetState()
    grokOAuth.resetState()
    flowHandle.current?.reset()
    set({ antigravityMixedChannelConfirmed: false, upstreamModelsPreviewed: false })
    clearMixedChannelDialog()
  }

  const handleClose = () => {
    set({ antigravityMixedChannelConfirmed: false })
    clearMixedChannelDialog()
    callbacks.onClose()
  }

  const buildOpenAIExtra = (base?: Record<string, unknown>): Record<string, unknown> | undefined => {
    const s = get()
    if (s.form.platform !== 'openai') {
      return base
    }

    const extra: Record<string, unknown> = { ...(base || {}) }
    if (s.accountCategory === 'oauth-based') {
      extra.openai_oauth_responses_websockets_v2_mode = s.openaiOAuthResponsesWebSocketV2Mode
      extra.openai_oauth_responses_websockets_v2_enabled = isOpenAIWSModeEnabled(s.openaiOAuthResponsesWebSocketV2Mode)
    } else if (s.accountCategory === 'apikey') {
      extra.openai_apikey_responses_websockets_v2_mode = s.openaiAPIKeyResponsesWebSocketV2Mode
      extra.openai_apikey_responses_websockets_v2_enabled = isOpenAIWSModeEnabled(s.openaiAPIKeyResponsesWebSocketV2Mode)
    }
    // 清理兼容旧键，统一改用分类型开关。
    delete extra.responses_websockets_v2_enabled
    delete extra.openai_ws_enabled
    if (s.openaiPassthroughEnabled) {
      extra.openai_passthrough = true
    } else {
      delete extra.openai_passthrough
      delete extra.openai_oauth_passthrough
    }
    // 缺省即保留 namespace，不写空值，避免 extra 里堆积默认项
    if (s.form.type === 'oauth' && s.openaiFlattenNamespacesEnabled) {
      extra.openai_responses_flatten_namespaces = true
    } else {
      delete extra.openai_responses_flatten_namespaces
    }
    extra.openai_long_context_billing_enabled = s.openAILongContextBillingEnabled

    if (s.accountCategory === 'oauth-based' && s.codexCLIOnlyEnabled) {
      extra.codex_cli_only = true
    } else {
      delete extra.codex_cli_only
    }
    delete extra.codex_cli_only_allowed_clients
    if (s.accountCategory === 'oauth-based' && s.codexCLIOnlyEnabled && s.codexCLIOnlyAppServerEnabled) {
      extra.codex_cli_only_allow_app_server = true
    } else {
      delete extra.codex_cli_only_allow_app_server
    }
    // 收敛是显式 opt-in：off 即默认值，不落键；device/session/full 必须显式写入，
    // 否则管理员的选择会被当成默认而丢失（#5610）。
    if (s.codexFingerprintMode !== 'off') {
      extra.codex_fingerprint_mode = s.codexFingerprintMode
    } else {
      delete extra.codex_fingerprint_mode
    }
    if (s.openAICompactMode !== 'auto') {
      extra.openai_compact_mode = s.openAICompactMode
    } else {
      delete extra.openai_compact_mode
    }

    if (s.accountCategory === 'apikey' && openAITextGenerationCapabilityEnabled(s) && s.openAIResponsesMode !== 'auto') {
      extra.openai_responses_mode = s.openAIResponsesMode
    } else {
      delete extra.openai_responses_mode
    }
    if (s.accountCategory === 'apikey' && s.openAIImagesUrlToB64JsonEnabled) {
      extra.images_url_to_b64_json = true
    } else {
      delete extra.images_url_to_b64_json
    }

    return Object.keys(extra).length > 0 ? extra : undefined
  }

  const buildOpenAICodexImportExtra = (): Record<string, unknown> | undefined => {
    const extra = buildOpenAIExtra()
    if (!extra) {
      return undefined
    }
    if (!get().openAILongContextBillingTouched) {
      delete extra.openai_long_context_billing_enabled
    }
    return Object.keys(extra).length > 0 ? extra : undefined
  }

  const buildAnthropicExtra = (base?: Record<string, unknown>): Record<string, unknown> | undefined => {
    const s = get()
    if (s.form.platform !== 'anthropic' || s.accountCategory !== 'apikey') {
      return base
    }

    const extra: Record<string, unknown> = { ...(base || {}) }
    if (s.anthropicPassthroughEnabled) {
      extra.anthropic_passthrough = true
    } else {
      delete extra.anthropic_passthrough
    }
    if (s.anthropicAPIKeyAuthScheme === 'authorization_bearer') {
      extra.anthropic_apikey_auth_scheme = 'authorization_bearer'
    } else {
      delete extra.anthropic_apikey_auth_scheme
    }
    if (s.webSearchEmulationMode === 'default') {
      delete extra.web_search_emulation
    } else {
      extra.web_search_emulation = s.webSearchEmulationMode
    }

    return Object.keys(extra).length > 0 ? extra : undefined
  }

  // Helper function to create account with mixed channel warning handling
  const doCreateAccount = async (payload: CreateAccountRequest) => {
    const canContinue = await ensureAntigravityMixedChannelConfirmed(async () => {
      await submitCreateAccount(payload)
    })
    if (!canContinue) {
      return
    }
    await submitCreateAccount(payload)
  }

  // Handle mixed channel warning confirmation
  const handleMixedChannelConfirm = async () => {
    const action = get().mixedChannelWarningAction
    if (!action) {
      clearMixedChannelDialog()
      return
    }
    clearMixedChannelDialog()
    set({ submitting: true })
    try {
      await action()
    } finally {
      set({ submitting: false })
    }
  }

  const handleMixedChannelCancel = () => {
    clearMixedChannelDialog()
  }

  const normalizePoolModeRetryCount = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) {
      return DEFAULT_POOL_MODE_RETRY_COUNT
    }
    const normalized = Math.trunc(value)
    if (normalized < 0) {
      return 0
    }
    if (normalized > MAX_POOL_MODE_RETRY_COUNT) {
      return MAX_POOL_MODE_RETRY_COUNT
    }
    return normalized
  }

  function parsePoolModeRetryStatusCodes(input: string): number[] {
    if (!input || !input.trim()) return []
    const seen = new Set<number>()
    const out: number[] = []
    for (const token of input.split(/[,\s]+/)) {
      const trimmed = token.trim()
      if (!trimmed) continue
      const n = Number(trimmed)
      if (!Number.isFinite(n) || !Number.isInteger(n)) continue
      if (n < 100 || n > 599) continue
      if (seen.has(n)) continue
      seen.add(n)
      out.push(n)
    }
    return out.sort((a, b) => a - b)
  }

  const applyPoolMode = (credentials: Record<string, unknown>) => {
    const s = get()
    if (!s.poolModeEnabled) return
    credentials.pool_mode = true
    credentials.pool_mode_retry_count = normalizePoolModeRetryCount(s.poolModeRetryCount)
    const parsedRetryStatusCodes = parsePoolModeRetryStatusCodes(s.poolModeRetryStatusCodesInput)
    if (parsedRetryStatusCodes.length > 0) {
      credentials.pool_mode_retry_status_codes = parsedRetryStatusCodes
    }
  }

  const applyVertexServiceAccountJson = (value: string) => {
    const raw = value.trim()
    if (!raw) {
      set({ vertexProjectId: '', vertexClientEmail: '' })
      return false
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const projectId = typeof parsed.project_id === 'string' ? parsed.project_id.trim() : ''
      const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : ''
      const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key.trim() : ''
      if (!projectId || !clientEmail || !privateKey) {
        appStore().showError(t('admin.accounts.vertexSaJsonMissingFields'))
        return false
      }
      set({ vertexProjectId: projectId, vertexClientEmail: clientEmail, vertexServiceAccountJson: JSON.stringify(parsed) })
      return true
    } catch {
      appStore().showError(t('admin.accounts.vertexSaJsonInvalid'))
      return false
    }
  }

  const parseVertexServiceAccountJson = () => applyVertexServiceAccountJson(get().vertexServiceAccountJson)

  const handleVertexServiceAccountFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return
    try {
      applyVertexServiceAccountJson(await file.text())
    } finally {
      input.value = ''
    }
  }

  const handleVertexServiceAccountDrop = async (file: File | undefined) => {
    set({ vertexServiceAccountDragActive: false })
    if (!file) return
    applyVertexServiceAccountJson(await file.text())
  }

  // Create account and handle success/failure
  const createAccountAndFinish = async (
    platform: AccountPlatform,
    type: AccountType,
    credentials: Record<string, unknown>,
    extra?: Record<string, unknown>
  ) => {
    if (!applyTempUnschedConfig(credentials)) {
      return
    }
    const s = get()
    // Inject quota limits for apikey/bedrock/service_account accounts
    let finalExtra = withUpstreamRequestIdHeader(extra)
    if (supportsAccountQuota(type)) {
      const quotaExtra: Record<string, unknown> = { ...(finalExtra || {}) }
      if (s.editQuotaLimit != null && s.editQuotaLimit > 0) {
        quotaExtra.quota_limit = s.editQuotaLimit
      }
      if (s.editQuotaDailyLimit != null && s.editQuotaDailyLimit > 0) {
        quotaExtra.quota_daily_limit = s.editQuotaDailyLimit
      }
      if (s.editQuotaWeeklyLimit != null && s.editQuotaWeeklyLimit > 0) {
        quotaExtra.quota_weekly_limit = s.editQuotaWeeklyLimit
      }
      // Quota reset mode config
      if (s.editDailyResetMode === 'fixed') {
        quotaExtra.quota_daily_reset_mode = 'fixed'
        quotaExtra.quota_daily_reset_hour = s.editDailyResetHour ?? 0
      }
      if (s.editWeeklyResetMode === 'fixed') {
        quotaExtra.quota_weekly_reset_mode = 'fixed'
        quotaExtra.quota_weekly_reset_day = s.editWeeklyResetDay ?? 1
        quotaExtra.quota_weekly_reset_hour = s.editWeeklyResetHour ?? 0
      }
      if (s.editDailyResetMode === 'fixed' || s.editWeeklyResetMode === 'fixed') {
        quotaExtra.quota_reset_timezone = s.editResetTimezone || 'UTC'
      }
      // Quota notify config
      quotaNotify.writeToExtra(quotaExtra, 'create')
      if (Object.keys(quotaExtra).length > 0) {
        finalExtra = quotaExtra
      }
    }
    if (platform === 'openai') {
      if (type === 'apikey') {
        applyOpenAIEndpointCapabilities(credentials)
      }
      const compactModelMapping = buildOpenAICompactModelMapping()
      if (compactModelMapping) {
        credentials.compact_model_mapping = compactModelMapping
      } else {
        delete credentials.compact_model_mapping
      }
    }
    if (platform === 'grok') {
      if (!credentials.base_url) {
        credentials.base_url = s.apiKeyBaseUrl.trim() || 'https://api.x.ai/v1'
      }
      const modelMapping = currentModelMapping()
      if (modelMapping) {
        credentials.model_mapping = modelMapping
      } else {
        delete credentials.model_mapping
      }
    }
    const { form } = s
    await doCreateAccount({
      name: form.name,
      notes: form.notes,
      platform,
      type,
      credentials,
      extra: finalExtra,
      proxy_id: form.proxy_id,
      concurrency: form.concurrency,
      load_factor: form.load_factor ?? undefined,
      priority: form.priority,
      rate_multiplier: form.rate_multiplier,
      group_ids: form.group_ids,
      expires_at: form.expires_at,
      // 上游倍率探测对全部 API-key 平台开放（antigravity upstream 走本 helper）；
      // 非 apikey 类型（bedrock/oauth）不传，后端不动作。
      upstream_billing_probe_enabled: type === 'apikey' ? s.upstreamBillingAutoProbeEnabled : undefined,
      auto_pause_on_expired: s.autoPauseOnExpired
    })
  }

  const handleSubmit = async () => {
    const s = get()
    const { form } = s
    // For OAuth-based type, handle OAuth flow (goes to step 2)
    if (isOAuthFlow(s)) {
      if (!isGrokSSOInputMethod(s) && !form.name.trim()) {
        appStore().showError(t('admin.accounts.pleaseEnterAccountName'))
        return
      }
      const canContinue = await ensureAntigravityMixedChannelConfirmed(async () => {
        set({ step: 2 })
      })
      if (!canContinue) {
        return
      }
      set({ step: 2 })
      return
    }

    // For Bedrock type, create directly
    if (form.platform === 'anthropic' && s.accountCategory === 'bedrock') {
      if (!form.name.trim()) {
        appStore().showError(t('admin.accounts.pleaseEnterAccountName'))
        return
      }

      const credentials: Record<string, unknown> = {
        auth_mode: s.bedrockAuthMode,
        aws_region: s.bedrockRegion.trim() || 'us-east-1'
      }

      if (s.bedrockAuthMode === 'sigv4') {
        if (!s.bedrockAccessKeyId.trim()) {
          appStore().showError(t('admin.accounts.bedrockAccessKeyIdRequired'))
          return
        }
        if (!s.bedrockSecretAccessKey.trim()) {
          appStore().showError(t('admin.accounts.bedrockSecretAccessKeyRequired'))
          return
        }
        credentials.aws_access_key_id = s.bedrockAccessKeyId.trim()
        credentials.aws_secret_access_key = s.bedrockSecretAccessKey.trim()
        if (s.bedrockSessionToken.trim()) {
          credentials.aws_session_token = s.bedrockSessionToken.trim()
        }
      } else {
        if (!s.bedrockApiKeyValue.trim()) {
          appStore().showError(t('admin.accounts.bedrockApiKeyRequired'))
          return
        }
        credentials.api_key = s.bedrockApiKeyValue.trim()
      }

      if (s.bedrockForceGlobal) {
        credentials.aws_force_global = 'true'
      }

      // Model mapping
      const modelMapping = currentModelMapping()
      if (modelMapping) {
        credentials.model_mapping = modelMapping
      }

      // Pool mode
      applyPoolMode(credentials)

      applyInterceptWarmup(credentials, s.interceptWarmupRequests, 'create')

      await createAccountAndFinish('anthropic', 'bedrock' as AccountType, credentials)
      return
    }

    // For Antigravity upstream type, create directly
    if (form.platform === 'antigravity' && s.antigravityAccountType === 'upstream') {
      if (!form.name.trim()) {
        appStore().showError(t('admin.accounts.pleaseEnterAccountName'))
        return
      }
      if (!s.upstreamBaseUrl.trim()) {
        appStore().showError(t('admin.accounts.upstream.pleaseEnterBaseUrl'))
        return
      }
      if (!s.upstreamApiKey.trim()) {
        appStore().showError(t('admin.accounts.upstream.pleaseEnterApiKey'))
        return
      }

      // Build upstream credentials (and optional model restriction)
      const credentials: Record<string, unknown> = {
        base_url: s.upstreamBaseUrl.trim(),
        api_key: s.upstreamApiKey.trim()
      }

      // Antigravity 只使用映射模式
      const antigravityModelMapping = buildModelMappingObject('mapping', [], s.antigravityModelMappings)
      if (antigravityModelMapping) {
        credentials.model_mapping = antigravityModelMapping
      }

      applyInterceptWarmup(credentials, s.interceptWarmupRequests, 'create')

      const extra = buildAntigravityExtra()
      await createAccountAndFinish(form.platform, 'apikey', credentials, extra)
      return
    }

    if ((form.platform === 'gemini' || form.platform === 'anthropic') && s.accountCategory === 'service_account') {
      if (!form.name.trim()) {
        appStore().showError(t('admin.accounts.pleaseEnterAccountName'))
        return
      }
      if (vertexUsesApiKey(s)) {
        if (!s.vertexApiKey.trim()) {
          appStore().showError(t('admin.accounts.vertexApiKeyRequired'))
          return
        }
        const projectId = s.vertexProjectId.trim()
        if (projectId && !s.vertexLocation.trim()) {
          appStore().showError(t('admin.accounts.vertexLocationRequired'))
          return
        }
        const credentials: Record<string, unknown> = {
          auth_mode: 'apikey',
          api_key: s.vertexApiKey.trim(),
          location: s.vertexLocation.trim() || 'global',
          tier_id: 'vertex'
        }
        if (projectId) {
          credentials.project_id = projectId
        }
        await createAccountAndFinish(form.platform, 'service_account' as AccountType, credentials)
        return
      }
      if (!parseVertexServiceAccountJson()) {
        return
      }
      const parsed = get()
      if (!parsed.vertexLocation.trim()) {
        appStore().showError(t('admin.accounts.vertexLocationRequired'))
        return
      }
      const credentials: Record<string, unknown> = {
        service_account_json: parsed.vertexServiceAccountJson.trim(),
        project_id: parsed.vertexProjectId.trim(),
        client_email: parsed.vertexClientEmail.trim(),
        location: parsed.vertexLocation.trim(),
        tier_id: 'vertex'
      }
      await createAccountAndFinish(form.platform, 'service_account' as AccountType, credentials)
      return
    }

    // For apikey type, create directly
    if (!s.apiKeyValue.trim()) {
      appStore().showError(t('admin.accounts.pleaseEnterApiKey'))
      return
    }

    // Determine default base URL based on platform
    const defaultBaseUrl =
      form.platform === 'openai'
        ? 'https://api.openai.com'
        : form.platform === 'gemini'
          ? 'https://generativelanguage.googleapis.com'
          : form.platform === 'grok'
            ? 'https://api.x.ai/v1'
            : form.platform === 'typesafe'
              ? 'https://api.typesafe.ai'
              : 'https://api.anthropic.com'

    // Build credentials with optional model mapping
    const credentials: Record<string, unknown> = {
      base_url: s.apiKeyBaseUrl.trim() || defaultBaseUrl,
      api_key: s.apiKeyValue.trim()
    }
    if (form.platform === 'gemini' && isOfficialGeminiBaseUrl(s.apiKeyBaseUrl)) {
      credentials.tier_id = s.geminiTierAIStudio
    }

    // 国产供应商：账号模式 + 协议 + 对应端点写入凭据；后端按 account_mode 路由
    // 额度/余额探测，按 api_protocol 路由转发端点与格式。注意 CN apikey 走本函数
    // 的通用路径（直接 doCreateAccount），不经过 createAccountAndFinish。
    if (isMultiProtocolApiKeyPlatform(form.platform)) {
      credentials.account_mode = form.platform === 'opencode_go' ? s.openCodeAccountMode : s.accountMode
      credentials.api_protocol = s.apiProtocol
      if (s.apiProtocol === 'adaptive') {
        const defaults = defaultCNAdaptiveBaseUrls(
          form.platform,
          form.platform === 'opencode_go' ? s.openCodeAccountMode : s.accountMode
        )
        const protocolBaseUrls: Record<string, string> = {}
        for (const item of cnAdaptiveProtocolOptions(s)) {
          protocolBaseUrls[item.value] = (s.adaptiveBaseUrls[item.value] || defaults[item.value]).trim()
        }
        credentials.api_base_urls = protocolBaseUrls
        credentials.base_url = protocolBaseUrls.chat_completions
      }
      const resolvedCNBase = (
        s.apiKeyBaseUrl.trim() || defaultCNBaseUrl(form.platform, currentOpenCodeOrCNMode(s), s.apiProtocol)
      ).trim()
      if (s.apiProtocol !== 'adaptive' && resolvedCNBase) {
        credentials.base_url = resolvedCNBase
      }
      // 智谱团队版 Coding Plan：组织/项目 ID 写入凭据（非空才写）
      if (form.platform === 'zhipu' && s.accountMode === 'coding') {
        if (s.zhipuOrganization.trim()) credentials.zhipu_organization = s.zhipuOrganization.trim()
        if (s.zhipuProject.trim()) credentials.zhipu_project = s.zhipuProject.trim()
      }
      if (providerRoutesByModel(form.platform)) {
        applyOpenCodeGoProtocolRules(credentials, s.openCodeGoProtocolRules, 'create')
      }
    }

    // Add model mapping if configured（OpenAI 开启自动透传时不应用）
    if (!isOpenAIModelRestrictionDisabled(s)) {
      const modelMapping = currentModelMapping()
      if (modelMapping) {
        credentials.model_mapping = modelMapping
      }
    }
    if (form.platform === 'openai') {
      applyOpenAIEndpointCapabilities(credentials)
      const compactModelMapping = buildOpenAICompactModelMapping()
      if (compactModelMapping) {
        credentials.compact_model_mapping = compactModelMapping
      }
    }

    // Add pool mode if enabled
    applyPoolMode(credentials)

    applyExplicitCacheUpstreamCredentials(
      credentials,
      form.platform === 'gemini' && !isOfficialGeminiBaseUrl(s.apiKeyBaseUrl) && s.explicitCacheUpstreamEnabled,
      s.explicitCacheUpstreamMaxTTL
    )

    // Add custom error codes if enabled
    if (s.customErrorCodesEnabled) {
      credentials.custom_error_codes_enabled = true
      credentials.custom_error_codes = [...s.selectedErrorCodes]
    }

    // Add header override if enabled for this API-key platform
    if (isHeaderOverrideCapable(form.platform, 'apikey')) {
      if (s.headerOverrideEnabled) {
        const headerError = validateHeaderOverrideRows(s.headerOverrideRows)
        if (headerError) {
          appStore().showError(t(`admin.accounts.headerOverride.${headerError}`))
          return
        }
      }
      applyHeaderOverride(credentials, s.headerOverrideEnabled, s.headerOverrideRows, 'create')
    }

    applyInterceptWarmup(credentials, s.interceptWarmupRequests, 'create')
    if (!applyTempUnschedConfig(credentials)) {
      return
    }

    setForm({ credentials })
    const extra = buildAnthropicExtra(buildOpenAIExtra())
    const latest = get()

    await doCreateAccount({
      ...latest.form,
      group_ids: latest.form.group_ids,
      extra: withUpstreamRequestIdHeader(extra),
      upstream_billing_probe_enabled: latest.upstreamBillingAutoProbeEnabled,
      auto_pause_on_expired: latest.autoPauseOnExpired
    })
  }

  const resetOAuthClients = () => {
    oauth.resetState()
    openaiOAuth.resetState()
    geminiOAuth.resetState()
    antigravityOAuth.resetState()
    grokOAuth.resetState()
  }

  const goBackToBasicInfo = () => {
    set({ step: 1 })
    resetOAuthClients()
    flowHandle.current?.reset()
  }

  const handleGenerateUrl = async () => {
    const s = get()
    const { form } = s
    if (form.platform === 'openai') {
      await openaiOAuth.generateAuthUrl(form.proxy_id)
    } else if (form.platform === 'gemini') {
      await geminiOAuth.generateAuthUrl(
        form.proxy_id,
        flowHandle.current?.projectId,
        s.geminiOAuthType,
        geminiSelectedTier(s)
      )
    } else if (form.platform === 'antigravity') {
      await antigravityOAuth.generateAuthUrl(form.proxy_id)
    } else if (form.platform === 'grok') {
      await grokOAuth.generateAuthUrl(form.proxy_id)
    } else {
      await oauth.generateAuthUrl(s.addMethod, form.proxy_id)
    }
  }

  /** OAuth 流程里各批量路径共用的账号基础字段 */
  const baseAccountFields = () => {
    const s = get()
    const { form } = s
    return {
      notes: form.notes,
      proxy_id: form.proxy_id,
      concurrency: form.concurrency,
      load_factor: form.load_factor ?? undefined,
      priority: form.priority,
      rate_multiplier: form.rate_multiplier,
      group_ids: form.group_ids,
      expires_at: form.expires_at,
      auto_pause_on_expired: s.autoPauseOnExpired
    }
  }

  const splitLines = (input: string) =>
    input
      .split('\n')
      .map((item) => item.trim())
      .filter((item) => item)

  // Grok 手动 RT 批量验证和创建
  const handleGrokValidateRT = async (refreshTokenInput: string) => {
    if (!refreshTokenInput.trim()) return

    const refreshTokens = splitLines(refreshTokenInput)

    if (refreshTokens.length === 0) {
      grokOAuth.observable.set({ error: t('admin.accounts.oauth.grok.pleaseEnterRefreshToken') })
      return
    }
    if (!validateGrokOAuthUpstreamConfig()) return

    grokOAuth.observable.set({ loading: true, error: '' })

    let successCount = 0
    let failedCount = 0
    const errors: string[] = []

    try {
      for (let i = 0; i < refreshTokens.length; i++) {
        try {
          const tokenInfo = await grokOAuth.validateRefreshToken(refreshTokens[i], get().form.proxy_id)
          if (!tokenInfo) {
            failedCount++
            errors.push(`#${i + 1}: ${grokOAuth.error || 'Validation failed'}`)
            grokOAuth.observable.set({ error: '' })
            continue
          }

          const credentials = grokOAuth.buildCredentials(tokenInfo)
          applyGrokOAuthUpstreamConfig(credentials)
          const extra = grokOAuth.buildExtraInfo(tokenInfo)
          const formName = get().form.name
          const accountName =
            refreshTokens.length > 1
              ? `${formName || tokenInfo.email || 'Grok OAuth Account'} #${i + 1}`
              : formName || tokenInfo.email || 'Grok OAuth Account'

          const modelMapping = currentModelMapping()
          if (modelMapping) {
            credentials.model_mapping = modelMapping
          }
          if (!applyTempUnschedConfig(credentials)) {
            return
          }

          await adminAPI.accounts.create({
            name: accountName,
            platform: 'grok',
            type: 'oauth',
            credentials,
            extra: withUpstreamRequestIdHeader(extra),
            ...baseAccountFields()
          })
          successCount++
        } catch (error: any) {
          failedCount++
          const errMsg = error.response?.data?.detail || error.message || 'Unknown error'
          errors.push(`#${i + 1}: ${errMsg}`)
        }
      }

      if (successCount > 0 && failedCount === 0) {
        appStore().showSuccess(
          refreshTokens.length > 1
            ? t('admin.accounts.oauth.batchSuccess', { count: successCount })
            : t('admin.accounts.accountCreated')
        )
        emitCreated()
        handleClose()
      } else if (successCount > 0) {
        appStore().showWarning(
          t('admin.accounts.oauth.batchPartialSuccess', { success: successCount, failed: failedCount })
        )
        grokOAuth.observable.set({ error: errors.join('\n') })
        emitCreated()
      } else {
        grokOAuth.observable.set({ error: errors.join('\n') })
        appStore().showError(t('admin.accounts.oauth.batchFailed'))
      }
    } finally {
      grokOAuth.observable.set({ loading: false })
    }
  }

  const handleGrokImportSSO = async (ssoInput: string) => {
    // Align with OpenAI/Grok RT batch import: one token per line, no client-side dedupe.
    const ssoTokens = splitLines(ssoInput)
    if (ssoTokens.length === 0) return
    if (!validateGrokOAuthUpstreamConfig()) return

    grokOAuth.observable.set({ loading: true, error: '' })

    const credentials: Record<string, unknown> = {}
    applyGrokOAuthUpstreamConfig(credentials)
    const modelMapping = currentModelMapping()
    if (modelMapping) {
      credentials.model_mapping = modelMapping
    }
    if (!applyTempUnschedConfig(credentials)) {
      grokOAuth.observable.set({ loading: false })
      return
    }

    try {
      const s = get()
      const { form } = s
      const result = await adminAPI.grok.createFromSSO({
        sso_tokens: ssoTokens,
        name: form.name || undefined,
        notes: form.notes || undefined,
        proxy_id: form.proxy_id,
        group_ids: form.group_ids,
        credentials,
        concurrency: form.concurrency,
        load_factor: form.load_factor ?? undefined,
        priority: form.priority,
        rate_multiplier: form.rate_multiplier,
        expires_at: form.expires_at,
        auto_pause_on_expired: s.autoPauseOnExpired
      })

      const successCount = result.created?.length || 0
      const failedCount = result.failed?.length || 0
      if (successCount > 0 && failedCount === 0) {
        appStore().showSuccess(
          ssoTokens.length > 1
            ? t('admin.accounts.oauth.batchSuccess', { count: successCount })
            : t('admin.accounts.accountCreated')
        )
        emitCreated()
        handleClose()
      } else if (successCount > 0 && failedCount > 0) {
        // Same as OpenAI/Grok RT: keep input, show failures, refresh list.
        appStore().showWarning(
          t('admin.accounts.oauth.batchPartialSuccess', { success: successCount, failed: failedCount })
        )
        grokOAuth.observable.set({
          error: (result.failed || []).map((item) => `#${item.index}: ${item.error || 'Unknown error'}`).join('\n')
        })
        emitCreated()
      } else {
        grokOAuth.observable.set({
          error:
            (result.failed || []).map((item) => `#${item.index}: ${item.error || 'Unknown error'}`).join('\n') ||
            t('admin.accounts.oauth.grok.failedToConvertSSO')
        })
        appStore().showError(t('admin.accounts.oauth.batchFailed'))
      }
    } catch (error: any) {
      grokOAuth.observable.set({
        error: error.response?.data?.detail || error.message || t('admin.accounts.oauth.grok.failedToConvertSSO')
      })
      appStore().showError(grokOAuth.error)
    } finally {
      grokOAuth.observable.set({ loading: false })
    }
  }

  /**
   * Grok password login: each line is email----password.
   * Password is only used for the authorize API call; buildCredentials never stores it.
   */
  const handleGrokAuthorizePassword = async (emailPasswordInput: string) => {
    if (!emailPasswordInput.trim()) return
    if (!validateGrokOAuthUpstreamConfig()) return

    const lines = emailPasswordInput
      .split('\n')
      // Keep the password portion byte-for-byte; trim is only for determining
      // whether this textarea line is blank.
      .filter((line) => line.trim() && line.includes('----'))

    if (lines.length === 0) {
      grokOAuth.observable.set({
        error: t('admin.accounts.oauth.grok.pleaseEnterPassword', 'Please enter email----password (one per line)')
      })
      return
    }

    grokOAuth.observable.set({ loading: true, error: '' })

    let successCount = 0
    let failedCount = 0
    const errors: string[] = []

    try {
      for (let i = 0; i < lines.length; i++) {
        try {
          const tokenInfo = await grokOAuth.authorizePassword(lines[i], get().form.proxy_id)
          if (!tokenInfo) {
            failedCount++
            errors.push(`#${i + 1}: ${grokOAuth.error || 'Authorization failed'}`)
            grokOAuth.observable.set({ error: '' })
            continue
          }

          const credentials = grokOAuth.buildCredentials(tokenInfo)
          applyGrokOAuthUpstreamConfig(credentials)
          const extra = grokOAuth.buildExtraInfo(tokenInfo)
          const formName = get().form.name
          const accountName =
            lines.length > 1
              ? `${formName || tokenInfo.email || 'Grok OAuth Account'} #${i + 1}`
              : formName || tokenInfo.email || 'Grok OAuth Account'

          const modelMapping = currentModelMapping()
          if (modelMapping) {
            credentials.model_mapping = modelMapping
          }
          if (!applyTempUnschedConfig(credentials)) {
            return
          }

          await adminAPI.accounts.create({
            name: accountName,
            platform: 'grok',
            type: 'oauth',
            credentials,
            extra: withUpstreamRequestIdHeader(extra),
            ...baseAccountFields()
          })
          successCount++
        } catch (error: any) {
          failedCount++
          const errMsg = error.response?.data?.detail || error.message || 'Unknown error'
          errors.push(`#${i + 1}: ${errMsg}`)
        }
      }

      if (successCount > 0 && failedCount === 0) {
        appStore().showSuccess(
          lines.length > 1 ? t('admin.accounts.oauth.batchSuccess', { count: successCount }) : t('admin.accounts.accountCreated')
        )
        emitCreated()
        handleClose()
      } else if (successCount > 0) {
        appStore().showWarning(
          t('admin.accounts.oauth.batchPartialSuccess', {
            success: successCount,
            failed: failedCount
          })
        )
        grokOAuth.observable.set({ error: errors.join('\n') })
        emitCreated()
      } else {
        grokOAuth.observable.set({ error: errors.join('\n') })
        appStore().showError(t('admin.accounts.oauth.batchFailed'))
      }
    } finally {
      grokOAuth.observable.set({ loading: false })
    }
  }

  // OpenAI OAuth 授权码兑换
  const handleOpenAIExchange = async (authCode: string) => {
    const oauthClient = openaiOAuth
    if (!authCode.trim() || !oauthClient.sessionId) return

    oauthClient.observable.set({ loading: true, error: '' })

    try {
      const stateToUse = (flowHandle.current?.oauthState || oauthClient.oauthState || '').trim()
      if (!stateToUse) {
        oauthClient.observable.set({ error: t('admin.accounts.oauth.authFailed') })
        appStore().showError(oauthClient.error)
        return
      }

      const tokenInfo = await oauthClient.exchangeAuthCode(
        authCode.trim(),
        oauthClient.sessionId,
        stateToUse,
        get().form.proxy_id
      )
      if (!tokenInfo) return

      const credentials = oauthClient.buildCredentials(tokenInfo)
      const oauthExtra = oauthClient.buildExtraInfo(tokenInfo) as Record<string, unknown> | undefined
      const extra = buildOpenAIExtra(oauthExtra)
      const shouldCreateOpenAI = get().form.platform === 'openai'

      // Add model mapping for OpenAI OAuth accounts（透传模式下不应用）
      if (shouldCreateOpenAI && !isOpenAIModelRestrictionDisabled(get())) {
        const modelMapping = currentModelMapping()
        if (modelMapping) {
          credentials.model_mapping = modelMapping
        }
      }
      if (shouldCreateOpenAI) {
        const compactModelMapping = buildOpenAICompactModelMapping()
        if (compactModelMapping) {
          credentials.compact_model_mapping = compactModelMapping
        }
      }

      // 应用临时不可调度配置
      if (!applyTempUnschedConfig(credentials)) {
        return
      }

      if (shouldCreateOpenAI) {
        await adminAPI.accounts.create({
          name: get().form.name,
          platform: 'openai',
          type: 'oauth',
          credentials,
          extra: withUpstreamRequestIdHeader(extra),
          ...baseAccountFields()
        })
        appStore().showSuccess(t('admin.accounts.accountCreated'))
      }

      emitCreated()
      handleClose()
    } catch (error: any) {
      oauthClient.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed') })
      appStore().showError(oauthClient.error)
    } finally {
      oauthClient.observable.set({ loading: false })
    }
  }

  const buildOpenAICodexImportCredentialExtras = (): Record<string, unknown> | null => {
    const credentials: Record<string, unknown> = {}
    if (!isOpenAIModelRestrictionDisabled(get())) {
      const modelMapping = currentModelMapping()
      if (modelMapping) {
        credentials.model_mapping = modelMapping
      }
    }

    const compactModelMapping = buildOpenAICompactModelMapping()
    if (compactModelMapping) {
      credentials.compact_model_mapping = compactModelMapping
    }

    if (!applyTempUnschedConfig(credentials)) {
      return null
    }
    return credentials
  }

  const formatCodexImportMessages = (messages?: CodexSessionImportMessage[]) => {
    return (messages || [])
      .map((item) => {
        const name = item.name ? ` ${item.name}` : ''
        return `#${item.index}${name}: ${item.message}`
      })
      .join('\n')
  }

  const isAgentIdentityImportContent = (content: string) => {
    const isAgentIdentityValue = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.length > 0 && value.every(isAgentIdentityValue)
      if (!value || typeof value !== 'object') return false
      const record = value as Record<string, unknown>
      const authMode = record.auth_mode ?? record.authMode
      const agentIdentity = record.agent_identity ?? record.agentIdentity
      return (
        (typeof authMode === 'string' && authMode.toLowerCase() === 'agentidentity') ||
        (!!agentIdentity && typeof agentIdentity === 'object')
      )
    }

    try {
      return isAgentIdentityValue(JSON.parse(content))
    } catch {
      const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (lines.length === 0) return false
      try {
        return lines.every((line) => isAgentIdentityValue(JSON.parse(line)))
      } catch {
        return false
      }
    }
  }

  const handleOpenAIImportCodexSession = async (content: string) => {
    const oauthClient = openaiOAuth
    const trimmed = content.trim()
    if (!trimmed) {
      oauthClient.observable.set({ error: t('admin.accounts.oauth.openai.codexSessionEmpty') })
      return
    }
    if (flowHandle.current?.inputMethod === 'agent_identity' && !isAgentIdentityImportContent(trimmed)) {
      oauthClient.observable.set({ error: t('admin.accounts.oauth.openai.agentIdentityInvalid') })
      return
    }

    const credentialExtras = buildOpenAICodexImportCredentialExtras()
    if (credentialExtras === null) {
      return
    }

    oauthClient.observable.set({ loading: true, error: '' })

    try {
      const extra = buildOpenAICodexImportExtra()
      const fields = baseAccountFields()
      const result = await adminAPI.accounts.importCodexSession({
        content: trimmed,
        name: get().form.name,
        ...fields,
        notes: get().form.notes || null,
        credential_extras: Object.keys(credentialExtras).length > 0 ? credentialExtras : undefined,
        extra: withUpstreamRequestIdHeader(extra),
        update_existing: true
      })

      const successCount = result.created + result.updated
      const params = {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed
      }

      if (successCount > 0 && result.failed === 0) {
        appStore().showSuccess(t('admin.accounts.oauth.openai.codexSessionImportSuccess', params))
        emitCreated()
        handleClose()
        return
      }

      const errorText = formatCodexImportMessages(result.errors)
      const warningText = formatCodexImportMessages(result.warnings)
      oauthClient.observable.set({ error: [errorText, warningText].filter(Boolean).join('\n') })

      if (result.failed === 0) {
        appStore().showWarning(t('admin.accounts.oauth.openai.codexSessionImportSuccess', params))
        return
      }

      if (successCount > 0) {
        appStore().showWarning(t('admin.accounts.oauth.openai.codexSessionImportPartial', params))
        emitCreated()
        return
      }

      appStore().showError(t('admin.accounts.oauth.openai.codexSessionImportFailed'))
    } catch (error: any) {
      oauthClient.observable.set({
        error:
          error.response?.data?.detail ||
          error.response?.data?.message ||
          error.message ||
          t('admin.accounts.oauth.openai.codexSessionImportFailed')
      })
      appStore().showError(oauthClient.error)
    } finally {
      oauthClient.observable.set({ loading: false })
    }
  }

  const handleOpenAIImportCodexPAT = async (accessToken: string) => {
    const oauthClient = openaiOAuth
    const trimmed = accessToken.trim()
    if (!trimmed) {
      oauthClient.observable.set({ error: t('admin.accounts.oauth.openai.codexPatEmpty') })
      return
    }

    const credentialExtras = buildOpenAICodexImportCredentialExtras()
    if (credentialExtras === null) {
      return
    }

    oauthClient.observable.set({ loading: true, error: '' })

    try {
      const extra = buildOpenAICodexImportExtra()
      await adminAPI.accounts.createOpenAICodexPAT({
        access_token: trimmed,
        name: get().form.name,
        ...baseAccountFields(),
        notes: get().form.notes || null,
        credential_extras: Object.keys(credentialExtras).length > 0 ? credentialExtras : undefined,
        extra: withUpstreamRequestIdHeader(extra)
      })

      appStore().showSuccess(t('admin.accounts.accountCreated'))
      emitCreated()
      handleClose()
    } catch (error: any) {
      oauthClient.observable.set({
        error:
          error.response?.data?.detail ||
          error.response?.data?.message ||
          error.message ||
          t('admin.accounts.oauth.openai.codexPatImportFailed')
      })
      appStore().showError(oauthClient.error)
    } finally {
      oauthClient.observable.set({ loading: false })
    }
  }

  // OpenAI RT 批量验证和创建（共享逻辑）
  const handleOpenAIBatchRT = async (refreshTokenInput: string, clientId?: string) => {
    const oauthClient = openaiOAuth
    if (!refreshTokenInput.trim()) return

    const refreshTokens = splitLines(refreshTokenInput)

    if (refreshTokens.length === 0) {
      oauthClient.observable.set({ error: t('admin.accounts.oauth.openai.pleaseEnterRefreshToken') })
      return
    }

    oauthClient.observable.set({ loading: true, error: '' })

    let successCount = 0
    let failedCount = 0
    const errors: string[] = []
    const shouldCreateOpenAI = get().form.platform === 'openai'

    try {
      for (let i = 0; i < refreshTokens.length; i++) {
        try {
          const tokenInfo = await oauthClient.validateRefreshToken(refreshTokens[i], get().form.proxy_id, clientId)
          if (!tokenInfo) {
            failedCount++
            errors.push(`#${i + 1}: ${oauthClient.error || 'Validation failed'}`)
            oauthClient.observable.set({ error: '' })
            continue
          }

          const credentials = oauthClient.buildCredentials(tokenInfo)
          if (clientId) {
            credentials.client_id = clientId
          }
          const oauthExtra = oauthClient.buildExtraInfo(tokenInfo) as Record<string, unknown> | undefined
          const extra = buildOpenAIExtra(oauthExtra)

          // Add model mapping for OpenAI OAuth accounts（透传模式下不应用）
          if (shouldCreateOpenAI && !isOpenAIModelRestrictionDisabled(get())) {
            const modelMapping = currentModelMapping()
            if (modelMapping) {
              credentials.model_mapping = modelMapping
            }
          }
          if (shouldCreateOpenAI) {
            const compactModelMapping = buildOpenAICompactModelMapping()
            if (compactModelMapping) {
              credentials.compact_model_mapping = compactModelMapping
            }
          }

          // Generate account name; fallback to email if name is empty (ent schema requires NotEmpty)
          const baseName = get().form.name || tokenInfo.email || 'OpenAI OAuth Account'
          const accountName = refreshTokens.length > 1 ? `${baseName} #${i + 1}` : baseName

          if (shouldCreateOpenAI) {
            await adminAPI.accounts.create({
              name: accountName,
              platform: 'openai',
              type: 'oauth',
              credentials,
              extra: withUpstreamRequestIdHeader(extra),
              ...baseAccountFields()
            })
          }

          successCount++
        } catch (error: any) {
          failedCount++
          const errMsg = error.response?.data?.detail || error.message || 'Unknown error'
          errors.push(`#${i + 1}: ${errMsg}`)
        }
      }

      // Show results
      if (successCount > 0 && failedCount === 0) {
        appStore().showSuccess(
          refreshTokens.length > 1
            ? t('admin.accounts.oauth.batchSuccess', { count: successCount })
            : t('admin.accounts.accountCreated')
        )
        emitCreated()
        handleClose()
      } else if (successCount > 0 && failedCount > 0) {
        appStore().showWarning(
          t('admin.accounts.oauth.batchPartialSuccess', { success: successCount, failed: failedCount })
        )
        oauthClient.observable.set({ error: errors.join('\n') })
        emitCreated()
      } else {
        oauthClient.observable.set({ error: errors.join('\n') })
        appStore().showError(t('admin.accounts.oauth.batchFailed'))
      }
    } finally {
      oauthClient.observable.set({ loading: false })
    }
  }

  // 手动输入 RT（Codex CLI client_id，默认）
  const handleOpenAIValidateRT = (rt: string) => handleOpenAIBatchRT(rt)

  // 手动输入 Mobile RT
  const handleOpenAIValidateMobileRT = (rt: string) => handleOpenAIBatchRT(rt, OPENAI_MOBILE_RT_CLIENT_ID)

  // Antigravity 手动 RT 批量验证和创建
  const handleAntigravityValidateRT = async (refreshTokenInput: string) => {
    if (!refreshTokenInput.trim()) return

    // Parse multiple refresh tokens (one per line)
    const refreshTokens = splitLines(refreshTokenInput)

    if (refreshTokens.length === 0) {
      antigravityOAuth.observable.set({ error: t('admin.accounts.oauth.antigravity.pleaseEnterRefreshToken') })
      return
    }

    antigravityOAuth.observable.set({ loading: true, error: '' })

    let successCount = 0
    let failedCount = 0
    const errors: string[] = []

    try {
      for (let i = 0; i < refreshTokens.length; i++) {
        try {
          const tokenInfo = await antigravityOAuth.validateRefreshToken(refreshTokens[i], get().form.proxy_id)
          if (!tokenInfo) {
            failedCount++
            errors.push(`#${i + 1}: ${antigravityOAuth.error || 'Validation failed'}`)
            antigravityOAuth.observable.set({ error: '' })
            continue
          }

          const credentials = antigravityOAuth.buildCredentials(tokenInfo, refreshTokens[i])
          applyAntigravityProjectID(credentials, get().antigravityProjectId, 'create')

          // Generate account name with index for batch
          const formName = get().form.name
          const accountName = refreshTokens.length > 1 ? `${formName} #${i + 1}` : formName

          // Note: Antigravity doesn't have buildExtraInfo, so we pass empty extra or rely on credentials
          const createPayload = withAntigravityConfirmFlag({
            name: accountName,
            platform: 'antigravity',
            type: 'oauth',
            credentials,
            extra: withUpstreamRequestIdHeader({}),
            ...baseAccountFields()
          })
          await adminAPI.accounts.create(createPayload)
          successCount++
        } catch (error: any) {
          failedCount++
          const errMsg = error.response?.data?.detail || error.message || 'Unknown error'
          errors.push(`#${i + 1}: ${errMsg}`)
        }
      }

      // Show results
      if (successCount > 0 && failedCount === 0) {
        appStore().showSuccess(
          refreshTokens.length > 1
            ? t('admin.accounts.oauth.batchSuccess', { count: successCount })
            : t('admin.accounts.accountCreated')
        )
        emitCreated()
        handleClose()
      } else if (successCount > 0 && failedCount > 0) {
        appStore().showWarning(
          t('admin.accounts.oauth.batchPartialSuccess', { success: successCount, failed: failedCount })
        )
        antigravityOAuth.observable.set({ error: errors.join('\n') })
        emitCreated()
      } else {
        antigravityOAuth.observable.set({ error: errors.join('\n') })
        appStore().showError(t('admin.accounts.oauth.batchFailed'))
      }
    } finally {
      antigravityOAuth.observable.set({ loading: false })
    }
  }

  const handleValidateRefreshToken = (rt: string) => {
    const platform = get().form.platform
    if (platform === 'openai') {
      void handleOpenAIValidateRT(rt)
    } else if (platform === 'antigravity') {
      void handleAntigravityValidateRT(rt)
    } else if (platform === 'grok') {
      void handleGrokValidateRT(rt)
    }
  }

  const handleValidateSessionToken = (_sessionToken: string) => {
    // Session token validation removed
  }

  // Gemini OAuth 授权码兑换
  const handleGeminiExchange = async (authCode: string) => {
    if (!authCode.trim() || !geminiOAuth.sessionId) return

    geminiOAuth.observable.set({ loading: true, error: '' })

    try {
      const stateFromInput = flowHandle.current?.oauthState || ''
      const stateToUse = stateFromInput || geminiOAuth.state
      if (!stateToUse) {
        geminiOAuth.observable.set({ error: t('admin.accounts.oauth.authFailed') })
        appStore().showError(geminiOAuth.error)
        return
      }

      const s = get()
      const tokenInfo = await geminiOAuth.exchangeAuthCode({
        code: authCode.trim(),
        sessionId: geminiOAuth.sessionId,
        state: stateToUse,
        proxyId: s.form.proxy_id,
        oauthType: s.geminiOAuthType,
        tierId: geminiSelectedTier(s)
      })
      if (!tokenInfo) return

      const credentials = geminiOAuth.buildCredentials(tokenInfo)
      const extra = geminiOAuth.buildExtraInfo(tokenInfo)
      await createAccountAndFinish('gemini', 'oauth', credentials, extra)
    } catch (error: any) {
      geminiOAuth.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed') })
      appStore().showError(geminiOAuth.error)
    } finally {
      geminiOAuth.observable.set({ loading: false })
    }
  }

  // Antigravity OAuth 授权码兑换
  const handleAntigravityExchange = async (authCode: string) => {
    if (!authCode.trim() || !antigravityOAuth.sessionId) return

    antigravityOAuth.observable.set({ loading: true, error: '' })

    try {
      const stateFromInput = flowHandle.current?.oauthState || ''
      const stateToUse = stateFromInput || antigravityOAuth.state
      if (!stateToUse) {
        antigravityOAuth.observable.set({ error: t('admin.accounts.oauth.authFailed') })
        appStore().showError(antigravityOAuth.error)
        return
      }

      const tokenInfo = await antigravityOAuth.exchangeAuthCode({
        code: authCode.trim(),
        sessionId: antigravityOAuth.sessionId,
        state: stateToUse,
        proxyId: get().form.proxy_id
      })
      if (!tokenInfo) return

      const s = get()
      const credentials = antigravityOAuth.buildCredentials(tokenInfo)
      applyAntigravityProjectID(credentials, s.antigravityProjectId, 'create')
      applyInterceptWarmup(credentials, s.interceptWarmupRequests, 'create')
      // Antigravity 只使用映射模式
      const antigravityModelMapping = buildModelMappingObject('mapping', [], s.antigravityModelMappings)
      if (antigravityModelMapping) {
        credentials.model_mapping = antigravityModelMapping
      }
      const extra = buildAntigravityExtra()
      await createAccountAndFinish('antigravity', 'oauth', credentials, extra)
    } catch (error: any) {
      antigravityOAuth.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed') })
      appStore().showError(antigravityOAuth.error)
    } finally {
      antigravityOAuth.observable.set({ loading: false })
    }
  }

  // Grok OAuth 授权码兑换
  const handleGrokExchange = async (authCode: string) => {
    if (!authCode.trim() || !grokOAuth.sessionId) return
    if (!validateGrokOAuthUpstreamConfig()) return

    grokOAuth.observable.set({ loading: true, error: '' })

    try {
      const stateFromInput = flowHandle.current?.oauthState || ''
      const stateToUse = stateFromInput || grokOAuth.state
      if (!stateToUse) {
        grokOAuth.observable.set({ error: t('admin.accounts.oauth.authFailed') })
        appStore().showError(grokOAuth.error)
        return
      }

      const tokenInfo = await grokOAuth.exchangeAuthCode({
        code: authCode.trim(),
        sessionId: grokOAuth.sessionId,
        state: stateToUse,
        proxyId: get().form.proxy_id
      })
      if (!tokenInfo) return

      const credentials = grokOAuth.buildCredentials(tokenInfo)
      applyGrokOAuthUpstreamConfig(credentials)
      const extra = grokOAuth.buildExtraInfo(tokenInfo)
      await createAccountAndFinish('grok', 'oauth', credentials, extra)
    } catch (error: any) {
      grokOAuth.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed') })
      appStore().showError(grokOAuth.error)
    } finally {
      grokOAuth.observable.set({ loading: false })
    }
  }

  /** Anthropic OAuth / Cookie 授权共用：额度控制等 extra 设置 */
  const buildAnthropicQuotaControlExtra = (baseExtra: Record<string, unknown>) => {
    const s = get()
    const extra: Record<string, unknown> = { ...baseExtra }

    // Add window cost limit settings
    if (s.windowCostEnabled && s.windowCostLimit != null && s.windowCostLimit > 0) {
      extra.window_cost_limit = s.windowCostLimit
      extra.window_cost_sticky_reserve = s.windowCostStickyReserve ?? 10
    }

    // Add session limit settings
    if (s.sessionLimitEnabled && s.maxSessions != null && s.maxSessions > 0) {
      extra.max_sessions = s.maxSessions
      extra.session_idle_timeout_minutes = s.sessionIdleTimeout ?? 5
    }

    // Add RPM limit settings
    if (s.rpmLimitEnabled) {
      const DEFAULT_BASE_RPM = 15
      extra.base_rpm = s.baseRpm != null && s.baseRpm > 0 ? s.baseRpm : DEFAULT_BASE_RPM
      extra.rpm_strategy = s.rpmStrategy
      if (s.rpmStickyBuffer != null && s.rpmStickyBuffer > 0) {
        extra.rpm_sticky_buffer = s.rpmStickyBuffer
      }
    }

    // UMQ mode（独立于 RPM）
    if (s.userMsgQueueMode) {
      extra.user_msg_queue_mode = s.userMsgQueueMode
    }

    // Add TLS fingerprint settings
    if (s.tlsFingerprintEnabled) {
      extra.enable_tls_fingerprint = true
      if (s.tlsFingerprintProfileId) {
        extra.tls_fingerprint_profile_id = s.tlsFingerprintProfileId
      }
    }

    // Add session ID masking settings
    if (s.sessionIdMaskingEnabled) {
      extra.session_id_masking_enabled = true
    }

    // Add cache TTL override settings
    if (s.cacheTTLOverrideEnabled) {
      extra.cache_ttl_override_enabled = true
      extra.cache_ttl_override_target = s.cacheTTLOverrideTarget
    }

    // Add custom base URL settings
    if (s.customBaseUrlEnabled && s.customBaseUrl.trim()) {
      extra.custom_base_url_enabled = true
      extra.custom_base_url = s.customBaseUrl.trim()
    }
    return extra
  }

  // Anthropic OAuth 授权码兑换
  const handleAnthropicExchange = async (authCode: string) => {
    if (!authCode.trim() || !oauth.sessionId) return

    oauth.observable.set({ loading: true, error: '' })

    try {
      const s = get()
      const proxyConfig = s.form.proxy_id ? { proxy_id: s.form.proxy_id } : {}
      const endpoint =
        s.addMethod === 'oauth' ? '/admin/accounts/exchange-code' : '/admin/accounts/exchange-setup-token-code'

      const tokenInfo = await adminAPI.accounts.exchangeCode(endpoint, {
        session_id: oauth.sessionId,
        code: authCode.trim(),
        ...proxyConfig
      })

      // Build extra with quota control settings
      const baseExtra = oauth.buildExtraInfo(tokenInfo) || {}
      const extra = buildAnthropicQuotaControlExtra(baseExtra)

      const credentials: Record<string, unknown> = { ...tokenInfo }
      applyInterceptWarmup(credentials, get().interceptWarmupRequests, 'create')
      await createAccountAndFinish(get().form.platform, get().addMethod as AccountType, credentials, extra)
    } catch (error: any) {
      oauth.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed') })
      appStore().showError(oauth.error)
    } finally {
      oauth.observable.set({ loading: false })
    }
  }

  // 主入口：根据平台路由到对应处理函数
  const handleExchangeCode = async () => {
    const authCode = flowHandle.current?.authCode || ''

    switch (get().form.platform) {
      case 'openai':
        return handleOpenAIExchange(authCode)
      case 'gemini':
        return handleGeminiExchange(authCode)
      case 'antigravity':
        return handleAntigravityExchange(authCode)
      case 'grok':
        return handleGrokExchange(authCode)
      default:
        return handleAnthropicExchange(authCode)
    }
  }

  const handleCookieAuth = async (sessionKey: string) => {
    oauth.observable.set({ loading: true, error: '' })

    try {
      const s = get()
      const proxyConfig = s.form.proxy_id ? { proxy_id: s.form.proxy_id } : {}
      const keys = oauth.parseSessionKeys(sessionKey)

      if (keys.length === 0) {
        oauth.observable.set({ error: t('admin.accounts.oauth.pleaseEnterSessionKey') })
        return
      }

      const tempUnschedPayload = s.tempUnschedEnabled ? buildTempUnschedRules(s.tempUnschedRules) : []
      if (s.tempUnschedEnabled && tempUnschedPayload.length === 0) {
        appStore().showError(t('admin.accounts.tempUnschedulable.rulesInvalid'))
        return
      }

      const endpoint =
        s.addMethod === 'oauth' ? '/admin/accounts/cookie-auth' : '/admin/accounts/setup-token-cookie-auth'

      let successCount = 0
      let failedCount = 0
      const errors: string[] = []

      for (let i = 0; i < keys.length; i++) {
        try {
          const tokenInfo = await adminAPI.accounts.exchangeCode(endpoint, {
            session_id: '',
            code: keys[i],
            ...proxyConfig
          })

          // Build extra with quota control settings
          const baseExtra = oauth.buildExtraInfo(tokenInfo) || {}
          const extra = buildAnthropicQuotaControlExtra(baseExtra)

          const latest = get()
          const accountName = keys.length > 1 ? `${latest.form.name} #${i + 1}` : latest.form.name

          const credentials: Record<string, unknown> = { ...tokenInfo }
          applyInterceptWarmup(credentials, latest.interceptWarmupRequests, 'create')
          if (latest.tempUnschedEnabled) {
            credentials.temp_unschedulable_enabled = true
            credentials.temp_unschedulable_rules = tempUnschedPayload
          }

          await adminAPI.accounts.create({
            name: accountName,
            platform: latest.form.platform,
            type: latest.addMethod, // Use addMethod as type: 'oauth' or 'setup-token'
            credentials,
            extra: withUpstreamRequestIdHeader(extra),
            ...baseAccountFields()
          })

          successCount++
        } catch (error: any) {
          failedCount++
          errors.push(
            t('admin.accounts.oauth.keyAuthFailed', {
              index: i + 1,
              error: error.response?.data?.detail || t('admin.accounts.oauth.authFailed')
            })
          )
        }
      }

      if (successCount > 0) {
        appStore().showSuccess(t('admin.accounts.oauth.successCreated', { count: successCount }))
        if (failedCount === 0) {
          emitCreated()
          handleClose()
        } else {
          emitCreated()
        }
      }

      if (failedCount > 0) {
        oauth.observable.set({ error: errors.join('\n') })
      }
    } catch (error: any) {
      oauth.observable.set({ error: error.response?.data?.detail || t('admin.accounts.oauth.cookieAuthFailed') })
    } finally {
      oauth.observable.set({ loading: false })
    }
  }

  return {
    store,
    setCallbacks,
    get,
    set,
    setForm,
    attachFlowHandle,
    currentClient,
    loadGlobalStates,
    // 平台选择
    selectCNPlatform,
    selectOpenCodeGoPlatform,
    selectTypeSafePlatform,
    selectGenericMultiProtocolPlatform,
    onCnPresetSelect,
    handleSelectGeminiOAuthType,
    // OpenAI
    toggleOpenAILongContextBilling,
    toggleOpenAIEndpointCapability,
    // 模型映射与规则
    addMappingRow,
    removeMappingRow,
    updateMappingRow,
    addPresetMapping,
    addAntigravityPresetMapping,
    toggleErrorCode,
    addCustomErrorCode,
    removeErrorCode,
    addTempUnschedRule,
    removeTempUnschedRule,
    updateTempUnschedRule,
    moveTempUnschedRule,
    // Vertex
    handleVertexServiceAccountFile,
    handleVertexServiceAccountDrop,
    // 混合渠道确认
    handleMixedChannelConfirm,
    handleMixedChannelCancel,
    // 提交与 OAuth
    handleSubmit,
    handleClose,
    goBackToBasicInfo,
    handleGenerateUrl,
    handleExchangeCode,
    handleCookieAuth,
    handleValidateRefreshToken,
    handleOpenAIValidateMobileRT,
    handleValidateSessionToken,
    handleOpenAIImportCodexSession,
    handleOpenAIImportCodexPAT,
    handleGrokImportSSO,
    handleGrokAuthorizePassword
  }
}

export type CreateAccountController = ReturnType<typeof createCreateAccountController>
