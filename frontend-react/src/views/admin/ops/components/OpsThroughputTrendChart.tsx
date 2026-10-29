import { TrendingUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import type {
  OpsThroughputGroupBreakdownItem,
  OpsThroughputPlatformBreakdownItem,
  OpsThroughputTrendPoint
} from '@/api/admin/ops'
import { Button } from '@/components/arc/button/button'
import { LineChart, type LineChartDatum, type LineChartSeries } from '@/components/arc/line-chart/line-chart'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import HelpTooltip from '@/components/common/HelpTooltip'
import { useI18n } from '@/i18n/useI18n'
import { formatNumber } from '@/utils/format'
import type { ChartState } from '../types'
import { formatHistoryLabel, sumNumbers } from '../utils/opsFormatters'
import panel from './OpsPanel.module.css'
import styles from './OpsThroughputTrendChart.module.css'

export interface OpsThroughputTrendChartProps {
  points: OpsThroughputTrendPoint[]
  loading: boolean
  timeRange: string
  byPlatform?: OpsThroughputPlatformBreakdownItem[]
  topGroups?: OpsThroughputGroupBreakdownItem[]
  fullscreen?: boolean
  onSelectPlatform?: (platform: string) => void
  onSelectGroup?: (groupId: number) => void
  onOpenDetails?: () => void
}

// Vue 版用双 y 轴同时画 QPS 与 TPS(K)；Arc line-chart 只有一个 y 轴，改为分段切换指标（共享同一组 x 标签）。
type ThroughputMetric = 'qps' | 'tps'

const SVG_STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity', 'font-size', 'font-family'] as const

/**
 * 把图表 SVG 连同计算后的样式栅格化为 PNG 并下载（Vue 版用 chart.js 的 toBase64Image）。
 * Arc 图表的颜色来自 CSS 变量，序列化前需要把计算值写回到克隆节点上。
 */
async function downloadSvgAsPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const rect = svg.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const clone = svg.cloneNode(true) as SVGSVGElement
  const sources = [svg, ...Array.from(svg.querySelectorAll('*'))]
  const targets = [clone, ...Array.from(clone.querySelectorAll('*'))]
  sources.forEach((source, index) => {
    const target = targets[index] as SVGElement | undefined
    if (!target) return
    const computed = window.getComputedStyle(source)
    for (const prop of SVG_STYLE_PROPS) {
      const value = computed.getPropertyValue(prop)
      if (value) target.style.setProperty(prop, value)
    }
  })
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const markup = new XMLSerializer().serializeToString(clone)
  const blobUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Failed to render chart image'))
      image.src = blobUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return
    context.fillStyle = window.getComputedStyle(svg).getPropertyValue('--surface').trim() || 'white'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png', 1)
    a.download = filename
    a.click()
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

export default function OpsThroughputTrendChart({
  points,
  loading,
  timeRange,
  byPlatform,
  topGroups,
  fullscreen = false,
  onSelectPlatform,
  onSelectGroup,
  onOpenDetails
}: OpsThroughputTrendChartProps) {
  const { t } = useI18n()
  const [metric, setMetric] = useState<ThroughputMetric>('qps')
  const chartRef = useRef<HTMLElement>(null)

  // Vue 版在 timeRange 变化后调用 chart.resetZoom()；Arc line-chart 没有缩放/平移，无需重置。

  const totalRequests = sumNumbers(points.map((p) => p.request_count))
  const hasData = points.length > 0 && totalRequests > 0

  const data = useMemo<LineChartDatum[]>(() => {
    if (!hasData) return []
    return points.map((p, index) => {
      const label = formatHistoryLabel(p.bucket_start, timeRange)
      return {
        key: `${p.bucket_start}-${index}`,
        label,
        axisLabel: label,
        values: {
          qps: p.qps ?? 0,
          tps: (p.tps ?? 0) / 1000
        }
      }
    })
  }, [hasData, points, timeRange])

  const tpsLabel = t('admin.ops.tpsK')
  const series = useMemo<LineChartSeries[]>(
    () => [metric === 'qps' ? { key: 'qps', label: 'QPS', area: true } : { key: 'tps', label: tpsLabel, area: true }],
    [metric, tpsLabel]
  )

  const state: ChartState = hasData ? 'ready' : loading ? 'loading' : 'empty'

  async function downloadChart() {
    const svg = chartRef.current?.querySelector('svg')
    if (!svg) return
    try {
      await downloadSvgAsPng(svg, `ops-throughput-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`)
    } catch (err) {
      console.error('[OpsThroughputTrendChart] Failed to download chart', err)
    }
  }

  const groups = topGroups ?? []
  const platforms = byPlatform ?? []

  return (
    <section className={[panel.panel, panel.fill].join(' ')}>
      <div data-testid="throughput-chart-header" className={styles.header}>
        <h2 className={panel.title}>
          <TrendingUp size={16} aria-hidden="true" className={styles.icon} />
          {t('admin.ops.throughputTrend')}
          {!fullscreen && <HelpTooltip content={t('admin.ops.tooltips.throughputTrend')} />}
        </h2>
        <div data-testid="throughput-chart-toolbar" className={styles.toolbar}>
          <SegmentedControl
            label={t('admin.ops.throughputTrend')}
            options={[
              { value: 'qps', label: 'QPS' },
              { value: 'tps', label: tpsLabel }
            ]}
            value={metric}
            onValueChange={(value) => setMetric(value === 'tps' ? 'tps' : 'qps')}
          />
          {!fullscreen && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={state !== 'ready'}
                title={t('admin.ops.requestDetails.title')}
                onClick={() => onOpenDetails?.()}
              >
                {t('admin.ops.requestDetails.details')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={state !== 'ready'}
                title={t('admin.ops.charts.downloadChartHint')}
                onClick={() => void downloadChart()}
              >
                {t('admin.ops.charts.downloadChart')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Drilldown chips (baseline interaction: click to set global filter) */}
      {groups.length > 0 ? (
        <div className={styles.chips}>
          {groups.map((g) => (
            <button key={g.group_id} type="button" className={styles.chip} onClick={() => onSelectGroup?.(g.group_id)}>
              <span className={styles.chipName}>{g.group_name || `#${g.group_id}`}</span>
              <span className={styles.chipCount}>{formatNumber(g.request_count)}</span>
            </button>
          ))}
        </div>
      ) : platforms.length > 0 ? (
        <div className={styles.chips}>
          {platforms.map((p) => (
            <button key={p.platform} type="button" className={styles.chip} onClick={() => onSelectPlatform?.(p.platform)}>
              <span className={styles.chipName}>{p.platform}</span>
              <span className={styles.chipCount}>{formatNumber(p.request_count)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.body}>
        <LineChart
          ref={chartRef}
          data={data}
          series={series}
          label={t('admin.ops.throughputTrend')}
          loading={state === 'loading'}
          emptyLabel={t('admin.ops.charts.emptyRequest')}
          categoryLabel={t('admin.ops.requestDetails.table.time')}
          height={fullscreen ? 280 : 220}
          formatValue={(value) => value.toFixed(1)}
          legend={false}
        />
      </div>
    </section>
  )
}
