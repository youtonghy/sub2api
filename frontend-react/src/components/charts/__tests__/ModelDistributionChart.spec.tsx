import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ModelDistributionChart from '../ModelDistributionChart'
import { OTHER_COLOR, distributionColor, formatShareLabel } from '../chartUtils'

const { translate } = vi.hoisted(() => {
  const messages: Record<string, string> = {
    'admin.dashboard.modelDistribution': 'Model Distribution',
    'admin.dashboard.spendingRankingTitle': 'User Spending Ranking',
    'admin.dashboard.viewModelDistribution': 'Model Distribution',
    'admin.dashboard.viewSpendingRanking': 'User Spending Ranking',
    'admin.dashboard.spendingRankingUser': 'User',
    'admin.dashboard.spendingRankingRequests': 'Requests',
    'admin.dashboard.spendingRankingTokens': 'Tokens',
    'admin.dashboard.spendingRankingSpend': 'Spend',
    'admin.dashboard.spendingRankingOther': 'Others',
    'admin.dashboard.model': 'Model',
    'admin.dashboard.requests': 'Requests',
    'admin.dashboard.tokens': 'Tokens',
    'admin.dashboard.actual': 'Actual',
    'admin.dashboard.accountCost': 'Account Cost',
    'admin.dashboard.standard': 'Standard',
    'admin.dashboard.metricTokens': 'By Tokens',
    'admin.dashboard.metricActualCost': 'By Actual Cost',
    'admin.dashboard.noDataAvailable': 'No data available',
    'admin.redeem.userPrefix': 'User #{id}'
  }
  const translate = (key: string, params?: Record<string, unknown>) => {
    const message = messages[key] ?? key
    return params ? message.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name])) : message
  }
  return { translate }
})

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: translate, te: () => true, locale: 'en', setLocale: vi.fn() })
}))

vi.mock('@/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n')>()),
  t: translate
}))

// 对应 Vue spec 中对 vue-chartjs Doughnut 的桩：把传给环形图的数据输出为 JSON
vi.mock('@/components/arc/donut-chart/donut-chart', () => ({
  DonutChart: ({ data }: { data: unknown }) => <div data-testid="chart-data">{JSON.stringify(data)}</div>
}))

interface Datum {
  key: string
  label: string
  value: number
  color: string
}

const chartData = (): Datum[] => JSON.parse(screen.getByTestId('chart-data').textContent || '[]')
const bodyRows = (container: HTMLElement) => Array.from(container.querySelectorAll('tbody tr'))

describe('ModelDistributionChart', () => {
  const modelStats = [
    {
      model: 'model-a',
      requests: 8,
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 1000,
      cost: 1.5,
      actual_cost: 0.2
    },
    {
      model: 'model-b',
      requests: 3,
      input_tokens: 40,
      output_tokens: 20,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 500,
      cost: 0.5,
      actual_cost: 1.4
    }
  ]

  it('uses total_tokens and token ordering by default', () => {
    const { container } = render(<ModelDistributionChart modelStats={modelStats} />)

    const data = chartData()
    expect(data.map((item) => item.label)).toEqual(['model-a', 'model-b'])
    expect(data.map((item) => item.value)).toEqual([1000, 500])

    const rows = bodyRows(container)
    expect(rows[0].textContent).toContain('model-a')
    expect(rows[1].textContent).toContain('model-b')

    const label = formatShareLabel('model-a', 1000, data.map((item) => item.value), 'tokens')
    expect(label).toBe('model-a: 1.00K (66.7%)')
  })

  it('uses actual_cost and reorders rows in actual cost mode', () => {
    const { container } = render(<ModelDistributionChart modelStats={modelStats} metric="actual_cost" />)

    const data = chartData()
    expect(data.map((item) => item.label)).toEqual(['model-b', 'model-a'])
    expect(data.map((item) => item.value)).toEqual([1.4, 0.2])

    const rows = bodyRows(container)
    expect(rows[0].textContent).toContain('model-b')
    expect(rows[1].textContent).toContain('model-a')

    const label = formatShareLabel('model-b', 1.4, data.map((item) => item.value), 'actual_cost')
    expect(label).toBe('model-b: $1.40 (87.5%)')
  })

  it('can hide account cost for user usage stats without account_cost', () => {
    const { container } = render(<ModelDistributionChart modelStats={modelStats} showAccountCost={false} />)

    expect(container.textContent).not.toContain('Account Cost')
    expect(container.querySelectorAll('thead th')).toHaveLength(5)
    expect(bodyRows(container)[0].querySelectorAll('td')).toHaveLength(5)
  })

  it('uses the dashboard user label policy and renders Others with a dedicated chart color', () => {
    const onRankingClick = vi.fn()
    const { container } = render(
      <ModelDistributionChart
        modelStats={[]}
        enableRankingView
        rankingItems={[
          { user_id: 1, email: 'alpha@example.com', username: 'alpha', actual_cost: 12, requests: 10, tokens: 1000 },
          { user_id: 2, email: 'beta@example.com', username: '   ', actual_cost: 8, requests: 6, tokens: 600 },
          { user_id: 3, email: '   ', username: '', actual_cost: 0, requests: 0, tokens: 0 }
        ]}
        rankingTotalActualCost={30}
        rankingTotalRequests={20}
        rankingTotalTokens={2000}
        onRankingClick={onRankingClick}
      />
    )

    const rankingButton = screen.getAllByRole('button').find((button) => button.textContent === 'User Spending Ranking')
    expect(rankingButton).toBeTruthy()
    fireEvent.click(rankingButton!)

    const data = chartData()
    expect(data.map((item) => item.label)).toEqual(['#1 alpha', '#2 beta@example.com', '#3 User #3', 'Others'])
    expect(data.map((item) => item.value)).toEqual([12, 8, 0, 10])
    expect(data[0].color).toBe(distributionColor(0, 3))
    expect(data[3].color).toBe(OTHER_COLOR)
    expect(data[3].color).not.toBe(data[0].color)

    const rows = bodyRows(container)
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('alpha')
    expect(rows[0].textContent).not.toContain('alpha@example.com')
    expect(rows[1].textContent).toContain('beta@example.com')
    expect(rows[2].textContent).toContain('User #3')
    expect(rows[3].textContent).toContain('Others')
    expect(rows[3].textContent).toContain('4')
    expect(rows[3].textContent).toContain('400')
    expect(rows[3].textContent).toContain('$10.00')

    // 点击用户行回调该用户，“其他”行不可点击
    fireEvent.click(rows[1])
    expect(onRankingClick).toHaveBeenCalledWith(expect.objectContaining({ user_id: 2 }))
    fireEvent.click(rows[3])
    expect(onRankingClick).toHaveBeenCalledTimes(1)
  })
})
