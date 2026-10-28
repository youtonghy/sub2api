import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MonitorQuotaSnapshot } from '@/api/admin/channelMonitor'
import MonitorQuotaView from '../MonitorQuotaView'

// te() 恒真：已知 token 直接返回 i18n key，便于断言 window/label 映射。
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }),
}))

function makeSnapshot(overrides: Partial<MonitorQuotaSnapshot> = {}): MonitorQuotaSnapshot {
  return {
    source: 'usage',
    success: true,
    fetched_at: '2026-08-18T00:00:00Z',
    ...overrides,
  }
}

// Vue 版断言 bg-green-500 / bg-amber-500 / bg-red-500 与 text-red-600 类名，
// React 版把阈值等级放在 data-level / data-empty 上。
const levels = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-level]')].map((el) => el.getAttribute('data-level'))

describe('MonitorQuotaView', () => {
  it('renders nothing without a snapshot', () => {
    const { container } = render(<MonitorQuotaView snapshot={null} />)
    expect(container.querySelector('[data-testid="monitor-quota-view"]')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('maps tier window/label tokens through i18n and colors utilization', () => {
    const { container } = render(
      <MonitorQuotaView
        snapshot={makeSnapshot({
          tiers: [
            { window: '5h', used_percent: 42.4 },
            { window: '7d', label: 'pro', used_percent: 80 },
            { window: 'weekly', label: 'unknown-token', used_percent: 95 },
          ],
        })}
      />,
    )

    const rows = screen.getAllByTestId('monitor-quota-tier')
    // tier 行只在 success 且有数据时渲染
    expect(rows).toHaveLength(3)
    const text = container.textContent
    // 已知 window token 走 i18n
    expect(text).toContain('monitorCommon.quota.windows.5h')
    expect(text).toContain('monitorCommon.quota.windows.7d')
    // 已知 label token 拼成 label/window
    expect(text).toContain('monitorCommon.quota.labels.pro/monitorCommon.quota.windows.7d')
    // 未知 label 原样透出（前向兼容）
    expect(text).toContain('unknown-token/monitorCommon.quota.windows.weekly')
    // 百分比取整
    expect(text).toContain('42%')
    expect(text).toContain('80%')
    expect(text).toContain('95%')

    // 阈值配色：≥90 危险 / ≥75 警告 / 其余成功；42.4 → 成功、80 → 警告、95 → 危险
    expect(levels(container)).toContain('success')
    expect(levels(container)).toContain('warning')
    expect(levels(container)).toContain('danger')
  })

  it('clamps the tier bar width into 0-100', () => {
    const { container } = render(
      <MonitorQuotaView snapshot={makeSnapshot({ tiers: [{ window: '5h', used_percent: 240 }] })} />,
    )
    expect(container.innerHTML).toContain('width: 100%')
  })

  it('shows the plan level badge and multi-currency balances', () => {
    const { container } = render(
      <MonitorQuotaView
        snapshot={makeSnapshot({
          plan_level: 'Max20',
          balances: [
            { currency: 'CNY', balance: 12.5 },
            { currency: 'USD', balance: 0 },
          ],
        })}
      />,
    )

    expect(container.textContent).toContain('Max20')
    expect(container.textContent).toContain('12.50 CNY')
    expect(container.textContent).toContain('0.00 USD')
    // 余额为 0 用危险色警示
    expect(screen.getByText('0.00 USD')).toHaveAttribute('data-empty')
  })

  it('falls back to the single balance + currency pair', () => {
    const { container } = render(<MonitorQuotaView snapshot={makeSnapshot({ balance: 3.2, currency: 'CNY' })} />)
    expect(container.textContent).toContain('3.20 CNY')
  })

  it('renders a truncated error state when the fetch failed', () => {
    const longError = 'x'.repeat(60)
    render(<MonitorQuotaView snapshot={makeSnapshot({ success: false, error: longError })} />)

    const error = screen.getByTestId('monitor-quota-error')
    expect(error.textContent).toBe(`${'x'.repeat(48)}…`)
    expect(error.getAttribute('title')).toBe(longError)
  })

  it('keeps failed snapshots from rendering tier rows', () => {
    const { container } = render(
      <MonitorQuotaView
        snapshot={makeSnapshot({
          success: false,
          tiers: [{ window: '5h', used_percent: 10 }],
        })}
      />,
    )
    expect(container.textContent).not.toContain('10%')
  })
})
