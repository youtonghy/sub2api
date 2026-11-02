import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import OpsErrorDistributionChart from '../OpsErrorDistributionChart'
import OpsErrorTrendChart from '../OpsErrorTrendChart'

const charts = vi.hoisted(() => ({ splitProps: [] as any[], lineProps: [] as any[] }))

// Arc 图表桩：记录传入的 props，便于断言数据口径（对应 Vue 版对 vue-chartjs 的桩）
vi.mock('@/components/arc/split-bar/split-bar', () => ({
  SplitBar: (props: any) => {
    charts.splitProps.push(props)
    return <div className="split-bar-stub" data-testid="split-bar-stub" />
  }
}))
vi.mock('@/components/arc/line-chart/line-chart', () => ({
  LineChart: (props: any) => {
    charts.lineProps.push(props)
    return <div className="line-stub" data-testid="line-chart-stub" />
  }
}))

vi.mock('../../utils/opsFormatters', () => ({
  formatHistoryLabel: (date: string | undefined) => date ?? '',
  sumNumbers: (values: Array<number | null | undefined>) =>
    values.reduce<number>((total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0)
}))

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

vi.mock('@/components/common/HelpTooltip', () => ({
  default: () => <span className="help-tooltip-stub" />
}))

afterEach(() => {
  cleanup()
  charts.splitProps.length = 0
  charts.lineProps.length = 0
})

describe('Ops SLA-scoped error charts', () => {
  it('错误分布图按 SLA 错误数统计，不把业务限制错误算进请求错误分布', () => {
    render(
      <OpsErrorDistributionChart
        loading={false}
        data={{
          total: 10,
          items: [
            { status_code: 400, total: 7, sla: 2, business_limited: 5 },
            { status_code: 503, total: 3, sla: 0, business_limited: 3 }
          ]
        }}
      />
    )

    expect(screen.getByTestId('split-bar-stub')).toBeInTheDocument()
    const props = charts.splitProps[charts.splitProps.length - 1]
    expect(props.segments).toHaveLength(1)
    expect(props.segments[0]).toMatchObject({ label: 'admin.ops.client', value: 2 })
  })

  it('错误分布图在只有业务限制错误时显示为空态', () => {
    render(
      <OpsErrorDistributionChart
        loading={false}
        data={{
          total: 4,
          items: [{ status_code: 500, total: 4, sla: 0, business_limited: 4 }]
        }}
      />
    )

    expect(screen.queryByTestId('split-bar-stub')).not.toBeInTheDocument()
    expect(screen.getByTestId('ops-chart-empty')).toBeInTheDocument()
  })

  it('错误趋势图的请求错误详情按钮只按 SLA 错误启用', () => {
    render(
      <OpsErrorTrendChart
        loading={false}
        timeRange="1h"
        points={[
          {
            bucket_start: '2026-05-18T00:00:00Z',
            error_count_total: 5,
            business_limited_count: 5,
            error_count_sla: 0,
            upstream_error_count_excl_429_529: 0,
            upstream_429_count: 0,
            upstream_529_count: 0
          }
        ]}
      />
    )

    const requestErrorsButton = screen.getAllByRole('button')[0]
    expect(requestErrorsButton).toHaveTextContent('admin.ops.errorDetails.requestErrors')
    expect(requestErrorsButton).toBeDisabled()
  })
})
