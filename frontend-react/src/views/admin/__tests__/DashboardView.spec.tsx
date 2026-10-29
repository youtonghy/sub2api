import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LineChartProps } from '@/components/arc/line-chart/line-chart'
import type { DateRangePickerProps } from '@/components/common/DateRangePicker'
import type { ModelDistributionChartProps } from '@/components/charts/ModelDistributionChart'
import type { DashboardStats } from '@/types'
import DashboardView from '../DashboardView'

const { getSnapshotV2, getUserUsageTrend, getUserSpendingRanking, getAccountUsageRanking, navigateMock, lineChart } =
  vi.hoisted(() => ({
    getSnapshotV2: vi.fn(),
    getUserUsageTrend: vi.fn(),
    getUserSpendingRanking: vi.fn(),
    getAccountUsageRanking: vi.fn(),
    navigateMock: vi.fn(),
    lineChart: { props: null as LineChartProps | null }
  }))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    dashboard: {
      getSnapshotV2,
      getUserUsageTrend,
      getUserSpendingRanking,
      getAccountUsageRanking
    }
  }
}))

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigateMock
}))

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false, locale: 'en', setLocale: vi.fn() })
}))

vi.mock('@/composables/useBatchImageAccess', () => ({
  useBatchImageAccess: () => ({ canUseBatchImage: false, refreshBatchImageAccess: vi.fn() })
}))

// 用户趋势折线图：记录最新 props，对应 Vue spec 中对 vue-chartjs Line 的桩
vi.mock('@/components/arc/line-chart/line-chart', () => ({
  LineChart: (props: LineChartProps) => {
    lineChart.props = props
    return <div data-testid="user-trend-chart" />
  }
}))

vi.mock('@/components/charts/TokenUsageTrend', () => ({
  default: () => <div data-testid="token-usage-trend" />
}))

// 排行图桩：提供一个按钮模拟点击排行中的用户
vi.mock('@/components/charts/ModelDistributionChart', () => ({
  default: ({ onRankingClick }: ModelDistributionChartProps) => (
    <button
      type="button"
      onClick={() => onRankingClick?.({ user_id: 7, email: 'u@example.com', username: 'u', actual_cost: 1, requests: 1, tokens: 1 })}
    >
      ranking-row
    </button>
  )
}))

// 日期选择桩：按钮直接应用 7 天或 1 天的区间
vi.mock('@/components/common/DateRangePicker', () => ({
  default: ({ onChange }: DateRangePickerProps) => (
    <>
      <button type="button" onClick={() => onChange?.({ startDate: '2026-01-01', endDate: '2026-01-07', preset: null })}>
        pick-7-days
      </button>
      <button type="button" onClick={() => onChange?.({ startDate: '2026-01-06', endDate: '2026-01-07', preset: null })}>
        pick-1-day
      </button>
    </>
  )
}))

async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const createDashboardStats = (): DashboardStats => ({
  total_users: 0,
  today_new_users: 0,
  active_users: 0,
  hourly_active_users: 0,
  stats_updated_at: '',
  stats_stale: false,
  total_api_keys: 0,
  active_api_keys: 0,
  total_accounts: 0,
  normal_accounts: 0,
  error_accounts: 0,
  ratelimit_accounts: 0,
  overload_accounts: 0,
  total_requests: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_cache_creation_tokens: 0,
  total_cache_read_tokens: 0,
  total_tokens: 0,
  total_cost: 0,
  total_actual_cost: 0,
  total_account_cost: 0,
  today_requests: 0,
  today_input_tokens: 0,
  today_output_tokens: 0,
  today_cache_creation_tokens: 0,
  today_cache_read_tokens: 0,
  today_tokens: 0,
  today_cost: 0,
  today_actual_cost: 0,
  today_account_cost: 0,
  average_duration_ms: 0,
  uptime: 0,
  rpm: 0,
  tpm: 0
})

const mountDashboard = () =>
  render(
    <MemoryRouter>
      <DashboardView />
    </MemoryRouter>
  )

describe('admin DashboardView', () => {
  beforeEach(() => {
    getSnapshotV2.mockReset()
    getUserUsageTrend.mockReset()
    getUserSpendingRanking.mockReset()
    getAccountUsageRanking.mockReset()
    navigateMock.mockReset()
    lineChart.props = null

    getSnapshotV2.mockResolvedValue({
      stats: createDashboardStats(),
      trend: [],
      models: []
    })
    getUserUsageTrend.mockResolvedValue({
      trend: [],
      start_date: '',
      end_date: '',
      granularity: 'hour'
    })
    getUserSpendingRanking.mockResolvedValue({
      ranking: [],
      total_actual_cost: 0,
      total_requests: 0,
      total_tokens: 0,
      start_date: '',
      end_date: ''
    })
    getAccountUsageRanking.mockResolvedValue({
      ranking: [],
      start_date: '',
      end_date: ''
    })
  })

  it('loads all four requests for the last 24 hours on mount', async () => {
    mountDashboard()
    await flushPromises()

    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const range = { start_date: formatLocalDate(yesterday), end_date: formatLocalDate(now) }

    expect(getSnapshotV2).toHaveBeenCalledTimes(1)
    expect(getSnapshotV2).toHaveBeenCalledWith(
      expect.objectContaining({ ...range, granularity: 'hour', include_stats: true, include_trend: true, include_model_stats: true })
    )
    expect(getUserUsageTrend).toHaveBeenCalledWith({ ...range, granularity: 'hour', limit: 12, metric: 'tokens' })
    expect(getUserSpendingRanking).toHaveBeenCalledWith({ ...range, limit: 12 })
    expect(getAccountUsageRanking).toHaveBeenCalledWith(range)

    // 批量生图入口受 useBatchImageAccess 控制
    expect(screen.queryByText('admin.dashboard.batchImage')).not.toBeInTheDocument()
    expect(screen.getByText('admin.dashboard.groupPricing').closest('a')).toHaveAttribute('href', '/admin/groups')
  })

  it('switches granularity automatically from the picked date range', async () => {
    mountDashboard()
    await flushPromises()

    fireEvent.click(screen.getByText('pick-7-days'))
    await flushPromises()
    expect(getSnapshotV2).toHaveBeenLastCalledWith(
      expect.objectContaining({ start_date: '2026-01-01', end_date: '2026-01-07', granularity: 'day', include_stats: false })
    )
    expect(getUserUsageTrend).toHaveBeenLastCalledWith(expect.objectContaining({ granularity: 'day' }))
    expect(getAccountUsageRanking).toHaveBeenLastCalledWith({ start_date: '2026-01-01', end_date: '2026-01-07' })
    expect(screen.getByRole('button', { name: 'admin.dashboard.day' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByText('pick-1-day'))
    await flushPromises()
    expect(getSnapshotV2).toHaveBeenLastCalledWith(
      expect.objectContaining({ start_date: '2026-01-06', end_date: '2026-01-07', granularity: 'hour' })
    )
    expect(screen.getByRole('button', { name: 'admin.dashboard.hour' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches metrics and ignores a stale tokens response', async () => {
    let resolveTokens!: (value: unknown) => void
    getUserUsageTrend.mockImplementationOnce(() => new Promise((resolve) => { resolveTokens = resolve }))
    getUserUsageTrend.mockResolvedValueOnce({
      trend: [{ date: '2026-01-01', user_id: 2, username: 'spender', email: '', requests: 1, tokens: 10, cost: 5, actual_cost: 5 }]
    })
    mountDashboard()
    await flushPromises()
    expect(getUserUsageTrend).toHaveBeenCalledWith(expect.objectContaining({ metric: 'tokens', limit: 12 }))

    fireEvent.click(screen.getByRole('button', { name: 'admin.dashboard.actualSpending' }))
    expect(getUserUsageTrend).toHaveBeenCalledWith(expect.objectContaining({ metric: 'actual_cost', limit: 12 }))
    await flushPromises()

    const seriesKey = lineChart.props!.series[0].key
    expect(lineChart.props!.data.map((point) => point.values[seriesKey])).toEqual([5])
    expect(lineChart.props!.formatTick!(5)).toBe('$5.00')

    resolveTokens({
      trend: [{ date: '2026-01-01', user_id: 1, username: 'tokens', email: '', requests: 1, tokens: 100, cost: 1, actual_cost: 1 }]
    })
    await flushPromises()
    expect(lineChart.props!.series.map((series) => series.label)).toEqual(['spender'])
    expect(lineChart.props!.data.map((point) => point.values[seriesKey])).toEqual([5])
  })

  it('opens the usage page filtered by the clicked ranking user and range', async () => {
    mountDashboard()
    await flushPromises()

    fireEvent.click(screen.getByText('pick-7-days'))
    await flushPromises()
    fireEvent.click(screen.getByText('ranking-row'))

    expect(navigateMock).toHaveBeenCalledWith('/admin/usage?user_id=7&start_date=2026-01-01&end_date=2026-01-07')
  })
})
