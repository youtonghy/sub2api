import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AmountInput from '../AmountInput'

vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && typeof params === 'object' && 'amount' in params ? `${key} ${String(params.amount)}` : key,
    te: () => true,
    locale: 'en',
  }),
}))

function mountInput(value: number | null = null) {
  const onChange = vi.fn()
  render(<AmountInput value={value} onChange={onChange} />)
  return { input: screen.getByRole('textbox') as HTMLInputElement, onChange }
}

describe('recharge amount input', () => {
  it.each(['10abc', '10.555', '-10', '1e2'])('restores the accepted amount after rejecting %s', (value) => {
    const { input, onChange } = mountInput(10)
    fireEvent.change(input, { target: { value } })
    expect(input.value).toBe('10')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('restores the last typed amount rather than a stale prop', () => {
    const { input, onChange } = mountInput()
    fireEvent.change(input, { target: { value: '12.50' } })
    fireEvent.change(input, { target: { value: '12.500' } })
    expect(input.value).toBe('12.50')
    expect(onChange.mock.calls).toEqual([[12.5]])
  })

  it('preserves decimal editing and allows clearing the amount', () => {
    const { input, onChange } = mountInput()
    for (const value of ['0', '0.', '0.5', '0.50', '']) fireEvent.change(input, { target: { value } })
    expect(onChange.mock.calls).toEqual([[null], [null], [0.5], [0.5], [null]])
    expect(input.value).toBe('')
  })
})

describe('recharge bonus hints on quick amounts', () => {
  const tiers = [
    { min_amount: 100, bonus_percent: 20 },
    { min_amount: 500, bonus_percent: 30 },
  ]

  it('renders no badge or second line when no tiers are configured', () => {
    render(<AmountInput value={null} amounts={[50, 100, 500]} />)
    expect(screen.queryByTestId('quick-amount-bonus-badge')).toBeNull()
    expect(screen.queryByTestId('quick-amount-credited')).toBeNull()
  })

  it('bonus mode: price tag only on amounts that hit a tier, credited totals on every button', () => {
    render(<AmountInput value={null} amounts={[50, 100, 500]} bonusTiers={tiers} />)
    const below = within(screen.getByTestId('quick-amount-50'))
    const first = within(screen.getByTestId('quick-amount-100'))
    const second = within(screen.getByTestId('quick-amount-500'))

    expect(below.queryByTestId('quick-amount-bonus-badge')).toBeNull()
    expect(below.getByTestId('quick-amount-credited').textContent).toContain('$50.00')
    expect(first.getByTestId('quick-amount-bonus-badge').textContent).toBe('+20%')
    expect(first.getByTestId('quick-amount-credited').textContent).toContain('$120.00')
    expect(second.getByTestId('quick-amount-bonus-badge').textContent).toBe('+30%')
    expect(second.getByTestId('quick-amount-credited').textContent).toContain('$650.00')
  })

  it('bonus mode: matches tiers by the entered amount but credits by the multiplier', () => {
    render(<AmountInput value={null} amounts={[1000]} bonusTiers={tiers} multiplier={0.14} />)
    const button = within(screen.getByTestId('quick-amount-1000'))
    expect(button.getByTestId('quick-amount-bonus-badge').textContent).toBe('+30%')
    // 1000 × 0.14 = 140 base, +30% = 182
    expect(button.getByTestId('quick-amount-credited').textContent).toContain('$182.00')
  })

  it('discount mode: tag reads N% OFF and the second line shows the discounted payment', () => {
    render(<AmountInput value={null} amounts={[50, 500]} bonusTiers={tiers} bonusMode="discount" currency="USD" />)
    const below = within(screen.getByTestId('quick-amount-50'))
    const hit = within(screen.getByTestId('quick-amount-500'))
    expect(below.queryByTestId('quick-amount-bonus-badge')).toBeNull()
    expect(below.getByTestId('quick-amount-credited').textContent).toContain('50.00')
    expect(hit.getByTestId('quick-amount-bonus-badge').textContent).toBe('30% OFF')
    // 500 × (1 − 30%) = 350
    expect(hit.getByTestId('quick-amount-credited').textContent).toContain('350.00')
  })
})
