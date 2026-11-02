import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AlertTriangle, Bell, Info, Lightbulb, Maximize2, RefreshCw, Settings, XCircle } from 'lucide-react'

import { Button } from '@/components/arc/button/button'
import { MetricCard } from '@/components/arc/metric-card/metric-card'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import BaseDialog from '@/components/common/BaseDialog'
import HelpTooltip from '@/components/common/HelpTooltip'
import Input from '@/components/common/Input'
import Select, { type SelectValue } from '@/components/common/Select'
import { adminAPI } from '@/api'
import { opsAPI, type OpsDashboardOverview, type OpsMetricThresholds, type OpsRealtimeTrafficSummary } from '@/api/admin/ops'
import { CONCRETE_PLATFORM_OPTIONS } from '@/constants/platforms'
import { getPlatformCatalog, subscribePlatformCatalog } from '@/constants/platformCatalog'
import { useI18n } from '@/i18n/useI18n'
import { useAdminSettingsStore } from '@/stores'
import { formatDateTimeLocalInput, formatNumber } from '@/utils/format'
import type { OpsRequestDetailsPreset } from '../types'
import { formatMemorySizeMB } from '../utils/opsFormatters'
import panel from './OpsPanel.module.css'
import styles from './OpsDashboardHeader.module.css'

type RealtimeWindow = '1min' | '5min' | '30min' | '1h'

export interface OpsDashboardHeaderProps {
  overview?: OpsDashboardOverview | null
  platform: string
  groupId: number | null
  timeRange: string
  queryMode: string
  loading: boolean
  lastUpdated: Date | null
  thresholds?: OpsMetricThresholds | null // 阈值配置
  autoRefreshEnabled?: boolean
  autoRefreshCountdown?: number
  fullscreen?: boolean
  customStartTime?: string | null
  customEndTime?: string | null
  onPlatformChange?: (value: string) => void
  onGroupChange?: (value: number | null) => void
  onTimeRangeChange?: (value: string) => void
  /** Vue 版查询模式选择器被 v-if="false" 隐藏，这里保留回调以对齐契约 */
  onQueryModeChange?: (value: string) => void
  onCustomTimeRangeChange?: (startTime: string, endTime: string) => void
  onRefresh?: () => void
  onOpenRequestDetails?: (preset?: OpsRequestDetailsPreset) => void
  onOpenErrorDetails?: (kind: 'request' | 'upstream') => void
  onOpenSettings?: () => void
  onOpenAlertRules?: () => void
  onEnterFullscreen?: () => void
  onExitFullscreen?: () => void
}

const REALTIME_WINDOW_MINUTES: Record<RealtimeWindow, number> = {
  '1min': 1,
  '5min': 5,
  '30min': 30,
  '1h': 60
}

const TOOLBAR_RANGE_MINUTES: Record<string, number> = {
  '5m': 5,
  '30m': 30,
  '1h': 60,
  '6h': 6 * 60,
  '24h': 24 * 60
}

const goroutinesWarnThreshold = 8_000
const goroutinesCriticalThreshold = 15_000

// --- Threshold checking helpers ---
type ThresholdLevel = 'normal' | 'warning' | 'critical'
type Tone = 'success' | 'warning' | 'danger' | 'neutral'

function formatCustomTimeRangeLabel(startTime: string, endTime: string): string {
  const start = new Date(startTime)
  const end = new Date(endTime)
  const formatDate = (d: Date) => {
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hour = String(d.getHours()).padStart(2, '0')
    const minute = String(d.getMinutes()).padStart(2, '0')
    return `${month}-${day} ${hour}:${minute}`
  }
  return `${formatDate(start)} ~ ${formatDate(end)}`
}

function thresholdTone(level: ThresholdLevel): Tone {
  switch (level) {
    case 'critical':
      return 'danger'
    case 'warning':
      return 'warning'
    default:
      return 'success'
  }
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// --- System health (secondary) ---
function formatTimeShort(ts?: string | null): string {
  if (!ts) return '-'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleTimeString()
}

function fixed1(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '-'
}

export default function OpsDashboardHeader(props: OpsDashboardHeaderProps) {
  const {
    overview: overviewProp,
    platform,
    groupId,
    timeRange,
    loading,
    lastUpdated,
    thresholds,
    autoRefreshEnabled,
    autoRefreshCountdown,
    fullscreen = false,
    customStartTime,
    customEndTime,
    onPlatformChange,
    onGroupChange,
    onTimeRangeChange,
    onCustomTimeRangeChange,
    onRefresh,
    onOpenRequestDetails,
    onOpenErrorDetails,
    onOpenSettings,
    onOpenAlertRules,
    onEnterFullscreen
  } = props
  const { t } = useI18n()
  const opsRealtimeMonitoringEnabled = useAdminSettingsStore((s) => s.opsRealtimeMonitoringEnabled)
  // 平台目录变化时重新渲染（CONCRETE_PLATFORM_OPTIONS 会被原地重建）
  useSyncExternalStore(subscribePlatformCatalog, getPlatformCatalog, getPlatformCatalog)

  const [realtimeWindow, setRealtimeWindow] = useState<RealtimeWindow>('1min')

  const overview = overviewProp ?? null
  const systemMetrics = overview?.system_metrics ?? null

  const toolbarMinutes = TOOLBAR_RANGE_MINUTES[timeRange] ?? 60
  const availableRealtimeWindows = (['1min', '5min', '30min', '1h'] as const).filter(
    (w) => REALTIME_WINDOW_MINUTES[w] <= toolbarMinutes
  )

  // --- Filters ---

  const [showCustomTimeRangeDialog, setShowCustomTimeRangeDialog] = useState(false)
  const [customStartTimeInput, setCustomStartTimeInput] = useState('')
  const [customEndTimeInput, setCustomEndTimeInput] = useState('')

  const [groups, setGroups] = useState<Array<{ id: number; name: string; platform: string }>>([])

  const platformOptions = [{ value: '', label: t('common.all') }, ...CONCRETE_PLATFORM_OPTIONS]

  const timeRangeOptions = [
    { value: '5m', label: t('admin.ops.timeRange.5m') },
    { value: '30m', label: t('admin.ops.timeRange.30m') },
    { value: '1h', label: t('admin.ops.timeRange.1h') },
    { value: '6h', label: t('admin.ops.timeRange.6h') },
    { value: '24h', label: t('admin.ops.timeRange.24h') },
    {
      value: 'custom',
      label:
        timeRange === 'custom' && customStartTime && customEndTime
          ? `${t('admin.ops.timeRange.custom')} (${formatCustomTimeRangeLabel(customStartTime, customEndTime)})`
          : t('admin.ops.timeRange.custom')
    }
  ]

  // 查询模式选择器在 Vue 版中为 v-if="false"（不渲染），React 版同样不渲染。

  const groupOptions = useMemo(() => {
    const filtered = platform ? groups.filter((g) => g.platform === platform) : groups
    return [{ value: null, label: t('common.all') }, ...filtered.map((g) => ({ value: g.id, label: g.name }))]
  }, [groups, platform, t])

  useEffect(() => {
    let cancelled = false
    adminAPI.groups
      .getAll()
      .then((list) => {
        if (cancelled) return
        setGroups(list.map((g) => ({ id: g.id, name: g.name, platform: g.platform })))
      })
      .catch((e) => {
        console.error('[OpsDashboardHeader] Failed to load groups', e)
        if (!cancelled) setGroups([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 最新的 props/状态，供异步加载与事件处理读取（对应 Vue 中直接读取 props/ref）。
  const latestRef = useRef({ platform, groupId, realtimeWindow, groups, onGroupChange })
  useEffect(() => {
    latestRef.current = { platform, groupId, realtimeWindow, groups, onGroupChange }
  })

  // 平台切换时，若当前分组不属于新平台则清空分组（Vue: watch(platform)，非 immediate）
  const prevPlatformRef = useRef(platform)
  useEffect(() => {
    if (prevPlatformRef.current === platform) return
    prevPlatformRef.current = platform
    if (!platform) return
    const { groups: currentGroups, groupId: currentGroupId, onGroupChange: emitGroup } = latestRef.current
    const currentGroup = currentGroups.find((g) => g.id === currentGroupId)
    if (currentGroup && currentGroup.platform !== platform) {
      emitGroup?.(null)
    }
  }, [platform])

  function handlePlatformChange(val: SelectValue) {
    onPlatformChange?.(String(val || ''))
  }

  function handleGroupChange(val: SelectValue) {
    if (val === null || val === '' || typeof val === 'boolean') {
      onGroupChange?.(null)
      return
    }
    const id = typeof val === 'number' ? val : Number.parseInt(String(val), 10)
    onGroupChange?.(Number.isFinite(id) && id > 0 ? id : null)
  }

  function handleTimeRangeChange(val: SelectValue) {
    const newValue = String(val || '1h')
    if (newValue === 'custom') {
      // 初始化为最近1小时
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      setCustomStartTimeInput(formatDateTimeLocalInput(oneHourAgo.getTime() / 1000))
      setCustomEndTimeInput(formatDateTimeLocalInput(now.getTime() / 1000))
      setShowCustomTimeRangeDialog(true)
    } else {
      onTimeRangeChange?.(newValue)
    }
  }

  function handleCustomTimeRangeConfirm() {
    if (!customStartTimeInput || !customEndTimeInput) return
    const startTime = new Date(customStartTimeInput).toISOString()
    const endTime = new Date(customEndTimeInput).toISOString()
    // Emit custom time range first so the parent can build correct API params
    // when it reacts to timeRange switching to "custom".
    onCustomTimeRangeChange?.(startTime, endTime)
    onTimeRangeChange?.('custom')
    setShowCustomTimeRangeDialog(false)
  }

  function handleCustomTimeRangeCancel() {
    setShowCustomTimeRangeDialog(false)
    // 如果当前不是 custom，不需要做任何事
    // 如果当前是 custom，保持不变
  }

  function openDetails(preset?: OpsRequestDetailsPreset) {
    onOpenRequestDetails?.(preset)
  }

  function openErrorDetails(kind: 'request' | 'upstream') {
    onOpenErrorDetails?.(kind)
  }

  function getSLAThresholdLevel(slaPercent: number | null): ThresholdLevel {
    if (slaPercent == null) return 'normal'
    const threshold = thresholds?.sla_percent_min
    if (threshold == null) return 'normal'

    // SLA is "higher is better":
    // - below threshold => critical
    // - within +0.1% buffer => warning
    const warningBuffer = 0.1

    if (slaPercent < threshold) return 'critical'
    if (slaPercent < threshold + warningBuffer) return 'warning'
    return 'normal'
  }

  function getTTFTThresholdLevel(ttftMs: number | null): ThresholdLevel {
    if (ttftMs == null) return 'normal'
    const threshold = thresholds?.ttft_p99_ms_max
    if (threshold == null) return 'normal'
    if (ttftMs >= threshold) return 'critical'
    if (ttftMs >= threshold * 0.8) return 'warning'
    return 'normal'
  }

  function getRequestErrorRateThresholdLevel(errorRatePercent: number | null): ThresholdLevel {
    if (errorRatePercent == null) return 'normal'
    const threshold = thresholds?.request_error_rate_percent_max
    if (threshold == null) return 'normal'
    if (errorRatePercent >= threshold) return 'critical'
    if (errorRatePercent >= threshold * 0.8) return 'warning'
    return 'normal'
  }

  function getUpstreamErrorRateThresholdLevel(upstreamErrorRatePercent: number | null): ThresholdLevel {
    if (upstreamErrorRatePercent == null) return 'normal'
    const threshold = thresholds?.upstream_error_rate_percent_max
    if (threshold == null) return 'normal'
    if (upstreamErrorRatePercent >= threshold) return 'critical'
    if (upstreamErrorRatePercent >= threshold * 0.8) return 'warning'
    return 'normal'
  }

  // --- Realtime / Overview labels ---

  const totalRequestsLabel = formatNumber(overview?.request_count_total ?? 0)
  const totalTokensLabel = formatNumber(overview?.token_consumed ?? 0)

  const [realtimeTrafficSummary, setRealtimeTrafficSummary] = useState<OpsRealtimeTrafficSummary | null>(null)
  const realtimeTrafficLoadingRef = useRef(false)

  function makeZeroRealtimeTrafficSummary(): OpsRealtimeTrafficSummary {
    const now = new Date().toISOString()
    const latest = latestRef.current
    return {
      window: latest.realtimeWindow,
      start_time: now,
      end_time: now,
      platform: latest.platform,
      group_id: latest.groupId,
      qps: { current: 0, peak: 0, avg: 0 },
      tps: { current: 0, peak: 0, avg: 0 }
    }
  }

  // windowOverride：Vue 中先同步把窗口重置为 1min 再加载，React 的 setState 非同步，故显式传入。
  async function loadRealtimeTrafficSummary(windowOverride?: RealtimeWindow) {
    if (realtimeTrafficLoadingRef.current) return
    if (!useAdminSettingsStore.getState().opsRealtimeMonitoringEnabled) {
      setRealtimeTrafficSummary(makeZeroRealtimeTrafficSummary())
      return
    }
    realtimeTrafficLoadingRef.current = true
    const latest = latestRef.current
    try {
      const res = await opsAPI.getRealtimeTrafficSummary(windowOverride ?? latest.realtimeWindow, latest.platform, latest.groupId)
      if (res && res.enabled === false) {
        useAdminSettingsStore.getState().setOpsRealtimeMonitoringEnabledLocal(false)
      }
      setRealtimeTrafficSummary(res?.summary ?? null)
    } catch (err) {
      console.error('[OpsDashboardHeader] Failed to load realtime traffic summary', err)
      setRealtimeTrafficSummary(null)
    } finally {
      realtimeTrafficLoadingRef.current = false
    }
  }
  function resetRealtimeTrafficSummary() {
    setRealtimeTrafficSummary(makeZeroRealtimeTrafficSummary())
  }
  const loadRef = useRef(loadRealtimeTrafficSummary)
  const resetRef = useRef(resetRealtimeTrafficSummary)
  useEffect(() => {
    loadRef.current = loadRealtimeTrafficSummary
    resetRef.current = resetRealtimeTrafficSummary
  })

  // The realtime window must be inside the toolbar window; reset to keep UX predictable.
  const prevTimeRangeRef = useRef(timeRange)
  useEffect(() => {
    if (prevTimeRangeRef.current === timeRange) return
    prevTimeRangeRef.current = timeRange
    setRealtimeWindow('1min')
    // Keep realtime traffic consistent with toolbar changes even when the window is already 1min.
    void loadRef.current('1min')
  }, [timeRange])

  // Vue: watch([realtimeWindow, platform, groupId], { immediate: true })
  useEffect(() => {
    void loadRef.current()
  }, [realtimeWindow, platform, groupId])

  // Vue: watch(opsRealtimeMonitoringEnabled, { immediate: true })
  useEffect(() => {
    if (!opsRealtimeMonitoringEnabled) {
      // Keep UI stable when realtime monitoring is turned off.
      resetRef.current()
    } else {
      void loadRef.current()
    }
  }, [opsRealtimeMonitoringEnabled])

  // Realtime traffic refresh follows the parent (OpsDashboard) refresh cadence.
  const prevCadenceRef = useRef<readonly [boolean | undefined, number | undefined, boolean] | null>(null)
  useEffect(() => {
    const prev = prevCadenceRef.current
    prevCadenceRef.current = [autoRefreshEnabled, autoRefreshCountdown, loading]
    // Vue watch 非 immediate：首次挂载不触发
    if (!prev) return
    if (prev[0] === autoRefreshEnabled && prev[1] === autoRefreshCountdown && prev[2] === loading) return
    if (!autoRefreshEnabled) return
    if (loading) return
    // Treat countdown reset (or reaching 0) as a refresh boundary.
    if (autoRefreshCountdown === 0) {
      void loadRef.current()
    }
  }, [autoRefreshEnabled, autoRefreshCountdown, loading])

  // no-op: parent controls refresh cadence

  const displayRealTimeQps = finiteOrNull(realtimeTrafficSummary?.qps?.current) ?? 0
  const displayRealTimeTps = finiteOrNull(realtimeTrafficSummary?.tps?.current) ?? 0
  const realtimeQpsPeakLabel = fixed1(realtimeTrafficSummary?.qps?.peak)
  const realtimeTpsPeakLabel = fixed1(realtimeTrafficSummary?.tps?.peak)
  const realtimeQpsAvgLabel = fixed1(realtimeTrafficSummary?.qps?.avg)
  const realtimeTpsAvgLabel = fixed1(realtimeTrafficSummary?.tps?.avg)

  const qpsAvgLabel = typeof overview?.qps?.avg === 'number' ? overview.qps.avg.toFixed(1) : '-'
  const tpsAvgLabel = typeof overview?.tps?.avg === 'number' ? overview.tps.avg.toFixed(1) : '-'

  const slaPercent = (() => {
    const v = overview?.sla
    if (typeof v !== 'number') return null
    if ((overview?.request_count_sla ?? 0) <= 0) return null
    return v * 100
  })()

  const errorRatePercent = typeof overview?.error_rate === 'number' ? overview.error_rate * 100 : null
  const upstreamErrorRatePercent = typeof overview?.upstream_error_rate === 'number' ? overview.upstream_error_rate * 100 : null

  const durationP99Ms = overview?.duration?.p99_ms ?? null
  const durationP95Ms = overview?.duration?.p95_ms ?? null
  const durationP90Ms = overview?.duration?.p90_ms ?? null
  const durationP50Ms = overview?.duration?.p50_ms ?? null
  const durationAvgMs = overview?.duration?.avg_ms ?? null
  const durationMaxMs = overview?.duration?.max_ms ?? null

  const ttftP99Ms = overview?.ttft?.p99_ms ?? null
  const ttftP95Ms = overview?.ttft?.p95_ms ?? null
  const ttftP90Ms = overview?.ttft?.p90_ms ?? null
  const ttftP50Ms = overview?.ttft?.p50_ms ?? null
  const ttftAvgMs = overview?.ttft?.avg_ms ?? null
  const ttftMaxMs = overview?.ttft?.max_ms ?? null

  // --- Health Score & Diagnosis (primary) ---

  const isSystemIdle = (() => {
    const ov = overview
    if (!ov) return true
    const qps = ov.qps?.current
    const errorRate = ov.error_rate ?? 0
    return (qps ?? 0) === 0 && errorRate === 0
  })()

  const healthScoreValue = finiteOrNull(overview?.health_score)

  const healthTone: Tone = (() => {
    if (isSystemIdle) return 'neutral'
    const score = healthScoreValue
    if (score == null) return 'neutral'
    if (score >= 90) return 'success'
    if (score >= 60) return 'warning'
    return 'danger'
  })()

  const circleSize = fullscreen ? 140 : 100
  const strokeWidth = fullscreen ? 10 : 8
  const radius = (circleSize - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = (() => {
    if (isSystemIdle) return 0
    if (healthScoreValue == null) return 0
    const score = Math.max(0, Math.min(100, healthScoreValue))
    return circumference - (score / 100) * circumference
  })()

  interface DiagnosisItem {
    type: 'critical' | 'warning' | 'info'
    message: string
    impact: string
    action?: string
  }

  const diagnosisReport: DiagnosisItem[] = (() => {
    const ov = overview
    if (!ov) return []

    const report: DiagnosisItem[] = []

    if (isSystemIdle) {
      report.push({
        type: 'info',
        message: t('admin.ops.diagnosis.idle'),
        impact: t('admin.ops.diagnosis.idleImpact')
      })
      return report
    }

    // Resource diagnostics (highest priority)
    const sm = ov.system_metrics
    if (sm) {
      if (sm.db_ok === false) {
        report.push({
          type: 'critical',
          message: t('admin.ops.diagnosis.dbDown'),
          impact: t('admin.ops.diagnosis.dbDownImpact'),
          action: t('admin.ops.diagnosis.dbDownAction')
        })
      }
      if (sm.redis_ok === false) {
        report.push({
          type: 'warning',
          message: t('admin.ops.diagnosis.redisDown'),
          impact: t('admin.ops.diagnosis.redisDownImpact'),
          action: t('admin.ops.diagnosis.redisDownAction')
        })
      }

      const cpuPct = sm.cpu_usage_percent ?? 0
      if (cpuPct > 90) {
        report.push({
          type: 'critical',
          message: t('admin.ops.diagnosis.cpuCritical', { usage: cpuPct.toFixed(1) }),
          impact: t('admin.ops.diagnosis.cpuCriticalImpact'),
          action: t('admin.ops.diagnosis.cpuCriticalAction')
        })
      } else if (cpuPct > 80) {
        report.push({
          type: 'warning',
          message: t('admin.ops.diagnosis.cpuHigh', { usage: cpuPct.toFixed(1) }),
          impact: t('admin.ops.diagnosis.cpuHighImpact'),
          action: t('admin.ops.diagnosis.cpuHighAction')
        })
      }

      const memPct = sm.memory_usage_percent ?? 0
      if (memPct > 90) {
        report.push({
          type: 'critical',
          message: t('admin.ops.diagnosis.memoryCritical', { usage: memPct.toFixed(1) }),
          impact: t('admin.ops.diagnosis.memoryCriticalImpact'),
          action: t('admin.ops.diagnosis.memoryCriticalAction')
        })
      } else if (memPct > 85) {
        report.push({
          type: 'warning',
          message: t('admin.ops.diagnosis.memoryHigh', { usage: memPct.toFixed(1) }),
          impact: t('admin.ops.diagnosis.memoryHighImpact'),
          action: t('admin.ops.diagnosis.memoryHighAction')
        })
      }
    }

    const ttftP99 = ov.ttft?.p99_ms ?? 0
    if (ttftP99 > 500) {
      report.push({
        type: 'warning',
        message: t('admin.ops.diagnosis.ttftHigh', { ttft: ttftP99.toFixed(0) }),
        impact: t('admin.ops.diagnosis.ttftHighImpact'),
        action: t('admin.ops.diagnosis.ttftHighAction')
      })
    }

    // Error rate diagnostics (adjusted thresholds)
    const upstreamRatePct = (ov.upstream_error_rate ?? 0) * 100
    if (upstreamRatePct > 5) {
      report.push({
        type: 'critical',
        message: t('admin.ops.diagnosis.upstreamCritical', { rate: upstreamRatePct.toFixed(2) }),
        impact: t('admin.ops.diagnosis.upstreamCriticalImpact'),
        action: t('admin.ops.diagnosis.upstreamCriticalAction')
      })
    } else if (upstreamRatePct > 2) {
      report.push({
        type: 'warning',
        message: t('admin.ops.diagnosis.upstreamHigh', { rate: upstreamRatePct.toFixed(2) }),
        impact: t('admin.ops.diagnosis.upstreamHighImpact'),
        action: t('admin.ops.diagnosis.upstreamHighAction')
      })
    }

    const errorPct = (ov.error_rate ?? 0) * 100
    if (errorPct > 3) {
      report.push({
        type: 'critical',
        message: t('admin.ops.diagnosis.errorHigh', { rate: errorPct.toFixed(2) }),
        impact: t('admin.ops.diagnosis.errorHighImpact'),
        action: t('admin.ops.diagnosis.errorHighAction')
      })
    } else if (errorPct > 0.5) {
      report.push({
        type: 'warning',
        message: t('admin.ops.diagnosis.errorElevated', { rate: errorPct.toFixed(2) }),
        impact: t('admin.ops.diagnosis.errorElevatedImpact'),
        action: t('admin.ops.diagnosis.errorElevatedAction')
      })
    }

    // SLA diagnostics
    const slaPct = (ov.sla ?? 0) * 100
    if (slaPct < 90) {
      report.push({
        type: 'critical',
        message: t('admin.ops.diagnosis.slaCritical', { sla: slaPct.toFixed(2) }),
        impact: t('admin.ops.diagnosis.slaCriticalImpact'),
        action: t('admin.ops.diagnosis.slaCriticalAction')
      })
    } else if (slaPct < 98) {
      report.push({
        type: 'warning',
        message: t('admin.ops.diagnosis.slaLow', { sla: slaPct.toFixed(2) }),
        impact: t('admin.ops.diagnosis.slaLowImpact'),
        action: t('admin.ops.diagnosis.slaLowAction')
      })
    }

    // Health score diagnostics (lowest priority)
    if (healthScoreValue != null) {
      if (healthScoreValue < 60) {
        report.push({
          type: 'critical',
          message: t('admin.ops.diagnosis.healthCritical', { score: healthScoreValue }),
          impact: t('admin.ops.diagnosis.healthCriticalImpact'),
          action: t('admin.ops.diagnosis.healthCriticalAction')
        })
      } else if (healthScoreValue < 90) {
        report.push({
          type: 'warning',
          message: t('admin.ops.diagnosis.healthLow', { score: healthScoreValue }),
          impact: t('admin.ops.diagnosis.healthLowImpact'),
          action: t('admin.ops.diagnosis.healthLowAction')
        })
      }
    }

    if (report.length === 0) {
      report.push({
        type: 'info',
        message: t('admin.ops.diagnosis.healthy'),
        impact: t('admin.ops.diagnosis.healthyImpact')
      })
    }

    return report
  })()

  // --- System health (secondary) ---

  const cpuPercentValue = finiteOrNull(systemMetrics?.cpu_usage_percent)
  const cpuTone: Tone = cpuPercentValue == null ? 'neutral' : cpuPercentValue >= 95 ? 'danger' : cpuPercentValue >= 80 ? 'warning' : 'success'

  const memPercentValue = finiteOrNull(systemMetrics?.memory_usage_percent)
  const memTone: Tone = memPercentValue == null ? 'neutral' : memPercentValue >= 95 ? 'danger' : memPercentValue >= 85 ? 'warning' : 'success'

  const dbConnActiveValue = finiteOrNull(systemMetrics?.db_conn_active)
  const dbConnIdleValue = finiteOrNull(systemMetrics?.db_conn_idle)
  const dbConnWaitingValue = finiteOrNull(systemMetrics?.db_conn_waiting)
  const dbConnOpenValue = dbConnActiveValue == null || dbConnIdleValue == null ? null : dbConnActiveValue + dbConnIdleValue
  const dbMaxOpenConnsValue = finiteOrNull(systemMetrics?.db_max_open_conns)
  const dbUsagePercent =
    dbConnOpenValue == null || dbMaxOpenConnsValue == null || dbMaxOpenConnsValue <= 0
      ? null
      : Math.min(100, Math.max(0, (dbConnOpenValue / dbMaxOpenConnsValue) * 100))

  const dbMiddleLabel = (() => {
    if (systemMetrics?.db_ok === false) return 'FAIL'
    if (dbUsagePercent != null) return `${dbUsagePercent.toFixed(0)}%`
    if (systemMetrics?.db_ok === true) return t('admin.ops.ok')
    return t('admin.ops.noData')
  })()

  const dbTone: Tone = (() => {
    if (systemMetrics?.db_ok === false) return 'danger'
    if (dbUsagePercent != null) {
      if (dbUsagePercent >= 90) return 'danger'
      if (dbUsagePercent >= 70) return 'warning'
      return 'success'
    }
    if (systemMetrics?.db_ok === true) return 'success'
    return 'neutral'
  })()

  const redisConnTotalValue = finiteOrNull(systemMetrics?.redis_conn_total)
  const redisConnIdleValue = finiteOrNull(systemMetrics?.redis_conn_idle)
  const redisConnActiveValue =
    redisConnTotalValue == null || redisConnIdleValue == null ? null : Math.max(redisConnTotalValue - redisConnIdleValue, 0)
  const redisPoolSizeValue = finiteOrNull(systemMetrics?.redis_pool_size)
  const redisUsagePercent =
    redisConnTotalValue == null || redisPoolSizeValue == null || redisPoolSizeValue <= 0
      ? null
      : Math.min(100, Math.max(0, (redisConnTotalValue / redisPoolSizeValue) * 100))

  const redisMiddleLabel = (() => {
    if (systemMetrics?.redis_ok === false) return 'FAIL'
    if (redisUsagePercent != null) return `${redisUsagePercent.toFixed(0)}%`
    if (systemMetrics?.redis_ok === true) return t('admin.ops.ok')
    return t('admin.ops.noData')
  })()

  const redisTone: Tone = (() => {
    if (systemMetrics?.redis_ok === false) return 'danger'
    if (redisUsagePercent != null) {
      if (redisUsagePercent >= 90) return 'danger'
      if (redisUsagePercent >= 70) return 'warning'
      return 'success'
    }
    if (systemMetrics?.redis_ok === true) return 'success'
    return 'neutral'
  })()

  const goroutineCountValue = finiteOrNull(systemMetrics?.goroutine_count)
  const goroutineStatus: 'ok' | 'warning' | 'critical' | 'unknown' =
    goroutineCountValue == null
      ? 'unknown'
      : goroutineCountValue >= goroutinesCriticalThreshold
        ? 'critical'
        : goroutineCountValue >= goroutinesWarnThreshold
          ? 'warning'
          : 'ok'
  const goroutineStatusLabel =
    goroutineStatus === 'ok'
      ? t('admin.ops.ok')
      : goroutineStatus === 'warning'
        ? t('common.warning')
        : goroutineStatus === 'critical'
          ? t('common.critical')
          : t('admin.ops.noData')
  const goroutineTone: Tone =
    goroutineStatus === 'ok' ? 'success' : goroutineStatus === 'warning' ? 'warning' : goroutineStatus === 'critical' ? 'danger' : 'neutral'

  const jobHeartbeats = overview?.job_heartbeats ?? []
  const isJobWarn = (hb: (typeof jobHeartbeats)[number]) =>
    !!hb && !!hb.last_error_at && (!hb.last_success_at || hb.last_error_at > hb.last_success_at)
  const jobsWarnCount = jobHeartbeats.filter(isJobWarn).length
  const jobsStatus: 'ok' | 'warn' | 'unknown' = !jobHeartbeats.length ? 'unknown' : jobsWarnCount > 0 ? 'warn' : 'ok'
  const jobsStatusLabel = jobsStatus === 'ok' ? t('admin.ops.ok') : jobsStatus === 'warn' ? t('common.warning') : t('admin.ops.noData')
  const jobsTone: Tone = jobsStatus === 'ok' ? 'success' : jobsStatus === 'warn' ? 'warning' : 'neutral'

  const [showJobsDetails, setShowJobsDetails] = useState(false)

  function handleToolbarRefresh() {
    void loadRealtimeTrafficSummary()
    onRefresh?.()
  }

  const lastUpdatedLabel = lastUpdated
    ? lastUpdated
        .toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .replace(/\//g, '-')
    : t('common.unknown')

  const slaTone = thresholdTone(getSLAThresholdLevel(slaPercent))
  const ttftTone = (v: number | null) => thresholdTone(getTTFTThresholdLevel(v))

  const tip = (content: string) => (fullscreen ? null : <HelpTooltip content={content} />)
  const detailsButton = (onClick: () => void) =>
    fullscreen ? null : (
      <button type="button" className={panel.linkButton} onClick={onClick}>
        {t('admin.ops.requestDetails.details')}
      </button>
    )

  const tileHeader = (label: string, tooltip: string | null, action: (() => void) | null, extra?: ReactNode) => (
    <div className={styles.tileHeader}>
      <span className={styles.tileLabel}>
        {label}
        {tooltip ? tip(tooltip) : null}
        {extra}
      </span>
      {action ? detailsButton(action) : null}
    </div>
  )

  const percentileRow = (label: string, value: number | null, unit: string, tone?: Tone) => (
    <div className={styles.percentile} key={label}>
      <span className={styles.statLabel}>{label}:</span>
      <span className={styles.statValue} data-tone={tone}>{value ?? '-'}</span>
      <span className={styles.unit}>{unit}</span>
    </div>
  )

  const statRow = (label: string, value: string | number) => (
    <div className={styles.statRow}>
      <span className={styles.statLabel}>{label}:</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  )

  return (
    <div className={styles.root} data-fullscreen={fullscreen || undefined}>
      {/* Top Toolbar */}
      <div className={styles.toolbar}>
        {!fullscreen && (
          <div className={styles.status}>
            <span className={styles.statusItem} title={loading ? t('admin.ops.loadingText') : t('admin.ops.ready')}>
              <span className={styles.statusDot} data-loading={loading || undefined} aria-hidden="true" />
              {loading ? t('admin.ops.loadingText') : t('admin.ops.ready')}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t('common.refresh')}: {lastUpdatedLabel}
            </span>
            {autoRefreshEnabled && autoRefreshCountdown !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <span>{t('admin.ops.autoRefreshRemaining', { seconds: autoRefreshCountdown })}</span>
              </>
            )}
          </div>
        )}

        <div className={styles.controls}>
          {!fullscreen && (
            <>
              <Select value={platform} options={platformOptions} className={styles.platformSelect} onChange={handlePlatformChange} />
              <Select value={groupId} options={groupOptions} className={styles.groupSelect} onChange={handleGroupChange} />
              <Select value={timeRange} options={timeRangeOptions} className={styles.timeSelect} onChange={handleTimeRangeChange} />
            </>
          )}

          {!fullscreen && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loading}
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
              onClick={handleToolbarRefresh}
            >
              <RefreshCw size={16} className={loading ? styles.spin : undefined} aria-hidden="true" />
            </Button>
          )}

          {/* Alert Rules Button (hidden in fullscreen) */}
          {!fullscreen && (
            <Button type="button" variant="secondary" size="sm" title={t('admin.ops.alertRules.title')} onClick={() => onOpenAlertRules?.()}>
              <Bell size={16} aria-hidden="true" />
              <span className={styles.buttonLabel}>{t('admin.ops.alertRules.manage')}</span>
            </Button>
          )}

          {/* Settings Button (hidden in fullscreen) */}
          {!fullscreen && (
            <Button type="button" variant="secondary" size="sm" title={t('admin.ops.settings.title')} onClick={() => onOpenSettings?.()}>
              <Settings size={16} aria-hidden="true" />
              <span className={styles.buttonLabel}>{t('common.settings')}</span>
            </Button>
          )}

          {/* Enter Fullscreen Button (hidden in fullscreen mode) */}
          {!fullscreen && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              title={t('admin.ops.fullscreen.enter')}
              aria-label={t('admin.ops.fullscreen.enter')}
              onClick={() => onEnterFullscreen?.()}
            >
              <Maximize2 size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {overview && (
        <>
          {/* KPI row */}
          <div className={styles.kpis}>
            <MetricCard
              label={t('admin.ops.requests')}
              value={overview.request_count_total ?? 0}
              context={`${t('admin.ops.tokens')}: ${totalTokensLabel}`}
            />
            <MetricCard
              label={t('admin.ops.exceptions')}
              value={(overview.request_count_sla ?? 0) - (overview.success_count ?? 0)}
              context={`${t('admin.ops.sla')}: ${slaPercent == null ? '-' : `${slaPercent.toFixed(3)}%`}`}
            />
            <MetricCard
              label={t('admin.ops.errorCount')}
              value={overview.error_count_sla ?? 0}
              context={`${t('admin.ops.businessLimited')}: ${formatNumber(overview.business_limited_count ?? 0)}`}
            />
            <MetricCard
              label={t('admin.ops.errorCountExcl429529')}
              value={overview.upstream_error_count_excl_429_529 ?? 0}
              context={`429/529: ${formatNumber((overview.upstream_429_count ?? 0) + (overview.upstream_529_count ?? 0))}`}
            />
          </div>

          <div className={styles.primaryGrid}>
            {/* 1) Health Score */}
            <section className={panel.panel} aria-labelledby="ops-health-title">
              <div className={panel.header}>
                <h2 id="ops-health-title" className={panel.title}>
                  {t('admin.ops.healthCondition')}
                  {tip(t('admin.ops.healthHelp'))}
                </h2>
              </div>
              <div className={styles.health}>
                <div className={styles.ring}>
                  <svg width={circleSize} height={circleSize} className={styles.ringSvg} aria-hidden="true">
                    <circle cx={circleSize / 2} cy={circleSize / 2} r={radius} strokeWidth={strokeWidth} fill="transparent" className={styles.ringTrack} />
                    <circle
                      cx={circleSize / 2}
                      cy={circleSize / 2}
                      r={radius}
                      strokeWidth={strokeWidth}
                      fill="transparent"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      className={styles.ringValue}
                      data-tone={healthTone}
                    />
                  </svg>
                  <div className={styles.ringCenter}>
                    <span className={styles.healthScore} data-tone={healthTone}>
                      {isSystemIdle ? t('admin.ops.idleStatus') : (overview.health_score ?? '--')}
                    </span>
                    <span className={styles.ringLabel}>{t('admin.ops.health')}</span>
                  </div>
                </div>
                {!fullscreen && (
                  <div className={styles.healthStatus} data-tone={healthTone}>
                    {isSystemIdle
                      ? t('admin.ops.idleStatus')
                      : typeof overview.health_score === 'number' && overview.health_score >= 90
                        ? t('admin.ops.healthyStatus')
                        : t('admin.ops.riskyStatus')}
                  </div>
                )}
              </div>
            </section>

            {/* 2) Realtime Traffic */}
            <section className={panel.panel} aria-labelledby="ops-realtime-title">
              <div className={panel.header}>
                <h2 id="ops-realtime-title" className={panel.title}>
                  <span className={styles.liveDot} aria-hidden="true" />
                  {t('admin.ops.realtime.title')}
                  {tip(t('admin.ops.tooltips.qps'))}
                </h2>
                {/* Time Window Selector */}
                <SegmentedControl
                  label={t('admin.ops.realtime.title')}
                  options={availableRealtimeWindows.map((w) => ({ value: w, label: w }))}
                  value={realtimeWindow}
                  onValueChange={(v) => setRealtimeWindow(v as RealtimeWindow)}
                />
              </div>
              <div className={styles.realtime}>
                {/* Row 1: Current */}
                <div>
                  <div className={styles.realtimeLabel}>{t('admin.ops.current')}</div>
                  <div className={styles.currentRow}>
                    <span className={styles.bigValue}>
                      {displayRealTimeQps.toFixed(1)}
                      <span className={styles.bigUnit}>QPS</span>
                    </span>
                    <span className={styles.bigValue}>
                      {displayRealTimeTps.toFixed(1)}
                      <span className={styles.bigUnit}>{t('admin.ops.tps')}</span>
                    </span>
                  </div>
                </div>
                {/* Row 2: Peak + Average */}
                <div className={styles.peakAvg}>
                  <div>
                    <div className={styles.realtimeLabel}>{t('admin.ops.peak')}</div>
                    <div className={styles.pair}>
                      <span><strong className={styles.pairValue}>{realtimeQpsPeakLabel}</strong> <span className={styles.unit}>QPS</span></span>
                      <span><strong className={styles.pairValue}>{realtimeTpsPeakLabel}</strong> <span className={styles.unit}>{t('admin.ops.tps')}</span></span>
                    </div>
                  </div>
                  <div>
                    <div className={styles.realtimeLabel}>{t('admin.ops.average')}</div>
                    <div className={styles.pair}>
                      <span><strong className={styles.pairValue}>{realtimeQpsAvgLabel}</strong> <span className={styles.unit}>QPS</span></span>
                      <span><strong className={styles.pairValue}>{realtimeTpsAvgLabel}</strong> <span className={styles.unit}>{t('admin.ops.tps')}</span></span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Diagnosis（Vue 版为悬停健康分时的浮层，React 版直接展示） */}
            <section className={panel.panel} aria-labelledby="ops-diagnosis-title">
              <div className={panel.header}>
                <h2 id="ops-diagnosis-title" className={panel.title}>{t('admin.ops.diagnosis.title')}</h2>
              </div>
              <ul className={styles.diagnosis}>
                {diagnosisReport.map((item, idx) => (
                  <li key={idx} className={styles.diagnosisItem}>
                    <span className={styles.diagnosisIcon} data-type={item.type} aria-hidden="true">
                      {item.type === 'critical' ? <XCircle size={16} /> : item.type === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />}
                    </span>
                    <div className={styles.diagnosisBody}>
                      <div className={styles.diagnosisMessage}>{item.message}</div>
                      <div className={styles.diagnosisImpact}>{item.impact}</div>
                      {item.action && (
                        <div className={styles.diagnosisAction}>
                          <Lightbulb size={12} aria-hidden="true" />
                          {item.action}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className={panel.caption}>{t('admin.ops.diagnosis.footer')}</div>
            </section>
          </div>

          {/* Overview metrics */}
          <section className={panel.panel} aria-labelledby="ops-overview-title">
            <div className={panel.header}>
              <h2 id="ops-overview-title" className={panel.title}>{t('admin.ops.overview')}</h2>
            </div>
            <div className={styles.tiles}>
              {/* Card 1: Requests */}
              <div className={styles.tile}>
                {tileHeader(t('admin.ops.requestsTitle'), t('admin.ops.tooltips.totalRequests'), () =>
                  openDetails({ title: t('admin.ops.requestDetails.title') })
                )}
                <div className={styles.stats}>
                  {statRow(t('admin.ops.requests'), totalRequestsLabel)}
                  {statRow(t('admin.ops.tokens'), totalTokensLabel)}
                  {statRow(t('admin.ops.avgQps'), qpsAvgLabel)}
                  {statRow(t('admin.ops.avgTps'), tpsAvgLabel)}
                </div>
              </div>

              {/* Card 2: SLA */}
              <div className={styles.tile}>
                {tileHeader(
                  t('admin.ops.sla'),
                  t('admin.ops.tooltips.sla'),
                  () => openDetails({ title: t('admin.ops.requestDetails.title'), kind: 'error' }),
                  <span className={styles.toneDot} data-tone={slaTone} aria-hidden="true" />
                )}
                <div className={styles.tileValue} data-tone={slaTone}>
                  {slaPercent == null ? '-' : `${slaPercent.toFixed(3)}%`}
                </div>
                <div className={styles.bar}>
                  <div className={styles.barFill} data-tone={slaTone} style={{ width: `${Math.max((slaPercent ?? 0) - 90, 0) * 10}%` }} />
                </div>
                <div className={styles.stats}>
                  {statRow(t('admin.ops.exceptions'), formatNumber((overview.request_count_sla ?? 0) - (overview.success_count ?? 0)))}
                </div>
              </div>

              {/* Card 3: Request Errors */}
              <div className={styles.tile}>
                {tileHeader(t('admin.ops.requestErrors'), t('admin.ops.tooltips.errors'), () => openErrorDetails('request'))}
                <div className={styles.tileValue} data-tone={thresholdTone(getRequestErrorRateThresholdLevel(errorRatePercent))}>
                  {errorRatePercent == null ? '-' : `${errorRatePercent.toFixed(2)}%`}
                </div>
                <div className={styles.stats}>
                  {statRow(t('admin.ops.errorCount'), formatNumber(overview.error_count_sla ?? 0))}
                  {statRow(t('admin.ops.businessLimited'), formatNumber(overview.business_limited_count ?? 0))}
                </div>
              </div>

              {/* Card 4: Request Duration */}
              <div className={styles.tile}>
                {tileHeader(t('admin.ops.latencyDuration'), t('admin.ops.tooltips.latency'), () =>
                  openDetails({ title: t('admin.ops.latencyDuration'), sort: 'duration_desc' })
                )}
                <div className={styles.tileValueRow}>
                  <span className={styles.tileValue}>{durationP99Ms ?? '-'}</span>
                  <span className={styles.unit}>ms (P99)</span>
                </div>
                <div className={styles.percentiles}>
                  {percentileRow('P95', durationP95Ms, 'ms')}
                  {percentileRow('P90', durationP90Ms, 'ms')}
                  {percentileRow('P50', durationP50Ms, 'ms')}
                  {percentileRow('Avg', durationAvgMs, 'ms')}
                  {percentileRow('Max', durationMaxMs, 'ms')}
                </div>
              </div>

              {/* Card 5: TTFT */}
              <div className={styles.tile}>
                {tileHeader('TTFT', t('admin.ops.tooltips.ttft'), () =>
                  openDetails({ title: t('admin.ops.ttftLabel'), kind: 'success', sort: 'ttft_desc' })
                )}
                <div className={styles.tileValueRow}>
                  <span className={styles.tileValue} data-tone={ttftTone(ttftP99Ms)}>{ttftP99Ms ?? '-'}</span>
                  <span className={styles.unit}>ms (P99)</span>
                </div>
                <div className={styles.percentiles}>
                  {percentileRow('P95', ttftP95Ms, 'ms', ttftTone(ttftP95Ms))}
                  {percentileRow('P90', ttftP90Ms, 'ms', ttftTone(ttftP90Ms))}
                  {percentileRow('P50', ttftP50Ms, 'ms', ttftTone(ttftP50Ms))}
                  {percentileRow('Avg', ttftAvgMs, 'ms', ttftTone(ttftAvgMs))}
                  {percentileRow('Max', ttftMaxMs, 'ms', ttftTone(ttftMaxMs))}
                </div>
              </div>

              {/* Card 6: Upstream Errors */}
              <div className={styles.tile}>
                {tileHeader(t('admin.ops.upstreamErrors'), t('admin.ops.tooltips.upstreamErrors'), () => openErrorDetails('upstream'))}
                <div className={styles.tileValue} data-tone={thresholdTone(getUpstreamErrorRateThresholdLevel(upstreamErrorRatePercent))}>
                  {upstreamErrorRatePercent == null ? '-' : `${upstreamErrorRatePercent.toFixed(2)}%`}
                </div>
                <div className={styles.stats}>
                  {statRow(t('admin.ops.errorCountExcl429529'), formatNumber(overview.upstream_error_count_excl_429_529 ?? 0))}
                  {statRow('429/529', formatNumber((overview.upstream_429_count ?? 0) + (overview.upstream_529_count ?? 0)))}
                </div>
              </div>

              {/* Per-request output speed, separate from system throughput. */}
              <div className={styles.tile} data-testid="output-tps-card">
                {tileHeader(t('admin.ops.outputTps'), t('admin.ops.tooltips.outputTps'), null)}
                <div className={styles.tileValueRow}>
                  <span className={styles.tileValue} data-testid="output-tps-p50">{overview.output_tps?.p50?.toFixed(1) ?? '—'}</span>
                  <span className={styles.unit}>tok/s (P50)</span>
                </div>
                <div className={styles.percentiles}>
                  {(['p5', 'p10', 'avg'] as const).map((metric) => (
                    <div className={styles.percentile} key={metric}>
                      <span className={styles.statLabel}>{metric === 'avg' ? 'Avg' : metric.toUpperCase()}:</span>
                      <span className={styles.statValue} data-testid={`output-tps-${metric}`}>
                        {overview.output_tps?.[metric]?.toFixed(1) ?? '—'}
                      </span>
                      <span className={styles.unit}>tok/s</span>
                    </div>
                  ))}
                </div>
                <div className={panel.caption} data-testid="output-tps-samples">
                  {t('admin.ops.outputTpsSamples', {
                    count: overview.output_tps == null ? '—' : formatNumber(overview.output_tps.sample_count)
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Integrated: System health (cards) */}
          <section className={panel.panel} aria-labelledby="ops-system-health-title">
            <div className={panel.header}>
              <h2 id="ops-system-health-title" className={panel.title}>{t('admin.ops.systemHealth')}</h2>
            </div>
            <div className={styles.systemTiles}>
              {/* CPU */}
              <div className={styles.tile}>
                {tileHeader('CPU', t('admin.ops.tooltips.cpu'), null)}
                <div className={styles.systemValue} data-tone={cpuTone}>
                  {cpuPercentValue == null ? '-' : `${cpuPercentValue.toFixed(1)}%`}
                </div>
                {!fullscreen && (
                  <div className={styles.systemHint}>
                    {t('common.warning')} 80% · {t('common.critical')} 95%
                  </div>
                )}
              </div>

              {/* MEM */}
              <div className={styles.tile}>
                {tileHeader(t('admin.ops.memory'), t('admin.ops.tooltips.memory'), null)}
                <div className={styles.systemValue} data-tone={memTone}>
                  {memPercentValue == null ? '-' : `${memPercentValue.toFixed(1)}%`}
                </div>
                {!fullscreen && (
                  <div className={styles.systemHint}>
                    {systemMetrics?.memory_used_mb == null || systemMetrics?.memory_total_mb == null
                      ? '-'
                      : `${formatMemorySizeMB(systemMetrics.memory_used_mb)} / ${formatMemorySizeMB(systemMetrics.memory_total_mb)}`}
                  </div>
                )}
              </div>

              {/* DB */}
              <div className={styles.tile}>
                {tileHeader(t('admin.ops.db'), t('admin.ops.tooltips.db'), null)}
                <div className={styles.systemValue} data-tone={dbTone}>{dbMiddleLabel}</div>
                {!fullscreen && (
                  <div className={styles.systemHint}>
                    {t('admin.ops.conns')} {dbConnOpenValue ?? '-'} / {dbMaxOpenConnsValue ?? '-'} · {t('admin.ops.active')}{' '}
                    {dbConnActiveValue ?? '-'} · {t('admin.ops.idle')} {dbConnIdleValue ?? '-'}
                    {dbConnWaitingValue != null && (
                      <span>
                        {' '}
                        · {t('admin.ops.waiting')} {dbConnWaitingValue}{' '}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Redis */}
              <div className={styles.tile}>
                {tileHeader('Redis', t('admin.ops.tooltips.redis'), null)}
                <div className={styles.systemValue} data-tone={redisTone}>{redisMiddleLabel}</div>
                {!fullscreen && (
                  <div className={styles.systemHint}>
                    {t('admin.ops.conns')} {redisConnTotalValue ?? '-'} / {redisPoolSizeValue ?? '-'}
                    {redisConnActiveValue != null && (
                      <span>
                        {' '}
                        · {t('admin.ops.active')} {redisConnActiveValue}{' '}
                      </span>
                    )}
                    {redisConnIdleValue != null && (
                      <span>
                        {' '}
                        · {t('admin.ops.idle')} {redisConnIdleValue}{' '}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Goroutines */}
              <div className={styles.tile}>
                {tileHeader(t('admin.ops.goroutines'), t('admin.ops.tooltips.goroutines'), null)}
                <div className={styles.systemValue} data-tone={goroutineTone}>{goroutineStatusLabel}</div>
                {!fullscreen && (
                  <div className={styles.systemHint}>
                    {t('admin.ops.current')} <span className={styles.mono}>{goroutineCountValue ?? '-'}</span> · {t('common.warning')}{' '}
                    <span className={styles.mono}>{goroutinesWarnThreshold}</span> · {t('common.critical')}{' '}
                    <span className={styles.mono}>{goroutinesCriticalThreshold}</span>
                    {systemMetrics?.concurrency_queue_depth != null && (
                      <span>
                        {' '}
                        · {t('admin.ops.queue')} <span className={styles.mono}>{systemMetrics.concurrency_queue_depth}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Jobs */}
              <div className={styles.tile}>
                {tileHeader(t('admin.ops.jobs'), t('admin.ops.tooltips.jobs'), () => setShowJobsDetails(true))}
                <div className={styles.systemValue} data-tone={jobsTone}>{jobsStatusLabel}</div>
                {!fullscreen && (
                  <div className={styles.systemHint}>
                    {t('common.total')} <span className={styles.mono}>{jobHeartbeats.length}</span> · {t('common.warning')}{' '}
                    <span className={styles.mono}>{jobsWarnCount}</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      <BaseDialog show={showJobsDetails} title={t('admin.ops.jobs')} width="wide" onClose={() => setShowJobsDetails(false)}>
        {!jobHeartbeats.length ? (
          <div className={panel.muted}>{t('admin.ops.noData')}</div>
        ) : (
          <div className={styles.jobs}>
            {jobHeartbeats.map((hb) => (
              <div key={hb.job_name} className={styles.job}>
                <div className={styles.jobHeader}>
                  <div className={styles.jobName}>{hb.job_name}</div>
                  <div className={styles.jobMeta}>
                    {hb.last_duration_ms != null && <span className={styles.mono}>{hb.last_duration_ms}ms</span>}
                    <span>{formatTimeShort(hb.updated_at)}</span>
                  </div>
                </div>
                <div className={styles.jobGrid}>
                  <div>
                    {t('admin.ops.lastSuccess')} <span className={styles.mono}>{formatTimeShort(hb.last_success_at)}</span>
                  </div>
                  <div>
                    {t('admin.ops.lastError')} <span className={styles.mono}>{formatTimeShort(hb.last_error_at)}</span>
                  </div>
                  <div>
                    {t('admin.ops.result')} <span className={styles.mono}>{hb.last_result || '-'}</span>
                  </div>
                </div>
                {hb.last_error && <div className={styles.jobError}>{hb.last_error}</div>}
              </div>
            ))}
          </div>
        )}
      </BaseDialog>

      {/* Custom Time Range Dialog */}
      <BaseDialog
        show={showCustomTimeRangeDialog}
        title={t('admin.ops.timeRange.custom')}
        width="narrow"
        onClose={handleCustomTimeRangeCancel}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={handleCustomTimeRangeCancel}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleCustomTimeRangeConfirm}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className={styles.customRange}>
          <Input
            type="datetime-local"
            label={t('admin.ops.customTimeRange.startTime')}
            value={customStartTimeInput}
            onChange={setCustomStartTimeInput}
          />
          <Input
            type="datetime-local"
            label={t('admin.ops.customTimeRange.endTime')}
            value={customEndTimeInput}
            onChange={setCustomEndTimeInput}
          />
        </div>
      </BaseDialog>
    </div>
  )
}
