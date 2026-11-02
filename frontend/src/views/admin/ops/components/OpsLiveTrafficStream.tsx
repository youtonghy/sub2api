/**
 * 实时流量：每 5 秒读取最近 1 分钟的实时 QPS / TPS，用 Arc Pro 实时流图滚动显示最近 5 分钟。
 * 只在设置中开启实时监控且页面可见时轮询；突增（不低于前 12 个读数均值的 2 倍）标记为异常点。
 */
import { Activity } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { opsAPI } from '@/api/admin/ops'
import { RealtimeStream, type StreamPoint } from '@/components/arc/realtime-stream/realtime-stream'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { useRealtimeStreamLabels } from '@/components/charts/useArcChartLabels'
import { useI18n } from '@/i18n/useI18n'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import panel from './OpsPanel.module.css'
import styles from './OpsLiveTrafficStream.module.css'

type LiveMetric = 'qps' | 'tps'

const POLL_MS = 5_000
const WINDOW_MS = 5 * 60_000
/** 保留约两个窗口的读数 */
const KEEP_POINTS = 120
const SPIKE_LOOKBACK = 12
const EMPTY: StreamPoint[] = []

export interface OpsLiveTrafficStreamProps {
  platformFilter: string
  groupIdFilter: number | null
}

const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function append(list: StreamPoint[], t: number, value: number, spikeLabel: string): StreamPoint[] {
  const recent = list.slice(-SPIKE_LOOKBACK)
  const mean = recent.length ? recent.reduce((sum, point) => sum + point.value, 0) / recent.length : 0
  const spike = recent.length >= 3 && mean > 0 && value >= mean * 2
  return [...list.slice(-(KEEP_POINTS - 1)), { t, value, anomaly: spike ? spikeLabel : undefined }]
}

export default function OpsLiveTrafficStream({ platformFilter, groupIdFilter }: OpsLiveTrafficStreamProps) {
  const { t } = useI18n()
  const labels = useRealtimeStreamLabels()
  const enabled = useAdminSettingsStore((s) => s.opsRealtimeMonitoringEnabled)
  const [metric, setMetric] = useState<LiveMetric>('qps')
  // 读数按筛选条件归档：筛选变化后旧读数不再可比，从空图重新开始
  const filterKey = `${platformFilter}|${groupIdFilter ?? ''}`
  const [series, setSeries] = useState<{ key: string; qps: StreamPoint[]; tps: StreamPoint[] }>({ key: filterKey, qps: [], tps: [] })
  // 轮询回调读取最新语言的“突增”文案，切换语言不需要重启轮询
  const spikeText = t('opsUi.liveTraffic.spike')
  const spikeLabel = useRef(spikeText)
  useEffect(() => {
    spikeLabel.current = spikeText
  }, [spikeText])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let inFlight = false

    const load = async () => {
      if (inFlight || document.hidden) return
      inFlight = true
      try {
        const res = await opsAPI.getRealtimeTrafficSummary('1min', platformFilter, groupIdFilter)
        if (cancelled || !res.enabled || !res.summary) return
        setSeries((prev) => {
          const base = prev.key === filterKey ? prev : { key: filterKey, qps: [], tps: [] }
          const last = base.qps[base.qps.length - 1]?.t ?? 0
          const at = Math.max(Date.now(), last + 1)
          return {
            key: filterKey,
            qps: append(base.qps, at, finite(res.summary?.qps?.current), spikeLabel.current),
            tps: append(base.tps, at, finite(res.summary?.tps?.current), spikeLabel.current)
          }
        })
      } catch (err) {
        console.error('[OpsLiveTrafficStream] Failed to load realtime traffic summary', err)
      } finally {
        inFlight = false
      }
    }

    void load()
    const id = window.setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [enabled, platformFilter, groupIdFilter, filterKey])

  const metricOptions = [
    { value: 'qps', label: 'QPS' },
    { value: 'tps', label: 'TPS' }
  ]

  return (
    <section className={panel.panel} data-testid="ops-live-traffic">
      <div className={panel.header}>
        <h2 className={panel.title}>
          <Activity size={16} aria-hidden="true" />
          {t('opsUi.liveTraffic.title')}
        </h2>
        {enabled && (
          <SegmentedControl
            label={t('opsUi.liveTraffic.title')}
            options={metricOptions}
            value={metric}
            onValueChange={(value) => setMetric(value as LiveMetric)}
          />
        )}
      </div>
      {enabled ? (
        <RealtimeStream
          className={styles.stream}
          points={series.key === filterKey ? series[metric] : EMPTY}
          label={metric === 'qps' ? 'QPS' : 'TPS'}
          unit={metric === 'qps' ? 'QPS' : 'TPS'}
          windowMs={WINDOW_MS}
          interval={POLL_MS}
          height={180}
          min={0}
          formatValue={(value) => value.toFixed(1)}
          emptyLabel={labels.waiting}
          labels={labels}
        />
      ) : (
        <p className={panel.empty}>{t('opsUi.liveTraffic.disabled')}</p>
      )}
    </section>
  )
}
