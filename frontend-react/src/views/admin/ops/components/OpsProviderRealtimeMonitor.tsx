import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  opsAPI,
  type AccountAvailability,
  type AccountConcurrencyInfo,
  type OpsAccountAvailabilityStatsResponse,
  type OpsConcurrencyStatsResponse
} from '@/api/admin/ops'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useI18n } from '@/i18n/useI18n'
import panel from './OpsPanel.module.css'
import styles from './OpsProviderRealtimeMonitor.module.css'

export interface OpsProviderRealtimeMonitorProps {
  platformFilter?: string
  groupIdFilter?: number | null
}

type ProviderState = 'error' | 'cooling' | 'overloaded' | 'rate_limited' | 'saturated' | 'active' | 'idle'
type Tone = 'danger' | 'warning' | 'success' | 'muted'

interface ProviderRow {
  id: number
  name: string
  platform: string
  groupName: string
  current: number
  capacity: number
  queued: number
  load: number
  state: ProviderState
  detail: string
  cooldownRemaining: number
}

const REFRESH_INTERVAL_MS = 2000
const SEGMENTS = Array.from({ length: 20 }, (_, index) => index)

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function tempCooldownRemainingSeconds(item: AccountAvailability): number {
  if (safeNumber(item.cooldown_remaining_sec) > 0) return safeNumber(item.cooldown_remaining_sec)
  if (!item.temp_unschedulable_until) return 0
  const remaining = Math.ceil((new Date(item.temp_unschedulable_until).getTime() - Date.now()) / 1000)
  return Math.max(0, remaining)
}

function stateRemainingSeconds(item: AccountAvailability): number {
  const cooldown = tempCooldownRemainingSeconds(item)
  if (cooldown > 0) return cooldown
  if (item.is_overloaded) return Math.max(0, safeNumber(item.overload_remaining_sec))
  if (item.is_rate_limited) return Math.max(0, safeNumber(item.rate_limit_remaining_sec))
  return 0
}

function resolveState(conc: Partial<AccountConcurrencyInfo>, avail: Partial<AccountAvailability>): ProviderState {
  if (avail.has_error) return 'error'
  if (tempCooldownRemainingSeconds(avail as AccountAvailability) > 0) return 'cooling'
  if (avail.is_overloaded) return 'overloaded'
  if (avail.is_rate_limited) return 'rate_limited'
  if (safeNumber(conc.load_percentage) >= 90 || safeNumber(conc.waiting_in_queue) > 0) return 'saturated'
  if (safeNumber(conc.current_in_use) > 0) return 'active'
  return 'idle'
}

function stateTone(state: ProviderState): Tone {
  if (state === 'error' || state === 'saturated') return 'danger'
  if (state === 'cooling' || state === 'overloaded' || state === 'rate_limited') return 'warning'
  if (state === 'active') return 'success'
  return 'muted'
}

function segmentTone(row: ProviderRow, index: number): Tone | 'empty' {
  const filled = index < Math.ceil(Math.min(100, row.load) / 5)
  if (!filled) return 'empty'
  if (row.load >= 90 || row.state === 'error') return 'danger'
  if (row.load >= 70 || ['cooling', 'overloaded', 'rate_limited'].includes(row.state)) return 'warning'
  return 'success'
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return ''
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.ceil(minutes / 60)}h`
}

export default function OpsProviderRealtimeMonitor({ platformFilter = '', groupIdFilter = null }: OpsProviderRealtimeMonitorProps) {
  const { t, locale } = useI18n()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [concurrency, setConcurrency] = useState<OpsConcurrencyStatsResponse | null>(null)
  const [availability, setAvailability] = useState<OpsAccountAvailabilityStatsResponse | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const requestController = useRef<AbortController | null>(null)

  const realtimeEnabled = (concurrency?.enabled ?? true) && (availability?.enabled ?? true)

  function resolveDetail(state: ProviderState, avail: Partial<AccountAvailability>, cooldownRemaining: number): string {
    if (state === 'error') return avail.error_message || t('admin.ops.providerMonitor.accountError')
    if (state === 'cooling') {
      const reason = String(avail.temp_unschedulable_reason || '').trim()
      return reason || t('admin.ops.providerMonitor.strictFallbackCooldown')
    }
    if (state === 'overloaded') return t('admin.ops.providerMonitor.overloadedDetail')
    if (state === 'rate_limited') return t('admin.ops.providerMonitor.rateLimitedDetail')
    if (state === 'saturated') return t('admin.ops.providerMonitor.saturatedDetail')
    if (state === 'active') return t('admin.ops.providerMonitor.servingDetail')
    if (cooldownRemaining > 0) return t('admin.ops.providerMonitor.cooldownDetail')
    return t('admin.ops.providerMonitor.readyDetail')
  }

  const stateRank: Record<ProviderState, number> = {
    error: 0,
    cooling: 1,
    overloaded: 2,
    rate_limited: 3,
    saturated: 4,
    active: 5,
    idle: 6
  }

  const concMap = concurrency?.account || {}
  const availMap = availability?.account || {}
  const ids = new Set([...Object.keys(concMap), ...Object.keys(availMap)])
  const allRows: ProviderRow[] = Array.from(ids)
    .map((key) => {
      const conc = concMap[key] || ({} as AccountConcurrencyInfo)
      const avail = availMap[key] || ({} as AccountAvailability)
      const cooldownRemaining = stateRemainingSeconds(avail)
      const state = resolveState(conc, avail)
      const id = safeNumber(conc.account_id || avail.account_id || Number(key))
      return {
        id,
        name: String(conc.account_name || avail.account_name || `Provider ${id}`),
        platform: String(conc.platform || avail.platform || ''),
        groupName: String(conc.group_name || avail.group_name || ''),
        current: safeNumber(conc.current_in_use),
        capacity: safeNumber(conc.max_capacity),
        queued: safeNumber(conc.waiting_in_queue),
        load: Math.max(0, safeNumber(conc.load_percentage)),
        state,
        detail: resolveDetail(state, avail, cooldownRemaining),
        cooldownRemaining
      }
    })
    .sort((a, b) => stateRank[a.state] - stateRank[b.state] || b.load - a.load || a.id - b.id)

  const rows = allRows.filter((row) => row.current > 0 || row.state !== 'idle')

  const activeCount = rows.filter((row) => row.current > 0).length
  const coolingCount = rows.filter((row) => ['cooling', 'overloaded', 'rate_limited'].includes(row.state)).length
  const errorCount = rows.filter((row) => row.state === 'error' || row.state === 'saturated').length
  const totalCurrent = rows.reduce((sum, row) => sum + row.current, 0)
  const totalCapacity = rows.reduce((sum, row) => sum + row.capacity, 0)
  const totalLoad = totalCapacity > 0 ? Math.round((totalCurrent / totalCapacity) * 100) : 0

  const updatedLabel = lastUpdated
    ? new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(lastUpdated)
    : '--:--:--'

  const loadData = useCallback(
    async (showSpinner = false) => {
      requestController.current?.abort()
      const controller = new AbortController()
      requestController.current = controller
      if (showSpinner) setRefreshing(true)
      setErrorMessage('')
      try {
        const [concData, availData] = await Promise.all([
          opsAPI.getConcurrencyStats(platformFilter, groupIdFilter),
          opsAPI.getAccountAvailabilityStats(platformFilter, groupIdFilter)
        ])
        if (controller.signal.aborted) return
        setConcurrency(concData)
        setAvailability(availData)
        setLastUpdated(new Date())
      } catch (err: any) {
        if (controller.signal.aborted || err?.code === 'ERR_CANCELED') return
        setErrorMessage(err?.response?.data?.detail || t('admin.ops.providerMonitor.loadFailed'))
      } finally {
        if (requestController.current === controller) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [platformFilter, groupIdFilter, t]
  )

  // 定时器与 effect 通过 ref 调用最新的 loadData（读取最新的筛选条件）。
  const loadRef = useRef(loadData)
  useEffect(() => {
    loadRef.current = loadData
  }, [loadData])

  // 挂载：立即加载并每 2 秒轮询；卸载时停止轮询并取消进行中的请求。
  useEffect(() => {
    void loadRef.current(false)
    const timer = window.setInterval(() => void loadRef.current(false), REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      requestController.current?.abort()
    }
  }, [])

  // 筛选条件变化（不含首次挂载）时带加载动画重新拉取。
  const filterKey = `${platformFilter}|${groupIdFilter ?? ''}`
  const lastFilterKey = useRef(filterKey)
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return
    lastFilterKey.current = filterKey
    void loadRef.current(true)
  }, [filterKey])

  function stateLabel(state: ProviderState): string {
    return t(`admin.ops.providerMonitor.states.${state}`)
  }

  const loadTone = (load: number): Tone | undefined => (load >= 90 ? 'danger' : load >= 70 ? 'warning' : undefined)

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.titleRow}>
            <span className={styles.liveDot} data-live={realtimeEnabled || undefined} aria-hidden="true" />
            <h2 className={panel.title}>{t('admin.ops.providerMonitor.title')}</h2>
            <span className={styles.refreshRate}>{t('admin.ops.providerMonitor.refreshRate')}</span>
          </div>
          <p className={panel.subtitle}>{t('admin.ops.providerMonitor.description')}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.updated}>{updatedLabel}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={refreshing}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={() => void loadData(true)}
          >
            <RefreshCw size={16} aria-hidden="true" className={refreshing ? styles.spin : undefined} />
          </Button>
        </div>
      </header>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t('admin.ops.providerMonitor.activeProviders')}</div>
          <div className={styles.statValue}>
            {activeCount}
            <span className={styles.statSuffix}>/ {rows.length}</span>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t('admin.ops.providerMonitor.aggregateLoad')}</div>
          <div className={styles.statValue} data-tone={totalLoad >= 90 ? 'danger' : undefined}>
            {totalLoad}%
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t('admin.ops.providerMonitor.coolingProviders')}</div>
          <div className={styles.statValue} data-tone="warning">
            {coolingCount}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>{t('admin.ops.providerMonitor.attentionProviders')}</div>
          <div className={styles.statValue} data-tone={errorCount > 0 ? 'danger' : 'success'}>
            {errorCount}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className={styles.alert}>
          <Alert tone="danger" title={errorMessage} />
        </div>
      )}

      {!realtimeEnabled ? (
        <div className={styles.empty}>{t('admin.ops.concurrency.disabledHint')}</div>
      ) : loading ? (
        <div className={styles.loading}>
          <Skeleton label={t('common.loading')} lines={4} />
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>{t('admin.ops.providerMonitor.empty')}</div>
      ) : (
        <div className={styles.scroll}>
          <div className={styles.headRow}>
            <span>{t('admin.ops.providerMonitor.provider')}</span>
            <span>{t('admin.ops.providerMonitor.liveLoad')}</span>
            <span>{t('admin.ops.providerMonitor.state')}</span>
          </div>
          {rows.map((row) => (
            <div key={row.id} data-provider-id={row.id} data-provider-state={row.state} className={styles.row}>
              <div className={styles.provider}>
                <span className={styles.stateDot} data-tone={stateTone(row.state)} aria-hidden="true" />
                <div className={styles.providerText}>
                  <div className={styles.providerName} title={row.name}>
                    {row.name}
                  </div>
                  <div className={styles.providerMeta}>
                    <span>{row.platform}</span>
                    {row.groupName && <span className={styles.truncate}>{row.groupName}</span>}
                    <span>#{row.id}</span>
                  </div>
                </div>
              </div>

              <div>
                <div className={styles.loadLine}>
                  <span className={styles.calls}>
                    {row.current}/{row.capacity > 0 ? row.capacity : t('admin.ops.providerMonitor.unlimited')} {t('admin.ops.providerMonitor.calls')}
                  </span>
                  <span className={styles.loadPct} data-tone={loadTone(row.load)}>
                    {Math.round(row.load)}%
                  </span>
                </div>
                <div className={styles.segments} aria-label={`${row.name} ${Math.round(row.load)}%`}>
                  {SEGMENTS.map((index) => (
                    <span key={index} className={styles.segment} data-tone={segmentTone(row, index)} />
                  ))}
                </div>
                {row.queued > 0 && <div className={styles.queued}>{t('admin.ops.providerMonitor.queued', { count: row.queued })}</div>}
              </div>

              <div className={styles.stateCell}>
                <div className={styles.stateLine}>
                  <span className={styles.stateLabel} data-tone={stateTone(row.state)}>
                    {stateLabel(row.state)}
                  </span>
                  {row.cooldownRemaining > 0 && <span className={styles.cooldown}>{formatDuration(row.cooldownRemaining)}</span>}
                </div>
                <p className={styles.detail} title={row.detail}>
                  {row.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
