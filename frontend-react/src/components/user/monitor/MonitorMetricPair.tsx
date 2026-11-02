import { Clock, Globe, Link, Zap, type LucideIcon } from 'lucide-react'

import styles from './MonitorCard.module.css'

export type MonitorMetricIcon = 'bolt' | 'globe' | 'clock' | 'link'

const ICONS: Record<MonitorMetricIcon, LucideIcon> = {
  bolt: Zap,
  globe: Globe,
  clock: Clock,
  link: Link
}

export interface MonitorMetricPairProps {
  primaryLabel: string
  primaryValue: string
  primaryUnit: string
  primaryIcon: MonitorMetricIcon
  secondaryLabel: string
  secondaryValue: string
  secondaryUnit: string
  secondaryIcon: MonitorMetricIcon
}

function Metric({ icon, label, value, unit }: { icon: MonitorMetricIcon; label: string; value: string; unit: string }) {
  const Icon = ICONS[icon]
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>
        <Icon size={12} strokeWidth={1.75} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className={styles.metricValue}>
        {value}
        <span className={styles.metricUnit}>{unit}</span>
      </div>
    </div>
  )
}

/** 监控卡片的两项延迟指标，对应 Vue 版 MonitorMetricPair.vue */
export default function MonitorMetricPair(props: MonitorMetricPairProps) {
  return (
    <div className={styles.metricPair}>
      <Metric icon={props.primaryIcon} label={props.primaryLabel} value={props.primaryValue} unit={props.primaryUnit} />
      <Metric
        icon={props.secondaryIcon}
        label={props.secondaryLabel}
        value={props.secondaryValue}
        unit={props.secondaryUnit}
      />
    </div>
  )
}
