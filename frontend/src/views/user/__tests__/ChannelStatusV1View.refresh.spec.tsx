import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MonitorHeroProps } from '@/components/user/monitor/MonitorHero'
import { useAppStore } from '@/stores/app'
import type { PublicSettings } from '@/types'
import ChannelStatusV1View from '../ChannelStatusV1View'

const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/api/channelMonitor', () => ({ list, status: vi.fn() }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/user/MonitorDetailDialog', () => ({ default: () => null }))
vi.mock('@/components/user/monitor/MonitorCardGrid', () => ({ default: () => null }))
vi.mock('@/components/user/monitor/MonitorHero', () => ({
  default: ({ autoRefresh, onRefresh }: MonitorHeroProps) => (
    <div>
      <button className="interval" onClick={() => autoRefresh?.setInterval(120)}>120 seconds</button>
      <button className="refresh" onClick={() => onRefresh?.()}>Refresh</button>
      <button className="disable" onClick={() => autoRefresh?.setEnabled(false)}>Disable</button>
    </div>
  )
}))

const flushPromises = () => act(async () => {})
const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms)
})
const click = async (selector: string) => {
  await act(async () => {
    fireEvent.click(document.querySelector(selector)!)
  })
}

let view: ReturnType<typeof render> | null = null
const mountView = () => {
  view = render(<ChannelStatusV1View />)
  return view
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  list.mockReset().mockResolvedValue({ items: [] })
  useAppStore.setState({ cachedPublicSettings: { channel_monitor_enabled: true } as PublicSettings, showError: vi.fn() })
})
afterEach(() => {
  view?.unmount()
  view = null
  vi.useRealTimers()
  localStorage.clear()
})

describe('channel monitor refresh interval', () => {
  it('keeps automatic refresh disabled after reopening the page', async () => {
    mountView()
    await flushPromises()
    await click('.disable')
    view!.unmount()
    mountView()
    await flushPromises()
    const calls = list.mock.calls.length
    await advance(240000)
    expect(list).toHaveBeenCalledTimes(calls)
    expect(JSON.parse(localStorage.getItem('channel-status-auto-refresh')!).enabled).toBe(false)
    await click('.refresh')
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(calls + 1)
  })

  it('starts automatic refresh for a first visit', async () => {
    mountView()
    await flushPromises()
    await advance(120000)
    expect(list.mock.calls.length).toBeGreaterThan(1)
  })

  it('refreshes at the selected interval on successive automatic refreshes', async () => {
    mountView()
    await flushPromises()
    await click('.interval')
    await advance(119000)
    expect(list).toHaveBeenCalledTimes(1)
    await advance(1000)
    expect(list).toHaveBeenCalledTimes(2)
    await advance(119000)
    expect(list).toHaveBeenCalledTimes(2)
    await advance(1000)
    expect(list).toHaveBeenCalledTimes(3)
  })

  it('preserves the selected interval after a manual refresh', async () => {
    mountView()
    await flushPromises()
    await click('.interval')
    await click('.refresh')
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(2)
    await advance(119000)
    expect(list).toHaveBeenCalledTimes(2)
    await advance(1000)
    expect(list).toHaveBeenCalledTimes(3)
  })

  it('honors a persisted interval after the initial load', async () => {
    localStorage.setItem('channel-status-auto-refresh', JSON.stringify({ enabled: true, interval_seconds: 120 }))
    mountView()
    await flushPromises()
    await advance(119000)
    expect(list).toHaveBeenCalledTimes(1)
    await advance(1000)
    expect(list).toHaveBeenCalledTimes(2)
    await click('.disable')
    await advance(120000)
    expect(list).toHaveBeenCalledTimes(2)
  })
})
