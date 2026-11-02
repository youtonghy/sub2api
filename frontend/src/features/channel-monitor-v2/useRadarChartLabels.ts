/**
 * Arc Pro radar-chart 的读屏文案，按当前语言组装成组件的 labels。
 */
import { useMemo } from 'react'

import type { RadarChartLabels } from '@/components/arc/radar-chart/radar-chart'
import { useI18n } from '@/i18n/useI18n'

export function useRadarChartLabels(): RadarChartLabels & { empty: string } {
  const { t, locale } = useI18n()
  return useMemo(
    () => ({
      roleDescription: t('radarUi.chart.roleDescription'),
      keyboardHint: (label: string) => t('radarUi.chart.keyboardHint', { label }),
      profiles: (label: string) => t('radarUi.chart.profiles', { label }),
      measure: t('radarUi.chart.measure'),
      empty: t('radarUi.chart.empty')
    }),
    // locale 变化时重新取文案
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale]
  )
}
