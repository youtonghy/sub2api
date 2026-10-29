import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AccountPriorityCell from '../AccountPriorityCell'

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

describe('AccountPriorityCell', () => {
  it('renders the usage rank', () => {
    render(<AccountPriorityCell rank={3} />)
    expect(screen.getByTestId('account-priority-rank')).toHaveTextContent(/^3$/)
  })

  it('never renders the raw priority number', () => {
    // 组件只接收位次，签名上就没有 priority / account，避免数字泄回界面（由类型保证）。
    const { container } = render(<AccountPriorityCell rank={1} />)
    expect(container.textContent).toBe('1')
    // @ts-expect-error AccountPriorityCellProps 不接受 account
    render(<AccountPriorityCell rank={1} account={{ priority: 99 }} />)
  })

  it('exposes no manual editing controls', () => {
    const { container } = render(<AccountPriorityCell rank={2} />)
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })

  it('follows rank changes pushed by the parent', () => {
    const { rerender } = render(<AccountPriorityCell rank={4} />)
    rerender(<AccountPriorityCell rank={9} />)
    expect(screen.getByTestId('account-priority-rank')).toHaveTextContent(/^9$/)
  })
})
