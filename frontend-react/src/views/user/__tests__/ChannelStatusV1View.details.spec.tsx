import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MonitorHeroProps } from '@/components/user/monitor/MonitorHero'
import { useAppStore } from '@/stores/app'
import type { PublicSettings } from '@/types'
import ChannelStatusV1View from '../ChannelStatusV1View'

const mocks = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn() }))
vi.mock('@/api/channelMonitor', () => mocks)
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/user/MonitorDetailDialog', () => ({ default: () => null }))
vi.mock('@/components/user/monitor/MonitorHero', () => ({
  default: ({ loading, onWindowChange, onRefresh }: MonitorHeroProps) => (
    <div data-loading={String(loading)}>
      <button className="fifteen" onClick={() => onWindowChange?.('15d')}>15d</button>
      <button className="thirty" onClick={() => onWindowChange?.('30d')}>30d</button>
      <button className="refresh" onClick={() => onRefresh?.()}>Refresh</button>
    </div>
  )
}))
vi.mock('@/components/user/monitor/MonitorCard', () => ({
  default: ({ availabilityValue }: { availabilityValue: number | null }) => <output>{availabilityValue}</output>
}))

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

function detail(availability: number) {
  return { id: 1, models: [{ model: 'model', availability_15d: availability, availability_30d: availability }] }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  localStorage.clear()
  localStorage.setItem('channel-status-auto-refresh', JSON.stringify({ enabled: true, interval_seconds: 30 }))
  useAppStore.setState({
    cachedPublicSettings: { channel_monitor_enabled: true } as PublicSettings,
    showError: vi.fn()
  })
  mocks.list.mockImplementation(async () => ({
    items: [{ id: 1, name: 'Monitor', primary_model: 'model', primary_status: 'operational', availability_7d: 99 }]
  }))
  mocks.status.mockResolvedValue(detail(90))
})

const flushPromises = () => act(async () => {})
const click = async (selector: string) => {
  await act(async () => {
    fireEvent.click(document.querySelector(selector)!)
  })
}
const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms)
})
const output = () => screen.getByRole('status').textContent

describe('channel monitor automatic detail refresh', () => {
  it.each(['fifteen', 'thirty'])('refreshes the cached %s-day availability on timer ticks', async (tab) => {
    render(<ChannelStatusV1View />)
    await flushPromises()
    await click('.' + tab)
    await flushPromises()
    expect(output()).toBe('90')
    mocks.status.mockResolvedValue(detail(98))
    await advance(30000)
    await flushPromises()
    expect(output()).toBe('98')
    expect(mocks.status).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-loading]')!.getAttribute('data-loading')).toBe('false')
  })

  it('keeps the seven-day view on the list endpoint without extra detail requests', async () => {
    render(<ChannelStatusV1View />)
    await flushPromises()
    await advance(30000)
    await flushPromises()
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.status).not.toHaveBeenCalled()
    expect(output()).toBe('99')
  })

  it('still refreshes cached availability on manual reload', async () => {
    render(<ChannelStatusV1View />)
    await flushPromises()
    await click('.fifteen')
    await flushPromises()
    mocks.status.mockResolvedValue(detail(98))
    await click('.refresh')
    await flushPromises()
    expect(output()).toBe('98')
  })
})
