/**
 * EditAccountModal 的表单状态、回填（syncFormFromAccount）、模式/协议联动与提交载荷构建。
 *
 * Vue 版把近百个 ref 与若干 watch 写在组件里；这里拆成纯函数：
 * - createInitialEditState()：与 Vue 版 ref 初始值一致；
 * - syncEditStateFromAccount()：回填，保留 Vue 版“未覆盖的字段沿用上一次值”的语义；
 * - applyEditPatch()：用户修改后按 Vue watcher 的注册顺序运行国产/多协议供应商的联动；
 *   回填不经过它，等价于 Vue 版 syncingForm 抑制窗口；
 * - buildEditUpdatePayload()：handleSubmit 中构建请求体的部分（校验失败返回错误文案）。
 */
import type {
  Account,
  GrokMediaEligibilityMode,
  OpenAICompactMode,
  OpenAIEndpointCapability,
  OpenAIResponsesMode,
  TempUnschedulableScope
} from '@/types'
import { buildModelMappingObject, splitModelMappingObject } from '@/composables/useModelWhitelist'
import { supportsAccountQuota } from '@/utils/accountQuota'
import {
  applyExplicitCacheUpstreamCredentials,
  isOfficialGeminiBaseUrl,
  normalizeExplicitCacheUpstreamMaxTTL
} from '@/utils/geminiExplicitCache'
import {
  OPENAI_WS_MODE_OFF,
  isOpenAIWSModeEnabled,
  resolveOpenAIWSModeFromExtra,
  type OpenAIWSMode
} from '@/utils/openaiWsMode'
import {
  applyAntigravityProjectID,
  applyHeaderOverride,
  applyInterceptWarmup,
  applyOpenCodeGoProtocolRules,
  applyPlanType,
  cloneOpenCodeGoProtocolRules,
  cnSupportsNativeResponses,
  defaultCNAdaptiveBaseUrls,
  defaultCNBaseUrl,
  defaultOpenCodeProtocolRules,
  defaultProviderProtocolRules,
  isCNProviderPlatform,
  isCustomGrokBaseUrl,
  isHeaderOverrideCapable,
  isMultiProtocolApiKeyPlatform,
  parseOpenCodeGoProtocolRules,
  providerNativeProtocols,
  providerRoutesByModel,
  readPlanType,
  resolveOpenCodeAccountMode,
  resolveProviderAccountMode,
  splitHeaderOverridesObject,
  validateHeaderOverrideRows,
  HEADER_OVERRIDE_ENABLED_CREDENTIAL_KEY,
  HEADER_OVERRIDES_CREDENTIAL_KEY,
  type CnApiProtocol,
  type CnNativeApiProtocol,
  type CnProviderPlatform,
  type HeaderOverrideRow,
  type OpenCodeAccountMode,
  type OpenCodeGoProtocolRule
} from './credentialsBuilder'

/** Vue 版 v-model.number：可解析为数字时为数字，清空输入时为 ''，初始值可为 null */
export type NumInput = number | '' | null

/** Vue looseToNumber：parseFloat 成功取数字，否则保留原字符串（数字输入框只会给出 ''） */
export function toNumInput(raw: string): number | '' {
  if (raw === '') return ''
  const parsed = parseFloat(raw)
  return Number.isNaN(parsed) ? '' : parsed
}

// Model mapping type
export interface ModelMapping {
  from: string
  to: string
}

/**
 * 列表行的稳定 key（替代 Vue 版 createStableObjectKeyResolver）：按对象实例缓存；
 * 行被替换为新对象时用 rowKey.carry 把旧 key 转给新对象，避免输入框重新挂载丢失焦点。
 */
const rowKeyMap = new WeakMap<object, string>()
let rowKeySeed = 0
export const rowKey = Object.assign(
  (row: object, prefix: string): string => {
    const cached = rowKeyMap.get(row)
    if (cached) return cached
    const key = `${prefix}-${++rowKeySeed}`
    rowKeyMap.set(row, key)
    return key
  },
  {
    carry(prev: object, next: object) {
      const key = rowKeyMap.get(prev)
      if (key) rowKeyMap.set(next, key)
    }
  }
)

export interface TempUnschedRuleForm {
  error_code: NumInput
  keywords: string
  duration_minutes: NumInput
  description: string
  // 作用范围：account 暂停整个账号，model 只冷却本次请求的模型。
  scope: TempUnschedulableScope
}

export type CodexFingerprintMode = 'off' | 'device' | 'session' | 'full'
export type CodexImageToolMode = 'inherit' | 'enabled' | 'disabled' | 'block'
export type AnthropicAPIKeyAuthScheme = 'x_api_key' | 'authorization_bearer'
export type QuotaResetModeValue = 'rolling' | 'fixed' | null

export interface EditAccountForm {
  name: string
  notes: string
  proxy_id: number | null
  concurrency: number
  load_factor: number | null
  priority: number
  rate_multiplier: number | ''
  status: 'active' | 'inactive' | 'error'
  group_ids: number[]
  expires_at: number | null
}

export interface EditState {
  form: EditAccountForm
  editBaseUrl: string
  editApiKey: string
  // ── 国产供应商（Kimi / Zhipu / DeepSeek）account_mode / api_protocol 编辑 ──
  editApiProtocol: CnApiProtocol
  editOpenCodeGoProtocolRules: OpenCodeGoProtocolRule[]
  // 多协议供应商（国产厂商与走通用表单的供应商）的接入模式；OpenCode 用 editOpenCodeAccountMode。
  editAccountMode: string
  editOpenCodeAccountMode: OpenCodeAccountMode
  // 智谱团队版 Coding Plan：组织/项目 ID，写入 credentials 供额度探测切换团队端点
  editZhipuOrganization: string
  editZhipuProject: string
  editAdaptiveBaseUrls: Record<CnNativeApiProtocol, string>
  // Bedrock credentials
  editBedrockAccessKeyId: string
  editBedrockSecretAccessKey: string
  editBedrockSessionToken: string
  editBedrockRegion: string
  editBedrockForceGlobal: boolean
  editBedrockApiKeyValue: string
  editVertexProjectId: string
  editVertexClientEmail: string
  editVertexLocation: string
  editVertexApiKey: string
  modelMappings: ModelMapping[]
  openAICompactModelMappings: ModelMapping[]
  modelRestrictionMode: 'whitelist' | 'mapping'
  allowedModels: string[]
  poolModeEnabled: boolean
  explicitCacheUpstreamEnabled: boolean
  explicitCacheUpstreamMaxTTL: NumInput
  poolModeRetryCount: NumInput
  poolModeRetryStatusCodesInput: string
  customErrorCodesEnabled: boolean
  selectedErrorCodes: number[]
  customErrorCodeInput: NumInput
  headerOverrideEnabled: boolean
  headerOverrideRows: HeaderOverrideRow[]
  // Grok OAuth 自定义上游地址（仅转发端点；OAuth 授权/令牌刷新不受影响）
  grokOAuthCustomBaseUrlEnabled: boolean
  grokOAuthBaseUrl: string
  // Grok Free OAuth accounts use client-tool prompt caching by default. Keep an
  // explicit false in the account extra as the opt-out signal.
  grokClientToolCacheEnabled: boolean
  interceptWarmupRequests: boolean
  autoPauseOnExpired: boolean
  autoPause5hThreshold: NumInput
  autoPause7dThreshold: NumInput
  autoPause5hDisabled: boolean
  autoPause7dDisabled: boolean
  autoResetCreditEnabled: boolean
  autoResetCredit5hThreshold: NumInput
  autoResetCredit7dThreshold: NumInput
  upstreamBillingAutoProbeEnabled: boolean
  upstreamBillingRateSyncEnabled: boolean
  mixedScheduling: boolean // For antigravity accounts: enable mixed scheduling
  // 上游ID：直接上游声明请求标识的响应头名，留空不记录。
  upstreamRequestIdHeader: string
  allowOverages: boolean // For antigravity accounts: enable AI Credits overages
  antigravityProjectId: string
  antigravityModelMappings: ModelMapping[]
  tempUnschedEnabled: boolean
  accountSchedulingThresholdOverrideEnabled: boolean
  accountSchedulingThresholdOverrideValue: NumInput
  tempUnschedRules: TempUnschedRuleForm[]
  // Quota control state (Anthropic OAuth/SetupToken only)
  windowCostEnabled: boolean
  windowCostLimit: NumInput
  windowCostStickyReserve: NumInput
  sessionLimitEnabled: boolean
  maxSessions: NumInput
  sessionIdleTimeout: NumInput
  rpmLimitEnabled: boolean
  baseRpm: NumInput
  rpmStrategy: 'tiered' | 'sticky_exempt'
  rpmStickyBuffer: NumInput
  userMsgQueueMode: string
  tlsFingerprintEnabled: boolean
  tlsFingerprintProfileId: number | null
  sessionIdMaskingEnabled: boolean
  cacheTTLOverrideEnabled: boolean
  cacheTTLOverrideTarget: string
  customBaseUrlEnabled: boolean
  customBaseUrl: string
  // OpenAI 自动透传开关（OAuth/API Key）
  openaiPassthroughEnabled: boolean
  // OpenAI Codex namespace 工具摊平兼容开关（仅 OAuth），缺省关闭即原样保留
  openaiFlattenNamespacesEnabled: boolean
  openAILongContextBillingEnabled: boolean
  // OpenAI 订阅档位（Plus / Pro 20x / Pro 5x / Business Standard / Business Premium / Free）手动覆盖值,
  // 存于 credentials.plan_type;'' 表示清空/自动识别
  editPlanType: string
  openAICompactMode: OpenAICompactMode
  openAIResponsesMode: OpenAIResponsesMode
  // Images 非流式响应缺 b64_json 时由网关下载 url 回填（仅 OpenAI API Key）。
  openAIImagesUrlToB64JsonEnabled: boolean
  openAIEndpointCapabilities: OpenAIEndpointCapability[]
  openaiOAuthResponsesWebSocketV2Mode: OpenAIWSMode
  openaiAPIKeyResponsesWebSocketV2Mode: OpenAIWSMode
  codexCLIOnlyEnabled: boolean
  codexCLIOnlyAppServerEnabled: boolean
  codexFingerprintMode: CodexFingerprintMode
  codexImageToolMode: CodexImageToolMode
  anthropicPassthroughEnabled: boolean
  anthropicAPIKeyAuthScheme: AnthropicAPIKeyAuthScheme
  webSearchEmulationMode: string
  editQuotaLimit: number | null
  editQuotaDailyLimit: number | null
  editQuotaWeeklyLimit: number | null
  editDailyResetMode: QuotaResetModeValue
  editDailyResetHour: number | null
  editWeeklyResetMode: QuotaResetModeValue
  editWeeklyResetDay: number | null
  editWeeklyResetHour: number | null
  editResetTimezone: string | null
}

export const DEFAULT_POOL_MODE_RETRY_COUNT = 3
export const MAX_POOL_MODE_RETRY_COUNT = 10
export const DEFAULT_POOL_MODE_RETRY_STATUS_CODES = [401, 403, 429]
export const GROK_CLIENT_TOOL_CACHE_EXTRA_KEY = 'grok_client_tool_cache_enabled'
export const ACCOUNT_SCHEDULING_THRESHOLD_CREDENTIAL_KEY = 'account_scheduling_threshold'

export function createInitialEditState(): EditState {
  return {
    form: {
      name: '',
      notes: '',
      proxy_id: null,
      concurrency: 1,
      load_factor: null,
      priority: 1,
      rate_multiplier: 1,
      status: 'active',
      group_ids: [],
      expires_at: null
    },
    editBaseUrl: 'https://api.anthropic.com',
    editApiKey: '',
    editApiProtocol: 'adaptive',
    editOpenCodeGoProtocolRules: cloneOpenCodeGoProtocolRules(),
    editAccountMode: 'payg',
    editOpenCodeAccountMode: 'go',
    editZhipuOrganization: '',
    editZhipuProject: '',
    editAdaptiveBaseUrls: { chat_completions: '', anthropic: '', responses: '' },
    editBedrockAccessKeyId: '',
    editBedrockSecretAccessKey: '',
    editBedrockSessionToken: '',
    editBedrockRegion: '',
    editBedrockForceGlobal: false,
    editBedrockApiKeyValue: '',
    editVertexProjectId: '',
    editVertexClientEmail: '',
    editVertexLocation: 'us-central1',
    editVertexApiKey: '',
    modelMappings: [],
    openAICompactModelMappings: [],
    modelRestrictionMode: 'whitelist',
    allowedModels: [],
    poolModeEnabled: false,
    explicitCacheUpstreamEnabled: false,
    explicitCacheUpstreamMaxTTL: '',
    poolModeRetryCount: DEFAULT_POOL_MODE_RETRY_COUNT,
    poolModeRetryStatusCodesInput: '',
    customErrorCodesEnabled: false,
    selectedErrorCodes: [],
    customErrorCodeInput: null,
    headerOverrideEnabled: false,
    headerOverrideRows: [],
    grokOAuthCustomBaseUrlEnabled: false,
    grokOAuthBaseUrl: '',
    grokClientToolCacheEnabled: true,
    interceptWarmupRequests: false,
    autoPauseOnExpired: false,
    autoPause5hThreshold: null,
    autoPause7dThreshold: null,
    autoPause5hDisabled: false,
    autoPause7dDisabled: false,
    autoResetCreditEnabled: false,
    autoResetCredit5hThreshold: 100,
    autoResetCredit7dThreshold: 100,
    upstreamBillingAutoProbeEnabled: false,
    upstreamBillingRateSyncEnabled: false,
    mixedScheduling: false,
    upstreamRequestIdHeader: '',
    allowOverages: false,
    antigravityProjectId: '',
    antigravityModelMappings: [],
    tempUnschedEnabled: false,
    accountSchedulingThresholdOverrideEnabled: false,
    accountSchedulingThresholdOverrideValue: 100,
    tempUnschedRules: [],
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
    openaiPassthroughEnabled: false,
    openaiFlattenNamespacesEnabled: false,
    openAILongContextBillingEnabled: false,
    editPlanType: '',
    openAICompactMode: 'auto',
    openAIResponsesMode: 'auto',
    openAIImagesUrlToB64JsonEnabled: false,
    openAIEndpointCapabilities: ['chat_completions', 'embeddings'],
    openaiOAuthResponsesWebSocketV2Mode: OPENAI_WS_MODE_OFF,
    openaiAPIKeyResponsesWebSocketV2Mode: OPENAI_WS_MODE_OFF,
    codexCLIOnlyEnabled: false,
    codexCLIOnlyAppServerEnabled: false,
    codexFingerprintMode: 'off',
    codexImageToolMode: 'inherit',
    anthropicPassthroughEnabled: false,
    anthropicAPIKeyAuthScheme: 'x_api_key',
    webSearchEmulationMode: 'default',
    editQuotaLimit: null,
    editQuotaDailyLimit: null,
    editQuotaWeeklyLimit: null,
    editDailyResetMode: null,
    editDailyResetHour: null,
    editWeeklyResetMode: null,
    editWeeklyResetDay: null,
    editWeeklyResetHour: null,
    editResetTimezone: null
  }
}

// ── 账号派生判断（Vue 版 computed） ──

// Spark 影子账号(parent_account_id 非空):代理恒继承母账号,不可独立编辑(外审 B/P1),
// 故隐藏代理选择器。
export const isSparkShadowAccount = (account: Account | null) => account?.parent_account_id != null

// 覆盖全部多协议 API Key 供应商（国产厂商、OpenCode 与走通用表单的供应商）。
export const isCNApiKeyAccount = (account: Account | null) =>
  account?.type === 'apikey' && isMultiProtocolApiKeyPlatform(account.platform)

// 前端没有专属界面、走通用表单的多协议供应商：模式 / 协议 / 默认端点来自 profile。
export const isGenericMultiProtocolAccount = (account: Account | null) =>
  isCNApiKeyAccount(account) &&
  !isCNProviderPlatform(account?.platform ?? '') &&
  account?.platform !== 'opencode_go'

export function cnPresetPlatformOf(account: Account | null): CnProviderPlatform {
  const platform = account?.platform
  if (isCNProviderPlatform(platform ?? '')) {
    return platform as CnProviderPlatform
  }
  return 'kimi'
}

export function adaptivePresetPlatformOf(account: Account | null): string {
  if (isCNApiKeyAccount(account)) return account!.platform
  return cnPresetPlatformOf(account)
}

export const isVertexAPIKeyMode = (account: Account | null) =>
  account?.platform === 'gemini' &&
  account?.type === 'service_account' &&
  (account?.credentials as Record<string, unknown> | undefined)?.auth_mode === 'apikey'

export const isBedrockAPIKeyMode = (account: Account | null) =>
  account?.type === 'bedrock' &&
  (account?.credentials as Record<string, unknown> | undefined)?.auth_mode === 'apikey'

export const isGrokOAuthAccount = (account: Account | null) =>
  account?.platform === 'grok' && account?.type === 'oauth'

export function currentOpenCodeOrCNMode(state: EditState, account: Account | null): string {
  return account?.platform === 'opencode_go' ? state.editOpenCodeAccountMode : state.editAccountMode
}

export const NATIVE_PROTOCOL_LABEL_KEYS: Record<CnNativeApiProtocol, string> = {
  chat_completions: 'chatCompletions',
  anthropic: 'anthropic',
  responses: 'responses'
}

// 当前供应商与接入模式提供原生端点的协议（profile 中有默认基址的协议）。
export function editAdaptiveProtocolOptions(
  state: EditState,
  account: Account | null
): Array<{ value: CnNativeApiProtocol; labelKey: string }> {
  return providerNativeProtocols(account?.platform ?? '', currentOpenCodeOrCNMode(state, account)).map((value) => ({
    value,
    labelKey: NATIVE_PROTOCOL_LABEL_KEYS[value]
  }))
}

// Computed: default base URL based on platform
export function defaultBaseUrlOf(state: EditState, account: Account | null): string {
  if (account?.platform === 'openai') return 'https://api.openai.com'
  if (account?.platform === 'gemini') return 'https://generativelanguage.googleapis.com'
  if (account?.platform === 'grok') return 'https://api.x.ai/v1'
  if (account?.platform === 'typesafe') return 'https://api.typesafe.ai'
  // CN 供应商：按当前模式/协议回落到官方预设（清空输入框提交时使用），
  // 不能落到 anthropic 默认值（会被当 CC base 拼出错误端点）。
  if (account && isMultiProtocolApiKeyPlatform(account.platform)) {
    return defaultCNBaseUrl(account.platform, currentOpenCodeOrCNMode(state, account), state.editApiProtocol)
  }
  return 'https://api.anthropic.com'
}

// ── 纯工具函数 ──

export function parsePoolModeRetryStatusCodes(input: string): number[] {
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

export function formatPoolModeRetryStatusCodes(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const out: number[] = []
  const seen = new Set<number>()
  for (const v of value) {
    const n = typeof v === 'string' ? Number(v.trim()) : Number(v)
    if (!Number.isFinite(n) || !Number.isInteger(n)) continue
    if (n < 100 || n > 599) continue
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out.sort((a, b) => a - b).join(', ')
}

export const normalizePoolModeRetryCount = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
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

export const normalizeOpenAIEndpointCapabilities = (values: OpenAIEndpointCapability[]) => {
  const allowed: OpenAIEndpointCapability[] = ['chat_completions', 'embeddings', 'seedance']
  const selected = allowed.filter((value) => values.includes(value))
  return selected.length > 0 ? selected : (['chat_completions', 'embeddings'] as OpenAIEndpointCapability[])
}

const OPENAI_ENDPOINT_CAPABILITY_VALUES: OpenAIEndpointCapability[] = ['chat_completions', 'embeddings', 'seedance']

export const readOpenAIEndpointCapabilities = (credentials?: Record<string, unknown>): OpenAIEndpointCapability[] => {
  const raw = credentials?.openai_capabilities
  if (Array.isArray(raw)) {
    return normalizeOpenAIEndpointCapabilities(
      raw.filter(
        (value): value is OpenAIEndpointCapability =>
          value === 'chat_completions' || value === 'embeddings' || value === 'seedance'
      )
    )
  }
  if (raw !== null && typeof raw === 'object') {
    const capabilityMap = raw as Record<string, unknown>
    return normalizeOpenAIEndpointCapabilities(
      OPENAI_ENDPOINT_CAPABILITY_VALUES.filter((value) => capabilityMap[value] === true)
    )
  }
  return ['chat_completions', 'embeddings']
}

const applyOpenAIEndpointCapabilities = (credentials: Record<string, unknown>, values: OpenAIEndpointCapability[]) => {
  const capabilities = normalizeOpenAIEndpointCapabilities(values)
  if (capabilities.length === 2 && !capabilities.includes('seedance')) {
    delete credentials.openai_capabilities
    return
  }
  credentials.openai_capabilities = capabilities
}

export const normalizeOpenAIResponsesMode = (mode: unknown): OpenAIResponsesMode => {
  if (mode === 'force_responses' || mode === 'force_chat_completions') {
    return mode
  }
  return 'auto'
}

export const modeFromGrokMediaExtra = (extra: Record<string, unknown> | undefined): GrokMediaEligibilityMode => {
  if (extra?.grok_media_eligible === true) return 'enabled'
  if (extra?.grok_media_eligible === false) return 'disabled'
  return 'auto'
}

export const readUpstreamRequestIdHeader = (extra: unknown): string => {
  const value = (extra as Record<string, unknown> | undefined)?.upstream_request_id_header
  return typeof value === 'string' ? value : ''
}

export function supportsAccountSchedulingThresholdOverridePlatform(platform: Account['platform'] | undefined) {
  return platform === 'openai' || platform === 'anthropic' || platform === 'grok'
}

function normalizeAccountSchedulingThresholdOverride(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }
  const integer = Math.trunc(numeric)
  if (integer < 1 || integer > 100) {
    return null
  }
  return integer
}

function clampAccountSchedulingThresholdOverride(value: unknown): number {
  return Math.min(100, Math.max(1, Math.trunc(Number(value) || 100)))
}

function formatTempUnschedKeywords(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .join(', ')
  }
  if (typeof value === 'string') {
    return value
  }
  return ''
}

// 未设置 scope 的规则由后端按「401 账号级、其余模型级」处理，这里按同一规则回显，
// 保证打开再保存不改变规则行为。
function resolveTempUnschedScope(value: unknown, errorCode: number | null): TempUnschedulableScope {
  const scope = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (scope === 'account' || scope === 'model') {
    return scope
  }
  return errorCode === 401 ? 'account' : 'model'
}

const splitTempUnschedKeywords = (value: string) => {
  return value
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function toPositiveNumber(value: unknown) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    return null
  }
  return Math.trunc(num)
}

export function buildTempUnschedRules(rules: TempUnschedRuleForm[]) {
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

function loadModelRestrictionFromMapping(rawMapping?: Record<string, unknown>) {
  const parsed = splitModelMappingObject(rawMapping)
  return {
    allowedModels: parsed.allowedModels,
    modelMappings: parsed.modelMappings,
    modelRestrictionMode:
      parsed.modelMappings.length > 0 && parsed.allowedModels.length === 0 ? ('mapping' as const) : ('whitelist' as const)
  }
}

const buildModelRestrictionMapping = (state: EditState) =>
  buildModelMappingObject('combined', state.allowedModels, state.modelMappings)

function loadTempUnschedRules(credentials?: Record<string, unknown>): Pick<EditState, 'tempUnschedEnabled' | 'tempUnschedRules'> {
  const tempUnschedEnabled = credentials?.temp_unschedulable_enabled === true
  const rawRules = credentials?.temp_unschedulable_rules
  if (!Array.isArray(rawRules)) {
    return { tempUnschedEnabled, tempUnschedRules: [] }
  }

  return {
    tempUnschedEnabled,
    tempUnschedRules: rawRules.map((rule) => {
      const entry = rule as Record<string, unknown>
      const errorCode = toPositiveNumber(entry.error_code)
      return {
        error_code: errorCode,
        keywords: formatTempUnschedKeywords(entry.keywords),
        duration_minutes: toPositiveNumber(entry.duration_minutes),
        description: typeof entry.description === 'string' ? entry.description : '',
        scope: resolveTempUnschedScope(entry.scope, errorCode)
      }
    })
  }
}

function loadAccountSchedulingThresholdOverride(
  platform: Account['platform'] | undefined,
  credentials: Record<string, unknown> | undefined
): Pick<EditState, 'accountSchedulingThresholdOverrideEnabled' | 'accountSchedulingThresholdOverrideValue'> {
  if (!supportsAccountSchedulingThresholdOverridePlatform(platform)) {
    return { accountSchedulingThresholdOverrideEnabled: false, accountSchedulingThresholdOverrideValue: 100 }
  }
  const value = normalizeAccountSchedulingThresholdOverride(credentials?.[ACCOUNT_SCHEDULING_THRESHOLD_CREDENTIAL_KEY])
  return {
    accountSchedulingThresholdOverrideEnabled: value !== null,
    accountSchedulingThresholdOverrideValue: value ?? 100
  }
}

type QuotaControlKeys =
  | 'windowCostEnabled'
  | 'windowCostLimit'
  | 'windowCostStickyReserve'
  | 'sessionLimitEnabled'
  | 'maxSessions'
  | 'sessionIdleTimeout'
  | 'rpmLimitEnabled'
  | 'baseRpm'
  | 'rpmStrategy'
  | 'rpmStickyBuffer'
  | 'userMsgQueueMode'
  | 'tlsFingerprintEnabled'
  | 'tlsFingerprintProfileId'
  | 'sessionIdMaskingEnabled'
  | 'cacheTTLOverrideEnabled'
  | 'cacheTTLOverrideTarget'
  | 'customBaseUrlEnabled'
  | 'customBaseUrl'

// Load quota control settings from account (Anthropic OAuth/SetupToken only)
function loadQuotaControlSettings(account: Account): Pick<EditState, QuotaControlKeys> {
  // Reset all quota control state first
  const out: Pick<EditState, QuotaControlKeys> = {
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
    customBaseUrl: ''
  }

  // Remaining quota control settings only apply to Anthropic accounts
  if (account.platform !== 'anthropic') {
    return out
  }

  // Window cost / session limit only apply to Anthropic OAuth/SetupToken accounts
  if (account.type !== 'oauth' && account.type !== 'setup-token') {
    return out
  }

  // Load from extra field (via backend DTO fields)
  if (account.window_cost_limit != null && account.window_cost_limit > 0) {
    out.windowCostEnabled = true
    out.windowCostLimit = account.window_cost_limit
    out.windowCostStickyReserve = account.window_cost_sticky_reserve ?? 10
  }

  if (account.max_sessions != null && account.max_sessions > 0) {
    out.sessionLimitEnabled = true
    out.maxSessions = account.max_sessions
    out.sessionIdleTimeout = account.session_idle_timeout_minutes ?? 5
  }

  // RPM limit
  if (account.base_rpm != null && account.base_rpm > 0) {
    out.rpmLimitEnabled = true
    out.baseRpm = account.base_rpm
    out.rpmStrategy = (account.rpm_strategy as 'tiered' | 'sticky_exempt') || 'tiered'
    out.rpmStickyBuffer = account.rpm_sticky_buffer ?? null
  }

  // UMQ mode（独立于 RPM 加载，防止编辑无 RPM 账号时丢失已有配置）
  out.userMsgQueueMode = account.user_msg_queue_mode ?? ''

  // Load TLS fingerprint setting
  if (account.enable_tls_fingerprint === true) {
    out.tlsFingerprintEnabled = true
  }
  out.tlsFingerprintProfileId = account.tls_fingerprint_profile_id ?? null

  // Load session ID masking setting
  if (account.session_id_masking_enabled === true) {
    out.sessionIdMaskingEnabled = true
  }

  // Load cache TTL override setting
  if (account.cache_ttl_override_enabled === true) {
    out.cacheTTLOverrideEnabled = true
    out.cacheTTLOverrideTarget = account.cache_ttl_override_target || '5m'
  }

  // Load custom base URL setting
  if (account.custom_base_url_enabled === true) {
    out.customBaseUrlEnabled = true
    out.customBaseUrl = account.custom_base_url || ''
  }
  return out
}

/**
 * 对应 Vue 版 syncFormFromAccount 的表单部分（不含混合渠道弹窗、Grok 媒体资格加载与配额通知，
 * 这些由组件处理）。以上一次的状态为基础：Vue 版没有在每个分支重置的字段沿用旧值。
 */
export function syncEditStateFromAccount(prev: EditState, newAccount: Account): EditState {
  const s: EditState = { ...prev, form: { ...prev.form } }
  s.form.name = newAccount.name
  s.form.notes = newAccount.notes || ''
  s.form.proxy_id = newAccount.proxy_id
  s.form.concurrency = newAccount.concurrency
  s.form.load_factor = newAccount.load_factor ?? null
  s.form.priority = newAccount.priority
  s.form.rate_multiplier = newAccount.rate_multiplier ?? 1
  s.form.status =
    newAccount.status === 'active' || newAccount.status === 'inactive' || newAccount.status === 'error'
      ? newAccount.status
      : 'active'
  s.form.group_ids = newAccount.group_ids || []
  s.form.expires_at = newAccount.expires_at ?? null

  // Load intercept warmup requests setting (applies to all account types)
  const credentials = newAccount.credentials as Record<string, unknown> | undefined
  s.interceptWarmupRequests = credentials?.intercept_warmup_requests === true
  s.autoPauseOnExpired = newAccount.auto_pause_on_expired === true
  s.editVertexProjectId = ''
  s.editVertexClientEmail = ''
  s.editVertexLocation = 'us-central1'
  s.editVertexApiKey = ''
  s.antigravityProjectId =
    newAccount.platform === 'antigravity' &&
    newAccount.type === 'oauth' &&
    typeof credentials?.antigravity_project_id === 'string'
      ? credentials.antigravity_project_id.trim()
      : ''

  // Load mixed scheduling setting (only for antigravity accounts)
  const extra = newAccount.extra as Record<string, unknown> | undefined
  s.mixedScheduling = extra?.mixed_scheduling === true
  s.allowOverages = extra?.allow_overages === true
  s.upstreamRequestIdHeader = readUpstreamRequestIdHeader(extra)
  s.openAIImagesUrlToB64JsonEnabled = extra?.images_url_to_b64_json === true
  s.autoPause5hThreshold = typeof extra?.auto_pause_5h_threshold === 'number' ? extra.auto_pause_5h_threshold * 100 : null
  s.autoPause7dThreshold = typeof extra?.auto_pause_7d_threshold === 'number' ? extra.auto_pause_7d_threshold * 100 : null
  s.autoPause5hDisabled = extra?.auto_pause_5h_disabled === true
  s.autoPause7dDisabled = extra?.auto_pause_7d_disabled === true
  s.autoResetCreditEnabled = extra?.auto_reset_credit_enabled === true
  s.autoResetCredit5hThreshold =
    typeof extra?.auto_reset_credit_5h_threshold === 'number' ? extra.auto_reset_credit_5h_threshold * 100 : 100
  s.autoResetCredit7dThreshold =
    typeof extra?.auto_reset_credit_7d_threshold === 'number' ? extra.auto_reset_credit_7d_threshold * 100 : 100
  s.upstreamBillingAutoProbeEnabled = extra?.upstream_billing_probe_enabled === true
  s.upstreamBillingRateSyncEnabled = s.upstreamBillingAutoProbeEnabled && extra?.upstream_billing_rate_sync_enabled === true

  // Load OpenAI passthrough toggle (OpenAI OAuth/SetupToken/API Key)
  s.openaiPassthroughEnabled = false
  s.openaiFlattenNamespacesEnabled = false
  s.openAILongContextBillingEnabled = false
  s.editPlanType = ''
  s.openAICompactMode = 'auto'
  s.openAIResponsesMode = 'auto'
  s.openAIEndpointCapabilities = ['chat_completions', 'embeddings']
  s.openAICompactModelMappings = []
  s.openaiOAuthResponsesWebSocketV2Mode = OPENAI_WS_MODE_OFF
  s.openaiAPIKeyResponsesWebSocketV2Mode = OPENAI_WS_MODE_OFF
  s.codexCLIOnlyEnabled = false
  s.codexCLIOnlyAppServerEnabled = false
  s.codexFingerprintMode = 'off'
  s.codexImageToolMode = 'inherit'
  s.anthropicPassthroughEnabled = false
  s.anthropicAPIKeyAuthScheme = 'x_api_key'
  s.webSearchEmulationMode = 'default'
  if (
    newAccount.platform === 'openai' &&
    (newAccount.type === 'oauth' || newAccount.type === 'setup-token' || newAccount.type === 'apikey')
  ) {
    s.openaiPassthroughEnabled = extra?.openai_passthrough === true || extra?.openai_oauth_passthrough === true
    s.openaiFlattenNamespacesEnabled = newAccount.type === 'oauth' && extra?.openai_responses_flatten_namespaces === true
    const longContextBillingValue = extra?.openai_long_context_billing_enabled
    s.openAILongContextBillingEnabled = longContextBillingValue === true
    // plan_type 手动覆盖仅 OAuth 有实际调度语义(IsOpenAIChatGPTSubscription 要求 oauth),故只对 oauth 回填
    s.editPlanType = newAccount.type === 'oauth' ? readPlanType(credentials) : ''
    s.openAICompactMode = (extra?.openai_compact_mode as OpenAICompactMode) || 'auto'
    if (newAccount.type === 'apikey') {
      s.openAIResponsesMode = normalizeOpenAIResponsesMode(extra?.openai_responses_mode)
      s.openAIEndpointCapabilities = readOpenAIEndpointCapabilities(credentials)
      if (!s.openAIEndpointCapabilities.includes('chat_completions')) {
        s.openAIResponsesMode = 'auto'
      }
    }
    const codexImageGenerationBridgeValue =
      typeof extra?.codex_image_generation_bridge === 'boolean'
        ? extra.codex_image_generation_bridge
        : extra?.codex_image_generation_bridge_enabled
    if (extra?.codex_image_generation_explicit_tool_policy === 'strip') {
      s.codexImageToolMode = 'block'
    } else if (codexImageGenerationBridgeValue === true) {
      s.codexImageToolMode = 'enabled'
    } else if (codexImageGenerationBridgeValue === false) {
      s.codexImageToolMode = 'disabled'
    }
    s.openaiOAuthResponsesWebSocketV2Mode = resolveOpenAIWSModeFromExtra(extra, {
      modeKey: 'openai_oauth_responses_websockets_v2_mode',
      enabledKey: 'openai_oauth_responses_websockets_v2_enabled',
      fallbackEnabledKeys: ['responses_websockets_v2_enabled', 'openai_ws_enabled'],
      defaultMode: OPENAI_WS_MODE_OFF
    })
    s.openaiAPIKeyResponsesWebSocketV2Mode = resolveOpenAIWSModeFromExtra(extra, {
      modeKey: 'openai_apikey_responses_websockets_v2_mode',
      enabledKey: 'openai_apikey_responses_websockets_v2_enabled',
      fallbackEnabledKeys: ['responses_websockets_v2_enabled', 'openai_ws_enabled'],
      defaultMode: OPENAI_WS_MODE_OFF
    })
    if (newAccount.type === 'oauth' || newAccount.type === 'setup-token') {
      s.codexCLIOnlyEnabled = extra?.codex_cli_only === true
      s.codexCLIOnlyAppServerEnabled = extra?.codex_cli_only_allow_app_server === true
    }
    if (newAccount.type === 'oauth') {
      const fpMode = extra?.codex_fingerprint_mode as string | undefined
      // 缺省/非法值按 off 呈现，与后端 GetCodexFingerprintMode 的 opt-in 语义一致（#5610）
      s.codexFingerprintMode = ['off', 'device', 'session', 'full'].includes(fpMode || '')
        ? (fpMode as CodexFingerprintMode)
        : 'off'
    }
    const compactMappings = credentials?.compact_model_mapping as Record<string, string> | undefined
    if (compactMappings && typeof compactMappings === 'object') {
      s.openAICompactModelMappings = Object.entries(compactMappings).map(([from, to]) => ({ from, to }))
    }
  }
  if (newAccount.platform === 'anthropic' && newAccount.type === 'apikey') {
    s.anthropicPassthroughEnabled = extra?.anthropic_passthrough === true
    s.anthropicAPIKeyAuthScheme =
      extra?.anthropic_apikey_auth_scheme === 'authorization_bearer' ? 'authorization_bearer' : 'x_api_key'
  }
  if ((newAccount.platform === 'anthropic' || newAccount.platform === 'openai') && newAccount.type === 'apikey') {
    // 三态：string "default"/"enabled"/"disabled"，向后兼容旧 bool
    const wsVal = extra?.web_search_emulation
    if (wsVal === 'enabled' || wsVal === 'disabled') {
      s.webSearchEmulationMode = wsVal
    } else if (wsVal === true) {
      s.webSearchEmulationMode = 'enabled'
    } else {
      s.webSearchEmulationMode = 'default'
    }
  }

  // Load quota limit for apikey/bedrock/service_account accounts (bedrock quota is also loaded in its own branch above)
  if (supportsAccountQuota(newAccount.type)) {
    const quotaVal = extra?.quota_limit as number | undefined
    s.editQuotaLimit = quotaVal && quotaVal > 0 ? quotaVal : null
    const dailyVal = extra?.quota_daily_limit as number | undefined
    s.editQuotaDailyLimit = dailyVal && dailyVal > 0 ? dailyVal : null
    const weeklyVal = extra?.quota_weekly_limit as number | undefined
    s.editQuotaWeeklyLimit = weeklyVal && weeklyVal > 0 ? weeklyVal : null
    // Load quota reset mode config
    s.editDailyResetMode = (extra?.quota_daily_reset_mode as 'rolling' | 'fixed') || null
    s.editDailyResetHour = (extra?.quota_daily_reset_hour as number) ?? null
    s.editWeeklyResetMode = (extra?.quota_weekly_reset_mode as 'rolling' | 'fixed') || null
    s.editWeeklyResetDay = (extra?.quota_weekly_reset_day as number) ?? null
    s.editWeeklyResetHour = (extra?.quota_weekly_reset_hour as number) ?? null
    s.editResetTimezone = (extra?.quota_reset_timezone as string) || null
  } else {
    s.editQuotaLimit = null
    s.editQuotaDailyLimit = null
    s.editQuotaWeeklyLimit = null
    s.editDailyResetMode = null
    s.editDailyResetHour = null
    s.editWeeklyResetMode = null
    s.editWeeklyResetDay = null
    s.editWeeklyResetHour = null
    s.editResetTimezone = null
  }

  // Load antigravity model mapping (Antigravity 只支持映射模式)
  if (newAccount.platform === 'antigravity') {
    // 从 model_mapping 读取映射配置
    const rawAgMapping = credentials?.model_mapping as Record<string, string> | undefined
    if (rawAgMapping && typeof rawAgMapping === 'object') {
      const entries = Object.entries(rawAgMapping)
      // 无论是白名单样式(key===value)还是真正的映射，都统一转换为映射列表
      s.antigravityModelMappings = entries.map(([from, to]) => ({ from, to }))
    } else {
      // 兼容旧数据：从 model_whitelist 读取，转换为映射格式
      const rawWhitelist = credentials?.model_whitelist
      if (Array.isArray(rawWhitelist) && rawWhitelist.length > 0) {
        s.antigravityModelMappings = rawWhitelist
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0)
          .map((m) => ({ from: m, to: m }))
      } else {
        s.antigravityModelMappings = []
      }
    }
  } else {
    s.antigravityModelMappings = []
  }

  // Load quota control settings (Anthropic OAuth/SetupToken only)
  Object.assign(s, loadQuotaControlSettings(newAccount))
  Object.assign(s, loadTempUnschedRules(credentials))
  Object.assign(s, loadAccountSchedulingThresholdOverride(newAccount.platform, credentials))

  // Load header override state for eligible account platforms/types
  s.headerOverrideEnabled = false
  s.headerOverrideRows = []
  if (newAccount.credentials && isHeaderOverrideCapable(newAccount.platform, newAccount.type)) {
    const overrideCreds = newAccount.credentials as Record<string, unknown>
    s.headerOverrideEnabled = overrideCreds[HEADER_OVERRIDE_ENABLED_CREDENTIAL_KEY] === true
    s.headerOverrideRows = splitHeaderOverridesObject(overrideCreds[HEADER_OVERRIDES_CREDENTIAL_KEY])
  }

  // Load Grok OAuth custom upstream URL state（存储的官方地址视同未定制）
  s.grokOAuthCustomBaseUrlEnabled = false
  s.grokOAuthBaseUrl = ''
  const grokClientToolCacheSetting =
    newAccount.platform === 'grok' && newAccount.type === 'oauth'
      ? (newAccount.extra as Record<string, unknown> | undefined)?.[GROK_CLIENT_TOOL_CACHE_EXTRA_KEY]
      : undefined
  s.grokClientToolCacheEnabled =
    newAccount.platform === 'grok' &&
    newAccount.type === 'oauth' &&
    (grokClientToolCacheSetting === undefined || grokClientToolCacheSetting === true)
  if (newAccount.platform === 'grok' && newAccount.type === 'oauth' && newAccount.credentials) {
    const grokCreds = newAccount.credentials as Record<string, unknown>
    if (isCustomGrokBaseUrl(grokCreds.base_url)) {
      s.grokOAuthCustomBaseUrlEnabled = true
      s.grokOAuthBaseUrl = (grokCreds.base_url as string).trim()
    }
  }

  // Initialize API Key fields for apikey type
  if (newAccount.type === 'apikey' && newAccount.credentials) {
    const apiCredentials = newAccount.credentials as Record<string, unknown>
    // 国产供应商：读取 account_mode 与 api_protocol 作为可编辑初始值
    // （编辑弹窗允许修正两者，用于修复早期存错默认值的账号）。
    if (isMultiProtocolApiKeyPlatform(newAccount.platform)) {
      if (newAccount.platform === 'opencode_go') {
        s.editOpenCodeAccountMode = resolveOpenCodeAccountMode(apiCredentials.account_mode)
      } else if (isCNProviderPlatform(newAccount.platform)) {
        s.editAccountMode = apiCredentials.account_mode === 'coding' ? 'coding' : 'payg'
      } else {
        s.editAccountMode = resolveProviderAccountMode(newAccount.platform, apiCredentials.account_mode)
      }
      const storedProtocol = apiCredentials.api_protocol
      s.editApiProtocol =
        storedProtocol === 'adaptive' ||
        storedProtocol === 'chat_completions' ||
        storedProtocol === 'anthropic' ||
        storedProtocol === 'responses'
          ? storedProtocol
          : 'chat_completions'
      if (
        !cnSupportsNativeResponses(newAccount.platform, currentOpenCodeOrCNMode(s, newAccount)) &&
        s.editApiProtocol === 'responses'
      ) {
        s.editApiProtocol = 'chat_completions'
      }
      const adaptiveDefaults = defaultCNAdaptiveBaseUrls(newAccount.platform, currentOpenCodeOrCNMode(s, newAccount))
      const storedBaseUrls = (apiCredentials.api_base_urls as Record<string, unknown> | undefined) || {}
      const legacyBaseUrl = typeof apiCredentials.base_url === 'string' ? apiCredentials.base_url.trim() : ''
      const storedChatBaseUrl =
        typeof storedBaseUrls.chat_completions === 'string' ? storedBaseUrls.chat_completions.trim() : ''
      const storedAnthropicBaseUrl = typeof storedBaseUrls.anthropic === 'string' ? storedBaseUrls.anthropic.trim() : ''
      const storedResponsesBaseUrl = typeof storedBaseUrls.responses === 'string' ? storedBaseUrls.responses.trim() : ''
      const nextAdaptiveBaseUrls: Record<CnNativeApiProtocol, string> = {
        chat_completions: storedChatBaseUrl || adaptiveDefaults.chat_completions,
        anthropic: storedAnthropicBaseUrl || adaptiveDefaults.anthropic,
        responses: storedResponsesBaseUrl || adaptiveDefaults.responses
      }
      const legacyProtocol: CnNativeApiProtocol =
        s.editApiProtocol === 'anthropic' ? 'anthropic' : s.editApiProtocol === 'responses' ? 'responses' : 'chat_completions'
      const storedLegacyBaseUrl =
        legacyProtocol === 'anthropic'
          ? storedAnthropicBaseUrl
          : legacyProtocol === 'responses'
            ? storedResponsesBaseUrl
            : storedChatBaseUrl
      if (legacyBaseUrl && !storedLegacyBaseUrl) {
        nextAdaptiveBaseUrls[legacyProtocol] = legacyBaseUrl
      }
      s.editAdaptiveBaseUrls = nextAdaptiveBaseUrls
      // 智谱团队版 Coding Plan：回填组织/项目 ID
      if (newAccount.platform === 'zhipu') {
        s.editZhipuOrganization =
          typeof apiCredentials.zhipu_organization === 'string' ? apiCredentials.zhipu_organization : ''
        s.editZhipuProject = typeof apiCredentials.zhipu_project === 'string' ? apiCredentials.zhipu_project : ''
      }
      if (providerRoutesByModel(newAccount.platform)) {
        s.editOpenCodeGoProtocolRules =
          parseOpenCodeGoProtocolRules(apiCredentials.protocol_rules) ??
          cloneOpenCodeGoProtocolRules(
            defaultProviderProtocolRules(newAccount.platform, currentOpenCodeOrCNMode(s, newAccount))
          )
      }
    }
    const platformDefaultUrl =
      newAccount.platform === 'openai'
        ? 'https://api.openai.com'
        : newAccount.platform === 'gemini'
          ? 'https://generativelanguage.googleapis.com'
          : newAccount.platform === 'grok'
            ? 'https://api.x.ai/v1'
            : newAccount.platform === 'typesafe'
              ? 'https://api.typesafe.ai'
              : isMultiProtocolApiKeyPlatform(newAccount.platform)
                ? defaultCNBaseUrl(newAccount.platform, currentOpenCodeOrCNMode(s, newAccount), s.editApiProtocol)
                : 'https://api.anthropic.com'
    s.editBaseUrl =
      isCNApiKeyAccount(newAccount) && s.editApiProtocol === 'adaptive'
        ? s.editAdaptiveBaseUrls.chat_completions
        : (apiCredentials.base_url as string) || platformDefaultUrl

    // Load model mappings and detect mode
    Object.assign(s, loadModelRestrictionFromMapping(apiCredentials.model_mapping as Record<string, unknown> | undefined))

    // Load pool mode
    s.poolModeEnabled = apiCredentials.pool_mode === true
    s.poolModeRetryCount = normalizePoolModeRetryCount(
      Number(apiCredentials.pool_mode_retry_count ?? DEFAULT_POOL_MODE_RETRY_COUNT)
    )
    s.poolModeRetryStatusCodesInput = formatPoolModeRetryStatusCodes(apiCredentials.pool_mode_retry_status_codes)

    s.explicitCacheUpstreamEnabled = apiCredentials.explicit_cache_upstream === true
    s.explicitCacheUpstreamMaxTTL =
      normalizeExplicitCacheUpstreamMaxTTL(apiCredentials.explicit_cache_upstream_max_ttl_seconds) ?? ''

    // Load custom error codes
    s.customErrorCodesEnabled = apiCredentials.custom_error_codes_enabled === true
    const existingErrorCodes = apiCredentials.custom_error_codes as number[] | undefined
    if (existingErrorCodes && Array.isArray(existingErrorCodes)) {
      s.selectedErrorCodes = [...existingErrorCodes]
    } else {
      s.selectedErrorCodes = []
    }
  } else if (newAccount.type === 'bedrock' && newAccount.credentials) {
    const bedrockCreds = newAccount.credentials as Record<string, unknown>
    const authMode = (bedrockCreds.auth_mode as string) || 'sigv4'
    s.editBedrockRegion = (bedrockCreds.aws_region as string) || ''
    s.editBedrockForceGlobal = (bedrockCreds.aws_force_global as string) === 'true'

    if (authMode === 'apikey') {
      s.editBedrockApiKeyValue = ''
    } else {
      s.editBedrockAccessKeyId = (bedrockCreds.aws_access_key_id as string) || ''
      s.editBedrockSecretAccessKey = ''
      s.editBedrockSessionToken = ''
    }

    // Load pool mode for bedrock
    s.poolModeEnabled = bedrockCreds.pool_mode === true
    const retryCount = bedrockCreds.pool_mode_retry_count
    s.poolModeRetryCount = typeof retryCount === 'number' && retryCount >= 0 ? retryCount : DEFAULT_POOL_MODE_RETRY_COUNT
    s.poolModeRetryStatusCodesInput = formatPoolModeRetryStatusCodes(bedrockCreds.pool_mode_retry_status_codes)

    // Load quota limits for bedrock
    const bedrockExtra = (newAccount.extra as Record<string, unknown>) || {}
    s.editQuotaLimit = typeof bedrockExtra.quota_limit === 'number' ? bedrockExtra.quota_limit : null
    s.editQuotaDailyLimit = typeof bedrockExtra.quota_daily_limit === 'number' ? bedrockExtra.quota_daily_limit : null
    s.editQuotaWeeklyLimit = typeof bedrockExtra.quota_weekly_limit === 'number' ? bedrockExtra.quota_weekly_limit : null

    // Load model mappings for bedrock
    Object.assign(s, loadModelRestrictionFromMapping(bedrockCreds.model_mapping as Record<string, unknown> | undefined))
  } else if (newAccount.type === 'upstream' && newAccount.credentials) {
    const upstreamCreds = newAccount.credentials as Record<string, unknown>
    s.editBaseUrl = (upstreamCreds.base_url as string) || ''
  } else if (
    (newAccount.platform === 'gemini' || newAccount.platform === 'anthropic') &&
    newAccount.type === 'service_account' &&
    newAccount.credentials
  ) {
    const saCreds = newAccount.credentials as Record<string, unknown>
    s.editVertexProjectId = (saCreds.project_id as string) || ''
    s.editVertexClientEmail = (saCreds.client_email as string) || ''
    s.editVertexLocation = (saCreds.location as string) || (saCreds.vertex_location as string) || 'us-central1'
    s.editVertexApiKey = ''

    // Load model mappings for service_account
    Object.assign(s, loadModelRestrictionFromMapping(saCreds.model_mapping as Record<string, unknown> | undefined))
  } else {
    const platformDefaultUrl =
      newAccount.platform === 'openai'
        ? 'https://api.openai.com'
        : newAccount.platform === 'gemini'
          ? 'https://generativelanguage.googleapis.com'
          : newAccount.platform === 'grok'
            ? 'https://api.x.ai/v1'
            : 'https://api.anthropic.com'
    s.editBaseUrl = platformDefaultUrl

    // Load model mappings for OpenAI/Grok OAuth accounts
    if ((newAccount.platform === 'openai' || newAccount.platform === 'grok') && newAccount.credentials) {
      const oauthCredentials = newAccount.credentials as Record<string, unknown>
      Object.assign(
        s,
        loadModelRestrictionFromMapping(oauthCredentials.model_mapping as Record<string, unknown> | undefined)
      )
    } else {
      s.modelRestrictionMode = 'whitelist'
      s.modelMappings = []
      s.allowedModels = []
    }
    s.poolModeEnabled = false
    s.poolModeRetryCount = DEFAULT_POOL_MODE_RETRY_COUNT
    s.poolModeRetryStatusCodesInput = ''
    s.explicitCacheUpstreamEnabled = false
    s.explicitCacheUpstreamMaxTTL = ''
    s.customErrorCodesEnabled = false
    s.selectedErrorCodes = []
  }
  s.editApiKey = ''
  return s
}

// ── 国产/多协议供应商的模式与协议联动（Vue 版 watch(editApiProtocol / editAccountMode / editOpenCodeAccountMode)） ──

function onApiProtocolChange(
  s: EditState,
  protocol: CnApiProtocol,
  previousProtocol: CnApiProtocol,
  account: Account | null
): EditState {
  if (!isCNApiKeyAccount(account)) return s
  const mode = currentOpenCodeOrCNMode(s, account)
  if (protocol === 'adaptive') {
    const defaults = defaultCNAdaptiveBaseUrls(adaptivePresetPlatformOf(account), mode)
    const urls = { ...s.editAdaptiveBaseUrls }
    for (const item of editAdaptiveProtocolOptions(s, account)) {
      if (!urls[item.value]) urls[item.value] = defaults[item.value]
    }
    if (previousProtocol !== 'adaptive' && s.editBaseUrl.trim()) {
      urls[previousProtocol] = s.editBaseUrl.trim()
    }
    return { ...s, editAdaptiveBaseUrls: urls, editBaseUrl: urls.chat_completions }
  }
  if (previousProtocol === 'adaptive') {
    return {
      ...s,
      editBaseUrl: s.editAdaptiveBaseUrls[protocol] || defaultCNBaseUrl(account!.platform, mode, protocol)
    }
  }
  return { ...s, editBaseUrl: defaultCNBaseUrl(account!.platform, mode, protocol) }
}

function refreshAdaptiveDefaults(
  s: EditState,
  account: Account | null,
  platform: string,
  previousMode: string,
  mode: string
): Record<CnNativeApiProtocol, string> {
  const previousDefaults = defaultCNAdaptiveBaseUrls(platform, previousMode)
  const nextDefaults = defaultCNAdaptiveBaseUrls(platform, mode)
  const urls = { ...s.editAdaptiveBaseUrls }
  for (const item of editAdaptiveProtocolOptions(s, account)) {
    if (!urls[item.value] || urls[item.value] === previousDefaults[item.value]) {
      urls[item.value] = nextDefaults[item.value]
    }
  }
  return urls
}

function onAccountModeChange(s: EditState, mode: string, previousMode: string, account: Account | null): EditState {
  if (!isCNApiKeyAccount(account)) return s
  if (account?.platform === 'opencode_go') return s
  const platform = account!.platform
  // 供应商没有的接入模式（如 deepseek 无 coding 套餐）防御性回退默认模式（UI 已隐藏该选项）。
  const effectiveMode = resolveProviderAccountMode(platform, mode)
  if (effectiveMode !== mode) {
    return { ...s, editAccountMode: effectiveMode }
  }
  let next = s
  if (providerRoutesByModel(platform)) {
    const previousRules = JSON.stringify(defaultProviderProtocolRules(platform, previousMode))
    if (JSON.stringify(next.editOpenCodeGoProtocolRules) === previousRules) {
      next = {
        ...next,
        editOpenCodeGoProtocolRules: cloneOpenCodeGoProtocolRules(defaultProviderProtocolRules(platform, mode))
      }
    }
  }
  if (next.editApiProtocol === 'adaptive') {
    const urls = refreshAdaptiveDefaults(next, account, adaptivePresetPlatformOf(account), previousMode, mode)
    return { ...next, editAdaptiveBaseUrls: urls, editBaseUrl: urls.chat_completions }
  }
  return { ...next, editBaseUrl: defaultCNBaseUrl(platform, mode, next.editApiProtocol) }
}

function onOpenCodeAccountModeChange(
  s: EditState,
  mode: OpenCodeAccountMode,
  previousMode: OpenCodeAccountMode,
  account: Account | null
): EditState {
  if (!isCNApiKeyAccount(account) || account?.platform !== 'opencode_go') return s
  let next: EditState
  if (s.editApiProtocol === 'adaptive') {
    const urls = refreshAdaptiveDefaults(s, account, 'opencode_go', previousMode, mode)
    next = { ...s, editAdaptiveBaseUrls: urls, editBaseUrl: urls.chat_completions }
  } else {
    next = { ...s, editBaseUrl: defaultCNBaseUrl('opencode_go', mode, s.editApiProtocol) }
  }
  const previousRules = JSON.stringify(defaultOpenCodeProtocolRules(previousMode))
  if (JSON.stringify(next.editOpenCodeGoProtocolRules) === previousRules) {
    next = { ...next, editOpenCodeGoProtocolRules: cloneOpenCodeGoProtocolRules(defaultOpenCodeProtocolRules(mode)) }
  }
  return next
}

const MAX_WATCH_ITERATIONS = 100

/**
 * 应用一次用户修改，并按 Vue 版 watcher 的注册顺序（协议 → 模式 → OpenCode 模式）运行联动，
 * 直到三者都不再变化（模式回退会再次触发模式联动）。
 */
export function applyEditPatch(prev: EditState, patch: Partial<EditState>, account: Account | null): EditState {
  let next: EditState = { ...prev, ...patch }
  let lastProtocol = prev.editApiProtocol
  let lastMode = prev.editAccountMode
  let lastOpenCodeMode = prev.editOpenCodeAccountMode
  for (let i = 0; i < MAX_WATCH_ITERATIONS; i++) {
    if (next.editApiProtocol !== lastProtocol) {
      const old = lastProtocol
      lastProtocol = next.editApiProtocol
      next = onApiProtocolChange(next, lastProtocol, old, account)
      continue
    }
    if (next.editAccountMode !== lastMode) {
      const old = lastMode
      lastMode = next.editAccountMode
      next = onAccountModeChange(next, lastMode, old, account)
      continue
    }
    if (next.editOpenCodeAccountMode !== lastOpenCodeMode) {
      const old = lastOpenCodeMode
      lastOpenCodeMode = next.editOpenCodeAccountMode
      next = onOpenCodeAccountModeChange(next, lastOpenCodeMode, old, account)
      continue
    }
    break
  }
  return next
}

// ── 提交载荷 ──

export interface BuildPayloadDeps {
  t: (key: string, ...args: unknown[]) => string
  /** useQuotaNotifyState().writeToExtra */
  writeQuotaNotifyToExtra: (extra: Record<string, unknown>, mode: 'create' | 'update') => void
}

export type BuildPayloadResult = { ok: true; payload: Record<string, unknown> } | { ok: false; message: string }

/** 对应 Vue 版 handleSubmit 中混合渠道检查之前的部分：校验并构建 update 请求体 */
export function buildEditUpdatePayload(s: EditState, account: Account, deps: BuildPayloadDeps): BuildPayloadResult {
  const { t } = deps
  const fail = (message: string): BuildPayloadResult => ({ ok: false, message })
  const isSparkShadow = isSparkShadowAccount(account)
  const form = s.form

  if (form.status !== 'active' && form.status !== 'inactive' && form.status !== 'error') {
    return fail(t('admin.accounts.pleaseSelectStatus'))
  }
  if (s.autoResetCreditEnabled) {
    const thresholds = [s.autoResetCredit5hThreshold, s.autoResetCredit7dThreshold]
    if (thresholds.some((value) => !Number.isFinite(value) || (value as number) < 0.1 || (value as number) > 100)) {
      return fail(t('admin.accounts.autoResetCredit.thresholdInvalid'))
    }
  }

  const updatePayload: Record<string, unknown> = { ...form }
  // 后端期望 proxy_id: 0 表示清除代理，而不是 null
  if (updatePayload.proxy_id === null) {
    updatePayload.proxy_id = 0
  }
  if (form.expires_at === null) {
    updatePayload.expires_at = 0
  }
  // load_factor: 空值/NaN/0/负数 时发送 0（后端约定 <= 0 = 清除）
  const lf = form.load_factor
  if (lf == null || Number.isNaN(lf) || lf <= 0) {
    updatePayload.load_factor = 0
  }
  updatePayload.auto_pause_on_expired = s.autoPauseOnExpired
  if (account.type === 'apikey') {
    updatePayload.upstream_billing_probe_enabled = s.upstreamBillingAutoProbeEnabled
    updatePayload.upstream_billing_rate_sync_enabled = s.upstreamBillingRateSyncEnabled
    if (s.upstreamBillingRateSyncEnabled) {
      delete updatePayload.rate_multiplier
    }
  }

  const accountCredentials = (account.credentials as Record<string, unknown>) || {}

  const applyTempUnschedConfig = (credentials: Record<string, unknown>) => {
    if (!s.tempUnschedEnabled) {
      delete credentials.temp_unschedulable_enabled
      delete credentials.temp_unschedulable_rules
      return true
    }
    const rules = buildTempUnschedRules(s.tempUnschedRules)
    if (rules.length === 0) {
      return false
    }
    credentials.temp_unschedulable_enabled = true
    credentials.temp_unschedulable_rules = rules
    return true
  }

  const applyAccountSchedulingThresholdOverridePatch = (
    credentials: Record<string, unknown>,
    currentCredentials: Record<string, unknown>
  ) => {
    if (!supportsAccountSchedulingThresholdOverridePlatform(account.platform)) {
      return
    }
    const current = normalizeAccountSchedulingThresholdOverride(currentCredentials[ACCOUNT_SCHEDULING_THRESHOLD_CREDENTIAL_KEY])
    if (!s.accountSchedulingThresholdOverrideEnabled) {
      if (current !== null) {
        credentials[ACCOUNT_SCHEDULING_THRESHOLD_CREDENTIAL_KEY] = null
      }
      return
    }
    const next = clampAccountSchedulingThresholdOverride(s.accountSchedulingThresholdOverrideValue)
    if (current !== next) {
      credentials[ACCOUNT_SCHEDULING_THRESHOLD_CREDENTIAL_KEY] = next
    }
  }

  const applyPoolMode = (credentials: Record<string, unknown>) => {
    if (s.poolModeEnabled) {
      credentials.pool_mode = true
      credentials.pool_mode_retry_count = normalizePoolModeRetryCount(s.poolModeRetryCount)
      const parsedRetryStatusCodes = parsePoolModeRetryStatusCodes(s.poolModeRetryStatusCodesInput)
      if (parsedRetryStatusCodes.length > 0) {
        credentials.pool_mode_retry_status_codes = parsedRetryStatusCodes
      } else {
        delete credentials.pool_mode_retry_status_codes
      }
    } else {
      delete credentials.pool_mode
      delete credentials.pool_mode_retry_count
      delete credentials.pool_mode_retry_status_codes
    }
  }

  const applyModelRestriction = (credentials: Record<string, unknown>) => {
    const modelMapping = buildModelRestrictionMapping(s)
    if (modelMapping) {
      credentials.model_mapping = modelMapping
    } else {
      delete credentials.model_mapping
    }
  }

  const tempUnschedInvalid = () => fail(t('admin.accounts.tempUnschedulable.rulesInvalid'))

  // For apikey type, handle credentials update
  if (account.type === 'apikey') {
    const currentCredentials = accountCredentials
    const newBaseUrl = s.editBaseUrl.trim() || defaultBaseUrlOf(s, account)
    const shouldApplyModelMapping = !(account.platform === 'openai' && s.openaiPassthroughEnabled)

    // Always update credentials for apikey type to handle model mapping changes
    const newCredentials: Record<string, unknown> = {
      ...currentCredentials,
      base_url: newBaseUrl
    }

    // 国产供应商：模式与协议写入凭据（决定额度/余额探测与转发端点/格式）。
    if (isCNApiKeyAccount(account)) {
      const mode = currentOpenCodeOrCNMode(s, account)
      newCredentials.account_mode = mode
      newCredentials.api_protocol = s.editApiProtocol
      if (s.editApiProtocol === 'adaptive') {
        const defaults = defaultCNAdaptiveBaseUrls(adaptivePresetPlatformOf(account), mode)
        const protocolBaseUrls: Record<string, string> = {}
        for (const item of editAdaptiveProtocolOptions(s, account)) {
          protocolBaseUrls[item.value] = (s.editAdaptiveBaseUrls[item.value] || defaults[item.value]).trim()
        }
        newCredentials.api_base_urls = protocolBaseUrls
        newCredentials.base_url = protocolBaseUrls.chat_completions
      } else {
        delete newCredentials.api_base_urls
      }
      if (providerRoutesByModel(account.platform)) {
        applyOpenCodeGoProtocolRules(newCredentials, s.editOpenCodeGoProtocolRules, 'edit')
      }
      // 智谱团队版 Coding Plan：组织/项目 ID 写入凭据（非空才写，清空即移除回落个人版路径）
      if (account.platform === 'zhipu') {
        const org = s.editZhipuOrganization.trim()
        const project = s.editZhipuProject.trim()
        if (org) {
          newCredentials.zhipu_organization = org
          if (project) newCredentials.zhipu_project = project
          else delete newCredentials.zhipu_project
        } else {
          delete newCredentials.zhipu_organization
          delete newCredentials.zhipu_project
        }
      }
    }

    // Handle API key
    // 后端响应已脱敏：currentCredentials 不会再包含 api_key 原文。
    // 用户填入新值则覆盖；留空时优先看 credentials_status.has_api_key；
    // 若后端尚未升级（无 credentials_status），回退读旧结构 currentCredentials.api_key。
    // 两者都无才报错。
    const hasExistingApiKey = account.credentials_status?.has_api_key ?? Boolean(currentCredentials.api_key)
    if (s.editApiKey.trim()) {
      newCredentials.api_key = s.editApiKey.trim()
    } else if (!hasExistingApiKey) {
      return fail(t('admin.accounts.apiKeyIsRequired'))
    }

    // Add model mapping if configured（OpenAI 开启自动透传时保留现有映射，不再编辑）
    if (shouldApplyModelMapping) {
      applyModelRestriction(newCredentials)
    } else if (currentCredentials.model_mapping) {
      newCredentials.model_mapping = currentCredentials.model_mapping
    }
    if (account.platform === 'openai') {
      applyOpenAIEndpointCapabilities(newCredentials, s.openAIEndpointCapabilities)
      const compactModelMapping = buildModelMappingObject('mapping', [], s.openAICompactModelMappings)
      if (compactModelMapping) {
        newCredentials.compact_model_mapping = compactModelMapping
      } else {
        delete newCredentials.compact_model_mapping
      }
    }

    // Add pool mode if enabled
    applyPoolMode(newCredentials)

    applyExplicitCacheUpstreamCredentials(
      newCredentials,
      account.platform === 'gemini' && !isOfficialGeminiBaseUrl(s.editBaseUrl) && s.explicitCacheUpstreamEnabled,
      s.explicitCacheUpstreamMaxTTL ?? ''
    )

    // Add custom error codes if enabled
    if (s.customErrorCodesEnabled) {
      newCredentials.custom_error_codes_enabled = true
      // Vue 版模板里 selectedErrorCodes.sort() 会就地排序，开启时提交的总是升序列表
      newCredentials.custom_error_codes = [...s.selectedErrorCodes].sort((a, b) => a - b)
    } else {
      delete newCredentials.custom_error_codes_enabled
      delete newCredentials.custom_error_codes
    }

    // Add header override if enabled for this API-key platform
    if (isHeaderOverrideCapable(account.platform, 'apikey')) {
      if (s.headerOverrideEnabled) {
        const headerError = validateHeaderOverrideRows(s.headerOverrideRows)
        if (headerError) {
          return fail(t(`admin.accounts.headerOverride.${headerError}`))
        }
      }
      applyHeaderOverride(newCredentials, s.headerOverrideEnabled, s.headerOverrideRows, 'edit')
    }

    // Add intercept warmup requests setting
    applyInterceptWarmup(newCredentials, s.interceptWarmupRequests, 'edit')
    applyAccountSchedulingThresholdOverridePatch(newCredentials, currentCredentials)
    if (!applyTempUnschedConfig(newCredentials)) {
      return tempUnschedInvalid()
    }

    updatePayload.credentials = newCredentials
  } else if (account.type === 'upstream') {
    const currentCredentials = accountCredentials
    const newCredentials: Record<string, unknown> = { ...currentCredentials }

    newCredentials.base_url = s.editBaseUrl.trim()

    if (s.editApiKey.trim()) {
      newCredentials.api_key = s.editApiKey.trim()
    }

    // Add intercept warmup requests setting
    applyInterceptWarmup(newCredentials, s.interceptWarmupRequests, 'edit')

    applyAccountSchedulingThresholdOverridePatch(newCredentials, currentCredentials)
    if (!applyTempUnschedConfig(newCredentials)) {
      return tempUnschedInvalid()
    }

    updatePayload.credentials = newCredentials
  } else if ((account.platform === 'gemini' || account.platform === 'anthropic') && account.type === 'service_account') {
    const currentCredentials = accountCredentials
    const newCredentials: Record<string, unknown> = { ...currentCredentials }
    const credentialsStatus = account.credentials_status

    if (isVertexAPIKeyMode(account)) {
      // API Key 已脱敏不再随 credentials 返回，存在性读 credentials_status；留空表示保留原 Key。
      const newApiKey = s.editVertexApiKey.trim()
      const hasExistingApiKey = credentialsStatus ? Boolean(credentialsStatus.has_api_key) : Boolean(currentCredentials.api_key)
      if (!newApiKey && !hasExistingApiKey) {
        return fail(t('admin.accounts.vertexApiKeyRequired'))
      }
      const projectId = s.editVertexProjectId.trim()
      if (projectId && !s.editVertexLocation.trim()) {
        return fail(t('admin.accounts.vertexLocationRequired'))
      }
      if (newApiKey) {
        newCredentials.api_key = newApiKey
      }
      if (projectId) {
        newCredentials.project_id = projectId
      } else {
        delete newCredentials.project_id
      }
      newCredentials.location = s.editVertexLocation.trim() || 'global'
    } else {
      if (!s.editVertexProjectId.trim()) {
        return fail(t('admin.accounts.vertexSaJsonMissingProjectId'))
      }
      if (!s.editVertexClientEmail.trim()) {
        return fail(t('admin.accounts.vertexSaJsonMissingClientEmail'))
      }
      if (!s.editVertexLocation.trim()) {
        return fail(t('admin.accounts.vertexLocationRequired'))
      }

      // SA JSON 已脱敏不再随 credentials 返回，存在性优先读 credentials_status。
      // 若后端尚未升级（无 credentials_status），回退读旧结构 service_account_json / service_account。
      const hasExistingServiceAccountJson = credentialsStatus
        ? Boolean(credentialsStatus.has_service_account_json || credentialsStatus.has_service_account)
        : Boolean(currentCredentials.service_account_json || currentCredentials.service_account)
      if (!hasExistingServiceAccountJson) {
        return fail(t('admin.accounts.vertexSaJsonRequired'))
      }
      newCredentials.project_id = s.editVertexProjectId.trim()
      newCredentials.client_email = s.editVertexClientEmail.trim()
      newCredentials.location = s.editVertexLocation.trim()
    }
    newCredentials.tier_id = 'vertex'

    // Add model mapping if configured
    applyModelRestriction(newCredentials)

    applyInterceptWarmup(newCredentials, s.interceptWarmupRequests, 'edit')
    applyAccountSchedulingThresholdOverridePatch(newCredentials, currentCredentials)
    if (!applyTempUnschedConfig(newCredentials)) {
      return tempUnschedInvalid()
    }

    updatePayload.credentials = newCredentials
  } else if (account.type === 'bedrock') {
    const currentCredentials = accountCredentials
    const newCredentials: Record<string, unknown> = { ...currentCredentials }

    newCredentials.aws_region = s.editBedrockRegion.trim()
    if (s.editBedrockForceGlobal) {
      newCredentials.aws_force_global = 'true'
    } else {
      delete newCredentials.aws_force_global
    }

    if (isBedrockAPIKeyMode(account)) {
      // API Key mode: only update api_key if user provided new value
      if (s.editBedrockApiKeyValue.trim()) {
        newCredentials.api_key = s.editBedrockApiKeyValue.trim()
      }
    } else {
      // SigV4 mode
      newCredentials.aws_access_key_id = s.editBedrockAccessKeyId.trim()
      if (s.editBedrockSecretAccessKey.trim()) {
        newCredentials.aws_secret_access_key = s.editBedrockSecretAccessKey.trim()
      }
      if (s.editBedrockSessionToken.trim()) {
        newCredentials.aws_session_token = s.editBedrockSessionToken.trim()
      }
    }

    // Pool mode
    applyPoolMode(newCredentials)

    // Model mapping
    applyModelRestriction(newCredentials)

    applyInterceptWarmup(newCredentials, s.interceptWarmupRequests, 'edit')
    applyAccountSchedulingThresholdOverridePatch(newCredentials, currentCredentials)
    if (!applyTempUnschedConfig(newCredentials)) {
      return tempUnschedInvalid()
    }

    updatePayload.credentials = newCredentials
  } else {
    // For oauth/setup-token types, only update intercept_warmup_requests if changed
    const currentCredentials = accountCredentials
    const newCredentials: Record<string, unknown> = { ...currentCredentials }

    applyInterceptWarmup(newCredentials, s.interceptWarmupRequests, 'edit')
    applyAccountSchedulingThresholdOverridePatch(newCredentials, currentCredentials)
    if (!applyTempUnschedConfig(newCredentials)) {
      return tempUnschedInvalid()
    }

    updatePayload.credentials = newCredentials
  }

  // OpenAI/Grok OAuth: persist model mapping to credentials
  if ((account.platform === 'openai' || account.platform === 'grok') && account.type === 'oauth') {
    const currentCredentials = isSparkShadow
      ? {}
      : (updatePayload.credentials as Record<string, unknown>) || accountCredentials
    const newCredentials: Record<string, unknown> = { ...currentCredentials }
    if (account.platform === 'openai') {
      const shouldApplyModelMapping = !s.openaiPassthroughEnabled
      if (shouldApplyModelMapping) {
        applyModelRestriction(newCredentials)
      } else if (!newCredentials.model_mapping) {
        delete newCredentials.model_mapping
      }
      const compactModelMapping = buildModelMappingObject('mapping', [], s.openAICompactModelMappings)
      if (compactModelMapping) {
        newCredentials.compact_model_mapping = compactModelMapping
      } else {
        delete newCredentials.compact_model_mapping
      }
    } else {
      applyModelRestriction(newCredentials)
    }

    updatePayload.credentials = newCredentials
  }

  // Grok OAuth: 自定义上游地址 + 请求头覆写。base_url 仅改写转发端点，
  // OAuth 授权与令牌刷新链路不读取该值；关闭开关即恢复默认官方网关。
  if (account.platform === 'grok' && account.type === 'oauth') {
    const currentCredentials = (updatePayload.credentials as Record<string, unknown>) || accountCredentials
    const newCredentials: Record<string, unknown> = { ...currentCredentials }

    if (s.grokOAuthCustomBaseUrlEnabled) {
      const trimmedBaseUrl = s.grokOAuthBaseUrl.trim()
      if (!trimmedBaseUrl) {
        return fail(t('admin.accounts.grokCustomBaseUrl.required'))
      }
      if (!/^https?:\/\//i.test(trimmedBaseUrl)) {
        return fail(t('admin.accounts.grokCustomBaseUrl.invalid'))
      }
      newCredentials.base_url = trimmedBaseUrl
    } else {
      delete newCredentials.base_url
    }

    if (s.headerOverrideEnabled) {
      const headerError = validateHeaderOverrideRows(s.headerOverrideRows)
      if (headerError) {
        return fail(t(`admin.accounts.headerOverride.${headerError}`))
      }
    }
    applyHeaderOverride(newCredentials, s.headerOverrideEnabled, s.headerOverrideRows, 'edit')

    updatePayload.credentials = newCredentials

    const newExtra: Record<string, unknown> = {
      ...((account.extra as Record<string, unknown>) || {})
    }
    // Persist both states so a disabled account remains opted out when the
    // backend applies the default-enabled policy to missing values.
    newExtra[GROK_CLIENT_TOOL_CACHE_EXTRA_KEY] = s.grokClientToolCacheEnabled
    updatePayload.extra = newExtra
  }

  // OpenAI: 手动覆盖订阅档位 plan_type（Plus / Pro 20x / Pro 5x / Business Standard / Business Premium / Free）。
  // 仅 OAuth 非影子账号：
  // 影子账号凭据由母账号管理(且后端会 sanitize),setup-token 无订阅调度语义。
  if (account.platform === 'openai' && account.type === 'oauth' && !isSparkShadow) {
    const currentCredentials = (updatePayload.credentials as Record<string, unknown>) || accountCredentials
    updatePayload.credentials = applyPlanType({ ...currentCredentials }, s.editPlanType)
  }

  // Antigravity: persist model mapping to credentials (applies to all antigravity types)
  // Antigravity 只支持映射模式
  if (account.platform === 'antigravity') {
    const currentCredentials = (updatePayload.credentials as Record<string, unknown>) || accountCredentials
    const newCredentials: Record<string, unknown> = { ...currentCredentials }
    if (account.type === 'oauth') {
      applyAntigravityProjectID(newCredentials, s.antigravityProjectId, 'edit')
    }

    // 移除旧字段
    delete newCredentials.model_whitelist
    delete newCredentials.model_mapping

    // 只使用映射模式
    const antigravityModelMapping = buildModelMappingObject('mapping', [], s.antigravityModelMappings)
    if (antigravityModelMapping) {
      newCredentials.model_mapping = antigravityModelMapping
    }

    updatePayload.credentials = newCredentials
  }

  // For antigravity accounts, handle mixed_scheduling and allow_overages in extra
  if (account.platform === 'antigravity') {
    const currentExtra = (account.extra as Record<string, unknown>) || {}
    const newExtra: Record<string, unknown> = { ...currentExtra }
    if (s.mixedScheduling) {
      newExtra.mixed_scheduling = true
    } else {
      delete newExtra.mixed_scheduling
    }
    if (s.allowOverages) {
      newExtra.allow_overages = true
    } else {
      delete newExtra.allow_overages
    }
    updatePayload.extra = newExtra
  }

  // For Anthropic OAuth/SetupToken accounts, handle quota control settings in extra
  if (account.platform === 'anthropic' && (account.type === 'oauth' || account.type === 'setup-token')) {
    const currentExtra =
      (updatePayload.extra as Record<string, unknown>) || (account.extra as Record<string, unknown>) || {}
    const newExtra: Record<string, unknown> = { ...currentExtra }

    // Window cost limit settings
    if (s.windowCostEnabled && s.windowCostLimit != null && (s.windowCostLimit as number) > 0) {
      newExtra.window_cost_limit = s.windowCostLimit
      newExtra.window_cost_sticky_reserve = s.windowCostStickyReserve ?? 10
    } else {
      delete newExtra.window_cost_limit
      delete newExtra.window_cost_sticky_reserve
    }

    // Session limit settings
    if (s.sessionLimitEnabled && s.maxSessions != null && (s.maxSessions as number) > 0) {
      newExtra.max_sessions = s.maxSessions
      newExtra.session_idle_timeout_minutes = s.sessionIdleTimeout ?? 5
    } else {
      delete newExtra.max_sessions
      delete newExtra.session_idle_timeout_minutes
    }

    // RPM limit settings
    if (s.rpmLimitEnabled) {
      const DEFAULT_BASE_RPM = 15
      newExtra.base_rpm = s.baseRpm != null && (s.baseRpm as number) > 0 ? s.baseRpm : DEFAULT_BASE_RPM
      newExtra.rpm_strategy = s.rpmStrategy
      if (s.rpmStickyBuffer != null && (s.rpmStickyBuffer as number) > 0) {
        newExtra.rpm_sticky_buffer = s.rpmStickyBuffer
      } else {
        delete newExtra.rpm_sticky_buffer
      }
    } else {
      delete newExtra.base_rpm
      delete newExtra.rpm_strategy
      delete newExtra.rpm_sticky_buffer
    }

    // UMQ mode（独立于 RPM 保存）
    if (s.userMsgQueueMode) {
      newExtra.user_msg_queue_mode = s.userMsgQueueMode
    } else {
      delete newExtra.user_msg_queue_mode
    }
    delete newExtra.user_msg_queue_enabled // 清理旧字段

    // TLS fingerprint setting
    if (s.tlsFingerprintEnabled) {
      newExtra.enable_tls_fingerprint = true
      if (s.tlsFingerprintProfileId) {
        newExtra.tls_fingerprint_profile_id = s.tlsFingerprintProfileId
      } else {
        delete newExtra.tls_fingerprint_profile_id
      }
    } else {
      delete newExtra.enable_tls_fingerprint
      delete newExtra.tls_fingerprint_profile_id
    }

    // Session ID masking setting
    if (s.sessionIdMaskingEnabled) {
      newExtra.session_id_masking_enabled = true
    } else {
      delete newExtra.session_id_masking_enabled
    }

    // Cache TTL override setting
    if (s.cacheTTLOverrideEnabled) {
      newExtra.cache_ttl_override_enabled = true
      newExtra.cache_ttl_override_target = s.cacheTTLOverrideTarget
    } else {
      delete newExtra.cache_ttl_override_enabled
      delete newExtra.cache_ttl_override_target
    }

    // Custom base URL relay setting
    if (s.customBaseUrlEnabled && s.customBaseUrl.trim()) {
      newExtra.custom_base_url_enabled = true
      newExtra.custom_base_url = s.customBaseUrl.trim()
    } else {
      delete newExtra.custom_base_url_enabled
      delete newExtra.custom_base_url
    }

    updatePayload.extra = newExtra
  }

  // For Anthropic API Key accounts, handle passthrough mode + web search emulation in extra
  if (account.platform === 'anthropic' && account.type === 'apikey') {
    const currentExtra =
      (updatePayload.extra as Record<string, unknown>) || (account.extra as Record<string, unknown>) || {}
    const newExtra: Record<string, unknown> = { ...currentExtra }
    if (s.anthropicPassthroughEnabled) {
      newExtra.anthropic_passthrough = true
    } else {
      delete newExtra.anthropic_passthrough
    }
    if (s.anthropicAPIKeyAuthScheme === 'authorization_bearer') {
      newExtra.anthropic_apikey_auth_scheme = 'authorization_bearer'
    } else {
      delete newExtra.anthropic_apikey_auth_scheme
    }
    if (s.webSearchEmulationMode === 'default') {
      delete newExtra.web_search_emulation
    } else {
      newExtra.web_search_emulation = s.webSearchEmulationMode
    }
    updatePayload.extra = newExtra
  }

  // For OpenAI OAuth/SetupToken/API Key accounts, handle passthrough mode in extra
  if (
    account.platform === 'openai' &&
    (account.type === 'oauth' || account.type === 'setup-token' || account.type === 'apikey')
  ) {
    const currentExtra = (account.extra as Record<string, unknown>) || {}
    const newExtra: Record<string, unknown> = { ...currentExtra }
    const hadCodexCLIOnlyEnabled = currentExtra.codex_cli_only === true
    if (account.type === 'oauth' || account.type === 'setup-token') {
      newExtra.openai_oauth_responses_websockets_v2_mode = s.openaiOAuthResponsesWebSocketV2Mode
      newExtra.openai_oauth_responses_websockets_v2_enabled = isOpenAIWSModeEnabled(s.openaiOAuthResponsesWebSocketV2Mode)
    } else if (account.type === 'apikey') {
      newExtra.openai_apikey_responses_websockets_v2_mode = s.openaiAPIKeyResponsesWebSocketV2Mode
      newExtra.openai_apikey_responses_websockets_v2_enabled = isOpenAIWSModeEnabled(s.openaiAPIKeyResponsesWebSocketV2Mode)
    }
    delete newExtra.responses_websockets_v2_enabled
    delete newExtra.openai_ws_enabled
    if (s.openaiPassthroughEnabled) {
      newExtra.openai_passthrough = true
    } else {
      delete newExtra.openai_passthrough
      delete newExtra.openai_oauth_passthrough
    }
    // 缺省即保留 namespace，不写空值，避免 extra 里堆积默认项
    if (account.type === 'oauth' && s.openaiFlattenNamespacesEnabled) {
      newExtra.openai_responses_flatten_namespaces = true
    } else {
      delete newExtra.openai_responses_flatten_namespaces
    }
    if (isSparkShadow) {
      delete newExtra.openai_long_context_billing_enabled
    } else {
      newExtra.openai_long_context_billing_enabled = s.openAILongContextBillingEnabled
    }
    if (s.openAICompactMode === 'auto') {
      delete newExtra.openai_compact_mode
    } else {
      newExtra.openai_compact_mode = s.openAICompactMode
    }
    if (account.type === 'apikey') {
      if (!s.openAIEndpointCapabilities.includes('chat_completions') || s.openAIResponsesMode === 'auto') {
        delete newExtra.openai_responses_mode
      } else {
        newExtra.openai_responses_mode = s.openAIResponsesMode
      }
      if (s.openAIImagesUrlToB64JsonEnabled) {
        newExtra.images_url_to_b64_json = true
      } else {
        delete newExtra.images_url_to_b64_json
      }
      if (s.webSearchEmulationMode === 'default') {
        delete newExtra.web_search_emulation
      } else {
        newExtra.web_search_emulation = s.webSearchEmulationMode
      }
    }
    if (s.autoPause5hThreshold != null && (s.autoPause5hThreshold as number) > 0) {
      newExtra.auto_pause_5h_threshold = (s.autoPause5hThreshold as number) / 100
    } else {
      delete newExtra.auto_pause_5h_threshold
    }
    if (s.autoPause7dThreshold != null && (s.autoPause7dThreshold as number) > 0) {
      newExtra.auto_pause_7d_threshold = (s.autoPause7dThreshold as number) / 100
    } else {
      delete newExtra.auto_pause_7d_threshold
    }
    if (s.autoPause5hDisabled) {
      newExtra.auto_pause_5h_disabled = true
    } else {
      delete newExtra.auto_pause_5h_disabled
    }
    if (s.autoPause7dDisabled) {
      newExtra.auto_pause_7d_disabled = true
    } else {
      delete newExtra.auto_pause_7d_disabled
    }
    if (account.type === 'oauth' && !isSparkShadow) {
      newExtra.auto_reset_credit_enabled = s.autoResetCreditEnabled
      newExtra.auto_reset_credit_5h_threshold = Number(s.autoResetCredit5hThreshold) / 100
      newExtra.auto_reset_credit_7d_threshold = Number(s.autoResetCredit7dThreshold) / 100
    }
    // 运行态只允许后端服务更新，账号编辑不得回写旧状态。
    delete newExtra.codex_auto_reset_credit_state

    delete newExtra.codex_image_generation_bridge_enabled
    switch (s.codexImageToolMode) {
      case 'enabled':
      case 'disabled':
        newExtra.codex_image_generation_bridge = s.codexImageToolMode === 'enabled'
        delete newExtra.codex_image_generation_explicit_tool_policy
        break
      case 'block':
        newExtra.codex_image_generation_explicit_tool_policy = 'strip'
        delete newExtra.codex_image_generation_bridge
        break
      default:
        delete newExtra.codex_image_generation_bridge
        delete newExtra.codex_image_generation_explicit_tool_policy
    }

    if (account.type === 'oauth' || account.type === 'setup-token') {
      if (s.codexCLIOnlyEnabled) {
        newExtra.codex_cli_only = true
      } else if (hadCodexCLIOnlyEnabled) {
        // 关闭时显式写 false，避免 extra 为空被后端忽略导致旧值无法清除
        newExtra.codex_cli_only = false
      } else {
        delete newExtra.codex_cli_only
      }
      // Claude Code 插件放行已迁移到全局 codex_cli_only_whitelist，编辑时清理废弃账号级快捷字段。
      delete newExtra.codex_cli_only_allowed_clients
      if (s.codexCLIOnlyEnabled && s.codexCLIOnlyAppServerEnabled) {
        newExtra.codex_cli_only_allow_app_server = true
      } else {
        delete newExtra.codex_cli_only_allow_app_server
      }
    }

    // 指纹收敛模式：默认 off（不写入）；device/session/full 是显式 opt-in，
    // 必须落键，否则管理员的选择会被后端当作"未设置"而回落到 off（#5610）。
    if (account.type === 'oauth') {
      if (s.codexFingerprintMode !== 'off') {
        newExtra.codex_fingerprint_mode = s.codexFingerprintMode
      } else {
        delete newExtra.codex_fingerprint_mode
      }
    }

    updatePayload.extra = newExtra
  }

  // For apikey/bedrock/service_account accounts, handle quota_limit in extra
  if (supportsAccountQuota(account.type)) {
    const currentExtra =
      (updatePayload.extra as Record<string, unknown>) || (account.extra as Record<string, unknown>) || {}
    const newExtra: Record<string, unknown> = { ...currentExtra }
    // 上游倍率自动探测对全部 API-key 平台开放（sub2api 上游即可应答），
    // Bedrock 凭证无静态 Key 不参与。
    if (account.type === 'apikey') {
      delete newExtra.upstream_billing_probe_enabled
      delete newExtra.upstream_billing_rate_sync_enabled
    }
    // Total quota
    if (s.editQuotaLimit != null && s.editQuotaLimit > 0) {
      newExtra.quota_limit = s.editQuotaLimit
    } else {
      delete newExtra.quota_limit
    }
    // Daily quota
    if (s.editQuotaDailyLimit != null && s.editQuotaDailyLimit > 0) {
      newExtra.quota_daily_limit = s.editQuotaDailyLimit
    } else {
      delete newExtra.quota_daily_limit
      delete newExtra.quota_daily_used
      delete newExtra.quota_daily_start
    }
    // Weekly quota
    if (s.editQuotaWeeklyLimit != null && s.editQuotaWeeklyLimit > 0) {
      newExtra.quota_weekly_limit = s.editQuotaWeeklyLimit
    } else {
      delete newExtra.quota_weekly_limit
      delete newExtra.quota_weekly_used
      delete newExtra.quota_weekly_start
    }
    // Quota reset mode config
    if (s.editDailyResetMode === 'fixed') {
      newExtra.quota_daily_reset_mode = 'fixed'
      newExtra.quota_daily_reset_hour = s.editDailyResetHour ?? 0
    } else {
      delete newExtra.quota_daily_reset_mode
      delete newExtra.quota_daily_reset_hour
    }
    if (s.editWeeklyResetMode === 'fixed') {
      newExtra.quota_weekly_reset_mode = 'fixed'
      newExtra.quota_weekly_reset_day = s.editWeeklyResetDay ?? 1
      newExtra.quota_weekly_reset_hour = s.editWeeklyResetHour ?? 0
    } else {
      delete newExtra.quota_weekly_reset_mode
      delete newExtra.quota_weekly_reset_day
      delete newExtra.quota_weekly_reset_hour
    }
    if (s.editDailyResetMode === 'fixed' || s.editWeeklyResetMode === 'fixed') {
      newExtra.quota_reset_timezone = s.editResetTimezone || 'UTC'
    } else {
      delete newExtra.quota_reset_timezone
    }
    // Quota notify config
    deps.writeQuotaNotifyToExtra(newExtra, 'update')
    updatePayload.extra = newExtra
  }

  // 上游ID头名只在改动时写回 extra，避免用弹窗打开时的快照覆盖运行态键。
  const nextUpstreamRequestIdHeader = s.upstreamRequestIdHeader.trim()
  if (nextUpstreamRequestIdHeader !== readUpstreamRequestIdHeader(account.extra)) {
    const currentExtra =
      (updatePayload.extra as Record<string, unknown>) || (account.extra as Record<string, unknown>) || {}
    const newExtra: Record<string, unknown> = { ...currentExtra }
    if (nextUpstreamRequestIdHeader) {
      newExtra.upstream_request_id_header = nextUpstreamRequestIdHeader
    } else {
      delete newExtra.upstream_request_id_header
    }
    updatePayload.extra = newExtra
  }

  return { ok: true, payload: updatePayload }
}
