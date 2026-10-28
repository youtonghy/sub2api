import { ArrowUp } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

import styles from './StatCard.module.css'

export type StatCardChangeType = 'up' | 'down' | 'neutral'
export type StatCardIconVariant = 'primary' | 'success' | 'warning' | 'danger'

export interface StatCardProps {
  title: string
  value: number | string
  /** 图标组件（如 lucide-react 图标），对应 Vue 版的 icon Component */
  icon?: ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>
  iconVariant?: StatCardIconVariant
  /** 百分比变化，显示绝对值 */
  change?: number
  changeType?: StatCardChangeType
  formatValue?: (value: number | string) => string
}

/**
 * 统计卡片：图标 + 标题 + 数值 + 涨跌百分比。
 * Arc 没有接受预格式化字符串与涨跌箭头的统计卡（metric-card 只接受数字），这里用 Arc token 自绘。
 */
export default function StatCard({
  title,
  value,
  icon: Icon,
  iconVariant = 'primary',
  change,
  changeType = 'neutral',
  formatValue
}: StatCardProps) {
  const formattedValue = formatValue ? formatValue(value) : typeof value === 'number' ? value.toLocaleString() : value
  const formattedChange = change === undefined ? '' : `${Math.abs(change)}%`

  return (
    <div className={styles.card}>
      <div className={styles.icon} data-variant={iconVariant}>
        {Icon && <Icon width={24} height={24} aria-hidden="true" />}
      </div>
      <div className={styles.body}>
        <p className={styles.label}>{title}</p>
        <div className={styles.valueRow}>
          <p className={styles.value} title={String(formattedValue)}>
            {formattedValue}
          </p>
          {change !== undefined && (
            <span className={styles.trend} data-change={changeType}>
              {changeType !== 'neutral' && (
                <ArrowUp size={12} strokeWidth={1.75} aria-hidden="true" className={changeType === 'down' ? styles.down : undefined} />
              )}
              {formattedChange}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
