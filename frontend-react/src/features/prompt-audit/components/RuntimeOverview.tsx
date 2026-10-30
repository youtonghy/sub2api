/** Prompt Audit 运行时概览，对应 Vue 版 components/RuntimeOverview.vue */
import { Alert } from '@/components/arc/alert/alert'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import Skeleton from '@/components/common/Skeleton'
import { useI18n } from '@/i18n/useI18n'
import type { PromptAuditRuntime } from '../types'
import styles from './promptAudit.module.css'

export interface RuntimeOverviewProps {
  runtime: PromptAuditRuntime | null
  loading: boolean
  error: string
  onRefresh?: () => void
}

function statusDot(status: string): string {
  if (status === 'running') return styles.dotSuccess
  if (status === 'disabled') return styles.dotMuted
  if (status === 'degraded') return styles.dotWarning
  return styles.dotDanger
}

export default function RuntimeOverview({ runtime, loading, error, onRefresh }: RuntimeOverviewProps) {
  const { t, locale } = useI18n()

  const formatDate = (value: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))

  const statusItems = runtime
    ? [
        {
          label: t('admin.promptAudit.runtime.process'),
          value: t(`admin.promptAudit.status.${runtime.process_status}`),
          dot: statusDot(runtime.process_status)
        },
        { label: t('admin.promptAudit.runtime.mode'), value: t(`admin.promptAudit.mode.${runtime.effective_mode}`) },
        { label: t('admin.promptAudit.runtime.version'), value: `${runtime.active_config_version} / ${runtime.expected_config_version}` },
        { label: t('admin.promptAudit.runtime.workers'), value: `${runtime.worker_active} / ${runtime.worker_total}` },
        { label: t('admin.promptAudit.runtime.queue'), value: `${runtime.queue.active} / ${runtime.queue_capacity}` },
        {
          label: t('admin.promptAudit.runtime.dependencies'),
          value: `DB ${runtime.database_status} · Redis ${runtime.redis_status}`
        }
      ]
    : []

  const metrics = runtime?.guard_metrics
  const guardMetricItems = metrics
    ? [
        { label: t('admin.promptAudit.metrics.total'), value: metrics.total },
        { label: t('admin.promptAudit.metrics.allowed'), value: metrics.allowed },
        { label: t('admin.promptAudit.metrics.flagged'), value: metrics.flagged },
        { label: t('admin.promptAudit.metrics.blocked'), value: metrics.blocked },
        { label: t('admin.promptAudit.metrics.unavailable'), value: metrics.unavailable },
        { label: t('admin.promptAudit.metrics.timeouts'), value: metrics.timeouts },
        { label: t('admin.promptAudit.metrics.failovers'), value: metrics.failovers },
        { label: 'P95', value: metrics.latency_p95_ms != null ? `${metrics.latency_p95_ms} ms` : '—' }
      ]
    : []

  return (
    <section aria-labelledby="prompt-runtime-title" className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 id="prompt-runtime-title" className={styles.h2}>
            {t('admin.promptAudit.runtime.title')}
          </h2>
          <p className={styles.description}>{t('admin.promptAudit.runtime.description')}</p>
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={() => onRefresh?.()}>
          {t('admin.promptAudit.actions.refresh')}
        </Button>
      </div>

      {error ? (
        <Alert tone="danger" title={error} role="alert" />
      ) : loading && !runtime ? (
        <div className={styles.statusGrid} aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} height="4rem" />
          ))}
        </div>
      ) : runtime ? (
        <>
          <dl className={styles.statusGrid}>
            {statusItems.map((item) => (
              <div key={item.label} className={styles.statusItem}>
                <dt>{item.label}</dt>
                <dd>
                  {item.dot ? <span className={`${styles.dot} ${item.dot}`} /> : null}
                  <span className={styles.truncate}>{item.value}</span>
                </dd>
              </div>
            ))}
          </dl>

          <div className={styles.runtimeDetail}>
            <div className={styles.panel}>
              <h3 className={styles.h3}>{t('admin.promptAudit.runtime.guardMetrics')}</h3>
              <dl className={styles.metricMini}>
                {guardMetricItems.map((metric) => (
                  <div key={metric.label}>
                    <dt>{metric.label}</dt>
                    <dd>{metric.value}</dd>
                  </div>
                ))}
              </dl>
              <p className={`${styles.hint} ${styles.subText}`}>
                {t('admin.promptAudit.runtime.queueBreakdown', {
                  queued: runtime.queue.queued,
                  processing: runtime.queue.processing,
                  retry: runtime.queue.retry,
                  done: runtime.queue.done,
                  failed: runtime.queue.failed
                })}
                <span> · </span>
                {t('admin.promptAudit.runtime.deliveryTotals', {
                  enqueued: runtime.enqueued_total,
                  dropped: runtime.dropped_total,
                  processed: runtime.processed_total,
                  failed: runtime.failed_total
                })}
              </p>
            </div>
            <div className={styles.panel}>
              <h3 className={styles.h3}>{t('admin.promptAudit.runtime.latest')}</h3>
              <p className={styles.description}>
                {runtime.last_processed_at ? formatDate(runtime.last_processed_at) : t('admin.promptAudit.common.never')}
              </p>
              {runtime.last_error_code ? (
                <p className={`${styles.description} ${styles.dangerText} ${styles.breakAll}`}>
                  {runtime.last_error_code}
                  {runtime.last_error_message ? <span> · {runtime.last_error_message}</span> : null}
                </p>
              ) : null}
              {Object.keys(runtime.endpoints).length ? (
                <div className={styles.probeChips}>
                  {Object.entries(runtime.endpoints).map(([id, probe]) => (
                    <Badge key={id} tone={probe.ok ? 'success' : 'danger'} size="sm">
                      {`${id} · ${probe.status} · ${probe.latency_ms} ms`}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
