import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsLiveTrafficStream from '../OpsLiveTrafficStream'

const mocks = vi.hoisted(() => ({
  enabled: true,
  summary: vi.fn(),
  streamProps: [] as Array<{ points: Array<{ value: number; anomaly?: string }>; label: string }>
}))

vi.mock('@/api/admin/ops', () => ({ opsAPI: { getRealtimeTrafficSummary: mocks.summary } }))
vi.mock('@/stores/adminSettings', () => ({
  useAdminSettingsStore: (select: (s: { opsRealtimeMonitoringEnabled: boolean }) => unknown) => select({ opsRealtimeMonitoringEnabled: mocks.enabled })
}))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/arc/realtime-stream/realtime-stream', () => ({
  RealtimeStream: (props: (typeof mocks.streamProps)[number]) => {
    mocks.streamProps.push(props)
    return <div data-testid="stream">{props.points.map((point) => point.value).join(',')}</div>
  }
}))

const respond = (qps: number) => ({ enabled: true, summary: { qps: { current: qps, peak: qps, avg: qps }, tps: { current: qps * 10, peak: 0, avg: 0 } } })

beforeEach(() => {
  vi.useFakeTimers()
  mocks.enabled = true
  mocks.streamProps.length = 0
  mocks.summary.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('OpsLiveTrafficStream', () => {
  it('polls the last minute every 5 seconds and marks a spike', async () => {
    for (const qps of [1, 1, 1, 5]) mocks.summary.mockResolvedValueOnce(respond(qps))
    render(<OpsLiveTrafficStream platformFilter="openai" groupIdFilter={7} />)
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(i === 0 ? 0 : 5_000)
      })
    }
    expect(mocks.summary).toHaveBeenCalledWith('1min', 'openai', 7)
    expect(screen.getByTestId('stream').textContent).toBe('1,1,1,5')
    const last = mocks.streamProps[mocks.streamProps.length - 1]
    expect(last.points.map((point) => point.anomaly)).toEqual([undefined, undefined, undefined, 'opsUi.liveTraffic.spike'])
  })

  it('starts over when the filter changes', async () => {
    mocks.summary.mockResolvedValue(respond(2))
    const { rerender } = render(<OpsLiveTrafficStream platformFilter="" groupIdFilter={null} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId('stream').textContent).toBe('2')
    mocks.summary.mockReset()
    mocks.summary.mockImplementation(() => new Promise(() => {}))
    rerender(<OpsLiveTrafficStream platformFilter="claude" groupIdFilter={null} />)
    expect(screen.getByTestId('stream').textContent).toBe('')
  })

  it('does not poll while realtime monitoring is off', async () => {
    mocks.enabled = false
    render(<OpsLiveTrafficStream platformFilter="" groupIdFilter={null} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(mocks.summary).not.toHaveBeenCalled()
    expect(screen.queryByTestId('stream')).toBeNull()
    expect(screen.getByText('opsUi.liveTraffic.disabled')).toBeInTheDocument()
  })
})
