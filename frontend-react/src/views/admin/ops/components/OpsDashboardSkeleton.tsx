/**
 * 运维监控页首次加载时的骨架屏，按最终布局排布：工具栏、KPI 行、
 * 并发与吞吐行、三联分析图、告警事件。
 */
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import { useI18n } from '@/i18n/useI18n'
import panel from './OpsPanel.module.css'
import styles from './OpsDashboardSkeleton.module.css'

interface Props {
  fullscreen?: boolean
}

export default function OpsDashboardSkeleton({ fullscreen = false }: Props) {
  const { t } = useI18n()
  const label = t('common.loading')

  return (
    <div className={styles.root} data-testid="ops-dashboard-skeleton">
      {/* Header (matches OpsDashboardHeader toolbar + KPI row) */}
      <div className={styles.toolbar}>
        <span className={styles.block} data-size="title" />
        {!fullscreen && (
          <div className={styles.controls}>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={styles.block} data-size="control" />
            ))}
          </div>
        )}
      </div>
      <div className={styles.kpis}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.kpi}>
            <Skeleton label={label} lines={3} />
          </div>
        ))}
      </div>

      {/* Row: Concurrency + Throughput (matches OpsDashboard) */}
      <div className={styles.rowQuad}>
        <div className={panel.panel}><Skeleton label={label} lines={6} /></div>
        <div className={panel.panel}><Skeleton label={label} lines={6} /></div>
        <div className={`${panel.panel} ${styles.span2}`}><Skeleton label={label} lines={6} /></div>
      </div>

      {/* Row: Visual Analysis (baseline 3-up grid) */}
      <div className={styles.rowTriple}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={panel.panel}><Skeleton label={label} lines={5} /></div>
        ))}
      </div>

      {/* Alert Events */}
      <div className={panel.panel}>
        <Skeleton label={label} lines={6} />
      </div>
    </div>
  )
}
