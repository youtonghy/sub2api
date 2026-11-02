import { ChevronDown, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import * as api from '@/api/channelMonitorV2'
import type {
  HealthState,
  MonitorDimensions,
  MonitorErrorRow,
  MonitorFilter,
  MonitorHealth,
  MonitorMatrixGroupBy,
  MonitorMatrixResponse,
  MonitorModelRow,
  MonitorRange,
  MonitorSnapshot,
  MonitorUserRow
} from '@/api/channelMonitorV2'
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Progress } from '@/components/arc/progress/progress'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import EmptyState from '@/components/common/EmptyState'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import Select from '@/components/common/Select'
import {
  FilterMultiSelect,
  MetricCell,
  MonitorRankBadge,
  MonitorHorizonChart,
  MonitorTrendChart,
  RelayPulseMatrix,
  formatLatencyKpiSecondary,
  formatLatencyPrivacy,
  formatMonitorMs,
  formatMonitorPercent,
  formatMonitorThroughput,
  formatMonitorTokensPerSecond,
  healthAttr,
  healthScoreClass,
  monitorErrorCategoryLabel,
  tokensPerSecondFromTpm,
  ttftDisplayState
} from '@/features/channel-monitor-v2'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { extractApiErrorMessage } from '@/utils/apiError'
import { isChannelMonitorThroughputHidden, isChannelMonitorUserRankingHidden } from '@/utils/featureFlags'
import styles from './ChannelStatusV2View.module.css'

type Tab = 'models' | 'errors' | 'users'
type HealthMode = 'overall' | 'success' | 'ttft' | 'cache'
type TrendView = 'pulse' | 'line' | 'horizon'

function csv(value: string | null) {
  return typeof value === 'string' ? value.split(',').filter(Boolean) : []
}
function parseRange(value: unknown): MonitorRange {
  return ['90m', '24h', '7d', '30d'].includes(String(value)) ? (value as MonitorRange) : '90m'
}
function parseMatrixGroupBy(value: unknown): MonitorMatrixGroupBy {
  const allowed: MonitorMatrixGroupBy[] = ['platform', 'platform_group', 'platform_model', 'platform_group_model']
  return allowed.includes(value as MonitorMatrixGroupBy) ? (value as MonitorMatrixGroupBy) : 'platform_group'
}
function parseTab(value: unknown, allowUsers: boolean): Tab {
  const allowed: Tab[] = allowUsers ? ['models', 'errors', 'users'] : ['models', 'errors']
  return allowed.includes(value as Tab) ? (value as Tab) : 'models'
}
function parseHealthMode(value: unknown): HealthMode {
  const allowed: HealthMode[] = ['overall', 'success', 'ttft', 'cache']
  return allowed.includes(value as HealthMode) ? (value as HealthMode) : 'overall'
}
function parseTrendView(value: unknown): TrendView {
  return value === 'line' || value === 'horizon' ? value : 'pulse'
}
function filterKey(filter: MonitorFilter) {
  return JSON.stringify([filter.range, filter.platforms, filter.groupIds, filter.models])
}
function isCanceled(error: unknown) {
  return (error as { name?: string }).name === 'CanceledError'
}

/** 状态点：优先多档分数，否则回退到粗粒度 overall（兼容旧版负载） */
function statusDotHealth(health?: MonitorHealth | HealthState): string {
  if (!health || typeof health === 'string') {
    return health || 'unknown'
  }
  return health.score != null ? healthAttr(healthScoreClass(health, 'overall', 0)) : health.overall || 'unknown'
}

/** 渠道监控 V2：KPI、脉冲矩阵/趋势图与模型/错误/用户排行，对应 Vue 版 ChannelStatusV2View.vue */
export default function ChannelStatusV2View() {
  const { t, te, locale } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAdmin = useAuthStore((s) => s.isAdmin)
  /** Admins always see RPM/TPM; users honor the hide-throughput system setting. */
  const showThroughput = isAdmin || !isChannelMonitorThroughputHidden()
  /** Admins always see ranking; users honor the hide-user-ranking system setting. */
  const showUserRanking = isAdmin || !isChannelMonitorUserRankingHidden()

  const [filter, setFilterState] = useState<MonitorFilter>(() => ({
    range: parseRange(searchParams.get('range')),
    platforms: csv(searchParams.get('platform')),
    groupIds: csv(searchParams.get('group')).map(Number).filter(Boolean),
    models: csv(searchParams.get('model'))
  }))
  const [activeTab, setActiveTabState] = useState<Tab>(() => parseTab(searchParams.get('tab'), showUserRanking))
  const [matrixGroupBy, setMatrixGroupByState] = useState<MonitorMatrixGroupBy>(() =>
    parseMatrixGroupBy(searchParams.get('group_by'))
  )
  const [healthMode, setHealthMode] = useState<HealthMode>(() => parseHealthMode(searchParams.get('health_mode')))
  const [trendView, setTrendView] = useState<TrendView>(() => parseTrendView(searchParams.get('trend_view')))
  const [dimensions, setDimensions] = useState<MonitorDimensions>({ platforms: [], groups: [], models: [] })
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null)
  const [matrix, setMatrix] = useState<MonitorMatrixResponse | null>(null)
  const [modelRows, setModelRows] = useState<MonitorModelRow[]>([])
  const [errorRows, setErrorRows] = useState<MonitorErrorRow[]>([])
  const [userRows, setUserRows] = useState<MonitorUserRow[]>([])
  const [loading, setLoadingState] = useState(false)
  const [tabLoading, setTabLoading] = useState(false)
  const [refreshing, setRefreshingState] = useState(false)
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(() => new Set())

  // 异步流程读取最新值用的镜像（Vue 版直接读 ref.value）
  const filterRef = useRef(filter)
  const tabRef = useRef(activeTab)
  const groupByRef = useRef(matrixGroupBy)
  const loadingRef = useRef(false)
  const refreshingRef = useRef(false)
  const isAdminRef = useRef(isAdmin)
  const showUserRankingRef = useRef(showUserRanking)
  const controllerRef = useRef<AbortController | null>(null)
  const sequenceRef = useRef(0)
  const autoRefreshTimer = useRef<number | null>(null)

  useEffect(() => {
    isAdminRef.current = isAdmin
    showUserRankingRef.current = showUserRanking
  })

  function setFilter(next: MonitorFilter) {
    filterRef.current = next
    setFilterState(next)
  }
  function setActiveTab(next: Tab) {
    tabRef.current = next
    setActiveTabState(next)
  }
  function setMatrixGroupBy(next: MonitorMatrixGroupBy) {
    groupByRef.current = next
    setMatrixGroupByState(next)
  }
  function setLoading(value: boolean) {
    loadingRef.current = value
    setLoadingState(value)
  }
  function setRefreshing(value: boolean) {
    refreshingRef.current = value
    setRefreshingState(value)
  }

  const ranges = [
    { value: '90m', label: t('channelMonitorV2.ranges.90m') },
    { value: '24h', label: t('channelMonitorV2.ranges.24h') },
    { value: '7d', label: t('channelMonitorV2.ranges.7d') },
    { value: '30d', label: t('channelMonitorV2.ranges.30d') }
  ]
  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'models', label: t('channelMonitorV2.tabs.models') },
    { value: 'errors', label: t('channelMonitorV2.tabs.errors') }
  ]
  if (showUserRanking) tabs.push({ value: 'users', label: t('channelMonitorV2.tabs.users') })
  const matrixGroupOptions = [
    { value: 'platform', label: t('channelMonitorV2.groupBy.platform') },
    { value: 'platform_group', label: t('channelMonitorV2.groupBy.platformGroup') },
    { value: 'platform_model', label: t('channelMonitorV2.groupBy.platformModel') },
    { value: 'platform_group_model', label: t('channelMonitorV2.groupBy.platformGroupModel') }
  ]
  const healthModeOptions = [
    { value: 'overall', label: t('channelMonitorV2.healthMode.overall') },
    { value: 'success', label: t('channelMonitorV2.healthMode.success') },
    { value: 'ttft', label: t('channelMonitorV2.healthMode.ttft') },
    { value: 'cache', label: t('channelMonitorV2.healthMode.cache') }
  ]
  const trendViewOptions = [
    { value: 'pulse', label: t('channelMonitorV2.trendView.pulse') },
    { value: 'line', label: t('channelMonitorV2.trendView.line') },
    { value: 'horizon', label: t('channelMonitorV2.trendView.horizon') }
  ]

  const hasDimensionFilter = filter.platforms.length + filter.groupIds.length + filter.models.length > 0
  // Full platform catalog (never pruned). Groups/models cascade by selected platforms
  // so choosing a platform narrows the other pickers without collapsing platforms.
  const platformOptions = (dimensions.platforms || []).map((item) => ({ value: item.value, label: item.label }))
  const groupOptions = useMemo(() => {
    const selected = new Set(filter.platforms)
    return (dimensions.groups || [])
      .filter((item) => selected.size === 0 || !item.platform || selected.has(item.platform))
      .map((item) => ({
        value: String(item.id),
        label: item.platform ? `${item.platform} / ${item.name || `#${item.id}`}` : item.name || `#${item.id}`
      }))
  }, [dimensions.groups, filter.platforms])
  const modelOptions = useMemo(() => {
    const selected = new Set(filter.platforms)
    return (dimensions.models || [])
      .filter((item) => selected.size === 0 || !item.platform || selected.has(item.platform))
      .map((item) => ({
        value: item.value,
        label: item.platform && !item.label.includes(item.platform) ? `${item.platform} / ${item.label}` : item.label
      }))
  }, [dimensions.models, filter.platforms])
  const selectedGroupIds = filter.groupIds.map(String)

  // Soft-prune group/model selections that fall outside the platform cascade.
  // Do NOT wipe when options are temporarily empty (loading); only drop invalid ids.
  useEffect(() => {
    const current = filterRef.current
    let next = current
    if (groupOptions.length > 0) {
      const allowed = new Set(groupOptions.map((item) => item.value))
      const groupIds = current.groupIds.filter((id) => allowed.has(String(id)))
      if (groupIds.length !== current.groupIds.length) next = { ...next, groupIds }
    }
    if (modelOptions.length > 0) {
      const allowed = new Set(modelOptions.map((item) => item.value))
      const models = current.models.filter((model) => allowed.has(model))
      if (models.length !== current.models.length) next = { ...next, models }
    }
    // 与 Vue 版 watch([groupOptions, modelOptions]) 一致
    if (next !== current) setFilter(next)
  }, [groupOptions, modelOptions])

  const activeRowsEmpty =
    activeTab === 'models' ? modelRows.length === 0 : activeTab === 'errors' ? errorRows.length === 0 : userRows.length === 0
  /** First-upgrade backfill toward 90m/24h/7d/30d; banner hides when backend omits bootstrap. */
  const bootstrapActive = Boolean(snapshot?.coverage?.bootstrap?.active)
  const rawBootstrapPercent = snapshot?.coverage?.bootstrap?.progress_percent
  const bootstrapPercent =
    typeof rawBootstrapPercent !== 'number' || Number.isNaN(rawBootstrapPercent)
      ? 0
      : Math.min(100, Math.max(0, Math.round(rawBootstrapPercent)))
  const matrixRows = useMemo(() => {
    const items = matrix?.items || []
    // platform_group views should only show real groups, never bare platform placeholders.
    if (matrixGroupBy === 'platform_group' || matrixGroupBy === 'platform_group_model') {
      return items.filter((row) => row.group_id != null && Number(row.group_id) > 0)
    }
    return items
  }, [matrix, matrixGroupBy])

  /** Dimensions catalog: range only — never re-filtered by platform/group/model selection. */
  async function loadDimensions(signal: AbortSignal | undefined, id: number) {
    const rangeOnly: MonitorFilter = { range: filterRef.current.range, platforms: [], groupIds: [], models: [] }
    const next = await api.getDimensions(rangeOnly, isAdminRef.current, signal)
    if (id !== sequenceRef.current) return
    setDimensions(next)
  }

  async function loadMetrics(signal: AbortSignal | undefined, id: number) {
    const [nextSnapshot, nextMatrix] = await Promise.all([
      api.getSnapshot(filterRef.current, isAdminRef.current, signal),
      api.getMatrix(filterRef.current, groupByRef.current, isAdminRef.current, signal)
    ])
    if (id !== sequenceRef.current) return
    setSnapshot(nextSnapshot)
    setMatrix(nextMatrix)
    scheduleAutoRefresh(nextSnapshot)
    await loadTab(signal, id)
  }

  async function runLoad(silent: boolean, withDimensions: boolean) {
    controllerRef.current?.abort()
    const request = new AbortController()
    controllerRef.current = request
    const id = ++sequenceRef.current
    setRefreshing(true)
    if (!silent) setLoading(true)
    try {
      // Catalog + metrics in parallel; catalog ignores dimension filters so options never shrink.
      await Promise.all([
        withDimensions ? loadDimensions(request.signal, id) : Promise.resolve(),
        loadMetrics(request.signal, id)
      ])
    } catch (error) {
      if (!isCanceled(error)) {
        useAppStore.getState().showError(extractApiErrorMessage(error, t('channelMonitorV2.loadFailed')))
      }
    } finally {
      if (id === sequenceRef.current) {
        setLoading(false)
        setTabLoading(false)
        setRefreshing(false)
      }
    }
  }

  function reload(silent = true) {
    return runLoad(silent, true)
  }

  /** When only range changes, still refresh dimensions; dimension filters only re-load metrics. */
  function reloadMetricsOnly(silent = true) {
    return runLoad(silent, false)
  }

  async function loadTab(signal?: AbortSignal, id = sequenceRef.current) {
    setTabLoading(true)
    try {
      const tab = tabRef.current
      if (tab === 'models') {
        setModelRows((await api.getModels(filterRef.current, isAdminRef.current, signal)).items || [])
      } else if (tab === 'errors') {
        setErrorRows((await api.getErrors(filterRef.current, isAdminRef.current, signal)).items || [])
      } else if (showUserRankingRef.current) {
        setUserRows((await api.getUsers(filterRef.current, isAdminRef.current, signal)).items || [])
      } else {
        setUserRows([])
      }
    } catch (error) {
      const e = error as { name?: string; code?: string }
      if (e?.name === 'AbortError' || e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
      useAppStore.getState().showError(extractApiErrorMessage(error, t('channelMonitorV2.detailLoadFailed')))
    } finally {
      if (id === sequenceRef.current) setTabLoading(false)
    }
  }

  function scheduleAutoRefresh(current: MonitorSnapshot) {
    if (autoRefreshTimer.current) {
      window.clearInterval(autoRefreshTimer.current)
      autoRefreshTimer.current = null
    }
    // Poll faster while first-upgrade bootstrap is filling 90m→30d so the progress bar moves.
    const booting = Boolean(current.coverage?.bootstrap?.active)
    const seconds = booting ? 10 : current.config?.refresh_interval_seconds || 300
    autoRefreshTimer.current = window.setInterval(
      () => {
        if (!loadingRef.current && !refreshingRef.current) {
          void reload(true)
        }
      },
      Math.max(booting ? 10 : 60, seconds) * 1000
    )
  }

  function setRange(value: string) {
    const range = value as MonitorRange
    if (range === filterRef.current.range) return
    setFilter({ ...filterRef.current, range })
  }
  function clearDimensions() {
    setFilter({ ...filterRef.current, platforms: [], groupIds: [], models: [] })
  }
  function drillModel(row: MonitorModelRow) {
    setFilter({ ...filterRef.current, platforms: [row.platform], models: [row.model] })
  }
  function setSelectedGroupIds(value: string[]) {
    setFilter({ ...filterRef.current, groupIds: value.map(Number).filter((id) => Number.isInteger(id) && id > 0) })
  }

  const exactRate = (value: number) =>
    Intl.NumberFormat(locale || undefined, { maximumFractionDigits: 2 }).format(value || 0)
  const exactTps = (tpm: number | null | undefined) =>
    Intl.NumberFormat(locale || undefined, { maximumFractionDigits: 3 }).format(tokensPerSecondFromTpm(tpm))
  const latencyDetail = (metric: { p50_ms: number | null; p90_ms?: number | null; p95_ms: number | null; avg_ms?: number | null }) =>
    formatLatencyPrivacy(metric.p50_ms, metric.p90_ms, metric.avg_ms, metric.p95_ms)
  /** KPI secondary: AVG · P90 under the P50 primary value. */
  const latencyKpiSecondary = (metric: { p90_ms?: number | null; p95_ms: number | null; avg_ms?: number | null }) =>
    formatLatencyKpiSecondary(metric.avg_ms, metric.p90_ms, metric.p95_ms)
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat(locale || undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  function errorLabel(value: string) {
    const key = `channelMonitorV2.errorCategories.${value}`
    return te(key) ? t(key) : monitorErrorCategoryLabel(value)
  }
  function toggleError(category: string) {
    const next = new Set(expandedErrors)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    setExpandedErrors(next)
  }

  // 对应 Vue 版 syncQuery：筛选、矩阵分组、健康模式、视图与标签变化时替换地址栏参数（挂载时不写）
  const currentFilterKey = filterKey(filter)
  const queryKey = JSON.stringify([currentFilterKey, matrixGroupBy, healthMode, trendView, activeTab])
  const lastQueryKey = useRef(queryKey)
  useEffect(() => {
    if (lastQueryKey.current === queryKey) return
    lastQueryKey.current = queryKey
    const next = new URLSearchParams()
    next.set('range', filter.range)
    if (filter.platforms.length) next.set('platform', filter.platforms.join(','))
    if (filter.groupIds.length) next.set('group', filter.groupIds.join(','))
    if (filter.models.length) next.set('model', filter.models.join(','))
    next.set('group_by', matrixGroupBy)
    next.set('health_mode', healthMode)
    if (trendView !== 'pulse') next.set('trend_view', trendView)
    next.set('tab', activeTab)
    setSearchParams(next, { replace: true })
  }, [queryKey, filter, matrixGroupBy, healthMode, trendView, activeTab, setSearchParams])

  // 对应 Vue 版 watch(filter, { deep: true })：区间变化全量刷新，维度筛选只刷新指标
  const lastFilter = useRef({ key: currentFilterKey, range: filter.range })
  useEffect(() => {
    if (lastFilter.current.key === currentFilterKey) return
    const rangeChanged = lastFilter.current.range !== filter.range
    lastFilter.current = { key: currentFilterKey, range: filter.range }
    if (rangeChanged) void reload(true)
    else void reloadMetricsOnly(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在筛选内容变化时触发
  }, [currentFilterKey])

  // 对应 Vue 版 watch(matrixGroupBy)
  const lastGroupBy = useRef(matrixGroupBy)
  useEffect(() => {
    if (lastGroupBy.current === matrixGroupBy) return
    lastGroupBy.current = matrixGroupBy
    void reloadMetricsOnly(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在矩阵分组变化时触发
  }, [matrixGroupBy])

  // 对应 Vue 版 watch(activeTab)
  const lastTab = useRef(activeTab)
  useEffect(() => {
    if (lastTab.current === activeTab) return
    lastTab.current = activeTab
    void loadTab()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在标签变化时触发
  }, [activeTab])

  // 对应 Vue 版 watch(showUserRanking)
  useEffect(() => {
    // 排行被隐藏时退回模型标签
    if (!showUserRanking && tabRef.current === 'users') setActiveTab('models')
  }, [showUserRanking])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时加载（Vue 版 onMounted）
    void reload(false)
    return () => {
      controllerRef.current?.abort()
      if (autoRefreshTimer.current) window.clearInterval(autoRefreshTimer.current)
      autoRefreshTimer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载时加载（Vue 版 onMounted / onBeforeUnmount）
  }, [])

  const kpiCount = showThroughput ? 5 : 4

  return (
    <div className={styles.page}>
      {/* 工具栏：状态行 + 刷新；区间 · 维度筛选 · 视图控制 */}
      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <div className={styles.statusLine}>
            <span className={styles.liveDot} data-idle={loading || refreshing ? '' : undefined} aria-hidden="true" />
            {refreshing ? (
              <span className={styles.updating}>
                <LoadingSpinner size="sm" />
                {t('channelMonitorV2.updating')}
              </span>
            ) : snapshot?.coverage.data_through ? (
              <span>{t('channelMonitorV2.updatedTo', { time: formatTime(snapshot.coverage.data_through) })}</span>
            ) : (
              <span className={styles.muted}>{t('common.loading')}</span>
            )}
            {snapshot && !snapshot.coverage.coverage_complete && !bootstrapActive && (
              <Badge size="sm" tone="warning">
                {t('channelMonitorV2.partialCoverage')}
              </Badge>
            )}
            {bootstrapActive && (
              <Badge size="sm" tone="info">
                {t('channelMonitorV2.bootstrap.progress', { percent: bootstrapPercent })}
              </Badge>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            disabled={loading}
            onClick={() => void reload(false)}
          >
            <RefreshCw size={16} strokeWidth={1.75} className={loading ? styles.spinning : undefined} aria-hidden="true" />
          </Button>
        </header>

        {/* First-upgrade silent backfill: show until 30d product window is covered */}
        {bootstrapActive && (
          <div className={styles.bootstrap} role="status" aria-live="polite">
            <Alert tone="info" title={t('channelMonitorV2.bootstrap.title')}>
              <p>{t('channelMonitorV2.bootstrap.description')}</p>
              <Progress
                value={bootstrapPercent}
                max={100}
                label={t('channelMonitorV2.bootstrap.working')}
                className={styles.bootstrapProgress}
              />
              <span className={styles.bootstrapPercent}>
                {t('channelMonitorV2.bootstrap.progress', { percent: bootstrapPercent })}
              </span>
            </Alert>
          </div>
        )}

        <div className={styles.toolbar}>
          <SegmentedControl
            options={ranges}
            value={filter.range}
            label={t('channelMonitorV2.timeRange')}
            onValueChange={setRange}
          />
          <FilterMultiSelect
            compact
            value={filter.platforms}
            label={t('channelMonitorV2.filters.platform')}
            allLabel={t('channelMonitorV2.filters.allPlatforms')}
            options={platformOptions}
            onChange={(value) => setFilter({ ...filterRef.current, platforms: value })}
          />
          <FilterMultiSelect
            compact
            value={selectedGroupIds}
            label={t('channelMonitorV2.filters.group')}
            allLabel={t('channelMonitorV2.filters.allGroups')}
            options={groupOptions}
            onChange={setSelectedGroupIds}
          />
          <FilterMultiSelect
            compact
            value={filter.models}
            label={t('channelMonitorV2.filters.model')}
            allLabel={t('channelMonitorV2.filters.allModels')}
            options={modelOptions}
            onChange={(value) => setFilter({ ...filterRef.current, models: value })}
          />
          <Button type="button" variant="ghost" size="sm" disabled={!hasDimensionFilter} onClick={clearDimensions}>
            {t('channelMonitorV2.clearFilters')}
          </Button>

          <span className={styles.separator} aria-hidden="true" />

          <div className={styles.groupBySelect}>
            <Select
              value={matrixGroupBy}
              options={matrixGroupOptions}
              placeholder={t('channelMonitorV2.groupBy.label')}
              onChange={(value) => {
                const next = parseMatrixGroupBy(value)
                if (next !== groupByRef.current) setMatrixGroupBy(next)
              }}
            />
          </div>
          <SegmentedControl
            options={trendViewOptions}
            value={trendView}
            label={t('channelMonitorV2.trendView.label')}
            onValueChange={(value) => setTrendView(parseTrendView(value))}
          />
          {trendView === 'pulse' && (
            <SegmentedControl
              options={healthModeOptions}
              value={healthMode}
              label={t('channelMonitorV2.healthMode.label')}
              onValueChange={(value) => setHealthMode(parseHealthMode(value))}
            />
          )}
        </div>
      </section>

      {/* Overview KPI: success · TTFT · tokens/s(optional) · cache · (+ RPM when throughput visible) */}
      {snapshot ? (
        <section className={styles.kpis} aria-label={t('channelMonitorV2.summaryAria')}>
          <MetricCell
            label={t('channelMonitorV2.metrics.successRate')}
            value={formatMonitorPercent(1 - snapshot.metrics.error_rate)}
            detail={t('channelMonitorV2.metrics.errorRateValue', { value: formatMonitorPercent(snapshot.metrics.error_rate) })}
            state={snapshot.health.error_rate}
          />
          <MetricCell
            label={t('channelMonitorV2.metrics.ttftP50')}
            value={formatMonitorMs(snapshot.metrics.ttft.p50_ms)}
            detail={latencyKpiSecondary(snapshot.metrics.ttft)}
            title={latencyDetail(snapshot.metrics.ttft)}
            state={ttftDisplayState(snapshot.health.ttft, snapshot.metrics.ttft)}
          />
          {showThroughput && (
            <MetricCell
              label={t('channelMonitorV2.metrics.tps')}
              value={formatMonitorTokensPerSecond(snapshot.metrics.tpm)}
              detail={t('channelMonitorV2.metrics.tpsDetail')}
              title={exactTps(snapshot.metrics.tpm)}
            />
          )}
          <MetricCell
            label={t('channelMonitorV2.metrics.cacheRate')}
            value={formatMonitorPercent(snapshot.metrics.cache_rate)}
            detail={t('channelMonitorV2.metrics.cacheDetail')}
            state={snapshot.health.cache || snapshot.health.overall}
          />
          {showThroughput && (
            <MetricCell
              label={t('channelMonitorV2.metrics.rpm')}
              value={formatMonitorThroughput(snapshot.metrics.rpm)}
              detail={t('channelMonitorV2.metrics.rpmDetail')}
              title={exactRate(snapshot.metrics.rpm)}
            />
          )}
        </section>
      ) : loading ? (
        <section className={styles.kpis} aria-hidden="true">
          {Array.from({ length: kpiCount }, (_, i) => (
            <div key={i} className={styles.kpiSkeleton}>
              <Skeleton label={t('common.loading')} lines={2} />
            </div>
          ))}
        </section>
      ) : null}

      <div className={styles.chartArea}>
        {trendView === 'line' ? (
          <MonitorTrendChart trend={snapshot?.trend || []} coverage={snapshot?.coverage || null} loading={loading && !snapshot} />
        ) : matrix && trendView === 'horizon' ? (
          <MonitorHorizonChart rows={matrixRows} coverage={matrix.coverage} />
        ) : matrix ? (
          <RelayPulseMatrix
            rows={matrixRows}
            coverage={matrix.coverage}
            healthMode={healthMode}
            showThroughput={showThroughput}
          />
        ) : loading ? (
          <div className={styles.chartLoading}>
            <Skeleton label={t('common.loading')} lines={6} />
          </div>
        ) : null}
      </div>

      <section className={styles.panel}>
        <div className={styles.tabsHeader}>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as Tab)}>
            <TabsList aria-label={t('channelMonitorV2.tabs.aria')}>
              {tabs.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className={styles.tabBody}>
          {activeTab === 'models' ? (
            <div className={styles.tableWrap}>
              <table className={styles.table} data-min="720">
                <thead>
                  <tr>
                    <th>{t('channelMonitorV2.table.platformModel')}</th>
                    <th>{t('channelMonitorV2.metrics.successRate')}</th>
                    <th>{t('channelMonitorV2.metrics.ttftP50')}</th>
                    {showThroughput && <th>{t('channelMonitorV2.metrics.tps')}</th>}
                    <th>{t('channelMonitorV2.metrics.cacheRate')}</th>
                    {showThroughput && <th>{t('channelMonitorV2.metrics.rpm')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {modelRows.map((row) => (
                    <tr key={`${row.platform}:${row.model}`} className={styles.clickableRow} onClick={() => drillModel(row)}>
                      <td>
                        <div className={styles.modelCell}>
                          <span className={styles.dot} data-health={statusDotHealth(row.health)} aria-hidden="true" />
                          <div>
                            <span className={styles.platformLabel}>{row.platform}</span>
                            <strong className={styles.strong}>
                              {row.model === '__other__' ? t('channelMonitorV2.otherModels') : row.model}
                            </strong>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={styles.block}>{formatMonitorPercent(1 - row.metrics.error_rate)}</span>
                        <small className={styles.small}>
                          {t('channelMonitorV2.metrics.errorRateValue', { value: formatMonitorPercent(row.metrics.error_rate) })}
                        </small>
                      </td>
                      <td>
                        <span className={styles.block}>{formatMonitorMs(row.metrics.ttft.p50_ms)}</span>
                        <small className={styles.small}>{latencyDetail(row.metrics.ttft)}</small>
                      </td>
                      {showThroughput && <td title={exactTps(row.metrics.tpm)}>{formatMonitorTokensPerSecond(row.metrics.tpm)}</td>}
                      <td>{formatMonitorPercent(row.metrics.cache_rate)}</td>
                      {showThroughput && <td>{formatMonitorThroughput(row.metrics.rpm)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : activeTab === 'errors' ? (
            <div className={styles.errorList}>
              {errorRows.map((row) => {
                const expanded = expandedErrors.has(row.category)
                return (
                  <div key={row.category} className={styles.errorRow} data-ignored={row.ignored ? '' : undefined}>
                    <button
                      type="button"
                      className={styles.errorToggle}
                      aria-expanded={expanded}
                      onClick={() => toggleError(row.category)}
                    >
                      <span className={styles.errorLabel}>
                        <span className={styles.truncate}>{errorLabel(row.category)}</span>
                        {row.ignored && (
                          <Badge size="sm" tone="neutral">
                            {t('channelMonitorV2.ignored')}
                          </Badge>
                        )}
                      </span>
                      <span className={styles.errorTrack}>
                        <i className={styles.errorFill} style={{ width: `${Math.max(2, row.rate * 100)}%` }} />
                      </span>
                      <small className={styles.errorRate}>{formatMonitorPercent(row.rate)}</small>
                      <ChevronDown
                        size={16}
                        strokeWidth={1.75}
                        className={styles.chevron}
                        data-open={expanded ? '' : undefined}
                        aria-hidden="true"
                      />
                    </button>
                    {expanded && (
                      <div className={styles.errorDetails}>
                        {isAdmin && (row.details || []).length ? (
                          (row.details || []).map((detail, index) => (
                            <div key={`${row.category}:${index}:${detail.message}`} className={styles.errorDetail}>
                              <div className={styles.errorDetailMeta}>
                                <Badge size="sm" tone="neutral">
                                  {detail.platform || '-'}
                                </Badge>
                                <span className={styles.errorDetailModel}>{detail.model || '-'}</span>
                                {detail.status_code ? (
                                  <span className={styles.muted}>
                                    {t('channelMonitorV2.errorDetail.http', { code: detail.status_code })}
                                  </span>
                                ) : null}
                                {detail.upstream_status_code ? (
                                  <span className={styles.muted}>
                                    {t('channelMonitorV2.errorDetail.upstream', { code: detail.upstream_status_code })}
                                  </span>
                                ) : null}
                                <span className={styles.errorDetailCount}>×{detail.count}</span>
                              </div>
                              <p className={styles.errorMessage}>
                                {detail.message || detail.error_type || t('channelMonitorV2.errorDetail.noMessage')}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className={styles.small}>{t('channelMonitorV2.errorDetail.empty')}</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table} data-min="640">
                <thead>
                  <tr>
                    <th className={styles.rankCol}>{t('channelMonitorV2.table.rank')}</th>
                    <th>{t('channelMonitorV2.table.user')}</th>
                    <th>{t('channelMonitorV2.metrics.successRate')}</th>
                    <th>{t('channelMonitorV2.metrics.ttftP50')}</th>
                    {showThroughput && <th>{t('channelMonitorV2.metrics.tps')}</th>}
                    <th>{t('channelMonitorV2.metrics.cacheRate')}</th>
                    {showThroughput && <th>{t('channelMonitorV2.metrics.rpm')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {userRows.map((row) => (
                    <tr key={row.user_id || row.display_label} data-self={row.is_self ? '' : undefined}>
                      <td>
                        <MonitorRankBadge rank={row.rank} />
                      </td>
                      <td>
                        <strong className={styles.strong} data-self={row.is_self ? '' : undefined}>
                          {row.display_label}
                          {row.is_self && (
                            <Badge size="sm" tone="info" className={styles.selfBadge}>
                              {t('channelMonitorV2.currentUser')}
                            </Badge>
                          )}
                        </strong>
                      </td>
                      <td>
                        <span className={styles.block}>{formatMonitorPercent(1 - row.metrics.error_rate)}</span>
                        <small className={styles.small}>
                          {t('channelMonitorV2.metrics.errorRateValue', { value: formatMonitorPercent(row.metrics.error_rate) })}
                        </small>
                      </td>
                      <td>
                        <span className={styles.block}>{formatMonitorMs(row.metrics.ttft.p50_ms)}</span>
                        <small className={styles.small}>{latencyDetail(row.metrics.ttft)}</small>
                      </td>
                      {showThroughput && <td title={exactTps(row.metrics.tpm)}>{formatMonitorTokensPerSecond(row.metrics.tpm)}</td>}
                      <td>{formatMonitorPercent(row.metrics.cache_rate)}</td>
                      {showThroughput && <td>{formatMonitorThroughput(row.metrics.rpm)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tabLoading ? (
            <div className={styles.tabMessage}>{t('common.loading')}</div>
          ) : activeRowsEmpty ? (
            <EmptyState
              title={bootstrapActive ? t('channelMonitorV2.bootstrap.title') : t('channelMonitorV2.empty.title')}
              description={
                bootstrapActive ? t('channelMonitorV2.bootstrap.description') : t('channelMonitorV2.empty.description')
              }
            />
          ) : null}
        </div>
      </section>
    </div>
  )
}
