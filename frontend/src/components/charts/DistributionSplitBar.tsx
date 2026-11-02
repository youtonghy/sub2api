import { useMemo } from 'react'

import { SplitBar, type SplitSegment } from '@/components/arc/split-bar/split-bar'
import { useI18n } from '@/i18n/useI18n'
import { OTHER_COLOR, type DistributionMetric } from './chartUtils'
import { useSplitBarLabels } from './useArcChartLabels'
import styles from './charts.module.css'

/** 分段条最多单独显示的项数，其余合并为“其他” */
const MAX_SEGMENTS = 7
const SPLIT_OTHER_KEY = '__other__'

export interface DistributionSplitBarProps {
  /** 已按指标降序排列的各项，颜色与明细表一致 */
  data: { key: string; label: string; value: number; color: string }[]
  label: string
  metric: DistributionMetric
  /** 由明细表悬停驱动的高亮项；排在第 7 项之后的行高亮“其他” */
  activeKey: string | null
  onActiveChange: (key: string | null) => void
}

/** 分布图共用的 Arc Pro 分段条：一条 100% 横条，前 7 项单独显示，其余合并为“其他”；明细表充当图例 */
export default function DistributionSplitBar({ data, label, metric, activeKey, onActiveChange }: DistributionSplitBarProps) {
  const { t } = useI18n()
  const labels = useSplitBarLabels()

  const segments = useMemo<SplitSegment[]>(() => {
    const head = data.slice(0, MAX_SEGMENTS).map((item) => ({ id: item.key, label: item.label, value: item.value, color: item.color }))
    const rest = data.slice(MAX_SEGMENTS).reduce((sum, item) => sum + item.value, 0)
    return rest > 0 ? [...head, { id: SPLIT_OTHER_KEY, label: t('admin.dashboard.spendingRankingOther'), value: rest, color: OTHER_COLOR }] : head
  }, [data, t])

  const activeId = useMemo(() => {
    if (!activeKey) return null
    return segments.some((segment) => segment.id === activeKey) ? activeKey : SPLIT_OTHER_KEY
  }, [activeKey, segments])

  return (
    <SplitBar
      className={styles.splitBar}
      segments={segments}
      label={label}
      legend={false}
      totalLabel={labels.total}
      format={metric === 'actual_cost' ? { style: 'currency', currency: 'USD', maximumFractionDigits: 2 } : { notation: 'compact', maximumFractionDigits: 2 }}
      labels={labels}
      activeId={activeId}
      onActiveChange={(id) => onActiveChange(id === SPLIT_OTHER_KEY ? null : id)}
    />
  )
}
