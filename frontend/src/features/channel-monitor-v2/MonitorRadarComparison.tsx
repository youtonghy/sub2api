/**
 * 渠道对比卡片：在已加载的矩阵行里挑 2–3 行，用 Arc Pro 雷达图比较成功率、首字延迟、缓存率
 * （以及在允许显示时的吞吐量与请求量）。默认取请求量前 3，不发额外请求。
 */
import { Radar } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { MonitorMatrixRow } from '@/api/channelMonitorV2'
import { RadarChart, type RadarAxis, type RadarSeries } from '@/components/arc/radar-chart/radar-chart'
import { Skeleton } from '@/components/arc/skeleton/skeleton'
import EmptyState from '@/components/common/EmptyState'
import { useI18n } from '@/i18n/useI18n'
import FilterMultiSelect from './FilterMultiSelect'
import { formatMonitorMs, formatMonitorPercent, formatMonitorThroughput } from './monitorFormat'
import {
  buildMonitorRadarProfiles,
  comparableMonitorRows,
  limitComparedKeys,
  MAX_COMPARED_ROWS,
  monitorRadarAxisKeys,
  resolveComparedKeys,
  type MonitorRadarAxisKey
} from './monitorRadar'
import { monitorRowKey, monitorRowLabel } from './monitorViewModel'
import { useRadarChartLabels } from './useRadarChartLabels'
import styles from './MonitorRadarComparison.module.css'

export interface MonitorRadarComparisonProps {
  /** 页面已加载的矩阵行（不再额外请求） */
  rows: MonitorMatrixRow[]
  /** 为 false 时去掉吞吐量和请求量轴（隐私设置） */
  showThroughput: boolean
  /** 矩阵尚未返回时显示骨架屏 */
  loading?: boolean
}

export default function MonitorRadarComparison({ rows, showThroughput, loading = false }: MonitorRadarComparisonProps) {
  const { t } = useI18n()
  const labels = useRadarChartLabels()
  const otherModels = t('channelMonitorV2.otherModels')
  // 空数组表示使用默认（请求量前 3）
  const [selected, setSelected] = useState<string[]>([])

  const candidates = useMemo(() => comparableMonitorRows(rows), [rows])
  const options = useMemo(
    () => candidates.map((row) => ({ value: monitorRowKey(row), label: monitorRowLabel(row, otherModels) })),
    [candidates, otherModels]
  )
  const compared = useMemo(() => resolveComparedKeys(selected, rows), [selected, rows])
  const profiles = useMemo(() => buildMonitorRadarProfiles(rows, compared, otherModels), [rows, compared, otherModels])

  const axisKeys = monitorRadarAxisKeys(showThroughput)
  const axes: RadarAxis[] = axisKeys.map((key) => ({ key, label: t(`radarUi.axes.${key}`), max: 100 }))
  const series: RadarSeries[] = profiles.map((profile) => ({
    key: profile.key,
    label: profile.label,
    values: Object.fromEntries(axisKeys.map((key) => [key, profile.scores[key]]))
  }))
  const rawByKey = new Map(profiles.map((profile) => [profile.key, profile.raw]))

  // 提示框与读屏表格显示真实数值，而不是归一后的分数
  const formatValue = (_score: number, axis: RadarAxis, item?: RadarSeries) => {
    const raw = item ? rawByKey.get(item.key)?.[axis.key as MonitorRadarAxisKey] : null
    if (raw == null) return t('radarUi.values.noData')
    switch (axis.key as MonitorRadarAxisKey) {
      case 'success':
      case 'cache':
        return formatMonitorPercent(raw)
      case 'ttft':
      case 'ttftTail':
        return formatMonitorMs(raw)
      case 'throughput':
        return t('radarUi.values.tokensPerSecond', { value: formatMonitorThroughput(raw) })
      case 'volume':
        return t('radarUi.values.rpm', { value: formatMonitorThroughput(raw) })
      default:
        return String(raw)
    }
  }

  let body
  if (loading && !rows.length) {
    body = (
      <div className={styles.placeholder}>
        <Skeleton label={t('common.loading')} lines={5} />
      </div>
    )
  } else if (!candidates.length) {
    body = (
      <div className={styles.placeholder}>
        <EmptyState title={t('radarUi.empty.title')} description={t('radarUi.empty.description')} />
      </div>
    )
  } else {
    body = (
      <RadarChart
        className={styles.chart}
        axes={axes}
        series={series}
        label={t('radarUi.chartLabel')}
        max={100}
        size={300}
        formatValue={formatValue}
        showGap={false}
        emptyLabel={labels.empty}
        labels={labels}
      />
    )
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>
            <Radar size={16} strokeWidth={1.75} className={styles.titleIcon} aria-hidden="true" />
            {t('radarUi.title')}
          </h2>
          <p className={styles.description}>{t('radarUi.description')}</p>
        </div>
        {candidates.length > 0 && (
          <div className={styles.tools}>
            <FilterMultiSelect
              compact
              value={compared}
              label={t('radarUi.picker.label')}
              allLabel={t('radarUi.picker.defaultOption')}
              options={options}
              onChange={(next) => setSelected(limitComparedKeys(next))}
            />
            {candidates.length > MAX_COMPARED_ROWS && <span className={styles.hint}>{t('radarUi.picker.limitHint')}</span>}
          </div>
        )}
      </div>
      {body}
    </section>
  )
}
