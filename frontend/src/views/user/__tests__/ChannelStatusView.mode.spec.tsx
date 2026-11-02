import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isV1 = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/utils/featureFlags', () => ({
  isChannelMonitorV1Mode: () => isV1()
}))

vi.mock('../ChannelStatusV1View', () => ({ default: () => <div data-testid="v1" /> }))
vi.mock('../ChannelStatusV2View', () => ({ default: () => <div data-testid="v2" /> }))

import ChannelStatusView from '../ChannelStatusView'

describe('ChannelStatusView mode switch', () => {
  beforeEach(() => {
    isV1.mockReset()
  })

  it('renders V2 when not in v1 mode', () => {
    isV1.mockReturnValue(false)
    render(<ChannelStatusView />)
    expect(screen.queryByTestId('v2')).not.toBeNull()
    expect(screen.queryByTestId('v1')).toBeNull()
  })

  it('renders V1 when in v1 mode', () => {
    isV1.mockReturnValue(true)
    render(<ChannelStatusView />)
    expect(screen.queryByTestId('v1')).not.toBeNull()
    expect(screen.queryByTestId('v2')).toBeNull()
  })
})
