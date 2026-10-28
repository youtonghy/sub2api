import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getEntry: vi.fn(),
  fetchOne: vi.fn(),
}))

vi.mock('@/utils/ipGeoLookup', () => ({
  getEntry: mocks.getEntry,
  fetchOne: mocks.fetchOne,
  // React 版通过订阅缓存变化触发重渲染
  subscribeIpGeo: () => () => {},
  getIpGeoRevision: () => 0,
}))

vi.mock('@/i18n/useI18n', () => {
  const table: Record<string, string> = {
    'usage.ipGeo.fetch': 'Fetch region',
    'usage.ipGeo.fetching': 'Fetching...',
    'usage.ipGeo.failed': 'Failed',
    'usage.ipGeo.private': 'Private address',
    'usage.ipGeo.refreshTitle': 'Refresh',
    'usage.ipGeo.detailOrg': 'ISP',
    'usage.ipGeo.detailTimezone': 'Timezone',
    'usage.ipGeo.detailAccuracy': 'Accuracy',
    'usage.ipGeo.detailCoordinates': 'Coordinates',
  }
  return {
    useI18n: () => ({ t: (key: string) => table[key] ?? key, te: () => true, locale: 'en' }),
  }
})

import IpGeoCell from '../IpGeoCell'

describe('IpGeoCell', () => {
  beforeEach(() => {
    mocks.getEntry.mockReset()
    mocks.fetchOne.mockReset()
  })

  it('renders a clickable fetch link in idle state and triggers fetchOne on click', () => {
    mocks.getEntry.mockReturnValue({ status: 'idle' })
    const { container } = render(<IpGeoCell ip="8.8.8.8" />)
    expect(container.textContent).toContain('Fetch region')
    fireEvent.click(screen.getByRole('button'))
    expect(mocks.fetchOne).toHaveBeenCalledWith('8.8.8.8')
  })

  it('renders loading state', () => {
    mocks.getEntry.mockReturnValue({ status: 'loading' })
    const { container } = render(<IpGeoCell ip="8.8.8.8" />)
    expect(container.textContent).toContain('Fetching...')
  })

  it('renders success state with label, tooltip detail, and a refresh button', () => {
    mocks.getEntry.mockReturnValue({
      status: 'success',
      label: 'CN · Guangdong · Shenzhen',
      detail: {
        organization: 'AS4134 Chinanet',
        timezone: 'Asia/Shanghai',
        accuracy: 10,
        latitude: '22.5',
        longitude: '114.0',
      },
    })
    const { container } = render(<IpGeoCell ip="121.35.47.43" />)
    expect(container.textContent).toContain('CN · Guangdong · Shenzhen')
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBe(2)
    expect(buttons[0].getAttribute('title')).toContain('AS4134 Chinanet')
    expect(buttons[0].getAttribute('title')).toContain('Asia/Shanghai')
    fireEvent.click(buttons[1])
    expect(mocks.fetchOne).toHaveBeenCalledWith('121.35.47.43', true)
  })

  it('opens the external lookup page when the label is clicked', () => {
    mocks.getEntry.mockReturnValue({ status: 'success', label: 'US · California', detail: {} })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<IpGeoCell ip="8.8.4.4" />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.iplocation.net/ip-lookup?query=8.8.4.4',
      '_blank',
      'noopener,noreferrer'
    )
    openSpy.mockRestore()
  })

  it('renders failed state as a clickable retry', () => {
    mocks.getEntry.mockReturnValue({ status: 'error' })
    const { container } = render(<IpGeoCell ip="8.8.8.8" />)
    expect(container.textContent).toContain('Failed')
    fireEvent.click(screen.getByRole('button'))
    expect(mocks.fetchOne).toHaveBeenCalledWith('8.8.8.8')
  })

  it('renders private state as non-clickable text', () => {
    mocks.getEntry.mockReturnValue({ status: 'private' })
    const { container } = render(<IpGeoCell ip="192.168.1.1" />)
    expect(container.textContent).toContain('Private address')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
