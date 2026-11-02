import { AlertTriangle, Check, Columns3, FileText, RefreshCw, RotateCcw } from 'lucide-react'
import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'

import { keysAPI, usageAPI, userGroupsAPI } from '@/api'
import UsageStatsCards from '@/components/admin/usage/UsageStatsCards'
import UsageTable from '@/components/admin/usage/UsageTable'
import { Button } from '@/components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import EndpointDistributionChart from '@/components/charts/EndpointDistributionChart'
import GroupDistributionChart from '@/components/charts/GroupDistributionChart'
import ModelDistributionChart from '@/components/charts/ModelDistributionChart'
import TokenUsageTrend from '@/components/charts/TokenUsageTrend'
import DateRangePicker, { type DateRangeValue } from '@/components/common/DateRangePicker'
import Pagination from '@/components/common/Pagination'
import Select, { type SelectOption } from '@/components/common/Select'
import type { Column } from '@/components/common/types'
import UserErrorRequestsTable from '@/components/user/UserErrorRequestsTable'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type {
  AdminUsageLog,
  ApiKey,
  EndpointStat,
  Group,
  GroupStat,
  ModelStat,
  TrendDataPoint,
  UsageLog,
  UsageQueryParams,
  UsageRequestType,
  UsageStatsResponse,
  UserErrorRequest
} from '@/types'
import { getBillingModeLabel, getDisplayBillingMode as resolveDisplayBillingMode } from '@/utils/billingMode'
import { COMMON_ERROR_STATUS_CODES } from '@/utils/errorBadges'
import { FeatureFlags, resolveFeatureFlag } from '@/utils/featureFlags'
import { formatReasoningEffort } from '@/utils/format'
import { requestTypeToLegacyStream, resolveUsageRequestType } from '@/utils/usageRequestType'
import styles from './UsageView.module.css'

type DistributionMetric = 'tokens' | 'actual_cost'
type EndpointSource = 'inbound' | 'upstream' | 'path'
type DetailTab = 'usage' | 'errors'
type Granularity = 'day' | 'hour'

interface ErrorFilter {
  model: string | null
  category: string
  api_key_id: number | null
  status_code: number | null
}

const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const getLast24HoursRangeDates = () => {
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  return { start: formatLocalDate(start), end: formatLocalDate(end) }
}

const getGranularityForRange = (start: string, end: string): Granularity => {
  const startTime = new Date(`${start}T00:00:00`).getTime()
  const endTime = new Date(`${end}T00:00:00`).getTime()
  return Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24)) <= 1 ? 'hour' : 'day'
}

const createDefaultFilters = (start: string, end: string): UsageQueryParams => ({
  start_date: start,
  end_date: end,
  request_type: undefined,
  native_compaction_v2: null,
  billing_type: null,
  billing_mode: null
})

const createDefaultErrorFilter = (): ErrorFilter => ({ model: '', category: '', api_key_id: null, status_code: null })

const errorCategoryCodes = ['auth', 'rate_limit', 'quota', 'invalid_request', 'service_unavailable', 'upstream', 'internal', 'cyber']

const ALWAYS_VISIBLE = ['created_at']
const DEFAULT_HIDDEN_COLUMNS = ['user_agent']
const HIDDEN_COLUMNS_KEY = 'user-usage-hidden-columns'

// 错误请求 tab 独立列设置(机制同用量列设置,存储互不影响)
const ERR_ALWAYS_VISIBLE = ['status', 'created_at']
const ERR_DEFAULT_HIDDEN_COLUMNS = ['user_agent']
const ERR_HIDDEN_COLUMNS_KEY = 'user-usage-error-hidden-columns'

const loadSavedHidden = (storageKey: string, defaults: string[]): Set<string> => {
  try {
    const saved = localStorage.getItem(storageKey)
    const values = saved ? (JSON.parse(saved) as string[]) : defaults
    return new Set(values)
  } catch {
    return new Set(defaults)
  }
}

const getRequestTypeExportText = (log: UsageLog): string => {
  const requestType = resolveUsageRequestType(log)
  if (requestType === 'cyber') return 'Cyber'
  if (requestType === 'live') return 'Live'
  if (requestType === 'ws_v2') return 'WS'
  if (requestType === 'stream') return 'Stream'
  if (requestType === 'sync') return 'Sync'
  return 'Unknown'
}

const escapeCSVValue = (value: unknown): string => {
  if (value == null) return ''
  const str = String(value)
  const escaped = str.replace(/"/g, '""')
  if (str === '-') return str
  if (/^[=+\-@\t\r]/.test(str)) return `"'${escaped}"`
  if (/[,"\n\r]/.test(str)) return `"${escaped}"`
  return str
}

const isAbortError = (error: unknown): boolean => {
  const e = error as { name?: string; code?: string } | null
  return e?.name === 'AbortError' || e?.code === 'ERR_CANCELED'
}

/** 用户端用量记录：统计卡片、图表、用量明细与错误请求 */
export default function UsageView() {
  const { t } = useI18n()
  const cachedPublicSettings = useAppStore((s) => s.cachedPublicSettings)

  const [initial] = useState(() => {
    const range = getLast24HoursRangeDates()
    return { start: range.start, end: range.end, granularity: getGranularityForRange(range.start, range.end) }
  })

  const [usageStats, setUsageStats] = useState<UsageStatsResponse | null>(null)
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([])
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([])
  const [requestedModelStats, setRequestedModelStats] = useState<ModelStat[]>([])
  const [groupStats, setGroupStats] = useState<GroupStat[]>([])
  const [inboundEndpointStats, setInboundEndpointStats] = useState<EndpointStat[]>([])
  const [upstreamEndpointStats, setUpstreamEndpointStats] = useState<EndpointStat[]>([])
  const [endpointPathStats, setEndpointPathStats] = useState<EndpointStat[]>([])

  const [loading, setLoading] = useState(false)
  const [chartsLoading, setChartsLoading] = useState(false)
  const [modelStatsLoading, setModelStatsLoading] = useState(false)
  const [endpointStatsLoading, setEndpointStatsLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [errorRows, setErrorRowsState] = useState<UserErrorRequest[]>([])
  const errorRowsRef = useRef<UserErrorRequest[]>([])
  const [errorLoading, setErrorLoading] = useState(false)
  const [errorPage, setErrorPageState] = useState(1)
  const [errorPageSize, setErrorPageSizeState] = useState(20)
  const errorQueryRef = useRef({ page: 1, pageSize: 20, sortBy: 'created_at', sortOrder: 'desc' as 'asc' | 'desc' })
  const [errorTotal, setErrorTotal] = useState(0)
  const [errorFilter, setErrorFilterState] = useState<ErrorFilter>(createDefaultErrorFilter)
  const errorFilterRef = useRef<ErrorFilter>(errorFilter)

  const abortController = useRef<AbortController | null>(null)
  const chartReqSeq = useRef(0)
  const statsReqSeq = useRef(0)
  const modelStatsReqSeq = useRef(0)

  const [startDate, setStartDateState] = useState(initial.start)
  const [endDate, setEndDateState] = useState(initial.end)
  const datesRef = useRef({ start: initial.start, end: initial.end })
  const [granularity, setGranularityState] = useState<Granularity>(initial.granularity)
  const granularityRef = useRef<Granularity>(initial.granularity)

  const [modelDistributionMetric, setModelDistributionMetric] = useState<DistributionMetric>('tokens')
  const [groupDistributionMetric, setGroupDistributionMetric] = useState<DistributionMetric>('tokens')
  const [endpointDistributionMetric, setEndpointDistributionMetric] = useState<DistributionMetric>('tokens')
  // Endpoint source switching is handled by the chart component using already loaded stats.
  const [endpointDistributionSource, setEndpointDistributionSource] = useState<EndpointSource>('inbound')
  const [activeTab, setActiveTabState] = useState<DetailTab>('usage')
  const activeTabRef = useRef<DetailTab>('usage')
  const errorViewEnabled = cachedPublicSettings?.allow_user_view_error_requests ?? false

  const [filters, setFiltersState] = useState<UsageQueryParams>(() => createDefaultFilters(initial.start, initial.end))
  const filtersRef = useRef<UsageQueryParams>(filters)
  const [pagination, setPaginationState] = useState(() => ({ page: 1, page_size: getPersistedPageSize(), total: 0 }))
  const paginationRef = useRef(pagination)
  const sortState = useRef({ sort_by: 'created_at', sort_order: 'desc' as 'asc' | 'desc' })

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [modelOptionValues, setModelOptionValues] = useState<string[]>([])
  const modelOptionValuesRef = useRef<string[]>([])

  // 首次渲染前读取已保存的列设置，避免默认隐藏列闪现
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => loadSavedHidden(HIDDEN_COLUMNS_KEY, DEFAULT_HIDDEN_COLUMNS))
  const [errHiddenColumns, setErrHiddenColumns] = useState<Set<string>>(() =>
    loadSavedHidden(ERR_HIDDEN_COLUMNS_KEY, ERR_DEFAULT_HIDDEN_COLUMNS)
  )
  const [showColumnDropdown, setShowColumnDropdown] = useState(false)

  // ---- 同步写入 state 与 ref（保持 Vue 版同步读写语义） ----
  const setFilters = (next: UsageQueryParams) => {
    filtersRef.current = next
    setFiltersState(next)
  }
  const setDates = (start: string, end: string) => {
    datesRef.current = { start, end }
    setStartDateState(start)
    setEndDateState(end)
  }
  const setGranularity = (value: Granularity) => {
    granularityRef.current = value
    setGranularityState(value)
  }
  const setPagination = (patch: Partial<typeof pagination>) => {
    paginationRef.current = { ...paginationRef.current, ...patch }
    setPaginationState(paginationRef.current)
  }
  const setActiveTab = (tab: DetailTab) => {
    activeTabRef.current = tab
    setActiveTabState(tab)
  }
  const setErrorRows = (rows: UserErrorRequest[]) => {
    errorRowsRef.current = rows
    setErrorRowsState(rows)
  }
  const setErrorPage = (page: number) => {
    errorQueryRef.current.page = page
    setErrorPageState(page)
  }
  const setErrorPageSize = (size: number) => {
    errorQueryRef.current.pageSize = size
    setErrorPageSizeState(size)
  }
  const setErrorFilter = (next: ErrorFilter) => {
    errorFilterRef.current = next
    setErrorFilterState(next)
  }

  const errorKeyOptions: SelectOption[] = [
    { value: null, label: t('usage.errors.allKeys') },
    ...apiKeys.map((k) => ({ value: k.id, label: k.name }))
  ]

  // 模型候选取自当前已加载错误中出现过的模型；creatable 允许输入任意片段做后端模糊。
  const errorModelOptions: SelectOption[] = (() => {
    const seen = new Set<string>()
    const opts: SelectOption[] = []
    for (const r of errorRows) {
      if (r.model && !seen.has(r.model)) {
        seen.add(r.model)
        opts.push({ value: r.model, label: r.model })
      }
    }
    return opts
  })()

  const errorCategoryOptions: SelectOption[] = [
    { value: '', label: t('usage.errors.allCategories') },
    ...errorCategoryCodes.map((c) => ({ value: c, label: t('usage.errors.categories.' + c) }))
  ]

  // 状态码候选用固定常用列表(与管理端 UsageFilters 共用常量),不受当前页数据限制:
  // 后端 status_code 过滤对全量生效,若只列当前页出现过的码,用户就选不到仅在后续页的码。
  const errorStatusOptions: SelectOption[] = [
    { value: null, label: t('usage.errors.allStatuses') },
    ...COMMON_ERROR_STATUS_CODES.map((c) => ({ value: c, label: String(c) }))
  ]

  const granularityOptions: SelectOption[] = [
    { value: 'day', label: t('admin.dashboard.day') },
    { value: 'hour', label: t('admin.dashboard.hour') }
  ]
  const requestTypeOptions: SelectOption[] = [
    { value: null, label: t('admin.usage.allTypes') },
    { value: 'ws_v2', label: t('usage.ws') },
    { value: 'live', label: t('usage.live') },
    { value: 'stream', label: t('usage.stream') },
    { value: 'sync', label: t('usage.sync') }
  ]
  const compactionOptions: SelectOption[] = [
    { value: null, label: t('usage.allCompactionTypes') },
    { value: true, label: t('usage.compactionOnly') }
  ]
  // 订阅功能关闭后只剩余额计费，「计费类型」筛选（余额/订阅）失去意义，整块隐藏。
  const subscriptionFeatureEnabled = resolveFeatureFlag(cachedPublicSettings, FeatureFlags.subscription)
  const billingTypeOptions: SelectOption[] = [
    { value: null, label: t('admin.usage.allBillingTypes') },
    { value: 0, label: t('admin.usage.billingTypeBalance') },
    { value: 1, label: t('admin.usage.billingTypeSubscription') }
  ]
  const billingModeOptions: SelectOption[] = [
    { value: null, label: t('admin.usage.allBillingModes') },
    { value: 'token', label: t('admin.usage.billingModeToken') },
    { value: 'per_request', label: t('admin.usage.billingModePerRequest') },
    { value: 'image', label: t('admin.usage.billingModeImage') },
    { value: 'video', label: t('admin.usage.billingModeVideo') }
  ]

  const apiKeyOptions: SelectOption[] = [
    { value: null, label: t('usage.allApiKeys') },
    ...apiKeys.map((key) => ({ value: key.id, label: key.name }))
  ]
  const groupOptions: SelectOption[] = [
    { value: null, label: t('admin.usage.allGroups') },
    ...groups.map((group) => ({ value: group.id, label: group.name }))
  ]
  const modelOptions: SelectOption[] = [
    { value: null, label: t('admin.usage.allModels') },
    ...modelOptionValues.map((model) => ({ value: model, label: model }))
  ]

  const normalizedFilters = (): UsageQueryParams => {
    const current = filtersRef.current
    const requestType = current.request_type
    const legacyStream = requestType ? requestTypeToLegacyStream(requestType) : current.stream
    return {
      ...current,
      start_date: datesRef.current.start,
      end_date: datesRef.current.end,
      stream: legacyStream === null ? undefined : legacyStream
    }
  }

  const buildUsageListParams = (page: number, pageSize: number): UsageQueryParams => ({
    page,
    page_size: pageSize,
    ...normalizedFilters(),
    sort_by: sortState.current.sort_by,
    sort_order: sortState.current.sort_order
  })

  const loadLogs = async () => {
    abortController.current?.abort()
    const controller = new AbortController()
    abortController.current = controller
    setLoading(true)
    try {
      const res = await usageAPI.query(buildUsageListParams(paginationRef.current.page, paginationRef.current.page_size), {
        signal: controller.signal
      })
      if (!controller.signal.aborted) {
        setUsageLogs(res.items)
        setPagination({ total: res.total })
      }
    } catch (error) {
      if (!isAbortError(error)) {
        useAppStore.getState().showError(t('usage.failedToLoad'))
      }
    } finally {
      if (abortController.current === controller) setLoading(false)
    }
  }

  const loadStats = async () => {
    const seq = ++statsReqSeq.current
    setEndpointStatsLoading(true)
    try {
      const stats = await usageAPI.getStats(normalizedFilters())
      if (seq !== statsReqSeq.current) return
      setUsageStats(stats)
      setInboundEndpointStats(stats.endpoints || [])
      setUpstreamEndpointStats([])
      setEndpointPathStats([])
    } catch (error) {
      if (seq !== statsReqSeq.current) return
      console.error('Failed to load usage stats:', error)
      setInboundEndpointStats([])
      setUpstreamEndpointStats([])
      setEndpointPathStats([])
    } finally {
      if (seq === statsReqSeq.current) setEndpointStatsLoading(false)
    }
  }

  const refreshModelOptions = (models: ModelStat[]) => {
    const current = filtersRef.current.model
    const set = new Set(modelOptionValuesRef.current)
    models.forEach((item) => {
      if (item.model) set.add(item.model)
    })
    if (current) set.add(current)
    const next = Array.from(set).sort()
    modelOptionValuesRef.current = next
    setModelOptionValues(next)
  }

  const loadModelStats = async () => {
    const seq = ++modelStatsReqSeq.current
    setModelStatsLoading(true)
    try {
      const response = await usageAPI.getDashboardModels({
        ...normalizedFilters(),
        model_source: 'requested'
      })
      if (seq !== modelStatsReqSeq.current) return
      setRequestedModelStats(response.models || [])
      refreshModelOptions(response.models || [])
    } catch (error) {
      if (seq !== modelStatsReqSeq.current) return
      console.error('Failed to load model stats:', error)
      setRequestedModelStats([])
    } finally {
      if (seq === modelStatsReqSeq.current) setModelStatsLoading(false)
    }
  }

  const loadChartData = async () => {
    const seq = ++chartReqSeq.current
    setChartsLoading(true)
    try {
      const snapshot = await usageAPI.getDashboardSnapshotV2({
        ...normalizedFilters(),
        granularity: granularityRef.current,
        include_trend: true,
        include_model_stats: false,
        include_group_stats: true
      })
      if (seq !== chartReqSeq.current) return
      setTrendData(snapshot.trend || [])
      setGroupStats(snapshot.groups || [])
    } catch (error) {
      if (seq !== chartReqSeq.current) return
      console.error('Failed to load chart data:', error)
      setTrendData([])
      setGroupStats([])
    } finally {
      if (seq === chartReqSeq.current) setChartsLoading(false)
    }
  }

  const loadErrors = async () => {
    setErrorLoading(true)
    try {
      const q = errorQueryRef.current
      const f = errorFilterRef.current
      const resp = await usageAPI.listMyErrorRequests({
        page: q.page,
        page_size: q.pageSize,
        start_date: datesRef.current.start,
        end_date: datesRef.current.end,
        model: (f.model ?? '').trim() || undefined,
        category: f.category || undefined,
        api_key_id: f.api_key_id ?? undefined,
        status_code: f.status_code ?? undefined,
        sort_by: q.sortBy,
        sort_order: q.sortOrder
      })
      setErrorRows(resp.items)
      setErrorTotal(resp.total)
    } catch (error) {
      console.error('[UsageView] loadErrors failed:', error)
      useAppStore.getState().showError(t('usage.errors.failedToLoad'))
    } finally {
      setErrorLoading(false)
    }
  }

  const resetErrorRows = () => {
    setErrorPage(1)
    if (activeTabRef.current === 'errors') {
      void loadErrors()
    } else {
      setErrorRows([])
      setErrorTotal(0)
    }
  }

  const applyErrorFilters = () => {
    setErrorPage(1)
    void loadErrors()
  }

  const applyFilters = () => {
    setPagination({ page: 1 })
    void loadLogs()
    void loadStats()
    void loadModelStats()
    void loadChartData()
    resetErrorRows()
  }

  const refreshData = () => {
    void loadLogs()
    void loadStats()
    void loadModelStats()
    void loadChartData()
    if (activeTabRef.current === 'errors') void loadErrors()
  }

  const resetFilters = () => {
    const range = getLast24HoursRangeDates()
    setDates(range.start, range.end)
    setFilters(createDefaultFilters(range.start, range.end))
    setGranularity(getGranularityForRange(range.start, range.end))
    applyFilters()
    if (activeTabRef.current === 'errors') {
      setErrorFilter(createDefaultErrorFilter())
      applyErrorFilters()
    }
  }

  const onDateRangeChange = (range: DateRangeValue) => {
    setDates(range.startDate, range.endDate)
    setFilters({ ...filtersRef.current, start_date: range.startDate, end_date: range.endDate })
    setGranularity(getGranularityForRange(range.startDate, range.endDate))
    applyFilters()
  }

  /** 修改一个筛选项并立即应用（Vue 版 v-model + @change） */
  const updateFilter = (patch: Partial<UsageQueryParams>) => {
    setFilters({ ...filtersRef.current, ...patch })
    applyFilters()
  }

  const updateErrorFilter = (patch: Partial<ErrorFilter>) => {
    setErrorFilter({ ...errorFilterRef.current, ...patch })
    applyErrorFilters()
  }

  const handlePageChange = (page: number) => {
    setPagination({ page })
    void loadLogs()
  }

  const handlePageSizeChange = (pageSize: number) => {
    setPagination({ page_size: pageSize, page: 1 })
    void loadLogs()
  }

  const handleSort = (key: string, order: 'asc' | 'desc') => {
    sortState.current = { sort_by: key, sort_order: order }
    setPagination({ page: 1 })
    void loadLogs()
  }

  const handleIpGeoBatchFailed = () => {
    useAppStore.getState().showError(t('usage.ipGeo.batchFailed'))
  }

  const exportToCSV = async () => {
    const appStore = useAppStore.getState()
    if (paginationRef.current.total === 0) {
      appStore.showWarning(t('usage.noDataToExport'))
      return
    }
    setExporting(true)
    appStore.showInfo(t('usage.preparingExport'))
    try {
      const allLogs: UsageLog[] = []
      const pageSize = 100
      const exportParams = buildUsageListParams(1, pageSize)
      const totalPages = Math.ceil(paginationRef.current.total / pageSize)
      for (let page = 1; page <= totalPages; page++) {
        const response = await usageAPI.query({ ...exportParams, page })
        allLogs.push(...response.items)
      }
      if (allLogs.length === 0) {
        appStore.showWarning(t('usage.noDataToExport'))
        return
      }
      const headers = [
        'Time',
        'API Key Name',
        'Model',
        'Reasoning Effort',
        'Inbound Endpoint',
        'IP Address',
        'Type',
        'Billing Mode',
        'Input Tokens',
        'Output Tokens',
        'Cache Read Tokens',
        'Cache Creation Tokens',
        'Rate Multiplier',
        'Billed Cost',
        'Original Cost',
        'First Token (ms)',
        'Duration (ms)'
      ]
      const rows = allLogs.map((log) =>
        [
          log.created_at,
          log.api_key?.name || '',
          log.model,
          formatReasoningEffort(log.reasoning_effort),
          log.inbound_endpoint || '',
          log.ip_address || '',
          getRequestTypeExportText(log),
          getBillingModeLabel(resolveDisplayBillingMode(log), t),
          log.input_tokens,
          log.output_tokens,
          log.cache_read_tokens,
          log.cache_creation_tokens,
          log.rate_multiplier,
          log.actual_cost.toFixed(8),
          log.total_cost.toFixed(8),
          log.first_token_ms ?? '',
          log.duration_ms ?? ''
        ].map(escapeCSVValue)
      )
      const csvContent = [headers.map(escapeCSVValue).join(','), ...rows.map((row) => row.join(','))].join('\n')
      const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `usage_${exportParams.start_date}_to_${exportParams.end_date}.csv`
      link.click()
      window.URL.revokeObjectURL(url)
      appStore.showSuccess(t('usage.exportSuccess'))
    } catch (error) {
      console.error('CSV Export failed:', error)
      appStore.showError(t('usage.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  const allColumns: Column[] = [
    { key: 'api_key', label: t('usage.apiKeyFilter'), sortable: false },
    { key: 'model', label: t('usage.model'), sortable: true },
    { key: 'reasoning_effort', label: t('usage.reasoningEffort'), sortable: false },
    { key: 'endpoint', label: t('usage.endpoint'), sortable: false },
    { key: 'ip_address', label: 'IP', sortable: false },
    { key: 'group', label: t('admin.usage.group'), sortable: false },
    { key: 'stream', label: t('usage.type'), sortable: false },
    { key: 'billing_mode', label: t('admin.usage.billingMode'), sortable: false },
    { key: 'tokens', label: t('usage.tokens'), sortable: false },
    { key: 'cost', label: t('usage.cost'), sortable: false },
    { key: 'latency', label: t('usage.latency'), sortable: false },
    { key: 'created_at', label: t('usage.time'), sortable: true },
    { key: 'user_agent', label: t('usage.userAgent'), sortable: false }
  ]
  const toggleableColumns = allColumns.filter((col) => !ALWAYS_VISIBLE.includes(col.key))
  const visibleColumns = allColumns.filter((col) => ALWAYS_VISIBLE.includes(col.key) || !hiddenColumns.has(col.key))

  // key 须与 UserErrorRequestsTable 的 allColumns 一致
  const errAllColumns: Column[] = [
    { key: 'key_name', label: t('usage.errors.keyName') },
    { key: 'model', label: t('usage.errors.model') },
    { key: 'endpoint', label: t('usage.errors.endpoint') },
    { key: 'client_ip', label: 'IP' },
    { key: 'group', label: t('admin.usage.group') },
    { key: 'type', label: t('usage.type') },
    { key: 'platform', label: t('usage.errors.platform') },
    { key: 'category', label: t('usage.errors.category') },
    { key: 'status', label: t('usage.errors.status') },
    { key: 'message', label: t('usage.errors.message') },
    { key: 'created_at', label: t('usage.errors.time') },
    { key: 'user_agent', label: t('usage.userAgent') }
  ]
  const errToggleableColumns = errAllColumns.filter((col) => !ERR_ALWAYS_VISIBLE.includes(col.key))
  const errVisibleColumnKeys = errAllColumns
    .filter((col) => ERR_ALWAYS_VISIBLE.includes(col.key) || !errHiddenColumns.has(col.key))
    .map((col) => col.key)

  const toggleHidden = (current: Set<string>, key: string, storageKey: string): Set<string> => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    localStorage.setItem(storageKey, JSON.stringify([...next]))
    return next
  }

  // 列设置下拉按当前 tab 分发
  const currentToggleableColumns = activeTab === 'errors' ? errToggleableColumns : toggleableColumns
  const isCurrentColumnVisible = (key: string) => (activeTab === 'errors' ? !errHiddenColumns.has(key) : !hiddenColumns.has(key))
  const toggleCurrentColumn = (key: string) => {
    if (activeTab === 'errors') setErrHiddenColumns(toggleHidden(errHiddenColumns, key, ERR_HIDDEN_COLUMNS_KEY))
    else setHiddenColumns(toggleHidden(hiddenColumns, key, HIDDEN_COLUMNS_KEY))
  }

  const loadApiKeys = async () => {
    const firstPage = await keysAPI.list(1, 100)
    const keys = [...firstPage.items]
    for (let page = 2; page <= firstPage.pages && keys.length > 0; page++) {
      const response = await keysAPI.list(page, 100)
      if (response.items.length === 0) break
      keys.push(...response.items)
    }
    return keys
  }

  const loadFilterOptions = async () => {
    try {
      const [keys, availableGroups] = await Promise.all([loadApiKeys(), userGroupsAPI.getAvailable()])
      setApiKeys(keys)
      setGroups(availableGroups)
    } catch (error) {
      console.error('Failed to load usage filter options:', error)
    }
  }

  const onErrorSort = (sortBy: string, sortOrder: 'asc' | 'desc') => {
    errorQueryRef.current.sortBy = sortBy
    errorQueryRef.current.sortOrder = sortOrder
    setErrorPage(1)
    void loadErrors()
  }

  const onErrorPage = (page: number) => {
    setErrorPage(page)
    void loadErrors()
  }

  const onErrorPageSize = (pageSize: number) => {
    setErrorPageSize(pageSize)
    setErrorPage(1)
    void loadErrors()
  }

  const switchTab = (tab: DetailTab) => {
    setActiveTab(tab)
    if (tab === 'errors' && errorRowsRef.current.length === 0) void loadErrors()
  }

  // 挂载：加载筛选候选与全部数据；卸载时取消进行中的列表请求
  const mountRef = useRef({ loadFilterOptions, refreshData })
  useLayoutEffect(() => {
    mountRef.current = { loadFilterOptions, refreshData }
  })
  useEffect(() => {
    void mountRef.current.loadFilterOptions()
    mountRef.current.refreshData()
    return () => {
      abortController.current?.abort()
    }
  }, [])

  // 筛选项：上方标签 + 下拉，下拉的无障碍名称取自标签
  const field = (label: string, control: ReactElement<{ 'aria-label'?: string }>, wide = false) => (
    <div className={wide ? `${styles.field} ${styles.fieldWide}` : styles.field}>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      {cloneElement(control, { 'aria-label': label })}
    </div>
  )

  const errorFields = (
    <>
      {field(
        t('usage.errors.keyName'),
        <Select
          value={errorFilter.api_key_id}
          options={errorKeyOptions}
          onChange={(value) => updateErrorFilter({ api_key_id: value as number | null })}
        />,
        true
      )}
      {field(
        t('usage.errors.model'),
        <Select
          value={errorFilter.model}
          options={errorModelOptions}
          searchable
          creatable
          clearable
          placeholder={t('usage.errors.modelPlaceholder')}
          onChange={(value) => updateErrorFilter({ model: value as string | null })}
        />,
        true
      )}
      {field(
        t('usage.errors.category'),
        <Select
          value={errorFilter.category}
          options={errorCategoryOptions}
          onChange={(value) => updateErrorFilter({ category: (value as string | null) ?? '' })}
        />
      )}
      {field(
        t('usage.errors.status'),
        <Select
          value={errorFilter.status_code}
          options={errorStatusOptions}
          onChange={(value) => updateErrorFilter({ status_code: value as number | null })}
        />
      )}
    </>
  )

  const usageFields = (
    <>
      {field(
        t('usage.apiKeyFilter'),
        <Select
          value={filters.api_key_id ?? null}
          options={apiKeyOptions}
          onChange={(value) => updateFilter({ api_key_id: (value as number | null) ?? undefined })}
        />,
        true
      )}
      {field(
        t('usage.model'),
        <Select
          value={filters.model ?? null}
          options={modelOptions}
          searchable
          onChange={(value) => updateFilter({ model: (value as string | null) ?? undefined })}
        />,
        true
      )}
      {field(
        t('admin.usage.group'),
        <Select
          value={filters.group_id ?? null}
          options={groupOptions}
          searchable
          onChange={(value) => updateFilter({ group_id: (value as number | null) ?? undefined })}
        />
      )}
      {field(
        t('usage.type'),
        <Select
          value={filters.request_type ?? null}
          options={requestTypeOptions}
          onChange={(value) => updateFilter({ request_type: (value as UsageRequestType | null) ?? undefined })}
        />
      )}
      {field(
        t('usage.compactionFilter'),
        <Select
          value={filters.native_compaction_v2 ?? null}
          options={compactionOptions}
          onChange={(value) => updateFilter({ native_compaction_v2: value as boolean | null })}
        />
      )}
      {subscriptionFeatureEnabled &&
        field(
          t('admin.usage.billingType'),
          <Select
            value={filters.billing_type ?? null}
            options={billingTypeOptions}
            onChange={(value) => updateFilter({ billing_type: value as number | null })}
          />
        )}
      {field(
        t('admin.usage.billingMode'),
        <Select
          value={filters.billing_mode ?? null}
          options={billingModeOptions}
          onChange={(value) => updateFilter({ billing_mode: value as string | null })}
        />
      )}
    </>
  )

  const columnSettings = (
    <Popover open={showColumnDropdown} onOpenChange={setShowColumnDropdown}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          data-testid="usage-column-settings"
          title={t('admin.users.columnSettings')}
          aria-label={t('admin.users.columnSettings')}
        >
          <Columns3 size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.desktopOnly}>{t('admin.users.columnSettings')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={styles.menuPanel}>
        <div className={styles.menuList} role="menu">
          {currentToggleableColumns.map((col) => (
            <button
              key={col.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={isCurrentColumnVisible(col.key)}
              data-testid={`usage-column-toggle-${col.key}`}
              className={styles.menuItem}
              onClick={() => toggleCurrentColumn(col.key)}
            >
              <span>{col.label}</span>
              {isCurrentColumnVisible(col.key) ? <Check size={16} strokeWidth={2} className={styles.check} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )

  const filterBar = (
    <div className={styles.filters}>
      <div className={styles.fields}>{activeTab === 'errors' ? errorFields : usageFields}</div>
      <div className={styles.actions}>
        <Button
          type="button"
          variant="secondary"
          onClick={refreshData}
          disabled={activeTab === 'errors' ? errorLoading : loading}
        >
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('common.refresh')}
        </Button>
        <Button type="button" variant="secondary" onClick={resetFilters}>
          <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('common.reset')}
        </Button>
        {columnSettings}
        {activeTab !== 'errors' && (
          <Button type="button" variant="primary" onClick={() => void exportToCSV()} disabled={exporting}>
            {exporting ? t('usage.exporting') : t('usage.exportCsv')}
          </Button>
        )}
      </div>
    </div>
  )

  const usagePanel = (
    <>
      <UsageTable
        flat
        data={usageLogs as AdminUsageLog[]}
        loading={loading}
        columns={visibleColumns}
        serverSideSort
        showAccountBilling={false}
        showUpstreamEndpoint={false}
        defaultSortKey="created_at"
        defaultSortOrder="desc"
        onSort={handleSort}
        onIpGeoBatchFailed={handleIpGeoBatchFailed}
      />
      {pagination.total > 0 ? (
        <Pagination
          page={pagination.page}
          total={pagination.total}
          pageSize={pagination.page_size}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      ) : null}
    </>
  )

  return (
    <div className={styles.page}>
      <UsageStatsCards stats={usageStats} showAccountCost={false} strikeStandardCost />

      <section className={styles.charts} aria-busy={chartsLoading || modelStatsLoading || endpointStatsLoading || undefined}>
        <div className={styles.chartToolbar}>
          <div className={styles.toolbarGroup}>
            <span className={styles.toolbarLabel}>{t('admin.dashboard.timeRange')}:</span>
            <DateRangePicker startDate={startDate} endDate={endDate} onChange={onDateRangeChange} />
          </div>
          <div className={`${styles.toolbarGroup} ${styles.toolbarEnd}`}>
            <span className={styles.toolbarLabel}>{t('admin.dashboard.granularity')}:</span>
            <Select
              className={styles.granularity}
              value={granularity}
              options={granularityOptions}
              aria-label={t('admin.dashboard.granularity')}
              onChange={(value) => {
                setGranularity(value as Granularity)
                void loadChartData()
              }}
            />
          </div>
        </div>

        <div className={styles.chartGrid}>
          <ModelDistributionChart
            metric={modelDistributionMetric}
            onMetricChange={setModelDistributionMetric}
            modelStats={requestedModelStats}
            loading={modelStatsLoading}
            showSourceToggle={false}
            showMetricToggle
            enableBreakdown={false}
            showAccountCost={false}
            startDate={startDate}
            endDate={endDate}
          />
          <GroupDistributionChart
            metric={groupDistributionMetric}
            onMetricChange={setGroupDistributionMetric}
            groupStats={groupStats}
            loading={chartsLoading}
            showMetricToggle
            enableBreakdown={false}
            showAccountCost={false}
            startDate={startDate}
            endDate={endDate}
          />
          <EndpointDistributionChart
            source={endpointDistributionSource}
            onSourceChange={setEndpointDistributionSource}
            metric={endpointDistributionMetric}
            onMetricChange={setEndpointDistributionMetric}
            endpointStats={inboundEndpointStats}
            upstreamEndpointStats={upstreamEndpointStats}
            endpointPathStats={endpointPathStats}
            loading={endpointStatsLoading}
            showSourceToggle={false}
            showMetricToggle
            enableBreakdown={false}
            title={t('usage.endpointDistribution')}
            startDate={startDate}
            endDate={endDate}
          />
          <TokenUsageTrend trendData={trendData} loading={chartsLoading} />
        </div>
      </section>

      {/* 明细区：tab 栏 + 筛选 + 内容收进同一个分组区域 */}
      <section className={styles.details}>
        {errorViewEnabled ? (
          <Tabs value={activeTab} onValueChange={(value) => switchTab(value as DetailTab)}>
            <div className={styles.tabBar}>
              <TabsList aria-label={t('usage.tabs.usage')}>
                <TabsTrigger value="usage" data-testid="usage-detail-tab">
                  <span className={styles.tabLabel}>
                    <FileText size={16} strokeWidth={1.75} aria-hidden="true" />
                    {t('usage.tabs.usage')}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="errors" data-testid="usage-detail-tab">
                  <span className={styles.tabLabel}>
                    <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" />
                    {t('usage.tabs.errors')}
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>
            {filterBar}
            <TabsContent value="usage" className={styles.panel}>
              {usagePanel}
            </TabsContent>
            <TabsContent value="errors" className={styles.panel}>
              <UserErrorRequestsTable
                flat
                rows={errorRows}
                total={errorTotal}
                loading={errorLoading}
                page={errorPage}
                pageSize={errorPageSize}
                visibleColumnKeys={errVisibleColumnKeys}
                onSort={onErrorSort}
                onPageChange={onErrorPage}
                onPageSizeChange={onErrorPageSize}
                onIpGeoBatchFailed={handleIpGeoBatchFailed}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <>
            {filterBar}
            <div className={styles.panel}>{usagePanel}</div>
          </>
        )}
      </section>
    </div>
  )
}
