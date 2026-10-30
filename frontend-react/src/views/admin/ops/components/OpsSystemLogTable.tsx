import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { opsAPI, type OpsRuntimeLogConfig, type OpsSystemLog, type OpsSystemLogSinkHealth } from '@/api/admin/ops'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import DataTable, { type DataTableCellContext } from '@/components/common/DataTable'
import Input from '@/components/common/Input'
import Pagination from '@/components/common/Pagination'
import Select, { type SelectValue } from '@/components/common/Select'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useMountOnce } from '@/composables/useMountOnce'
import type { Column } from '@/components/common/types'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores'
import { extractApiErrorMessage } from '@/utils/apiError'
import LogRetentionSelect from './LogRetentionSelect'
import { logLevelTone } from './opsBadgeTones'
import panel from './OpsPanel.module.css'
import styles from './OpsSystemLogTable.module.css'

export interface OpsSystemLogTableProps {
  platformFilter?: string
  refreshToken?: number
}

type SystemLogTimeRange = '5m' | '30m' | '1h' | '6h' | '24h' | '7d' | '30d'

interface Filters {
  time_range: SystemLogTimeRange
  start_time: string
  end_time: string
  host: string
  level: string
  component: string
  request_id: string
  client_request_id: string
  user_id: string
  api_key_id: string
  account_id: string
  platform: string
  model: string
  q: string
}

const defaultFilters: Filters = {
  time_range: '1h',
  start_time: '',
  end_time: '',
  host: '',
  level: '',
  component: '',
  request_id: '',
  client_request_id: '',
  user_id: '',
  api_key_id: '',
  account_id: '',
  platform: '',
  model: '',
  q: ''
}

const defaultRuntimeConfig: OpsRuntimeLogConfig = {
  level: 'info',
  persist_access_logs: false,
  enable_sampling: false,
  sampling_initial: 100,
  sampling_thereafter: 100,
  caller: true,
  stacktrace_level: 'error',
  retention_days: 30,
  request_retention_days: 90
}

const runtimeLevelOptions = [
  { value: 'debug', label: 'debug' },
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'error', label: 'error' }
]

const stacktraceLevelOptions = [
  { value: 'none', label: 'none' },
  { value: 'error', label: 'error' },
  { value: 'fatal', label: 'fatal' }
]

const timeRangeOptions = [
  { value: '5m', label: '5m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' }
]

const formatTime = (value: string) => {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

const getExtraString = (extra: Record<string, any> | undefined, key: string) => {
  if (!extra) return ''
  const v = extra[key]
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

const formatSystemLogDetail = (row: OpsSystemLog) => {
  const parts: string[] = []
  const msg = String(row.message || '').trim()
  if (msg) parts.push(msg)

  const extra = row.extra || {}
  const statusCode = getExtraString(extra, 'status_code')
  const latencyMs = getExtraString(extra, 'latency_ms')
  const method = getExtraString(extra, 'method')
  const path = getExtraString(extra, 'path')
  const clientIP = getExtraString(extra, 'client_ip')
  const protocol = getExtraString(extra, 'protocol')

  const accessParts: string[] = []
  if (statusCode) accessParts.push(`status=${statusCode}`)
  if (latencyMs) accessParts.push(`latency_ms=${latencyMs}`)
  if (method) accessParts.push(`method=${method}`)
  if (path) accessParts.push(`path=${path}`)
  if (clientIP) accessParts.push(`ip=${clientIP}`)
  if (protocol) accessParts.push(`proto=${protocol}`)
  if (accessParts.length > 0) parts.push(accessParts.join(' '))

  const corrParts: string[] = []
  if (row.request_id) corrParts.push(`req=${row.request_id}`)
  if (row.client_request_id) corrParts.push(`client_req=${row.client_request_id}`)
  if (row.user_id != null) corrParts.push(`user=${row.user_id}`)
  if (row.api_key_id != null) corrParts.push(`key=${row.api_key_id}`)
  if (row.account_id != null) corrParts.push(`acc=${row.account_id}`)
  if (row.platform) corrParts.push(`platform=${row.platform}`)
  if (row.model) corrParts.push(`model=${row.model}`)
  if (corrParts.length > 0) parts.push(corrParts.join(' '))

  const errors = getExtraString(extra, 'errors')
  if (errors) parts.push(`errors=${errors}`)
  const err = getExtraString(extra, 'err') || getExtraString(extra, 'error')
  if (err) parts.push(`error=${err}`)

  // 用空格拼接，交给 CSS 自动换行，尽量“填满再换行”。
  return parts.join('  ')
}

const toRFC3339 = (value: string) => {
  if (!value) return undefined
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

/** 对应 Vue 的 v-model.number：能解析为数字时取数字，否则保留原始输入 */
const toModelNumber = (value: string): number => {
  const n = Number.parseFloat(value)
  return (Number.isNaN(n) ? value : n) as number
}

function pickRuntimeConfig(cfg: OpsRuntimeLogConfig): OpsRuntimeLogConfig {
  return {
    level: cfg.level,
    persist_access_logs: cfg.persist_access_logs,
    enable_sampling: cfg.enable_sampling,
    sampling_initial: cfg.sampling_initial,
    sampling_thereafter: cfg.sampling_thereafter,
    caller: cfg.caller,
    stacktrace_level: cfg.stacktrace_level,
    retention_days: cfg.retention_days,
    request_retention_days: cfg.request_retention_days ?? 90
  }
}

export default function OpsSystemLogTable({ platformFilter = '', refreshToken = 0 }: OpsSystemLogTableProps) {
  const { t } = useI18n()
  const { confirm, confirmDialog } = useConfirmDialog()

  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<OpsSystemLog[]>([])
  const [total, setTotal] = useState(0)
  const [pager, setPagerState] = useState({ page: 1, pageSize: 20 })

  const [health, setHealth] = useState<OpsSystemLogSinkHealth>({
    queue_depth: 0,
    queue_capacity: 0,
    dropped_count: 0,
    write_failed_count: 0,
    written_count: 0,
    avg_write_delay_ms: 0
  })

  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [runtimeConfigLoaded, setRuntimeConfigLoaded] = useState(false)
  const [runtimeSaving, setRuntimeSaving] = useState(false)
  const [runtimeConfig, setRuntimeConfigState] = useState<OpsRuntimeLogConfig>(defaultRuntimeConfig)

  const [filters, setFiltersState] = useState<Filters>(defaultFilters)

  // 请求读取最新值（Vue 版直接读 reactive），状态同时镜像到 ref
  const filtersRef = useRef(filters)
  const pagerRef = useRef(pager)
  const runtimeRef = useRef(runtimeConfig)
  const runtimeStatusRef = useRef({ loaded: false, loading: false })
  const platformFilterRef = useRef(platformFilter)
  const logsSeq = useRef(0)

  useEffect(() => {
    platformFilterRef.current = platformFilter
  })

  const updateFilters = useCallback((patch: Partial<Filters>) => {
    filtersRef.current = { ...filtersRef.current, ...patch }
    setFiltersState(filtersRef.current)
  }, [])

  const updatePager = useCallback((patch: Partial<typeof pager>) => {
    pagerRef.current = { ...pagerRef.current, ...patch }
    setPagerState(pagerRef.current)
  }, [])

  const setRuntimeConfig = useCallback((next: OpsRuntimeLogConfig) => {
    runtimeRef.current = next
    setRuntimeConfigState(next)
  }, [])

  const updateRuntime = (patch: Partial<OpsRuntimeLogConfig>) => setRuntimeConfig({ ...runtimeRef.current, ...patch })

  const buildQuery = () => {
    const f = filtersRef.current
    const query: Record<string, any> = {
      page: pagerRef.current.page,
      page_size: pagerRef.current.pageSize,
      time_range: f.time_range
    }

    if (f.time_range === '30d') {
      query.time_range = '30d'
    }
    if (f.start_time) query.start_time = toRFC3339(f.start_time)
    if (f.end_time) query.end_time = toRFC3339(f.end_time)
    if (f.host.trim()) query.host = f.host.trim()
    if (f.level.trim()) query.level = f.level.trim()
    if (f.component.trim()) query.component = f.component.trim()
    if (f.request_id.trim()) query.request_id = f.request_id.trim()
    if (f.client_request_id.trim()) query.client_request_id = f.client_request_id.trim()
    if (f.user_id.trim()) {
      const v = Number.parseInt(f.user_id.trim(), 10)
      if (Number.isFinite(v) && v > 0) query.user_id = v
    }
    if (f.api_key_id.trim()) {
      const v = Number.parseInt(f.api_key_id.trim(), 10)
      if (Number.isFinite(v) && v > 0) query.api_key_id = v
    }
    if (f.account_id.trim()) {
      const v = Number.parseInt(f.account_id.trim(), 10)
      if (Number.isFinite(v) && v > 0) query.account_id = v
    }
    if (f.platform.trim()) query.platform = f.platform.trim()
    if (f.model.trim()) query.model = f.model.trim()
    if (f.q.trim()) query.q = f.q.trim()
    return query
  }
  const buildQueryRef = useRef(buildQuery)
  useEffect(() => {
    buildQueryRef.current = buildQuery
  })

  const fetchLogs = useCallback(async () => {
    const seq = ++logsSeq.current
    setLoading(true)
    try {
      const res = await opsAPI.listSystemLogs(buildQueryRef.current())
      if (seq !== logsSeq.current) return
      setLogs(res.items || [])
      setTotal(res.total || 0)
    } catch (err: any) {
      if (seq !== logsSeq.current) return
      console.error('[OpsSystemLogTable] Failed to fetch logs', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.systemLogs.loadFailed'))
    } finally {
      if (seq === logsSeq.current) setLoading(false)
    }
  }, [t])

  const fetchHealth = useCallback(async () => {
    try {
      setHealth(await opsAPI.getSystemLogSinkHealth())
    } catch {
      // 忽略健康数据读取失败，不影响主流程。
    }
  }, [])

  const loadRuntimeConfig = useCallback(async () => {
    runtimeStatusRef.current = { loaded: false, loading: true }
    setRuntimeLoading(true)
    setRuntimeConfigLoaded(false)
    try {
      const cfg = await opsAPI.getRuntimeLogConfig()
      setRuntimeConfig(pickRuntimeConfig(cfg))
      runtimeStatusRef.current.loaded = true
      setRuntimeConfigLoaded(true)
    } catch (err: any) {
      console.error('[OpsSystemLogTable] Failed to load runtime log config', err)
      useAppStore.getState().showError(t('admin.ops.systemLogs.runtimeConfigLoadFailed'))
    } finally {
      runtimeStatusRef.current.loading = false
      setRuntimeLoading(false)
    }
  }, [setRuntimeConfig, t])

  const saveRuntimeConfig = async () => {
    if (!runtimeStatusRef.current.loaded || runtimeStatusRef.current.loading) return
    const cfg = runtimeRef.current
    if (!Number.isInteger(cfg.retention_days) || cfg.retention_days < 1 || cfg.retention_days > 3650 ||
        !Number.isInteger(cfg.request_retention_days) || cfg.request_retention_days < 0 || cfg.request_retention_days > 3650) {
      useAppStore.getState().showError(t('admin.ops.systemLogs.retentionDaysInvalid'))
      return
    }
    setRuntimeSaving(true)
    try {
      const saved = await opsAPI.updateRuntimeLogConfig({ ...cfg })
      setRuntimeConfig(pickRuntimeConfig(saved))
      useAppStore.getState().showSuccess(t('admin.ops.systemLogs.runtimeConfigActive'))
    } catch (err: any) {
      console.error('[OpsSystemLogTable] Failed to save runtime log config', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.systemLogs.runtimeConfigSaveFailed'))
    } finally {
      setRuntimeSaving(false)
    }
  }

  const resetRuntimeConfig = async () => {
    const ok = await confirm(t('admin.ops.systemLogs.resetRuntimeConfigConfirm'), { danger: true })
    if (!ok) return

    setRuntimeSaving(true)
    try {
      const saved = await opsAPI.resetRuntimeLogConfig()
      setRuntimeConfig(pickRuntimeConfig(saved))
      useAppStore.getState().showSuccess(t('admin.ops.systemLogs.runtimeConfigReset'))
      await fetchHealth()
    } catch (err: any) {
      console.error('[OpsSystemLogTable] Failed to reset runtime log config', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.systemLogs.runtimeConfigResetFailed'))
    } finally {
      setRuntimeSaving(false)
    }
  }

  const cleanupCurrentFilter = async () => {
    const ok = await confirm(t('admin.ops.systemLogs.cleanupConfirm'), { danger: true })
    if (!ok) return
    try {
      const f = filtersRef.current
      const payload = {
        start_time: toRFC3339(f.start_time),
        end_time: toRFC3339(f.end_time),
        host: f.host.trim() || undefined,
        level: f.level.trim() || undefined,
        component: f.component.trim() || undefined,
        request_id: f.request_id.trim() || undefined,
        client_request_id: f.client_request_id.trim() || undefined,
        user_id: f.user_id.trim() ? Number.parseInt(f.user_id.trim(), 10) : undefined,
        api_key_id: f.api_key_id.trim() ? Number.parseInt(f.api_key_id.trim(), 10) : undefined,
        account_id: f.account_id.trim() ? Number.parseInt(f.account_id.trim(), 10) : undefined,
        platform: f.platform.trim() || undefined,
        model: f.model.trim() || undefined,
        q: f.q.trim() || undefined
      }
      const res = await opsAPI.cleanupSystemLogs(payload)
      useAppStore.getState().showSuccess(t('admin.ops.systemLogs.cleanupSuccess', { count: res.deleted || 0 }))
      updatePager({ page: 1 })
      await Promise.all([fetchLogs(), fetchHealth()])
    } catch (err: any) {
      console.error('[OpsSystemLogTable] Failed to cleanup logs', err)
      useAppStore.getState().showError(
        extractApiErrorMessage(err, t('admin.ops.systemLogs.cleanupFailed'), {
          OPS_SYSTEM_LOG_CLEANUP_FILTER_REQUIRED: t('admin.ops.systemLogs.cleanupFilterRequired')
        })
      )
    }
  }

  const resetFilters = () => {
    updateFilters({ ...defaultFilters, platform: platformFilterRef.current || '' })
    updatePager({ page: 1 })
    void fetchLogs()
  }

  const applyFilters = () => {
    updatePager({ page: 1 })
    void fetchLogs()
  }

  const onPageChange = (next: number) => {
    updatePager({ page: next })
    void fetchLogs()
  }

  const onPageSizeChange = (next: number) => {
    updatePager({ pageSize: next, page: 1 })
    void fetchLogs()
  }

  // onMounted：带上平台筛选后并行加载日志、健康度与运行时配置
  useMountOnce(async () => {
    if (platformFilterRef.current) {
      updateFilters({ platform: platformFilterRef.current })
    }
    await Promise.all([fetchLogs(), fetchHealth(), loadRuntimeConfig()])
  })

  // 平台筛选变化：仅当本地平台筛选为空时跟随
  const prevPlatformFilter = useRef(platformFilter)
  useEffect(() => {
    if (prevPlatformFilter.current === platformFilter) return
    prevPlatformFilter.current = platformFilter
    if (platformFilter && !filtersRef.current.platform) {
      updateFilters({ platform: platformFilter })
      updatePager({ page: 1 })
      void fetchLogs()
    }
  }, [platformFilter, fetchLogs, updateFilters, updatePager])

  // 与仪表盘共享刷新节奏
  const prevRefreshToken = useRef(refreshToken)
  useEffect(() => {
    if (prevRefreshToken.current === refreshToken) return
    prevRefreshToken.current = refreshToken
    void fetchLogs()
    void fetchHealth()
  }, [refreshToken, fetchHealth, fetchLogs])

  const filterLevelOptions = [
    { value: '', label: t('admin.ops.systemLogs.all') },
    { value: 'debug', label: 'debug' },
    { value: 'info', label: 'info' },
    { value: 'warn', label: 'warn' },
    { value: 'error', label: 'error' }
  ]

  const columns: Column<OpsSystemLog>[] = [
    { key: 'created_at', label: t('admin.ops.systemLogs.time'), width: 170 },
    { key: 'host', label: t('admin.ops.systemLogs.host'), width: 160 },
    { key: 'level', label: t('admin.ops.systemLogs.level'), width: 80 },
    { key: 'detail', label: t('admin.ops.systemLogs.logDetails') }
  ]

  const cells: Record<string, (ctx: DataTableCellContext<OpsSystemLog>) => ReactNode> = {
    created_at: ({ row }) => <span className={styles.cellText}>{formatTime(row.created_at)}</span>,
    host: ({ row }) => (
      <span className={[styles.cellText, styles.truncate].join(' ')} title={row.host || '-'}>{row.host || '-'}</span>
    ),
    level: ({ row }) => <Badge size="sm" tone={logLevelTone(row.level)}>{row.level}</Badge>,
    detail: ({ row }) => <span className={[styles.cellText, styles.detail].join(' ')}>{formatSystemLogDetail(row)}</span>
  }

  const textFilter = (key: keyof Filters, label: string, placeholder?: string) => (
    <Input
      label={label}
      value={filters[key]}
      placeholder={placeholder}
      onChange={(value) => updateFilters({ [key]: value } as Partial<Filters>)}
    />
  )

  return (
    <section className={panel.panel}>
      <div className={panel.header}>
        <div>
          <h2 className={panel.title}>{t('admin.ops.systemLogs.title')}</h2>
          <p className={panel.subtitle}>{t('admin.ops.systemLogs.description')}</p>
        </div>
        <div className={styles.health}>
          <Badge tone="neutral">{t('admin.ops.systemLogs.queue')} {health.queue_depth}/{health.queue_capacity}</Badge>
          <Badge tone="neutral">{t('admin.ops.systemLogs.written')} {health.written_count}</Badge>
          <Badge tone="warning">{t('admin.ops.systemLogs.dropped')} {health.dropped_count}</Badge>
          <Badge tone="danger">{t('admin.ops.systemLogs.failed')} {health.write_failed_count}</Badge>
        </div>
      </div>

      <div className={styles.runtime}>
        <div className={styles.runtimeHeader}>
          <h3 className={styles.runtimeTitle}>{t('admin.ops.systemLogs.runtimeConfig')}</h3>
          {runtimeLoading && <span className={panel.muted}>{t('common.loading')}</span>}
        </div>
        <div className={styles.runtimeGrid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('admin.ops.systemLogs.level')}</span>
            <Select
              value={runtimeConfig.level}
              options={runtimeLevelOptions}
              aria-label={t('admin.ops.systemLogs.level')}
              onChange={(value: SelectValue) => updateRuntime({ level: value as OpsRuntimeLogConfig['level'] })}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('admin.ops.systemLogs.stacktraceThreshold')}</span>
            <Select
              value={runtimeConfig.stacktrace_level}
              options={stacktraceLevelOptions}
              aria-label={t('admin.ops.systemLogs.stacktraceThreshold')}
              onChange={(value: SelectValue) => updateRuntime({ stacktrace_level: value as OpsRuntimeLogConfig['stacktrace_level'] })}
            />
          </div>
          <Input
            label={t('admin.ops.systemLogs.samplingInitial')}
            type="number"
            min={1}
            value={runtimeConfig.sampling_initial}
            onChange={(value) => updateRuntime({ sampling_initial: toModelNumber(value) })}
          />
          <Input
            label={t('admin.ops.systemLogs.samplingThereafter')}
            type="number"
            min={1}
            value={runtimeConfig.sampling_thereafter}
            onChange={(value) => updateRuntime({ sampling_thereafter: toModelNumber(value) })}
          />
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('admin.ops.systemLogs.retentionDays')}</span>
            <LogRetentionSelect
              value={runtimeConfig.retention_days}
              label={t('admin.ops.systemLogs.retentionDays')}
              onChange={(value) => updateRuntime({ retention_days: value })}
            />
            <span className={styles.hint}>{t('admin.ops.systemLogs.retentionDaysHint')}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('admin.ops.systemLogs.requestRetentionDays')}</span>
            <LogRetentionSelect
              value={runtimeConfig.request_retention_days}
              label={t('admin.ops.systemLogs.requestRetentionDays')}
              allowForever
              onChange={(value) => updateRuntime({ request_retention_days: value })}
            />
            <span className={styles.hint}>{t('admin.ops.systemLogs.requestRetentionDaysHint')}</span>
          </div>
        </div>
        <div className={styles.runtimeFooter}>
          <div className={styles.checks}>
            <Checkbox
              label={t('admin.ops.systemLogs.caller')}
              checked={runtimeConfig.caller}
              onCheckedChange={(checked) => updateRuntime({ caller: checked === true })}
            />
            <Checkbox
              label={t('admin.ops.systemLogs.sampling')}
              checked={runtimeConfig.enable_sampling}
              onCheckedChange={(checked) => updateRuntime({ enable_sampling: checked === true })}
            />
            <Checkbox
              label={t('admin.ops.systemLogs.persistAccessLogs')}
              checked={runtimeConfig.persist_access_logs}
              onCheckedChange={(checked) => updateRuntime({ persist_access_logs: checked === true })}
            />
          </div>
          <div className={panel.toolbar}>
            <Button
              type="button"
              size="sm"
              disabled={runtimeSaving || runtimeLoading || !runtimeConfigLoaded}
              onClick={() => void saveRuntimeConfig()}
            >
              {runtimeSaving ? t('common.saving') : t('admin.ops.systemLogs.saveAndApply')}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={runtimeSaving} onClick={() => void resetRuntimeConfig()}>
              {t('admin.ops.systemLogs.resetDefaults')}
            </Button>
          </div>
        </div>
        <p className={styles.hint}>{t('admin.ops.systemLogs.persistAccessLogsHint')}</p>
        {health.last_error && (
          <p className={[styles.hint, panel.danger].join(' ')}>
            {t('admin.ops.systemLogs.latestWriteError')} {health.last_error}
          </p>
        )}
      </div>

      <div className={styles.filters}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('admin.ops.systemLogs.timeRange')}</span>
          <Select
            value={filters.time_range}
            options={timeRangeOptions}
            aria-label={t('admin.ops.systemLogs.timeRange')}
            onChange={(value: SelectValue) => updateFilters({ time_range: value as SystemLogTimeRange })}
          />
        </div>
        <Input
          label={t('admin.ops.systemLogs.startTime')}
          type="datetime-local"
          value={filters.start_time}
          onChange={(value) => updateFilters({ start_time: value })}
        />
        <Input
          label={t('admin.ops.systemLogs.endTime')}
          type="datetime-local"
          value={filters.end_time}
          onChange={(value) => updateFilters({ end_time: value })}
        />
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('admin.ops.systemLogs.level')}</span>
          <Select
            value={filters.level}
            options={filterLevelOptions}
            aria-label={t('admin.ops.systemLogs.level')}
            onChange={(value: SelectValue) => updateFilters({ level: String(value ?? '') })}
          />
        </div>
        {textFilter('component', t('admin.ops.systemLogs.component'), t('admin.ops.systemLogs.componentPlaceholder'))}
        {textFilter('host', t('admin.ops.systemLogs.host'))}
        {textFilter('request_id', 'request_id')}
        {textFilter('client_request_id', 'client_request_id')}
        {textFilter('user_id', 'user_id')}
        {textFilter('api_key_id', t('admin.ops.systemLogs.keyId'))}
        {textFilter('account_id', 'account_id')}
        {textFilter('platform', t('admin.ops.systemLogs.platform'))}
        {textFilter('model', t('admin.ops.systemLogs.model'))}
        {textFilter('q', t('admin.ops.systemLogs.keyword'), t('admin.ops.systemLogs.keywordPlaceholder'))}
      </div>

      <div className={panel.toolbar}>
        <Button type="button" size="sm" onClick={applyFilters}>{t('admin.ops.systemLogs.search')}</Button>
        <Button type="button" variant="secondary" size="sm" onClick={resetFilters}>{t('common.reset')}</Button>
        <Button type="button" variant="danger" size="sm" onClick={() => void cleanupCurrentFilter()}>
          {t('admin.ops.systemLogs.cleanCurrentFilters')}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => void fetchHealth()}>
          {t('admin.ops.systemLogs.refreshHealth')}
        </Button>
      </div>

      <div className={styles.tableRegion}>
        <DataTable<OpsSystemLog>
          columns={columns}
          data={logs}
          loading={loading}
          rowKey="id"
          stickyFirstColumn={false}
          cells={cells}
          empty={<div className={styles.empty}>{t('admin.ops.systemLogs.empty')}</div>}
        />
        <Pagination
          total={total}
          page={pager.page}
          pageSize={pager.pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </div>
      {confirmDialog}
    </section>
  )
}
