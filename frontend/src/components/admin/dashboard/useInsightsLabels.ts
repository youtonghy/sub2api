/**
 * 管理仪表盘 KPI 下钻与排行赛跑图的翻译文案，按当前语言组装成 Arc Pro 组件的 labels。
 */
import { useMemo } from 'react'
import type { KpiDrilldownLabels } from '@/components/arc/blocks/kpi-drilldown/kpi-drilldown'
import type { RaceBarChartLabels } from '@/components/arc/race-bar-chart/race-bar-chart'
import { useI18n } from '@/i18n/useI18n'
import { BREAKDOWN_DAYS } from './dashboardInsightsData'

/** 数字与日期格式化使用的 BCP 47 语言标签 */
export function useIntlLocale(): string {
  const { locale } = useI18n()
  return locale === 'zh' ? 'zh-CN' : 'en-US'
}

export function useKpiDrilldownLabels(): KpiDrilldownLabels {
  const { t, locale } = useI18n()
  return useMemo(
    () => ({
      compare: t('insightsUi.kpi.labels.compare'),
      dateRange: t('insightsUi.kpi.labels.dateRange'),
      range: (days: number) => t('insightsUi.kpi.labels.range', { days }),
      breakdown: t('insightsUi.kpi.labels.breakdown', { days: BREAKDOWN_DAYS }),
      breakDownBy: t('insightsUi.kpi.labels.breakDownBy'),
      segment: t('insightsUi.kpi.labels.segment'),
      share: t('insightsUi.kpi.labels.share'),
      shareRate: t('insightsUi.kpi.labels.shareRate'),
      value: t('insightsUi.kpi.labels.value', { days: BREAKDOWN_DAYS }),
      change: t('insightsUi.kpi.labels.change'),
      byDimension: (metric: string, dimension: string) => t('insightsUi.kpi.labels.byDimension', { metric, dimension }),
      backToOverview: t('insightsUi.kpi.labels.backToOverview'),
      versusPrevious: (days: number) => t('insightsUi.kpi.labels.versusPrevious', { days }),
      versusBefore: (value: string, days: number) => t('insightsUi.kpi.labels.versusBefore', { value, days }),
      lastDays: (days: number) => t('insightsUi.kpi.labels.lastDays', { days }),
      previousDays: (days: number) => t('insightsUi.kpi.labels.previousDays', { days }),
      chartSummary: (metric: string, days: number, from: string, to: string) =>
        t('insightsUi.kpi.labels.chartSummary', { metric, days, from, to }),
      periodEarlier: (value: string) => t('insightsUi.kpi.labels.periodEarlier', { value }),
      openCard: (metric: string, value: string, change: string, days: number) =>
        t('insightsUi.kpi.labels.openCard', { metric, value, change, days }),
      newSegment: t('insightsUi.kpi.labels.newSegment'),
      points: t('insightsUi.kpi.labels.points')
    }),
    // locale 变化时重新取文案
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )
}

export function useRaceBarChartLabels(): RaceBarChartLabels {
  const { t, locale } = useI18n()
  return useMemo(
    () => ({
      total: (value: string) => t('insightsUi.race.labels.total', { value }),
      roleDescription: t('insightsUi.race.labels.roleDescription'),
      plot: (label: string, period: string) => t('insightsUi.race.labels.plot', { label, period }),
      empty: t('insightsUi.race.labels.empty'),
      rank: (rank: number, count: number, share: string) => t('insightsUi.race.labels.rank', { rank, count, share }),
      versus: (change: string, period: string) => t('insightsUi.race.labels.versus', { change, period }),
      groups: t('insightsUi.race.labels.groups'),
      play: t('insightsUi.race.labels.play'),
      pause: t('insightsUi.race.labels.pause'),
      replay: t('insightsUi.race.labels.replay'),
      timeline: (label: string) => t('insightsUi.race.labels.timeline', { label }),
      reading: (item: string, rank: number, value: string) => t('insightsUi.race.labels.reading', { item, rank, value }),
      leads: (period: string, item: string, value: string) => t('insightsUi.race.labels.leads', { period, item, value }),
      itemHeader: t('insightsUi.race.labels.itemHeader')
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )
}
