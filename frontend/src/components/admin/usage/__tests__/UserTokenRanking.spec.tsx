import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import UserTokenRanking from '../UserTokenRanking'

const getUserBreakdown = vi.fn()

vi.mock('@/api/admin/dashboard', () => ({
  getUserBreakdown: (...args: unknown[]) => getUserBreakdown(...args)
}))

vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))
vi.mock('@/components/common/Select', () => ({ default: () => <div /> }))

afterEach(cleanup)

const flushPromises = () => act(async () => {})

const item = (id: number, tokens: number) => ({
  user_id: id,
  email: `u${id}@test.com`,
  requests: 1,
  input_tokens: tokens,
  output_tokens: 0,
  cache_tokens: 0,
  total_tokens: tokens,
  actual_cost: 0.5
})

const baseProps = { startDate: '2026-07-01', endDate: '2026-07-08', filters: {} }

describe('UserTokenRanking', () => {
  beforeEach(() => {
    getUserBreakdown.mockReset()
    getUserBreakdown.mockResolvedValue({ users: [item(1, 100), item(2, 50)] })
  })

  it('loads on mount with shared filters and emits select-user with id + email on row click', async () => {
    const onSelectUser = vi.fn()
    const { container } = render(
      <UserTokenRanking {...baseProps} filters={{ group_id: 3 }} model="claude-fable-5" onSelectUser={onSelectUser} />
    )
    await flushPromises()

    expect(getUserBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({
        group_id: 3,
        model: 'claude-fable-5',
        start_date: '2026-07-01',
        end_date: '2026-07-08',
        sort_by: 'total_tokens',
        limit: 50
      })
    )

    const rows = container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)

    fireEvent.click(rows[0])
    expect(onSelectUser).toHaveBeenCalledWith(1, 'u1@test.com')
  })

  it('reloads when shared filters change', async () => {
    const view = render(<UserTokenRanking {...baseProps} />)
    await flushPromises()
    expect(getUserBreakdown).toHaveBeenCalledTimes(1)

    view.rerender(<UserTokenRanking {...baseProps} filters={{ user_id: 9 }} />)
    await flushPromises()

    expect(getUserBreakdown).toHaveBeenCalledTimes(2)
    expect(getUserBreakdown).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 9 }))
  })
})
