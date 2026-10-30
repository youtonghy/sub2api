/**
 * 分组创建 / 编辑表单的纯逻辑（Vue 版 GroupsView.vue <script> 中与表单相关的部分）。
 * 表单默认值、从分组回显、平台与订阅类型切换时的归一化、预览价计算，以及创建 / 更新请求体的构造都在这里，
 * 视图与表单组件只负责状态与渲染。请求体与 Vue 版逐字段一致：先展开整个表单，再覆盖归一化后的字段。
 */
import type { ChannelModelPricing } from '@/api/admin/channels'
import {
  apiIntervalsToForm,
  createDefaultTimePricingForm,
  formIntervalsToAPI,
  formReasoningEffortMultipliersToAPI,
  mTokToPerToken,
  perTokenToMTok,
  toNullableNumber,
  type PricingFormEntry
} from '@/components/admin/channel/types'
import type {
  AdminGroup,
  CodexModelsManifestConfig,
  GroupI18n,
  GroupPlatform,
  SubscriptionType
} from '@/types'
import {
  buildModelAllowlistConfig,
  type ModelAllowlistState
} from '@/views/admin/groupModelAllowlist'
import {
  getDefaultImagePreviewPrice,
  getDefaultVideoPreviewPrice
} from '@/views/admin/groupsImagePricing'
import {
  createDefaultMessagesDispatchFormState,
  messagesDispatchConfigToFormState,
  messagesDispatchFormStateToConfig,
  supportsMessagesDispatchPlatform,
  type MessagesDispatchMappingRow
} from '@/views/admin/groupsMessagesDispatch'
import { normalizeGroupOpenAIFast } from '@/views/admin/groupsOpenAIFast'
import {
  isProfitControlPlatform,
  profitDecimalToPercent,
  profitPercentToDecimal
} from '@/views/admin/groupsProfitControl'
import {
  normalizeReasoningEffortForPlatform,
  normalizeReasoningEffortOverLimit,
  reasoningEffortMappingsToAPI,
  reasoningEffortMappingsToRows,
  reasoningEffortOverLimitDowngrade,
  supportsReasoningEffortPolicyPlatform,
  type ReasoningEffortMappingRow
} from '@/views/admin/groupsReasoningEffort'
import { normalizeSupportedModelScopesForPlatform } from '@/views/admin/groupsSupportedModelScopes'
import {
  createVideoModelPricesForm,
  serializeVideoModelPrices,
  type VideoModelPricesForm
} from '@/views/admin/groupsVideoModelPricing'

type TranslateFn = (key: string, ...args: any[]) => string

export type GroupFormMode = 'create' | 'edit'

/** v-model.number 的取值：可解析时是数字，清空输入框时是 ""，否则保留原字符串 */
export type FormNumber = number | string | null

/** 等价于 Vue v-model.number（looseToNumber）：parseFloat 失败时保留原始字符串 */
export function toModelNumber(raw: string): number | string {
  const parsed = parseFloat(raw)
  return Number.isNaN(parsed) ? raw : parsed
}

/**
 * 数字输入框的 value：保持原始数字（而不是 String(value)），React 对 number 输入框按宽松相等比较，
 * 输入 "1." 这类中间态时不会被回写成 "1"。
 */
export function formNumberValue(value: FormNumber | undefined): number | string {
  return value === null || value === undefined ? '' : value
}

export const supportsLivePlatform = (platform: string): boolean =>
  platform === 'openai' || platform === 'composite'

export const DEFAULT_SUPPORTED_MODEL_SCOPES = ['claude', 'gemini_text', 'gemini_image']

// 简单账号类型（用于模型路由选择）
export interface SimpleAccount {
  id: number
  name: string
}

// 模型路由规则类型；id 只用于渲染 key，不进入请求体
export interface ModelRoutingRule {
  id: string
  pattern: string
  accounts: SimpleAccount[] // 选中的账号对象数组
}

let routingRuleSeed = 0
export function createModelRoutingRule(pattern = '', accounts: SimpleAccount[] = []): ModelRoutingRule {
  routingRuleSeed += 1
  return { id: `routing-rule-${routingRuleSeed}`, pattern, accounts }
}

export interface GroupFormState {
  name: string
  description: string
  i18n: GroupI18n
  platform: GroupPlatform
  rate_multiplier: FormNumber
  is_exclusive: boolean
  /** 仅编辑表单 */
  status?: 'active' | 'inactive'
  subscription_type: SubscriptionType
  daily_limit_usd: FormNumber
  weekly_limit_usd: FormNumber
  monthly_limit_usd: FormNumber
  long_context_pricing_enabled: boolean
  force_openai_fast: boolean
  free_openai_fast: boolean
  model_pricing: PricingFormEntry[]
  // 图片生成计费配置
  allow_image_generation: boolean
  allow_batch_image_generation: boolean
  image_count_billing: boolean
  image_rate_independent: boolean
  image_rate_multiplier: FormNumber
  batch_image_discount_multiplier: FormNumber
  batch_image_hold_multiplier: FormNumber
  image_price_1k: FormNumber
  image_price_2k: FormNumber
  image_price_4k: FormNumber
  // 视频生成计费配置（仅 Grok 平台）
  video_rate_independent: boolean
  video_rate_multiplier: FormNumber
  video_price_480p: FormNumber
  video_price_720p: FormNumber
  video_price_1080p: FormNumber
  video_model_prices: VideoModelPricesForm
  // Codex 网页搜索按次计费（仅 openai 平台使用）；null = 使用默认价 0.01
  web_search_price_per_call: FormNumber
  search_price_per_1k: FormNumber
  audio_realtime_price_per_min: FormNumber
  audio_tts_price_per_million_chars: FormNumber
  audio_stt_price_per_hour: FormNumber
  // 高峰时段倍率配置
  peak_rate_enabled: boolean
  peak_start: string
  peak_end: string
  peak_rate_multiplier: FormNumber
  // 分组利润控制（五个 token 平台）；界面按百分比输入，提交时转小数
  profit_control_enabled: boolean
  profit_min_margin_percent: FormNumber
  profit_safety_buffer_percent: FormNumber
  // Claude Code 客户端限制（仅 anthropic 平台使用）
  claude_code_only: boolean
  fallback_group_id: number | null
  fallback_group_id_on_invalid_request: number | null
  // OpenAI Messages 调度配置（仅 openai 平台使用）
  allow_messages_dispatch: boolean
  allow_live: boolean
  /** 仅编辑表单 */
  default_mapped_model?: string
  opus_mapped_model: string
  sonnet_mapped_model: string
  haiku_mapped_model: string
  exact_model_mappings: MessagesDispatchMappingRow[]
  // 账号过滤控制（OpenAI/Antigravity 平台）
  require_oauth_only: boolean
  require_privacy_set: boolean
  // 模型路由开关
  model_routing_enabled: boolean
  // 支持的模型系列（仅 antigravity 平台）
  supported_model_scopes: string[]
  // MCP XML 协议注入开关（仅 antigravity 平台）
  mcp_xml_inject: boolean
  // 从分组复制账号
  copy_accounts_from_group_ids: number[]
  // 分组级 RPM 限制（每用户每分钟最大请求数；0 = 不限制）
  rpm_limit: FormNumber
  max_reasoning_effort: string
  max_reasoning_effort_over_limit: string
  reasoning_effort_mappings: ReasoningEffortMappingRow[]
}

/** 表单默认值；编辑表单比创建表单多 status 与 default_mapped_model 两个字段（与 Vue 版两份 reactive 一致） */
export function createGroupFormDefaults(mode: GroupFormMode): GroupFormState {
  const dispatchDefaults = createDefaultMessagesDispatchFormState()
  const form: GroupFormState = {
    name: '',
    description: '',
    i18n: {},
    platform: 'anthropic',
    rate_multiplier: 1.0,
    is_exclusive: false,
    subscription_type: 'standard',
    daily_limit_usd: null,
    weekly_limit_usd: null,
    monthly_limit_usd: null,
    long_context_pricing_enabled: true,
    force_openai_fast: false,
    free_openai_fast: false,
    model_pricing: [],
    allow_image_generation: false,
    allow_batch_image_generation: false,
    image_count_billing: false,
    image_rate_independent: false,
    image_rate_multiplier: 1,
    batch_image_discount_multiplier: 0.5,
    batch_image_hold_multiplier: 0.6,
    image_price_1k: null,
    image_price_2k: null,
    image_price_4k: null,
    video_rate_independent: false,
    video_rate_multiplier: 1,
    video_price_480p: null,
    video_price_720p: null,
    video_price_1080p: null,
    video_model_prices: createVideoModelPricesForm(),
    web_search_price_per_call: null,
    search_price_per_1k: null,
    audio_realtime_price_per_min: null,
    audio_tts_price_per_million_chars: null,
    audio_stt_price_per_hour: null,
    peak_rate_enabled: false,
    peak_start: '',
    peak_end: '',
    peak_rate_multiplier: 1.0,
    profit_control_enabled: false,
    profit_min_margin_percent: 0,
    profit_safety_buffer_percent: 0,
    claude_code_only: false,
    fallback_group_id: null,
    fallback_group_id_on_invalid_request: null,
    allow_messages_dispatch: false,
    allow_live: false,
    opus_mapped_model: dispatchDefaults.opus_mapped_model,
    sonnet_mapped_model: dispatchDefaults.sonnet_mapped_model,
    haiku_mapped_model: dispatchDefaults.haiku_mapped_model,
    exact_model_mappings: [],
    require_oauth_only: false,
    require_privacy_set: false,
    model_routing_enabled: false,
    supported_model_scopes: [...DEFAULT_SUPPORTED_MODEL_SCOPES],
    mcp_xml_inject: true,
    copy_accounts_from_group_ids: [],
    rpm_limit: 0,
    max_reasoning_effort: '',
    max_reasoning_effort_over_limit: reasoningEffortOverLimitDowngrade,
    reasoning_effort_mappings: []
  }
  if (mode === 'edit') {
    form.status = 'active'
    form.default_mapped_model = ''
  }
  return form
}

export const createCodexManifestDefaults = (): CodexModelsManifestConfig => ({
  enabled: false,
  account_ids: [],
  fallback_to_scheduler: false
})

// ===== 模型定价 =====

export const emptyGroupPricing = (): PricingFormEntry => ({
  models: [],
  billing_mode: 'token',
  input_price: null,
  output_price: null,
  cache_write_price: null,
  cache_write_1h_price: null,
  cache_read_price: null,
  reasoning_effort_multipliers: null,
  image_input_price: null,
  image_output_price: null,
  per_request_price: null,
  intervals: [],
  time_pricing: createDefaultTimePricingForm()
})

export const groupPricingFromAPI = (pricing: ChannelModelPricing[] | undefined): PricingFormEntry[] =>
  (pricing || []).map((entry) => ({
    models: entry.models || [],
    billing_mode: entry.billing_mode || 'token',
    input_price: perTokenToMTok(entry.input_price),
    output_price: perTokenToMTok(entry.output_price),
    cache_write_price: perTokenToMTok(entry.cache_write_price),
    cache_write_1h_price: perTokenToMTok(entry.cache_write_1h_price),
    cache_read_price: perTokenToMTok(entry.cache_read_price),
    reasoning_effort_multipliers: entry.reasoning_effort_multipliers ? { ...entry.reasoning_effort_multipliers } : null,
    image_input_price: perTokenToMTok(entry.image_input_price),
    image_output_price: perTokenToMTok(entry.image_output_price),
    per_request_price: entry.per_request_price,
    intervals: apiIntervalsToForm(entry.intervals || []),
    time_pricing: createDefaultTimePricingForm()
  }))

export const groupPricingToAPI = (pricing: PricingFormEntry[], platform: string): ChannelModelPricing[] =>
  pricing
    .filter((entry) => entry.models.length > 0)
    .map((entry) => ({
      platform,
      models: entry.models,
      billing_mode: entry.billing_mode,
      input_price: mTokToPerToken(entry.input_price),
      output_price: mTokToPerToken(entry.output_price),
      cache_write_price: mTokToPerToken(entry.cache_write_price),
      cache_write_1h_price: mTokToPerToken(entry.cache_write_1h_price),
      cache_read_price: mTokToPerToken(entry.cache_read_price),
      reasoning_effort_multipliers: formReasoningEffortMultipliersToAPI(entry.reasoning_effort_multipliers),
      image_input_price: mTokToPerToken(entry.image_input_price),
      image_output_price: mTokToPerToken(entry.image_output_price),
      per_request_price: toNullableNumber(entry.per_request_price),
      intervals: entry.billing_mode === 'token' ? [] : formIntervalsToAPI(entry.intervals || []),
      time_pricing: null
    })) as ChannelModelPricing[]

// ===== 回显 =====

/** 编辑：从分组回显表单（Vue 版 handleEdit 中对 editForm 的逐字段赋值） */
export function groupFormFromGroup(group: AdminGroup): GroupFormState {
  const dispatch = messagesDispatchConfigToFormState(group.messages_dispatch_model_config)
  return {
    ...createGroupFormDefaults('edit'),
    name: group.name,
    description: group.description || '',
    i18n: Object.fromEntries(Object.entries(group.i18n ?? {}).map(([locale, text]) => [locale, { ...text }])),
    platform: group.platform,
    rate_multiplier: group.rate_multiplier,
    is_exclusive: group.is_exclusive,
    status: group.status,
    subscription_type: group.subscription_type || 'standard',
    daily_limit_usd: group.daily_limit_usd,
    weekly_limit_usd: group.weekly_limit_usd,
    monthly_limit_usd: group.monthly_limit_usd,
    long_context_pricing_enabled: group.long_context_pricing_enabled ?? true,
    force_openai_fast: group.force_openai_fast ?? false,
    free_openai_fast: group.free_openai_fast ?? false,
    model_pricing: groupPricingFromAPI(group.model_pricing),
    allow_image_generation: group.allow_image_generation ?? false,
    allow_batch_image_generation: group.allow_batch_image_generation ?? false,
    image_count_billing: group.image_count_billing ?? false,
    image_rate_independent: group.image_rate_independent ?? false,
    image_rate_multiplier: group.image_rate_multiplier ?? 1,
    batch_image_discount_multiplier: group.batch_image_discount_multiplier ?? 0.5,
    batch_image_hold_multiplier: group.batch_image_hold_multiplier ?? 0.6,
    image_price_1k: group.image_price_1k,
    image_price_2k: group.image_price_2k,
    image_price_4k: group.image_price_4k,
    video_rate_independent: group.video_rate_independent ?? false,
    video_rate_multiplier: group.video_rate_multiplier ?? 1,
    video_price_480p: group.video_price_480p,
    video_price_720p: group.video_price_720p,
    video_price_1080p: group.video_price_1080p,
    video_model_prices: createVideoModelPricesForm(group.video_model_prices),
    web_search_price_per_call: group.web_search_price_per_call ?? null,
    search_price_per_1k: group.search_price_per_1k ?? null,
    audio_realtime_price_per_min: group.audio_realtime_price_per_min ?? null,
    audio_tts_price_per_million_chars: group.audio_tts_price_per_million_chars ?? null,
    audio_stt_price_per_hour: group.audio_stt_price_per_hour ?? null,
    peak_rate_enabled: group.peak_rate_enabled ?? false,
    peak_start: group.peak_start ?? '',
    peak_end: group.peak_end ?? '',
    peak_rate_multiplier: group.peak_rate_multiplier ?? 1.0,
    profit_control_enabled: group.profit_control_enabled ?? false,
    profit_min_margin_percent: profitDecimalToPercent(group.profit_min_margin ?? 0),
    profit_safety_buffer_percent: profitDecimalToPercent(group.profit_safety_buffer ?? 0),
    claude_code_only: group.claude_code_only || false,
    fallback_group_id: group.fallback_group_id,
    fallback_group_id_on_invalid_request: group.fallback_group_id_on_invalid_request,
    allow_messages_dispatch: group.allow_messages_dispatch || dispatch.allow_messages_dispatch,
    allow_live: group.allow_live ?? false,
    opus_mapped_model: dispatch.opus_mapped_model,
    sonnet_mapped_model: dispatch.sonnet_mapped_model,
    haiku_mapped_model: dispatch.haiku_mapped_model,
    exact_model_mappings: dispatch.exact_model_mappings,
    require_oauth_only: group.require_oauth_only ?? false,
    require_privacy_set: group.require_privacy_set ?? false,
    model_routing_enabled: group.model_routing_enabled || false,
    supported_model_scopes: group.supported_model_scopes || [...DEFAULT_SUPPORTED_MODEL_SCOPES],
    mcp_xml_inject: group.mcp_xml_inject ?? true,
    copy_accounts_from_group_ids: [], // 复制账号字段每次编辑时重置为空
    rpm_limit: group.rpm_limit ?? 0,
    max_reasoning_effort: normalizeReasoningEffortForPlatform(group.platform, group.max_reasoning_effort),
    max_reasoning_effort_over_limit: normalizeReasoningEffortOverLimit(group.max_reasoning_effort_over_limit),
    reasoning_effort_mappings: reasoningEffortMappingsToRows(group.reasoning_effort_mappings, group.platform)
  }
}

// ===== 字段联动（Vue 版 watch） =====

/** 未开启生图时关闭批量生图与按张计费；未开启批量生图时恢复批量倍率默认值（就地修改，用于请求体） */
export function resetDisabledBatchImagePricing(
  form: Pick<
    GroupFormState,
    | 'allow_image_generation'
    | 'allow_batch_image_generation'
    | 'image_count_billing'
    | 'batch_image_discount_multiplier'
    | 'batch_image_hold_multiplier'
  >
): void {
  if (!form.allow_image_generation) {
    form.allow_batch_image_generation = false
  }
  if (!form.allow_batch_image_generation) {
    form.batch_image_discount_multiplier = 0.5
    form.batch_image_hold_multiplier = 0.6
  }
  if (!form.allow_image_generation) {
    form.image_count_billing = false
  }
}

/** 不可变版本，用于表单状态 */
export function withBatchImagePricingReset(form: GroupFormState): GroupFormState {
  const next = { ...form }
  resetDisabledBatchImagePricing(next)
  return next
}

const resetPeakRate = (form: GroupFormState): GroupFormState => ({
  ...form,
  peak_rate_enabled: false,
  peak_start: '',
  peak_end: '',
  peak_rate_multiplier: 1.0
})

/**
 * 订阅类型变化（Vue 版 watch subscription_type）：
 * 创建表单切到订阅时默认专属并清空无效请求兜底；两种表单切回标准时都清空高峰配置，避免残留随请求提交被后端拒绝。
 */
export function applySubscriptionTypeChange(form: GroupFormState, mode: GroupFormMode): GroupFormState {
  if (form.subscription_type === 'subscription') {
    if (mode === 'create') {
      return { ...form, is_exclusive: true, fallback_group_id_on_invalid_request: null }
    }
    return form
  }
  return resetPeakRate(form)
}

/** 平台变化（Vue 版 watch platform）：清理新平台不支持的配置并按平台归一化推理强度策略 */
export function applyPlatformChange(form: GroupFormState, mode: GroupFormMode): GroupFormState {
  const platform = form.platform
  let next: GroupFormState = { ...form }
  if (!['anthropic', 'antigravity'].includes(platform)) {
    next.fallback_group_id_on_invalid_request = null
  }
  if (!supportsMessagesDispatchPlatform(platform)) {
    const defaults = createDefaultMessagesDispatchFormState()
    next = {
      ...next,
      allow_messages_dispatch: defaults.allow_messages_dispatch,
      opus_mapped_model: defaults.opus_mapped_model,
      sonnet_mapped_model: defaults.sonnet_mapped_model,
      haiku_mapped_model: defaults.haiku_mapped_model,
      exact_model_mappings: []
    }
    if (mode === 'edit') next.default_mapped_model = ''
  }
  if (!supportsLivePlatform(platform)) {
    next.allow_live = false
  }
  if (!isProfitControlPlatform(platform)) {
    next.profit_control_enabled = false
    next.profit_min_margin_percent = 0
    next.profit_safety_buffer_percent = 0
  }
  next.max_reasoning_effort = normalizeReasoningEffortForPlatform(platform, next.max_reasoning_effort)
  next.max_reasoning_effort_over_limit = supportsReasoningEffortPolicyPlatform(platform)
    ? normalizeReasoningEffortOverLimit(next.max_reasoning_effort_over_limit)
    : reasoningEffortOverLimitDowngrade
  next.reasoning_effort_mappings = reasoningEffortMappingsToRows(
    reasoningEffortMappingsToAPI(next.reasoning_effort_mappings),
    platform
  )
  if (!['openai', 'antigravity', 'anthropic', 'gemini'].includes(platform)) {
    next.require_oauth_only = false
    next.require_privacy_set = false
  }
  resetDisabledBatchImagePricing(next)
  return next
}

/**
 * 编辑表单回显后补跑 Vue 版 watch：Vue 在 handleEdit 中逐字段赋值，与上一次回显的值不同的字段会触发
 * 对应的 watch（平台、订阅类型、生图开关）。这里按同样的条件执行，保证提交的请求体一致。
 */
export function applyEditHydrationWatchers(previous: GroupFormState, next: GroupFormState): GroupFormState {
  let form = next
  if (previous.subscription_type !== form.subscription_type && form.subscription_type !== 'subscription') {
    form = resetPeakRate(form)
  }
  if (previous.platform !== form.platform) {
    form = applyPlatformChange(form, 'edit')
  }
  if (
    previous.allow_image_generation !== form.allow_image_generation ||
    previous.allow_batch_image_generation !== form.allow_batch_image_generation
  ) {
    form = withBatchImagePricingReset(form)
  }
  return form
}

// ===== 预览价 =====

export const imagePricingTiers = [
  { key: 'image_price_1k', label: '1K' },
  { key: 'image_price_2k', label: '2K' },
  { key: 'image_price_4k', label: '4K' }
] as const

export const videoPricingTiers = [
  { key: 'video_price_480p', label: '480p' },
  { key: 'video_price_720p', label: '720p' },
  { key: 'video_price_1080p', label: '1080p' }
] as const

const normalizePreviewNumber = (value: number | string | null | undefined, fallback = 0) => {
  if (value === null || value === undefined || value === '') {
    return fallback
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const parsePreviewPrice = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const formatPricePreview = (value: number | string | null | undefined, notConfigured: string) => {
  if (value === null || value === undefined || value === '') {
    return notConfigured
  }
  const price = Number(value)
  if (!Number.isFinite(price) || price < 0) {
    return notConfigured
  }
  return `$${price.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

export interface PricePreviewItem {
  label: string
  value: string
}

export function buildImageFinalPricePreview(form: GroupFormState, t: TranslateFn): PricePreviewItem[] {
  const notConfigured = t('admin.groups.imagePricing.notConfigured')
  const multiplier = form.image_rate_independent
    ? normalizePreviewNumber(form.image_rate_multiplier, 1)
    : normalizePreviewNumber(form.rate_multiplier, 1)
  return imagePricingTiers.map((tier) => {
    const basePrice = parsePreviewPrice(form[tier.key]) ?? getDefaultImagePreviewPrice(form.platform, tier.key)
    return {
      label: tier.label,
      value: basePrice !== null ? formatPricePreview(basePrice * multiplier, notConfigured) : notConfigured
    }
  })
}

export function buildVideoFinalPricePreview(form: GroupFormState, t: TranslateFn): PricePreviewItem[] {
  const notConfigured = t('admin.groups.videoPricing.notConfigured')
  const multiplier = form.video_rate_independent
    ? normalizePreviewNumber(form.video_rate_multiplier, 1)
    : normalizePreviewNumber(form.rate_multiplier, 1)
  return videoPricingTiers.map((tier) => {
    const basePrice = parsePreviewPrice(form[tier.key]) ?? getDefaultVideoPreviewPrice(form.platform, tier.key)
    return {
      label: tier.label,
      value: basePrice !== null ? formatPricePreview(basePrice * multiplier, notConfigured) : notConfigured
    }
  })
}

// Codex 网页搜索单次默认价（与后端 defaultWebSearchPricePerCall 一致，官方 $10/1000 次）
const DEFAULT_WEB_SEARCH_PRICE_PER_CALL = 0.01

export function buildWebSearchFinalPricePreview(form: GroupFormState, t: TranslateFn): string {
  const basePrice = parsePreviewPrice(form.web_search_price_per_call) ?? DEFAULT_WEB_SEARCH_PRICE_PER_CALL
  const multiplier = normalizePreviewNumber(form.rate_multiplier, 1)
  return formatPricePreview(basePrice * multiplier, t('admin.groups.imagePricing.notConfigured'))
}

// ===== 请求体 =====

export const normalizeOptionalLimit = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  return Number.isFinite(value) && value > 0 ? value : null
}

export const normalizeRateMultiplier = (value: number | string | null | undefined): number => {
  if (value === null || value === undefined || value === '') {
    return 1
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1
}

// 将 UI 格式的路由规则转换为 API 格式
export const convertRoutingRulesToApiFormat = (rules: ModelRoutingRule[]): Record<string, number[]> | null => {
  const result: Record<string, number[]> = {}
  let hasValidRules = false

  for (const rule of rules) {
    const pattern = rule.pattern.trim()
    if (!pattern) continue

    const accountIds = rule.accounts.map((a) => a.id).filter((id) => id > 0)

    if (accountIds.length > 0) {
      result[pattern] = accountIds
      hasValidRules = true
    }
  }

  return hasValidRules ? result : null
}

export interface GroupPayloadContext {
  routingRules: ModelRoutingRule[]
  allowlist: ModelAllowlistState
  isSimpleMode: boolean
}

type PayloadRecord = Record<string, any>

const messagesDispatchConfigFor = (form: GroupFormState) =>
  form.platform === 'openai'
    ? messagesDispatchFormStateToConfig({
        allow_messages_dispatch: form.allow_messages_dispatch,
        opus_mapped_model: form.opus_mapped_model,
        sonnet_mapped_model: form.sonnet_mapped_model,
        haiku_mapped_model: form.haiku_mapped_model,
        exact_model_mappings: form.exact_model_mappings
      })
    : undefined

// v-model.number 清空输入框时产生 ""，转为 null 让后端设为无限制
const emptyToNull = (v: any) => (v === '' ? null : v)

const MEDIA_PRICE_FIELDS = [
  'image_price_1k',
  'image_price_2k',
  'image_price_4k',
  'video_price_480p',
  'video_price_720p',
  'video_price_1080p',
  'search_price_per_1k',
  'audio_realtime_price_per_min',
  'audio_tts_price_per_million_chars',
  'audio_stt_price_per_hour',
  'web_search_price_per_call'
] as const

function finalizeCommonPayload(payload: PayloadRecord, form: GroupFormState, emptyPrice: (v: any) => any) {
  delete payload.profit_min_margin_percent
  delete payload.profit_safety_buffer_percent
  payload.daily_limit_usd = emptyToNull(payload.daily_limit_usd)
  payload.weekly_limit_usd = emptyToNull(payload.weekly_limit_usd)
  payload.monthly_limit_usd = emptyToNull(payload.monthly_limit_usd)
  payload.image_rate_multiplier = normalizeRateMultiplier(payload.image_rate_multiplier)
  resetDisabledBatchImagePricing(payload as GroupFormState)
  payload.batch_image_discount_multiplier = normalizeRateMultiplier(payload.batch_image_discount_multiplier)
  payload.batch_image_hold_multiplier = normalizeRateMultiplier(payload.batch_image_hold_multiplier)
  payload.video_rate_multiplier = normalizeRateMultiplier(payload.video_rate_multiplier)
  for (const field of MEDIA_PRICE_FIELDS) {
    payload[field] = emptyPrice(payload[field])
  }
  payload.peak_rate_enabled = form.peak_rate_enabled
  payload.peak_start = form.peak_start
  payload.peak_end = form.peak_end
  payload.peak_rate_multiplier = normalizeRateMultiplier(form.peak_rate_multiplier)
}

/** 创建请求体（Vue 版 handleCreateGroup） */
export function buildCreateGroupPayload(form: GroupFormState, ctx: GroupPayloadContext): PayloadRecord {
  if (ctx.isSimpleMode) {
    return {
      name: form.name,
      description: form.description,
      i18n: form.i18n,
      platform: form.platform
    }
  }
  const { video_model_prices: _createFormVideoModelPrices, ...createGroupForm } = form
  const videoModelPrices = serializeVideoModelPrices(form.video_model_prices)
  // 构建请求数据，包含模型路由配置
  const requestData: PayloadRecord = {
    ...createGroupForm,
    force_openai_fast: normalizeGroupOpenAIFast(form.platform, form.force_openai_fast),
    free_openai_fast: normalizeGroupOpenAIFast(form.platform, form.free_openai_fast),
    model_pricing: groupPricingToAPI(form.model_pricing, form.platform),
    daily_limit_usd: normalizeOptionalLimit(form.daily_limit_usd),
    weekly_limit_usd: normalizeOptionalLimit(form.weekly_limit_usd),
    monthly_limit_usd: normalizeOptionalLimit(form.monthly_limit_usd),
    ...(Object.keys(videoModelPrices).length > 0 ? { video_model_prices: videoModelPrices } : {}),
    model_routing: convertRoutingRulesToApiFormat(ctx.routingRules),
    model_allowlist: buildModelAllowlistConfig(ctx.allowlist),
    // 创建时固定账号 manifest 固定发送关闭状态（后端创建路径禁止开启）
    codex_models_manifest_config: createCodexManifestDefaults(),
    supported_model_scopes: normalizeSupportedModelScopesForPlatform(form.platform, form.supported_model_scopes),
    messages_dispatch_model_config: messagesDispatchConfigFor(form),
    reasoning_effort_mappings: reasoningEffortMappingsToAPI(form.reasoning_effort_mappings),
    // 利润控制：界面百分比转小数提交；仅五个 token 平台可启用
    profit_control_enabled: isProfitControlPlatform(form.platform) && form.profit_control_enabled,
    profit_min_margin: profitPercentToDecimal(form.profit_min_margin_percent),
    profit_safety_buffer: profitPercentToDecimal(form.profit_safety_buffer_percent)
  }
  // 媒体价格输入清空时 v-model.number 产生 ""，直接提交会被后端 *float64 反序列化拒绝（400），
  // 创建时按"未配置"（null）处理。
  finalizeCommonPayload(requestData, form, emptyToNull)
  return requestData
}

/** 更新请求体（Vue 版 handleUpdateGroup） */
export function buildUpdateGroupPayload(
  form: GroupFormState,
  ctx: GroupPayloadContext & { codexManifest: CodexModelsManifestConfig }
): PayloadRecord {
  if (ctx.isSimpleMode) {
    return {
      name: form.name,
      description: form.description,
      i18n: form.i18n
    }
  }
  // 转换 fallback_group_id: null -> 0 (后端使用 0 表示清除)
  const payload: PayloadRecord = {
    ...form,
    force_openai_fast: normalizeGroupOpenAIFast(form.platform, form.force_openai_fast),
    free_openai_fast: normalizeGroupOpenAIFast(form.platform, form.free_openai_fast),
    model_pricing: groupPricingToAPI(form.model_pricing, form.platform),
    daily_limit_usd: normalizeOptionalLimit(form.daily_limit_usd),
    weekly_limit_usd: normalizeOptionalLimit(form.weekly_limit_usd),
    monthly_limit_usd: normalizeOptionalLimit(form.monthly_limit_usd),
    video_model_prices: serializeVideoModelPrices(form.video_model_prices),
    fallback_group_id: form.fallback_group_id === null ? 0 : form.fallback_group_id,
    fallback_group_id_on_invalid_request:
      form.fallback_group_id_on_invalid_request === null ? 0 : form.fallback_group_id_on_invalid_request,
    model_routing: convertRoutingRulesToApiFormat(ctx.routingRules),
    model_allowlist: buildModelAllowlistConfig(ctx.allowlist),
    // 非 openai 平台提交关闭状态，与后端归一化一致
    codex_models_manifest_config:
      form.platform === 'openai'
        ? {
            enabled: ctx.codexManifest.enabled,
            account_ids: [...ctx.codexManifest.account_ids],
            fallback_to_scheduler: ctx.codexManifest.fallback_to_scheduler
          }
        : createCodexManifestDefaults(),
    supported_model_scopes: normalizeSupportedModelScopesForPlatform(form.platform, form.supported_model_scopes),
    messages_dispatch_model_config: messagesDispatchConfigFor(form),
    reasoning_effort_mappings: reasoningEffortMappingsToAPI(form.reasoning_effort_mappings),
    // 利润控制：界面百分比转小数提交；仅五个 token 平台可启用
    profit_control_enabled: isProfitControlPlatform(form.platform) && form.profit_control_enabled,
    profit_min_margin: profitPercentToDecimal(form.profit_min_margin_percent),
    profit_safety_buffer: profitPercentToDecimal(form.profit_safety_buffer_percent)
  }
  // 媒体价格输入清空时 v-model.number 产生 ""，直接提交会被后端 *float64 反序列化拒绝（400）。
  // 更新语义中 null 表示"不修改"，因此清空后的字段发送 -1：后端 normalizePrice 将负价归一为
  // NULL，从而真正清除已配置的价格。
  const emptyPriceToClear = (v: any) => (v === '' || v === null ? -1 : v)
  finalizeCommonPayload(payload, form, emptyPriceToClear)
  return payload
}
