import { saveAs } from 'file-saver'
import { AlertTriangle, BarChart3, Check, Columns3, FileText } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { adminAPI } from '@/api/admin'
import type { UserBreakdownParams } from '@/api/admin/dashboard'
import { listErrorLogs } from '@/api/admin/ops'
import type { OpsErrorLog } from '@/api/admin/ops'
import { adminUsageAPI } from '@/api/admin/usage'
import type { AdminUsageQueryParams, AdminUsageStatsResponse } from '@/api/admin/usage'
import UsageCleanupDialog from '@/components/admin/usage/UsageCleanupDialog'
import UsageExportProgress from '@/components/admin/usage/UsageExportProgress'
import UsageFilters, { type UsageFiltersHandle, type UsageFiltersValue } from '@/components/admin/usage/UsageFilters'
import UsageStatsCards from '@/components/admin/usage/UsageStatsCards'
import UsageTable from '@/components/admin/usage/UsageTable'
import UserTokenRanking, { type UserTokenRankingHandle } from '@/components/admin/usage/UserTokenRanking'
import UserBalanceHistoryModal from '@/components/admin/user/UserBalanceHistoryModal'
import { Button } from '@/components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import EndpointDistributionChart from '@/components/charts/EndpointDistributionChart'
import GroupDistributionChart from '@/components/charts/GroupDistributionChart'
import ModelDistributionChart from '@/components/charts/ModelDistributionChart'
import TokenUsageTrend from '@/components/charts/TokenUsageTrend'
import DateRangePicker, { type DateRangeValue } from '@/components/common/DateRangePicker'
import Pagination from '@/components/common/Pagination'
import Select from '@/components/common/Select'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AdminUsageLog, AdminUser, EndpointStat, GroupStat, ModelStat, TrendDataPoint } from '@/types'
import { formatReasoningEffort } from '@/utils/format'
import { requestTypeToLegacyStream, resolveUsageRequestType } from '@/utils/usageRequestType'
import OpsErrorDetailModal from './ops/components/OpsErrorDetailModal'
import OpsErrorLogTable from './ops/components/OpsErrorLogTable'
import styles from './UsageView.module.css'

type DistributionMetric = 'tokens' | 'actual_cost'
type EndpointSource = 'inbound' | 'upstream' | 'path'
type ModelDistributionSource = 'requested' | 'upstream' | 'mapping'
type DetailTab = 'usage' | 'errors' | 'ranking'
type Granularity = 'day' | 'hour'

// Use local timezone to avoid UTC timezone issues
const formatLD = (d: Date) => {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const getLast24HoursRangeDates = (): { start: string; end: string } => {
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  return {
    start: formatLD(start),
    end: formatLD(end)
  }
}
const getGranularityForRange = (start: string, end: string): Granularity => {
  const startTime = new Date(`${start}T00:00:00`).getTime()
  const endTime = new Date(`${end}T00:00:00`).getTime()
  const daysDiff = Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24))
  return daysDiff <= 1 ? 'hour' : 'day'
}

const getSingleQueryValue = (values: string[]): string | undefined => values.find((item) => item.length > 0)

const getNumericQueryValue = (values: string[]): number | undefined => {
  const raw = getSingleQueryValue(values)
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

// 注意：'YYYY-MM-DDT00:00:00' 无时区后缀，按本地时区解析后再转 UTC——与页面其它日期处理语义一致，刻意如此，勿改成 'T00:00:00Z'
const toRFC3339 = (d: string | undefined, endOfDay = false): string | undefined =>
  d ? new Date(d + (endOfDay ? 'T23:59:59.999' : 'T00:00:00')).toISOString() : undefined

// Column visibility
const ALWAYS_VISIBLE = ['user', 'created_at']
const DEFAULT_HIDDEN_COLUMNS = ['reasoning_effort', 'request_id', 'upstream_request_id', 'user_agent']
const HIDDEN_COLUMNS_KEY = 'usage-hidden-columns'
const HIDDEN_COLUMNS_VERSION_KEY = 'usage-hidden-columns-version'
// 隐藏列版本链：每级只把当级新增列加入隐藏集，不重置用户已显式打开的列。
const HIDDEN_COLUMNS_PREV_VERSION = 'request-id-hidden-by-default'
const HIDDEN_COLUMNS_CURRENT_VERSION = 'upstream-request-id-hidden-by-default'

// ---- 错误请求 tab 列设置(与用量明细同机制,独立存储) ----
const ERR_ALWAYS_VISIBLE = ['user', 'status', 'created_at', 'actions']
const ERR_DEFAULT_HIDDEN_COLUMNS = ['user_agent']
const ERR_HIDDEN_COLUMNS_KEY = 'usage-error-hidden-columns'

const loadSavedColumns = (): Set<string> => {
  const hidden = new Set<string>()
  try {
    const saved = localStorage.getItem(HIDDEN_COLUMNS_KEY)
    if (saved) {
      ;(JSON.parse(saved) as string[]).forEach((key) => {
        hidden.add(key)
      })
      const savedVersion = localStorage.getItem(HIDDEN_COLUMNS_VERSION_KEY)
      if (savedVersion !== HIDDEN_COLUMNS_CURRENT_VERSION) {
        if (savedVersion !== HIDDEN_COLUMNS_PREV_VERSION) {
          hidden.add('request_id')
        }
        hidden.add('upstream_request_id')
        localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...hidden]))
        localStorage.setItem(HIDDEN_COLUMNS_VERSION_KEY, HIDDEN_COLUMNS_CURRENT_VERSION)
      }
    } else {
      DEFAULT_HIDDEN_COLUMNS.forEach((key) => {
        hidden.add(key)
      })
      localStorage.setItem(HIDDEN_COLUMNS_VERSION_KEY, HIDDEN_COLUMNS_CURRENT_VERSION)
    }
  } catch {
    DEFAULT_HIDDEN_COLUMNS.forEach((key) => {
      hidden.add(key)
    })
  }
  return hidden
}

const loadSavedErrColumns = (): Set<string> => {
  const hidden = new Set<string>()
  try {
    const saved = localStorage.getItem(ERR_HIDDEN_COLUMNS_KEY)
    const keys = saved ? (JSON.parse(saved) as string[]) : ERR_DEFAULT_HIDDEN_COLUMNS
    keys.forEach((key) => hidden.add(key))
  } catch {
    ERR_DEFAULT_HIDDEN_COLUMNS.forEach((key) => hidden.add(key))
  }
  return hidden
}

interface ExportProgressState {
  show: boolean
  progress: number
  current: number
  total: number
  estimatedTime: string
}

interface InitialState {
  startDate: string
  endDate: string
  filters: AdminUsageQueryParams
  granularity: Granularity
}

export default function UsageView() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()

  // 首次渲染即应用路由 query 中的起止日期与 user_id（Vue 版 onMounted 中的 applyRouteQueryFilters）
  const [initial] = useState<InitialState>(() => {
    const range = getLast24HoursRangeDates()
    const queryStartDate = getSingleQueryValue(searchParams.getAll('start_date'))
    const queryEndDate = getSingleQueryValue(searchParams.getAll('end_date'))
    const queryUserId = getNumericQueryValue(searchParams.getAll('user_id'))
    const start = queryStartDate || range.start
    const end = queryEndDate || range.end
    return {
      startDate: start,
      endDate: end,
      filters: {
        user_id: queryUserId,
        model: undefined,
        group_id: undefined,
        request_type: undefined,
        native_compaction_v2: null,
        billing_type: null,
        start_date: start,
        end_date: end
      } as AdminUsageQueryParams,
      granularity: getGranularityForRange(start, end)
    }
  })

  const [usageStats, setUsageStats] = useState<AdminUsageStatsResponse | null>(null)
  const [usageLogs, setUsageLogs] = useState<AdminUsageLog[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportingRef = useRef(false)
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([])
  const [requestedModelStats, setRequestedModelStats] = useState<ModelStat[]>([])
  const [upstreamModelStats, setUpstreamModelStats] = useState<ModelStat[]>([])
  const [mappingModelStats, setMappingModelStats] = useState<ModelStat[]>([])
  const [groupStats, setGroupStats] = useState<GroupStat[]>([])
  const [chartsLoading, setChartsLoading] = useState(false)
  const [modelStatsLoading, setModelStatsLoading] = useState(false)
  const [granularity, setGranularityState] = useState<Granularity>(initial.granularity)
  const granularityRef = useRef<Granularity>(initial.granularity)
  const [modelDistributionMetric, setModelDistributionMetric] = useState<DistributionMetric>('tokens')
  const [modelDistributionSource, setModelDistributionSourceState] = useState<ModelDistributionSource>('requested')
  const modelSourceRef = useRef<ModelDistributionSource>('requested')
  const loadedModelSources = useRef<Record<ModelDistributionSource, boolean>>({
    requested: false,
    upstream: false,
    mapping: false
  })
  const [groupDistributionMetric, setGroupDistributionMetric] = useState<DistributionMetric>('tokens')
  const [endpointDistributionMetric, setEndpointDistributionMetric] = useState<DistributionMetric>('tokens')
  const [endpointDistributionSource, setEndpointDistributionSource] = useState<EndpointSource>('inbound')
  const [inboundEndpointStats, setInboundEndpointStats] = useState<EndpointStat[]>([])
  const [upstreamEndpointStats, setUpstreamEndpointStats] = useState<EndpointStat[]>([])
  const [endpointPathStats, setEndpointPathStats] = useState<EndpointStat[]>([])
  const [, setEndpointStatsLoading] = useState(false)
  const abortController = useRef<AbortController | null>(null)
  const exportAbortController = useRef<AbortController | null>(null)
  const chartReqSeq = useRef(0)
  const statsReqSeq = useRef(0)
  const modelStatsReqSeq = useRef(0)
  const [exportProgress, setExportProgress] = useState<ExportProgressState>({
    show: false,
    progress: 0,
    current: 0,
    total: 0,
    estimatedTime: ''
  })
  const [cleanupDialogVisible, setCleanupDialogVisible] = useState(false)
  // Balance history modal state
  const [showBalanceHistoryModal, setShowBalanceHistoryModal] = useState(false)
  const [balanceHistoryUser, setBalanceHistoryUser] = useState<AdminUser | null>(null)

  const [startDate, setStartDateState] = useState(initial.startDate)
  const [endDate, setEndDateState] = useState(initial.endDate)
  const datesRef = useRef({ start: initial.startDate, end: initial.endDate })
  const [filters, setFiltersState] = useState<AdminUsageQueryParams>(initial.filters)
  const filtersRef = useRef<AdminUsageQueryParams>(initial.filters)
  const [pagination, setPaginationState] = useState(() => ({ page: 1, page_size: getPersistedPageSize(), total: 0 }))
  const paginationRef = useRef(pagination)
  const sortState = useRef({ sort_by: 'created_at', sort_order: 'desc' as 'asc' | 'desc' })

  // 首次渲染前读取已保存的列设置，避免默认隐藏列闪现
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(loadSavedColumns)
  const [errHiddenColumns, setErrHiddenColumns] = useState<Set<string>>(loadSavedErrColumns)
  const [showColumnDropdown, setShowColumnDropdown] = useState(false)

  const [activeTab, setActiveTabState] = useState<DetailTab>('usage')
  const activeTabRef = useRef<DetailTab>('usage')
  const [rankingMounted, setRankingMounted] = useState(false)
  const rankingMountedRef = useRef(false)
  const usageFiltersRef = useRef<UsageFiltersHandle>(null)
  const rankingRef = useRef<UserTokenRankingHandle>(null)

  // Error tab state
  const [errRows, setErrRowsState] = useState<OpsErrorLog[]>([])
  const errRowsRef = useRef<OpsErrorLog[]>([])
  const [errLoading, setErrLoading] = useState(false)
  const [errPage, setErrPageState] = useState(1)
  const [errPageSize, setErrPageSizeState] = useState(20)
  const errQueryRef = useRef({ page: 1, pageSize: 20, sortBy: 'created_at', sortOrder: 'desc' as 'asc' | 'desc' })
  const [errTotal, setErrTotal] = useState(0)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [selectedErrorId, setSelectedErrorId] = useState<number | null>(null)

  // ---- 同步写入 state 与 ref（保持 Vue 版同步读写语义） ----
  const setFilters = (next: AdminUsageQueryParams) => {
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
  const setErrRows = (rows: OpsErrorLog[]) => {
    errRowsRef.current = rows
    setErrRowsState(rows)
  }
  const setErrPage = (page: number) => {
    errQueryRef.current.page = page
    setErrPageState(page)
  }
  const setErrPageSize = (size: number) => {
    errQueryRef.current.pageSize = size
    setErrPageSizeState(size)
  }

  const breakdownFilters = useMemo(() => {
    const f: Partial<UserBreakdownParams> & Record<string, unknown> = {}
    if (filters.user_id) f.user_id = filters.user_id
    if (filters.api_key_id) f.api_key_id = filters.api_key_id
    if (filters.account_id) f.account_id = filters.account_id
    if (filters.group_id) f.group_id = filters.group_id
    if (filters.request_type != null) f.request_type = filters.request_type
    if (filters.native_compaction_v2 != null) f.native_compaction_v2 = filters.native_compaction_v2
    if (filters.billing_type != null) f.billing_type = filters.billing_type
    return f
  }, [filters])

  const modelNameOptions = useMemo(
    () => Array.from(new Set(requestedModelStats.map((m) => m.model).filter(Boolean))).sort(),
    [requestedModelStats]
  )

  const handleUserClick = async (userId: number) => {
    try {
      const user = await adminAPI.users.getById(userId, true)
      setBalanceHistoryUser(user)
      setShowBalanceHistoryModal(true)
    } catch {
      useAppStore.getState().showError(t('admin.usage.failedToLoadUser'))
    }
  }

  const granularityOptions = [
    { value: 'day', label: t('admin.dashboard.day') },
    { value: 'hour', label: t('admin.dashboard.hour') }
  ]

  const loadRouteUserFilterLabel = async () => {
    const requestedUserId = filtersRef.current.user_id
    if (!requestedUserId) return
    const userSearchRevision = usageFiltersRef.current?.getUserSearchRevision?.()

    const routeUserFilterIsCurrent = () =>
      filtersRef.current.user_id === requestedUserId &&
      usageFiltersRef.current?.getUserSearchRevision?.() === userSearchRevision

    try {
      const user = await adminAPI.users.getById(requestedUserId, true)
      if (!routeUserFilterIsCurrent()) return
      usageFiltersRef.current?.setUserKeyword?.(user.email || String(requestedUserId))
    } catch {
      if (!routeUserFilterIsCurrent()) return
      usageFiltersRef.current?.setUserKeyword?.(String(requestedUserId))
    }
  }

  const buildUsageListParams = (page: number, pageSize: number, exactTotal: boolean): AdminUsageQueryParams => {
    const current = filtersRef.current
    const requestType = current.request_type
    const legacyStream = requestType ? requestTypeToLegacyStream(requestType) : current.stream
    return {
      page,
      page_size: pageSize,
      exact_total: exactTotal,
      ...current,
      stream: legacyStream === null ? undefined : legacyStream,
      sort_by: sortState.current.sort_by,
      sort_order: sortState.current.sort_order
    }
  }

  const loadLogs = async () => {
    abortController.current?.abort()
    const c = new AbortController()
    abortController.current = c
    setLoading(true)
    try {
      const res = await adminAPI.usage.list(
        buildUsageListParams(paginationRef.current.page, paginationRef.current.page_size, false),
        { signal: c.signal }
      )
      if (!c.signal.aborted) {
        setUsageLogs(res.items)
        setPagination({ total: res.total })
      }
    } catch (error: unknown) {
      if ((error as { name?: string } | null)?.name !== 'AbortError') console.error('Failed to load usage logs:', error)
    } finally {
      if (abortController.current === c) setLoading(false)
    }
  }

  const loadStats = async (force = false) => {
    const seq = ++statsReqSeq.current
    setEndpointStatsLoading(true)
    try {
      const current = filtersRef.current
      const requestType = current.request_type
      const legacyStream = requestType ? requestTypeToLegacyStream(requestType) : current.stream
      const s = await adminAPI.usage.getStats({
        ...current,
        stream: legacyStream === null ? undefined : legacyStream,
        ...(force ? { nocache: 1 } : {})
      } as Parameters<typeof adminAPI.usage.getStats>[0])
      if (seq !== statsReqSeq.current) return
      setUsageStats(s)
      setInboundEndpointStats(s.endpoints || [])
      setUpstreamEndpointStats(s.upstream_endpoints || [])
      setEndpointPathStats(s.endpoint_paths || [])
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

  // 失效模型统计缓存:仅标记需要重取,保留旧数据直到新数据到达(避免刷新时图表闪空)。
  const invalidateModelStatsCache = () => {
    loadedModelSources.current.requested = false
    loadedModelSources.current.upstream = false
    loadedModelSources.current.mapping = false
  }

  const setModelStatsFor = (source: ModelDistributionSource, models: ModelStat[]) => {
    if (source === 'requested') {
      setRequestedModelStats(models)
    } else if (source === 'upstream') {
      setUpstreamModelStats(models)
    } else {
      setMappingModelStats(models)
    }
  }

  const loadModelStats = async (source: ModelDistributionSource, force = false) => {
    if (!force && loadedModelSources.current[source]) {
      return
    }

    const seq = ++modelStatsReqSeq.current
    setModelStatsLoading(true)
    try {
      const current = filtersRef.current
      const requestType = current.request_type
      const legacyStream = requestType ? requestTypeToLegacyStream(requestType) : current.stream
      const baseParams = {
        start_date: current.start_date || datesRef.current.start,
        end_date: current.end_date || datesRef.current.end,
        user_id: current.user_id,
        model: current.model,
        api_key_id: current.api_key_id,
        account_id: current.account_id,
        group_id: current.group_id,
        request_type: requestType,
        stream: legacyStream === null ? undefined : legacyStream,
        native_compaction_v2: current.native_compaction_v2,
        billing_type: current.billing_type,
        upstream_model_mismatch: current.upstream_model_mismatch
      }

      const response = await adminAPI.dashboard.getModelStats({
        ...baseParams,
        model_source: source
      } as Parameters<typeof adminAPI.dashboard.getModelStats>[0])

      if (seq !== modelStatsReqSeq.current) return

      setModelStatsFor(source, response.models || [])
      loadedModelSources.current[source] = true
    } catch (error) {
      if (seq !== modelStatsReqSeq.current) return
      console.error('Failed to load model stats:', error)
      setModelStatsFor(source, [])
      loadedModelSources.current[source] = false
    } finally {
      if (seq === modelStatsReqSeq.current) setModelStatsLoading(false)
    }
  }

  const loadChartData = async () => {
    const seq = ++chartReqSeq.current
    setChartsLoading(true)
    try {
      const current = filtersRef.current
      const requestType = current.request_type
      const legacyStream = requestType ? requestTypeToLegacyStream(requestType) : current.stream
      const snapshot = await adminAPI.dashboard.getSnapshotV2({
        start_date: current.start_date || datesRef.current.start,
        end_date: current.end_date || datesRef.current.end,
        granularity: granularityRef.current,
        user_id: current.user_id,
        model: current.model,
        api_key_id: current.api_key_id,
        account_id: current.account_id,
        group_id: current.group_id,
        request_type: requestType,
        stream: legacyStream === null ? undefined : legacyStream,
        native_compaction_v2: current.native_compaction_v2,
        billing_type: current.billing_type,
        upstream_model_mismatch: current.upstream_model_mismatch,
        include_stats: false,
        include_trend: true,
        include_model_stats: false,
        include_group_stats: true,
        include_users_trend: false
      } as Parameters<typeof adminAPI.dashboard.getSnapshotV2>[0])
      if (seq !== chartReqSeq.current) return
      setTrendData(snapshot.trend || [])
      setGroupStats(snapshot.groups || [])
    } catch (error) {
      console.error('Failed to load chart data:', error)
    } finally {
      if (seq === chartReqSeq.current) setChartsLoading(false)
    }
  }

  const loadAdminErrors = async () => {
    setErrLoading(true)
    try {
      const current = filtersRef.current
      const query = errQueryRef.current
      const resp = await listErrorLogs({
        page: query.page,
        page_size: query.pageSize,
        view: 'all',
        start_time: toRFC3339(current.start_date),
        end_time: toRFC3339(current.end_date, true),
        user_id: current.user_id ?? undefined,
        api_key_id: current.api_key_id ?? undefined,
        account_id: current.account_id ?? undefined,
        group_id: current.group_id ?? undefined,
        model: current.model || undefined,
        phase: current.error_phase || undefined,
        category: current.error_category || undefined,
        status_codes: current.status_code != null ? String(current.status_code) : undefined,
        sort_by: query.sortBy,
        sort_order: query.sortOrder
      } as Parameters<typeof listErrorLogs>[0])
      setErrRows(resp.items)
      setErrTotal(resp.total)
    } catch (error) {
      console.error('Failed to load admin errors:', error)
      useAppStore.getState().showError(t('usage.errors.failedToLoad'))
    } finally {
      setErrLoading(false)
    }
  }

  const applyFilters = () => {
    setPagination({ page: 1 })
    invalidateModelStatsCache()
    void loadLogs()
    void loadStats()
    void loadModelStats(modelSourceRef.current, true)
    void loadChartData()
    setErrPage(1)
    if (activeTabRef.current === 'errors') {
      void loadAdminErrors()
    } else {
      setErrRows([])
    }
  }

  const refreshData = () => {
    invalidateModelStatsCache()
    void loadLogs()
    void loadStats(true)
    void loadModelStats(modelSourceRef.current, true)
    void loadChartData()
    if (activeTabRef.current === 'errors') void loadAdminErrors()
    if (rankingMountedRef.current) void rankingRef.current?.reload()
  }

  const resetFilters = () => {
    const range = getLast24HoursRangeDates()
    setDates(range.start, range.end)
    setFilters({
      start_date: range.start,
      end_date: range.end,
      request_type: undefined,
      native_compaction_v2: null,
      billing_type: null,
      billing_mode: undefined
    } as AdminUsageQueryParams)
    setGranularity(getGranularityForRange(range.start, range.end))
    applyFilters()
  }

  const onDateRangeChange = (range: DateRangeValue) => {
    setDates(range.startDate, range.endDate)
    setFilters({
      ...filtersRef.current,
      start_date: range.startDate,
      end_date: range.endDate
    })
    setGranularity(getGranularityForRange(range.startDate, range.endDate))
    applyFilters()
  }

  // Drill down from the per-user token ranking: scope the whole usage view to
  // that user and jump to the usage-detail tab so the drill-down is visible.
  const handleRankingSelectUser = (userId: number, email: string) => {
    setFilters({ ...filtersRef.current, user_id: userId })
    usageFiltersRef.current?.setUserKeyword?.(email || '')
    setActiveTab('usage')
    applyFilters()
  }

  const handlePageChange = (p: number) => {
    setPagination({ page: p })
    void loadLogs()
  }
  const handlePageSizeChange = (s: number) => {
    setPagination({ page_size: s, page: 1 })
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
  const cancelExport = () => exportAbortController.current?.abort()
  const openCleanupDialog = () => setCleanupDialogVisible(true)
  const getRequestTypeLabel = (log: AdminUsageLog): string => {
    const requestType = resolveUsageRequestType(log)
    if (requestType === 'cyber') return t('usage.cyber')
    if (requestType === 'live') return t('usage.live')
    if (requestType === 'ws_v2') return t('usage.ws')
    if (requestType === 'stream') return t('usage.stream')
    if (requestType === 'sync') return t('usage.sync')
    return t('usage.unknown')
  }

  const exportToExcel = async () => {
    if (exportingRef.current) return
    exportingRef.current = true
    setExporting(true)
    setExportProgress((prev) => ({ ...prev, show: true }))
    const c = new AbortController()
    exportAbortController.current = c
    try {
      let p = 1
      let total = paginationRef.current.total
      let exportedCount = 0
      const XLSX = await import('xlsx')
      const headers = [
        t('usage.time'), t('admin.usage.user'), t('usage.apiKeyFilter'),
        t('admin.usage.account'), t('usage.requestedModel'), t('usage.sentUpstreamModel'), t('usage.upstreamResponseModel'), t('usage.upstreamModelMismatch'), t('usage.requestedReasoningEffort'), t('usage.reasoningEffort'), t('admin.usage.group'),
        t('usage.inboundEndpoint'), t('usage.upstreamEndpoint'),
        t('usage.type'),
        t('admin.usage.inputTokens'), t('admin.usage.outputTokens'),
        t('admin.usage.cacheReadTokens'), t('admin.usage.cacheCreationTokens'),
        t('admin.usage.inputCost'), t('admin.usage.outputCost'),
        t('admin.usage.cacheReadCost'), t('admin.usage.cacheCreationCost'),
        t('usage.rate'), t('usage.accountMultiplier'), t('usage.original'), t('usage.userBilled'), t('usage.accountBilled'),
        t('usage.firstToken'), t('usage.duration'),
        t('admin.usage.requestId'), t('admin.usage.upstreamRequestId'), t('usage.userAgent'), t('admin.usage.ipAddress')
      ]
      const ws = XLSX.utils.aoa_to_sheet([headers])
      while (true) {
        const res = await adminUsageAPI.list(buildUsageListParams(p, 100, true), { signal: c.signal })
        if (c.signal.aborted) break
        if (p === 1) {
          total = res.total
          const firstTotal = total
          setExportProgress((prev) => ({ ...prev, total: firstTotal }))
        }
        const rows = (res.items || []).map((log: AdminUsageLog) => [
          log.created_at, log.user?.email || '', log.api_key?.name || '', log.account?.name || '', log.model,
          log.upstream_model || log.model, log.upstream_response_model || '', log.upstream_model_mismatch == null ? '' : t(log.upstream_model_mismatch ? 'common.yes' : 'common.no'), formatReasoningEffort(log.reasoning_effort), formatReasoningEffort(log.upstream_reasoning_effort || log.reasoning_effort), log.group?.name || '',
          log.inbound_endpoint || '', log.upstream_endpoint || '', getRequestTypeLabel(log),
          log.input_tokens, log.output_tokens, log.cache_read_tokens, log.cache_creation_tokens,
          log.input_cost?.toFixed(6) || '0.000000', log.output_cost?.toFixed(6) || '0.000000',
          log.cache_read_cost?.toFixed(6) || '0.000000', log.cache_creation_cost?.toFixed(6) || '0.000000',
          log.rate_multiplier?.toPrecision(4) || '1.00', (log.account_rate_multiplier ?? 1).toPrecision(4),
          log.total_cost?.toFixed(6) || '0.000000', log.actual_cost?.toFixed(6) || '0.000000',
          ((log.account_stats_cost ?? log.total_cost) * (log.account_rate_multiplier ?? 1)).toFixed(6), log.first_token_ms ?? '', log.duration_ms,
          log.request_id || '', log.upstream_request_id || '', log.user_agent || '', log.ip_address || ''
        ])
        if (rows.length) {
          XLSX.utils.sheet_add_aoa(ws, rows, { origin: -1 })
        }
        exportedCount += rows.length
        const progress = total > 0 ? Math.min(100, Math.round((exportedCount / total) * 100)) : 0
        const current = exportedCount
        setExportProgress((prev) => ({ ...prev, current, progress }))
        if (exportedCount >= total || res.items.length < 100) break
        p++
      }
      if (!c.signal.aborted) {
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Usage')
        saveAs(
          new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          }),
          `usage_${filtersRef.current.start_date}_to_${filtersRef.current.end_date}.xlsx`
        )
        useAppStore.getState().showSuccess(t('usage.exportSuccess'))
      }
    } catch (error) {
      console.error('Failed to export:', error)
      useAppStore.getState().showError('Export Failed')
    } finally {
      if (exportAbortController.current === c) {
        exportAbortController.current = null
        exportingRef.current = false
        setExporting(false)
        setExportProgress((prev) => ({ ...prev, show: false }))
      }
    }
  }

  const allColumns = [
    { key: 'user', label: t('admin.usage.user'), sortable: false },
    { key: 'api_key', label: t('usage.apiKeyFilter'), sortable: false },
    { key: 'account', label: t('admin.usage.account'), sortable: false },
    { key: 'model', label: t('usage.model'), sortable: true },
    { key: 'reasoning_effort', label: t('usage.reasoningEffort'), sortable: false },
    { key: 'endpoint', label: t('usage.endpoint'), sortable: false },
    { key: 'group', label: t('admin.usage.group'), sortable: false },
    { key: 'stream', label: t('usage.type'), sortable: false },
    { key: 'billing_mode', label: t('admin.usage.billingMode'), sortable: false },
    { key: 'tokens', label: t('usage.tokens'), sortable: false },
    { key: 'cost', label: t('usage.cost'), sortable: false },
    { key: 'latency', label: t('usage.latency'), sortable: false },
    { key: 'created_at', label: t('usage.time'), sortable: true },
    { key: 'request_id', label: t('admin.usage.requestId'), sortable: false },
    { key: 'upstream_request_id', label: t('admin.usage.upstreamRequestId'), sortable: false },
    { key: 'user_agent', label: t('usage.userAgent'), sortable: false },
    { key: 'ip_address', label: t('admin.usage.ipAddress'), sortable: false }
  ]

  const toggleableColumns = allColumns.filter((col) => !ALWAYS_VISIBLE.includes(col.key))
  const visibleColumns = allColumns.filter((col) => ALWAYS_VISIBLE.includes(col.key) || !hiddenColumns.has(col.key))

  const toggleColumn = (key: string) => {
    const next = new Set(hiddenColumns)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setHiddenColumns(next)
    try {
      localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...next]))
      localStorage.setItem(HIDDEN_COLUMNS_VERSION_KEY, HIDDEN_COLUMNS_CURRENT_VERSION)
    } catch (e) {
      console.error('Failed to save columns:', e)
    }
  }

  // key 集合须与 OpsErrorLogTable 内部 allColumns 一致
  const errAllColumns = [
    { key: 'user', label: t('admin.ops.errorLog.user') },
    { key: 'api_key', label: t('admin.ops.errorLog.apiKey') },
    { key: 'account', label: t('admin.ops.errorLog.account') },
    { key: 'platform', label: t('admin.ops.errorLog.platform') },
    { key: 'model', label: t('admin.ops.errorLog.model') },
    { key: 'endpoint', label: t('admin.ops.errorLog.endpoint') },
    { key: 'group', label: t('admin.ops.errorLog.group') },
    { key: 'type', label: t('admin.ops.errorLog.type') },
    { key: 'category', label: t('usage.errors.category') },
    { key: 'status', label: t('admin.ops.errorLog.status') },
    { key: 'message', label: t('admin.ops.errorLog.message') },
    { key: 'created_at', label: t('admin.ops.errorLog.time') },
    { key: 'user_agent', label: t('usage.userAgent') },
    { key: 'client_ip', label: t('admin.ops.errorLog.ip') },
    { key: 'actions', label: t('admin.ops.errorLog.action') }
  ]

  const errToggleableColumns = errAllColumns.filter((col) => !ERR_ALWAYS_VISIBLE.includes(col.key))
  const errVisibleColumnKeys = errAllColumns
    .filter((col) => ERR_ALWAYS_VISIBLE.includes(col.key) || !errHiddenColumns.has(col.key))
    .map((col) => col.key)

  const toggleErrColumn = (key: string) => {
    const next = new Set(errHiddenColumns)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setErrHiddenColumns(next)
    try {
      localStorage.setItem(ERR_HIDDEN_COLUMNS_KEY, JSON.stringify([...next]))
    } catch (e) {
      console.error('Failed to save error columns:', e)
    }
  }

  // 列设置下拉按当前 tab 分发
  const currentToggleableColumns = activeTab === 'errors' ? errToggleableColumns : toggleableColumns
  const isCurrentColumnVisible = (key: string) => (activeTab === 'errors' ? !errHiddenColumns.has(key) : !hiddenColumns.has(key))
  const toggleCurrentColumn = (key: string) => (activeTab === 'errors' ? toggleErrColumn(key) : toggleColumn(key))

  const detailTabs = [
    { key: 'usage' as const, label: t('usage.tabs.usage'), icon: FileText },
    { key: 'errors' as const, label: t('usage.tabs.errors'), icon: AlertTriangle },
    { key: 'ranking' as const, label: t('usage.tabs.ranking'), icon: BarChart3 }
  ]

  const switchTab = (tab: DetailTab) => {
    setActiveTab(tab)
    if (tab === 'errors' && errRowsRef.current.length === 0) void loadAdminErrors()
    if (tab === 'ranking') {
      rankingMountedRef.current = true
      setRankingMounted(true)
    }
  }

  const onErrSort = (sortBy: string, sortOrder: 'asc' | 'desc') => {
    errQueryRef.current.sortBy = sortBy
    errQueryRef.current.sortOrder = sortOrder
    setErrPage(1)
    void loadAdminErrors()
  }
  const onErrPage = (p: number) => {
    setErrPage(p)
    void loadAdminErrors()
  }
  const onErrPageSize = (s: number) => {
    setErrPageSize(s)
    setErrPage(1)
    void loadAdminErrors()
  }
  const openError = (id: number) => {
    setSelectedErrorId(id)
    setShowErrorModal(true)
  }

  const setModelDistributionSource = (source: ModelDistributionSource) => {
    modelSourceRef.current = source
    setModelDistributionSourceState(source)
    // Vue 版 watch(modelDistributionSource)：切换来源时按需加载（已缓存则跳过）
    if (source !== modelDistributionSource) void loadModelStats(source)
  }

  // 挂载：应用路由筛选后加载数据，图表数据稍后加载
  const mountRef = useRef({ loadLogs, loadStats, loadModelStats, loadChartData, loadRouteUserFilterLabel })
  useLayoutEffect(() => {
    mountRef.current = { loadLogs, loadStats, loadModelStats, loadChartData, loadRouteUserFilterLabel }
  })
  useEffect(() => {
    const fns = mountRef.current
    void fns.loadRouteUserFilterLabel()
    void fns.loadLogs()
    void fns.loadStats()
    void fns.loadModelStats(modelSourceRef.current, true)
    const timer = window.setTimeout(() => {
      void mountRef.current.loadChartData()
    }, 120)
    return () => {
      window.clearTimeout(timer)
      abortController.current?.abort()
      exportAbortController.current?.abort()
    }
  }, [])

  const columnSettings =
    activeTab !== 'ranking' ? (
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
    ) : null

  return (
    <>
      <div className={styles.page}>
        <UsageStatsCards stats={usageStats} />

        {/* Charts Section */}
        <section className={styles.charts}>
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
              source={modelDistributionSource}
              onSourceChange={setModelDistributionSource}
              metric={modelDistributionMetric}
              onMetricChange={setModelDistributionMetric}
              modelStats={requestedModelStats}
              upstreamModelStats={upstreamModelStats}
              mappingModelStats={mappingModelStats}
              loading={modelStatsLoading}
              showSourceToggle
              showMetricToggle
              startDate={startDate}
              endDate={endDate}
              filters={breakdownFilters}
            />
            <GroupDistributionChart
              metric={groupDistributionMetric}
              onMetricChange={setGroupDistributionMetric}
              groupStats={groupStats}
              loading={chartsLoading}
              showMetricToggle
              startDate={startDate}
              endDate={endDate}
              filters={breakdownFilters}
            />
            <EndpointDistributionChart
              source={endpointDistributionSource}
              onSourceChange={setEndpointDistributionSource}
              metric={endpointDistributionMetric}
              onMetricChange={setEndpointDistributionMetric}
              endpointStats={inboundEndpointStats}
              upstreamEndpointStats={upstreamEndpointStats}
              endpointPathStats={endpointPathStats}
              loading={chartsLoading}
              showSourceToggle
              showMetricToggle
              title={t('usage.endpointDistribution')}
              startDate={startDate}
              endDate={endDate}
              filters={breakdownFilters}
            />
            <TokenUsageTrend trendData={trendData} loading={chartsLoading} />
          </div>
        </section>

        {/* 明细区：tab 栏 + 筛选 + 内容收进同一个分组区域，消除割裂感 */}
        <section className={styles.details}>
          <Tabs value={activeTab} onValueChange={(value) => switchTab(value as DetailTab)}>
            <div className={styles.tabBar}>
              <TabsList aria-label={t('usage.tabs.usage')}>
                {detailTabs.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <TabsTrigger key={tab.key} value={tab.key} data-testid="usage-detail-tab">
                      <span className={styles.tabLabel}>
                        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                        {tab.label}
                      </span>
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </div>

            <UsageFilters
              ref={usageFiltersRef}
              value={filters as UsageFiltersValue}
              onValueChange={(next) => setFilters(next as AdminUsageQueryParams)}
              onChange={(next) => {
                setFilters(next as AdminUsageQueryParams)
                applyFilters()
              }}
              flat
              mode={activeTab}
              className={styles.filters}
              startDate={startDate}
              endDate={endDate}
              exporting={exporting}
              modelOptions={modelNameOptions}
              onRefresh={refreshData}
              onReset={resetFilters}
              onCleanup={openCleanupDialog}
              onExport={() => void exportToExcel()}
              afterReset={columnSettings}
            />

            <TabsContent value="usage" forceMount className={styles.panel}>
              <UsageTable
                flat
                data={usageLogs}
                loading={loading}
                columns={visibleColumns}
                serverSideSort
                defaultSortKey="created_at"
                defaultSortOrder="desc"
                onSort={handleSort}
                onUserClick={(userId) => void handleUserClick(userId)}
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
            </TabsContent>
            <TabsContent value="errors" forceMount className={styles.panel}>
              <OpsErrorLogTable
                flat
                rows={errRows}
                total={errTotal}
                loading={errLoading}
                page={errPage}
                pageSize={errPageSize}
                visibleColumnKeys={errVisibleColumnKeys}
                userClickable
                onUserClick={(userId) => void handleUserClick(userId)}
                onOpenErrorDetail={openError}
                onSort={onErrSort}
                onPageChange={onErrPage}
                onPageSizeChange={onErrPageSize}
                onIpGeoBatchFailed={handleIpGeoBatchFailed}
              />
            </TabsContent>
            {/* 懒挂载：首次切到该 tab 才请求排行数据，之后随筛选自动刷新 */}
            {rankingMounted ? (
              <TabsContent value="ranking" forceMount className={styles.panel}>
                <UserTokenRanking
                  ref={rankingRef}
                  startDate={startDate}
                  endDate={endDate}
                  filters={breakdownFilters}
                  model={filters.model ?? undefined}
                  onSelectUser={handleRankingSelectUser}
                />
              </TabsContent>
            ) : null}
          </Tabs>
        </section>

        <OpsErrorDetailModal show={showErrorModal} errorId={selectedErrorId} errorType="request" onShowChange={setShowErrorModal} />
      </div>

      <UsageExportProgress
        show={exportProgress.show}
        progress={exportProgress.progress}
        current={exportProgress.current}
        total={exportProgress.total}
        estimatedTime={exportProgress.estimatedTime}
        onCancel={cancelExport}
      />
      <UsageCleanupDialog
        show={cleanupDialogVisible}
        filters={filters}
        startDate={startDate}
        endDate={endDate}
        onClose={() => setCleanupDialogVisible(false)}
      />
      {/* Balance history modal triggered from usage table user click */}
      <UserBalanceHistoryModal
        show={showBalanceHistoryModal}
        user={balanceHistoryUser}
        hideActions
        onClose={() => {
          setShowBalanceHistoryModal(false)
          setBalanceHistoryUser(null)
        }}
      />
    </>
  )
}
