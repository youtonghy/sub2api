import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { KpiDrilldownProps } from '@/components/arc/blocks/kpi-drilldown/kpi-drilldown'
import type { RaceBarChartProps } from '@/components/arc/race-bar-chart/race-bar-chart'
import DashboardKpiDrilldown from '../DashboardKpiDrilldown'
import DashboardUserRace from '../DashboardUserRace'

const { api, captured } = vi.hoisted(() => ({
  api: {
    getUsageTrend: vi.fn(),
    getModelStats: vi.fn(),
    getGroupStats: vi.fn(),
    getUserUsageTrend: vi.fn()
  },
  captured: { kpi: null as KpiDrilldownProps | null, race: null as RaceBarChartProps | null }
}))

vi.mock('@/api/admin', () => ({ adminAPI: { dashboard: api } }))

// 区块总在视口内，直接触发懒加载
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useInView: () => true
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'zh', setLocale: vi.fn() })
}))

vi.mock('@/components/arc/blocks/kpi-drilldown/kpi-drilldown', () => ({
  KpiDrilldown: (props: KpiDrilldownProps) => {
    captured.kpi = props
    return <div data-testid="kpi-drilldown" />
  }
}))

vi.mock('@/components/arc/race-bar-chart/race-bar-chart', () => ({
  RaceBarChart: (props: RaceBarChartProps) => {
    captured.race = props
    return <div data-testid="race-bar-chart" />
  }
}))

async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

const userPoint = (date: string, userId: number, actual: number) => ({
  date,
  user_id: userId,
  email: '',
  username: `user${userId}`,
  requests: 1,
  tokens: 1,
  cost: actual,
  actual_cost: actual
})

describe('DashboardKpiDrilldown', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    captured.kpi = null
    api.getUsageTrend.mockResolvedValue({ trend: [], start_date: '', end_date: '', granularity: 'day' })
    api.getModelStats.mockResolvedValue({ models: [], start_date: '', end_date: '' })
    api.getGroupStats.mockResolvedValue({ groups: [], start_date: '', end_date: '' })
  })

  it('waits for the main dashboard data, then loads one daily trend and two windows of model and group stats once', async () => {
    const { rerender } = render(<DashboardKpiDrilldown enabled={false} />)
    await flushPromises()
    expect(api.getUsageTrend).not.toHaveBeenCalled()

    rerender(<DashboardKpiDrilldown enabled />)
    await flushPromises()
    rerender(<DashboardKpiDrilldown enabled />)
    await flushPromises()

    expect(api.getUsageTrend).toHaveBeenCalledTimes(1)
    expect(api.getUsageTrend).toHaveBeenCalledWith(expect.objectContaining({ granularity: 'day' }))
    expect(api.getModelStats).toHaveBeenCalledTimes(2)
    expect(api.getGroupStats).toHaveBeenCalledTimes(2)

    expect(screen.getByTestId('kpi-drilldown')).toBeInTheDocument()
    expect(captured.kpi!.kpis!.map((kpi) => kpi.id)).toEqual(['requests', 'total_tokens', 'actual_cost', 'cost'])
    expect(captured.kpi!.kpis!.every((kpi) => kpi.series.length === 180)).toBe(true)
    expect(captured.kpi!.dimensions!.map((dimension) => dimension.value)).toEqual(['model', 'group'])
    expect(captured.kpi!.locale).toBe('zh-CN')
  })

  it('shows a retry action when a request fails and logs the error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.getGroupStats.mockRejectedValueOnce(new Error('boom'))
    render(<DashboardKpiDrilldown enabled />)
    await flushPromises()

    expect(screen.getByText('insightsUi.kpi.loadFailed')).toBeInTheDocument()
    expect(error).toHaveBeenCalledWith('[DashboardKpiDrilldown] Failed to load usage overview:', expect.any(Error))

    act(() => screen.getByRole('button', { name: 'insightsUi.kpi.retry' }).click())
    await flushPromises()
    expect(api.getUsageTrend).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('kpi-drilldown')).toBeInTheDocument()
    error.mockRestore()
  })
})

describe('DashboardUserRace', () => {
  beforeEach(() => {
    api.getUserUsageTrend.mockReset()
    captured.race = null
  })

  it('requests the top users by actual cost for the toolbar range and ignores a stale response', async () => {
    let resolveFirst!: (value: unknown) => void
    api.getUserUsageTrend.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    api.getUserUsageTrend.mockResolvedValueOnce({
      trend: [userPoint('2026-01-01', 2, 1), userPoint('2026-01-02', 2, 2)]
    })

    const { rerender } = render(<DashboardUserRace startDate="2026-01-01" endDate="2026-01-01" granularity="hour" reloadKey={0} />)
    expect(api.getUserUsageTrend).toHaveBeenLastCalledWith({
      start_date: '2026-01-01',
      end_date: '2026-01-01',
      granularity: 'hour',
      limit: 12,
      metric: 'actual_cost'
    })

    rerender(<DashboardUserRace startDate="2026-01-01" endDate="2026-01-07" granularity="day" reloadKey={0} />)
    await flushPromises()
    resolveFirst({ trend: [userPoint('2026-01-01 10:00', 9, 100)] })
    await flushPromises()

    expect(captured.race!.items).toEqual([{ id: 'user-2', label: 'user2' }])
    expect(captured.race!.frames.map((frame) => frame.values['user-2'])).toEqual([1, 3])
    expect(captured.race!.autoPlay).toBe(false)
    expect(captured.race!.defaultFrame).toBe(1)
    expect(captured.race!.formatValue!(3)).toBe('$3.00')
  })

  it('reloads when the toolbar refresh count changes', async () => {
    api.getUserUsageTrend.mockResolvedValue({ trend: [] })
    const { rerender } = render(<DashboardUserRace startDate="2026-01-01" endDate="2026-01-07" granularity="day" reloadKey={0} />)
    await flushPromises()
    expect(screen.getByText('admin.dashboard.noDataAvailable')).toBeInTheDocument()

    rerender(<DashboardUserRace startDate="2026-01-01" endDate="2026-01-07" granularity="day" reloadKey={1} />)
    await flushPromises()
    expect(api.getUserUsageTrend).toHaveBeenCalledTimes(2)
  })
})
