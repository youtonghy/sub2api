/**
 * 监控 KPI 卡片，对应 Vue 版 MetricCell.vue。
 * 值是已格式化的字符串（"90.0%"、"400ms"、"-"），并按健康状态着色，Arc metric-card 只接受数字且无状态色，
 * 因此沿用 metric-card 的外观自行实现。缺失值（- / —）不按状态着色，避免把无首 Token 样本画成红色。
 */
import type { HealthState } from '@/api/channelMonitorV2'
import { splitMetricDetail } from './monitorViewModel'
import styles from './MetricCell.module.css'

export interface MetricCellProps {
  label: string
  value: string
  detail: string
  state?: HealthState
  /** Exact numeric tooltip (e.g. uncompacted RPM/TPM). */
  title?: string
}

/** 值的显示状态：healthy / warning / critical / unknown 跟随健康状态，missing 为缺失值，neutral 为无状态 */
export type MetricCellTone = HealthState | 'missing' | 'neutral'

export default function MetricCell({ label, value, detail, state, title }: MetricCellProps) {
  const detailParts = splitMetricDetail(detail)
  const trimmed = (value || '').trim()
  const missingValue = trimmed === '' || trimmed === '-' || trimmed === '—'
  const resolvedState = missingValue ? undefined : state
  const tone: MetricCellTone = resolvedState ?? (missingValue ? 'missing' : 'neutral')

  return (
    <article className={styles.card} title={title || undefined}>
      {resolvedState ? <span className={styles.dot} data-state={resolvedState} aria-hidden="true" /> : null}
      <div className={styles.body}>
        <span className={styles.label}>{label}</span>
        <strong className={styles.value} data-state={tone}>
          {value}
        </strong>
        {detailParts.length > 1 ? (
          <div className={styles.chips}>
            {detailParts.map((part, index) => (
              <span key={`${index}:${part}`} className={styles.chip}>
                {part}
              </span>
            ))}
          </div>
        ) : detail ? (
          <small className={styles.detail}>{detail}</small>
        ) : null}
      </div>
    </article>
  )
}
