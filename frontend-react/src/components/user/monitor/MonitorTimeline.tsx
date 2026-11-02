import type { MonitorTimelinePoint } from '@/api/channelMonitor'
import { useChannelMonitorFormat } from '@/composables/useChannelMonitorFormat'
import { useI18n } from '@/i18n/useI18n'
import styles from './MonitorCard.module.css'

export interface MonitorTimelineProps {
  buckets?: MonitorTimelinePoint[]
  countdownSeconds: number
  length?: number
  maintenance?: boolean
}

interface Bar {
  status: string
  heightPct: number
  title: string
}

// 4 级高度 + 颜色双重编码：高=好+绿，短=坏+红，灰=未测试。
// 长绿(正常) > 中黄(降级) > 短红(失败/系统错误) > 很短灰(未测试)。
const STATUS_HEIGHT: Record<string, number> = {
  operational: 100,
  degraded: 65,
  failed: 35,
  error: 35,
  empty: 15
}

/** 最近 N 次检测的状态条，对应 Vue 版 MonitorTimeline.vue */
export default function MonitorTimeline({ buckets = [], countdownSeconds, length = 60, maintenance = false }: MonitorTimelineProps) {
  const { t } = useI18n()
  const { statusLabel, formatLatency, formatRelativeTime } = useChannelMonitorFormat()

  // Real points come newest-first; convert to oldest-first so the rightmost
  // bar represents "now". Pad the left with empty placeholders to keep the
  // bar count stable at `length`.
  const real = [...(buckets ?? [])].slice(0, length).reverse()
  const padCount = Math.max(0, length - real.length)
  const bars: Bar[] = []
  for (let i = 0; i < padCount; i += 1) {
    bars.push({ status: 'empty', heightPct: STATUS_HEIGHT.empty, title: '' })
  }
  for (const point of real) {
    const known = point.status in STATUS_HEIGHT
    bars.push({
      status: known ? point.status : 'empty',
      heightPct: STATUS_HEIGHT[point.status] ?? STATUS_HEIGHT.empty,
      title: `${formatRelativeTime(point.checked_at)} · ${statusLabel(point.status)} · ${formatLatency(point.latency_ms)}ms`
    })
  }

  return (
    <div className={styles.timeline}>
      <div className={styles.timelineHeader}>
        <span>{t('monitorCommon.history60pts', { n: length })}</span>
        <span className={styles.tabular}>{t('monitorCommon.nextUpdateIn', { n: countdownSeconds })}</span>
      </div>

      {maintenance ? (
        <div className={styles.maintenance}>{t('monitorCommon.maintenancePaused')}</div>
      ) : (
        <div className={styles.bars}>
          {bars.map((bar, idx) => (
            <div
              key={idx}
              className={styles.bar}
              data-status={bar.status}
              style={{ height: `${bar.heightPct}%` }}
              title={bar.title || undefined}
            />
          ))}
        </div>
      )}

      <div className={styles.timelineFooter}>
        <span>{t('monitorCommon.past')}</span>
        <span>{t('monitorCommon.now')}</span>
      </div>
    </div>
  )
}
