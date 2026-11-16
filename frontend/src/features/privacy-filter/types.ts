/** 隐私过滤的配置、状态与命中记录类型，与后端 /admin/privacy-filter 与 /privacy-filter 接口对应。 */

export type PrivacyFilterMode = 'off' | 'observe' | 'redact' | 'restore'

export type PrivacyFilterCategory =
  | 'private_key'
  | 'public_key'
  | 'credential'
  | 'financial'
  | 'identity'
  | 'proxy'
  | 'email'
  | 'ip'

export const PRIVACY_FILTER_CATEGORIES: PrivacyFilterCategory[] = [
  'private_key',
  'public_key',
  'credential',
  'financial',
  'identity',
  'proxy',
  'email',
  'ip'
]

/** 记录的处理方式：模式名，或 failed（过滤失败、请求已被拒绝） */
export type PrivacyFilterEventAction = 'observe' | 'redact' | 'restore' | 'failed'

export const PRIVACY_FILTER_EVENT_ACTIONS: PrivacyFilterEventAction[] = ['observe', 'redact', 'restore', 'failed']

export interface PrivacyFilterConfig {
  mode: PrivacyFilterMode
  group_ids: number[]
  categories: PrivacyFilterCategory[]
}

export interface PrivacyFilterStatus {
  scanned_requests: number
  hit_requests: number
  redacted_requests: number
  failed_requests: number
  fields: number
  restored_tokens: number
  unresolved_tokens: number
  category_counts: Partial<Record<PrivacyFilterCategory, number>>
  started_at: string
  dropped_events: number
  failed_event_writes: number
}

/** 一条命中记录。只含类别与次数，不含命中的原文。用户接口不返回用户、分组、端点和请求 ID。 */
export interface PrivacyFilterEvent {
  id: number
  created_at: string
  api_key_id?: number
  api_key_name: string
  model: string
  action: PrivacyFilterEventAction
  fields: number
  total_hits: number
  categories: Partial<Record<PrivacyFilterCategory, number>>
  request_id?: string
  user_id?: number
  user_email?: string
  group_id?: number
  group_name?: string
  endpoint?: string
  protocol?: string
}

export interface PrivacyFilterEventQuery {
  start_date?: string
  end_date?: string
  action?: PrivacyFilterEventAction | ''
  category?: PrivacyFilterCategory | ''
  api_key_id?: number | null
  group_id?: number | null
  request_id?: string
  q?: string
}
