import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { UserMonitorView } from '@/api/channelMonitor'
import MonitorCard from '../monitor/MonitorCard'

const { isQuotaVisible } = vi.hoisted(() => ({ isQuotaVisible: vi.fn(() => false) }))

vi.mock('@/utils/featureFlags', () => ({ isChannelMonitorQuotaVisible: () => isQuotaVisible() }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('../monitor/MonitorMetricPair', () => ({ default: () => null }))
vi.mock('../monitor/MonitorAvailabilityRow', () => ({ default: () => null }))
vi.mock('../monitor/MonitorTimeline', () => ({ default: () => null }))

function makeItem(overrides: Partial<UserMonitorView> = {}): UserMonitorView {
  return {
    id: 1,
    name: 'claude-main',
    provider: 'kimi',
    group_name: '',
    primary_model: 'quota',
    primary_status: 'operational',
    primary_latency_ms: null,
    primary_ping_latency_ms: null,
    availability_7d: 100,
    extra_models: [],
    timeline: [],
    ...overrides
  }
}

function mountCard(item: UserMonitorView) {
  return render(<MonitorCard item={item} window="7d" availabilityValue={100} countdownSeconds={0} />)
}

describe('MonitorCard quota snapshot visibility', () => {
  it('hides the quota block when the system switch is off even if data exists', () => {
    isQuotaVisible.mockReturnValue(false)
    mountCard(makeItem({ latest_quota: { source: 'cn_quota', success: true, fetched_at: '2026-08-18T00:00:00Z' } }))
    expect(screen.queryByTestId('monitor-quota-view')).toBeNull()
  })

  it('renders the quota block when the switch is on and a snapshot exists', () => {
    isQuotaVisible.mockReturnValue(true)
    const { container } = mountCard(
      makeItem({
        latest_quota: {
          source: 'cn_quota',
          success: true,
          plan_level: 'kimi-plus',
          tiers: [{ window: 'daily', label: 'requests', used_percent: 60 }],
          fetched_at: '2026-08-18T00:00:00Z'
        }
      })
    )
    expect(screen.queryByTestId('monitor-quota-view')).not.toBeNull()
    expect(container.textContent).toContain('kimi-plus')
  })

  it('never renders the quota block without a snapshot', () => {
    isQuotaVisible.mockReturnValue(true)
    mountCard(makeItem())
    expect(screen.queryByTestId('monitor-quota-view')).toBeNull()
  })

  // 占位符 "quota" 是主模型存储值，不得作为假模型名直接透出到用户端。
  it('shows the localized quota label instead of the raw placeholder model', () => {
    const { container } = mountCard(makeItem())
    expect(container.textContent).toContain('monitorCommon.checkMode.quota')
  })

  it('keeps the real model name for probe monitors', () => {
    const { container } = mountCard(makeItem({ primary_model: 'claude-sonnet-4-5' }))
    expect(container.textContent).toContain('claude-sonnet-4-5')
    expect(container.textContent).not.toContain('monitorCommon.checkMode.quota')
  })
})
