import { Sunburst, type SunburstNode } from '@/components/arc/sunburst/sunburst'
import { useI18n } from '@/i18n/useI18n'
import { useSunburstLabels } from './useArcChartLabels'
import styles from './charts.module.css'

export interface DistributionSunburstProps {
  /** 第一圈的各项；带 children 的项会多一圈明细，点击可展开 */
  items: SunburstNode[]
  /** 图表名称（供读屏使用） */
  label: string
  formatValue: (value: number) => string
  /** 由明细表悬停驱动的高亮项 */
  activeKey: string | null
  onActiveChange: (key: string | null) => void
}

/**
 * 分布图共用的 Arc Pro 旭日图：右侧明细表充当图例（颜色与表格一一对应），不显示自带图例；
 * 悬停表格行高亮对应扇区，悬停扇区高亮对应行。
 */
export default function DistributionSunburst({ items, label, formatValue, activeKey, onActiveChange }: DistributionSunburstProps) {
  const { t } = useI18n()
  const labels = useSunburstLabels()
  return (
    <Sunburst
      className={styles.sunburst}
      data={{ id: '__total__', label: t('common.total'), children: items }}
      label={label}
      formatValue={formatValue}
      depth={2}
      size={232}
      legend={false}
      emptyLabel={labels.empty}
      labels={labels}
      activeId={activeKey}
      onActiveChange={onActiveChange}
    />
  )
}
