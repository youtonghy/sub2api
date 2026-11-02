import { useCallback, useState } from 'react'

import type { LineChartSeries } from '@/components/arc/line-chart/line-chart'

/**
 * Arc line-chart 图例的受控隐藏状态，至少保留一个可见系列
 * （与 Arc donut-chart 的行为一致，也避免出现 Arc 内置的英文“全部隐藏”提示）。
 */
export function useKeepOneSeries(series: LineChartSeries[]) {
  const [hidden, setHidden] = useState<string[]>([])
  const onHiddenChange = useCallback(
    (next: string[]) => {
      if (series.every((item) => next.includes(item.key))) return
      setHidden(next)
    },
    [series]
  )
  return { hidden: hidden.filter((key) => series.some((item) => item.key === key)), onHiddenChange }
}
