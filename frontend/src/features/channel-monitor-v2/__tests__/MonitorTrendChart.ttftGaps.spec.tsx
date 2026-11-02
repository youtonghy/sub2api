import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LineChartDatum } from '@/components/arc/line-chart/line-chart'
import MonitorTrendChart, { type MonitorTrendPoint } from '../MonitorTrendChart'

const charts: { label: string; data: LineChartDatum[] }[] = []

vi.mock('@/components/arc/line-chart/line-chart', () => ({
  LineChart: (props: { label: string; data: LineChartDatum[] }) => {
    charts.push({ label: props.label, data: props.data })
    return null
  },
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

function point(minute: number, ttft: number | null): MonitorTrendPoint {
  return {
    bucket_start: new Date(Date.UTC(2026, 9, 31, 8, minute)).toISOString(),
    metrics: { error_rate: 0.01, cache_rate: 0.5, ttft: ttft === null ? null : { p50_ms: ttft } },
    health: 'healthy',
  } as unknown as MonitorTrendPoint
}

describe('MonitorTrendChart TTFT 缺失值', () => {
  it('TTFT 小图只绘制有数据的时间桶，不把缺失值画成 0', () => {
    charts.length = 0
    render(<MonitorTrendChart trend={[point(0, 120), point(1, null), point(2, 180)]} coverage={null} />)
    const ttftChart = charts.filter((chart) => chart.label.includes('ttft')).at(-1)
    expect(ttftChart).toBeDefined()
    const values = ttftChart!.data.map((item) => item.values.ttft)
    expect(values).not.toContain(0)
    expect(values.every((value) => typeof value === 'number')).toBe(true)
  })
})
