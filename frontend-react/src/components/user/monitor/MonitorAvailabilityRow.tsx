import { hslForPct } from '@/composables/useChannelMonitorFormat'
import { useI18n } from '@/i18n/useI18n'
import styles from './MonitorCard.module.css'

export interface MonitorAvailabilityRowProps {
  windowLabel: string
  value: number | null
  samplesLabel?: string
}

/** 可用率大数字（按 0→100% 红→绿着色），对应 Vue 版 MonitorAvailabilityRow.vue */
export default function MonitorAvailabilityRow({ windowLabel, value, samplesLabel }: MonitorAvailabilityRowProps) {
  const { t } = useI18n()
  const displayValue = value === null || Number.isNaN(value) ? t('monitorCommon.latencyEmpty') : value.toFixed(2)
  const colour = hslForPct(value)
  const colorStyle = colour ? { color: colour } : undefined

  return (
    <>
      <div className={styles.availabilityRow}>
        <div className={styles.availabilityLabel}>{windowLabel}</div>
        <div className={styles.availabilityValue} style={colorStyle} data-empty={colour ? undefined : ''}>
          <span className={styles.availabilityNumber}>{displayValue}</span>
          <span className={styles.availabilityPercent}>%</span>
        </div>
      </div>
      {samplesLabel && <div className={styles.samplesLabel}>{samplesLabel}</div>}
    </>
  )
}
