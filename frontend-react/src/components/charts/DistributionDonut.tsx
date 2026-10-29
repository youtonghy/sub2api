import { useMemo } from 'react'

import { DonutChart, type DonutChartDatum } from '@/components/arc/donut-chart/donut-chart'
import { useI18n } from '@/i18n/useI18n'
import styles from './charts.module.css'

const SHARE_TOKEN = '__share__'

export interface DistributionDonutProps {
  data: DonutChartDatum[]
  /** 图表名称（供读屏使用） */
  label: string
  formatValue: (value: number) => string
  /** 由明细表悬停驱动的高亮项 */
  activeKey: string | null
  onActiveChange: (key: string | null) => void
}

/**
 * 分布图共用的 Arc 环形图：不再合并小项（右侧明细表列出全部项，颜色一一对应），
 * 不显示自带图例（由明细表充当图例），中心读数使用翻译后的文案。
 */
export default function DistributionDonut({ data, label, formatValue, activeKey, onActiveChange }: DistributionDonutProps) {
  const { t, locale } = useI18n()
  const labels = useMemo(() => {
    const [sharePrefix = '', shareSuffix = ''] = t('chartsUi.shareOfTotal', { share: SHARE_TOKEN }).split(SHARE_TOKEN)
    return { sharePrefix, shareSuffix }
    // locale 变化时重新取文案
  }, [t, locale]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DonutChart
      className={styles.donut}
      data={data}
      label={label}
      formatValue={formatValue}
      totalLabel={t('common.total')}
      emptyLabel={t('admin.dashboard.noDataAvailable')}
      labels={labels}
      size={208}
      thickness={20}
      groupBelow={0}
      maxSegments={Number.POSITIVE_INFINITY}
      legend={false}
      activeKey={activeKey}
      onActiveChange={onActiveChange}
    />
  )
}
