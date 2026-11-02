/**
 * Arc Pro 图表（分段条、旭日图、实时流、地平线图）的翻译文案，按当前语言组装成各组件的 labels。
 */
import { useMemo } from 'react'
import type { HorizonChartLabels } from '@/components/arc/blocks/horizon-chart/horizon-chart'
import type { RealtimeStreamLabels } from '@/components/arc/realtime-stream/realtime-stream'
import type { SplitBarLabels } from '@/components/arc/split-bar/split-bar'
import type { SunburstLabels } from '@/components/arc/sunburst/sunburst'
import { useI18n } from '@/i18n/useI18n'

export function useSplitBarLabels(): SplitBarLabels & { total: string } {
  const { t, locale } = useI18n()
  return useMemo(
    () => ({
      off: t('chartsUi.splitBar.off'),
      hidden: t('chartsUi.splitBar.hidden'),
      onlyShare: (label: string) => t('chartsUi.splitBar.onlyShare', { label }),
      hiddenMessage: (label: string) => t('chartsUi.splitBar.hiddenMessage', { label }),
      shownMessage: (label: string) => t('chartsUi.splitBar.shownMessage', { label }),
      keyboardHint: t('chartsUi.splitBar.keyboardHint'),
      segments: t('chartsUi.splitBar.segments'),
      total: t('chartsUi.splitBar.total')
    }),
    // locale 变化时重新取文案
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )
}

export function useSunburstLabels(): SunburstLabels & { empty: string } {
  const { t, locale } = useI18n()
  return useMemo(
    () => ({
      ofTotal: (share: string) => t('chartsUi.sunburst.ofTotal', { share }),
      ofParent: (share: string, parent: string) => t('chartsUi.sunburst.ofParent', { share, parent }),
      groups: (count: number) => t('chartsUi.sunburst.groups', { count }),
      backTo: (label: string) => t('chartsUi.sunburst.backTo', { label }),
      keyboardHint: t('chartsUi.sunburst.keyboardHint'),
      zoomIn: t('chartsUi.sunburst.zoomIn'),
      path: t('chartsUi.sunburst.path'),
      parts: t('chartsUi.sunburst.parts'),
      pathHeader: t('chartsUi.sunburst.pathHeader'),
      valueHeader: t('chartsUi.sunburst.valueHeader'),
      shareHeader: t('chartsUi.sunburst.shareHeader'),
      empty: t('chartsUi.sunburst.empty')
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )
}

export function useRealtimeStreamLabels(): RealtimeStreamLabels & { waiting: string } {
  const { t, locale } = useI18n()
  return useMemo(
    () => ({
      live: t('chartsUi.realtime.live'),
      paused: t('chartsUi.realtime.paused'),
      pausedWithNew: (count: number) => t('chartsUi.realtime.pausedWithNew', { count }),
      now: t('chartsUi.realtime.now'),
      secondsAgo: (seconds: number) => t('chartsUi.realtime.secondsAgo', { seconds }),
      resume: t('chartsUi.realtime.resume'),
      pause: t('chartsUi.realtime.pause'),
      anomaly: t('chartsUi.realtime.anomaly'),
      keyboardHint: (seconds: number) => t('chartsUi.realtime.keyboardHint', { seconds }),
      latestReadings: (count: number) => t('chartsUi.realtime.latestReadings', { count }),
      timeHeader: t('chartsUi.realtime.timeHeader'),
      valueHeader: t('chartsUi.realtime.valueHeader'),
      noteHeader: t('chartsUi.realtime.noteHeader'),
      waiting: t('chartsUi.realtime.waiting')
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )
}

export function useHorizonChartLabels(): HorizonChartLabels {
  const { t, locale } = useI18n()
  return useMemo(
    () => ({
      sort: t('chartsUi.horizon.sort'),
      sortRows: t('chartsUi.horizon.sortRows'),
      sortName: t('chartsUi.horizon.sortName'),
      sortPeak: t('chartsUi.horizon.sortPeak'),
      sortLatest: t('chartsUi.horizon.sortLatest'),
      sortedBy: {
        name: t('chartsUi.horizon.sortedByName'),
        peak: t('chartsUi.horizon.sortedByPeak'),
        latest: t('chartsUi.horizon.sortedByLatest')
      },
      bands: t('chartsUi.horizon.bands'),
      bandCount: t('chartsUi.horizon.bandCount'),
      bandsOf: (count: number, step: string) => t('chartsUi.horizon.bandsOf', { count, step }),
      latestDay: t('chartsUi.horizon.latestDay'),
      selectedDay: t('chartsUi.horizon.selectedDay'),
      below: t('chartsUi.horizon.below'),
      above: t('chartsUi.horizon.above'),
      oneBandCaption: (extent: string, baseline: string) => t('chartsUi.horizon.oneBandCaption', { extent, baseline }),
      bandsCaption: (count: number, step: string, baseline: string) =>
        t('chartsUi.horizon.bandsCaption', { count, step, baseline }),
      colorScale: (extent: string, baseline: string, count: number) =>
        t('chartsUi.horizon.colorScale', { extent, baseline, count }),
      empty: t('chartsUi.horizon.empty'),
      rows: (count: number) => t('chartsUi.horizon.rows', { count }),
      keyboardHint: t('chartsUi.horizon.keyboardHint'),
      dayExtremes: (day: string, top: string, topValue: string, bottom: string, bottomValue: string) =>
        t('chartsUi.horizon.dayExtremes', { day, top, topValue, bottom, bottomValue }),
      tableCaption: (title: string, baseline: string) => t('chartsUi.horizon.tableCaption', { title, baseline }),
      rowHeader: t('chartsUi.horizon.rowHeader'),
      latestHeader: t('chartsUi.horizon.latestHeader'),
      highestHeader: t('chartsUi.horizon.highestHeader'),
      lowestHeader: t('chartsUi.horizon.lowestHeader'),
      valueOn: (value: string, day: string) => t('chartsUi.horizon.valueOn', { value, day })
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )
}
