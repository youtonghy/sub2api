import { formatScaled } from '@/utils/pricing'
import styles from './SupportedModelChip.module.css'

export interface PricingRowProps {
  label: string
  value?: number | null
  unit: string
  scale: number
}

/** 价格明细的一行（标签 + 换算后的价格），对应 Vue 版 PricingRow.vue */
export default function PricingRow({ label, value = null, unit, scale }: PricingRowProps) {
  const display = value == null ? '-' : `${formatScaled(value, scale)} ${unit}`
  return (
    <div className={styles.row} data-testid="pricing-row">
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.mono}>{display}</span>
    </div>
  )
}
