import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import GroupDistributionChart from '../GroupDistributionChart'
import { formatShareLabel } from '../chartUtils'

const { translate } = vi.hoisted(() => {
  const messages: Record<string, string> = {
    'admin.dashboard.groupDistribution': 'Group Distribution',
    'admin.dashboard.group': 'Group',
    'admin.dashboard.noGroup': 'No Group',
    'admin.dashboard.requests': 'Requests',
    'admin.dashboard.tokens': 'Tokens',
    'admin.dashboard.actual': 'Actual',
    'admin.dashboard.accountCost': 'Account Cost',
    'admin.dashboard.standard': 'Standard',
    'admin.dashboard.metricTokens': 'By Tokens',
    'admin.dashboard.metricActualCost': 'By Actual Cost',
    'admin.dashboard.noDataAvailable': 'No data available'
  }
  return { translate: (key: string) => messages[key] ?? key }
})

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: translate, te: () => true, locale: 'en', setLocale: vi.fn() })
}))

// 对应 Vue spec 中对 vue-chartjs Doughnut 的桩：把传给环形图的数据输出为 JSON
vi.mock('@/components/arc/donut-chart/donut-chart', () => ({
  DonutChart: ({ data }: { data: unknown }) => <div data-testid="chart-data">{JSON.stringify(data)}</div>
}))

interface Datum {
  label: string
  value: number
}

const chartData = (): Datum[] => JSON.parse(screen.getByTestId('chart-data').textContent || '[]')
const bodyRows = (container: HTMLElement) => Array.from(container.querySelectorAll('tbody tr'))

describe('GroupDistributionChart', () => {
  const groupStats = [
    {
      group_id: 1,
      group_name: 'group-a',
      requests: 9,
      total_tokens: 1200,
      cost: 1.8,
      actual_cost: 0.1
    },
    {
      group_id: 2,
      group_name: 'group-b',
      requests: 4,
      total_tokens: 600,
      cost: 0.7,
      actual_cost: 0.9
    }
  ]

  it('uses total_tokens and token ordering by default', () => {
    const { container } = render(<GroupDistributionChart groupStats={groupStats} />)

    const data = chartData()
    expect(data.map((item) => item.label)).toEqual(['group-a', 'group-b'])
    expect(data.map((item) => item.value)).toEqual([1200, 600])

    const rows = bodyRows(container)
    expect(rows[0].textContent).toContain('group-a')
    expect(rows[1].textContent).toContain('group-b')

    const label = formatShareLabel('group-a', 1200, data.map((item) => item.value), 'tokens')
    expect(label).toBe('group-a: 1.20K (66.7%)')
  })

  it('uses actual_cost and reorders rows in actual cost mode', () => {
    const { container } = render(<GroupDistributionChart groupStats={groupStats} metric="actual_cost" />)

    const data = chartData()
    expect(data.map((item) => item.label)).toEqual(['group-b', 'group-a'])
    expect(data.map((item) => item.value)).toEqual([0.9, 0.1])

    const rows = bodyRows(container)
    expect(rows[0].textContent).toContain('group-b')
    expect(rows[1].textContent).toContain('group-a')

    const label = formatShareLabel('group-b', 0.9, data.map((item) => item.value), 'actual_cost')
    expect(label).toBe('group-b: $0.900 (90.0%)')
  })

  it('can hide account cost for user usage stats without account_cost', () => {
    const { container } = render(<GroupDistributionChart groupStats={groupStats} showAccountCost={false} />)

    expect(container.textContent).not.toContain('Account Cost')
    expect(container.querySelectorAll('thead th')).toHaveLength(5)
    expect(bodyRows(container)[0].querySelectorAll('td')).toHaveLength(5)
  })
})
