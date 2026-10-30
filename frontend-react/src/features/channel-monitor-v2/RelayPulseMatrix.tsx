/**
 * 色块矩阵，对应 Vue 版 RelayPulseMatrix.vue：每行一个维度（平台 / 分组 / 模型），左侧为成功率、首 Token、
 * 每秒 Token（可隐藏）、缓存率汇总，右侧为按时间桶排列的健康色块。
 * - X 轴始终覆盖所选范围 [requested_start, requested_end)，部分回填时空桶保留为灰色
 * - 滚轮缩放横向（以光标为中心），Shift+滚轮或横向滚动平移；范围变化时重置缩放
 * - 悬停 / 聚焦色块显示浮动提示（渲染到 body，避免被滚动容器裁剪），只展示比率类指标，不展示绝对请求数
 */
import { Grid3x3 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'

import type {
  LatencyMetric,
  MonitorCoverage,
  MonitorHealth,
  MonitorMatrixBucket,
  MonitorMatrixRow,
  MonitorMetric
} from '@/api/channelMonitorV2'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import EmptyState from '@/components/common/EmptyState'
import { useI18n } from '@/i18n/useI18n'
import {
  formatLatencyPrivacy,
  formatMonitorMs,
  formatMonitorPercent,
  formatMonitorSuccessRateFromError,
  formatMonitorThroughput,
  formatMonitorTokensPerSecond,
  healthModeScore,
  healthScoreClass,
  tokensPerSecondFromTpm,
  type HealthDisplayMode
} from './monitorFormat'
import { applyWheelZoom, clientXRatio, isZoomed, resetZoom, sliceByZoom, type ZoomState } from './monitorZoom'
import { bucketSpanLabel } from './bucketLabel'
import { healthAttr } from './monitorViewModel'
import styles from './RelayPulseMatrix.module.css'

export interface RelayPulseMatrixProps {
  rows: MonitorMatrixRow[]
  coverage: MonitorCoverage
  healthMode: HealthDisplayMode
  /** When false, RPM/TPM are omitted from tooltips (user scale privacy). 默认 true */
  showThroughput?: boolean
}

type AlignedSlot = { start: string; bucket?: MonitorMatrixBucket }

interface FloatingTooltip {
  visible: boolean
  x: number
  y: number
  lines: string[]
}

export default function RelayPulseMatrix({ rows, coverage, healthMode, showThroughput = true }: RelayPulseMatrixProps) {
  const { t, locale } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<ZoomState>(resetZoom)
  const [tooltip, setTooltip] = useState<FloatingTooltip>({ visible: false, x: 0, y: 0, lines: [] })
  const zoomed = isZoomed(zoom)

  // 范围变化时重置缩放（Vue 版 watch coverage 关键字段）
  const coverageKey = [
    coverage.requested_start,
    coverage.requested_end,
    coverage.coverage_start,
    coverage.data_through,
    coverage.bucket_seconds
  ].join('|')
  const [lastCoverageKey, setLastCoverageKey] = useState(coverageKey)
  if (lastCoverageKey !== coverageKey) {
    setLastCoverageKey(coverageKey)
    setZoom(resetZoom())
  }

  const allBucketStarts = useMemo(() => {
    // X-axis always spans the UI-selected range [requested_start, requested_end).
    // Partial backfill leaves empty cells until coverage_start/data_through fill in.
    const step = Math.max(60, coverage.bucket_seconds) * 1000
    const requestedStart = new Date(coverage.requested_start).getTime()
    const requestedEndRaw = coverage.requested_end ? new Date(coverage.requested_end).getTime() : NaN
    // Fallback for older payloads without requested_end.
    const dataThrough = new Date(coverage.data_through).getTime()
    const end = Number.isFinite(requestedEndRaw) && requestedEndRaw > requestedStart ? requestedEndRaw : dataThrough
    if (![requestedStart, end].every(Number.isFinite) || requestedStart >= end) return []
    const starts: string[] = []
    for (let cursor = Math.floor(requestedStart / step) * step; cursor < end; cursor += step) {
      starts.push(new Date(cursor).toISOString())
    }
    return starts
  }, [coverage.bucket_seconds, coverage.requested_start, coverage.requested_end, coverage.data_through])

  /** Visible bucket window after X zoom (cursor-centered), not always the tail. */
  const bucketStarts = useMemo(() => sliceByZoom(allBucketStarts, zoom), [allBucketStarts, zoom])

  /** Pre-aligned sparse slots per row so wheel zoom does not rebuild Maps every paint. */
  const alignedRows = useMemo(() => {
    const indexByStart = new Map<string, number>()
    bucketStarts.forEach((start, index) => indexByStart.set(start, index))
    return rows.map((row) => {
      const slots: AlignedSlot[] = bucketStarts.map((start) => ({ start }))
      for (const bucket of row.buckets || []) {
        const key = new Date(bucket.bucket_start).toISOString()
        const index = indexByStart.get(key)
        if (index != null) slots[index] = { start: bucketStarts[index], bucket }
      }
      return { row, slots }
    })
  }, [rows, bucketStarts])

  const count = Math.max(1, bucketStarts.length)
  // Zoom in = fewer columns + wider min cell (span shrinks → intensity grows).
  const intensity = zoomed ? Math.min(12, Math.round((1 - zoom.span) / 0.08)) : 0
  const pulseMinWidth = zoomed
    ? `${count * (6 + intensity * 4) + Math.max(0, count - 1) * (intensity >= 4 ? 3 : 2)}px`
    : '0px'
  const tableStyle = {
    '--bucket-count': String(count),
    minWidth: zoomed ? `calc(260px + ${pulseMinWidth})` : '0'
  } as CSSProperties
  const gapPx = !zoomed ? (count > 24 ? 1 : 2) : intensity >= 4 ? 3 : 2
  // Unzoomed: equal flex fractions. Zoomed: enforce growing min width so blocks lengthen.
  const minCell = !zoomed ? '0' : `${6 + intensity * 4}px`
  const pulseStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${count}, minmax(${minCell}, 1fr))`,
    gap: `${gapPx}px`,
    height: '16px',
    minWidth: pulseMinWidth
  }

  const formatAxisTime = (value: string) =>
    new Intl.DateTimeFormat(locale || undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
      new Date(value)
    )

  const formatBucketRange = (value: string) => {
    const start = new Date(value)
    const end = new Date(start.getTime() + coverage.bucket_seconds * 1000)
    return `${formatAxisTime(start.toISOString())} - ${new Intl.DateTimeFormat(locale || undefined, { hour: '2-digit', minute: '2-digit' }).format(end)}`
  }

  const axisStart = bucketStarts.length ? formatAxisTime(bucketStarts[0]) : '时间脉冲'
  const axisEnd = bucketStarts.length ? formatAxisTime(bucketStarts[bucketStarts.length - 1]) : ''

  // Plain vertical wheel over the matrix zooms X (narrower range → wider cells).
  // Shift+wheel or horizontal delta pans; leave non-matrix page scroll alone.
  // React 的 wheel 监听是被动的，无法 preventDefault，因此在原生节点上注册非被动监听。
  useEffect(() => {
    const track = scrollRef.current
    if (!track) return
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null
      const pulse = target?.closest('[data-pulse-track]') as HTMLElement | null
      event.preventDefault()
      const ratio = clientXRatio(event.clientX, pulse || track)
      setZoom((current) => applyWheelZoom(current, event, ratio))
    }
    track.addEventListener('wheel', onWheel, { passive: false })
    return () => track.removeEventListener('wheel', onWheel)
  }, [rows.length])

  const cellHealth = (health: MonitorHealth, requestCount: number) => healthAttr(healthScoreClass(health, healthMode, requestCount))

  const rowLabel = (row: MonitorMatrixRow) => {
    const parts = [row.platform]
    if (row.group_name || row.group_id) parts.push(row.group_name || `#${row.group_id}`)
    if (row.model) parts.push(row.model === '__other__' ? t('channelMonitorV2.otherModels') : row.model)
    return parts.join(' / ')
  }

  const rowKey = (row: MonitorMatrixRow) => [row.platform, row.group_id || 0, row.model || ''].join(':')

  const successRate = (metrics: MonitorMetric) => {
    // Empty traffic: no request count and no throughput signal.
    // When throughput is hidden for privacy, still show success from error_rate.
    const noCount = metrics.request_count <= 0
    const noTP = (metrics.rpm || 0) <= 0 && (metrics.tpm || 0) <= 0
    if (noCount && noTP && showThroughput) return '-'
    return formatMonitorSuccessRateFromError(metrics.error_rate)
  }

  const formatScore = (health: MonitorHealth) => {
    const score = healthModeScore(health, healthMode)
    if (score == null) return '—'
    return `${Math.round(score)}`
  }

  const latencyPrivacy = (metric: LatencyMetric) => formatLatencyPrivacy(metric.p50_ms, metric.p90_ms, metric.avg_ms, metric.p95_ms)
  const formatTps = (tpm: number | null | undefined) => formatMonitorTokensPerSecond(tpm)
  const exactTps = (tpm: number | null | undefined) =>
    Intl.NumberFormat(locale || undefined, { maximumFractionDigits: 3 }).format(tokensPerSecondFromTpm(tpm))

  const bucketTooltipLines = (bucket: MonitorMatrixBucket) => {
    const metrics = bucket.metrics
    const lines = [
      formatBucketRange(bucket.bucket_start),
      t('channelMonitorV2.matrix.scoreLine', { score: formatScore(bucket.health) }),
      t('channelMonitorV2.metrics.successRateValue', { value: successRate(metrics) }),
      t('channelMonitorV2.metrics.ttftValue', { value: latencyPrivacy(metrics.ttft) })
    ]
    if (showThroughput) {
      lines.push(t('channelMonitorV2.metrics.tpsValue', { value: formatTps(metrics.tpm) }))
    }
    lines.push(
      t('channelMonitorV2.metrics.cacheRateValue', { value: formatMonitorPercent(metrics.cache_rate) }),
      t('channelMonitorV2.metrics.errorRateValue', { value: formatMonitorPercent(metrics.error_rate) })
    )
    if (showThroughput) {
      lines.push(t('channelMonitorV2.metrics.rpmValue', { value: formatMonitorThroughput(metrics.rpm) }))
    }
    lines.push(t('channelMonitorV2.metrics.durationValue', { value: latencyPrivacy(metrics.duration) }))
    return lines
  }

  const slotLines = (slot: AlignedSlot) =>
    slot.bucket ? bucketTooltipLines(slot.bucket) : [formatBucketRange(slot.start), t('channelMonitorV2.matrix.noTraffic')]

  const slotLabel = (slot: AlignedSlot) =>
    slot.bucket
      ? bucketTooltipLines(slot.bucket).join('\n')
      : t('channelMonitorV2.matrix.noTrafficAt', { time: formatBucketRange(slot.start) })

  const positionFromEvent = (event: MouseEvent | FocusEvent) => {
    if ('clientX' in event) {
      return {
        x: Math.min(window.innerWidth - 12, Math.max(12, event.clientX)),
        y: Math.min(window.innerHeight - 12, Math.max(12, event.clientY)) - 12
      }
    }
    const rect = (event.target as HTMLElement | null)?.getBoundingClientRect()
    if (!rect) return null
    return { x: rect.left + rect.width / 2, y: rect.top - 10 }
  }

  const showTooltip = (event: MouseEvent | FocusEvent, slot: AlignedSlot) => {
    const pos = positionFromEvent(event)
    setTooltip((prev) => ({ visible: true, lines: slotLines(slot), x: pos?.x ?? prev.x, y: pos?.y ?? prev.y }))
  }

  const moveTooltip = (event: MouseEvent) => {
    const pos = positionFromEvent(event)
    if (!pos) return
    setTooltip((prev) => (prev.visible ? { ...prev, ...pos } : prev))
  }

  const hideTooltip = () => setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev))

  const bucketMinutes = coverage.bucket_seconds / 60

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>
            <Grid3x3 size={16} strokeWidth={1.75} className={styles.titleIcon} aria-hidden="true" />
            {t('channelMonitorV2.matrix.title')}
          </h2>
          <p className={styles.description}>{t('channelMonitorV2.matrix.description')}</p>
        </div>
        <div className={styles.tools}>
          <Badge size="sm">{bucketSpanLabel(t, bucketMinutes)}</Badge>
          <span className={styles.wheelHint}>{t('channelMonitorV2.matrix.wheelZoomX')}</span>
          <Button type="button" variant="secondary" size="sm" disabled={!zoomed} onClick={() => setZoom(resetZoom())}>
            {t('channelMonitorV2.matrix.resetZoom')}
          </Button>
        </div>
      </div>

      {rows.length ? (
        <div ref={scrollRef} className={styles.scroll} data-matrix-scroll="">
          <div className={styles.table} style={tableStyle}>
            <div className={styles.row} data-matrix-header="" data-tps={showThroughput ? '' : undefined}>
              <span className={styles.headCell}>{t('channelMonitorV2.matrix.dimension')}</span>
              <span className={styles.headCell}>{t('channelMonitorV2.metrics.successRate')}</span>
              <span className={styles.headCell}>{t('channelMonitorV2.metrics.ttft')}</span>
              {showThroughput ? <span className={styles.headCell}>{t('channelMonitorV2.metrics.tps')}</span> : null}
              <span className={styles.headCell}>{t('channelMonitorV2.metrics.cacheRate')}</span>
              <span className={[styles.headCell, styles.axis].join(' ')}>
                <i>{axisStart}</i>
                <i>{axisEnd}</i>
              </span>
            </div>
            {alignedRows.map((entry) => (
              <div key={rowKey(entry.row)} className={[styles.row, styles.bodyRow].join(' ')} data-tps={showThroughput ? '' : undefined}>
                <div className={styles.dimension} title={rowLabel(entry.row)}>
                  <span
                    className={styles.dot}
                    data-health={cellHealth(entry.row.health, entry.row.metrics.request_count)}
                    aria-hidden="true"
                  />
                  <strong className={styles.dimensionLabel}>{rowLabel(entry.row)}</strong>
                </div>
                <strong className={styles.summary}>{successRate(entry.row.metrics)}</strong>
                <strong className={styles.summary} title={latencyPrivacy(entry.row.metrics.ttft)}>
                  {formatMonitorMs(entry.row.metrics.ttft.p50_ms)}
                </strong>
                {showThroughput ? (
                  <strong className={styles.summary} title={exactTps(entry.row.metrics.tpm)}>
                    {formatTps(entry.row.metrics.tpm)}
                  </strong>
                ) : null}
                <strong className={styles.summary}>{formatMonitorPercent(entry.row.metrics.cache_rate)}</strong>
                <div className={styles.track} style={pulseStyle} data-pulse-track="">
                  {entry.slots.map((slot) => (
                    <span
                      key={slot.start}
                      className={styles.cell}
                      data-pulse-cell=""
                      data-health={slot.bucket ? cellHealth(slot.bucket.health, slot.bucket.metrics.request_count) : 'unknown'}
                      data-empty={slot.bucket ? undefined : ''}
                      tabIndex={0}
                      role="img"
                      aria-label={slotLabel(slot)}
                      onMouseEnter={(event) => showTooltip(event, slot)}
                      onMouseMove={moveTooltip}
                      onMouseLeave={hideTooltip}
                      onFocus={(event) => showTooltip(event, slot)}
                      onBlur={hideTooltip}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.empty}>
          <EmptyState title={t('channelMonitorV2.matrix.emptyTitle')} description={t('channelMonitorV2.empty.description')} />
        </div>
      )}

      <div className={styles.legend} aria-label={t('channelMonitorV2.matrix.legendAria')}>
        <div className={styles.scale}>
          <span>{t('channelMonitorV2.matrix.bad')}</span>
          <div className={styles.scaleBar} aria-hidden="true" />
          <span>{t('channelMonitorV2.matrix.good')}</span>
        </div>
        <div className={styles.legendItems}>
          <span className={styles.legendItem}>
            <i className={styles.dot} data-health="score10" aria-hidden="true" />
            {t('channelMonitorV2.matrix.healthyLegend')}
          </span>
          <span className={styles.legendItem}>
            <i className={styles.dot} data-health="score6" aria-hidden="true" />
            {t('channelMonitorV2.matrix.warningLegend')}
          </span>
          <span className={styles.legendItem}>
            <i className={styles.dot} data-health="score2" aria-hidden="true" />
            {t('channelMonitorV2.matrix.criticalLegend')}
          </span>
          <span className={styles.legendItem}>
            <i className={styles.dot} data-health="unknown" aria-hidden="true" />
            {t('channelMonitorV2.matrix.unknownLegend')}
          </span>
        </div>
      </div>

      {tooltip.visible && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.floatingTooltip} style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }} role="tooltip">
              {tooltip.lines.map((line, index) => (
                <span key={`${index}:${line}`} className={index === 0 ? styles.tooltipTitle : styles.tooltipLine}>
                  {line}
                </span>
              ))}
            </div>,
            document.body
          )
        : null}
    </section>
  )
}
