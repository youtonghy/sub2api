import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

import OpsThroughputTrendChart from '../OpsThroughputTrendChart'
import styles from '../OpsThroughputTrendChart.module.css'

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

// Arc line-chart 依赖 ResizeObserver 与动画，这里替换为记录 props 的桩
vi.mock('@/components/arc/line-chart/line-chart', () => ({
  LineChart: () => <div data-testid="line-chart-stub" />
}))

afterEach(cleanup)

describe('OpsThroughputTrendChart', () => {
  it('allows the header controls to wrap on narrow screens', () => {
    render(<OpsThroughputTrendChart points={[]} loading={false} timeRange="1h" />)

    // Vue 版断言 Tailwind 类（flex-col / sm:flex-row、w-full / flex-wrap / sm:w-auto）；
    // React 版换行规则写在 CSS Module 的 .header / .toolbar 中（窄屏纵向、工具栏换行，>=640px 横向）。
    expect(styles.header).toBeTruthy()
    expect(styles.toolbar).toBeTruthy()
    const header = screen.getByTestId('throughput-chart-header')
    expect(header).toHaveClass(styles.header)

    const toolbar = screen.getByTestId('throughput-chart-toolbar')
    expect(toolbar).toHaveClass(styles.toolbar)

    // Vue 版工具栏有 3 个按钮（详情、重置缩放、下载）；Arc line-chart 无缩放，重置缩放按钮已移除。
    const actions = [
      within(toolbar).getByRole('button', { name: 'admin.ops.requestDetails.details' }),
      within(toolbar).getByRole('button', { name: 'admin.ops.charts.downloadChart' })
    ]
    expect(actions).toHaveLength(2)
    // 按钮是工具栏的直接子元素，由 `.toolbar > * { flex-shrink: 0 }` 保证不被压缩
    actions.forEach((button) => expect(button.parentElement).toBe(toolbar))
  })
})
