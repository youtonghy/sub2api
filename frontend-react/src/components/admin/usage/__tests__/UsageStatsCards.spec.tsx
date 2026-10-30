import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UsageStatsCards from '../UsageStatsCards'

const messages: Record<string, string> = {
  'usage.totalRequests': 'Total Requests',
  'usage.inSelectedRange': 'in selected range',
  'usage.totalTokens': 'Total Tokens',
  'usage.in': 'In',
  'usage.out': 'Out',
  'usage.cacheTotal': 'Cache',
  'usage.cacheBreakdown': 'Cache Token Breakdown',
  'usage.cacheCreationTokensLabel': 'Cache Creation',
  'usage.cacheReadTokensLabel': 'Cache Read',
  'usage.totalCost': 'Total Cost',
  'usage.accountCost': 'Cost',
  'usage.standardCost': 'Standard',
  'usage.avgDuration': 'Avg Duration'
}

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => messages[key] ?? key, te: () => true, locale: 'en' })
}))

afterEach(cleanup)

const stats = {
  total_requests: 1,
  total_input_tokens: 100,
  total_output_tokens: 50,
  total_cache_tokens: 34,
  total_cache_creation_tokens: 12,
  total_cache_read_tokens: 22,
  total_tokens: 184,
  total_cost: 0.001,
  total_actual_cost: 0.001,
  total_account_cost: 0.001,
  average_duration_ms: 250
}

describe('UsageStatsCards', () => {
  it('shows cache token breakdown values', async () => {
    const { container } = render(<UsageStatsCards stats={stats} />)

    expect(container.textContent).toContain('Cache: 34')

    // 明细在提示层里，聚焦令牌卡片后显示
    fireEvent.focus(screen.getByTestId('usage-stats-tokens'))
    const title = await screen.findAllByText('Cache Token Breakdown')
    expect(title.length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain('Cache Creation')
    expect(document.body.textContent).toContain('12')
    expect(document.body.textContent).toContain('Cache Read')
    expect(document.body.textContent).toContain('22')
  })

  it('keeps the cache tooltip out of the layout while it is hidden', () => {
    render(<UsageStatsCards stats={stats} />)

    // Vue 版断言隐藏时为 display:none（不撑宽页面导致窄屏横向滚动）；
    // Arc 提示层在隐藏时完全不挂载，同样不占布局。
    expect(screen.queryByText('Cache Token Breakdown')).not.toBeInTheDocument()
  })
})
