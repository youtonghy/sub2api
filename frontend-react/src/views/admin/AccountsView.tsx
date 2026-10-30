/**
 * 账号管理页，对应 Vue 版 views/admin/AccountsView.vue。
 *
 * 与 Vue 版行为一致：lite=1 紧凑列表、服务端排序、列显隐（含一次性迁移）、筛选持久化、自动刷新（ETag 增量合并、
 * 静默窗口、弹窗打开时暂停）、今日统计与失败热力图批量拉取、用量批量拉取（桌面端）、上游计费倍率刷新与探测、
 * 行内拖动排序、滑动多选、选择全部结果、批量操作、导入导出（step-up 二次验证）、CRS 同步、定时测试与统计视图。
 *
 * 实现说明：Vue 版在异步流程中随时读取最新的响应式值；这里把这些值放在 live ref 中（每次渲染后同步，
 * 本地写入时立即更新），事件处理与定时器始终读取最新状态。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import {
  Check,
  ChevronDown,
  Columns3,
  Download,
  GripVertical,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Shield,
  SortAsc,
  Trash2,
  Upload
} from 'lucide-react'

import { adminAPI } from '@/api/admin'
import type { AccountHourlyFailureResponse } from '@/api/admin/ops'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Switch } from '@/components/arc/switch/switch'
import {
  AccountFailureHeatmap,
  BulkEditAccountModal,
  CreateAccountModal,
  EditAccountModal,
  SyncFromCrsModal,
  TempUnschedStatusModal,
  type BulkEditTarget
} from '@/components/account'
import AccountCapacityCell from '@/components/account/AccountCapacityCell'
import AccountGroupsCell from '@/components/account/AccountGroupsCell'
import AccountPriorityCell from '@/components/account/AccountPriorityCell'
import AccountSortOrderModal from '@/components/account/AccountSortOrderModal'
import AccountStatusIndicator from '@/components/account/AccountStatusIndicator'
import AccountTodayStatsCell from '@/components/account/AccountTodayStatsCell'
import AccountUsageCell from '@/components/account/AccountUsageCell'
import UpstreamBillingRateCell from '@/components/account/UpstreamBillingRateCell'
import ErrorPassthroughRulesModal from '@/components/admin/ErrorPassthroughRulesModal'
import TLSFingerprintProfilesModal from '@/components/admin/TLSFingerprintProfilesModal'
import AccountActionMenu from '@/components/admin/account/AccountActionMenu'
import AccountBulkActionsBar from '@/components/admin/account/AccountBulkActionsBar'
import AccountModelTestPanel from '@/components/admin/account/AccountModelTestPanel'
import AccountStatisticsTable from '@/components/admin/account/AccountStatisticsTable'
import AccountStatsModal from '@/components/admin/account/AccountStatsModal'
import AccountTableActions from '@/components/admin/account/AccountTableActions'
import AccountTableFilters from '@/components/admin/account/AccountTableFilters'
import AccountTestModal from '@/components/admin/account/AccountTestModal'
import ImportDataModal from '@/components/admin/account/ImportDataModal'
import ReAuthAccountModal from '@/components/admin/account/ReAuthAccountModal'
import ScheduledTestsPanel from '@/components/admin/account/ScheduledTestsPanel'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import DataTable, { type DataTableCellContext, type DataTableHandle, type DataTableHeaderContext } from '@/components/common/DataTable'
import HelpTooltip from '@/components/common/HelpTooltip'
import Pagination from '@/components/common/Pagination'
import PlatformTypeBadge from '@/components/common/PlatformTypeBadge'
import type { SelectOption } from '@/components/common/Select'
import TablePageLayout from '@/components/common/TablePageLayout'
import type { Column } from '@/components/common/types'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { usePriorityDrag } from '@/composables/usePriorityDrag'
import { isStepUpBlocked, isStepUpCancelled, stepUpBlockReason, useStepUp } from '@/composables/useStepUp'
import { useSwipeSelect, type SwipeSelectVirtualContext } from '@/composables/useSwipeSelect'
import { useTableLoader, type PaginationState } from '@/composables/useTableLoader'
import { useTableSelection } from '@/composables/useTableSelection'
import { CONCRETE_PLATFORM_OPTIONS } from '@/constants/platforms'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type {
  Account,
  AccountListItem,
  AccountPlatform,
  AccountSchedulerGroupScore,
  AccountType,
  AccountUsageInfo,
  AdminGroup,
  ClaudeModel,
  Proxy as AccountProxy,
  UpstreamBillingProbeSnapshot,
  WindowStats
} from '@/types'
import { fetchAllAccountIds } from '@/utils/accountSelection'
import { computeDropPriority } from '@/utils/accountPriorityOrder'
import { buildGrokUsageRefreshKey, buildOpenAIUsageRefreshKey } from '@/utils/accountUsageRefresh'
import { extractApiErrorMessage } from '@/utils/apiError'
import { formatDateTime, formatRelativeTime } from '@/utils/format'
import { formatMultiplier } from '@/utils/formatters'
import { proxyExpiryBadgeClass, proxyExpiryLabelKey } from '@/utils/proxyExpiry'
import { sanitizeUrl } from '@/utils/url'
import styles from './AccountsView.module.css'

// ==================== 常量与本地存储 ====================

const DEFAULT_HIDDEN_COLUMNS = ['today_stats', 'proxy', 'notes', 'scheduler_score', 'rate_multiplier']
const HIDDEN_COLUMNS_KEY = 'account-hidden-columns'
// One-time migration: hide scheduler score for existing admins too, because showing it opt-ins to heavy backend scoring.
const HIDDEN_COLUMNS_VERSION_KEY = 'account-hidden-columns-version'
const HIDDEN_COLUMNS_CURRENT_VERSION = 'scheduler-score-hidden-by-default'

// Account filter settings
const ACCOUNT_FILTER_STORAGE_KEY = 'account-filter-values'
type AccountFilterValues = {
  platform: string
  status: string
}

// Sorting settings
const ACCOUNT_SORT_STORAGE_KEY = 'account-table-sort'
type AccountSortOrder = 'asc' | 'desc'
type AccountSortState = {
  sort_by: string
  sort_order: AccountSortOrder
}
const ACCOUNT_SORTABLE_KEYS = new Set([
  'id',
  'name',
  'status',
  'schedulable',
  'priority',
  'rate_multiplier',
  'upstream_billing_rate',
  'last_used_at',
  'created_at',
  'expires_at'
])

// Auto refresh settings
const AUTO_REFRESH_STORAGE_KEY = 'account-auto-refresh'
const autoRefreshIntervals = [5, 10, 15, 30] as const
type AutoRefreshInterval = (typeof autoRefreshIntervals)[number]
const AUTO_REFRESH_SILENT_WINDOW_MS = 15000

const USAGE_BATCH_CACHE_TTL = 5 * 60 * 1000
const desktopViewportQuery = '(min-width: 768px)'

const ACCOUNT_UNGROUPED_GROUP_QUERY_VALUE = 'ungrouped'
const ACCOUNT_PRIVACY_MODE_UNSET_QUERY_VALUE = '__unset__'

type AccountView = 'list' | 'statistics' | 'failures' | 'test'

type AccountBulkEditTarget =
  | {
      mode: 'selected'
      accountIds: number[]
      selectedPlatforms: AccountPlatform[]
      selectedTypes: AccountType[]
    }
  | {
      mode: 'filtered'
      filters: {
        platform?: string
        model?: string
        type?: string
        status?: string
        group?: string
        search?: string
        privacy_mode?: string
        sort_by?: string
        sort_order?: AccountSortOrder
      }
      previewCount: number
      selectedPlatforms: AccountPlatform[]
      selectedTypes: AccountType[]
    }

type UsageBatchState = {
  usage: Record<string, AccountUsageInfo | null>
  errors: Record<string, string | null>
  loading: Record<string, boolean>
}

type MenuState = { show: boolean; acc: Account | null; anchorRect: DOMRect | null }

const loadInitialAccountFilterValues = (): AccountFilterValues => {
  const fallback: AccountFilterValues = { platform: '', status: '' }
  try {
    const raw = localStorage.getItem(ACCOUNT_FILTER_STORAGE_KEY)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback
    const values = parsed as Record<string, unknown>
    return {
      platform:
        typeof values.platform === 'string' && CONCRETE_PLATFORM_OPTIONS.some((option) => option.value === values.platform)
          ? values.platform
          : '',
      status:
        typeof values.status === 'string' &&
        ['active', 'inactive', 'error', 'rate_limited', 'temp_unschedulable', 'unschedulable'].includes(values.status)
          ? values.status
          : ''
    }
  } catch {
    return fallback
  }
}

const loadInitialAccountSortState = (): AccountSortState => {
  // 账号列表默认按优先级升序：用户看到的第一行就是最先被调度的账号，
  // 优先级列展示的位次也因此与列表顺序一致。
  const fallback: AccountSortState = { sort_by: 'priority', sort_order: 'asc' }
  try {
    const raw = localStorage.getItem(ACCOUNT_SORT_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { key?: string; order?: string }
    const key = typeof parsed.key === 'string' ? parsed.key : ''
    if (!ACCOUNT_SORTABLE_KEYS.has(key)) return fallback
    return {
      sort_by: key,
      sort_order: parsed.order === 'desc' ? 'desc' : 'asc'
    }
  } catch {
    return fallback
  }
}

const loadSavedColumns = (): Set<string> => {
  const hiddenColumns = new Set<string>()
  try {
    const saved = localStorage.getItem(HIDDEN_COLUMNS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      parsed.forEach((key) => {
        hiddenColumns.add(key)
      })
      // Older saved column layouts may have scheduler_score visible; migrate them to the new safe default once.
      if (localStorage.getItem(HIDDEN_COLUMNS_VERSION_KEY) !== HIDDEN_COLUMNS_CURRENT_VERSION) {
        hiddenColumns.add('scheduler_score')
        localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...hiddenColumns]))
        localStorage.setItem(HIDDEN_COLUMNS_VERSION_KEY, HIDDEN_COLUMNS_CURRENT_VERSION)
      }
    } else {
      DEFAULT_HIDDEN_COLUMNS.forEach((key) => {
        hiddenColumns.add(key)
      })
      localStorage.setItem(HIDDEN_COLUMNS_VERSION_KEY, HIDDEN_COLUMNS_CURRENT_VERSION)
    }
  } catch (e) {
    console.error('Failed to load saved columns:', e)
    DEFAULT_HIDDEN_COLUMNS.forEach((key) => {
      hiddenColumns.add(key)
    })
  }
  return hiddenColumns
}

const saveColumnsToStorage = (hiddenColumns: Set<string>) => {
  try {
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...hiddenColumns]))
    localStorage.setItem(HIDDEN_COLUMNS_VERSION_KEY, HIDDEN_COLUMNS_CURRENT_VERSION)
  } catch (e) {
    console.error('Failed to save columns:', e)
  }
}

const loadSavedAutoRefresh = (): { enabled: boolean; interval: AutoRefreshInterval } => {
  const result: { enabled: boolean; interval: AutoRefreshInterval } = { enabled: false, interval: 30 }
  try {
    const saved = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY)
    if (!saved) return result
    const parsed = JSON.parse(saved) as { enabled?: boolean; interval_seconds?: number }
    result.enabled = parsed.enabled === true
    const interval = Number(parsed.interval_seconds)
    if (autoRefreshIntervals.includes(interval as AutoRefreshInterval)) {
      result.interval = interval as AutoRefreshInterval
    }
  } catch (e) {
    console.error('Failed to load saved auto refresh settings:', e)
  }
  return result
}

const saveAutoRefreshToStorage = (enabled: boolean, interval: AutoRefreshInterval) => {
  try {
    localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, JSON.stringify({ enabled, interval_seconds: interval }))
  } catch (e) {
    console.error('Failed to save auto refresh settings:', e)
  }
}

const buildDefaultTodayStats = (): WindowStats => ({
  requests: 0,
  tokens: 0,
  input_tokens: 0,
  cache_read_tokens: 0,
  cost: 0,
  standard_cost: 0,
  user_cost: 0,
  average_first_token_ms: 0
})

const accountSupportsBatchUsage = (account: Account) => {
  if (account.platform === 'anthropic') {
    return account.type === 'oauth' || account.type === 'setup-token'
  }
  if (account.platform === 'gemini') return true
  if (account.platform === 'antigravity') return account.type === 'oauth'
  if (account.platform === 'openai') return account.type === 'oauth'
  if (account.platform === 'grok') return account.type === 'oauth'
  return false
}

const formatSchedulerScore = (value: unknown): string => {
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return num.toFixed(6).replace(/\.?0+$/, '')
}

const formatStickySchedulerScore = (score: AccountSchedulerGroupScore): string => {
  if (!score) return '-'
  if (score.sticky_score_infinity) return '+∞'
  return formatSchedulerScore(score.sticky_score)
}

const getSchedulerScoreRows = (account: Account): AccountSchedulerGroupScore[] => {
  const groupRows = Array.isArray(account.scheduler_scores)
    ? account.scheduler_scores.filter((score) => score.group_id != null)
    : []
  if (groupRows.length) return groupRows
  // 未分组账号没有分组维度分数，回退展示后端返回的基础分
  if (account.scheduler_score) {
    return [{ group_id: null, ...account.scheduler_score } as AccountSchedulerGroupScore]
  }
  return []
}

const GROK_QUOTA_SIGNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000
const GROK_QUOTA_SIGNAL_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

function firstNonBlankString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function normalizeGrokPlanKey(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function grokPersistedQuotaSnapshot(extra: Record<string, any>): Record<string, any> | undefined {
  const usage = extra.grok_usage_snapshot
  if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
    return usage as Record<string, any>
  }
  const legacy = extra.grok_quota_snapshot
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    return legacy as Record<string, any>
  }
  return undefined
}

function isGrokQuotaTimestampFresh(raw: unknown): boolean {
  const value = String(raw || '').trim()
  if (!value) return false
  const observedAt = Date.parse(value)
  if (!Number.isFinite(observedAt)) return false
  const age = Date.now() - observedAt
  return age <= GROK_QUOTA_SIGNAL_MAX_AGE_MS && age >= -GROK_QUOTA_SIGNAL_MAX_FUTURE_SKEW_MS
}

function isGrok45ResponsesQuotaModel(model: unknown): boolean {
  const value = String(model || '')
    .trim()
    .toLowerCase()
    .replace(/^(x-ai|xai)\//, '')
  return value === 'grok-4.5' || value.startsWith('grok-4.5-')
}

function grokQuotaLooksHeavy(snapshot: Record<string, any> | undefined): boolean {
  const req = Number(snapshot?.requests?.limit ?? 0)
  const tok = Number(snapshot?.tokens?.limit ?? 0)
  return req >= 8300 || tok >= 53_000_000
}

function grok45ResponsesPlanIsHeavy(snapshot: Record<string, any> | undefined): boolean {
  if (!snapshot) return false
  const hint = normalizeGrokPlanKey(snapshot.plan_from_45_responses)
  if (hint === 'supergrokheavy' && isGrokQuotaTimestampFresh(snapshot.plan_from_45_responses_at)) {
    return true
  }
  const observedAt = snapshot.last_headers_seen_at || snapshot.updated_at
  return isGrok45ResponsesQuotaModel(snapshot.model) && isGrokQuotaTimestampFresh(observedAt) && grokQuotaLooksHeavy(snapshot)
}

// JWT / unambiguous credentials outrank snapshots. SuperGrokPro is ambiguous
// (covers SuperGrok and Heavy). 8300/53M only upgrades when the window came
// from grok-4.5 Responses (or a carried 4.5 hint).
function getAccountPlanType(row: any): string | undefined {
  if (!row) return undefined
  if (row.platform === 'grok') {
    const extra = (row.extra || {}) as Record<string, any>
    const billing = extra.grok_billing_snapshot as Record<string, any> | undefined
    const usage = extra.grok_usage_snapshot as Record<string, any> | undefined
    const legacyQuota = extra.grok_quota_snapshot as Record<string, any> | undefined
    const quota = grokPersistedQuotaSnapshot(extra)
    const cred = firstNonBlankString(row.credentials?.subscription_tier)
    const credKey = normalizeGrokPlanKey(cred)
    if (credKey && credKey !== 'supergrokpro') {
      return cred
    }
    if (
      grok45ResponsesPlanIsHeavy(quota) &&
      (credKey === 'supergrokpro' ||
        normalizeGrokPlanKey(billing?.plan) === 'supergrok' ||
        normalizeGrokPlanKey(billing?.plan) === 'supergrokpro')
    ) {
      return 'SuperGrok Heavy'
    }
    if (credKey === 'supergrokpro') {
      return firstNonBlankString(billing?.plan) || 'SuperGrok'
    }
    return firstNonBlankString(
      billing?.plan,
      usage?.subscription_tier,
      legacyQuota?.subscription_tier,
      extra.subscription_tier,
      row.credentials?.plan_type,
      row.parent_plan_type
    )
  }
  return firstNonBlankString(row.credentials?.plan_type, row.parent_plan_type)
}

function getOpenAIAuthMode(row: any): string | undefined {
  if (!row || row.platform !== 'openai' || row.type !== 'oauth') return undefined
  const authMode = row.credentials?.auth_mode
  return typeof authMode === 'string' && authMode.trim() ? authMode : undefined
}

// Antigravity 订阅等级辅助函数
function getAntigravityTierFromRow(row: any): string | null {
  if (row.platform !== 'antigravity') return null
  const extra = row.extra as Record<string, unknown> | undefined
  if (!extra) return null
  const lca = extra.load_code_assist as Record<string, unknown> | undefined
  if (!lca) return null
  const paid = lca.paidTier as Record<string, unknown> | undefined
  if (paid && typeof paid.id === 'string') return paid.id
  const current = lca.currentTier as Record<string, unknown> | undefined
  if (current && typeof current.id === 'string') return current.id
  return null
}

const antigravityTierTone = (tier: string | null): BadgeTone => {
  switch (tier) {
    case 'g1-pro-tier':
      return 'info'
    case 'g1-ultra-tier':
      return 'success'
    default:
      return 'neutral'
  }
}

// 账号显示邮箱:优先账号自身(extra/credentials),影子账号回退母账号 parent_email。
// 供名称单元格条件/标题/文本三处共用,避免同一回退链重复三次。
function accountDisplayEmail(row: any): string {
  return row.extra?.email_address || row.extra?.email || row.credentials?.email || row.parent_email || ''
}

function accountHomepageUrl(row: Account): string {
  if (row.type !== 'apikey' || typeof row.credentials?.base_url !== 'string') return ''
  const baseUrl = sanitizeUrl(row.credentials.base_url)
  return baseUrl ? new URL(baseUrl).origin : ''
}

type OpenAICompactBadgeState = 'active' | 'blocked' | 'auto'

function getOpenAICompactState(row: any): OpenAICompactBadgeState | null {
  if (row.platform !== 'openai' || (row.type !== 'oauth' && row.type !== 'apikey')) return null
  const extra = row.extra as Record<string, unknown> | undefined
  const mode = typeof extra?.openai_compact_mode === 'string' ? extra.openai_compact_mode : 'auto'
  if (mode === 'force_on') return 'active'
  if (mode === 'force_off') return 'blocked'
  if (typeof extra?.openai_compact_supported === 'boolean') {
    return extra.openai_compact_supported ? 'active' : 'blocked'
  }
  return 'auto'
}

const formatExpiresAt = (value: number | null) => {
  if (!value) return '-'
  return formatDateTime(
    new Date(value * 1000),
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    },
    'sv-SE'
  )
}

const isExpired = (value: number | null) => {
  if (!value) return false
  return value * 1000 <= Date.now()
}

// 所绑定代理的有效期(逻辑同 /admin/proxies,见 utils/proxyExpiry)：把共享工具返回的样式类映射为 Arc badge 色调
const proxyExpiryTone = (p: AccountProxy): BadgeTone | null => {
  const cls = proxyExpiryBadgeClass(p.expires_at, p.status)
  if (cls.includes('badge-danger')) return 'danger'
  if (cls.includes('badge-warning')) return 'warning'
  return null
}

const formatExportTimestamp = () => {
  const now = new Date()
  const pad2 = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
}

const sameAccountIDOrder = (left: number[], right: number[]) =>
  left.length === right.length && left.every((id, index) => id === right[index])

const shouldReplaceAutoRefreshRow = (current: Account, next: Account) => {
  return (
    current.updated_at !== next.updated_at ||
    current.current_concurrency !== next.current_concurrency ||
    current.current_window_cost !== next.current_window_cost ||
    current.active_sessions !== next.active_sessions ||
    current.schedulable !== next.schedulable ||
    current.status !== next.status ||
    current.rate_limit_reset_at !== next.rate_limit_reset_at ||
    current.overload_until !== next.overload_until ||
    current.temp_unschedulable_until !== next.temp_unschedulable_until ||
    buildOpenAIUsageRefreshKey(current) !== buildOpenAIUsageRefreshKey(next) ||
    buildGrokUsageRefreshKey(current) !== buildGrokUsageRefreshKey(next)
  )
}

const mergeRuntimeFields = (oldAccount: Account, updatedAccount: Account): Account => ({
  ...updatedAccount,
  current_concurrency: updatedAccount.current_concurrency ?? oldAccount.current_concurrency,
  current_window_cost: updatedAccount.current_window_cost ?? oldAccount.current_window_cost,
  active_sessions: updatedAccount.active_sessions ?? oldAccount.active_sessions
})

const normalizeBulkSchedulableResult = (
  result: {
    success?: number
    failed?: number
    success_ids?: number[]
    failed_ids?: number[]
    results?: Array<{ account_id: number; success: boolean }>
  },
  accountIds: number[]
) => {
  const responseSuccessIds = Array.isArray(result.success_ids) ? result.success_ids : []
  const responseFailedIds = Array.isArray(result.failed_ids) ? result.failed_ids : []
  if (responseSuccessIds.length > 0 || responseFailedIds.length > 0) {
    return {
      successIds: responseSuccessIds,
      failedIds: responseFailedIds,
      successCount: typeof result.success === 'number' ? result.success : responseSuccessIds.length,
      failedCount: typeof result.failed === 'number' ? result.failed : responseFailedIds.length,
      hasIds: true,
      hasCounts: true
    }
  }

  const results = Array.isArray(result.results) ? result.results : []
  if (results.length > 0) {
    const successIds = results.filter((item) => item.success).map((item) => item.account_id)
    const failedIds = results.filter((item) => !item.success).map((item) => item.account_id)
    return {
      successIds,
      failedIds,
      successCount: typeof result.success === 'number' ? result.success : successIds.length,
      failedCount: typeof result.failed === 'number' ? result.failed : failedIds.length,
      hasIds: true,
      hasCounts: true
    }
  }

  const hasExplicitCounts = typeof result.success === 'number' || typeof result.failed === 'number'
  const successCount = typeof result.success === 'number' ? result.success : 0
  const failedCount = typeof result.failed === 'number' ? result.failed : 0
  if (hasExplicitCounts && failedCount === 0 && successCount === accountIds.length && accountIds.length > 0) {
    return {
      successIds: accountIds,
      failedIds: [],
      successCount,
      failedCount,
      hasIds: true,
      hasCounts: true
    }
  }

  return {
    successIds: [],
    failedIds: [],
    successCount,
    failedCount,
    hasIds: false,
    hasCounts: hasExplicitCounts
  }
}

const isAbortLike = (error: unknown) => {
  const refreshError = error as { name?: string; code?: string }
  return refreshError?.name === 'AbortError' || refreshError?.name === 'CanceledError' || refreshError?.code === 'ERR_CANCELED'
}

const subscribeDesktopViewport = (notify: () => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(desktopViewportQuery)
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', notify)
    return () => query.removeEventListener('change', notify)
  }
  query.addListener(notify)
  return () => query.removeListener(notify)
}
const readDesktopViewport = () =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? true : window.matchMedia(desktopViewportQuery).matches

const iconProps = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

// 只在事件处理、定时器与异步流程中调用（不在渲染期间读取时间）
const currentTime = () => Date.now()

// ==================== 页面 ====================

export default function AccountsView() {
  const { t } = useI18n()
  const { confirm, confirmDialog } = useConfirmDialog()
  const isSimpleMode = useAuthStore((s) => s.isSimpleMode)

  const [proxies, setProxies] = useState<AccountProxy[]>([])
  const [groups, setGroups] = useState<AdminGroup[]>([])
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const groupsByID = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups])

  const accountTableRef = useRef<HTMLDivElement>(null)
  const dataTableRef = useRef<DataTableHandle<AccountListItem>>(null)

  // 弹窗状态
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showSync, setShowSync] = useState(false)
  const [showImportData, setShowImportData] = useState(false)
  const [showExportDataDialog, setShowExportDataDialog] = useState(false)
  const [includeProxyOnExport, setIncludeProxyOnExport] = useState(true)
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [bulkEditTarget, setBulkEditTarget] = useState<AccountBulkEditTarget | null>(null)
  const [showTempUnsched, setShowTempUnsched] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showCreateShadowDialog, setShowCreateShadowDialog] = useState(false)
  const [showReAuth, setShowReAuth] = useState(false)
  const [showTest, setShowTest] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showErrorPassthrough, setShowErrorPassthrough] = useState(false)
  const [showTLSFingerprintProfiles, setShowTLSFingerprintProfiles] = useState(false)
  const [showSortOrderModal, setShowSortOrderModal] = useState(false)
  const [edAcc, setEdAcc] = useState<Account | null>(null)
  const [tempUnschedAcc, setTempUnschedAcc] = useState<Account | null>(null)
  const [deletingAcc, setDeletingAcc] = useState<Account | null>(null)
  const [creatingShadowAcc, setCreatingShadowAcc] = useState<Account | null>(null)
  const [reAuthAcc, setReAuthAcc] = useState<Account | null>(null)
  const [testingAcc, setTestingAcc] = useState<Account | null>(null)
  const [statsAcc, setStatsAcc] = useState<Account | null>(null)
  const [showSchedulePanel, setShowSchedulePanel] = useState(false)
  const [scheduleAcc, setScheduleAcc] = useState<Account | null>(null)
  const [scheduleModelOptions, setScheduleModelOptions] = useState<SelectOption[]>([])
  const [togglingSchedulable, setTogglingSchedulable] = useState<number | null>(null)
  const [menu, setMenu] = useState<MenuState>({ show: false, acc: null, anchorRect: null })
  const exportingDataRef = useRef(false)
  const [probingUpstreamBilling, setProbingUpstreamBilling] = useState<Set<number>>(() => new Set())
  const probingRef = useRef(probingUpstreamBilling)
  const [upstreamBillingProbeGloballyEnabled, setUpstreamBillingProbeGloballyEnabled] = useState<boolean | undefined>(undefined)
  const [upstreamBillingNow, setUpstreamBillingNow] = useState(currentTime)
  const upstreamBillingRateETag = useRef<string | null>(null)
  const upstreamBillingRateRefreshing = useRef(false)
  const upstreamBillingRateAbortController = useRef<AbortController | null>(null)

  // 顶部下拉
  const [showAccountToolsDropdown, setShowAccountToolsDropdown] = useState(false)
  const [showAutoRefreshDropdown, setShowAutoRefreshDropdown] = useState(false)

  // 列显隐
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(loadSavedColumns)
  const hiddenColumnsRef = useRef(hiddenColumns)
  const [initialSortState] = useState(loadInitialAccountSortState)
  const sortStateRef = useRef<AccountSortState>(initialSortState)

  // 自动刷新
  const [savedAutoRefresh] = useState(loadSavedAutoRefresh)
  const [autoRefreshEnabled, setAutoRefreshEnabledState] = useState(savedAutoRefresh.enabled)
  const [autoRefreshIntervalSeconds, setAutoRefreshIntervalSeconds] = useState<AutoRefreshInterval>(savedAutoRefresh.interval)
  const [autoRefreshCountdown, setAutoRefreshCountdownState] = useState(0)
  const autoRefreshCountdownRef = useRef(0)
  const autoRefreshETag = useRef<string | null>(null)
  const autoRefreshFetching = useRef(false)
  const autoRefreshSilentUntil = useRef(0)
  const [hasPendingListSync, setHasPendingListSync] = useState(false)

  // 今日统计 / 失败热力图
  const [todayStatsByAccountId, setTodayStatsByAccountId] = useState<Record<string, WindowStats>>({})
  const [todayStatsLoading, setTodayStatsLoading] = useState(false)
  const [todayStatsError, setTodayStatsError] = useState<string | null>(null)
  const todayStatsReqSeq = useRef(0)
  const pendingTodayStatsRefresh = useRef(false)
  const [usageManualRefreshToken, setUsageManualRefreshToken] = useState(0)
  const [accountView, setAccountViewState] = useState<AccountView>('list')
  const [hourlyFailureLoading, setHourlyFailureLoading] = useState(false)
  const [hourlyFailureError, setHourlyFailureError] = useState<string | null>(null)
  const hourlyFailureReqSeq = useRef(0)
  const [hourlyFailureData, setHourlyFailureData] = useState<AccountHourlyFailureResponse>({ date: '', timezone: '', by_account: {} })

  const isDesktopViewport = useSyncExternalStore(subscribeDesktopViewport, readDesktopViewport, () => true)

  // 用量批量拉取
  const [usageBatch, setUsageBatch] = useState<UsageBatchState>({ usage: {}, errors: {}, loading: {} })
  const usageBatchRequestTokenByAccountId = useRef<Record<string, number>>({})
  const usageBatchCache = useRef(new Map<number, { data: AccountUsageInfo; ts: number }>())
  const pendingUsageBatchIds = useRef(new Set<number>())
  const usageBatchFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedUsageBatchForce = useRef(false)
  const usageBatchRequestToken = useRef(0)

  // 列表加载：fetch 包装同步最新行与分页，供 await 之后立即读取
  const accountsRef = useRef<AccountListItem[]>([])
  const paginationRef = useRef<PaginationState>({ page: 1, page_size: 20, total: 0, pages: 0 })
  const fetchAccounts = useCallback(
    async (page: number, pageSize: number, requestParams: any, options?: { signal?: AbortSignal }) => {
      const response = await adminAPI.accounts.list(page, pageSize, requestParams, options)
      accountsRef.current = (response.items || []) as AccountListItem[]
      paginationRef.current = {
        ...paginationRef.current,
        page,
        page_size: pageSize,
        total: response.total || 0,
        pages: response.pages || 0
      }
      return response
    },
    []
  )

  const {
    items: accounts,
    setItems,
    loading,
    params,
    setParams,
    pagination,
    updatePagination,
    load: baseLoad,
    reload: baseReload,
    debouncedReload: baseDebouncedReload,
    handlePageChange: baseHandlePageChange,
    handlePageSizeChange: baseHandlePageSizeChange
  } = useTableLoader<AccountListItem, any>({
    fetchFn: fetchAccounts as any,
    initialParams: {
      ...loadInitialAccountFilterValues(),
      model: '',
      type: '',
      privacy_mode: '',
      group: '',
      search: '',
      lite: '1',
      include_scheduler_score: hiddenColumns.has('scheduler_score') ? '0' : '1',
      sort_by: initialSortState.sort_by,
      sort_order: initialSortState.sort_order
    }
  })
  const paramsRef = useRef<any>(params)

  const setAccounts = useCallback(
    (next: AccountListItem[]) => {
      accountsRef.current = next
      setItems(next)
    },
    [setItems]
  )

  const setPaginationLocal = (patch: Partial<PaginationState>) => {
    paginationRef.current = { ...paginationRef.current, ...patch }
    updatePagination(patch)
  }

  const setParamsLocal = (patch: Record<string, unknown>) => {
    paramsRef.current = { ...paramsRef.current, ...patch }
    setParams(patch)
  }

  const setAutoRefreshCountdown = (value: number) => {
    autoRefreshCountdownRef.current = value
    setAutoRefreshCountdownState(value)
  }

  const setProbing = (update: (draft: Set<number>) => void) => {
    const next = new Set(probingRef.current)
    update(next)
    probingRef.current = next
    setProbingUpstreamBilling(next)
  }

  const {
    selectedSet,
    selectedIds: selIds,
    allVisibleSelected,
    isSelected,
    setSelectedIds,
    select,
    deselect,
    toggle: toggleSel,
    clear: clearSelectedIds,
    removeMany: removeSelectedAccounts,
    toggleVisible,
    selectVisible: selectCurrentPage,
    batchUpdate
  } = useTableSelection<AccountListItem>({
    rows: accounts,
    getId: (account) => account.id
  })

  const [selectingAllResults, setSelectingAllResults] = useState(false)
  const [selectedAllResultIDs, setSelectedAllResultIDs] = useState<Set<number> | null>(null)
  const selectionRequestVersion = useRef(0)
  const allResultsSelected = (() => {
    const snapshot = selectedAllResultIDs
    if (!snapshot || snapshot.size === 0 || snapshot.size !== selectedSet.size) return false
    return Array.from(snapshot).every((id) => selectedSet.has(id))
  })()

  const selPlatforms = useMemo<AccountPlatform[]>(
    () => [...new Set(accounts.filter((a) => selectedSet.has(a.id)).map((a) => a.platform))],
    [accounts, selectedSet]
  )
  const selTypes = useMemo<AccountType[]>(
    () => [...new Set(accounts.filter((a) => selectedSet.has(a.id)).map((a) => a.type))],
    [accounts, selectedSet]
  )

  const isAnyModalOpen =
    showCreate ||
    showEdit ||
    showSync ||
    showImportData ||
    showExportDataDialog ||
    showBulkEdit ||
    showTempUnsched ||
    showDeleteDialog ||
    showReAuth ||
    showTest ||
    showStats ||
    showSchedulePanel ||
    showErrorPassthrough ||
    showTLSFingerprintProfiles

  // 供事件处理、定时器与异步流程读取的最新状态
  const live = useRef({
    loading,
    accountView,
    isAnyModalOpen,
    menu,
    showAccountToolsDropdown,
    showAutoRefreshDropdown,
    autoRefreshEnabled,
    autoRefreshIntervalSeconds,
    isDesktopViewport,
    selIds,
    edAcc,
    reAuthAcc,
    tempUnschedAcc,
    deletingAcc
  })
  useLayoutEffect(() => {
    live.current = {
      loading,
      accountView,
      isAnyModalOpen,
      menu,
      showAccountToolsDropdown,
      showAutoRefreshDropdown,
      autoRefreshEnabled,
      autoRefreshIntervalSeconds,
      isDesktopViewport,
      selIds,
      edAcc,
      reAuthAcc,
      tempUnschedAcc,
      deletingAcc
    }
    accountsRef.current = accounts
    paginationRef.current = pagination
    paramsRef.current = params
    hiddenColumnsRef.current = hiddenColumns
    probingRef.current = probingUpstreamBilling
  })

  // ==================== 数据刷新 ====================

  const refreshHourlyFailures = async () => {
    const view = live.current.accountView
    if (view !== 'failures' && view !== 'statistics') return
    const accountIDs = accountsRef.current.map((account) => account.id)
    const reqSeq = ++hourlyFailureReqSeq.current
    if (accountIDs.length === 0) {
      setHourlyFailureData({ date: '', timezone: '', by_account: {} })
      setHourlyFailureError(null)
      setHourlyFailureLoading(false)
      return
    }
    setHourlyFailureLoading(true)
    setHourlyFailureError(null)
    try {
      const result = await adminAPI.ops.getAccountHourlyFailures(accountIDs)
      if (reqSeq === hourlyFailureReqSeq.current) setHourlyFailureData(result)
    } catch (error) {
      if (reqSeq === hourlyFailureReqSeq.current) setHourlyFailureError(extractApiErrorMessage(error))
    } finally {
      if (reqSeq === hourlyFailureReqSeq.current) setHourlyFailureLoading(false)
    }
  }

  const refreshTodayStatsBatch = async () => {
    // Why this checks both columns:
    // - today_stats column shows dedicated today's metrics.
    // - usage column also embeds today's stats for Key/Bedrock rows.
    // So we only skip fetching when BOTH columns are hidden.
    const hidden = hiddenColumnsRef.current
    if (live.current.accountView !== 'statistics' && hidden.has('today_stats') && hidden.has('usage')) {
      setTodayStatsLoading(false)
      setTodayStatsError(null)
      return
    }

    const accountIDs = accountsRef.current.map((account) => account.id)
    const reqSeq = ++todayStatsReqSeq.current
    if (accountIDs.length === 0) {
      setTodayStatsByAccountId({})
      setTodayStatsError(null)
      setTodayStatsLoading(false)
      return
    }

    setTodayStatsLoading(true)
    setTodayStatsError(null)

    try {
      const result = await adminAPI.accounts.getBatchTodayStats(accountIDs)
      if (reqSeq !== todayStatsReqSeq.current) return
      const serverStats = result.stats ?? {}
      const nextStats: Record<string, WindowStats> = {}
      for (const accountID of accountIDs) {
        const key = String(accountID)
        nextStats[key] = serverStats[key] ?? buildDefaultTodayStats()
      }
      setTodayStatsByAccountId(nextStats)
    } catch (error) {
      if (reqSeq !== todayStatsReqSeq.current) return
      setTodayStatsError('Failed')
      console.error('Failed to load account today stats:', error)
    } finally {
      if (reqSeq === todayStatsReqSeq.current) {
        setTodayStatsLoading(false)
      }
    }
  }

  const setAccountView = (view: AccountView) => {
    live.current = { ...live.current, accountView: view }
    setAccountViewState(view)
    if (view === 'failures' || view === 'statistics') {
      void Promise.all([refreshTodayStatsBatch(), refreshHourlyFailures()])
    }
  }

  const handleAccountUsageLoaded = (accountID: number, usage: AccountUsageInfo) => {
    const key = String(accountID)
    setUsageBatch((prev) => {
      if (prev.usage[key] === usage) return prev
      return { ...prev, usage: { ...prev.usage, [key]: usage }, errors: { ...prev.errors, [key]: null } }
    })
  }

  const flushQueuedUsageBatch = async () => {
    usageBatchFlushTimer.current = null
    const accountIDs = Array.from(pendingUsageBatchIds.current)
    const force = queuedUsageBatchForce.current
    pendingUsageBatchIds.current.clear()
    queuedUsageBatchForce.current = false

    if (accountIDs.length === 0) return

    const tokens = usageBatchRequestTokenByAccountId.current
    const requestTokensByAccount = accountIDs.reduce<Record<string, number>>((acc, accountID) => {
      acc[String(accountID)] = tokens[String(accountID)] ?? 0
      return acc
    }, {})
    const isCurrent = (key: string) => (usageBatchRequestTokenByAccountId.current[key] ?? 0) === requestTokensByAccount[key]

    try {
      const result = await adminAPI.accounts.getBatchUsage(accountIDs, force)

      const usageMap = result.usage ?? {}
      const errorMap = result.errors ?? {}
      const now = currentTime()
      const fresh: Array<[string, AccountUsageInfo | null, string | null]> = []
      for (const accountID of accountIDs) {
        const key = String(accountID)
        if (!isCurrent(key)) continue
        const usage = usageMap[key] ?? null
        fresh.push([key, usage, errorMap[key] ?? null])
        if (usage) {
          usageBatchCache.current.set(accountID, { data: usage, ts: now })
        } else {
          usageBatchCache.current.delete(accountID)
        }
      }
      setUsageBatch((prev) => {
        const next = { usage: { ...prev.usage }, errors: { ...prev.errors }, loading: { ...prev.loading } }
        for (const [key, usage, error] of fresh) {
          next.usage[key] = usage
          next.errors[key] = error
          next.loading[key] = false
        }
        return next
      })
    } catch (error) {
      const failedKeys = accountIDs.map(String).filter(isCurrent)
      setUsageBatch((prev) => {
        const next = { ...prev, errors: { ...prev.errors }, loading: { ...prev.loading } }
        for (const key of failedKeys) {
          next.errors[key] = 'Failed'
          next.loading[key] = false
        }
        return next
      })
      console.error('Failed to load account usage batch:', error)
    }
  }
  const flushRef = useRef(flushQueuedUsageBatch)
  useLayoutEffect(() => {
    flushRef.current = flushQueuedUsageBatch
  })

  // 传给每行用量单元格，保持引用稳定
  const queueBatchedUsage = useCallback((account: Account, options?: { force?: boolean }) => {
    if (!live.current.isDesktopViewport) return
    if (!accountSupportsBatchUsage(account)) return

    const force = options?.force === true
    const cacheKey = account.id
    const key = String(cacheKey)

    if (force) {
      usageBatchCache.current.delete(cacheKey)
    } else {
      const cached = usageBatchCache.current.get(cacheKey)
      if (cached && currentTime() - cached.ts < USAGE_BATCH_CACHE_TTL) {
        setUsageBatch((prev) => ({
          usage: { ...prev.usage, [key]: cached.data },
          errors: { ...prev.errors, [key]: null },
          loading: { ...prev.loading, [key]: false }
        }))
        return
      }
    }

    usageBatchRequestTokenByAccountId.current = {
      ...usageBatchRequestTokenByAccountId.current,
      [key]: ++usageBatchRequestToken.current
    }
    setUsageBatch((prev) => ({
      ...prev,
      errors: { ...prev.errors, [key]: null },
      loading: { ...prev.loading, [key]: true }
    }))
    pendingUsageBatchIds.current.add(cacheKey)
    queuedUsageBatchForce.current = queuedUsageBatchForce.current || force

    if (usageBatchFlushTimer.current !== null) return
    usageBatchFlushTimer.current = setTimeout(() => {
      void flushRef.current()
    }, 0)
  }, [])

  const toggleColumn = (key: string) => {
    const wasHidden = hiddenColumnsRef.current.has(key)
    const next = new Set(hiddenColumnsRef.current)
    if (wasHidden) next.delete(key)
    else next.add(key)
    hiddenColumnsRef.current = next
    setHiddenColumns(next)
    saveColumnsToStorage(next)
    if ((key === 'today_stats' || key === 'usage') && wasHidden) {
      refreshTodayStatsBatch().catch((error) => {
        console.error('Failed to load account today stats after showing column:', error)
      })
    }
    if (key === 'scheduler_score') {
      // The server only returns scheduler scores when this column is visible, so reload the current page immediately.
      syncAccountListDerivedParams()
      load().catch((error) => {
        console.error('Failed to reload accounts after toggling scheduler score column:', error)
      })
    }
  }

  const isColumnVisible = (key: string) => !hiddenColumns.has(key)
  const syncAccountListDerivedParams = () => {
    // Keep every load path, including auto-refresh and sorting, aligned with the current column visibility.
    setParamsLocal({ include_scheduler_score: hiddenColumnsRef.current.has('scheduler_score') ? '0' : '1' })
  }

  const clearSelection = () => {
    selectionRequestVersion.current++
    setSelectingAllResults(false)
    setSelectedAllResultIDs(null)
    clearSelectedIds()
  }

  const selectPage = () => {
    selectCurrentPage()
  }

  const swipeVirtualContext: SwipeSelectVirtualContext = {
    getVirtualizer: () => (dataTableRef.current?.virtualizer as any) ?? null,
    getSortedData: () => dataTableRef.current?.sortedData ?? accountsRef.current,
    getRowId: (row: any) => row.id
  }

  useSwipeSelect(accountTableRef, { isSelected, select, deselect, batchUpdate }, swipeVirtualContext)

  // 行内拖动排序：只有按住名字列左侧的把手才进入拖动，
  // 按住行其它地方仍是上面的滑动多选，两者通过把手互不抢占。
  const priorityDrag = usePriorityDrag<AccountListItem>({
    getRows: () => accountsRef.current,
    getContainer: () => accountTableRef.current,
    onDrop: (drop) => reorderAccountPriority(drop.moved, drop.previous, drop.next)
  })

  // 优先级不再以数字呈现：整张表按"使用顺序"给出位次（1 = 最先被调度）。
  // 同优先级时用 id 兜底，与调度侧 ORDER BY priority, id 的稳定顺序一致。
  const priorityRankByAccountID = useMemo(() => {
    const ordered = [...accounts].sort((left, right) => left.priority - right.priority || left.id - right.id)
    const ranks = new Map<number, number>()
    ordered.forEach((account, index) => ranks.set(account.id, index + 1))
    return ranks
  }, [accounts])

  // 拖动落点 → 新的优先级。只写被拖动的这一个账号：取新前后邻居优先级的中点，
  // 邻居之间没有空位时才退回整页按位置重编号。
  const reorderAccountPriority = async (
    moved: AccountListItem,
    previous: AccountListItem | null,
    next: AccountListItem | null
  ) => {
    const rows = accountsRef.current
    const taken = new Set(rows.filter((row) => row.id !== moved.id).map((row) => row.priority))
    const target = computeDropPriority({
      lowerBound: previous?.priority ?? null,
      upperBound: next?.priority ?? null,
      taken
    })
    const changes = target != null ? [{ id: moved.id, priority: target }] : rows.map((row, index) => ({ id: row.id, priority: index + 1 }))
    const before = new Map(rows.map((row) => [row.id, row.priority]))
    const effective = changes.filter((change) => before.get(change.id) !== change.priority)
    if (effective.length === 0) return

    // 先把本地顺序改掉，失败再整体回滚，避免出现"拖完又跳回去"的闪烁。
    const optimistic = new Map(rows.map((row) => [row.id, row.priority]))
    effective.forEach((change) => optimistic.set(change.id, change.priority))
    setAccounts(
      rows
        .map((row) => ({ ...row, priority: optimistic.get(row.id) ?? row.priority }))
        .sort((left, right) => left.priority - right.priority || left.id - right.id)
    )

    try {
      await adminAPI.accounts.updateSortOrder(effective)
      useAppStore.getState().showSuccess(t('admin.accounts.sortOrder.updated'))
      // 顺序就是优先级本身：拖完把排序切回"优先级升序"，
      // 让列表顺序、位次列、真实的调度顺序三者保持一致。
      const sortState = sortStateRef.current
      if (sortState.sort_by !== 'priority' || sortState.sort_order !== 'asc') {
        sortStateRef.current = { sort_by: 'priority', sort_order: 'asc' }
        void reload()
      }
    } catch (error) {
      setAccounts(rows)
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.accounts.sortOrder.updateFailed')))
    }
  }

  const resetAutoRefreshCache = () => {
    autoRefreshETag.current = null
    upstreamBillingRateETag.current = null
  }

  const markPendingListSync = (value: boolean) => setHasPendingListSync(value)

  const load = async (options: { refreshTodayStats?: boolean } = {}) => {
    syncAccountListDerivedParams()
    markPendingListSync(false)
    resetAutoRefreshCache()
    pendingTodayStatsRefresh.current = false
    // lite=1 常驻列表参数：账号表只需要紧凑字段（分组/状态/用量摘要），
    // 分页、排序、筛选与 ETag 增量刷新都必须沿用同一份紧凑响应，否则每次
    // 翻页/排序都会退回全量 payload，丢掉账号表依赖的紧凑行结构。
    // 需要完整账号的入口（编辑、测试、统计、复制）都先按 id 单独取全量。
    await baseLoad()
    if (options.refreshTodayStats !== false) {
      await Promise.all([refreshTodayStatsBatch(), refreshHourlyFailures()])
    }
  }

  const reload = async () => {
    syncAccountListDerivedParams()
    markPendingListSync(false)
    resetAutoRefreshCache()
    pendingTodayStatsRefresh.current = false
    paginationRef.current = { ...paginationRef.current, page: 1 }
    await baseReload()
    await Promise.all([refreshTodayStatsBatch(), refreshHourlyFailures()])
  }

  const reloadQuietly = () => {
    reload().catch(() => {
      // useTableLoader 已记录加载错误
    })
  }

  const buildUpstreamBillingRateFilters = () => {
    const rawParams = paramsRef.current as Record<string, unknown>
    return {
      platform: typeof rawParams.platform === 'string' ? rawParams.platform : '',
      type: typeof rawParams.type === 'string' ? rawParams.type : '',
      status: typeof rawParams.status === 'string' ? rawParams.status : '',
      group: typeof rawParams.group === 'string' ? rawParams.group : '',
      search: typeof rawParams.search === 'string' ? rawParams.search : '',
      privacy_mode: typeof rawParams.privacy_mode === 'string' ? rawParams.privacy_mode : '',
      sort_by: sortStateRef.current.sort_by,
      sort_order: sortStateRef.current.sort_order
    }
  }

  const upstreamBillingRateContextKey = () =>
    JSON.stringify({
      page: paginationRef.current.page,
      pageSize: paginationRef.current.page_size,
      filters: buildUpstreamBillingRateFilters()
    })

  const syncAccountRefs = (nextAccount: Account) => {
    const current = live.current
    if (current.edAcc?.id === nextAccount.id) setEdAcc(nextAccount)
    if (current.reAuthAcc?.id === nextAccount.id) setReAuthAcc(nextAccount)
    if (current.tempUnschedAcc?.id === nextAccount.id) setTempUnschedAcc(nextAccount)
    if (current.deletingAcc?.id === nextAccount.id) setDeletingAcc(nextAccount)
    if (current.menu.acc?.id === nextAccount.id) setMenu((prev) => ({ ...prev, acc: nextAccount }))
  }

  const applyUpstreamBillingRateSnapshots = async (
    result: NonNullable<Awaited<ReturnType<typeof adminAPI.accounts.getUpstreamBillingRatesWithEtag>>['data']>
  ) => {
    const nextIDs = result.items.map((item) => item.account_id)
    const currentIDs = accountsRef.current.map((account) => account.id)

    // The compact response cannot fill a row that crossed a page boundary.
    // Only that case needs the expensive, full account-list request.
    if (result.total !== paginationRef.current.total || !sameAccountIDOrder(nextIDs, currentIDs)) {
      try {
        await load({ refreshTodayStats: false })
      } catch (error) {
        console.error('Failed to reconcile upstream billing sort:', error)
      }
      return
    }

    const itemsByID = new Map(result.items.map((item) => [item.account_id, item]))
    let changed = false
    const nextAccounts = accountsRef.current.map((account) => {
      const item = itemsByID.get(account.id)
      if (!item) return account
      const nextSnapshot = item.snapshot ?? null
      const previousSnapshot = account.extra?.upstream_billing_probe ?? null
      if (JSON.stringify(previousSnapshot) === JSON.stringify(nextSnapshot)) return account

      const nextExtra = { ...(account.extra ?? {}) }
      if (nextSnapshot) nextExtra.upstream_billing_probe = nextSnapshot
      else delete nextExtra.upstream_billing_probe
      const nextAccount = {
        ...account,
        ...(typeof nextSnapshot?.synced_rate_multiplier === 'number' ? { rate_multiplier: nextSnapshot.synced_rate_multiplier } : {}),
        extra: nextExtra
      }
      syncAccountRefs(nextAccount as Account)
      changed = true
      return nextAccount
    })

    if (changed) {
      setAccounts(nextAccounts)
      setUpstreamBillingNow(currentTime())
    }
  }

  const refreshUpstreamBillingRates = async (force = false) => {
    if (upstreamBillingRateRefreshing.current || live.current.loading || accountsRef.current.length === 0) return
    const current = live.current
    if (
      !force &&
      (probingRef.current.size > 0 ||
        current.isAnyModalOpen ||
        current.menu.show ||
        current.showAccountToolsDropdown ||
        current.showAutoRefreshDropdown ||
        (typeof document !== 'undefined' && document.hidden))
    )
      return

    const controller = new AbortController()
    upstreamBillingRateAbortController.current = controller
    upstreamBillingRateRefreshing.current = true
    try {
      syncAccountListDerivedParams()
      const requestContextKey = upstreamBillingRateContextKey()
      const result = await adminAPI.accounts.getUpstreamBillingRatesWithEtag(
        paginationRef.current.page,
        paginationRef.current.page_size,
        buildUpstreamBillingRateFilters(),
        { etag: force ? null : upstreamBillingRateETag.current, signal: controller.signal }
      )
      if (live.current.loading || requestContextKey !== upstreamBillingRateContextKey()) return
      if (result.etag) upstreamBillingRateETag.current = result.etag
      if (!result.notModified && result.data) await applyUpstreamBillingRateSnapshots(result.data)
    } catch (error) {
      if (!isAbortLike(error)) {
        console.error('Failed to refresh upstream billing rates:', error)
      }
    } finally {
      if (upstreamBillingRateAbortController.current === controller) upstreamBillingRateAbortController.current = null
      upstreamBillingRateRefreshing.current = false
    }
  }

  const refreshUpstreamBillingSortedList = async (force = false) => {
    if (!force && sortStateRef.current.sort_by !== 'upstream_billing_rate') return
    await refreshUpstreamBillingRates(force)
  }

  const saveAccountFilterValues = () => {
    try {
      localStorage.setItem(
        ACCOUNT_FILTER_STORAGE_KEY,
        JSON.stringify({
          platform: paramsRef.current.platform,
          status: paramsRef.current.status
        })
      )
    } catch {
      // Filtering must remain available when browser storage is unavailable.
    }
  }

  const debouncedReload = () => {
    saveAccountFilterValues()
    clearSelection()
    syncAccountListDerivedParams()
    markPendingListSync(false)
    resetAutoRefreshCache()
    pendingTodayStatsRefresh.current = true
    baseDebouncedReload()
  }

  const handlePageChange = (page: number) => {
    syncAccountListDerivedParams()
    markPendingListSync(false)
    resetAutoRefreshCache()
    pendingTodayStatsRefresh.current = true
    baseHandlePageChange(page)
  }

  const handlePageSizeChange = (size: number) => {
    syncAccountListDerivedParams()
    markPendingListSync(false)
    resetAutoRefreshCache()
    pendingTodayStatsRefresh.current = true
    baseHandlePageSizeChange(size)
  }

  const handleSort = (key: string, order: AccountSortOrder) => {
    sortStateRef.current = { sort_by: key, sort_order: order }
    setParamsLocal({ sort_by: key, sort_order: order })
    syncAccountListDerivedParams()
    setPaginationLocal({ page: 1 })
    markPendingListSync(false)
    resetAutoRefreshCache()
    pendingTodayStatsRefresh.current = true
    load().catch(() => {
      // useTableLoader 已记录加载错误
    })
  }

  // 加载结束：刷新计费时间基准，并补拉翻页/筛选后挂起的今日统计与失败热力图
  const wasLoadingRef = useRef(loading)
  const afterLoadRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    afterLoadRef.current = () => {
      setUpstreamBillingNow(currentTime())
      if (pendingTodayStatsRefresh.current) {
        pendingTodayStatsRefresh.current = false
        refreshTodayStatsBatch().catch((error) => {
          console.error('Failed to refresh account today stats after table load:', error)
        })
        refreshHourlyFailures().catch((error) => {
          console.error('Failed to refresh account failure heatmap after table load:', error)
        })
      }
    }
  })
  useEffect(() => {
    const wasLoading = wasLoadingRef.current
    wasLoadingRef.current = loading
    if (wasLoading && !loading) afterLoadRef.current()
  }, [loading])

  // 当前页之外的行不再保留批量用量状态
  useEffect(() => {
    const visibleIDs = new Set(accounts.map((row) => String(row.id)))
    const keep = <V,>(record: Record<string, V>) => Object.fromEntries(Object.entries(record).filter(([key]) => visibleIDs.has(key)))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 与 Vue 版 watch(accounts) 一致，裁剪不再可见的行
    setUsageBatch((prev) => ({ usage: keep(prev.usage), errors: keep(prev.errors), loading: keep(prev.loading) }))
    usageBatchRequestTokenByAccountId.current = keep(usageBatchRequestTokenByAccountId.current)
  }, [accounts])

  const enterAutoRefreshSilentWindow = () => {
    autoRefreshSilentUntil.current = currentTime() + AUTO_REFRESH_SILENT_WINDOW_MS
    setAutoRefreshCountdown(live.current.autoRefreshIntervalSeconds)
  }

  const inAutoRefreshSilentWindow = () => currentTime() < autoRefreshSilentUntil.current

  const mergeAccountsIncrementally = (nextRows: Account[]) => {
    const currentRows = accountsRef.current
    const currentByID = new Map(currentRows.map((row) => [row.id, row]))
    let changed = nextRows.length !== currentRows.length
    const mergedRows = nextRows.map((nextRow) => {
      const currentRow = currentByID.get(nextRow.id)
      if (!currentRow) {
        changed = true
        return nextRow
      }
      if (shouldReplaceAutoRefreshRow(currentRow as Account, nextRow)) {
        changed = true
        syncAccountRefs(nextRow)
        return nextRow
      }
      return currentRow
    })
    if (!changed) {
      for (let i = 0; i < mergedRows.length; i += 1) {
        if (mergedRows[i].id !== currentRows[i]?.id) {
          changed = true
          break
        }
      }
    }
    if (changed) {
      setAccounts(mergedRows as AccountListItem[])
    }
  }

  const refreshAccountsIncrementally = async () => {
    if (autoRefreshFetching.current) return
    syncAccountListDerivedParams()
    autoRefreshFetching.current = true
    try {
      const result = await adminAPI.accounts.listWithEtag(
        paginationRef.current.page,
        paginationRef.current.page_size,
        paramsRef.current as {
          platform?: string
          type?: string
          status?: string
          privacy_mode?: string
          group?: string
          search?: string
          sort_by?: string
          sort_order?: AccountSortOrder
        },
        { etag: autoRefreshETag.current }
      )

      if (result.etag) {
        autoRefreshETag.current = result.etag
      }
      if (!result.notModified && result.data) {
        setPaginationLocal({ total: result.data.total || 0, pages: result.data.pages || 0 })
        mergeAccountsIncrementally(result.data.items || [])
        markPendingListSync(false)
      }
      setUpstreamBillingNow(currentTime())

      await Promise.all([refreshTodayStatsBatch(), refreshHourlyFailures()])
    } catch (error) {
      console.error('Auto refresh failed:', error)
    } finally {
      autoRefreshFetching.current = false
    }
  }

  const loadUpstreamBillingProbeGlobalState = async () => {
    try {
      const settings = await adminAPI.accounts.getUpstreamBillingProbeSettings()
      setUpstreamBillingProbeGloballyEnabled(settings.enabled)
    } catch (error) {
      console.error('Failed to load upstream billing probe settings:', error)
    }
  }

  const handleManualRefresh = async () => {
    await Promise.all([load(), loadUpstreamBillingProbeGlobalState()])
    // Force usage cells to refetch /usage on explicit user refresh.
    setUsageManualRefreshToken((value) => value + 1)
  }

  const closeAccountToolsDropdown = () => setShowAccountToolsDropdown(false)

  const openSyncFromCrs = () => {
    closeAccountToolsDropdown()
    setShowSync(true)
  }

  const openImportData = () => {
    closeAccountToolsDropdown()
    setShowImportData(true)
  }

  const openExportDataDialog = () => {
    setIncludeProxyOnExport(true)
    setShowExportDataDialog(true)
  }

  const openExportDataDialogFromMenu = () => {
    closeAccountToolsDropdown()
    openExportDataDialog()
  }

  const openErrorPassthrough = () => {
    closeAccountToolsDropdown()
    setShowErrorPassthrough(true)
  }

  const openSortOrderModal = () => {
    closeAccountToolsDropdown()
    setShowSortOrderModal(true)
  }

  const openTLSFingerprintProfiles = () => {
    closeAccountToolsDropdown()
    setShowTLSFingerprintProfiles(true)
  }

  const syncPendingListChanges = async () => {
    markPendingListSync(false)
    await load()
    // Keep behavior consistent with manual refresh.
    setUsageManualRefreshToken((value) => value + 1)
  }

  const setAutoRefreshEnabled = (enabled: boolean) => {
    live.current = { ...live.current, autoRefreshEnabled: enabled }
    setAutoRefreshEnabledState(enabled)
    saveAutoRefreshToStorage(enabled, autoRefreshIntervalSeconds)
    if (enabled) {
      setAutoRefreshCountdown(autoRefreshIntervalSeconds)
    } else {
      setAutoRefreshCountdown(0)
    }
  }

  const setAutoRefreshInterval = (seconds: AutoRefreshInterval) => {
    live.current = { ...live.current, autoRefreshIntervalSeconds: seconds }
    setAutoRefreshIntervalSeconds(seconds)
    saveAutoRefreshToStorage(autoRefreshEnabled, seconds)
    if (autoRefreshEnabled) {
      setAutoRefreshCountdown(seconds)
    }
  }

  const autoRefreshIntervalLabel = (sec: number) => {
    if (sec === 5) return t('admin.accounts.refreshInterval5s')
    if (sec === 10) return t('admin.accounts.refreshInterval10s')
    if (sec === 15) return t('admin.accounts.refreshInterval15s')
    if (sec === 30) return t('admin.accounts.refreshInterval30s')
    return `${sec}s`
  }

  // 自动刷新：启用时每秒倒计时一次，到点做 ETag 增量刷新
  const autoRefreshTickRef = useRef<() => Promise<void>>(async () => {})
  useLayoutEffect(() => {
    autoRefreshTickRef.current = async () => {
      const current = live.current
      if (!current.autoRefreshEnabled) return
      if (document.hidden) return
      if (current.loading || autoRefreshFetching.current) return
      if (current.isAnyModalOpen) return
      if (current.menu.show || current.showAccountToolsDropdown || current.showAutoRefreshDropdown) return
      if (inAutoRefreshSilentWindow()) {
        setAutoRefreshCountdown(Math.max(0, Math.ceil((autoRefreshSilentUntil.current - currentTime()) / 1000)))
        return
      }

      if (autoRefreshCountdownRef.current <= 0) {
        setAutoRefreshCountdown(current.autoRefreshIntervalSeconds)
        await refreshAccountsIncrementally()
        return
      }

      setAutoRefreshCountdown(autoRefreshCountdownRef.current - 1)
    }
  })
  useEffect(() => {
    if (!autoRefreshEnabled) return
    const timer = window.setInterval(() => {
      void autoRefreshTickRef.current()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [autoRefreshEnabled])

  // 计费时间基准每分钟刷新；上游计费倍率每 5 分钟后台刷新
  const upstreamRefreshRef = useRef(refreshUpstreamBillingRates)
  useLayoutEffect(() => {
    upstreamRefreshRef.current = refreshUpstreamBillingRates
  })
  useEffect(() => {
    const nowTimer = window.setInterval(() => setUpstreamBillingNow(currentTime()), 60_000)
    const rateTimer = window.setInterval(() => {
      void upstreamRefreshRef.current()
    }, 5 * 60_000)
    return () => {
      window.clearInterval(nowTimer)
      window.clearInterval(rateTimer)
    }
  }, [])

  // ==================== 行操作 ====================

  const accountDetailLoading = useRef(new Set<number>())
  const loadAccountDetails = async (account: Pick<AccountListItem, 'id'>): Promise<Account | null> => {
    if (accountDetailLoading.current.has(account.id)) return null
    accountDetailLoading.current.add(account.id)
    try {
      return await adminAPI.accounts.getById(account.id)
    } catch (error) {
      console.error('Failed to load account details:', error)
      useAppStore.getState().showError(extractApiErrorMessage(error, t('common.error')))
      return null
    } finally {
      accountDetailLoading.current.delete(account.id)
    }
  }

  const handleEdit = async (a: AccountListItem) => {
    const account = await loadAccountDetails(a)
    if (!account) return
    setEdAcc(account)
    setShowEdit(true)
  }

  const openMenu = (a: AccountListItem, e: ReactMouseEvent<HTMLElement>) => {
    const anchorRect = e.currentTarget.getBoundingClientRect()
    const next = { show: true, acc: a as Account, anchorRect }
    live.current = { ...live.current, menu: next }
    setMenu(next)
  }

  const closeMenu = () => {
    live.current = { ...live.current, menu: { ...live.current.menu, show: false } }
    setMenu((prev) => (prev.show ? { ...prev, show: false } : prev))
  }

  const handleBulkDelete = async () => {
    const accountIds = [...selIds]
    if (!(await confirm(t('admin.accounts.bulkActions.confirmDelete', { count: accountIds.length }), { danger: true }))) return
    try {
      const result = await adminAPI.accounts.batchDelete(accountIds)
      if (result.failed > 0) {
        useAppStore.getState().showError(
          t('admin.accounts.bulkActions.partialSuccess', {
            success: result.success,
            failed: result.failed
          })
        )
        setSelectedIds(result.failed_ids?.length ? result.failed_ids : accountIds)
      } else {
        useAppStore.getState().showSuccess(t('admin.accounts.bulkActions.deleteSuccess', { count: result.success }))
        clearSelection()
      }
      await reload()
    } catch (error) {
      console.error('Failed to bulk delete accounts:', error)
      useAppStore.getState().showError(String(error))
    }
  }

  const handleBulkResetStatus = async () => {
    if (!(await confirm(t('common.confirm'), { danger: true }))) return
    try {
      const result = await adminAPI.accounts.batchClearError(selIds)
      if (result.failed > 0) {
        useAppStore.getState().showError(t('admin.accounts.bulkActions.partialSuccess', { success: result.success, failed: result.failed }))
      } else {
        useAppStore.getState().showSuccess(t('admin.accounts.bulkActions.resetStatusSuccess', { count: result.success }))
        clearSelection()
      }
      reloadQuietly()
    } catch (error) {
      console.error('Failed to bulk reset status:', error)
      useAppStore.getState().showError(String(error))
    }
  }

  const handleBulkRefreshToken = async () => {
    if (!(await confirm(t('common.confirm')))) return
    const accountIds = [...selIds]
    try {
      const result = await adminAPI.accounts.batchRefresh(accountIds)
      if (result.failed > 0) {
        useAppStore.getState().showError(t('admin.accounts.bulkActions.partialSuccess', { success: result.success, failed: result.failed }))
        const failedIds = result.errors?.map((error) => error.account_id) ?? []
        setSelectedIds(failedIds.length > 0 ? failedIds : accountIds)
      } else {
        useAppStore.getState().showSuccess(t('admin.accounts.bulkActions.refreshTokenSuccess', { count: result.success }))
        clearSelection()
      }
      reloadQuietly()
    } catch (error) {
      console.error('Failed to bulk refresh token:', error)
      useAppStore.getState().showError(String(error))
    }
  }

  const syncPaginationAfterLocalRemoval = () => {
    const current = paginationRef.current
    const nextTotal = Math.max(0, current.total - 1)
    const pages = nextTotal > 0 ? Math.ceil(nextTotal / current.page_size) : 0
    const maxPage = Math.max(1, pages || 1)
    setPaginationLocal({ total: nextTotal, pages, ...(current.page > maxPage ? { page: maxPage } : {}) })
    // 行被本地移除后不立刻全量补页，改为提示用户手动同步。
    markPendingListSync(nextTotal > 0)
  }

  const buildAccountQueryFilters = () => {
    const p = paramsRef.current
    return {
      platform: p.platform || '',
      model: p.model || '',
      type: p.type || '',
      status: p.status || '',
      group: p.group || '',
      privacy_mode: p.privacy_mode || '',
      search: p.search || '',
      sort_by: sortStateRef.current.sort_by,
      sort_order: sortStateRef.current.sort_order
    }
  }

  const accountMatchesCurrentFilters = (account: Account) => {
    const filters = buildAccountQueryFilters()
    if (filters.platform && account.platform !== filters.platform) return false
    if (filters.type && account.type !== filters.type) return false
    if (filters.status) {
      const now = currentTime()
      const rateLimitResetAt = account.rate_limit_reset_at ? new Date(account.rate_limit_reset_at).getTime() : Number.NaN
      const isRateLimited = Number.isFinite(rateLimitResetAt) && rateLimitResetAt > now
      const tempUnschedUntil = account.temp_unschedulable_until ? new Date(account.temp_unschedulable_until).getTime() : Number.NaN
      const isTempUnschedulable = Number.isFinite(tempUnschedUntil) && tempUnschedUntil > now

      if (filters.status === 'active') {
        if (account.status !== 'active' || isRateLimited || isTempUnschedulable || !account.schedulable) return false
      } else if (filters.status === 'rate_limited') {
        if (account.status !== 'active' || !isRateLimited || isTempUnschedulable) return false
      } else if (filters.status === 'temp_unschedulable') {
        if (account.status !== 'active' || !isTempUnschedulable) return false
      } else if (filters.status === 'unschedulable') {
        if (account.status !== 'active' || account.schedulable || isRateLimited || isTempUnschedulable) return false
      } else if (account.status !== filters.status) {
        return false
      }
    }
    if (filters.group) {
      const groupIds = account.group_ids ?? account.groups?.map((group) => group.id) ?? []
      if (filters.group === ACCOUNT_UNGROUPED_GROUP_QUERY_VALUE) {
        if (groupIds.length > 0) return false
      } else if (!groupIds.includes(Number(filters.group))) {
        return false
      }
    }
    const privacyMode = typeof account.extra?.privacy_mode === 'string' ? account.extra.privacy_mode : ''
    if (filters.privacy_mode) {
      if (filters.privacy_mode === ACCOUNT_PRIVACY_MODE_UNSET_QUERY_VALUE) {
        if (privacyMode.trim() !== '') return false
      } else if (privacyMode !== filters.privacy_mode) {
        return false
      }
    }
    const search = String(filters.search || '')
      .trim()
      .toLowerCase()
    if (search && !account.name.toLowerCase().includes(search)) return false
    return true
  }

  const patchAccountInList = (updatedAccount: Account) => {
    const rows = accountsRef.current
    const index = rows.findIndex((account) => account.id === updatedAccount.id)
    if (index === -1) return
    const mergedAccount = mergeRuntimeFields(rows[index] as Account, updatedAccount)
    if (!accountMatchesCurrentFilters(mergedAccount)) {
      setAccounts(rows.filter((account) => account.id !== mergedAccount.id))
      syncPaginationAfterLocalRemoval()
      removeSelectedAccounts([mergedAccount.id])
      if (live.current.menu.acc?.id === mergedAccount.id) {
        const next = { show: false, acc: null, anchorRect: live.current.menu.anchorRect }
        live.current = { ...live.current, menu: next }
        setMenu(next)
      }
      return
    }
    const nextAccounts = [...rows]
    nextAccounts[index] = mergedAccount
    setAccounts(nextAccounts)
    syncAccountRefs(mergedAccount)
  }

  const patchUpstreamBillingSnapshot = (accountID: number, snapshot: UpstreamBillingProbeSnapshot) => {
    const account = accountsRef.current.find((item) => item.id === accountID)
    if (!account) return
    setUpstreamBillingNow(currentTime())
    patchAccountInList({
      ...account,
      ...(typeof snapshot.synced_rate_multiplier === 'number' ? { rate_multiplier: snapshot.synced_rate_multiplier } : {}),
      extra: { ...account.extra, upstream_billing_probe: snapshot }
    } as Account)
  }

  const refreshAccountsAfterUpstreamBillingProbe = async () => {
    await refreshUpstreamBillingSortedList(true)
  }

  const handleBulkProbeUpstreamBilling = async () => {
    const accountIDs = [...selIds]
    if (accountIDs.length === 0) {
      useAppStore.getState().showError(t('admin.accounts.upstreamBilling.noEligibleAccounts'))
      return
    }
    if (accountIDs.length > 20) {
      useAppStore.getState().showError(t('admin.accounts.upstreamBilling.batchLimit'))
      return
    }
    setProbing((draft) => accountIDs.forEach((id) => draft.add(id)))
    try {
      const results = await adminAPI.accounts.probeUpstreamBillingBatch(accountIDs)
      let patched = false
      results.forEach((result) => {
        if (result.snapshot) {
          patchUpstreamBillingSnapshot(result.account_id, result.snapshot)
          patched = true
        }
      })
      if (patched) await refreshAccountsAfterUpstreamBillingProbe()
      const failed = results.filter((result) => result.error).length
      if (failed > 0) {
        useAppStore.getState().showError(t('admin.accounts.upstreamBilling.batchPartial', { success: results.length - failed, failed }))
      } else {
        useAppStore.getState().showSuccess(t('admin.accounts.upstreamBilling.batchCompleted', { count: results.length }))
      }
    } catch (error) {
      console.error('Failed to probe upstream billing in batch:', error)
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.accounts.upstreamBilling.probeFailed')))
    } finally {
      setProbing((draft) => accountIDs.forEach((id) => draft.delete(id)))
    }
  }

  const updateSchedulableInList = (accountIds: number[], schedulable: boolean) => {
    if (accountIds.length === 0) return
    const idSet = new Set(accountIds)
    setAccounts(accountsRef.current.map((account) => (idSet.has(account.id) ? { ...account, schedulable } : account)))
  }

  const handleBulkToggleSchedulable = async (schedulable: boolean) => {
    const accountIds = [...selIds]
    try {
      const result = await adminAPI.accounts.bulkUpdate(accountIds, { schedulable })
      const { successIds, failedIds, successCount, failedCount, hasIds, hasCounts } = normalizeBulkSchedulableResult(result, accountIds)
      if (!hasIds && !hasCounts) {
        useAppStore.getState().showError(t('admin.accounts.bulkSchedulableResultUnknown'))
        setSelectedIds(accountIds)
        load().catch((error) => {
          console.error('Failed to refresh accounts:', error)
        })
        return
      }
      if (successIds.length > 0) {
        updateSchedulableInList(successIds, schedulable)
      }
      if (successCount > 0 && failedCount === 0) {
        const message = schedulable
          ? t('admin.accounts.bulkSchedulableEnabled', { count: successCount })
          : t('admin.accounts.bulkSchedulableDisabled', { count: successCount })
        useAppStore.getState().showSuccess(message)
      }
      if (failedCount > 0) {
        const message =
          hasCounts || hasIds
            ? t('admin.accounts.bulkSchedulablePartial', { success: successCount, failed: failedCount })
            : t('admin.accounts.bulkSchedulableResultUnknown')
        useAppStore.getState().showError(message)
        setSelectedIds(failedIds.length > 0 ? failedIds : accountIds)
      } else {
        if (hasIds) clearSelection()
        else setSelectedIds(accountIds)
      }
    } catch (error) {
      console.error('Failed to bulk toggle schedulable:', error)
      useAppStore.getState().showError(t('common.error'))
    }
  }

  const buildBulkEditFilterSnapshot = () => {
    const rawParams = paramsRef.current as Record<string, unknown>
    const sortOrder: AccountSortOrder = rawParams.sort_order === 'desc' ? 'desc' : 'asc'
    return {
      platform: typeof rawParams.platform === 'string' ? rawParams.platform : '',
      model: typeof rawParams.model === 'string' ? rawParams.model : '',
      type: typeof rawParams.type === 'string' ? rawParams.type : '',
      status: typeof rawParams.status === 'string' ? rawParams.status : '',
      group: typeof rawParams.group === 'string' ? rawParams.group : '',
      search: typeof rawParams.search === 'string' ? rawParams.search : '',
      privacy_mode: typeof rawParams.privacy_mode === 'string' ? rawParams.privacy_mode : '',
      sort_by: typeof rawParams.sort_by === 'string' ? rawParams.sort_by : '',
      sort_order: sortOrder
    }
  }

  const handleSelectAllResults = async () => {
    if (selectingAllResults || paginationRef.current.total === 0) return

    const requestVersion = ++selectionRequestVersion.current
    const filters = buildBulkEditFilterSnapshot()
    setSelectingAllResults(true)
    try {
      const ids = await fetchAllAccountIds(
        (page, pageSize, requestFilters) => adminAPI.accounts.list(page, pageSize, requestFilters as any),
        filters
      )
      if (requestVersion !== selectionRequestVersion.current) return

      setSelectedIds(ids)
      setSelectedAllResultIDs(new Set(ids))
    } catch (error) {
      if (requestVersion !== selectionRequestVersion.current) return
      console.error('Failed to select all account results:', error)
      useAppStore.getState().showError(t('admin.accounts.bulkActions.selectAllFailed'))
    } finally {
      if (requestVersion === selectionRequestVersion.current) {
        setSelectingAllResults(false)
      }
    }
  }

  const collectSelectionMetadata = (rows: Account[]) => {
    const selectedPlatforms = Array.from(new Set(rows.map((account) => account.platform)))
    const selectedTypes = Array.from(new Set(rows.map((account) => account.type)))
    return { selectedPlatforms, selectedTypes }
  }

  const openBulkEditSelected = () => {
    setBulkEditTarget({
      mode: 'selected',
      accountIds: [...selIds],
      selectedPlatforms: [...selPlatforms],
      selectedTypes: [...selTypes]
    })
    setShowBulkEdit(true)
  }

  const openBulkEditFiltered = async () => {
    const filters = buildBulkEditFilterSnapshot()
    const preview = await adminAPI.accounts.list(1, 100, filters)
    const { selectedPlatforms, selectedTypes } = collectSelectionMetadata(preview.items)
    setBulkEditTarget({
      mode: 'filtered',
      filters,
      previewCount: preview.total,
      selectedPlatforms,
      selectedTypes
    })
    setShowBulkEdit(true)
  }

  const handleBulkUpdated = () => {
    setShowBulkEdit(false)
    setBulkEditTarget(null)
    clearSelection()
    reloadQuietly()
  }

  const handleDataImported = () => {
    setShowImportData(false)
    reloadQuietly()
  }

  const handleProbeUpstreamBilling = async (account: Account) => {
    if (probingRef.current.has(account.id)) return
    setProbing((draft) => draft.add(account.id))
    try {
      const result = await adminAPI.accounts.probeUpstreamBilling(account.id)
      if (result.snapshot) {
        patchUpstreamBillingSnapshot(account.id, result.snapshot)
        await refreshAccountsAfterUpstreamBillingProbe()
      }
    } catch (error) {
      console.error('Failed to probe upstream billing:', error)
      useAppStore.getState().showError(extractApiErrorMessage(error, t('admin.accounts.upstreamBilling.probeFailed')))
    } finally {
      setProbing((draft) => draft.delete(account.id))
    }
  }

  const handleAccountUpdated = (updatedAccount: Account) => {
    if (paramsRef.current.model) {
      reloadQuietly()
      enterAutoRefreshSilentWindow()
      return
    }
    patchAccountInList(updatedAccount)
    enterAutoRefreshSilentWindow()
  }

  const accountExportStepUp = useStepUp()

  const handleExportData = async () => {
    if (exportingDataRef.current) return
    exportingDataRef.current = true
    try {
      const ids = live.current.selIds
      const dataPayload = await accountExportStepUp.run(() =>
        adminAPI.accounts.exportData(
          ids.length > 0
            ? { ids, includeProxies: includeProxyOnExport }
            : {
                includeProxies: includeProxyOnExport,
                filters: buildAccountQueryFilters()
              }
        )
      )
      const timestamp = formatExportTimestamp()
      const filename = `sub2api-account-${timestamp}.json`
      const blob = new Blob([JSON.stringify(dataPayload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
      // spark 影子账号被后端排除出备份(其凭据透传母账号、调度配置不可经凭据型导入重建);
      // 跳过非零时明确提示用户,避免「下载成功但少了账号」的静默丢失。
      if (dataPayload.skipped_shadows && dataPayload.skipped_shadows > 0) {
        useAppStore.getState().showWarning(t('admin.accounts.dataExportedSkippedShadows', { count: dataPayload.skipped_shadows }))
      } else {
        useAppStore.getState().showSuccess(t('admin.accounts.dataExported'))
      }
    } catch (error: any) {
      if (isStepUpCancelled(error)) {
        // 用户主动取消 step-up 验证，静默返回，不弹错误提示。
      } else if (isStepUpBlocked(error)) {
        useAppStore.getState().showError(
          stepUpBlockReason(error) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN' ? t('stepUp.adminApiKeyForbidden') : t('stepUp.notEnabled')
        )
      } else {
        useAppStore.getState().showError(error?.message || t('admin.accounts.dataExportFailed'))
      }
    } finally {
      exportingDataRef.current = false
      setShowExportDataDialog(false)
    }
  }

  const closeTestModal = () => {
    setShowTest(false)
    setTestingAcc(null)
  }
  const closeStatsModal = () => {
    setShowStats(false)
    setStatsAcc(null)
  }
  const closeReAuthModal = () => {
    setShowReAuth(false)
    setReAuthAcc(null)
  }
  const handleTest = async (a: AccountListItem) => {
    const account = await loadAccountDetails(a)
    if (!account) return
    setTestingAcc(account)
    setShowTest(true)
  }
  const handleViewStats = async (a: AccountListItem) => {
    const account = await loadAccountDetails(a)
    if (!account) return
    setStatsAcc(account)
    setShowStats(true)
  }
  const handleSchedule = async (a: Account) => {
    setScheduleAcc(a)
    setScheduleModelOptions([])
    setShowSchedulePanel(true)
    try {
      const models = await adminAPI.accounts.getAvailableModels(a.id)
      setScheduleModelOptions(models.map((m: ClaudeModel) => ({ value: m.id, label: m.display_name || m.id })))
    } catch {
      setScheduleModelOptions([])
    }
  }
  const closeSchedulePanel = () => {
    setShowSchedulePanel(false)
    setScheduleAcc(null)
    setScheduleModelOptions([])
  }
  const handleReAuth = (a: Account) => {
    setReAuthAcc(a)
    setShowReAuth(true)
  }
  const duplicatingAccountIDs = useRef(new Set<number>())
  const handleDuplicateAccount = async (a: Account) => {
    if (duplicatingAccountIDs.current.has(a.id)) return
    duplicatingAccountIDs.current.add(a.id)
    try {
      const duplicate = await adminAPI.accounts.duplicate(a.id)
      useAppStore.getState().showSuccess(t('admin.accounts.duplicateSuccess', { name: duplicate.name }))
      reloadQuietly()
    } catch (error: any) {
      console.error('Failed to duplicate account:', error)
      useAppStore.getState().showError(error?.message || t('admin.accounts.duplicateFailed'))
    } finally {
      duplicatingAccountIDs.current.delete(a.id)
    }
  }
  const handleRefresh = async (a: Account) => {
    try {
      const result = await adminAPI.accounts.refreshCredentials(a.id)
      patchAccountInList(result.account)
      enterAutoRefreshSilentWindow()
      if (result.warning) useAppStore.getState().showWarning(result.message)
    } catch (error) {
      console.error('Failed to refresh credentials:', error)
    }
  }
  const handleRecoverState = async (a: Account) => {
    try {
      const updated = await adminAPI.accounts.recoverState(a.id)
      patchAccountInList(updated)
      enterAutoRefreshSilentWindow()
      useAppStore.getState().showSuccess(t('admin.accounts.recoverStateSuccess'))
    } catch (error: any) {
      console.error('Failed to recover account state:', error)
      useAppStore.getState().showError(error?.message || t('admin.accounts.recoverStateFailed'))
    }
  }
  const handleResetQuota = async (a: Account) => {
    try {
      const updated = await adminAPI.accounts.resetAccountQuota(a.id)
      patchAccountInList(updated)
      enterAutoRefreshSilentWindow()
      useAppStore.getState().showSuccess(t('common.success'))
    } catch (error) {
      console.error('Failed to reset quota:', error)
    }
  }

  const privacyResultMessageKey = (account: Account): { type: 'success' | 'error'; key: string } => {
    const mode = typeof account.extra?.privacy_mode === 'string' ? account.extra.privacy_mode : ''
    if (account.platform === 'openai') {
      switch (mode) {
        case 'training_off':
          return { type: 'success', key: 'admin.accounts.privacyTrainingOff' }
        case 'training_set_cf_blocked':
          return { type: 'error', key: 'admin.accounts.privacyCfBlocked' }
        default:
          return { type: 'error', key: 'admin.accounts.privacyFailed' }
      }
    }
    if (account.platform === 'antigravity') {
      if (mode === 'privacy_set') {
        return { type: 'success', key: 'admin.accounts.privacyAntigravitySet' }
      }
      return { type: 'error', key: 'admin.accounts.privacyAntigravityFailed' }
    }
    return { type: 'error', key: 'admin.accounts.privacyFailed' }
  }

  const handleSetPrivacy = async (a: Account) => {
    try {
      const updated = await adminAPI.accounts.setPrivacy(a.id)
      patchAccountInList(updated)
      enterAutoRefreshSilentWindow()
      const result = privacyResultMessageKey(updated)
      if (result.type === 'success') {
        useAppStore.getState().showSuccess(t(result.key))
      } else {
        useAppStore.getState().showError(t(result.key))
      }
    } catch (error: any) {
      console.error('Failed to set privacy:', error)
      useAppStore.getState().showError(error?.response?.data?.message || t('admin.accounts.privacyFailed'))
    }
  }
  const onRevertFallback = async (a: Account) => {
    try {
      await adminAPI.accounts.revertProxyFallback(a.id)
      useAppStore.getState().showSuccess(t('admin.accounts.revertProxySuccess'))
      reloadQuietly()
    } catch (error: any) {
      console.error('Failed to revert proxy fallback:', error)
      useAppStore.getState().showError(error?.response?.data?.message || t('admin.accounts.revertProxyFailed'))
    }
  }
  const handleCreateSparkShadow = (a: Account) => {
    setCreatingShadowAcc(a)
    setShowCreateShadowDialog(true)
  }
  const confirmCreateSparkShadow = async () => {
    const a = creatingShadowAcc
    if (!a) return
    try {
      await adminAPI.accounts.createSparkShadow(a.id, { name: `${a.name} (Spark)` })
      setShowCreateShadowDialog(false)
      setCreatingShadowAcc(null)
      useAppStore.getState().showSuccess(t('admin.accounts.createSparkShadowSuccess'))
      reloadQuietly()
    } catch (error: any) {
      console.error('Failed to create spark shadow:', error)
      useAppStore.getState().showError(error?.response?.data?.message || t('admin.accounts.createSparkShadowFailed'))
    }
  }
  const handleDelete = (a: AccountListItem) => {
    setDeletingAcc(a as Account)
    setShowDeleteDialog(true)
  }
  const confirmDelete = async () => {
    if (!deletingAcc) return
    try {
      await adminAPI.accounts.delete(deletingAcc.id)
      setShowDeleteDialog(false)
      setDeletingAcc(null)
      reloadQuietly()
    } catch (error) {
      console.error('Failed to delete account:', error)
    }
  }
  const handleToggleSchedulable = async (a: AccountListItem) => {
    const nextSchedulable = !a.schedulable
    setTogglingSchedulable(a.id)
    try {
      const updated = await adminAPI.accounts.setSchedulable(a.id, nextSchedulable)
      updateSchedulableInList([a.id], updated?.schedulable ?? nextSchedulable)
      enterAutoRefreshSilentWindow()
    } catch (error) {
      console.error('Failed to toggle schedulable:', error)
      useAppStore.getState().showError(t('admin.accounts.failedToToggleSchedulable'))
    } finally {
      setTogglingSchedulable(null)
    }
  }
  const handleShowTempUnsched = (a: Account) => {
    setTempUnschedAcc(a)
    setShowTempUnsched(true)
  }
  const handleTempUnschedReset = (updated: Account) => {
    setShowTempUnsched(false)
    setTempUnschedAcc(null)
    patchAccountInList(updated)
    enterAutoRefreshSilentWindow()
  }

  // ==================== 生命周期 ====================

  // 表格滚动时关闭行操作菜单（菜单内部滚动除外）
  useEffect(() => {
    const handleScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.action-menu-content')) return
      if (!live.current.menu.show) return
      live.current = { ...live.current, menu: { ...live.current.menu, show: false } }
      setMenu((prev) => ({ ...prev, show: false }))
    }
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [])

  const mountRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    mountRef.current = () => {
      load().catch(() => {
        // useTableLoader 已记录加载错误
      })
      void loadUpstreamBillingProbeGlobalState()
      if (live.current.autoRefreshEnabled) {
        setAutoRefreshCountdown(live.current.autoRefreshIntervalSeconds)
      }
    }
  })
  useEffect(() => {
    let cancelled = false
    mountRef.current()
    // 代理与分组各自独立加载：代理服务故障不应连带清空分组筛选选项，
    // 反之亦然（两者是账号表不同维度的筛选项）。
    void (async () => {
      const [proxiesResult, groupsResult] = await Promise.allSettled([adminAPI.proxies.getAll(), adminAPI.groups.getAll()])
      if (cancelled) return
      if (proxiesResult.status === 'fulfilled') {
        setProxies(proxiesResult.value)
      } else {
        console.error('Failed to load proxies:', proxiesResult.reason)
      }
      if (groupsResult.status === 'fulfilled') {
        setGroups(groupsResult.value)
      } else {
        console.error('Failed to load groups:', groupsResult.reason)
      }
      try {
        const loadModelOptions = adminAPI.accounts.getModelOptions
        if (typeof loadModelOptions === 'function') {
          const options = await loadModelOptions()
          if (!cancelled) setModelOptions(options)
        }
      } catch (error) {
        console.error('Failed to load account model options:', error)
      }
    })()
    const pendingIds = pendingUsageBatchIds.current
    return () => {
      cancelled = true
      upstreamBillingRateAbortController.current?.abort()
      if (usageBatchFlushTimer.current !== null) {
        clearTimeout(usageBatchFlushTimer.current)
        usageBatchFlushTimer.current = null
      }
      pendingIds.clear()
    }
  }, [])

  // ==================== 列 ====================

  const allColumns = useMemo(() => {
    const c: Column<AccountListItem>[] = [
      { key: 'select', label: '', sortable: false },
      { key: 'name', label: t('admin.accounts.columns.name'), sortable: true },
      { key: 'id', label: t('admin.accounts.columns.id'), sortable: true },
      { key: 'platform_type', label: t('admin.accounts.columns.platformType'), sortable: false },
      { key: 'capacity', label: t('admin.accounts.columns.capacity'), sortable: false },
      { key: 'status', label: t('admin.accounts.columns.status'), sortable: true },
      { key: 'schedulable', label: t('admin.accounts.columns.schedulable'), sortable: true },
      { key: 'today_stats', label: t('admin.accounts.columns.todayStats'), sortable: false }
    ]
    if (!isSimpleMode) {
      c.push({ key: 'groups', label: t('admin.accounts.columns.groups'), sortable: false })
    }
    c.push({ key: 'usage', label: t('admin.accounts.columns.usageWindows'), sortable: false })
    c.push(
      { key: 'proxy', label: t('admin.accounts.columns.proxy'), sortable: false },
      { key: 'priority', label: t('admin.accounts.columns.priority'), sortable: true },
      { key: 'scheduler_score', label: t('admin.accounts.columns.schedulerScore'), sortable: false },
      { key: 'rate_multiplier', label: t('admin.accounts.columns.billingRateMultiplier'), sortable: true },
      { key: 'upstream_billing_rate', label: t('admin.accounts.columns.upstreamBillingRate'), sortable: true },
      { key: 'last_used_at', label: t('admin.accounts.columns.lastUsed'), sortable: true },
      { key: 'created_at', label: t('admin.accounts.columns.createdAt'), sortable: true },
      { key: 'expires_at', label: t('admin.accounts.columns.expiresAt'), sortable: true },
      { key: 'notes', label: t('admin.accounts.columns.notes'), sortable: false },
      { key: 'actions', label: t('admin.accounts.columns.actions'), sortable: false }
    )
    return c
  }, [t, isSimpleMode])

  // Columns that can be toggled (exclude select, name, and actions)
  const toggleableColumns = allColumns.filter((col) => col.key !== 'select' && col.key !== 'name' && col.key !== 'actions')

  // Filtered columns based on visibility
  const cols = useMemo(
    () =>
      allColumns.filter(
        (col) => col.key === 'select' || col.key === 'name' || col.key === 'actions' || !hiddenColumns.has(col.key)
      ),
    [allColumns, hiddenColumns]
  )

  // ==================== 单元格 ====================

  const accountGroupsForRow = (account: Pick<AccountListItem, 'group_ids'>): AdminGroup[] => {
    const groupIDs = account.group_ids ?? []
    if (groupIDs.length === 0) return []
    return groupIDs.map((id) => groupsByID.get(id)).filter((group): group is AdminGroup => Boolean(group))
  }

  const getAntigravityTierLabel = (row: any): string | null => {
    switch (getAntigravityTierFromRow(row)) {
      case 'free-tier':
        return t('admin.accounts.tier.free')
      case 'g1-pro-tier':
        return t('admin.accounts.tier.pro')
      case 'g1-ultra-tier':
        return t('admin.accounts.tier.ultra')
      default:
        return null
    }
  }

  const getOpenAICompactMeta = (row: any): { label: string; tone: 'success' | 'danger' | 'muted' } | null => {
    const state = getOpenAICompactState(row)
    if (!state) return null
    switch (state) {
      case 'active':
        return { label: t('admin.accounts.openai.compactSupported'), tone: 'success' }
      case 'blocked':
        return { label: t('admin.accounts.openai.compactUnsupported'), tone: 'danger' }
      case 'auto':
        return { label: t('admin.accounts.openai.compactAuto'), tone: 'muted' }
    }
  }

  const getOpenAICompactTitle = (row: any): string => {
    const extra = row.extra as Record<string, unknown> | undefined
    const checkedAt = typeof extra?.openai_compact_checked_at === 'string' ? extra.openai_compact_checked_at : ''
    const label = getOpenAICompactMeta(row)?.label || ''
    if (!checkedAt) return label
    return `${label} | ${t('admin.accounts.openai.compactLastChecked')}: ${formatDateTime(new Date(checkedAt))}`
  }

  const formatSchedulerScoreGroup = (score: AccountSchedulerGroupScore): string => {
    if ('group_name' in score && score.group_name) return score.group_name
    if ('group_id' in score && score.group_id != null) return `#${score.group_id}`
    return t('admin.accounts.schedulerScore.ungrouped')
  }

  const proxyExpiryText = (p: AccountProxy): string => {
    const { key, params: labelParams } = proxyExpiryLabelKey(p.expires_at, p.status)
    return labelParams ? t(key, labelParams) : t(key)
  }

  const headerWithHint = (hint: string, width: string, stop = true) =>
    function HeaderWithHint({ column }: DataTableHeaderContext) {
      return (
        <div className={styles.headerHint}>
          <span>{column.label}</span>
          {stop ? (
            <span onClick={(event) => event.stopPropagation()}>
              <HelpTooltip content={hint} width={width} />
            </span>
          ) : (
            <HelpTooltip content={hint} width={width} />
          )}
        </div>
      )
    }

  const headers: Record<string, (context: DataTableHeaderContext) => ReactNode> = {
    select: () => (
      <Checkbox
        checked={allVisibleSelected}
        aria-label={t('common.selectAll')}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(checked) => toggleVisible(checked === true)}
      />
    ),
    usage: headerWithHint(t('admin.accounts.usageWindowsHint'), '18rem', false),
    upstream_billing_rate: headerWithHint(t('admin.accounts.upstreamBilling.trustWarning'), '20rem'),
    priority: headerWithHint(t('admin.accounts.priorityOrderHint'), '20rem'),
    scheduler_score: headerWithHint(t('admin.accounts.schedulerScore.hint'), '20rem', false)
  }

  type Cell = (context: DataTableCellContext<AccountListItem>) => ReactNode
  const cells: Record<string, Cell> = {
    select: ({ row }) => (
      <Checkbox
        checked={selectedSet.has(row.id)}
        aria-label={`${t('common.selectOption')} ${row.id}`}
        onCheckedChange={() => toggleSel(row.id)}
      />
    ),
    id: ({ value }) => <span className={styles.mono}>#{value}</span>,
    name: ({ row, value }) => {
      const homepage = accountHomepageUrl(row as Account)
      const email = accountDisplayEmail(row)
      return (
        <div className={styles.nameCell}>
          {/* 拖拽把手：只有按住它才能拖动排序，按住行其它地方仍然是滑动多选。 */}
          <button
            type="button"
            className={styles.dragHandle}
            data-active={priorityDrag.activeId === row.id ? '' : undefined}
            title={t('admin.accounts.sortOrder.dragHint')}
            aria-label={t('admin.accounts.sortOrder.dragHint')}
            data-testid="account-priority-drag-handle"
            onMouseDown={(event) => {
              event.stopPropagation()
              event.preventDefault()
              priorityDrag.start(event.nativeEvent, row)
            }}
            onTouchStart={(event) => {
              event.stopPropagation()
              priorityDrag.start(event.nativeEvent, row)
            }}
          >
            <GripVertical size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <div className={styles.nameStack}>
            {homepage ? (
              <HelpTooltip
                content={homepage}
                width="24rem"
                className={styles.homepageTooltip}
                triggerContent={
                  <a href={homepage} target="_blank" rel="noopener noreferrer" className={styles.homepageLink}>
                    {value}
                  </a>
                }
              />
            ) : (
              <span className={styles.name}>{value}</span>
            )}
            {email && (
              <span
                className={styles.email}
                title={email + (row.parent_chatgpt_account_id ? ' · ' + row.parent_chatgpt_account_id : '')}
              >
                {email}
              </span>
            )}
          </div>
        </div>
      )
    },
    notes: ({ value }) =>
      value ? (
        <span title={value} className={styles.notes}>
          {value}
        </span>
      ) : (
        <span className={styles.dash}>-</span>
      ),
    platform_type: ({ row }) => {
      const tierLabel = getAntigravityTierLabel(row)
      const compact = getOpenAICompactMeta(row)
      return (
        <div className={styles.platformCell}>
          <div className={styles.inlineWrap}>
            <PlatformTypeBadge
              platform={row.platform}
              type={row.type}
              authMode={getOpenAIAuthMode(row)}
              planType={getAccountPlanType(row)}
              privacyMode={(row.extra?.privacy_mode || row.parent_privacy_mode) as string | undefined}
              subscriptionExpiresAt={(row.credentials?.subscription_expires_at || row.parent_subscription_expires_at) as string | undefined}
            />
            {tierLabel && (
              <Badge size="sm" tone={antigravityTierTone(getAntigravityTierFromRow(row))}>
                {tierLabel}
              </Badge>
            )}
          </div>
          {compact && (
            <div className={styles.compactMeta} data-tone={compact.tone} title={getOpenAICompactTitle(row)}>
              <span className={styles.compactDot} aria-hidden="true" />
              <span>{compact.label}</span>
            </div>
          )}
        </div>
      )
    },
    capacity: ({ row }) => <AccountCapacityCell account={row as Account} />,
    status: ({ row }) => (
      <div className={styles.inline}>
        <AccountStatusIndicator account={row as Account} onShowTempUnsched={handleShowTempUnsched} />
      </div>
    ),
    schedulable: ({ row }) => (
      <Switch
        checked={row.schedulable}
        disabled={togglingSchedulable === row.id}
        aria-label={row.schedulable ? t('admin.accounts.schedulableEnabled') : t('admin.accounts.schedulableDisabled')}
        title={row.schedulable ? t('admin.accounts.schedulableEnabled') : t('admin.accounts.schedulableDisabled')}
        onCheckedChange={() => void handleToggleSchedulable(row)}
      />
    ),
    today_stats: ({ row }) => (
      <AccountTodayStatsCell
        stats={todayStatsByAccountId[String(row.id)] ?? null}
        loading={todayStatsLoading}
        error={todayStatsError}
      />
    ),
    groups: ({ row }) => <AccountGroupsCell groups={accountGroupsForRow(row)} maxDisplay={4} />,
    usage: ({ row }) => (
      <AccountUsageCell
        account={row as Account}
        todayStats={todayStatsByAccountId[String(row.id)] ?? null}
        todayStatsLoading={todayStatsLoading}
        manualRefreshToken={usageManualRefreshToken}
        batchedUsage={usageBatch.usage[String(row.id)] ?? null}
        batchedUsageError={usageBatch.errors[String(row.id)] ?? null}
        batchedUsageLoading={usageBatch.loading[String(row.id)] === true}
        requestBatchedUsage={isDesktopViewport ? queueBatchedUsage : null}
        onAccountUpdated={handleAccountUpdated}
        onUsageLoaded={(usage) => handleAccountUsageLoaded(row.id, usage)}
      />
    ),
    proxy: ({ row }) => {
      const proxy = row.proxy
      const tone = proxy?.expires_at ? proxyExpiryTone(proxy) : null
      return (
        <div className={styles.stack}>
          {proxy ? (
            <div className={styles.inline}>
              <span className={styles.text}>{proxy.name}</span>
              {proxy.country_code && <span className={styles.muted}>({proxy.country_code})</span>}
            </div>
          ) : (
            <span className={styles.dash}>-</span>
          )}
          {proxy && proxy.expires_at && (
            <div className={styles.inline}>
              <span className={styles.secondary}>{formatDateTime(proxy.expires_at)}</span>
              {tone ? (
                <Badge size="sm" tone={tone}>
                  {proxyExpiryText(proxy)}
                </Badge>
              ) : (
                <span className={styles.muted}>{proxyExpiryText(proxy)}</span>
              )}
            </div>
          )}
          {row.proxy_fallback_origin_id && (
            <div className={styles.inline}>
              <Badge size="sm" tone="warning" title={t('admin.accounts.fallbackActiveTip', { origin: row.proxy_fallback_origin_name })}>
                {t('admin.accounts.fallbackActive')}
              </Badge>
              <Button type="button" variant="secondary" size="sm" onClick={() => void onRevertFallback(row as Account)}>
                {t('admin.accounts.revertProxy')}
              </Button>
            </div>
          )}
        </div>
      )
    },
    rate_multiplier: ({ row }) => (
      <span className={styles.rate}>
        <span>{formatMultiplier(row.rate_multiplier ?? 1)}x</span>
        {row.extra?.upstream_billing_rate_sync_enabled === true && (
          <span
            className={styles.rateSync}
            aria-label={t('admin.accounts.upstreamBilling.syncedRateTooltip')}
            title={t('admin.accounts.upstreamBilling.syncedRateTooltip')}
            data-testid="account-rate-sync-indicator"
          >
            <RefreshCw size={12} strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
      </span>
    ),
    upstream_billing_rate: ({ row }) => (
      <UpstreamBillingRateCell
        account={row as Account}
        globalProbeEnabled={upstreamBillingProbeGloballyEnabled}
        now={upstreamBillingNow}
        probing={probingUpstreamBilling.has(row.id)}
        onProbe={() => void handleProbeUpstreamBilling(row as Account)}
      />
    ),
    priority: ({ row }) => <AccountPriorityCell rank={priorityRankByAccountID.get(row.id) ?? 0} />,
    scheduler_score: ({ row }) => {
      const scores = getSchedulerScoreRows(row as Account)
      if (!scores.length) return <span className={styles.dash}>-</span>
      return (
        <div className={styles.scores}>
          {scores.map((score) => (
            <div
              key={String(score.group_id)}
              className={styles.scoreRow}
              title={`${formatSchedulerScoreGroup(score)} / ${formatSchedulerScore(score.base_score)} / ${formatStickySchedulerScore(score)}`}
            >
              <span className={styles.scoreGroup}>{formatSchedulerScoreGroup(score)}</span>
              <span className={styles.scoreSep}>/</span>
              <span>{formatSchedulerScore(score.base_score)}</span>
              <span className={styles.scoreSep}>/</span>
              <span className={styles.scoreSticky}>{formatStickySchedulerScore(score)}</span>
            </div>
          ))}
        </div>
      )
    },
    last_used_at: ({ value }) => <span className={styles.secondary}>{formatRelativeTime(value)}</span>,
    created_at: ({ value }) => <span className={styles.secondary}>{formatDateTime(value)}</span>,
    expires_at: ({ row, value }) => (
      <div className={styles.stackStart}>
        <span className={styles.secondary}>{formatExpiresAt(value)}</span>
        {(isExpired(value) || (row.auto_pause_on_expired && value)) && (
          <div className={styles.inline}>
            {isExpired(value) && (
              <Badge size="sm" tone="warning">
                {t('admin.accounts.expired')}
              </Badge>
            )}
            {row.auto_pause_on_expired && value && (
              <Badge size="sm" tone="success">
                {t('admin.accounts.autoPauseOnExpired')}
              </Badge>
            )}
          </div>
        )}
      </div>
    ),
    actions: ({ row }) => (
      <div className={styles.actions}>
        <button type="button" className={styles.actionButton} onClick={() => void handleEdit(row)}>
          <Pencil {...iconProps} />
          <span>{t('common.edit')}</span>
        </button>
        <button type="button" className={styles.actionButton} data-tone="danger" onClick={() => handleDelete(row)}>
          <Trash2 {...iconProps} />
          <span>{t('common.delete')}</span>
        </button>
        <button type="button" className={styles.actionButton} onClick={(event) => openMenu(row, event)}>
          <MoreHorizontal {...iconProps} />
          <span>{t('common.more')}</span>
        </button>
      </div>
    )
  }

  const viewOptions = [
    { value: 'list', label: t('admin.accounts.accountList') },
    { value: 'statistics', label: t('admin.accounts.accountStatistics') },
    { value: 'failures', label: t('admin.accounts.failureLog') },
    { value: 'test', label: t('admin.accounts.accountTest') }
  ]

  const autoRefreshMenu = (
    <Popover
      open={showAutoRefreshDropdown}
      onOpenChange={(open) => {
        setShowAutoRefreshDropdown(open)
        if (open) setShowAccountToolsDropdown(false)
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" title={t('admin.accounts.autoRefresh')} aria-label={t('admin.accounts.autoRefresh')}>
          <RefreshCw size={16} strokeWidth={1.75} className={autoRefreshEnabled ? styles.spinning : undefined} aria-hidden="true" />
          <span className={styles.desktopOnly}>
            {autoRefreshEnabled
              ? t('admin.accounts.autoRefreshCountdown', { seconds: autoRefreshCountdown })
              : t('admin.accounts.autoRefresh')}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={styles.menuPanel}>
        <div className={styles.menuList} role="menu">
          <button type="button" role="menuitemcheckbox" aria-checked={autoRefreshEnabled} className={styles.menuItem} onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}>
            <span>{t('admin.accounts.enableAutoRefresh')}</span>
            {autoRefreshEnabled && <Check {...iconProps} className={styles.check} />}
          </button>
          <div className={styles.menuSeparator} role="separator" />
          {autoRefreshIntervals.map((sec) => (
            <button
              key={sec}
              type="button"
              role="menuitemradio"
              aria-checked={autoRefreshIntervalSeconds === sec}
              className={styles.menuItem}
              onClick={() => setAutoRefreshInterval(sec)}
            >
              <span>{autoRefreshIntervalLabel(sec)}</span>
              {autoRefreshIntervalSeconds === sec && <Check {...iconProps} className={styles.check} />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )

  const toolsMenu = (
    <Popover
      open={showAccountToolsDropdown}
      onOpenChange={(open) => {
        setShowAccountToolsDropdown(open)
        if (open) setShowAutoRefreshDropdown(false)
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" title={t('admin.accounts.moreActions')} aria-label={t('admin.accounts.moreActions')}>
          <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.desktopOnly}>{t('admin.accounts.moreActions')}</span>
          <ChevronDown size={14} strokeWidth={1.75} className={styles.desktopOnly} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={`${styles.menuPanel} ${styles.toolsPanel}`}>
        <div className={styles.menuList}>
          <div className={styles.menuHeading}>{t('admin.accounts.dataActions')}</div>
          <button type="button" className={styles.menuItem} onClick={openSyncFromCrs}>
            <span className={styles.menuItemLabel}>
              <RefreshCw {...iconProps} className={styles.menuIcon} />
              {t('admin.accounts.syncFromCrs')}
            </span>
          </button>
          <button type="button" className={styles.menuItem} onClick={openImportData}>
            <span className={styles.menuItemLabel}>
              <Upload {...iconProps} className={styles.menuIcon} />
              {t('admin.accounts.dataImport')}
            </span>
          </button>
          <button type="button" className={styles.menuItem} onClick={openExportDataDialogFromMenu}>
            <span className={styles.menuItemLabel}>
              <Download {...iconProps} className={styles.menuIcon} />
              {selIds.length ? t('admin.accounts.dataExportSelected') : t('admin.accounts.dataExport')}
            </span>
            {selIds.length > 0 && (
              <Badge size="sm" tone="info">
                {t('admin.accounts.selectedCount', { count: selIds.length })}
              </Badge>
            )}
          </button>

          <div className={styles.menuSeparator} role="separator" />
          <div className={styles.menuHeading}>{t('admin.accounts.toolActions')}</div>
          <button type="button" className={styles.menuItem} onClick={openSortOrderModal}>
            <span className={styles.menuItemLabel}>
              <SortAsc {...iconProps} className={styles.menuIcon} />
              {t('admin.accounts.sortOrder.title')}
            </span>
          </button>
          <button type="button" className={styles.menuItem} onClick={openErrorPassthrough}>
            <span className={styles.menuItemLabel}>
              <Shield {...iconProps} className={styles.menuIcon} />
              {t('admin.errorPassthrough.title')}
            </span>
          </button>
          <button type="button" className={styles.menuItem} onClick={openTLSFingerprintProfiles}>
            <span className={styles.menuItemLabel}>
              <Lock {...iconProps} className={styles.menuIcon} />
              {t('admin.tlsFingerprintProfiles.title')}
            </span>
          </button>

          <div className={styles.menuSeparator} role="separator" />
          <div className={styles.menuHeading}>
            <span>{t('admin.accounts.viewColumns')}</span>
            <Columns3 {...iconProps} />
          </div>
          {toggleableColumns.map((col) => (
            <button
              key={col.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={isColumnVisible(col.key)}
              className={styles.menuItem}
              onClick={() => toggleColumn(col.key)}
            >
              <span className={styles.truncate}>{col.label}</span>
              {isColumnVisible(col.key) && <Check {...iconProps} className={styles.check} />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )

  const filters = (
    <div className={styles.filters}>
      <div className={styles.toolbar}>
        <AccountTableFilters
          searchQuery={params.search}
          filters={params}
          groups={groups}
          models={modelOptions}
          onSearchQueryChange={(value) => {
            setParamsLocal({ search: value })
            debouncedReload()
          }}
          onFiltersChange={(newFilters) => setParamsLocal(newFilters)}
          onChange={debouncedReload}
        />
        <AccountTableActions
          loading={loading}
          onRefresh={() => void handleManualRefresh()}
          onCreate={() => setShowCreate(true)}
          after={
            <>
              <SegmentedControl
                options={viewOptions}
                value={accountView}
                onValueChange={(value) => setAccountView(value as AccountView)}
                label={t('admin.accounts.viewMode')}
              />
              {autoRefreshMenu}
              {toolsMenu}
            </>
          }
        />
      </div>
      {hasPendingListSync && (
        <div className={styles.pendingSync} role="status">
          <span>{t('admin.accounts.listPendingSyncHint')}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => void syncPendingListChanges()}>
            {t('admin.accounts.listPendingSyncAction')}
          </Button>
        </div>
      )}
    </div>
  )

  const table = (
    <div className={styles.region}>
      {accountView === 'list' && (
        <AccountBulkActionsBar
          selectedIds={selIds}
          totalResults={pagination.total}
          selectingAll={selectingAllResults}
          allResultsSelected={allResultsSelected}
          onDelete={() => void handleBulkDelete()}
          onResetStatus={() => void handleBulkResetStatus()}
          onRefreshToken={() => void handleBulkRefreshToken()}
          onProbeUpstreamBilling={() => void handleBulkProbeUpstreamBilling()}
          onEditSelected={openBulkEditSelected}
          onEditFiltered={() => void openBulkEditFiltered()}
          onClear={clearSelection}
          onSelectPage={selectPage}
          onSelectAllResults={() => void handleSelectAllResults()}
          onToggleSchedulable={(value) => void handleBulkToggleSchedulable(value)}
        />
      )}
      <div ref={accountTableRef} className={styles.tableArea}>
        {accountView === 'list' ? (
          <DataTable<AccountListItem>
            ref={dataTableRef}
            columns={cols}
            data={accounts}
            loading={loading}
            rowKey="id"
            serverSideSort
            onSort={handleSort}
            defaultSortKey="priority"
            defaultSortOrder="asc"
            sortStorageKey={ACCOUNT_SORT_STORAGE_KEY}
            estimateRowHeight={156}
            overscan={5}
            virtualizeThreshold={50}
            cells={cells}
            headers={headers}
            className={styles.dataTable}
          />
        ) : accountView === 'failures' ? (
          <AccountFailureHeatmap
            accounts={accounts as Account[]}
            byAccount={hourlyFailureData.by_account}
            date={hourlyFailureData.date}
            timezone={hourlyFailureData.timezone}
            loading={loading || hourlyFailureLoading}
            error={hourlyFailureError}
          />
        ) : accountView === 'statistics' ? (
          <AccountStatisticsTable
            accounts={accounts as Account[]}
            statsByAccount={todayStatsByAccountId}
            failuresByAccount={hourlyFailureData.by_account}
            loading={loading || todayStatsLoading || hourlyFailureLoading}
            error={todayStatsError || hourlyFailureError}
          />
        ) : (
          <AccountModelTestPanel accounts={accounts as Account[]} platform={params.platform} active={accountView === 'test'} />
        )}
      </div>
    </div>
  )

  return (
    <>
      <TablePageLayout
        filters={filters}
        table={table}
        pagination={
          pagination.total > 0 ? (
            <Pagination
              page={pagination.page}
              total={pagination.total}
              pageSize={pagination.page_size}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null
        }
      />
      <CreateAccountModal
        show={showCreate}
        proxies={proxies}
        groups={groups}
        onClose={() => setShowCreate(false)}
        onCreated={reloadQuietly}
      />
      <EditAccountModal
        show={showEdit}
        account={edAcc}
        proxies={proxies}
        groups={groups}
        onClose={() => setShowEdit(false)}
        onUpdated={handleAccountUpdated}
      />
      <ReAuthAccountModal show={showReAuth} account={reAuthAcc} onClose={closeReAuthModal} onReauthorized={handleAccountUpdated} />
      <AccountTestModal show={showTest} account={testingAcc} onClose={closeTestModal} />
      <AccountStatsModal show={showStats} account={statsAcc} onClose={closeStatsModal} />
      <ScheduledTestsPanel
        show={showSchedulePanel}
        accountId={scheduleAcc?.id ?? null}
        modelOptions={scheduleModelOptions}
        onClose={closeSchedulePanel}
      />
      <AccountActionMenu
        show={menu.show}
        account={menu.acc}
        anchorRect={menu.anchorRect}
        onClose={closeMenu}
        onTest={(a) => void handleTest(a)}
        onStats={(a) => void handleViewStats(a)}
        onSchedule={(a) => void handleSchedule(a)}
        onDuplicate={(a) => void handleDuplicateAccount(a)}
        onReauth={handleReAuth}
        onRefreshToken={(a) => void handleRefresh(a)}
        onRecoverState={(a) => void handleRecoverState(a)}
        onResetQuota={(a) => void handleResetQuota(a)}
        onSetPrivacy={(a) => void handleSetPrivacy(a)}
        onCreateSparkShadow={handleCreateSparkShadow}
      />
      <SyncFromCrsModal show={showSync} onClose={() => setShowSync(false)} onSynced={reloadQuietly} />
      <ImportDataModal show={showImportData} onClose={() => setShowImportData(false)} onImported={handleDataImported} />
      <BulkEditAccountModal
        show={showBulkEdit}
        accountIds={selIds}
        selectedPlatforms={selPlatforms}
        selectedTypes={selTypes}
        target={(bulkEditTarget ?? undefined) as BulkEditTarget | undefined}
        proxies={proxies}
        groups={groups}
        onClose={() => setShowBulkEdit(false)}
        onUpdated={handleBulkUpdated}
      />
      <TempUnschedStatusModal
        show={showTempUnsched}
        account={tempUnschedAcc}
        onClose={() => setShowTempUnsched(false)}
        onReset={handleTempUnschedReset}
      />
      <ConfirmDialog
        show={showDeleteDialog}
        title={t('admin.accounts.deleteAccount')}
        message={t('admin.accounts.deleteConfirm', { name: deletingAcc?.name })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setShowDeleteDialog(false)}
      />
      <ConfirmDialog
        show={showCreateShadowDialog}
        title={t('admin.accounts.createSparkShadow')}
        message={t('admin.accounts.createSparkShadowConfirm', { name: creatingShadowAcc?.name })}
        onConfirm={() => void confirmCreateSparkShadow()}
        onCancel={() => setShowCreateShadowDialog(false)}
      />
      <ConfirmDialog
        show={showExportDataDialog}
        title={t('admin.accounts.dataExport')}
        message={t('admin.accounts.dataExportConfirmMessage')}
        confirmText={t('admin.accounts.dataExportConfirm')}
        cancelText={t('common.cancel')}
        onConfirm={() => void handleExportData()}
        onCancel={() => setShowExportDataDialog(false)}
      >
        <Checkbox
          checked={includeProxyOnExport}
          onCheckedChange={(checked) => setIncludeProxyOnExport(checked === true)}
          label={t('admin.accounts.dataExportIncludeProxies')}
        />
      </ConfirmDialog>
      <ErrorPassthroughRulesModal show={showErrorPassthrough} onClose={() => setShowErrorPassthrough(false)} />
      <TLSFingerprintProfilesModal show={showTLSFingerprintProfiles} onClose={() => setShowTLSFingerprintProfiles(false)} />
      <AccountSortOrderModal show={showSortOrderModal} onClose={() => setShowSortOrderModal(false)} onSaved={reloadQuietly} />
      <TotpStepUpDialog controller={accountExportStepUp} />
      {confirmDialog}
    </>
  )
}
