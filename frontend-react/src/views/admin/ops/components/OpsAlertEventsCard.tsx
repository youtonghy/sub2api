/**
 * 告警事件列表与详情（对应 Vue 版 OpsAlertEventsCard.vue）。
 * 列表使用游标分页（before_fired_at + before_id），滚动到底部附近自动加载下一页；
 * 筛选条件变化后旧请求的结果一律丢弃（listRequestId 守卫）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useMountOnce } from '@/composables/useMountOnce'
import { Ban, CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react'

import { Badge, type BadgeTone } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import BaseDialog from '@/components/common/BaseDialog'
import DataTable from '@/components/common/DataTable'
import Select from '@/components/common/Select'
import type { Column } from '@/components/common/types'
import { opsAPI, type AlertEventsQuery } from '@/api/admin/ops'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import type { AlertEvent } from '../types'
import { formatDateTime } from '../utils/opsFormatters'
import panel from './OpsPanel.module.css'
import styles from './OpsAlertEventsCard.module.css'

const PAGE_SIZE = 10

function getDimensionString(event: AlertEvent | null | undefined, key: string): string {
  const v = event?.dimensions?.[key]
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function formatDurationMs(ms: number): string {
  const safe = Math.max(0, Math.floor(ms))
  const sec = Math.floor(safe / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}

function formatDimensionsSummary(event: AlertEvent): string {
  const parts: string[] = []
  const platform = getDimensionString(event, 'platform')
  if (platform) parts.push(`platform=${platform}`)
  const groupId = event.dimensions?.group_id
  if (groupId != null && groupId !== '') parts.push(`group_id=${String(groupId)}`)
  const region = getDimensionString(event, 'region')
  if (region) parts.push(`region=${region}`)
  return parts.length ? parts.join(' ') : '-'
}

function durationToUntilRFC3339(duration: string): string {
  const now = Date.now()
  if (duration === '1h') return new Date(now + 60 * 60 * 1000).toISOString()
  if (duration === '24h') return new Date(now + 24 * 60 * 60 * 1000).toISOString()
  if (duration === '7d') return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString()
  return new Date(now + 60 * 60 * 1000).toISOString()
}

// Vue 版的 Tailwind 颜色类改为 Arc badge 色调
function severityTone(severity: string | undefined): BadgeTone {
  const s = String(severity || '').trim().toLowerCase()
  if (s === 'p0' || s === 'critical') return 'danger'
  if (s === 'p1' || s === 'warning') return 'warning'
  if (s === 'p2' || s === 'info') return 'info'
  return 'neutral'
}

function statusTone(status: string | undefined): BadgeTone {
  const s = String(status || '').trim().toLowerCase()
  if (s === 'firing') return 'danger'
  if (s === 'resolved') return 'success'
  return 'neutral'
}

export default function OpsAlertEventsCard() {
  const { t } = useI18n()

  // 列表状态：ref 保存最新值供异步回调与守卫同步读取（Vue 版直接读 ref），state 驱动渲染
  const [loading, setLoadingState] = useState(false)
  const [loadingMore, setLoadingMoreState] = useState(false)
  const [events, setEventsState] = useState<AlertEvent[]>([])
  const [hasMore, setHasMoreState] = useState(true)
  const loadingRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const eventsRef = useRef<AlertEvent[]>([])
  const hasMoreRef = useRef(true)
  const listRequestId = useRef(0)

  const setLoading = (v: boolean) => { loadingRef.current = v; setLoadingState(v) }
  const setLoadingMore = (v: boolean) => { loadingMoreRef.current = v; setLoadingMoreState(v) }
  const setEvents = (v: AlertEvent[]) => { eventsRef.current = v; setEventsState(v) }
  const setHasMore = (v: boolean) => { hasMoreRef.current = v; setHasMoreState(v) }

  // Detail modal
  const [showDetail, setShowDetail] = useState(false)
  const [selected, setSelected] = useState<AlertEvent | null>(null)
  const selectedRef = useRef<AlertEvent | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailActionLoading, setDetailActionLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [history, setHistory] = useState<AlertEvent[]>([])
  const [historyRange, setHistoryRangeState] = useState('7d')
  const historyRangeRef = useRef('7d')

  const [silenceDuration, setSilenceDuration] = useState('1h')

  // Filters
  const [filters, setFilters] = useState({ timeRange: '24h', severity: '', status: '', emailSent: '' })
  const filtersRef = useRef(filters)
  const { timeRange, severity, status, emailSent } = filters

  const historyRangeOptions = [
    { value: '7d', label: t('admin.ops.timeRange.7d') },
    { value: '30d', label: t('admin.ops.timeRange.30d') }
  ]
  const silenceDurationOptions = [
    { value: '1h', label: t('admin.ops.timeRange.1h') },
    { value: '24h', label: t('admin.ops.timeRange.24h') },
    { value: '7d', label: t('admin.ops.timeRange.7d') }
  ]
  const timeRangeOptions = [
    { value: '5m', label: t('admin.ops.timeRange.5m') },
    { value: '30m', label: t('admin.ops.timeRange.30m') },
    { value: '1h', label: t('admin.ops.timeRange.1h') },
    { value: '6h', label: t('admin.ops.timeRange.6h') },
    { value: '24h', label: t('admin.ops.timeRange.24h') },
    { value: '7d', label: t('admin.ops.timeRange.7d') },
    { value: '30d', label: t('admin.ops.timeRange.30d') }
  ]
  const severityOptions = [
    { value: '', label: t('common.all') },
    { value: 'P0', label: 'P0' },
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
    { value: 'P3', label: 'P3' }
  ]
  const statusOptions = [
    { value: '', label: t('common.all') },
    { value: 'firing', label: t('admin.ops.alertEvents.status.firing') },
    { value: 'resolved', label: t('admin.ops.alertEvents.status.resolved') },
    { value: 'manual_resolved', label: t('admin.ops.alertEvents.status.manualResolved') }
  ]
  const emailSentOptions = [
    { value: '', label: t('common.all') },
    { value: 'true', label: t('admin.ops.alertEvents.table.emailSent') },
    { value: 'false', label: t('admin.ops.alertEvents.table.emailIgnored') }
  ]

  function buildQuery(overrides: Partial<AlertEventsQuery> = {}): AlertEventsQuery {
    const f = filtersRef.current
    const q: AlertEventsQuery = {
      limit: PAGE_SIZE,
      time_range: f.timeRange
    }
    if (f.severity) q.severity = f.severity
    if (f.status) q.status = f.status
    if (f.emailSent === 'true') q.email_sent = true
    if (f.emailSent === 'false') q.email_sent = false
    return { ...q, ...overrides }
  }

  async function loadFirstPage() {
    const requestId = ++listRequestId.current
    setLoadingMore(false)
    setLoading(true)
    try {
      const data = await opsAPI.listAlertEvents(buildQuery())
      if (requestId !== listRequestId.current) return
      setEvents(data)
      setHasMore(data.length === PAGE_SIZE)
    } catch (err: any) {
      if (requestId !== listRequestId.current) return
      console.error('[OpsAlertEventsCard] Failed to load alert events', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.alertEvents.loadFailed'))
      setEvents([])
      setHasMore(false)
    } finally {
      if (requestId === listRequestId.current) setLoading(false)
    }
  }

  async function loadMore() {
    if (loadingMoreRef.current || loadingRef.current) return
    if (!hasMoreRef.current) return
    const last = eventsRef.current[eventsRef.current.length - 1]
    if (!last) return

    const requestId = listRequestId.current
    setLoadingMore(true)
    try {
      const data = await opsAPI.listAlertEvents(
        buildQuery({ before_fired_at: last.fired_at || last.created_at, before_id: last.id })
      )
      if (requestId !== listRequestId.current) return
      if (!data.length) {
        setHasMore(false)
        return
      }
      setEvents([...eventsRef.current, ...data])
      if (data.length < PAGE_SIZE) setHasMore(false)
    } catch (err: any) {
      if (requestId !== listRequestId.current) return
      console.error('[OpsAlertEventsCard] Failed to load more alert events', err)
      setHasMore(false)
    } finally {
      if (requestId === listRequestId.current) setLoadingMore(false)
    }
  }

  // 筛选变化时清空并重新加载（Vue 版 watch([timeRange, severity, status, emailSent])，值未变不触发）
  function updateFilter(key: keyof typeof filters, value: string) {
    if (filtersRef.current[key] === value) return
    const next = { ...filtersRef.current, [key]: value }
    filtersRef.current = next
    setFilters(next)
    setEvents([])
    setHasMore(true)
    void loadFirstPage()
  }

  // 挂载时加载首页（Vue 版 onMounted）
  useMountOnce(() => loadFirstPage())


  // 滚动监听通过 ref 调用最新的 loadMore
  const loadMoreRef = useRef(loadMore)
  useEffect(() => { loadMoreRef.current = loadMore })

  // 滚动事件不冒泡，在外框上用捕获阶段监听：桌面端滚动的是表格容器，移动端滚动的是外框本身
  const frameRef = useRef<HTMLDivElement>(null)
  const hasRows = events.length > 0
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null
      if (!el) return
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 120
      if (nearBottom) void loadMoreRef.current()
    }
    frame.addEventListener('scroll', onScroll, true)
    return () => frame.removeEventListener('scroll', onScroll, true)
  }, [hasRows, loading])

  function formatDurationLabel(event: AlertEvent): string {
    const firedAt = new Date(event.fired_at || event.created_at)
    if (Number.isNaN(firedAt.getTime())) return '-'
    const resolvedAtStr = event.resolved_at || null
    const s = String(event.status || '').trim().toLowerCase()

    if (resolvedAtStr) {
      const resolvedAt = new Date(resolvedAtStr)
      if (!Number.isNaN(resolvedAt.getTime())) {
        const ms = resolvedAt.getTime() - firedAt.getTime()
        const prefix = s === 'manual_resolved'
          ? t('admin.ops.alertEvents.status.manualResolved')
          : t('admin.ops.alertEvents.status.resolved')
        return `${prefix} ${formatDurationMs(ms)}`
      }
    }

    const now = Date.now()
    const ms = now - firedAt.getTime()
    return `${t('admin.ops.alertEvents.status.firing')} ${formatDurationMs(ms)}`
  }

  function formatStatusLabel(value: string | undefined): string {
    const s = String(value || '').trim().toLowerCase()
    if (!s) return '-'
    if (s === 'firing') return t('admin.ops.alertEvents.status.firing')
    if (s === 'resolved') return t('admin.ops.alertEvents.status.resolved')
    if (s === 'manual_resolved') return t('admin.ops.alertEvents.status.manualResolved')
    return s.toUpperCase()
  }

  const setSelectedEvent = (ev: AlertEvent | null) => {
    selectedRef.current = ev
    setSelected(ev)
  }

  function closeDetail() {
    setShowDetail(false)
    setSelectedEvent(null)
    setHistory([])
  }

  const loadHistory = useCallback(async () => {
    const ev = selectedRef.current
    if (!ev) {
      setHistory([])
      setHistoryLoading(false)
      return
    }

    setHistoryLoading(true)
    try {
      const platform = getDimensionString(ev, 'platform')
      const groupIdRaw = ev.dimensions?.group_id
      const groupId = typeof groupIdRaw === 'number' ? groupIdRaw : undefined

      const items = await opsAPI.listAlertEvents({
        limit: 20,
        time_range: historyRangeRef.current,
        platform: platform || undefined,
        group_id: groupId,
        status: ''
      })

      // Best-effort: narrow to same rule_id + dimensions
      setHistory(
        items.filter((it) => {
          if (it.rule_id !== ev.rule_id) return false
          const p1 = getDimensionString(it, 'platform')
          const p2 = getDimensionString(ev, 'platform')
          if ((p1 || '') !== (p2 || '')) return false
          const g1 = it.dimensions?.group_id
          const g2 = ev.dimensions?.group_id
          return (g1 ?? null) === (g2 ?? null)
        })
      )
    } catch (err: any) {
      console.error('[OpsAlertEventsCard] Failed to load alert history', err)
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  async function openDetail(row: AlertEvent) {
    setShowDetail(true)
    setSelectedEvent(row)
    setDetailLoading(true)
    setHistoryLoading(true)

    try {
      const detail = await opsAPI.getAlertEvent(row.id)
      setSelectedEvent(detail)
    } catch (err: any) {
      console.error('[OpsAlertEventsCard] Failed to load alert detail', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.alertEvents.detail.loadFailed'))
    } finally {
      setDetailLoading(false)
    }

    await loadHistory()
  }

  // 历史范围变化时，若详情弹窗打开则重新加载历史（Vue 版 watch(historyRange)）
  function setHistoryRange(value: string) {
    if (historyRangeRef.current === value) return
    historyRangeRef.current = value
    setHistoryRangeState(value)
    if (showDetail) void loadHistory()
  }

  async function silenceAlert() {
    const ev = selected
    if (!ev) return
    if (detailActionLoading) return
    setDetailActionLoading(true)
    try {
      const platform = getDimensionString(ev, 'platform')
      const groupIdRaw = ev.dimensions?.group_id
      const groupId = typeof groupIdRaw === 'number' ? groupIdRaw : null
      const region = getDimensionString(ev, 'region') || null

      await opsAPI.createAlertSilence({
        rule_id: ev.rule_id,
        platform: platform || '',
        group_id: groupId ?? undefined,
        region: region ?? undefined,
        until: durationToUntilRFC3339(silenceDuration),
        reason: `silence from UI (${silenceDuration})`
      })

      useAppStore.getState().showSuccess(t('admin.ops.alertEvents.detail.silenceSuccess'))
    } catch (err: any) {
      console.error('[OpsAlertEventsCard] Failed to silence alert', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.alertEvents.detail.silenceFailed'))
    } finally {
      setDetailActionLoading(false)
    }
  }

  async function manualResolve() {
    if (!selected) return
    if (detailActionLoading) return
    setDetailActionLoading(true)
    try {
      await opsAPI.updateAlertEventStatus(selected.id, 'manual_resolved')
      useAppStore.getState().showSuccess(t('admin.ops.alertEvents.detail.manualResolvedSuccess'))

      // Refresh detail + first page to reflect new status
      const detail = await opsAPI.getAlertEvent(selected.id)
      setSelectedEvent(detail)
      await loadFirstPage()
      await loadHistory()
    } catch (err: any) {
      console.error('[OpsAlertEventsCard] Failed to resolve alert', err)
      useAppStore.getState().showError(err?.response?.data?.detail || t('admin.ops.alertEvents.detail.manualResolvedFailed'))
    } finally {
      setDetailActionLoading(false)
    }
  }

  const empty = events.length === 0 && !loading

  const severityBadge = (value: string | undefined) => (
    <Badge size="sm" tone={severityTone(value)}>{value || '-'}</Badge>
  )
  const statusBadge = (value: string | undefined) => (
    <Badge size="sm" tone={statusTone(value)}>{formatStatusLabel(value)}</Badge>
  )
  const emailLabel = (sent: boolean) => (sent ? t('admin.ops.alertEvents.table.emailSent') : t('admin.ops.alertEvents.table.emailIgnored'))

  const columns: Column<AlertEvent>[] = [
    { key: 'fired_at', label: t('admin.ops.alertEvents.table.time') },
    { key: 'severity', label: t('admin.ops.alertEvents.table.severity') },
    { key: 'platform', label: t('admin.ops.alertEvents.table.platform') },
    { key: 'rule_id', label: t('admin.ops.alertEvents.table.ruleId') },
    { key: 'title', label: t('admin.ops.alertEvents.table.title') },
    { key: 'duration', label: t('admin.ops.alertEvents.table.duration') },
    { key: 'dimensions', label: t('admin.ops.alertEvents.table.dimensions') },
    { key: 'email_sent', label: t('admin.ops.alertEvents.table.email'), align: 'right' }
  ]

  const historyColumns: Column<AlertEvent>[] = [
    { key: 'fired_at', label: t('admin.ops.alertEvents.table.time') },
    { key: 'status', label: t('admin.ops.alertEvents.table.status') },
    { key: 'metric_value', label: t('admin.ops.alertEvents.table.metric') }
  ]

  const viewLogsHref = selected
    ? `/admin/ops?platform=${encodeURIComponent(getDimensionString(selected, 'platform') || '')}&group_id=${selected.dimensions?.group_id || ''}&error_type=request&open_error_details=1`
    : ''

  return (
    <section className={panel.panel}>
      <div className={panel.header}>
        <div>
          <h2 className={panel.title}>{t('admin.ops.alertEvents.title')}</h2>
          <p className={panel.subtitle}>{t('admin.ops.alertEvents.description')}</p>
        </div>

        <div className={panel.toolbar}>
          <div className={styles.filterWide}>
            <Select
              value={timeRange}
              options={timeRangeOptions}
              aria-label={t('admin.ops.alertEvents.table.time')}
              onChange={(v) => updateFilter('timeRange', String(v || '24h'))}
            />
          </div>
          <div className={styles.filterNarrow}>
            <Select
              value={severity}
              options={severityOptions}
              aria-label={t('admin.ops.alertEvents.table.severity')}
              onChange={(v) => updateFilter('severity', String(v || ''))}
            />
          </div>
          <div className={styles.filterWide}>
            <Select
              value={status}
              options={statusOptions}
              aria-label={t('admin.ops.alertEvents.table.status')}
              onChange={(v) => updateFilter('status', String(v || ''))}
            />
          </div>
          <div className={styles.filterWide}>
            <Select
              value={emailSent}
              options={emailSentOptions}
              aria-label={t('admin.ops.alertEvents.table.email')}
              onChange={(v) => updateFilter('emailSent', String(v || ''))}
            />
          </div>
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => void loadFirstPage()}>
            <RefreshCw size={14} aria-hidden="true" className={loading ? styles.spin : undefined} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton label={t('admin.ops.alertEvents.loading')} lines={4} />
      ) : empty ? (
        <div className={styles.empty}>{t('admin.ops.alertEvents.empty')}</div>
      ) : (
        <div ref={frameRef} className={styles.frame} data-testid="ops-alert-events-frame">
          <DataTable<AlertEvent>
            columns={columns}
            data={events}
            stickyFirstColumn={false}
            clickableRows
            onRowClick={(row) => void openDetail(row)}
            cells={{
              fired_at: ({ row }) => <span className={styles.time}>{formatDateTime(row.fired_at || row.created_at)}</span>,
              severity: ({ row }) => (
                <span className={styles.badges}>
                  {severityBadge(String(row.severity || ''))}
                  {statusBadge(row.status)}
                </span>
              ),
              platform: ({ row }) => getDimensionString(row, 'platform') || '-',
              rule_id: ({ row }) => <span className={styles.mono}>#{row.rule_id}</span>,
              title: ({ row }) => (
                <div className={styles.titleCell} title={row.title || ''}>
                  <div className={styles.titleText}>{row.title || '-'}</div>
                  {row.description && <div className={styles.descriptionText}>{row.description}</div>}
                </div>
              ),
              duration: ({ row }) => formatDurationLabel(row),
              dimensions: ({ row }) => <span className={styles.dimensions}>{formatDimensionsSummary(row)}</span>,
              email_sent: ({ row }) => (
                <span className={styles.email} title={emailLabel(row.email_sent)}>
                  {row.email_sent ? (
                    <CheckCircle2 size={16} aria-hidden="true" className={panel.success} />
                  ) : (
                    <Ban size={16} aria-hidden="true" className={styles.iconMuted} />
                  )}
                  <span>{emailLabel(row.email_sent)}</span>
                </span>
              )
            }}
          />
          {loadingMore ? (
            <div className={styles.more} role="status">
              {t('admin.ops.alertEvents.loading')}
            </div>
          ) : !hasMore && events.length > 0 ? (
            <div className={styles.more} data-testid="ops-alert-events-end">-</div>
          ) : null}
        </div>
      )}

      <BaseDialog
        show={showDetail}
        title={t('admin.ops.alertEvents.detail.title')}
        width="wide"
        closeOnClickOutside
        onClose={closeDetail}
      >
        {detailLoading ? (
          <Skeleton label={t('admin.ops.alertEvents.detail.loading')} lines={5} />
        ) : !selected ? (
          <div className={styles.empty}>{t('admin.ops.alertEvents.detail.empty')}</div>
        ) : (
          <div className={styles.detail}>
            <div className={styles.detailHead}>
              <div className={styles.detailSummary}>
                <div className={styles.badges}>
                  {severityBadge(String(selected.severity || ''))}
                  {statusBadge(selected.status)}
                </div>
                <div className={styles.detailTitle}>{selected.title || '-'}</div>
                {selected.description && <div className={styles.detailDescription}>{selected.description}</div>}
              </div>

              <div className={styles.detailActions}>
                <div className={styles.silence}>
                  <span className={styles.fieldLabel}>{t('admin.ops.alertEvents.detail.silence')}</span>
                  <div className={styles.filterWide}>
                    <Select
                      value={silenceDuration}
                      options={silenceDurationOptions}
                      aria-label={t('admin.ops.alertEvents.detail.silence')}
                      onChange={(v) => setSilenceDuration(String(v || '1h'))}
                    />
                  </div>
                  <Button type="button" size="sm" variant="secondary" disabled={detailActionLoading} onClick={() => void silenceAlert()}>
                    <Ban size={14} aria-hidden="true" />
                    {t('common.apply')}
                  </Button>
                </div>

                <Button type="button" size="sm" variant="secondary" disabled={detailActionLoading} onClick={() => void manualResolve()}>
                  <CheckCircle2 size={14} aria-hidden="true" />
                  {t('admin.ops.alertEvents.detail.manualResolve')}
                </Button>
              </div>
            </div>

            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt className={styles.fieldLabel}>{t('admin.ops.alertEvents.detail.firedAt')}</dt>
                <dd>{formatDateTime(selected.fired_at || selected.created_at)}</dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.fieldLabel}>{t('admin.ops.alertEvents.detail.resolvedAt')}</dt>
                <dd>{selected.resolved_at ? formatDateTime(selected.resolved_at) : '-'}</dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.fieldLabel}>{t('admin.ops.alertEvents.detail.ruleId')}</dt>
                <dd className={styles.ruleLinks}>
                  <span className={styles.mono}>#{selected.rule_id}</span>
                  <a className={styles.link} href={`/admin/ops?open_alert_rules=1&alert_rule_id=${selected.rule_id}`}>
                    <ExternalLink size={12} aria-hidden="true" />
                    {t('admin.ops.alertEvents.detail.viewRule')}
                  </a>
                  <a className={styles.link} href={viewLogsHref}>
                    <ExternalLink size={12} aria-hidden="true" />
                    {t('admin.ops.alertEvents.detail.viewLogs')}
                  </a>
                </dd>
              </div>
              <div className={styles.fact}>
                <dt className={styles.fieldLabel}>{t('admin.ops.alertEvents.detail.dimensions')}</dt>
                <dd>
                  {getDimensionString(selected, 'platform') && <div>platform={getDimensionString(selected, 'platform')}</div>}
                  {selected.dimensions?.group_id ? <div>group_id={String(selected.dimensions.group_id)}</div> : null}
                  {getDimensionString(selected, 'region') && <div>region={getDimensionString(selected, 'region')}</div>}
                </dd>
              </div>
            </dl>

            <section className={styles.history}>
              <div className={panel.header}>
                <div>
                  <h3 className={panel.title}>{t('admin.ops.alertEvents.detail.historyTitle')}</h3>
                  <p className={panel.subtitle}>{t('admin.ops.alertEvents.detail.historyHint')}</p>
                </div>
                <div className={styles.filterWide}>
                  <Select
                    value={historyRange}
                    options={historyRangeOptions}
                    aria-label={t('admin.ops.alertEvents.detail.historyTitle')}
                    onChange={(v) => setHistoryRange(String(v || '7d'))}
                  />
                </div>
              </div>

              {historyLoading ? (
                <div className={panel.muted}>{t('admin.ops.alertEvents.detail.historyLoading')}</div>
              ) : history.length === 0 ? (
                <div className={panel.muted}>{t('admin.ops.alertEvents.detail.historyEmpty')}</div>
              ) : (
                <div className={styles.historyTable}>
                  <DataTable<AlertEvent>
                    columns={historyColumns}
                    data={history}
                    stickyFirstColumn={false}
                    cells={{
                      fired_at: ({ row }) => formatDateTime(row.fired_at || row.created_at),
                      status: ({ row }) => statusBadge(row.status),
                      metric_value: ({ row }) =>
                        typeof row.metric_value === 'number' && typeof row.threshold_value === 'number'
                          ? `${row.metric_value.toFixed(2)} / ${row.threshold_value.toFixed(2)}`
                          : '-'
                    }}
                  />
                </div>
              )}
            </section>
          </div>
        )}
      </BaseDialog>
    </section>
  )
}
