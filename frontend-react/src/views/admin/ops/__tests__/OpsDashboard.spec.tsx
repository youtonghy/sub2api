import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

import OpsDashboard from '../OpsDashboard'
import { useAdminSettingsStore } from '@/stores'

const api = vi.hoisted(() => ({
  getAdvancedSettings: vi.fn(),
  getMetricThresholds: vi.fn(),
  getDashboardSnapshotV2: vi.fn(),
  getThroughputTrend: vi.fn(),
  getLatencyHistogram: vi.fn(),
  getErrorDistribution: vi.fn(),
  getDashboardOverview: vi.fn(),
  getErrorTrend: vi.fn()
}))

vi.mock('@/api/admin/ops', async (importOriginal) => ({ ...(await importOriginal<object>()), opsAPI: api, default: api }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

// 子组件各自有单测，这里只保留与页面编排相关的最小桩。
vi.mock('../components/OpsDashboardHeader', () => ({
  default: (props: any) => (
    <div data-testid="header" data-fullscreen={String(!!props.fullscreen)} data-time-range={props.timeRange}>
      <button type="button" onClick={() => props.onTimeRangeChange('6h')}>set-6h</button>
      <button type="button" onClick={() => props.onEnterFullscreen()}>enter-fullscreen</button>
    </div>
  )
}))
const { stub } = vi.hoisted(() => ({
  stub: (name: string) => () => ({ default: () => <div data-testid={name} /> })
}))
vi.mock('../components/OpsProviderRealtimeMonitor', stub('provider-monitor'))
vi.mock('../components/OpsAccountTTFTCard', stub('ttft'))
vi.mock('../components/OpsConcurrencyCard', stub('concurrency'))
vi.mock('../components/OpsSwitchRateTrendChart', stub('switch-rate'))
vi.mock('../components/OpsThroughputTrendChart', stub('throughput'))
vi.mock('../components/OpsLatencyChart', stub('latency'))
vi.mock('../components/OpsErrorDistributionChart', stub('error-distribution'))
vi.mock('../components/OpsErrorTrendChart', stub('error-trend'))
vi.mock('../components/OpsOpenAITokenStatsCard', stub('token-stats'))
vi.mock('../components/OpsAlertEventsCard', stub('alert-events'))
vi.mock('../components/OpsSystemLogTable', stub('system-logs'))
vi.mock('../components/OpsSettingsDialog', stub('settings-dialog'))
vi.mock('../components/OpsAlertRulesCard', stub('alert-rules'))
vi.mock('../components/OpsErrorDetailsModal', stub('error-details'))
vi.mock('../components/OpsErrorDetailModal', stub('error-detail'))
vi.mock('../components/OpsRequestDetailsModal', stub('request-details'))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/admin/ops" element={<><OpsDashboard /><LocationProbe /></>} />
        <Route path="/admin/settings" element={<><p>settings page</p><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('OpsDashboard', () => {
  beforeEach(() => {
    useAdminSettingsStore.setState({
      opsMonitoringEnabled: true,
      opsQueryModeDefault: 'auto',
      fetch: vi.fn().mockResolvedValue(undefined)
    })
    api.getAdvancedSettings.mockResolvedValue({
      display_alert_events: true,
      display_openai_token_stats: false,
      auto_refresh_enabled: false,
      auto_refresh_interval_seconds: 30
    })
    api.getMetricThresholds.mockResolvedValue(null)
    api.getDashboardSnapshotV2.mockResolvedValue({ overview: null, throughput_trend: { points: [] }, error_trend: { points: [] } })
    api.getThroughputTrend.mockResolvedValue({ points: [] })
    api.getLatencyHistogram.mockResolvedValue(null)
    api.getErrorDistribution.mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('redirects to settings when ops monitoring is disabled', async () => {
    useAdminSettingsStore.setState({ opsMonitoringEnabled: false })
    renderAt('/admin/ops')
    expect(await screen.findByText('settings page')).toBeInTheDocument()
    expect(api.getDashboardSnapshotV2).not.toHaveBeenCalled()
  })

  it('loads the dashboard with filters read from the URL', async () => {
    renderAt('/admin/ops?tr=6h&platform=openai&group_id=3&mode=raw')
    expect(await screen.findByTestId('header')).toHaveAttribute('data-time-range', '6h')
    expect(api.getDashboardSnapshotV2).toHaveBeenCalledWith(
      { platform: 'openai', group_id: 3, mode: 'raw', time_range: '6h' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(screen.getByTestId('alert-events')).toBeInTheDocument()
    expect(screen.queryByTestId('token-stats')).not.toBeInTheDocument()
  })

  it('refetches and writes non-default filters back to the URL', async () => {
    renderAt('/admin/ops')
    await screen.findByTestId('header')
    expect(api.getDashboardSnapshotV2).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('set-6h'))
    await waitFor(() => expect(api.getDashboardSnapshotV2).toHaveBeenCalledTimes(2))
    expect(api.getDashboardSnapshotV2.mock.calls[1][0]).toMatchObject({ time_range: '6h' })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/ops?tr=6h'))
  })

  it('renders fullscreen as a viewport overlay and exits with Escape', async () => {
    renderAt('/admin/ops')
    await screen.findByTestId('header')

    fireEvent.click(screen.getByText('enter-fullscreen'))
    await waitFor(() => expect(screen.getByTestId('header')).toHaveAttribute('data-fullscreen', 'true'))
    expect(screen.getByRole('region', { name: 'admin.ops.title' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/ops?fullscreen=1')
    // 全屏时不渲染设置与详情弹窗（与 Vue 一致）
    expect(screen.queryByTestId('settings-dialog')).not.toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.getByTestId('header')).toHaveAttribute('data-fullscreen', 'false'))
    expect(screen.queryByRole('region', { name: 'admin.ops.title' })).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-dialog')).toBeInTheDocument()
  })

  it('exits fullscreen from the overlay button', async () => {
    renderAt('/admin/ops?fullscreen=1')
    await screen.findByTestId('header')
    fireEvent.click(screen.getByRole('button', { name: /opsUi.exitFullscreen/ }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/admin\/ops$/))
  })
})
