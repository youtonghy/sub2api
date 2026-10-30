// 风控页（RiskControlView）的表单模型与纯函数，从 Vue 版 RiskControlView.vue 的 <script setup> 抽出。
import type {
  ContentModerationAPIKeyStatus,
  ContentModerationConfig,
  ContentModerationModelFilter,
  ContentModerationModelFilterType,
  KeywordBlockingMode,
  ModerationEngine,
  ModerationMode,
  UpdateModerationEngineConfig
} from '@/api/admin/riskControl'

export type SettingsTab = 'basic' | 'scope' | 'runtime' | 'response' | 'riskThresholds' | 'retention' | 'keywords'
export type WorkerSlotState = 'active' | 'idle' | 'disabled'
export type APIKeysWriteMode = 'append' | 'replace'
/** v-model.number：输入框清空时为空串 */
export type NumberInput = number | ''

export const maxModerationTestImages = 1
export const maxModerationTestImageSize = 8 * 1024 * 1024
export const maxVisibleApiKeyRows: number = 3
export const blockedKeywordMax = 10000
export const riskThresholdDefaults: Record<string, number> = {
  harassment: 98,
  'harassment/threatening': 90,
  hate: 65,
  'hate/threatening': 65,
  illicit: 95,
  'illicit/violent': 95,
  'self-harm': 65,
  'self-harm/intent': 85,
  'self-harm/instructions': 65,
  sexual: 65,
  'sexual/minors': 65,
  violence: 95,
  'violence/graphic': 95
}
export const riskThresholdCategories = Object.keys(riskThresholdDefaults)

export const engineOptions = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'typesafe', label: 'TypeSafe AI' }
]
export const engineLabel = (engine: ModerationEngine) => (engine === 'typesafe' ? 'TypeSafe AI' : 'OpenAI')

export interface ConfigForm {
  engine: ModerationEngine
  enabled: boolean
  mode: ModerationMode
  base_url: string
  model: string
  proxy_id: number | null
  api_keys_text: string
  api_key_configured: boolean
  api_key_masked: string
  api_key_count: number
  api_key_masks: string[]
  api_key_statuses: ContentModerationAPIKeyStatus[]
  api_keys_mode: APIKeysWriteMode
  clear_api_key: boolean
  timeout_ms: NumberInput
  retry_count: NumberInput
  sample_rate: NumberInput
  all_groups: boolean
  group_ids: number[]
  record_non_hits: boolean
  worker_count: NumberInput
  queue_size: NumberInput
  block_status: NumberInput
  block_message: string
  email_on_hit: boolean
  auto_ban_enabled: boolean
  cyber_policy_exclude_from_ban_count: boolean
  ban_threshold: NumberInput
  violation_window_hours: NumberInput
  hit_retention_days: NumberInput
  non_hit_retention_days: NumberInput
  pre_hash_check_enabled: boolean
  thresholds: Record<string, NumberInput>
  blocked_keywords_text: string
  keyword_blocking_mode: KeywordBlockingMode
  model_filter_type: ContentModerationModelFilterType
  model_filter_models: string[]
}

export const defaultConfigForm = (blockMessage: string): ConfigForm => ({
  engine: 'openai',
  enabled: false,
  mode: 'pre_block',
  base_url: 'https://api.openai.com',
  model: 'omni-moderation-latest',
  proxy_id: null,
  api_keys_text: '',
  api_key_configured: false,
  api_key_masked: '',
  api_key_count: 0,
  api_key_masks: [],
  api_key_statuses: [],
  api_keys_mode: 'append',
  clear_api_key: false,
  timeout_ms: 3000,
  retry_count: 2,
  sample_rate: 100,
  all_groups: true,
  group_ids: [],
  record_non_hits: false,
  worker_count: 4,
  queue_size: 32768,
  block_status: 403,
  block_message: blockMessage,
  email_on_hit: true,
  auto_ban_enabled: true,
  cyber_policy_exclude_from_ban_count: false,
  ban_threshold: 10,
  violation_window_hours: 720,
  hit_retention_days: 180,
  non_hit_retention_days: 3,
  pre_hash_check_enabled: false,
  thresholds: { ...riskThresholdDefaults },
  blocked_keywords_text: '',
  keyword_blocking_mode: 'keyword_and_api',
  model_filter_type: 'all',
  model_filter_models: []
})

export const engineFields = [
  'base_url',
  'model',
  'proxy_id',
  'api_keys_text',
  'api_key_configured',
  'api_key_masked',
  'api_key_count',
  'api_key_masks',
  'api_key_statuses',
  'api_keys_mode',
  'clear_api_key',
  'timeout_ms',
  'retry_count',
  'thresholds'
] as const
export type EngineDraft = Pick<ConfigForm, (typeof engineFields)[number]> & { pendingDeletes: string[] }

export function captureEngineDraft(form: ConfigForm, pendingDeletes: string[]): EngineDraft {
  return structuredClone({
    ...Object.fromEntries(engineFields.map((key) => [key, form[key]])),
    pendingDeletes: [...pendingDeletes]
  }) as EngineDraft
}

export function engineDraftFromConfig(config: ContentModerationConfig | undefined, engine: ModerationEngine): EngineDraft {
  return {
    base_url: config?.base_url || (engine === 'typesafe' ? 'https://api.typesafe.ai' : 'https://api.openai.com'),
    model: config?.model || (engine === 'typesafe' ? 'jev-latest' : 'omni-moderation-latest'),
    proxy_id: config?.proxy_id ?? null,
    api_keys_text: '',
    api_key_configured: config?.api_key_configured ?? false,
    api_key_masked: config?.api_key_masked ?? '',
    api_key_count: config?.api_key_count ?? 0,
    api_key_masks: [...(config?.api_key_masks ?? [])],
    api_key_statuses: [...(config?.api_key_statuses ?? [])],
    api_keys_mode: 'append',
    clear_api_key: false,
    pendingDeletes: [],
    timeout_ms: config?.timeout_ms ?? 3000,
    retry_count: config?.retry_count ?? 2,
    thresholds: riskThresholdsFromConfig(config?.thresholds)
  }
}

export function engineDraftPayload(draft: EngineDraft): UpdateModerationEngineConfig {
  const keys = parseApiKeys(draft.api_keys_text)
  if (!draft.clear_api_key && draft.api_keys_mode === 'replace' && keys.length === 0) throw new Error('empty replacement keys')
  return {
    base_url: draft.base_url,
    model: draft.model,
    proxy_id: draft.proxy_id ?? 0,
    timeout_ms: draft.timeout_ms as number,
    retry_count: draft.retry_count as number,
    thresholds: Object.fromEntries(riskThresholdCategories.map((k) => [k, clampPercent(draft.thresholds[k]) / 100])),
    clear_api_key: draft.clear_api_key,
    api_keys: keys.length ? keys : undefined,
    api_keys_mode: draft.api_keys_mode,
    delete_api_key_hashes: draft.pendingDeletes
  }
}

/** 把草稿字段（不含 pendingDeletes）合并回表单 */
export function applyEngineDraft(form: ConfigForm, draft: EngineDraft): { form: ConfigForm; pendingDeletes: string[] } {
  const { pendingDeletes, ...fields } = structuredClone(draft)
  return { form: { ...form, ...fields }, pendingDeletes }
}

export function parseApiKeys(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item, index, arr) => item && arr.indexOf(item) === index)
}

export function normalizeKeywordBlockingMode(value: unknown): KeywordBlockingMode {
  if (value === 'keyword_only' || value === 'api_only' || value === 'keyword_and_api') {
    return value
  }
  return 'keyword_and_api'
}

export function normalizeModelFilterType(value: unknown): ContentModerationModelFilterType {
  if (value === 'include' || value === 'exclude' || value === 'all') {
    return value
  }
  return 'all'
}

export function normalizeModelNames(models: unknown): string[] {
  if (!Array.isArray(models)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of models) {
    const model = String(item ?? '').trim()
    if (!model) continue
    const key = model.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(model)
  }
  return out
}

export function normalizeModelFilter(value: unknown): ContentModerationModelFilter {
  if (!value || typeof value !== 'object') {
    return { type: 'all', models: [] }
  }
  const raw = value as Partial<ContentModerationModelFilter>
  const type = normalizeModelFilterType(raw.type)
  const models = type === 'all' ? [] : normalizeModelNames(raw.models)
  return { type, models }
}

export function buildModelFilterPayload(form: Pick<ConfigForm, 'model_filter_type' | 'model_filter_models'>): ContentModerationModelFilter {
  const type = normalizeModelFilterType(form.model_filter_type)
  if (type === 'all') {
    return { type: 'all', models: [] }
  }
  return {
    type,
    models: normalizeModelNames(form.model_filter_models)
  }
}

export function clampPercent(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 0
  }
  return Math.min(100, Math.max(0, numeric))
}

export function riskThresholdsFromConfig(thresholds: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = { ...riskThresholdDefaults }
  for (const category of riskThresholdCategories) {
    const value = thresholds?.[category]
    if (Number.isFinite(value)) {
      out[category] = clampPercent(Number(value) * 100)
    }
  }
  return out
}

export function buildRiskThresholdPayload(thresholds: Record<string, NumberInput>): Record<string, number> {
  const payload: Record<string, number> = {}
  for (const category of riskThresholdCategories) {
    payload[category] = Number((clampPercent(thresholds[category]) / 100).toFixed(4))
  }
  return payload
}

export function formatThresholdPercent(value: NumberInput): string {
  return `${clampPercent(value).toFixed(1)}%`
}

export function parseBlockedKeywords(value: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of value.split(/\r?\n/)) {
    const kw = line.trim()
    if (!kw) continue
    const key = kw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(kw)
  }
  return out
}

export function percent(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return `${(value * 100).toFixed(1)}%`
}

export function percentWidth(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return `${Math.min(100, Math.max(0, value * 100)).toFixed(1)}%`
}

export function latencyText(value: number | null): string {
  if (value === null || value === undefined) return '-'
  return `${value} ms`
}

export function apiKeyRowKey(row: ContentModerationAPIKeyStatus, index: number): string {
  return `${row.configured ? 'saved' : 'test'}-${row.key_hash || index}`
}

export function normalizeDateTimeLocal(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** v-model.number：空串保持空串，可解析时转为数字 */
export const toNumberInput = (raw: string): NumberInput => {
  if (raw === '') return ''
  const parsed = Number(raw)
  return Number.isNaN(parsed) ? '' : parsed
}
