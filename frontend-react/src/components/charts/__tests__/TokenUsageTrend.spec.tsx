import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { TrendDataPoint } from '@/types'
import TokenUsageTrend from '../TokenUsageTrend'

const { translate } = vi.hoisted(() => {
  const messages: Record<string, string> = {
    'admin.dashboard.tokenUsageTrend': 'Token Usage Trend',
    'admin.dashboard.noDataAvailable': 'No data available',
    'admin.dashboard.actual': 'Actual',
    'admin.dashboard.standard': 'Standard'
  }
  return { translate: (key: string) => messages[key] ?? key }
})

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: translate, te: () => true, locale: 'en', setLocale: vi.fn() })
}))

// 对应 Vue spec 中对 vue-chartjs Line 的桩：每张折线图输出其系列与数据
vi.mock('@/components/arc/line-chart/line-chart', () => ({
  LineChart: ({ data, series }: { data: unknown; series: unknown }) => (
    <div data-testid="chart-data">{JSON.stringify({ data, series })}</div>
  )
}))

interface ChartProps {
  data: { values: Record<string, number> }[]
  series: { key: string; label: string }[]
}

const hitRateChart = (): ChartProps => {
  const charts = screen.getAllByTestId('chart-data').map((node) => JSON.parse(node.textContent || '{}') as ChartProps)
  const chart = charts.find((item) => item.series.some((series) => series.label === 'Cache Hit Rate'))
  if (!chart) throw new Error('Cache Hit Rate chart not found')
  return chart
}

const point = (overrides: Partial<TrendDataPoint>): TrendDataPoint => ({
  date: '2026-05-08',
  requests: 1,
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  total_tokens: 0,
  cost: 0,
  actual_cost: 0,
  ...overrides
})

describe('TokenUsageTrend', () => {
  it('calculates cache hit rate against all prompt tokens', () => {
    render(
      <TokenUsageTrend
        trendData={[point({ input_tokens: 500, output_tokens: 100, cache_read_tokens: 1500, cost: 0.01, actual_cost: 0.005 })]}
      />
    )

    // Hit rate = 1500 / (500 + 1500 + 0) * 100 = 75%
    expect(hitRateChart().data[0].values.cacheHitRate).toBe(75)
  })

  it('returns 0 hit rate when all prompt tokens are zero', () => {
    render(<TokenUsageTrend trendData={[point({ requests: 0 })]} />)

    expect(hitRateChart().data[0].values.cacheHitRate).toBe(0)
  })

  it('includes cache_creation_tokens in denominator for Anthropic models', () => {
    render(
      <TokenUsageTrend
        trendData={[
          point({
            input_tokens: 200,
            output_tokens: 50,
            cache_creation_tokens: 300,
            cache_read_tokens: 500,
            cost: 0.02,
            actual_cost: 0.01
          })
        ]}
      />
    )

    // Hit rate = 500 / (200 + 500 + 300) * 100 = 50%
    expect(hitRateChart().data[0].values.cacheHitRate).toBe(50)
  })

  it('shows actual and standard cost of the latest point below the chart', () => {
    render(
      <TokenUsageTrend
        trendData={[
          point({ date: '2026-05-07', cost: 1, actual_cost: 0.5 }),
          point({ date: '2026-05-08', cost: 0.02, actual_cost: 0.01 })
        ]}
      />
    )

    expect(screen.getByText('2026-05-08')).toBeInTheDocument()
    expect(screen.getByText('Actual $0.010')).toBeInTheDocument()
    expect(screen.getByText('Standard $0.020')).toBeInTheDocument()
  })
})
