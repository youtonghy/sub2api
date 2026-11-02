import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PaymentMethodSelector from '@/components/payment/PaymentMethodSelector'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    te: () => true,
    locale: 'en',
  }),
}))

describe('PaymentMethodSelector', () => {
  // Vue 版断言 Tailwind 类名（grid / sm:grid-cols-3 / min-w-0 / truncate）；React 版改为 CSS Module，
  // 这里断言同一约束的结构：网格容器、每个方式一个按钮、title 为完整名称、名称在独立标签中（CSS 截断）。
  it('wraps large custom method collections without letting labels widen the selector', () => {
    const methods = Array.from({ length: 12 }, (_, index) => ({
      type: `custom_${index}`,
      display_name: `CUSTOM_PAYMENT_METHOD_${index}`,
      fee_rate: 0,
      available: true,
    }))

    render(<PaymentMethodSelector selected="custom_0" methods={methods} />)

    const grid = screen.getByTestId('payment-method-grid')
    const buttons = Array.from(grid.querySelectorAll('button'))
    expect(buttons).toHaveLength(methods.length)
    expect(buttons.every((button, index) => button.getAttribute('title') === methods[index].display_name)).toBe(true)
    const labels = screen.getAllByTestId('payment-method-label')
    expect(labels).toHaveLength(methods.length)
    expect(labels.every((label, index) => label.textContent === methods[index].display_name)).toBe(true)
  })

  it('shows the configured display name for custom EasyPay methods', () => {
    const { container } = render(
      <PaymentMethodSelector selected="ldc" methods={[{ type: 'ldc', display_name: 'LDC Pay', fee_rate: 0, available: true }]} />,
    )

    expect(container.textContent).toContain('LDC Pay')
    expect(container.textContent).not.toContain('ldc')
    expect(container.textContent).not.toContain('payment.methods.ldc')
  })

  it('uses the generic selected style for custom methods that contain built-in names', () => {
    render(
      <PaymentMethodSelector
        selected="card_alipay"
        methods={[{ type: 'card_alipay', display_name: 'Card Pay', fee_rate: 0, available: true }]}
      />,
    )

    const button = screen.getByRole('radio')
    expect(button).toHaveAttribute('data-selected')
    expect(button).toHaveAttribute('data-brand', 'generic')
  })
})
