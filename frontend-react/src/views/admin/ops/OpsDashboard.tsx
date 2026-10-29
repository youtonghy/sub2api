/**
 * 运维监控页，对应 Vue 版 views/admin/ops/OpsDashboard.vue。
 *
 * 与 Vue 版的差异：Vue 在全屏模式下不渲染 AppLayout；React 版页面始终位于应用外壳路由中，
 * 因此全屏模式改为覆盖整个视口的固定浮层（挂到 body，z-index 高于外壳），Escape 或右上角按钮退出。
 * 全屏状态仍由 URL 查询参数 `fullscreen=1` 驱动。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { Minimize2 } from 'lucide-react'

import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import BaseDialog from '@/components/common/BaseDialog'
import {
  opsAPI,
  type OpsDashboardOverview,
  type OpsErrorDistributionResponse,
  type OpsErrorTrendResponse,
  type OpsLatencyHistogramResponse,
  type OpsThroughputTrendResponse,
  type OpsMetricThresholds
} from '@/api/admin/ops'
import { useI18n } from '@/i18n/useI18n'
import { useAdminSettingsStore, useAppStore } from '@/stores'
import OpsDashboardHeader from './components/OpsDashboardHeader'
import OpsDashboardSkeleton from './components/OpsDashboardSkeleton'
import OpsProviderRealtimeMonitor from './components/OpsProviderRealtimeMonitor'
import OpsAccountTTFTCard from './components/OpsAccountTTFTCard'
import OpsConcurrencyCard from './components/OpsConcurrencyCard'
import OpsErrorDetailModal from './components/OpsErrorDetailModal'
import OpsErrorDistributionChart from './components/OpsErrorDistributionChart'
import OpsErrorDetailsModal from './components/OpsErrorDetailsModal'
import OpsErrorTrendChart from './components/OpsErrorTrendChart'
import OpsLatencyChart from './components/OpsLatencyChart'
import OpsThroughputTrendChart from './components/OpsThroughputTrendChart'
import OpsSwitchRateTrendChart from './components/OpsSwitchRateTrendChart'
import OpsAlertEventsCard from './components/OpsAlertEventsCard'
import OpsOpenAITokenStatsCard from './components/OpsOpenAITokenStatsCard'
import OpsSystemLogTable from './components/OpsSystemLogTable'
import OpsRequestDetailsModal from './components/OpsRequestDetailsModal'
import OpsSettingsDialog from './components/OpsSettingsDialog'
import OpsAlertRulesCard from './components/OpsAlertRulesCard'
import type { OpsRequestDetailsPreset } from './types'
import styles from './OpsDashboard.module.css'

type TimeRange = '5m' | '30m' | '1h' | '6h' | '24h' | 'custom'
const allowedTimeRanges = new Set<TimeRange>(['5m', '30m', '1h', '6h', '24h', 'custom'])

type QueryMode = 'auto' | 'raw' | 'preagg'
const allowedQueryModes = new Set<QueryMode>(['auto', 'raw', 'preagg'])

const switchTrendWindowHours = 5
const switchTrendTimeRange = `${switchTrendWindowHours}h`
const switchTrendWindowMs = switchTrendWindowHours * 60 * 60 * 1000

const QUERY_KEYS = {
  timeRange: 'tr',
  platform: 'platform',
  groupId: 'group_id',
  queryMode: 'mode',
  fullscreen: 'fullscreen',

  // Deep links
  openErrorDetails: 'open_error_details',
  errorType: 'error_type',
  alertRuleId: 'alert_rule_id',
  openAlertRules: 'open_alert_rules'
} as const

// 记录单条错误详情来自哪个列表，便于"返回列表"时重新打开对应弹窗并保留状态。
type DetailReturnTarget = 'errorList' | 'requestList' | null

interface FilterState {
  timeRange: TimeRange
  platform: string
  groupId: number | null
  queryMode: QueryMode
}

interface RouteQueryResult extends FilterState {
  openAlertRules: boolean
  openErrorDetails: 'request' | 'upstream' | null
}

function isCanceledRequest(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as Record<string, unknown>).code === 'ERR_CANCELED'
  )
}

function isOpsDisabledError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string' &&
    (err as Record<string, unknown>).code === 'OPS_DISABLED'
  )
}

const readQueryString = (query: URLSearchParams, key: string): string => query.get(key) ?? ''

const readQueryNumber = (query: URLSearchParams, key: string): number | null => {
  const raw = readQueryString(query, key)
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

/** 把 URL 查询参数解析为页面状态（对应 Vue 版 applyRouteQueryToState）。tr 缺省时沿用当前值。 */
function readRouteQuery(search: string, currentTimeRange: TimeRange): RouteQueryResult {
  const query = new URLSearchParams(search)

  const nextTimeRange = readQueryString(query, QUERY_KEYS.timeRange)
  const timeRange =
    nextTimeRange && allowedTimeRanges.has(nextTimeRange as TimeRange) ? (nextTimeRange as TimeRange) : currentTimeRange

  const platform = readQueryString(query, QUERY_KEYS.platform) || ''

  const groupIdRaw = readQueryNumber(query, QUERY_KEYS.groupId)
  const groupId = typeof groupIdRaw === 'number' && groupIdRaw > 0 ? groupIdRaw : null

  let queryMode: QueryMode
  const nextMode = readQueryString(query, QUERY_KEYS.queryMode)
  if (nextMode && allowedQueryModes.has(nextMode as QueryMode)) {
    queryMode = nextMode as QueryMode
  } else {
    const fallback = useAdminSettingsStore.getState().opsQueryModeDefault || 'auto'
    queryMode = allowedQueryModes.has(fallback as QueryMode) ? (fallback as QueryMode) : 'auto'
  }

  // Deep links
  let openAlertRules = false
  const openRules = readQueryString(query, QUERY_KEYS.openAlertRules)
  if (openRules === '1' || openRules === 'true') openAlertRules = true

  const ruleID = readQueryNumber(query, QUERY_KEYS.alertRuleId)
  if (typeof ruleID === 'number' && ruleID > 0) openAlertRules = true

  let openErrorDetails: 'request' | 'upstream' | null = null
  const openErr = readQueryString(query, QUERY_KEYS.openErrorDetails)
  if (openErr === '1' || openErr === 'true') {
    const typ = readQueryString(query, QUERY_KEYS.errorType)
    openErrorDetails = typ === 'upstream' ? 'upstream' : 'request'
  }

  return { timeRange, platform, groupId, queryMode, openAlertRules, openErrorDetails }
}

/** 对应 Vue 版 buildQueryFromState：清掉本页所有查询键后按非默认值写回。 */
function buildQueryFromState(search: string, state: FilterState): URLSearchParams {
  const next = new URLSearchParams(search)
  Object.values(QUERY_KEYS).forEach((k) => next.delete(k))

  if (state.timeRange !== '1h') next.set(QUERY_KEYS.timeRange, state.timeRange)
  if (state.platform) next.set(QUERY_KEYS.platform, state.platform)
  if (typeof state.groupId === 'number' && state.groupId > 0) next.set(QUERY_KEYS.groupId, String(state.groupId))
  if (state.queryMode !== 'auto') next.set(QUERY_KEYS.queryMode, state.queryMode)

  return next
}

function sameQuery(a: URLSearchParams, b: URLSearchParams): boolean {
  const aKeys = Array.from(new Set(a.keys()))
  const bKeys = Array.from(new Set(b.keys()))
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((k) => String(b.get(k) ?? '') === String(a.get(k) ?? ''))
}

function toSearch(query: URLSearchParams): string {
  const s = query.toString()
  return s ? `?${s}` : ''
}

export default function OpsDashboard() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const opsEnabled = useAdminSettingsStore((s) => s.opsMonitoringEnabled)

  const [initialRoute] = useState(() => readRouteQuery(location.search, '1h'))

  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(() => new Date())

  const [timeRange, setTimeRange] = useState<TimeRange>(initialRoute.timeRange)
  const [platform, setPlatform] = useState<string>(initialRoute.platform)
  const [groupId, setGroupId] = useState<number | null>(initialRoute.groupId)
  const [queryMode, setQueryMode] = useState<QueryMode>(initialRoute.queryMode)
  const [customStartTime, setCustomStartTime] = useState<string | null>(null)
  const [customEndTime, setCustomEndTime] = useState<string | null>(null)

  const [overview, setOverview] = useState<OpsDashboardOverview | null>(null)
  const [metricThresholds, setMetricThresholds] = useState<OpsMetricThresholds | null>(null)

  const [throughputTrend, setThroughputTrend] = useState<OpsThroughputTrendResponse | null>(null)
  const [loadingTrend, setLoadingTrend] = useState(false)

  const [switchTrend, setSwitchTrend] = useState<OpsThroughputTrendResponse | null>(null)
  const [loadingSwitchTrend, setLoadingSwitchTrend] = useState(false)

  const [latencyHistogram, setLatencyHistogram] = useState<OpsLatencyHistogramResponse | null>(null)
  const [loadingLatency, setLoadingLatency] = useState(false)

  const [errorTrend, setErrorTrend] = useState<OpsErrorTrendResponse | null>(null)
  const [loadingErrorTrend, setLoadingErrorTrend] = useState(false)

  const [errorDistribution, setErrorDistribution] = useState<OpsErrorDistributionResponse | null>(null)
  const [loadingErrorDistribution, setLoadingErrorDistribution] = useState(false)

  const [selectedErrorId, setSelectedErrorId] = useState<number | null>(null)
  const [showErrorModal, setShowErrorModal] = useState(false)

  const [showErrorDetails, setShowErrorDetails] = useState(initialRoute.openErrorDetails !== null)
  const [errorDetailsType, setErrorDetailsType] = useState<'request' | 'upstream'>(initialRoute.openErrorDetails ?? 'request')

  const [showRequestDetails, setShowRequestDetails] = useState(false)
  const [requestDetailsPreset, setRequestDetailsPreset] = useState<OpsRequestDetailsPreset>({
    title: '',
    kind: 'all',
    sort: 'created_at_desc'
  })

  const [detailReturnTarget, setDetailReturnTarget] = useState<DetailReturnTarget>(null)

  // 从详情返回时，列表弹窗应保留上一次的筛选/分页状态而非重置。
  const [resumeListState, setResumeListState] = useState(false)

  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showAlertRulesCard, setShowAlertRulesCard] = useState(initialRoute.openAlertRules)

  // Auto refresh settings
  const [showAlertEvents, setShowAlertEvents] = useState(true)
  const [showOpenAITokenStats, setShowOpenAITokenStats] = useState(false)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false)
  const [autoRefreshIntervalMs, setAutoRefreshIntervalMs] = useState(30000) // default 30 seconds
  const [autoRefreshCountdown, setAutoRefreshCountdown] = useState(0)

  // Used to trigger child component refreshes in a single shared cadence.
  const [dashboardRefreshToken, setDashboardRefreshToken] = useState(0)

  // Fullscreen mode
  const isFullscreen = (() => {
    const val = new URLSearchParams(location.search).get(QUERY_KEYS.fullscreen)
    return val === '1' || val === 'true'
  })()

  // 最新状态快照：供异步请求、定时器与防抖回调读取（相当于 Vue 中直接读 ref.value）。
  const latest = useRef({
    timeRange,
    platform,
    groupId,
    queryMode,
    customStartTime,
    customEndTime,
    opsEnabled,
    loading,
    autoRefreshEnabled,
    autoRefreshIntervalMs,
    autoRefreshCountdown,
    showRequestDetails,
    showErrorDetails,
    search: location.search
  })
  useLayoutEffect(() => {
    latest.current = {
      timeRange,
      platform,
      groupId,
      queryMode,
      customStartTime,
      customEndTime,
      opsEnabled,
      loading,
      autoRefreshEnabled,
      autoRefreshIntervalMs,
      autoRefreshCountdown,
      showRequestDetails,
      showErrorDetails,
      search: location.search
    }
  })

  const dashboardFetchController = useRef<AbortController | null>(null)
  const dashboardFetchSeq = useRef(0)

  const abortDashboardFetch = useCallback(() => {
    if (dashboardFetchController.current) {
      dashboardFetchController.current.abort()
      dashboardFetchController.current = null
    }
  }, [])

  const exitFullscreen = useCallback(() => {
    const nextQuery = new URLSearchParams(latest.current.search)
    nextQuery.delete(QUERY_KEYS.fullscreen)
    navigate({ pathname: location.pathname, search: toSearch(nextQuery), hash: location.hash }, { replace: true })
  }, [navigate, location.pathname, location.hash])

  const enterFullscreen = useCallback(() => {
    const nextQuery = new URLSearchParams(latest.current.search)
    nextQuery.set(QUERY_KEYS.fullscreen, '1')
    navigate({ pathname: location.pathname, search: toSearch(nextQuery), hash: location.hash }, { replace: true })
  }, [navigate, location.pathname, location.hash])

  // Fullscreen mode: listen for ESC key
  useEffect(() => {
    if (!isFullscreen) return
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitFullscreen()
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [isFullscreen, exitFullscreen])

  // ===== URL 查询参数同步 =====
  // 本页自己写入的查询串：路由变化监听遇到它时跳过（对应 Vue 的 isSyncingRouteQuery）。
  const selfSyncedSearch = useRef<string | null>(null)
  const syncTimer = useRef<number | null>(null)

  const syncQueryToRoute = useCallback(() => {
    if (syncTimer.current !== null) window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => {
      syncTimer.current = null
      const snap = latest.current
      const curr = new URLSearchParams(snap.search)
      const nextQuery = buildQueryFromState(snap.search, snap)
      if (sameQuery(nextQuery, curr)) return
      const search = toSearch(nextQuery)
      selfSyncedSearch.current = search
      navigate({ pathname: location.pathname, search, hash: location.hash }, { replace: true })
    }, 250)
  }, [navigate, location.pathname, location.hash])

  useEffect(
    () => () => {
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current)
    },
    []
  )

  // ===== 数据加载 =====
  const buildApiParams = useCallback(() => {
    const snap = latest.current
    const params: any = {
      platform: snap.platform || undefined,
      group_id: snap.groupId ?? undefined,
      mode: snap.queryMode
    }

    if (snap.timeRange === 'custom') {
      if (snap.customStartTime && snap.customEndTime) {
        params.start_time = snap.customStartTime
        params.end_time = snap.customEndTime
      } else {
        // Safety fallback: avoid sending time_range=custom (backend may not support it)
        params.time_range = '1h'
      }
    } else {
      params.time_range = snap.timeRange
    }

    return params
  }, [])

  const buildSwitchTrendParams = useCallback(() => {
    const snap = latest.current
    const params: any = {
      platform: snap.platform || undefined,
      group_id: snap.groupId ?? undefined,
      mode: snap.queryMode
    }
    const endTime = new Date()
    const startTime = new Date(endTime.getTime() - switchTrendWindowMs)
    params.start_time = startTime.toISOString()
    params.end_time = endTime.toISOString()
    return params
  }, [])

  const showError = useCallback((message: string) => {
    useAppStore.getState().showError(message)
  }, [])

  const fetchData = useCallback(async () => {
    const enabled = () => useAdminSettingsStore.getState().opsMonitoringEnabled
    if (!enabled()) return

    abortDashboardFetch()
    dashboardFetchSeq.current += 1
    const fetchSeq = dashboardFetchSeq.current
    const controller = new AbortController()
    dashboardFetchController.current = controller
    const signal = controller.signal
    const isCurrent = () => fetchSeq === dashboardFetchSeq.current

    const refreshOverview = async () => {
      if (!enabled()) return
      try {
        const data = await opsAPI.getDashboardOverview(buildApiParams(), { signal })
        if (!isCurrent()) return
        setOverview(data)
      } catch (err: any) {
        if (!isCurrent() || isCanceledRequest(err)) return
        setOverview(null)
        showError(err?.message || t('admin.ops.failedToLoadOverview'))
      }
    }

    const refreshSwitchTrend = async () => {
      if (!enabled()) return
      setLoadingSwitchTrend(true)
      try {
        const data = await opsAPI.getThroughputTrend(buildSwitchTrendParams(), { signal })
        if (!isCurrent()) return
        setSwitchTrend(data)
      } catch (err: any) {
        if (!isCurrent() || isCanceledRequest(err)) return
        setSwitchTrend(null)
        showError(err?.message || t('admin.ops.failedToLoadSwitchTrend'))
      } finally {
        if (isCurrent()) setLoadingSwitchTrend(false)
      }
    }

    const refreshThroughputTrend = async () => {
      if (!enabled()) return
      setLoadingTrend(true)
      try {
        const data = await opsAPI.getThroughputTrend(buildApiParams(), { signal })
        if (!isCurrent()) return
        setThroughputTrend(data)
      } catch (err: any) {
        if (!isCurrent() || isCanceledRequest(err)) return
        setThroughputTrend(null)
        showError(err?.message || t('admin.ops.failedToLoadThroughputTrend'))
      } finally {
        if (isCurrent()) setLoadingTrend(false)
      }
    }

    const refreshErrorTrend = async () => {
      if (!enabled()) return
      setLoadingErrorTrend(true)
      try {
        const data = await opsAPI.getErrorTrend(buildApiParams(), { signal })
        if (!isCurrent()) return
        setErrorTrend(data)
      } catch (err: any) {
        if (!isCurrent() || isCanceledRequest(err)) return
        setErrorTrend(null)
        showError(err?.message || t('admin.ops.failedToLoadErrorTrend'))
      } finally {
        if (isCurrent()) setLoadingErrorTrend(false)
      }
    }

    const refreshCoreSnapshot = async () => {
      if (!enabled()) return
      setLoadingTrend(true)
      setLoadingErrorTrend(true)
      try {
        const data = await opsAPI.getDashboardSnapshotV2(buildApiParams(), { signal })
        if (!isCurrent()) return
        setOverview(data.overview)
        setThroughputTrend(data.throughput_trend)
        setErrorTrend(data.error_trend)
      } catch (err: any) {
        if (!isCurrent() || isCanceledRequest(err)) return
        // Fallback to legacy split endpoints when snapshot endpoint is unavailable.
        await Promise.all([refreshOverview(), refreshThroughputTrend(), refreshErrorTrend()])
      } finally {
        if (isCurrent()) {
          setLoadingTrend(false)
          setLoadingErrorTrend(false)
        }
      }
    }

    const refreshLatencyHistogram = async () => {
      if (!enabled()) return
      setLoadingLatency(true)
      try {
        const data = await opsAPI.getLatencyHistogram(buildApiParams(), { signal })
        if (!isCurrent()) return
        setLatencyHistogram(data)
      } catch (err: any) {
        if (!isCurrent() || isCanceledRequest(err)) return
        setLatencyHistogram(null)
        showError(err?.message || t('admin.ops.failedToLoadLatencyHistogram'))
      } finally {
        if (isCurrent()) setLoadingLatency(false)
      }
    }

    const refreshErrorDistribution = async () => {
      if (!enabled()) return
      setLoadingErrorDistribution(true)
      try {
        const data = await opsAPI.getErrorDistribution(buildApiParams(), { signal })
        if (!isCurrent()) return
        setErrorDistribution(data)
      } catch (err: any) {
        if (!isCurrent() || isCanceledRequest(err)) return
        setErrorDistribution(null)
        showError(err?.message || t('admin.ops.failedToLoadErrorDistribution'))
      } finally {
        if (isCurrent()) setLoadingErrorDistribution(false)
      }
    }

    const refreshDeferredPanels = async () => {
      if (!enabled()) return
      await Promise.all([refreshLatencyHistogram(), refreshErrorDistribution()])
    }

    setLoading(true)
    setErrorMessage('')
    try {
      await Promise.all([refreshCoreSnapshot(), refreshSwitchTrend()])
      if (!isCurrent()) return

      setLastUpdated(new Date())

      // Trigger child component refreshes using the same cadence as the header.
      setDashboardRefreshToken((v) => v + 1)

      // Reset auto refresh countdown after successful fetch
      if (latest.current.autoRefreshEnabled) {
        setAutoRefreshCountdown(Math.floor(latest.current.autoRefreshIntervalMs / 1000))
      }

      // Defer non-core visual panels to reduce initial blocking.
      void refreshDeferredPanels()
    } catch (err) {
      if (!isOpsDisabledError(err)) {
        console.error('[ops] failed to fetch dashboard data', err)
        setErrorMessage(t('admin.ops.failedToLoadData'))
      }
    } finally {
      if (isCurrent()) {
        setLoading(false)
        setHasLoadedOnce(true)
      }
    }
  }, [abortDashboardFetch, buildApiParams, buildSwitchTrendParams, showError, t])

  // Load ops dashboard presentation settings from backend.
  const loadDashboardAdvancedSettings = useCallback(async () => {
    const prevEnabled = latest.current.autoRefreshEnabled
    let nextEnabled: boolean
    let nextIntervalMs: number
    let nextCountdown: number
    try {
      const settings = await opsAPI.getAdvancedSettings()
      setShowAlertEvents(settings.display_alert_events)
      setShowOpenAITokenStats(settings.display_openai_token_stats)
      nextEnabled = settings.auto_refresh_enabled
      nextIntervalMs = settings.auto_refresh_interval_seconds * 1000
      nextCountdown = settings.auto_refresh_interval_seconds
    } catch (err) {
      console.error('[OpsDashboard] Failed to load dashboard advanced settings', err)
      setShowAlertEvents(true)
      setShowOpenAITokenStats(false)
      nextEnabled = false
      nextIntervalMs = 30000
      nextCountdown = 0
    }
    setAutoRefreshEnabled(nextEnabled)
    setAutoRefreshIntervalMs(nextIntervalMs)
    // 对应 Vue 的 watch(autoRefreshEnabled)：开关变化时重置倒计时（开启为整段间隔，关闭归零）。
    if (prevEnabled !== nextEnabled) {
      nextCountdown = nextEnabled ? Math.floor(nextIntervalMs / 1000) : 0
    }
    setAutoRefreshCountdown(nextCountdown)
    latest.current = { ...latest.current, autoRefreshEnabled: nextEnabled, autoRefreshIntervalMs: nextIntervalMs }
  }, [])

  const loadThresholds = useCallback(async () => {
    try {
      const thresholds = await opsAPI.getMetricThresholds()
      setMetricThresholds(thresholds || null)
    } catch (err) {
      console.warn('[OpsDashboard] Failed to load thresholds', err)
      setMetricThresholds(null)
    }
  }, [])

  // Countdown timer (drives auto refresh; updates every second)
  useEffect(() => {
    if (!autoRefreshEnabled) return
    const id = window.setInterval(() => {
      const snap = latest.current
      if (!snap.autoRefreshEnabled) return
      if (!snap.opsEnabled) return
      if (snap.loading) return

      if (snap.autoRefreshCountdown <= 0) {
        // Fetch immediately when the countdown reaches 0.
        // fetchData() will reset the countdown to the full interval.
        void fetchData()
        return
      }

      setAutoRefreshCountdown((v) => v - 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [autoRefreshEnabled, fetchData])

  // 首次挂载：拉取后台设置，未启用运维监控时跳转到设置页。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const store = useAdminSettingsStore.getState()
      await store.fetch()
      if (cancelled) return
      if (!useAdminSettingsStore.getState().opsMonitoringEnabled) {
        navigate('/admin/settings', { replace: true })
        return
      }

      // Load thresholds configuration
      void loadThresholds()

      // Load auto refresh settings
      await loadDashboardAdvancedSettings()
      if (cancelled) return

      if (useAdminSettingsStore.getState().opsMonitoringEnabled) {
        await fetchData()
      }
    })()
    return () => {
      cancelled = true
      abortDashboardFetch()
    }
    // 只在挂载时执行一次（对应 Vue onMounted）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 筛选条件变化：重新加载并同步到 URL（对应 Vue 的 watch([timeRange, platform, groupId, queryMode])）。
  // React 版在写入筛选状态的地方直接调用，避免在 effect 中级联 setState。
  const applyFilters = useCallback(
    (patch: Partial<FilterState>) => {
      const prev = latest.current
      const next: FilterState = {
        timeRange: patch.timeRange ?? prev.timeRange,
        platform: patch.platform ?? prev.platform,
        groupId: patch.groupId !== undefined ? patch.groupId : prev.groupId,
        queryMode: patch.queryMode ?? prev.queryMode
      }
      const changed =
        prev.timeRange !== next.timeRange ||
        prev.platform !== next.platform ||
        prev.groupId !== next.groupId ||
        prev.queryMode !== next.queryMode
      if (!changed) return

      setTimeRange(next.timeRange)
      setPlatform(next.platform)
      setGroupId(next.groupId)
      setQueryMode(next.queryMode)
      latest.current = { ...latest.current, ...next }

      if (useAdminSettingsStore.getState().opsMonitoringEnabled) {
        void fetchData()
      }
      syncQueryToRoute()
    },
    [fetchData, syncQueryToRoute]
  )

  // URL 变化（浏览器前进后退、深链接、全屏切换）：把查询参数应用回页面状态。
  const prevSearch = useRef(location.search)
  useEffect(() => {
    if (prevSearch.current === location.search) return
    prevSearch.current = location.search
    if (selfSyncedSearch.current === location.search) {
      selfSyncedSearch.current = null
      return
    }
    const next = readRouteQuery(location.search, latest.current.timeRange)
    applyFilters(next)
    if (next.openAlertRules) setShowAlertRulesCard(true)
    if (next.openErrorDetails) {
      setErrorDetailsType(next.openErrorDetails)
      setShowErrorDetails(true)
    }
  }, [location.search, applyFilters])

  // ===== 事件处理 =====
  function handleThroughputSelectPlatform(nextPlatform: string) {
    applyFilters({ platform: nextPlatform || '', groupId: null })
  }

  function handleThroughputSelectGroup(nextGroupId: number) {
    const id = Number.isFinite(nextGroupId) && nextGroupId > 0 ? nextGroupId : null
    applyFilters({ groupId: id })
  }

  function handleOpenRequestDetails(preset?: OpsRequestDetailsPreset) {
    const basePreset: OpsRequestDetailsPreset = {
      title: t('admin.ops.requestDetails.title'),
      kind: 'all',
      sort: 'created_at_desc'
    }

    const next = { ...basePreset, ...(preset ?? {}) }
    if (!next.title) next.title = basePreset.title
    setRequestDetailsPreset(next)
    // Ensure only one modal visible at a time.
    setShowErrorDetails(false)
    setShowErrorModal(false)
    setShowRequestDetails(true)
  }

  function openErrorDetails(kind: 'request' | 'upstream') {
    setErrorDetailsType(kind)
    // Ensure only one modal visible at a time.
    setShowRequestDetails(false)
    setShowErrorModal(false)
    setShowErrorDetails(true)
  }

  function onTimeRangeChange(v: string | number | boolean | null) {
    if (typeof v !== 'string') return
    if (!allowedTimeRanges.has(v as TimeRange)) return
    applyFilters({ timeRange: v as TimeRange })
  }

  function onCustomTimeRangeChange(startTime: string, endTime: string) {
    setCustomStartTime(startTime)
    setCustomEndTime(endTime)
    latest.current = { ...latest.current, customStartTime: startTime, customEndTime: endTime }
  }

  async function onSettingsSaved() {
    await loadDashboardAdvancedSettings()
    void loadThresholds()
    void fetchData()
  }

  function closeSettingsDialog() {
    setShowSettingsDialog(false)
    // Reload auto refresh settings after settings dialog is closed
    void loadDashboardAdvancedSettings()
  }

  function onPlatformChange(v: string | number | boolean | null) {
    applyFilters({ platform: typeof v === 'string' ? v : '' })
  }

  function onGroupChange(v: string | number | boolean | null) {
    if (v === null) {
      applyFilters({ groupId: null })
      return
    }
    if (typeof v === 'number') {
      applyFilters({ groupId: v > 0 ? v : null })
      return
    }
    if (typeof v === 'string') {
      const n = Number.parseInt(v, 10)
      applyFilters({ groupId: Number.isFinite(n) && n > 0 ? n : null })
    }
  }

  function onQueryModeChange(v: string | number | boolean | null) {
    if (typeof v !== 'string') return
    if (!allowedQueryModes.has(v as QueryMode)) return
    applyFilters({ queryMode: v as QueryMode })
  }

  function openError(id: number) {
    setSelectedErrorId(id)
    // 记录来源列表，便于详情页"返回列表"。
    setDetailReturnTarget(showRequestDetails ? 'requestList' : showErrorDetails ? 'errorList' : null)
    // Ensure only one modal visible at a time.
    setShowErrorDetails(false)
    setShowRequestDetails(false)
    setShowErrorModal(true)
  }

  // 从单条错误详情返回其来源列表，重新打开关联弹窗（保留筛选/分页状态）。
  function handleBackToList() {
    const target = detailReturnTarget
    setResumeListState(true)
    if (target === 'requestList') {
      setShowErrorModal(false)
      setShowErrorDetails(false)
      setShowRequestDetails(true)
    } else if (target === 'errorList') {
      setShowErrorModal(false)
      setShowRequestDetails(false)
      setShowErrorDetails(true)
    }
    setDetailReturnTarget(null)
    // 子组件在本次 show 变化中消费 resumeState 后复位，保证下次手动打开仍会重置筛选。
    window.setTimeout(() => {
      setResumeListState(false)
    }, 0)
  }

  const showPanels = opsEnabled && !(loading && !hasLoadedOnce)

  const content = (
    <div className={styles.page}>
      {errorMessage && <Alert tone="danger" title={errorMessage} />}

      {loading && !hasLoadedOnce ? (
        <OpsDashboardSkeleton fullscreen={isFullscreen} />
      ) : opsEnabled ? (
        <OpsDashboardHeader
          overview={overview}
          platform={platform}
          groupId={groupId}
          timeRange={timeRange}
          queryMode={queryMode}
          loading={loading}
          lastUpdated={lastUpdated}
          thresholds={metricThresholds}
          autoRefreshEnabled={autoRefreshEnabled}
          autoRefreshCountdown={autoRefreshCountdown}
          fullscreen={isFullscreen}
          customStartTime={customStartTime}
          customEndTime={customEndTime}
          onTimeRangeChange={onTimeRangeChange}
          onPlatformChange={onPlatformChange}
          onGroupChange={onGroupChange}
          onQueryModeChange={onQueryModeChange}
          onCustomTimeRangeChange={onCustomTimeRangeChange}
          onRefresh={() => void fetchData()}
          onOpenRequestDetails={handleOpenRequestDetails}
          onOpenErrorDetails={openErrorDetails}
          onOpenSettings={() => setShowSettingsDialog(true)}
          onOpenAlertRules={() => setShowAlertRulesCard(true)}
          onEnterFullscreen={enterFullscreen}
          onExitFullscreen={exitFullscreen}
        />
      ) : null}

      {showPanels && <OpsProviderRealtimeMonitor platformFilter={platform} groupIdFilter={groupId} />}

      {showPanels && <OpsAccountTTFTCard platformFilter={platform} groupIdFilter={groupId} />}

      {/* Row: Concurrency + Throughput */}
      {showPanels && (
        <div className={styles.rowQuad}>
          <div className={styles.concurrencyCell}>
            <OpsConcurrencyCard platformFilter={platform} groupIdFilter={groupId} refreshToken={dashboardRefreshToken} />
          </div>
          <div className={styles.chartCell}>
            <OpsSwitchRateTrendChart
              points={switchTrend?.points ?? []}
              loading={loadingSwitchTrend}
              timeRange={switchTrendTimeRange}
              fullscreen={isFullscreen}
            />
          </div>
          <div className={`${styles.chartCell} ${styles.span2}`}>
            <OpsThroughputTrendChart
              points={throughputTrend?.points ?? []}
              byPlatform={throughputTrend?.by_platform ?? []}
              topGroups={throughputTrend?.top_groups ?? []}
              loading={loadingTrend}
              timeRange={timeRange}
              fullscreen={isFullscreen}
              onSelectPlatform={handleThroughputSelectPlatform}
              onSelectGroup={handleThroughputSelectGroup}
              onOpenDetails={() => handleOpenRequestDetails()}
            />
          </div>
        </div>
      )}

      {/* Row: Visual Analysis (baseline 3-up grid) */}
      {showPanels && (
        <div className={styles.rowTriple}>
          <OpsLatencyChart latencyData={latencyHistogram} loading={loadingLatency} />
          <OpsErrorDistributionChart
            data={errorDistribution}
            loading={loadingErrorDistribution}
            onOpenDetails={() => openErrorDetails('request')}
          />
          <OpsErrorTrendChart
            points={errorTrend?.points ?? []}
            loading={loadingErrorTrend}
            timeRange={timeRange}
            onOpenRequestErrors={() => openErrorDetails('request')}
            onOpenUpstreamErrors={() => openErrorDetails('upstream')}
          />
        </div>
      )}

      {/* Row: Token Stats */}
      {showPanels && showOpenAITokenStats && (
        <OpsOpenAITokenStatsCard platformFilter={platform} groupIdFilter={groupId} refreshToken={dashboardRefreshToken} />
      )}

      {/* Alert Events */}
      {showPanels && showAlertEvents && <OpsAlertEventsCard />}

      {/* System Logs */}
      {showPanels && <OpsSystemLogTable platformFilter={platform} refreshToken={dashboardRefreshToken} />}

      {/* Settings Dialog (hidden in fullscreen mode) */}
      {!isFullscreen && (
        <>
          <OpsSettingsDialog show={showSettingsDialog} onClose={closeSettingsDialog} onSaved={() => void onSettingsSaved()} />

          <BaseDialog
            show={showAlertRulesCard}
            title={t('admin.ops.alertRules.title')}
            width="extra-wide"
            onClose={() => setShowAlertRulesCard(false)}
          >
            <OpsAlertRulesCard />
          </BaseDialog>

          <OpsErrorDetailsModal
            show={showErrorDetails}
            timeRange={timeRange}
            customStartTime={customStartTime}
            customEndTime={customEndTime}
            platform={platform}
            groupId={groupId}
            errorType={errorDetailsType}
            resumeState={resumeListState}
            onShowChange={setShowErrorDetails}
            onOpenErrorDetail={openError}
          />

          <OpsErrorDetailModal
            show={showErrorModal}
            onShowChange={setShowErrorModal}
            errorId={selectedErrorId}
            errorType={errorDetailsType}
            backToList={detailReturnTarget !== null}
            onBack={handleBackToList}
          />

          <OpsRequestDetailsModal
            show={showRequestDetails}
            onShowChange={setShowRequestDetails}
            timeRange={timeRange}
            preset={requestDetailsPreset}
            platform={platform}
            groupId={groupId}
            resumeState={resumeListState}
            onOpenErrorDetail={openError}
          />
        </>
      )}
    </div>
  )

  if (!isFullscreen) return content
  return (
    <FullscreenOverlay label={t('admin.ops.title')} exitLabel={t('opsUi.exitFullscreen')} onExit={exitFullscreen}>
      {content}
    </FullscreenOverlay>
  )
}

/** 全屏浮层：固定覆盖整个视口，层级高于应用外壳、低于对话框与浮层菜单。 */
function FullscreenOverlay({
  label,
  exitLabel,
  onExit,
  children
}: {
  label: string
  exitLabel: string
  onExit: () => void
  children: ReactNode
}) {
  return createPortal(
    <div className={styles.fullscreen} role="region" aria-label={label}>
      <div className={styles.fullscreenBar}>
        <Button variant="ghost" size="sm" onClick={onExit}>
          <Minimize2 size={16} aria-hidden="true" />
          {exitLabel}
        </Button>
      </div>
      {children}
    </div>,
    document.body
  )
}
