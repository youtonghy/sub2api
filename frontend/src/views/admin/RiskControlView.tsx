/**
 * 内容审计（风控）页，对应 Vue 版 views/admin/RiskControlView.vue。
 * 概览指标、运行时状态（预拦截同步审计或异步 worker）、审计记录表格；设置表单放在右侧宽抽屉里按标签页分组。
 */
import {
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  Eye,
  FileText,
  Filter,
  FlaskConical,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
  type LucideIcon
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode
} from 'react'

import { adminAPI } from '@/api/admin'
import type {
  ContentModerationAPIKeyLoad,
  ContentModerationAPIKeyStatus,
  ContentModerationConfig,
  ContentModerationLog,
  ContentModerationModelFilterType,
  ContentModerationRuntimeStatus,
  ContentModerationTestAuditResult,
  KeywordBlockingMode,
  ModerationEngine,
  ModerationMode,
  UpdateContentModerationConfig
} from '@/api/admin/riskControl'
import ModelWhitelistSelector from '@/components/account/ModelWhitelistSelector'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { Alert } from '@/components/arc/alert/alert'
import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer'
import { MetricCard } from '@/components/arc/metric-card/metric-card'
import { RadioCards } from '@/components/arc/radio-cards/radio-cards'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import BaseDialog from '@/components/common/BaseDialog'
import DataTable, { type DataTableCellContext } from '@/components/common/DataTable'
import Pagination from '@/components/common/Pagination'
import ProxySelector from '@/components/common/ProxySelector'
import Select, { type SelectOption } from '@/components/common/Select'
import Skeleton from '@/components/common/Skeleton'
import Toggle from '@/components/common/Toggle'
import type { Column } from '@/components/common/types'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminGroup, Proxy } from '@/types'
import { extractApiErrorMessage } from '@/utils/apiError'
import { formatDateTime as formatDateTimeValue } from '@/utils/format'
import {
  apiKeyRowKey,
  applyEngineDraft,
  blockedKeywordMax,
  buildModelFilterPayload,
  buildRiskThresholdPayload,
  captureEngineDraft,
  defaultConfigForm,
  engineDraftFromConfig,
  engineDraftPayload,
  engineLabel,
  engineOptions,
  fileToDataURL,
  formatNumber,
  formatThresholdPercent,
  latencyText,
  maxModerationTestImageSize,
  maxModerationTestImages,
  maxVisibleApiKeyRows,
  normalizeDateTimeLocal,
  normalizeKeywordBlockingMode,
  normalizeModelFilter,
  parseApiKeys,
  parseBlockedKeywords,
  percent,
  percentWidth,
  riskThresholdCategories,
  riskThresholdDefaults,
  riskThresholdsFromConfig,
  toNumberInput,
  type ConfigForm,
  type EngineDraft,
  type NumberInput,
  type SettingsTab,
  type WorkerSlotState
} from './riskControl/model'
import styles from './RiskControlView.module.css'

type APIKeysWriteMode = 'append' | 'replace'
type APIKeyStatusValue = ContentModerationAPIKeyStatus['status']
type OverviewItem = {
  key: string
  label: string
  value: string
  meta: string
  icon: LucideIcon
  tone: 'success' | 'neutral' | 'info' | 'accent' | 'warning'
  badge?: string
  badgeTone?: BadgeTone
}
type ModerationScoreRow = { category: string; score: number; threshold: number; hit: boolean }
type RiskThresholdRow = { category: string; value: NumberInput; defaultValue: number }

interface LogPagination {
  page: number
  page_size: number
  total: number
  pages: number
}

interface LogFilters {
  result: string
  group_id: number
  endpoint: string
  search: string
  from: string
  to: string
}

type Updater<T> = T | ((prev: T) => T)

/** state + ref 镜像：异步流程里读最新值（对应 Vue ref 的同步可读性），渲染用 state */
function useStateRef<T>(initial: T | (() => T)) {
  const [state, setState] = useState<T>(initial)
  const ref = useRef<T>(state)
  const set = useCallback((next: Updater<T>) => {
    ref.current = typeof next === 'function' ? (next as (prev: T) => T)(ref.current) : next
    setState(ref.current)
  }, [])
  return [state, ref, set] as const
}

export default function RiskControlView() {
  const { t } = useI18n()
  const defaultBlockMessage = () => t('admin.riskControl.defaultBlockMessage')
  const { confirm, confirmDialog } = useConfirmDialog()

  const [loading, setLoading] = useState(true)
  const [saving, savingRef, setSaving] = useStateRef(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [apiKeyTesting, apiKeyTestingRef, setApiKeyTesting] = useStateRef(false)
  const [hashActionLoading, hashActionLoadingRef, setHashActionLoading] = useStateRef(false)
  const [unbanningUserID, unbanningUserIDRef, setUnbanningUserID] = useStateRef<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('basic')
  const [groupSearch, setGroupSearch] = useState('')
  const [flaggedHashInput, setFlaggedHashInput] = useState('')
  const [groups, setGroups] = useState<AdminGroup[]>([])
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [logs, setLogs] = useState<ContentModerationLog[]>([])
  const [status, statusRef, setStatus] = useStateRef<ContentModerationRuntimeStatus | null>(null)
  const [testedApiKeyStatuses, setTestedApiKeyStatuses] = useState<ContentModerationAPIKeyStatus[]>([])
  const [pendingDeleteApiKeyHashes, pendingDeletesRef, setPendingDeleteApiKeyHashes] = useStateRef<string[]>([])
  const [apiKeyRowsExpanded, setApiKeyRowsExpanded] = useState(false)
  const [moderationTestPrompt, moderationTestPromptRef, setModerationTestPrompt] = useStateRef('')
  const [moderationTestImages, moderationTestImagesRef, setModerationTestImages] = useStateRef<string[]>([])
  const [moderationTestResult, setModerationTestResult] = useState<ContentModerationTestAuditResult | null>(null)
  const [inputDetailRow, setInputDetailRow] = useState<ContentModerationLog | null>(null)
  const [savedEngine, setSavedEngine] = useState<ModerationEngine>('openai')

  const [configForm, formRef, setForm] = useStateRef<ConfigForm>(() => defaultConfigForm(defaultBlockMessage()))
  const patchForm = (patch: Partial<ConfigForm>) => setForm((prev) => ({ ...prev, ...patch }))
  const engineDrafts = useRef<Partial<Record<ModerationEngine, EngineDraft>>>({})

  const [pagination, paginationRef, setPagination] = useStateRef<LogPagination>({ page: 1, page_size: 20, total: 0, pages: 1 })
  const [filters, filtersRef, setFilters] = useStateRef<LogFilters>({
    result: '',
    group_id: 0,
    endpoint: '',
    search: '',
    from: '',
    to: ''
  })

  const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'basic', label: t('admin.riskControl.tabs.basic') },
    { id: 'scope', label: t('admin.riskControl.tabs.scope') },
    { id: 'runtime', label: t('admin.riskControl.tabs.runtime') },
    { id: 'response', label: t('admin.riskControl.tabs.response') },
    { id: 'riskThresholds', label: t('admin.riskControl.tabs.riskThresholds') },
    { id: 'keywords', label: t('admin.riskControl.tabs.keywords') },
    { id: 'retention', label: t('admin.riskControl.tabs.retention') }
  ]

  const modeOptions: SelectOption[] = [
    { value: 'pre_block', label: t('admin.riskControl.modePreBlock') },
    { value: 'observe', label: t('admin.riskControl.modeObserve') },
    { value: 'off', label: t('admin.riskControl.modeOff') }
  ]

  const keywordBlockingModeOptions: Array<{ value: KeywordBlockingMode; label: string; description: string }> = [
    {
      value: 'keyword_and_api',
      label: t('admin.riskControl.keywordModeKeywordAndApi'),
      description: t('admin.riskControl.keywordModeKeywordAndApiDesc')
    },
    {
      value: 'keyword_only',
      label: t('admin.riskControl.keywordModeKeywordOnly'),
      description: t('admin.riskControl.keywordModeKeywordOnlyDesc')
    },
    {
      value: 'api_only',
      label: t('admin.riskControl.keywordModeApiOnly'),
      description: t('admin.riskControl.keywordModeApiOnlyDesc')
    }
  ]

  const modelFilterOptions: Array<{ value: ContentModerationModelFilterType; label: string; description: string }> = [
    { value: 'all', label: t('admin.riskControl.modelFilterAll'), description: t('admin.riskControl.modelFilterAllDesc') },
    {
      value: 'include',
      label: t('admin.riskControl.modelFilterInclude'),
      description: t('admin.riskControl.modelFilterIncludeDesc')
    },
    {
      value: 'exclude',
      label: t('admin.riskControl.modelFilterExclude'),
      description: t('admin.riskControl.modelFilterExcludeDesc')
    }
  ]

  function modeLabel(mode: ModerationMode): string {
    const found = modeOptions.find((option) => option.value === mode)
    return found?.label ?? mode
  }

  function modeDescription(mode: ModerationMode): string {
    const descriptions: Record<ModerationMode, string> = {
      pre_block: t('admin.riskControl.modePreBlockDesc'),
      observe: t('admin.riskControl.modeObserveDesc'),
      off: t('admin.riskControl.modeOffDesc')
    }
    return descriptions[mode] ?? ''
  }

  const keywordNotice = (() => {
    const strategy = configForm.keyword_blocking_mode
    if (strategy === 'api_only') {
      return {
        tone: 'info' as const,
        title: t('admin.riskControl.keywordModeApiOnlyNotice'),
        description: t('admin.riskControl.keywordModeApiOnlyDesc')
      }
    }
    if (configForm.mode !== 'pre_block') {
      return {
        tone: 'warning' as const,
        title: t('admin.riskControl.blockedKeywordsModeWarning', { mode: modeLabel(configForm.mode) }),
        description: t('admin.riskControl.blockedKeywordsDescription')
      }
    }
    if (strategy === 'keyword_only') {
      return {
        tone: 'info' as const,
        title: t('admin.riskControl.keywordModeKeywordOnlyNotice'),
        description: t('admin.riskControl.keywordModeKeywordOnlyDesc')
      }
    }
    return {
      tone: 'info' as const,
      title: t('admin.riskControl.blockedKeywordsPreBlockHint'),
      description: t('admin.riskControl.blockedKeywordsDescription')
    }
  })()

  const resultOptions: SelectOption[] = [
    { value: '', label: t('admin.riskControl.result.all') },
    { value: 'hit', label: t('admin.riskControl.result.hit') },
    { value: 'blocked', label: t('admin.riskControl.result.blocked') },
    { value: 'pass', label: t('admin.riskControl.result.pass') },
    { value: 'error', label: t('admin.riskControl.result.error') }
  ]

  const endpointOptions: SelectOption[] = [
    { value: '', label: t('admin.riskControl.filters.allEndpoints') },
    { value: '/v1/messages', label: '/v1/messages' },
    { value: '/v1/responses', label: '/v1/responses' },
    { value: '/v1/chat/completions', label: '/v1/chat/completions' },
    { value: '/v1beta/models', label: '/v1beta/models' },
    { value: '/v1/images/generations', label: '/v1/images/generations' },
    { value: '/v1/images/edits', label: '/v1/images/edits' }
  ]

  const groupFilterOptions: SelectOption[] = [
    { value: 0, label: t('admin.riskControl.filters.allGroups') },
    ...groups.map((group) => ({ value: group.id, label: `${group.name} (${group.platform})` }))
  ]

  const selectedGroupCount = String(configForm.group_ids.length)
  const modelFilterModelCount = configForm.model_filter_models.length
  const modelFilterSummary =
    configForm.model_filter_type === 'include'
      ? t('admin.riskControl.modelFilterIncludeSummary', { count: modelFilterModelCount })
      : configForm.model_filter_type === 'exclude'
        ? t('admin.riskControl.modelFilterExcludeSummary', { count: modelFilterModelCount })
        : t('admin.riskControl.modelFilterAllSummary')
  const modelFilterPreviewModels = configForm.model_filter_models.slice(0, 6)
  const hiddenModelFilterModelCount = Math.max(0, configForm.model_filter_models.length - modelFilterPreviewModels.length)

  const filteredGroups = useMemo(() => {
    const keyword = groupSearch.trim().toLowerCase()
    if (!keyword) return groups
    return groups.filter(
      (group) => group.name.toLowerCase().includes(keyword) || String(group.platform).toLowerCase().includes(keyword)
    )
  }, [groupSearch, groups])

  const inputApiKeyCount = parseApiKeys(configForm.api_keys_text).length
  const blockedKeywordList = parseBlockedKeywords(configForm.blocked_keywords_text)
  const blockedKeywordCount = blockedKeywordList.length
  const pendingDeletedApiKeyCount = pendingDeleteApiKeyHashes.length
  const effectiveStoredApiKeyCount = Math.max(0, configForm.api_key_count - pendingDeletedApiKeyCount)
  const apiKeysPlaceholder =
    configForm.api_keys_mode === 'replace'
      ? t('admin.riskControl.apiKeysPlaceholderReplace')
      : t('admin.riskControl.apiKeysPlaceholder')
  const apiKeysModeHint =
    configForm.api_keys_mode === 'replace'
      ? t('admin.riskControl.apiKeysModeReplaceHint')
      : t('admin.riskControl.apiKeysModeAppendHint')
  const hasModerationAuditInput = moderationTestPrompt.trim() !== '' || moderationTestImages.length > 0
  const isFlaggedHashInputValid = /^[a-fA-F0-9]{64}$/.test(flaggedHashInput.trim())
  const storedApiKeyTestButtonText = apiKeyTesting
    ? t('admin.riskControl.testingApiKeys')
    : hasModerationAuditInput
      ? t('admin.riskControl.testContentWithStoredApiKey')
      : t('admin.riskControl.testStoredApiKeys')

  const computeSavedApiKeyRows = (
    currentStatus: ContentModerationRuntimeStatus | null,
    form: ConfigForm
  ): ContentModerationAPIKeyStatus[] => {
    const rows =
      (currentStatus?.engine ?? 'openai') === form.engine && currentStatus?.api_key_statuses?.length
        ? currentStatus.api_key_statuses
        : form.api_key_statuses
    return Array.isArray(rows) ? rows : []
  }

  const savedApiKeyRows = computeSavedApiKeyRows(status, configForm)
  const apiKeyRows = [...savedApiKeyRows, ...testedApiKeyStatuses]
  const visibleApiKeyRows = apiKeyRowsExpanded ? apiKeyRows : apiKeyRows.slice(0, maxVisibleApiKeyRows)
  const hiddenApiKeyRowCount = Math.max(0, apiKeyRows.length - visibleApiKeyRows.length)
  const canToggleApiKeyRows = apiKeyRows.length > maxVisibleApiKeyRows

  function isStoredApiKeyPendingDelete(row: ContentModerationAPIKeyStatus): boolean {
    return row.configured && row.key_hash !== '' && pendingDeleteApiKeyHashes.includes(row.key_hash)
  }

  const activeSavedApiKeyRows = savedApiKeyRows.filter((row) => !isStoredApiKeyPendingDelete(row))

  function apiKeyStatusLabel(statusValue: APIKeyStatusValue): string {
    const labels: Record<APIKeyStatusValue, string> = {
      ok: t('admin.riskControl.apiKeyStatusOk'),
      error: t('admin.riskControl.apiKeyStatusError'),
      frozen: t('admin.riskControl.apiKeyStatusFrozen'),
      unknown: t('admin.riskControl.apiKeyStatusUnknown')
    }
    return labels[statusValue] ?? labels.unknown
  }

  const apiKeyHealthBadges = (() => {
    const counts: Record<APIKeyStatusValue, number> = { ok: 0, error: 0, frozen: 0, unknown: 0 }
    for (const row of activeSavedApiKeyRows) {
      counts[row.status] = (counts[row.status] ?? 0) + 1
    }
    if (activeSavedApiKeyRows.length === 0 && effectiveStoredApiKeyCount > 0) {
      counts.unknown = effectiveStoredApiKeyCount
    }
    return (['ok', 'frozen', 'error', 'unknown'] as APIKeyStatusValue[])
      .map((item) => ({ status: item, count: counts[item] }))
      .filter((item) => item.count > 0)
  })()

  const apiKeyHealthSummary = !configForm.api_key_configured
    ? ''
    : apiKeyHealthBadges.length === 0
      ? t('admin.riskControl.apiKeyStatusUnknown')
      : apiKeyHealthBadges.map((badge) => `${apiKeyStatusLabel(badge.status)} ${badge.count}`).join(' · ')

  const runtimeBadgeText = !status?.risk_control_enabled
    ? t('admin.riskControl.riskSwitchOff')
    : !configForm.enabled || configForm.mode === 'off'
      ? t('admin.riskControl.overview.disabled')
      : t('admin.riskControl.overview.enabled')

  const runtimeBadgeTone: BadgeTone =
    !status?.risk_control_enabled || !configForm.enabled || configForm.mode === 'off' ? 'neutral' : 'success'

  const overviewItems: OverviewItem[] = [
    {
      key: 'status',
      label: t('admin.riskControl.overview.status'),
      value: configForm.enabled ? t('admin.riskControl.overview.enabled') : t('admin.riskControl.overview.disabled'),
      meta: modeLabel(configForm.mode),
      icon: ShieldCheck,
      tone: configForm.enabled ? 'success' : 'neutral',
      badge: runtimeBadgeText,
      badgeTone: runtimeBadgeTone
    },
    {
      key: 'api-key',
      label: t('admin.riskControl.overview.apiKey'),
      value: configForm.api_key_configured
        ? t('admin.riskControl.apiKeyCount', { count: configForm.api_key_count })
        : t('admin.riskControl.notConfigured'),
      meta: configForm.api_key_configured ? apiKeyHealthSummary || configForm.model || '-' : configForm.model || '-',
      icon: KeyRound,
      tone: 'info'
    },
    {
      key: 'scope',
      label: t('admin.riskControl.overview.groupScope'),
      value: configForm.all_groups ? t('admin.riskControl.allGroups') : selectedGroupCount,
      meta: modelFilterSummary,
      icon: Users,
      tone: 'accent'
    },
    {
      key: 'logs',
      label: t('admin.riskControl.overview.logs'),
      value: formatNumber(pagination.total),
      meta: t('admin.riskControl.overview.currentFilter'),
      icon: FileText,
      tone: 'warning'
    }
  ]

  const moderationScoreRows: ModerationScoreRow[] = (() => {
    const result = moderationTestResult
    if (!result) return []
    return Object.entries(result.category_scores || {})
      .map(([category, score]) => {
        const threshold = result.thresholds?.[category] ?? 1
        return { category, score, threshold, hit: score >= threshold }
      })
      .sort((a, b) => b.score - a.score)
  })()

  const riskThresholdRows: RiskThresholdRow[] = riskThresholdCategories.map((category) => ({
    category,
    value: configForm.thresholds[category] ?? riskThresholdDefaults[category],
    defaultValue: riskThresholdDefaults[category]
  }))

  const inputDetailText = inputDetailRow ? inputDetailRow.input_excerpt || inputDetailRow.error || '-' : '-'

  const queueUsagePercent = `${Math.min(100, Math.max(0, status?.queue_usage_percent ?? 0)).toFixed(1)}%`
  const runtimeMode: ModerationMode = status?.mode ?? configForm.mode
  const showPreBlockRuntimeCard = runtimeMode === 'pre_block'
  const showWorkerRuntimeCard = runtimeMode === 'observe'

  const preBlockMetricItems = [
    {
      key: 'active',
      label: t('admin.riskControl.preBlockActive'),
      value: status?.pre_block_active ?? 0,
      meta: t('admin.riskControl.preBlockActiveHint')
    },
    {
      key: 'checked',
      label: t('admin.riskControl.preBlockChecked'),
      value: status?.pre_block_checked ?? 0,
      meta: t('admin.riskControl.preBlockCheckedHint')
    },
    {
      key: 'allowed',
      label: t('admin.riskControl.preBlockAllowed'),
      value: status?.pre_block_allowed ?? 0,
      meta: t('admin.riskControl.preBlockAllowedHint')
    },
    {
      key: 'blocked',
      label: t('admin.riskControl.preBlockBlocked'),
      value: status?.pre_block_blocked ?? 0,
      meta: t('admin.riskControl.preBlockBlockedHint')
    },
    {
      key: 'errors',
      label: t('admin.riskControl.preBlockErrors'),
      value: status?.pre_block_errors ?? 0,
      meta: t('admin.riskControl.preBlockErrorsHint')
    },
    {
      key: 'latency',
      label: t('admin.riskControl.preBlockAvgLatency'),
      value: status?.pre_block_avg_latency_ms ?? 0,
      suffix: ' ms',
      meta: t('admin.riskControl.preBlockAvgLatencyHint')
    }
  ]

  const preBlockAPIKeyLoads: ContentModerationAPIKeyLoad[] = [...(status?.pre_block_api_key_loads ?? [])].sort(
    (a, b) => a.index - b.index
  )
  const preBlockAPIKeyMaxTotal = Math.max(1, ...preBlockAPIKeyLoads.map((item) => item.total || 0))
  const preBlockAPIKeyLoadSummaryText = t('admin.riskControl.preBlockAPIKeyLoadSummary', {
    active: formatNumber(status?.pre_block_api_key_active ?? 0),
    available: formatNumber(status?.pre_block_api_key_available_count ?? 0),
    total: formatNumber(status?.pre_block_api_key_total_calls ?? 0),
    workerActive: formatNumber(status?.active_workers ?? 0),
    workerTotal: formatNumber(status?.worker_count ?? Number(configForm.worker_count))
  })

  const preBlockAPIKeyLoadWidth = (total: number): string =>
    `${Math.min(100, Math.max(0, (total / preBlockAPIKeyMaxTotal) * 100)).toFixed(1)}%`

  const workerSlots = (() => {
    const total = Math.max(0, status?.worker_count ?? Number(configForm.worker_count))
    const active = Math.max(0, status?.active_workers ?? 0)
    const enabled = Boolean(status?.risk_control_enabled && status?.enabled && status?.mode !== 'off')
    return Array.from({ length: total }, (_, index) => ({
      id: index + 1,
      state: (!enabled ? 'disabled' : index < active ? 'active' : 'idle') as WorkerSlotState,
      label: !enabled
        ? t('admin.riskControl.workerDisabled')
        : index < active
          ? t('admin.riskControl.workerActive')
          : t('admin.riskControl.workerIdle')
    }))
  })()

  // ── 配置草稿与引擎切换 ──
  function switchEngine(value: unknown) {
    if ((value !== 'openai' && value !== 'typesafe') || apiKeyTestingRef.current || savingRef.current) return
    const current = formRef.current
    engineDrafts.current[current.engine] = captureEngineDraft(current, pendingDeletesRef.current)
    let next: ConfigForm = { ...current, engine: value }
    const draft = engineDrafts.current[value]
    if (draft) {
      const applied = applyEngineDraft(next, draft)
      next = applied.form
      setPendingDeleteApiKeyHashes(applied.pendingDeletes)
    }
    setForm(next)
    setTestedApiKeyStatuses([])
    setModerationTestResult(null)
  }

  function prunePendingDeleteAPIKeyHashes() {
    const currentHashes = new Set(
      computeSavedApiKeyRows(statusRef.current, formRef.current)
        .map((row) => row.key_hash)
        .filter(Boolean)
    )
    setPendingDeleteApiKeyHashes((prev) => prev.filter((hash) => currentHashes.has(hash)))
  }

  function applyConfig(config: ContentModerationConfig) {
    const engine = config.engine ?? 'openai'
    setSavedEngine(engine)
    const modelFilter = normalizeModelFilter(config.model_filter)
    const base: ConfigForm = {
      ...formRef.current,
      engine,
      enabled: config.enabled,
      mode: config.mode,
      base_url: config.base_url || 'https://api.openai.com',
      model: config.model || 'omni-moderation-latest',
      proxy_id: config.proxy_id || null,
      api_keys_text: '',
      api_key_configured: config.api_key_configured,
      api_key_masked: config.api_key_masked || '',
      api_key_count: config.api_key_count || 0,
      api_key_masks: Array.isArray(config.api_key_masks) ? [...config.api_key_masks] : [],
      api_key_statuses: Array.isArray(config.api_key_statuses) ? [...config.api_key_statuses] : [],
      api_keys_mode: 'append',
      clear_api_key: false,
      timeout_ms: config.timeout_ms || 3000,
      retry_count: config.retry_count ?? 2,
      sample_rate: config.sample_rate ?? 100,
      all_groups: config.all_groups,
      group_ids: Array.isArray(config.group_ids) ? [...config.group_ids] : [],
      record_non_hits: config.record_non_hits,
      worker_count: config.worker_count || 4,
      queue_size: config.queue_size || 32768,
      block_status: config.block_status || 403,
      block_message: config.block_message || defaultBlockMessage(),
      email_on_hit: config.email_on_hit ?? true,
      auto_ban_enabled: config.auto_ban_enabled ?? true,
      cyber_policy_exclude_from_ban_count: config.cyber_policy_exclude_from_ban_count ?? false,
      ban_threshold: config.ban_threshold || 10,
      violation_window_hours: config.violation_window_hours || 720,
      hit_retention_days: config.hit_retention_days || 180,
      non_hit_retention_days: Math.min(Math.max(config.non_hit_retention_days || 3, 1), 3),
      pre_hash_check_enabled: config.pre_hash_check_enabled ?? false,
      thresholds: riskThresholdsFromConfig(config.thresholds),
      blocked_keywords_text: Array.isArray(config.blocked_keywords) ? config.blocked_keywords.join('\n') : '',
      keyword_blocking_mode: normalizeKeywordBlockingMode(config.keyword_blocking_mode),
      model_filter_type: modelFilter.type,
      model_filter_models: modelFilter.models
    }
    setTestedApiKeyStatuses([])
    setApiKeyRowsExpanded(false)
    engineDrafts.current = {
      openai: engineDraftFromConfig(config.engine_configs?.openai ?? (engine === 'openai' ? config : undefined), 'openai'),
      typesafe: engineDraftFromConfig(config.engine_configs?.typesafe ?? (engine === 'typesafe' ? config : undefined), 'typesafe')
    }
    const applied = applyEngineDraft(base, engineDrafts.current[engine]!)
    setForm(applied.form)
    setPendingDeleteApiKeyHashes([...applied.pendingDeletes])
  }

  // 运行时状态里的 Key 状态只属于当前引擎；引擎一致时同步到表单
  function syncRuntimeKeyStatuses(runtimeStatus: ContentModerationRuntimeStatus) {
    if ((runtimeStatus.engine ?? 'openai') === formRef.current.engine && Array.isArray(runtimeStatus.api_key_statuses)) {
      patchForm({ api_key_statuses: [...runtimeStatus.api_key_statuses] })
      prunePendingDeleteAPIKeyHashes()
    }
  }

  async function loadLogs() {
    setLogsLoading(true)
    try {
      const f = filtersRef.current
      const p = paginationRef.current
      const params = {
        page: p.page,
        page_size: p.page_size,
        result: f.result || undefined,
        group_id: f.group_id || undefined,
        endpoint: f.endpoint || undefined,
        search: f.search.trim() || undefined,
        from: normalizeDateTimeLocal(f.from),
        to: normalizeDateTimeLocal(f.to)
      }
      const result = await adminAPI.riskControl.listLogs(params)
      setLogs(result.items)
      setPagination({ total: result.total, page: result.page, page_size: result.page_size, pages: result.pages })
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('admin.riskControl.logsFailed')))
    } finally {
      setLogsLoading(false)
    }
  }

  async function loadAll() {
    setLoading(true)
    try {
      const [config, groupItems, runtimeStatus, proxyItems] = await Promise.all([
        adminAPI.riskControl.getConfig(),
        adminAPI.groups.getAll(),
        adminAPI.riskControl.getStatus(),
        // 代理列表加载失败不阻塞风控页面（仅影响下拉可选项）
        adminAPI.proxies.getAll().catch(() => [] as Proxy[])
      ])
      applyConfig(config)
      setGroups(groupItems)
      setStatus(runtimeStatus)
      setProxies(proxyItems)
      syncRuntimeKeyStatuses(runtimeStatus)
      await loadLogs()
    } catch (err: unknown) {
      useAppStore.getState().showError(extractApiErrorMessage(err, t('admin.riskControl.loadFailed')))
    } finally {
      setLoading(false)
    }
  }

  async function loadStatus(silent = true) {
    setStatusLoading(true)
    try {
      const runtimeStatus = await adminAPI.riskControl.getStatus()
      setStatus(runtimeStatus)
      syncRuntimeKeyStatuses(runtimeStatus)
    } catch (err: unknown) {
      if (!silent) {
        useAppStore.getState().showError(extractApiErrorMessage(err, t('admin.riskControl.statusFailed')))
      }
    } finally {
      setStatusLoading(false)
    }
  }

  // 15 秒轮询运行时状态；回调通过 ref 调用最新的 loadStatus
  const loadStatusRef = useRef(loadStatus)
  const loadAllRef = useRef(loadAll)
  useEffect(() => {
    loadStatusRef.current = loadStatus
    loadAllRef.current = loadAll
  })
  useEffect(() => {
    void loadAllRef.current()
    const statusTimer = window.setInterval(() => {
      void loadStatusRef.current(true)
    }, 15000)
    return () => window.clearInterval(statusTimer)
  }, [])

  async function saveConfig() {
    setSaving(true)
    const appStore = useAppStore.getState()
    try {
      const form = formRef.current
      const modelFilterPayload = buildModelFilterPayload(form)
      if (modelFilterPayload.type !== 'all' && modelFilterPayload.models.length === 0) {
        appStore.showError(t('admin.riskControl.modelFilterModelsRequired'))
        return
      }
      const payload: UpdateContentModerationConfig = {
        engine: form.engine,
        enabled: form.enabled,
        mode: form.mode,
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        // 后端语义：0 清除代理（直连），>0 指定代理
        proxy_id: form.proxy_id ?? 0,
        timeout_ms: Number(form.timeout_ms) || 3000,
        retry_count: Number(form.retry_count) || 0,
        sample_rate: Number(form.sample_rate) || 0,
        all_groups: form.all_groups,
        group_ids: form.all_groups ? [] : [...form.group_ids],
        record_non_hits: form.record_non_hits,
        clear_api_key: form.clear_api_key,
        worker_count: Number(form.worker_count) || 4,
        queue_size: Number(form.queue_size) || 32768,
        block_status: Number(form.block_status) || 403,
        block_message: form.block_message.trim() || defaultBlockMessage(),
        email_on_hit: form.email_on_hit,
        auto_ban_enabled: form.auto_ban_enabled,
        cyber_policy_exclude_from_ban_count: form.cyber_policy_exclude_from_ban_count,
        ban_threshold: Number(form.ban_threshold) || 10,
        violation_window_hours: Number(form.violation_window_hours) || 720,
        hit_retention_days: Number(form.hit_retention_days) || 180,
        non_hit_retention_days: Math.min(Math.max(Number(form.non_hit_retention_days) || 3, 1), 3),
        pre_hash_check_enabled: form.pre_hash_check_enabled,
        thresholds: buildRiskThresholdPayload(form.thresholds),
        blocked_keywords: parseBlockedKeywords(form.blocked_keywords_text),
        keyword_blocking_mode: form.keyword_blocking_mode,
        model_filter: modelFilterPayload
      }
      const keys = parseApiKeys(form.api_keys_text)
      if (!payload.clear_api_key && form.api_keys_mode === 'replace' && keys.length === 0) {
        appStore.showError(t('admin.riskControl.apiKeysReplaceNoInput'))
        return
      }
      if (keys.length > 0) {
        payload.api_keys = keys
        payload.api_keys_mode = form.api_keys_mode
        payload.clear_api_key = false
      }
      if (!payload.clear_api_key && form.api_keys_mode !== 'replace' && pendingDeletesRef.current.length > 0) {
        payload.delete_api_key_hashes = [...pendingDeletesRef.current]
      }

      engineDrafts.current[form.engine] = captureEngineDraft(form, pendingDeletesRef.current)
      payload.engine_configs = Object.fromEntries(
        Object.entries(engineDrafts.current).map(([engine, draft]) => [engine, engineDraftPayload(draft)])
      )
      const updated = await adminAPI.riskControl.updateConfig(payload)
      applyConfig(updated)
      setSettingsOpen(false)
      appStore.showSuccess(t('admin.riskControl.saved'))
      await Promise.all([loadStatus(true), loadLogs()])
    } catch (err: unknown) {
      appStore.showError(extractApiErrorMessage(err, t('admin.riskControl.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  function canUnbanRow(row: ContentModerationLog): boolean {
    return Boolean(row.auto_banned && row.user_id && row.user_status === 'disabled')
  }

  function inputSummaryText(row: ContentModerationLog): string {
    return row.input_excerpt || row.error || '-'
  }

  async function unbanUser(row: ContentModerationLog) {
    if (!row.user_id || unbanningUserIDRef.current !== null) return
    const appStore = useAppStore.getState()
    setUnbanningUserID(row.user_id)
    try {
      const result = await adminAPI.riskControl.unbanUser(row.user_id)
      setLogs((prev) => prev.map((item) => (item.user_id !== row.user_id ? item : { ...item, user_status: result.status })))
      appStore.showSuccess(t('admin.riskControl.unbanSuccess'))
    } catch (err: unknown) {
      appStore.showError(extractApiErrorMessage(err, t('admin.riskControl.unbanFailed')))
    } finally {
      setUnbanningUserID(null)
    }
  }

  async function deleteFlaggedHash() {
    if (!isFlaggedHashInputValid || hashActionLoadingRef.current) return
    const appStore = useAppStore.getState()
    setHashActionLoading(true)
    try {
      const result = await adminAPI.riskControl.deleteFlaggedHash(flaggedHashInput.trim())
      setFlaggedHashInput('')
      await loadStatus(true)
      appStore.showSuccess(result.deleted ? t('admin.riskControl.flaggedHashDeleted') : t('admin.riskControl.flaggedHashNotFound'))
    } catch (err: unknown) {
      appStore.showError(extractApiErrorMessage(err, t('admin.riskControl.flaggedHashDeleteFailed')))
    } finally {
      setHashActionLoading(false)
    }
  }

  async function clearFlaggedHashes() {
    if (hashActionLoadingRef.current) return
    // 原生 window.confirm 改为 ConfirmDialog，文案与确认/取消结果不变
    const confirmed = await confirm(t('admin.riskControl.clearFlaggedHashesConfirm'), { danger: true })
    if (!confirmed) return
    const appStore = useAppStore.getState()
    setHashActionLoading(true)
    try {
      const result = await adminAPI.riskControl.clearFlaggedHashes()
      await loadStatus(true)
      appStore.showSuccess(t('admin.riskControl.flaggedHashesCleared', { count: result.deleted }))
    } catch (err: unknown) {
      appStore.showError(extractApiErrorMessage(err, t('admin.riskControl.flaggedHashesClearFailed')))
    } finally {
      setHashActionLoading(false)
    }
  }

  function openSettings() {
    setActiveSettingsTab('basic')
    setSettingsOpen(true)
  }

  function reloadLogsFromFirstPage(patch: Partial<LogFilters> = {}) {
    setFilters((prev) => ({ ...prev, ...patch }))
    setPagination((prev) => ({ ...prev, page: 1 }))
    void loadLogs()
  }

  function onPageChange(page: number) {
    setPagination((prev) => ({ ...prev, page }))
    void loadLogs()
  }

  function onPageSizeChange(pageSize: number) {
    setPagination((prev) => ({ ...prev, page: 1, page_size: pageSize }))
    void loadLogs()
  }

  function toggleClearApiKey() {
    const clear = !formRef.current.clear_api_key
    if (clear) {
      patchForm({ clear_api_key: true, api_keys_text: '', api_keys_mode: 'append' })
      setTestedApiKeyStatuses([])
      setPendingDeleteApiKeyHashes([])
    } else {
      patchForm({ clear_api_key: false })
    }
  }

  function setAPIKeysMode(mode: APIKeysWriteMode) {
    patchForm({ api_keys_mode: mode })
    if (mode === 'replace') {
      setPendingDeleteApiKeyHashes([])
    }
  }

  function setModelFilterType(type: ContentModerationModelFilterType) {
    patchForm(type === 'all' ? { model_filter_type: type, model_filter_models: [] } : { model_filter_type: type })
  }

  function mergeConfiguredAPIKeyStatuses(items: ContentModerationAPIKeyStatus[]) {
    const form = formRef.current
    const hasInput = moderationTestPromptRef.current.trim() !== '' || moderationTestImagesRef.current.length > 0
    if (!hasInput || form.api_key_statuses.length === 0) {
      patchForm({ api_key_statuses: items })
      return
    }
    const updates = new Map(items.map((item) => [item.key_hash, item]))
    patchForm({ api_key_statuses: form.api_key_statuses.map((item) => updates.get(item.key_hash) ?? item) })
  }

  async function testApiKeys(useInputKeys: boolean) {
    const form = formRef.current
    const appStore = useAppStore.getState()
    const keys = useInputKeys ? parseApiKeys(form.api_keys_text) : []
    if (useInputKeys && keys.length === 0) {
      appStore.showError(t('admin.riskControl.apiKeyTestNoInput'))
      return
    }
    setApiKeyTesting(true)
    try {
      const result = await adminAPI.riskControl.testAPIKeys({
        engine: form.engine,
        thresholds: buildRiskThresholdPayload(form.thresholds),
        api_keys: keys,
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        timeout_ms: Number(form.timeout_ms) || 3000,
        // 与保存语义一致：0 强制直连，>0 指定代理，确保测试与实际审计走同一条链路
        proxy_id: form.proxy_id ?? 0,
        prompt: moderationTestPromptRef.current,
        images: moderationTestImagesRef.current
      })
      setModerationTestResult(result.audit_result ?? null)
      if (useInputKeys) {
        setTestedApiKeyStatuses(result.items.map((item) => ({ ...item, configured: false })))
      } else {
        mergeConfiguredAPIKeyStatuses(result.items)
        setTestedApiKeyStatuses([])
        await loadStatus(true)
      }
      if (result.items.length === 0 || result.items.some((item) => item.status === 'error' || item.status === 'frozen')) {
        appStore.showError(t('admin.riskControl.apiKeyTestFailed'))
      } else {
        appStore.showSuccess(t('admin.riskControl.apiKeyTestDone', { count: result.items.length }))
      }
    } catch (err: unknown) {
      appStore.showError(extractApiErrorMessage(err, t('admin.riskControl.apiKeyTestFailed')))
    } finally {
      setApiKeyTesting(false)
    }
  }

  function toggleDeleteStoredApiKey(row: ContentModerationAPIKeyStatus) {
    if (!row.configured || !row.key_hash) return
    setPendingDeleteApiKeyHashes((prev) =>
      prev.includes(row.key_hash) ? prev.filter((hash) => hash !== row.key_hash) : [...prev, row.key_hash]
    )
  }

  function clearModerationTestInput() {
    setModerationTestPrompt('')
    setModerationTestImages([])
    setModerationTestResult(null)
  }

  function removeModerationTestImage(index: number) {
    setModerationTestImages((prev) => prev.filter((_, i) => i !== index))
  }

  async function addModerationTestFiles(files: FileList | File[] | null) {
    if (!files) return
    const appStore = useAppStore.getState()
    const items = Array.from(files).filter((file) => file.type.startsWith('image/'))
    for (const file of items) {
      if (moderationTestImagesRef.current.length >= maxModerationTestImages) {
        appStore.showError(t('admin.riskControl.auditTestImageLimit', { count: maxModerationTestImages }))
        return
      }
      if (file.size > maxModerationTestImageSize) {
        appStore.showError(t('admin.riskControl.auditTestImageTooLarge'))
        continue
      }
      try {
        const dataURL = await fileToDataURL(file)
        setModerationTestImages((prev) => [...prev, dataURL])
      } catch {
        appStore.showError(t('admin.riskControl.auditTestImageReadFailed'))
      }
    }
  }

  async function handleModerationImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target
    await addModerationTestFiles(input.files)
    input.value = ''
  }

  async function handleModerationImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    await addModerationTestFiles(event.dataTransfer?.files ?? null)
  }

  async function handleModerationImagePaste(event: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    await addModerationTestFiles(files)
  }

  function toggleGroup(groupID: number) {
    setForm((prev) => ({
      ...prev,
      group_ids: prev.group_ids.includes(groupID)
        ? prev.group_ids.filter((id) => id !== groupID)
        : [...prev.group_ids, groupID]
    }))
  }

  function resetRiskThresholds() {
    patchForm({ thresholds: { ...riskThresholdDefaults } })
  }

  function resultLabel(row: ContentModerationLog): string {
    if (row.action === 'cyber_policy') return t('admin.riskControl.action.cyberPolicy')
    if (row.action === 'keyword_block') return t('admin.riskControl.action.keywordBlock')
    if (row.action === 'block') return t('admin.riskControl.action.block')
    if (row.action === 'error' || row.error) return t('admin.riskControl.action.error')
    if (row.flagged) return t('admin.riskControl.result.hit')
    return t('admin.riskControl.result.pass')
  }

  function resultTone(row: ContentModerationLog): BadgeTone {
    if (row.action === 'block' || row.action === 'keyword_block' || row.action === 'cyber_policy') return 'danger'
    if (row.action === 'error' || row.error) return 'warning'
    if (row.flagged) return 'danger'
    return 'success'
  }

  function apiKeyStatusTone(statusValue: APIKeyStatusValue): BadgeTone {
    const tones: Record<APIKeyStatusValue, BadgeTone> = { ok: 'success', error: 'warning', frozen: 'danger', unknown: 'neutral' }
    return tones[statusValue] ?? 'neutral'
  }

  function formatDateTime(value: string): string {
    return formatDateTimeValue(value) || '-'
  }

  function apiKeyStatusMeta(row: ContentModerationAPIKeyStatus): string {
    const parts: string[] = []
    parts.push(t('admin.riskControl.apiKeyFailureCount', { count: row.failure_count || 0 }))
    if (row.last_latency_ms > 0) {
      parts.push(t('admin.riskControl.apiKeyLatency', { ms: row.last_latency_ms }))
    }
    if (row.last_http_status > 0) {
      parts.push(t('admin.riskControl.apiKeyHTTPStatus', { status: row.last_http_status }))
    }
    if (row.frozen_until) {
      parts.push(t('admin.riskControl.apiKeyFrozenUntil', { time: formatDateTime(row.frozen_until) }))
    } else if (row.last_checked_at) {
      parts.push(t('admin.riskControl.apiKeyLastChecked', { time: formatDateTime(row.last_checked_at) }))
    } else {
      parts.push(t('admin.riskControl.apiKeyNotTested'))
    }
    return parts.join(' / ')
  }

  function violationCountText(row: ContentModerationLog): string {
    if (!row.flagged) return '-'
    if (row.violation_count === 0) return t('admin.riskControl.violationNotCounted')
    return t('admin.riskControl.violationCount', { count: row.violation_count || 1 })
  }

  // ── 审计记录表格 ──
  const logColumns: Column<ContentModerationLog>[] = [
    { key: 'created_at', label: t('admin.riskControl.table.time') },
    { key: 'group_name', label: t('admin.riskControl.table.group') },
    { key: 'user', label: t('admin.riskControl.table.user') },
    { key: 'api_key_name', label: t('admin.riskControl.table.apiKey') },
    { key: 'endpoint', label: t('admin.riskControl.table.endpoint') },
    { key: 'result', label: t('admin.riskControl.table.result') },
    { key: 'highest', label: t('admin.riskControl.table.highest') },
    { key: 'action_meta', label: t('admin.riskControl.table.actionMeta') },
    { key: 'latency', label: t('admin.riskControl.table.latency') },
    { key: 'input', label: t('admin.riskControl.table.input'), width: '20rem' }
  ]

  type LogCell = (context: DataTableCellContext<ContentModerationLog>) => ReactNode
  const logCells: Record<string, LogCell> = {
    created_at: ({ row }) => <span className={styles.nowrap}>{formatDateTime(row.created_at)}</span>,
    group_name: ({ row }) => <span className={styles.nowrap}>{row.group_name || '-'}</span>,
    user: ({ row }) => (
      <div className={styles.nowrap}>
        <div>{row.user_email || '-'}</div>
        {row.user_id ? <div className={styles.subText}>UID {row.user_id}</div> : null}
      </div>
    ),
    api_key_name: ({ row }) => <span className={styles.nowrap}>{row.api_key_name || '-'}</span>,
    endpoint: ({ row }) => (
      <div className={styles.nowrap}>
        <div>{row.endpoint || '-'}</div>
        <div className={styles.subText}>
          {row.provider || '-'} / {row.model || '-'}
        </div>
      </div>
    ),
    result: ({ row }) => (
      <Badge tone={resultTone(row)} size="sm">
        {resultLabel(row)}
      </Badge>
    ),
    highest: ({ row }) => (
      <div className={styles.nowrap}>
        <div>{row.highest_category || '-'}</div>
        <div className={styles.subText}>{percent(row.highest_score)}</div>
        {row.matched_keyword ? (
          <div className={styles.dangerText} title={`${t('admin.riskControl.matchedKeyword')}: ${row.matched_keyword}`}>
            {t('admin.riskControl.matchedKeyword')}: {row.matched_keyword}
          </div>
        ) : null}
      </div>
    ),
    action_meta: ({ row }) => (
      <div className={styles.nowrap}>
        <div>{violationCountText(row)}</div>
        <div className={styles.subText}>
          {row.email_sent ? t('admin.riskControl.emailSent') : t('admin.riskControl.emailNotSent')}
          {row.auto_banned ? <span> / {t('admin.riskControl.autoBanned')}</span> : null}
        </div>
        {canUnbanRow(row) ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={styles.unbanButton}
            disabled={unbanningUserID === row.user_id}
            loading={unbanningUserID === row.user_id}
            onClick={() => void unbanUser(row)}
          >
            {unbanningUserID === row.user_id ? null : <Check size={14} aria-hidden="true" />}
            {unbanningUserID === row.user_id ? t('common.processing') : t('admin.riskControl.unbanUser')}
          </Button>
        ) : null}
      </div>
    ),
    latency: ({ row }) => (
      <div className={styles.nowrap}>
        <div>{latencyText(row.upstream_latency_ms)}</div>
        {row.queue_delay_ms !== null && row.queue_delay_ms !== undefined ? (
          <div className={styles.subText}>{t('admin.riskControl.queueDelay', { ms: row.queue_delay_ms })}</div>
        ) : null}
      </div>
    ),
    input: ({ row }) => (
      <button type="button" className={styles.inputSummary} title={inputSummaryText(row)} onClick={() => setInputDetailRow(row)}>
        <span className={styles.inputSummaryText}>{inputSummaryText(row)}</span>
        <Eye size={14} aria-hidden="true" className={styles.inputSummaryIcon} />
      </button>
    )
  }

  const numberInput = (
    value: NumberInput,
    onChange: (value: NumberInput) => void,
    props: { min?: number; max?: number; step?: number; label: string; id?: string; testId?: string; suffix?: string }
  ) => (
    <div className={props.suffix ? styles.suffixWrap : undefined}>
      <input
        id={props.id}
        data-test={props.testId}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        className={`${styles.input} ${props.suffix ? styles.withSuffix : ''}`}
        value={value}
        aria-label={props.label}
        onChange={(event) => onChange(toNumberInput(event.target.value))}
      />
      {props.suffix ? <span className={styles.suffix}>{props.suffix}</span> : null}
    </div>
  )

  const field = (label: string, control: ReactNode, hint?: ReactNode, className?: string) => (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <span className={styles.label}>{label}</span>
      {control}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  )

  const toggleRow = (title: string, hint: string, value: boolean, onChange: (value: boolean) => void, className?: string) => (
    <div className={[styles.toggleRow, className].filter(Boolean).join(' ')}>
      <div>
        <p className={styles.rowTitle}>{title}</p>
        <p className={styles.hint}>{hint}</p>
      </div>
      <Toggle value={value} onChange={onChange} aria-label={title} />
    </div>
  )

  const overviewIconClass: Record<OverviewItem['tone'], string> = {
    success: styles.iconSuccess,
    neutral: styles.iconNeutral,
    info: styles.iconInfo,
    accent: styles.iconAccent,
    warning: styles.iconWarning
  }

  const workerSlotClass: Record<WorkerSlotState, string> = {
    active: styles.slotActive,
    idle: styles.slotIdle,
    disabled: styles.slotDisabled
  }

  const statusDotClass: Record<APIKeyStatusValue, string> = {
    ok: styles.dotSuccess,
    error: styles.dotWarning,
    frozen: styles.dotDanger,
    unknown: styles.dotMuted
  }

  // ── 设置抽屉各标签页 ──
  const basicTab = (
    <div className={styles.tabBody}>
      <div className={styles.grid2}>
        {toggleRow(t('admin.riskControl.enabled'), t('admin.riskControl.enabledHint'), configForm.enabled, (value) =>
          patchForm({ enabled: value })
        )}
        {field(
          t('admin.riskControl.mode'),
          <Select
            value={configForm.mode}
            options={modeOptions}
            aria-label={t('admin.riskControl.mode')}
            onChange={(value) => patchForm({ mode: (value as ModerationMode) || 'pre_block' })}
          />,
          modeDescription(configForm.mode)
        )}
        {field(
          t('admin.riskControl.engine'),
          <div data-test="audit-engine-select">
            <Select
              value={configForm.engine}
              options={engineOptions}
              disabled={apiKeyTesting || saving}
              aria-label={t('admin.riskControl.engine')}
              onChange={(value) => switchEngine(value)}
            />
          </div>
        )}
        {configForm.engine === 'typesafe' ? (
          <p className={`${styles.span2} ${styles.warningText}`} role="status">
            {t('admin.riskControl.typeSafeNotice')}
          </p>
        ) : null}
        {field(
          t('admin.riskControl.baseUrl'),
          <input
            data-test="audit-base-url"
            type="url"
            className={styles.input}
            value={configForm.base_url}
            aria-label={t('admin.riskControl.baseUrl')}
            placeholder={configForm.engine === 'typesafe' ? 'https://api.typesafe.ai' : 'https://api.openai.com'}
            onChange={(event) => patchForm({ base_url: event.target.value })}
            onBlur={(event) => patchForm({ base_url: event.target.value.trim() })}
          />
        )}
        {field(
          t('admin.riskControl.model'),
          <input
            data-test="audit-model"
            type="text"
            className={styles.input}
            value={configForm.model}
            aria-label={t('admin.riskControl.model')}
            placeholder={configForm.engine === 'typesafe' ? 'jev-latest' : 'omni-moderation-latest'}
            onChange={(event) => patchForm({ model: event.target.value })}
            onBlur={(event) => patchForm({ model: event.target.value.trim() })}
          />
        )}
        {field(
          t('admin.riskControl.timeoutMs'),
          numberInput(configForm.timeout_ms, (value) => patchForm({ timeout_ms: value }), {
            min: 500,
            max: 30000,
            label: t('admin.riskControl.timeoutMs')
          })
        )}
        {field(
          t('admin.riskControl.retryCount'),
          numberInput(configForm.retry_count, (value) => patchForm({ retry_count: value }), {
            min: 0,
            max: 5,
            label: t('admin.riskControl.retryCount')
          })
        )}
        {field(
          t('admin.riskControl.sampleRate'),
          numberInput(configForm.sample_rate, (value) => patchForm({ sample_rate: value }), {
            min: 0,
            max: 100,
            step: 1,
            label: t('admin.riskControl.sampleRate'),
            suffix: '%'
          })
        )}
        {field(
          t('admin.riskControl.proxy'),
          <ProxySelector value={configForm.proxy_id} proxies={proxies} onChange={(value) => patchForm({ proxy_id: value })} />,
          t('admin.riskControl.proxyHint')
        )}
      </div>

      <section className={styles.subRegion}>
        <div className={styles.subRegionHeader}>
          <div className={styles.headingWithIcon}>
            <span className={`${styles.iconBox} ${styles.iconAccent}`}>
              <KeyRound size={18} aria-hidden="true" />
            </span>
            <div>
              <h3 className={styles.h3}>{t('admin.riskControl.apiKeys')}</h3>
              <p className={styles.hint}>{t('admin.riskControl.apiKeysHint', { count: configForm.api_key_count })}</p>
            </div>
          </div>
          <div className={styles.buttonRow}>
            <Button
              type="button"
              variant="secondary"
              disabled={apiKeyTesting || inputApiKeyCount === 0 || configForm.clear_api_key}
              onClick={() => void testApiKeys(true)}
            >
              <FlaskConical size={16} aria-hidden="true" className={apiKeyTesting ? styles.pulse : undefined} />
              {apiKeyTesting ? t('admin.riskControl.testingApiKeys') : t('admin.riskControl.testInputApiKeys')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={
                apiKeyTesting ||
                effectiveStoredApiKeyCount === 0 ||
                pendingDeletedApiKeyCount > 0 ||
                configForm.clear_api_key ||
                configForm.api_keys_mode === 'replace'
              }
              onClick={() => void testApiKeys(false)}
            >
              <ShieldCheck size={16} aria-hidden="true" />
              {storedApiKeyTestButtonText}
            </Button>
            {configForm.api_key_configured ? (
              <Button type="button" variant="secondary" onClick={toggleClearApiKey}>
                {configForm.clear_api_key ? <X size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                {configForm.clear_api_key ? t('admin.riskControl.keepApiKey') : t('admin.riskControl.clearApiKey')}
              </Button>
            ) : null}
          </div>
        </div>

        <div className={styles.apiKeyLayout}>
          <div className={styles.stackGap3}>
            <div className={styles.modeStrip}>
              <div className={styles.hint}>
                <span className={styles.strong}>{t('admin.riskControl.apiKeysWriteMode')}</span>
                <span className={styles.inlineGap}>{apiKeysModeHint}</span>
              </div>
              <div className={styles.choiceGroup} role="group" aria-label={t('admin.riskControl.apiKeysWriteMode')}>
                <button
                  type="button"
                  className={styles.choice}
                  aria-pressed={configForm.api_keys_mode === 'append'}
                  disabled={configForm.clear_api_key}
                  onClick={() => setAPIKeysMode('append')}
                >
                  {t('admin.riskControl.apiKeysModeAppend')}
                </button>
                <button
                  type="button"
                  className={`${styles.choice} ${styles.choiceWarning}`}
                  aria-pressed={configForm.api_keys_mode === 'replace'}
                  disabled={configForm.clear_api_key}
                  onClick={() => setAPIKeysMode('replace')}
                >
                  {t('admin.riskControl.apiKeysModeReplace')}
                </button>
              </div>
            </div>
            <textarea
              className={`${styles.input} ${styles.textarea} ${styles.mono} ${styles.tallTextarea}`}
              value={configForm.api_keys_text}
              placeholder={apiKeysPlaceholder}
              autoComplete="new-password"
              aria-label={t('admin.riskControl.apiKeys')}
              disabled={configForm.clear_api_key}
              onChange={(event) => patchForm({ api_keys_text: event.target.value })}
            />
            <div className={styles.chips}>
              <span className={styles.chip}>{t('admin.riskControl.inputApiKeyCount', { count: inputApiKeyCount })}</span>
              {configForm.api_key_configured ? (
                <span className={styles.chip}>{t('admin.riskControl.storedApiKeyCount', { count: configForm.api_key_count })}</span>
              ) : null}
              {configForm.clear_api_key ? (
                <span className={`${styles.chip} ${styles.chipDanger}`}>{t('admin.riskControl.apiKeyWillClear')}</span>
              ) : pendingDeletedApiKeyCount > 0 ? (
                <span className={`${styles.chip} ${styles.chipWarning}`}>
                  {t('admin.riskControl.apiKeyPendingDeleteCount', { count: pendingDeletedApiKeyCount })}
                </span>
              ) : null}
              {configForm.api_keys_mode === 'replace' ? (
                <span className={`${styles.chip} ${styles.chipWarning}`}>{t('admin.riskControl.apiKeysReplaceWarning')}</span>
              ) : null}
            </div>

            <div className={styles.testBox} onPaste={(event) => void handleModerationImagePaste(event)}>
              <div className={styles.rowBetween}>
                <div>
                  <p className={styles.rowTitle}>{t('admin.riskControl.auditTestInput')}</p>
                  <p className={styles.hint}>{t('admin.riskControl.auditTestInputHint')}</p>
                </div>
                {moderationTestPrompt || moderationTestImages.length > 0 || moderationTestResult ? (
                  <Button type="button" size="sm" variant="ghost" onClick={clearModerationTestInput}>
                    <X size={14} aria-hidden="true" />
                    {t('admin.riskControl.clearAuditTest')}
                  </Button>
                ) : null}
              </div>
              <textarea
                className={`${styles.input} ${styles.textarea}`}
                rows={4}
                value={moderationTestPrompt}
                placeholder={t('admin.riskControl.auditTestPromptPlaceholder')}
                aria-label={t('admin.riskControl.auditTestInput')}
                onChange={(event) => setModerationTestPrompt(event.target.value)}
              />
              <div
                className={styles.dropzone}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void handleModerationImageDrop(event)}
              >
                <div className={styles.dropzoneHead}>
                  <div className={styles.headingWithIcon}>
                    <Upload size={18} aria-hidden="true" className={styles.mutedIcon} />
                    <div>
                      <p className={styles.rowTitle}>{t('admin.riskControl.auditTestImages')}</p>
                      <p className={styles.hint}>{t('admin.riskControl.auditTestImagesHint')}</p>
                    </div>
                  </div>
                  <label className={styles.fileButton}>
                    <Plus size={16} aria-hidden="true" />
                    {t('admin.riskControl.addAuditTestImage')}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className={styles.srOnly}
                      onChange={(event) => void handleModerationImageUpload(event)}
                    />
                  </label>
                </div>
                {moderationTestImages.length > 0 ? (
                  <div className={styles.imageGrid}>
                    {moderationTestImages.map((image, index) => (
                      <div key={image.slice(0, 64) + index} className={styles.imageTile}>
                        <img src={image} alt="" />
                        <button
                          type="button"
                          className={styles.imageRemove}
                          aria-label={t('common.delete')}
                          onClick={() => removeModerationTestImage(index)}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div data-test="audit-key-statuses" className={styles.keyPanel}>
            <div className={styles.rowBetween}>
              <div>
                <p className={styles.rowTitle}>{t('admin.riskControl.apiKeyHealth')}</p>
                <p className={styles.hint}>{t('admin.riskControl.apiKeyFreezeRule')}</p>
              </div>
              <Badge tone="neutral" size="sm">
                {t('admin.riskControl.apiKeyRows', { count: apiKeyRows.length })}
              </Badge>
            </div>

            {apiKeyRows.length === 0 ? (
              <div className={styles.keyEmpty}>
                <p className={styles.rowTitle}>{t('admin.riskControl.apiKeyHealthEmpty')}</p>
                <p className={styles.hint}>{t('admin.riskControl.apiKeyHealthEmptyHint')}</p>
              </div>
            ) : (
              <div className={styles.stackGap2}>
                <div className={`${styles.stackGap2} ${apiKeyRowsExpanded ? styles.keyListExpanded : ''}`}>
                  {visibleApiKeyRows.map((row, index) => (
                    <div
                      key={apiKeyRowKey(row, index)}
                      className={styles.keyRow}
                      data-pending={isStoredApiKeyPendingDelete(row) ? 'true' : undefined}
                    >
                      <div className={styles.rowBetween}>
                        <div className={styles.minW0}>
                          <div className={styles.keyTitle}>
                            <span className={styles.keyMask}>{row.masked || '-'}</span>
                            <Badge tone={row.configured ? 'info' : 'neutral'} size="sm">
                              {isStoredApiKeyPendingDelete(row)
                                ? t('admin.riskControl.apiKeyPendingDelete')
                                : row.configured
                                  ? t('admin.riskControl.apiKeyConfigured')
                                  : t('admin.riskControl.apiKeyTemporary')}
                            </Badge>
                          </div>
                          <p className={styles.hint}>{apiKeyStatusMeta(row)}</p>
                        </div>
                        <div className={styles.keyActions}>
                          <Badge tone={apiKeyStatusTone(row.status)} size="sm">
                            {apiKeyStatusLabel(row.status)}
                          </Badge>
                          {row.configured && !configForm.clear_api_key ? (
                            <button
                              type="button"
                              className={styles.iconButton}
                              title={
                                isStoredApiKeyPendingDelete(row)
                                  ? t('admin.riskControl.undoDeleteApiKey')
                                  : t('admin.riskControl.deleteApiKey')
                              }
                              aria-label={
                                isStoredApiKeyPendingDelete(row)
                                  ? t('admin.riskControl.undoDeleteApiKey')
                                  : t('admin.riskControl.deleteApiKey')
                              }
                              onClick={() => toggleDeleteStoredApiKey(row)}
                            >
                              {isStoredApiKeyPendingDelete(row) ? (
                                <RefreshCw size={14} aria-hidden="true" />
                              ) : (
                                <Trash2 size={14} aria-hidden="true" />
                              )}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {row.last_error ? <p className={styles.keyError}>{row.last_error}</p> : null}
                    </div>
                  ))}
                </div>

                {canToggleApiKeyRows ? (
                  <div className={styles.keyToggle}>
                    <span className={styles.truncate}>
                      {apiKeyRowsExpanded
                        ? t('admin.riskControl.apiKeyRowsExpanded', { count: apiKeyRows.length })
                        : t('admin.riskControl.apiKeyRowsCollapsed', { count: hiddenApiKeyRowCount })}
                    </span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setApiKeyRowsExpanded((v) => !v)}>
                      {apiKeyRowsExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                      {apiKeyRowsExpanded ? t('admin.riskControl.collapseApiKeyRows') : t('admin.riskControl.expandApiKeyRows')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}

            {moderationTestResult ? (
              <div className={styles.testResult}>
                {moderationTestResult.engine_meta ? (
                  <p className={styles.hint}>
                    {engineLabel(moderationTestResult.engine_meta.engine)} · {moderationTestResult.engine_meta.model} ·{' '}
                    {moderationTestResult.engine_meta.rules_version}
                    {moderationTestResult.engine_meta.skipped_images ? (
                      <span>
                        {' '}
                        · {t('admin.riskControl.skippedImages', { count: moderationTestResult.engine_meta.skipped_images })}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <div className={styles.rowBetween}>
                  <div>
                    <p className={styles.rowTitle}>{t('admin.riskControl.auditTestResult')}</p>
                    <p className={styles.hint}>
                      {t('admin.riskControl.auditTestHighest', {
                        category: moderationTestResult.highest_category || '-',
                        score: percent(moderationTestResult.highest_score)
                      })}
                    </p>
                  </div>
                  <Badge tone={moderationTestResult.flagged ? 'danger' : 'success'} size="sm">
                    {moderationTestResult.flagged ? t('admin.riskControl.auditTestFlagged') : t('admin.riskControl.auditTestPassed')}
                  </Badge>
                </div>
                <div>
                  <div className={styles.barLabel}>
                    <span>{t('admin.riskControl.auditTestComposite')}</span>
                    <span className={styles.strong}>{percent(moderationTestResult.composite_score)}</span>
                  </div>
                  <div className={styles.barTrack}>
                    <div
                      className={moderationTestResult.flagged ? styles.barDanger : styles.barSuccess}
                      style={{ width: percentWidth(moderationTestResult.composite_score) }}
                    />
                  </div>
                </div>
                <div className={styles.scoreList}>
                  {moderationScoreRows.map((score) => (
                    <div key={score.category}>
                      <div className={styles.barLabel}>
                        <span className={styles.truncate}>{score.category}</span>
                        <span className={styles.mono}>
                          {percent(score.score)} / {percent(score.threshold)}
                        </span>
                      </div>
                      <div className={`${styles.barTrack} ${styles.barThin}`}>
                        <div className={score.hit ? styles.barDanger : styles.barAccent} style={{ width: percentWidth(score.score) }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )

  const scopeTab = (
    <div className={styles.tabBody}>
      <div className={styles.sectionHead}>
        <div>
          <h3 className={styles.h3}>{t('admin.riskControl.groupScope')}</h3>
          <p className={styles.hint}>{t('admin.riskControl.groupScopeHint')}</p>
        </div>
        <SegmentedControl
          options={[
            { value: 'all', label: t('admin.riskControl.allGroups') },
            { value: 'selected', label: t('admin.riskControl.selectedGroups') }
          ]}
          value={configForm.all_groups ? 'all' : 'selected'}
          onValueChange={(value) => patchForm({ all_groups: value === 'all' })}
          label={t('admin.riskControl.groupScope')}
        />
      </div>

      {!configForm.all_groups ? (
        <div className={styles.stackGap3}>
          <div className={styles.searchWrap}>
            <Search size={16} aria-hidden="true" className={styles.searchIcon} />
            <input
              type="search"
              className={`${styles.input} ${styles.searchInput}`}
              value={groupSearch}
              placeholder={t('admin.riskControl.searchGroups')}
              aria-label={t('admin.riskControl.searchGroups')}
              onChange={(event) => setGroupSearch(event.target.value)}
            />
          </div>
          <div className={styles.groupGrid}>
            {filteredGroups.map((group) => {
              const selected = configForm.group_ids.includes(group.id)
              return (
                <button
                  key={group.id}
                  type="button"
                  className={styles.groupCard}
                  aria-pressed={selected}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span className={styles.minW0}>
                    <span className={styles.groupName}>{group.name}</span>
                    <span className={styles.chip}>{group.platform}</span>
                  </span>
                  <span className={styles.checkCircle} data-checked={selected ? 'true' : undefined}>
                    <Check size={12} aria-hidden="true" />
                  </span>
                </button>
              )
            })}
            {filteredGroups.length === 0 ? <p className={styles.hint}>{t('admin.riskControl.noGroups')}</p> : null}
          </div>
        </div>
      ) : null}

      <section className={styles.subRegion}>
        <div className={styles.subRegionBody}>
          <div className={styles.sectionHead}>
            <div>
              <h3 className={styles.h3}>{t('admin.riskControl.modelFilter')}</h3>
              <p className={styles.hint}>{t('admin.riskControl.modelFilterHint')}</p>
            </div>
            <span className={styles.chip}>{modelFilterSummary}</span>
          </div>

          <RadioCards
            options={modelFilterOptions}
            value={configForm.model_filter_type}
            onValueChange={(value) => setModelFilterType(value as ContentModerationModelFilterType)}
            minColumnWidth={200}
            aria-label={t('admin.riskControl.modelFilter')}
          />

          {configForm.model_filter_type !== 'all'
            ? field(
                t('admin.riskControl.modelFilterModels'),
                <ModelWhitelistSelector
                  value={configForm.model_filter_models}
                  onChange={(value) => patchForm({ model_filter_models: value })}
                />,
                t('admin.riskControl.modelFilterModelCount', { count: modelFilterModelCount })
              )
            : null}
        </div>
      </section>
    </div>
  )

  const runtimeTab = (
    <div className={styles.grid2}>
      {field(
        t('admin.riskControl.workerCount'),
        numberInput(configForm.worker_count, (value) => patchForm({ worker_count: value }), {
          min: 1,
          max: 32,
          label: t('admin.riskControl.workerCount')
        })
      )}
      {field(
        t('admin.riskControl.queueSize'),
        numberInput(configForm.queue_size, (value) => patchForm({ queue_size: value }), {
          min: 100,
          max: 100000,
          label: t('admin.riskControl.queueSize')
        })
      )}
      {toggleRow(
        t('admin.riskControl.recordNonHits'),
        t('admin.riskControl.recordNonHitsHint'),
        configForm.record_non_hits,
        (value) => patchForm({ record_non_hits: value }),
        styles.span2
      )}
      <section className={`${styles.subRegion} ${styles.span2}`}>
        <div className={styles.subRegionBody}>
          <div className={styles.rowBetween}>
            <div>
              <p className={styles.rowTitle}>{t('admin.riskControl.preHashCheck')}</p>
              <p className={styles.hint}>{t('admin.riskControl.preHashCheckHint')}</p>
            </div>
            <Toggle
              value={configForm.pre_hash_check_enabled}
              onChange={(value) => patchForm({ pre_hash_check_enabled: value })}
              aria-label={t('admin.riskControl.preHashCheck')}
            />
          </div>
          <div className={styles.mutedBox}>
            <div className={styles.rowBetween}>
              <div>
                <p className={styles.rowTitle}>
                  {t('admin.riskControl.flaggedHashCount', { count: formatNumber(status?.flagged_hash_count ?? 0) })}
                </p>
                <p className={styles.hint}>{t('admin.riskControl.flaggedHashHint')}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                className={styles.dangerText}
                disabled={hashActionLoading || (status?.flagged_hash_count ?? 0) === 0}
                onClick={() => void clearFlaggedHashes()}
              >
                <Trash2 size={16} aria-hidden="true" className={hashActionLoading ? styles.pulse : undefined} />
                {t('admin.riskControl.clearFlaggedHashes')}
              </Button>
            </div>
            <div className={styles.inlineForm}>
              <input
                type="text"
                className={`${styles.input} ${styles.mono}`}
                value={flaggedHashInput}
                placeholder={t('admin.riskControl.flaggedHashPlaceholder')}
                aria-label={t('admin.riskControl.flaggedHashPlaceholder')}
                onChange={(event) => setFlaggedHashInput(event.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={hashActionLoading || !isFlaggedHashInputValid}
                onClick={() => void deleteFlaggedHash()}
              >
                <Trash2 size={16} aria-hidden="true" />
                {t('admin.riskControl.deleteFlaggedHash')}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )

  const responseTab = (
    <div className={styles.grid2}>
      {field(
        t('admin.riskControl.blockStatus'),
        numberInput(configForm.block_status, (value) => patchForm({ block_status: value }), {
          min: 400,
          max: 599,
          label: t('admin.riskControl.blockStatus')
        })
      )}
      {field(
        t('admin.riskControl.blockMessage'),
        <input
          type="text"
          className={styles.input}
          value={configForm.block_message}
          aria-label={t('admin.riskControl.blockMessage')}
          onChange={(event) => patchForm({ block_message: event.target.value })}
          onBlur={(event) => patchForm({ block_message: event.target.value.trim() })}
        />
      )}
      {toggleRow(t('admin.riskControl.emailOnHit'), t('admin.riskControl.emailOnHitHint'), configForm.email_on_hit, (value) =>
        patchForm({ email_on_hit: value })
      )}
      {toggleRow(t('admin.riskControl.autoBan'), t('admin.riskControl.autoBanHint'), configForm.auto_ban_enabled, (value) =>
        patchForm({ auto_ban_enabled: value })
      )}
      {toggleRow(
        t('admin.riskControl.cyberPolicyExcludeBan'),
        t('admin.riskControl.cyberPolicyExcludeBanHint'),
        configForm.cyber_policy_exclude_from_ban_count,
        (value) => patchForm({ cyber_policy_exclude_from_ban_count: value }),
        styles.span2
      )}
      {field(
        t('admin.riskControl.banThreshold'),
        numberInput(configForm.ban_threshold, (value) => patchForm({ ban_threshold: value }), {
          min: 1,
          max: 1000,
          label: t('admin.riskControl.banThreshold')
        })
      )}
      {field(
        t('admin.riskControl.violationWindowHours'),
        numberInput(configForm.violation_window_hours, (value) => patchForm({ violation_window_hours: value }), {
          min: 1,
          max: 8760,
          label: t('admin.riskControl.violationWindowHours')
        })
      )}
    </div>
  )

  const thresholdsTab = (
    <div className={styles.tabBody}>
      <p className={styles.rowTitle}>{engineLabel(configForm.engine)}</p>
      {configForm.engine === 'typesafe' ? <p className={styles.warningText}>{t('admin.riskControl.typeSafeThresholds')}</p> : null}
      <div className={styles.sectionHead}>
        <div>
          <h3 className={styles.h3}>{t('admin.riskControl.riskThresholds')}</h3>
          <p className={styles.hint}>{t('admin.riskControl.riskThresholdsHint')}</p>
        </div>
        <Button type="button" variant="secondary" onClick={resetRiskThresholds}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('admin.riskControl.riskThresholdReset')}
        </Button>
      </div>

      <div className={styles.thresholdGrid}>
        {riskThresholdRows.map((row) => (
          <div key={row.category} className={styles.thresholdItem}>
            <div className={styles.rowBetween}>
              <div className={styles.minW0}>
                <label className={styles.thresholdName} htmlFor={`risk-threshold-${row.category}`}>
                  {row.category}
                </label>
                <p className={styles.hint}>
                  {t('admin.riskControl.riskThresholdDefault', { value: formatThresholdPercent(row.defaultValue) })}
                </p>
              </div>
              <span className={`${styles.chip} ${styles.mono}`}>{formatThresholdPercent(row.value)}</span>
            </div>
            {numberInput(
              configForm.thresholds[row.category],
              (value) => setForm((prev) => ({ ...prev, thresholds: { ...prev.thresholds, [row.category]: value } })),
              {
                min: 0,
                max: 100,
                step: 0.1,
                id: `risk-threshold-${row.category}`,
                testId: `risk-threshold-${row.category}`,
                label: t('admin.riskControl.riskThresholdPercent'),
                suffix: '%'
              }
            )}
          </div>
        ))}
      </div>
    </div>
  )

  const keywordsTab = (
    <div className={styles.tabBody}>
      <Alert tone={keywordNotice.tone} title={keywordNotice.title}>
        {keywordNotice.description}
      </Alert>

      {field(
        t('admin.riskControl.keywordBlockingMode'),
        <RadioCards
          options={keywordBlockingModeOptions}
          value={configForm.keyword_blocking_mode}
          onValueChange={(value) => patchForm({ keyword_blocking_mode: value as KeywordBlockingMode })}
          minColumnWidth={180}
          aria-label={t('admin.riskControl.keywordBlockingMode')}
        />
      )}

      <div className={styles.field}>
        <div className={styles.rowBetween}>
          <span className={styles.label}>{t('admin.riskControl.blockedKeywords')}</span>
          <span className={styles.chip}>{t('admin.riskControl.blockedKeywordCount', { count: blockedKeywordCount })}</span>
        </div>
        <textarea
          className={`${styles.input} ${styles.textarea} ${styles.mono} ${styles.keywordTextarea}`}
          value={configForm.blocked_keywords_text}
          placeholder={t('admin.riskControl.blockedKeywordsPlaceholder')}
          aria-label={t('admin.riskControl.blockedKeywords')}
          disabled={configForm.keyword_blocking_mode === 'api_only'}
          onChange={(event) => patchForm({ blocked_keywords_text: event.target.value })}
        />
        <p className={styles.hint}>{t('admin.riskControl.blockedKeywordsLimit', { max: blockedKeywordMax })}</p>
      </div>
    </div>
  )

  const retentionTab = (
    <div className={styles.grid2}>
      {field(
        t('admin.riskControl.hitRetentionDays'),
        numberInput(configForm.hit_retention_days, (value) => patchForm({ hit_retention_days: value }), {
          min: 1,
          max: 3650,
          label: t('admin.riskControl.hitRetentionDays')
        })
      )}
      {field(
        t('admin.riskControl.nonHitRetentionDays'),
        numberInput(configForm.non_hit_retention_days, (value) => patchForm({ non_hit_retention_days: value }), {
          min: 1,
          max: 3,
          label: t('admin.riskControl.nonHitRetentionDays')
        })
      )}
      <div className={`${styles.mutedBox} ${styles.span2} ${styles.headingWithIcon}`}>
        <Database size={18} aria-hidden="true" className={styles.mutedIcon} />
        <span className={styles.hint}>
          {t('admin.riskControl.cleanupStats', {
            hit: status?.last_cleanup_deleted_hit ?? 0,
            nonHit: status?.last_cleanup_deleted_non_hit ?? 0
          })}
        </span>
      </div>
    </div>
  )

  const tabContent: Record<SettingsTab, ReactNode> = {
    basic: basicTab,
    scope: scopeTab,
    runtime: runtimeTab,
    response: responseTab,
    riskThresholds: thresholdsTab,
    keywords: keywordsTab,
    retention: retentionTab
  }

  if (loading) {
    return (
      <div className={styles.page} aria-busy="true">
        <div className={styles.overviewGrid}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={styles.overviewTile}>
              <Skeleton height="3rem" />
            </div>
          ))}
        </div>
        <div className={styles.region}>
          <div className={styles.regionBody}>
            <Skeleton height="12rem" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <p className={styles.activeEngine} data-test="active-audit-engine">
          {t('admin.riskControl.activeEngine', { engine: engineLabel(status?.engine ?? savedEngine) })}
        </p>
        <div className={styles.buttonRow}>
          <Button type="button" variant="secondary" disabled={statusLoading} onClick={() => void loadStatus(false)}>
            <RefreshCw size={16} aria-hidden="true" className={statusLoading ? styles.spin : undefined} />
            {t('admin.riskControl.refreshStatus')}
          </Button>
          <Button type="button" variant="primary" onClick={openSettings}>
            <Settings size={16} aria-hidden="true" />
            {t('admin.riskControl.openSettings')}
          </Button>
        </div>
      </div>

      {status?.enabled && status.risk_control_enabled && status.mode !== 'off' && status.pre_block_api_key_available_count === 0 ? (
        <Alert tone="warning" title={t('admin.riskControl.engineUnavailable')} role="status" />
      ) : null}

      <div className={styles.overviewGrid}>
        {overviewItems.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.key} className={styles.overviewTile}>
              <span className={`${styles.iconBox} ${overviewIconClass[item.tone]}`}>
                <Icon size={16} aria-hidden="true" />
              </span>
              <div className={styles.minW0Flex}>
                <div className={styles.rowBetween}>
                  <p className={styles.tileLabel}>{item.label}</p>
                  {item.badge ? (
                    <Badge tone={item.badgeTone} size="sm">
                      {item.badge}
                    </Badge>
                  ) : null}
                </div>
                <div className={styles.tileValueRow}>
                  <p className={styles.tileValue}>{item.value}</p>
                  {item.meta ? <p className={styles.tileMeta}>{item.meta}</p> : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showPreBlockRuntimeCard ? (
        <div data-test="pre-block-runtime-cards" className={styles.preBlockGrid}>
          <section data-test="pre-block-sync-card" className={styles.region}>
            <div className={styles.regionHeader}>
              <div>
                <h2 className={styles.h2}>{t('admin.riskControl.preBlockSyncStatus')}</h2>
                <p className={styles.hint}>{t('admin.riskControl.preBlockSyncHint')}</p>
              </div>
              <Badge tone="neutral" size="sm">
                {modeLabel(status?.mode ?? configForm.mode)}
              </Badge>
            </div>
            <div className={styles.regionBody}>
              <div data-test="pre-block-metric-grid" className={styles.metricGrid}>
                {preBlockMetricItems.map((item) => (
                  <MetricCard key={item.key} label={item.label} value={item.value} suffix={item.suffix} context={item.meta} />
                ))}
              </div>
            </div>
          </section>

          <section data-test="pre-block-api-key-load-card" className={styles.region}>
            <div className={styles.regionHeader}>
              <div>
                <h2 className={styles.h2}>{t('admin.riskControl.preBlockAPIKeyLoad')}</h2>
                <p className={styles.hint}>{t('admin.riskControl.preBlockAPIKeyLoadHint')}</p>
              </div>
              <Badge tone="neutral" size="sm">
                {preBlockAPIKeyLoadSummaryText}
              </Badge>
            </div>
            <div className={styles.regionBody}>
              {preBlockAPIKeyLoads.length > 0 ? (
                <div data-test="pre-block-api-key-load-list" className={styles.loadList}>
                  {preBlockAPIKeyLoads.map((item) => (
                    <div key={item.key_hash || item.index} className={styles.loadItem}>
                      <div className={styles.loadHead}>
                        <div className={styles.minW0}>
                          <div className={styles.keyTitle}>
                            <span className={styles.keyMask}>#{item.index + 1}</span>
                            <span className={`${styles.mono} ${styles.truncate}`}>{item.masked || '-'}</span>
                            <span className={`${styles.dot} ${statusDotClass[item.status] ?? styles.dotMuted}`} />
                          </div>
                          <p className={styles.hint}>
                            {t('admin.riskControl.preBlockAPIKeyTotals', {
                              total: formatNumber(item.total),
                              success: formatNumber(item.success),
                              errors: formatNumber(item.errors)
                            })}
                          </p>
                        </div>
                        <dl className={styles.loadStats}>
                          <div>
                            <dt>{t('admin.riskControl.preBlockKeyActiveShort')}</dt>
                            <dd className={styles.accentText}>{formatNumber(item.active)}</dd>
                          </div>
                          <div>
                            <dt>{t('admin.riskControl.preBlockKeyTotalShort')}</dt>
                            <dd>{formatNumber(item.total)}</dd>
                          </div>
                          <div>
                            <dt>{t('admin.riskControl.preBlockKeyAvgShort')}</dt>
                            <dd>{formatNumber(item.avg_latency_ms)} ms</dd>
                          </div>
                          <div>
                            <dt>{t('admin.riskControl.preBlockKeyLastShort')}</dt>
                            <dd>{formatNumber(item.last_latency_ms)} ms</dd>
                          </div>
                        </dl>
                      </div>
                      <div className={`${styles.barTrack} ${styles.barThin}`}>
                        <div className={styles.barAccent} style={{ width: preBlockAPIKeyLoadWidth(item.total) }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.mutedBox}>{t('admin.riskControl.preBlockAPIKeyLoadEmpty')}</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {showWorkerRuntimeCard ? (
        <section className={styles.region}>
          <div className={styles.regionHeader}>
            <div>
              <h2 className={styles.h2}>{t('admin.riskControl.workerStatus')}</h2>
              <p className={styles.hint}>{t('admin.riskControl.workerStatusHint')}</p>
            </div>
            <div className={styles.headerMeta}>
              <span>{t('admin.riskControl.autoRefresh')}</span>
              {status?.last_cleanup_at ? (
                <span>{t('admin.riskControl.lastCleanup', { time: formatDateTime(status.last_cleanup_at) })}</span>
              ) : null}
            </div>
          </div>

          <div className={`${styles.regionBody} ${styles.workerLayout}`}>
            <div className={styles.stackGap4}>
              <div className={styles.mutedBox}>
                <div className={styles.rowBetween}>
                  <div>
                    <p className={styles.rowTitle}>{t('admin.riskControl.queueUsage')}</p>
                    <p className={styles.hint}>
                      {formatNumber(status?.queue_length ?? 0)} / {formatNumber(status?.queue_size ?? Number(configForm.queue_size))}
                    </p>
                  </div>
                  <span className={styles.strong}>{queueUsagePercent}</span>
                </div>
                <div className={styles.barTrack}>
                  <div className={styles.barAccent} style={{ width: queueUsagePercent }} />
                </div>
              </div>

              <dl className={styles.statGrid}>
                <div className={styles.statItem}>
                  <dt>{t('admin.riskControl.activeWorkers')}</dt>
                  <dd>{status?.active_workers ?? 0}</dd>
                </div>
                <div className={styles.statItem}>
                  <dt>{t('admin.riskControl.idleWorkers')}</dt>
                  <dd className={styles.successText}>{status?.idle_workers ?? configForm.worker_count}</dd>
                </div>
                <div className={styles.statItem}>
                  <dt>{t('admin.riskControl.processed')}</dt>
                  <dd>{formatNumber(status?.processed ?? 0)}</dd>
                </div>
                <div className={styles.statItem}>
                  <dt>{t('admin.riskControl.droppedErrors')}</dt>
                  <dd>{formatNumber((status?.dropped ?? 0) + (status?.errors ?? 0))}</dd>
                </div>
              </dl>
            </div>

            <div>
              <div className={styles.rowBetween}>
                <div>
                  <p className={styles.rowTitle}>{t('admin.riskControl.workerPool')}</p>
                  <p className={styles.hint}>
                    {t('admin.riskControl.workerPoolMeta', {
                      active: status?.active_workers ?? 0,
                      idle: status?.idle_workers ?? configForm.worker_count,
                      total: status?.worker_count ?? configForm.worker_count
                    })}
                  </p>
                </div>
                <Badge tone="neutral" size="sm">
                  {modeLabel(status?.mode ?? configForm.mode)}
                </Badge>
              </div>
              <div className={styles.slotGrid}>
                {workerSlots.map((worker) => (
                  <div key={worker.id} className={`${styles.slot} ${workerSlotClass[worker.state]}`} title={worker.label}>
                    <span>#{worker.id}</span>
                    <span className={styles.slotDot} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className={styles.region}>
        <div className={styles.regionHeader}>
          <div>
            <h2 className={styles.h2}>{t('admin.riskControl.records')}</h2>
            <p className={styles.hint}>{t('admin.riskControl.recordsHint')}</p>
          </div>
          <Button type="button" variant="secondary" disabled={logsLoading} onClick={() => void loadLogs()}>
            <RefreshCw size={16} aria-hidden="true" className={logsLoading ? styles.spin : undefined} />
            {t('admin.riskControl.refresh')}
          </Button>
        </div>

        <div className={styles.regionBody}>
          <div className={styles.modelStrip}>
            <div className={styles.modelStripSummary}>
              <Filter size={14} aria-hidden="true" className={styles.mutedIcon} />
              <span className={styles.strong}>{t('admin.riskControl.modelFilter')}</span>
              <span className={styles.truncateMuted}>{modelFilterSummary}</span>
            </div>
            {modelFilterPreviewModels.length > 0 ? (
              <div className={styles.chips}>
                {modelFilterPreviewModels.map((model) => (
                  <span key={model} className={`${styles.chip} ${styles.mono}`}>
                    {model}
                  </span>
                ))}
                {hiddenModelFilterModelCount > 0 ? <span className={styles.chip}>+{hiddenModelFilterModelCount}</span> : null}
              </div>
            ) : null}
          </div>

          <div className={styles.filterRow}>
            <Select
              value={filters.result}
              options={resultOptions}
              aria-label={t('admin.riskControl.table.result')}
              onChange={(value) => reloadLogsFromFirstPage({ result: value == null ? '' : String(value) })}
            />
            <Select
              value={filters.group_id}
              options={groupFilterOptions}
              aria-label={t('admin.riskControl.table.group')}
              onChange={(value) => reloadLogsFromFirstPage({ group_id: Number(value) || 0 })}
            />
            <Select
              value={filters.endpoint}
              options={endpointOptions}
              aria-label={t('admin.riskControl.table.endpoint')}
              onChange={(value) => reloadLogsFromFirstPage({ endpoint: value == null ? '' : String(value) })}
            />
            <input
              type="search"
              className={styles.input}
              value={filters.search}
              placeholder={t('admin.riskControl.filters.search')}
              aria-label={t('admin.riskControl.filters.search')}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
              onKeyUp={(event) => {
                if (event.key === 'Enter') reloadLogsFromFirstPage()
              }}
            />
            <input
              type="datetime-local"
              className={styles.input}
              value={filters.from}
              title={t('admin.riskControl.filters.from')}
              aria-label={t('admin.riskControl.filters.from')}
              onChange={(event) => reloadLogsFromFirstPage({ from: event.target.value })}
            />
            <input
              type="datetime-local"
              className={styles.input}
              value={filters.to}
              title={t('admin.riskControl.filters.to')}
              aria-label={t('admin.riskControl.filters.to')}
              onChange={(event) => reloadLogsFromFirstPage({ to: event.target.value })}
            />
          </div>
        </div>

        <div className={styles.tableWrap}>
          <DataTable<ContentModerationLog>
            columns={logColumns}
            data={logs}
            loading={logsLoading}
            rowKey="id"
            cells={logCells}
            stickyActionsColumn={false}
            empty={<p className={styles.emptyLine}>{t('admin.riskControl.emptyLogs')}</p>}
          />
        </div>

        {pagination.total > 0 ? (
          <div className={styles.paginationWrap}>
            <Pagination
              page={pagination.page}
              total={pagination.total}
              pageSize={pagination.page_size}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          </div>
        ) : null}
      </section>

      <Drawer
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!open) setSettingsOpen(false)
        }}
      >
        <DrawerContent title={t('admin.riskControl.settingsTitle')} side="right" className={styles.drawer}>
          <div className={styles.drawerInner}>
            <div className={styles.drawerBody}>
              <Tabs value={activeSettingsTab} onValueChange={(value) => setActiveSettingsTab(value as SettingsTab)}>
                <TabsList aria-label={t('admin.riskControl.settingsTitle')}>
                  {settingsTabs.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id}>
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {settingsTabs.map((tab) => (
                  <TabsContent key={tab.id} value={tab.id} className={styles.tabPanel}>
                    {tabContent[tab.id]}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
            <div className={styles.drawerFooter}>
              <Button type="button" variant="secondary" onClick={() => setSettingsOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" variant="primary" disabled={saving} loading={saving} onClick={() => void saveConfig()}>
                {saving ? null : <Check size={16} aria-hidden="true" />}
                {saving ? t('common.saving') : t('admin.riskControl.saveConfig')}
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <BaseDialog
        show={inputDetailRow !== null}
        title={t('admin.riskControl.inputDetailTitle')}
        width="wide"
        onClose={() => setInputDetailRow(null)}
        footer={
          <div className={styles.footerEnd}>
            <Button type="button" variant="secondary" onClick={() => setInputDetailRow(null)}>
              {t('common.close')}
            </Button>
          </div>
        }
      >
        {inputDetailRow ? (
          <div className={styles.tabBody}>
            <div className={styles.breakWords} data-test="audit-engine-meta">
              <span className={styles.strong}>{t('admin.riskControl.auditSource')}: </span>
              {inputDetailRow.engine_meta ? (
                <>
                  {engineLabel(inputDetailRow.engine_meta.engine)} · {inputDetailRow.engine_meta.model || '-'} ·{' '}
                  {inputDetailRow.engine_meta.rules_version || '-'}
                  {inputDetailRow.engine_meta.skipped_images ? (
                    <span> · {t('admin.riskControl.skippedImages', { count: inputDetailRow.engine_meta.skipped_images })}</span>
                  ) : null}
                </>
              ) : ['cyber_policy', 'keyword_block', 'hash_block'].includes(inputDetailRow.action) ? (
                '-'
              ) : (
                t('admin.riskControl.legacyAuditSource')
              )}
            </div>
            <dl className={styles.detailGrid}>
              <div className={styles.detailItem}>
                <dt>{t('admin.riskControl.table.time')}</dt>
                <dd>{formatDateTime(inputDetailRow.created_at)}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>{t('admin.riskControl.table.user')}</dt>
                <dd>{inputDetailRow.user_email || '-'}</dd>
              </div>
              <div className={styles.detailItem}>
                <dt>{t('admin.riskControl.table.result')}</dt>
                <dd>
                  <Badge tone={resultTone(inputDetailRow)} size="sm">
                    {resultLabel(inputDetailRow)}
                  </Badge>
                </dd>
              </div>
              <div className={styles.detailItem}>
                <dt>{t('admin.riskControl.table.highest')}</dt>
                <dd>
                  {inputDetailRow.highest_category || '-'} / {percent(inputDetailRow.highest_score)}
                </dd>
              </div>
              {inputDetailRow.matched_keyword ? (
                <div className={`${styles.detailItem} ${styles.detailDanger}`}>
                  <dt>{t('admin.riskControl.matchedKeyword')}</dt>
                  <dd title={inputDetailRow.matched_keyword}>{inputDetailRow.matched_keyword}</dd>
                </div>
              ) : null}
            </dl>

            <div className={styles.detailContent}>
              <div className={styles.rowBetween}>
                <div>
                  <p className={styles.rowTitle}>{t('admin.riskControl.inputDetailContent')}</p>
                  <p className={styles.hint}>
                    {inputDetailRow.endpoint || '-'} · {inputDetailRow.provider || '-'} / {inputDetailRow.model || '-'}
                  </p>
                </div>
                {inputDetailRow.group_name ? (
                  <Badge tone="info" size="sm">
                    {inputDetailRow.group_name}
                  </Badge>
                ) : null}
              </div>
              <pre className={styles.pre}>{inputDetailText}</pre>
            </div>
          </div>
        ) : null}
      </BaseDialog>

      {confirmDialog}
    </div>
  )
}
