/**
 * Arc Pro 漏斗图的翻译文案，按当前语言组装成 FunnelChart 的 labels。
 */
import { useMemo } from 'react'

import type { FunnelChartLabels } from '@/components/arc/funnel-chart/funnel-chart'
import { useI18n } from '@/i18n/useI18n'

export function useFunnelChartLabels(): FunnelChartLabels {
  const { t, locale } = useI18n()
  return useMemo(
    () => ({
      start: t('funnelUi.chart.start'),
      ofStart: (share: string) => t('funnelUi.chart.ofStart', { share }),
      total: t('funnelUi.chart.total'),
      // 英文句中步骤名小写（与组件默认一致），中文保持原样
      keptFrom: (share: string, step: string) =>
        t('funnelUi.chart.keptFrom', { share, step: locale === 'en' ? step.toLowerCase() : step }),
      entryStep: (unit: string) => (unit ? t('funnelUi.chart.entryStepUnit', { unit }) : t('funnelUi.chart.entryStep')),
      announce: (step: string, value: string, fromPrevious: string, fromFirst: string) =>
        t('funnelUi.chart.announce', { step, value, fromPrevious, fromFirst }),
      keyboardHint: t('funnelUi.chart.keyboardHint'),
      roleDescription: t('funnelUi.chart.roleDescription'),
      viewAll: t('funnelUi.chart.viewAll'),
      viewSplit: t('funnelUi.chart.viewSplit'),
      reachLast: (share: string) => t('funnelUi.chart.reachLast', { share }),
      stepHeader: t('funnelUi.chart.stepHeader'),
      shownTotalHeader: t('funnelUi.chart.shownTotalHeader'),
      keptHeader: t('funnelUi.chart.keptHeader'),
      ofFirstHeader: t('funnelUi.chart.ofFirstHeader')
    }),
    // locale 变化时重新取文案
    [t, locale]
  )
}
