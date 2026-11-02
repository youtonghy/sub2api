import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { UserAvailableChannel, UserSupportedModel } from '@/api/channels'
import AvailableChannelsTable, { type AvailableChannelsTableProps } from '../AvailableChannelsTable'

// Vue 版中两条读取组件源码文本（.table-wrapper / overflow-hidden 正则）的用例已不适用于 React 版，
// 滚动挂载点改由根元素 CSS（AvailableChannelsTable.module.css 的 .root）保证。

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/common/PlatformIcon', () => ({ default: () => <i data-platform-icon /> }))
vi.mock('@/components/common/GroupBadge', () => ({
  default: (props: { name: string; rateMultiplier?: number; userRateMultiplier?: number | null }) => (
    <span data-group-badge>
      {props.name}:{props.rateMultiplier}:{props.userRateMultiplier}
    </span>
  )
}))
vi.mock('../SupportedModelChip', () => ({
  default: (props: { model: UserSupportedModel; noPricingLabel?: string }) => (
    <span data-model-chip>
      {props.model.name}:{props.noPricingLabel}
    </span>
  )
}))

const rows: UserAvailableChannel[] = [
  {
    name: 'Primary channel',
    description: 'Fast and reliable access',
    platforms: [
      {
        platform: 'anthropic',
        groups: [
          {
            id: 1,
            name: 'Exclusive Pro',
            platform: 'anthropic',
            subscription_type: 'standard',
            rate_multiplier: 1.2,
            peak_rate_enabled: true,
            peak_start: '08:00',
            peak_end: '10:00',
            peak_rate_multiplier: 1.5,
            is_exclusive: true
          },
          {
            id: 2,
            name: 'Public',
            platform: 'anthropic',
            subscription_type: 'standard',
            rate_multiplier: 1,
            peak_rate_enabled: false,
            peak_start: '',
            peak_end: '',
            peak_rate_multiplier: 1,
            is_exclusive: false
          }
        ],
        supported_models: [{ name: 'claude-test', platform: 'anthropic', pricing: null }]
      }
    ]
  }
]

const baseProps: AvailableChannelsTableProps = {
  columns: {
    name: 'Channel',
    description: 'Description',
    platform: 'Platform',
    groups: 'Groups and rates',
    supportedModels: 'Models and pricing'
  },
  rows,
  loading: false,
  pricingKeyPrefix: 'availableChannels.pricing',
  noPricingLabel: 'No pricing',
  noModelsLabel: 'No models',
  emptyLabel: 'No channels',
  userGroupRates: { 1: 0.8 }
}

const mountTable = (props: Partial<AvailableChannelsTableProps> = {}) =>
  render(<AvailableChannelsTable {...baseProps} {...props} />)

describe('AvailableChannelsTable responsive surfaces', () => {
  it('keeps the five-column table as the desktop-only surface', () => {
    mountTable()
    const desktop = screen.getByTestId('desktop-channels')

    expect(desktop.tagName).toBe('TABLE')
    expect(desktop.querySelectorAll('thead th')).toHaveLength(5)
    expect(desktop.textContent).toContain('Primary channel')
    expect(desktop.textContent).toContain('Fast and reliable access')
    expect(desktop.querySelectorAll('[data-group-badge]')).toHaveLength(2)
    expect(desktop.querySelector('[data-model-chip]')!.textContent).toContain('claude-test:No pricing')
  })

  it('renders a mobile-only readable surface with groups, rates, peaks, and model pricing chips', () => {
    mountTable()
    const mobile = screen.getByTestId('mobile-channels')

    expect(mobile.textContent).toContain('Primary channel')
    expect(mobile.textContent).toContain('Fast and reliable access')
    expect(mobile.textContent).toContain('Groups and rates')
    expect(mobile.textContent).toContain('Models and pricing')
    expect(mobile.textContent).toContain('availableChannels.exclusive')
    expect(mobile.textContent).toContain('availableChannels.public')
    expect(mobile.querySelector('[data-group-badge]')!.textContent).toBe('Exclusive Pro:1.2:0.8')
    expect(mobile.querySelectorAll('[data-group-badge]')).toHaveLength(2)
    expect(mobile.querySelector('[data-icon="clock"]')).not.toBeNull()
    expect(mobile.textContent).toContain('08:00')
    expect(mobile.textContent).toContain('10:00')
    expect(mobile.textContent).toContain('×1.5')
    expect(mobile.querySelector('[data-model-chip]')!.textContent).toBe('claude-test:No pricing')
  })

  it('keeps the mobile placeholders when a platform has no groups or models', () => {
    mountTable({
      rows: [{ name: 'Fallback channel', description: '', platforms: [{ platform: 'openai', groups: [], supported_models: [] }] }]
    })
    const mobile = screen.getByTestId('mobile-channels')

    expect(mobile.textContent).toContain('Fallback channel')
    expect(mobile.textContent).toContain('openai')
    expect(mobile.textContent).toContain('No models')
    expect(mobile.querySelectorAll('dd')[0]!.textContent).toBe('-')
  })

  it('provides loading and empty states on both responsive surfaces', () => {
    const view = mountTable({ loading: true, rows: [] })

    expect(within(screen.getByTestId('desktop-channels')).getByTestId('desktop-loading')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-loading')).toBeInTheDocument()

    view.rerender(<AvailableChannelsTable {...baseProps} loading={false} rows={[]} />)

    expect(screen.getByTestId('desktop-channels').textContent).toContain('No channels')
    expect(screen.getByTestId('mobile-empty').textContent).toContain('No channels')
  })
})
