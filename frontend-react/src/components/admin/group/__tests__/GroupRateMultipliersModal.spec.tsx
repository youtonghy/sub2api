import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminGroup } from '@/types'
import GroupRateMultipliersModal from '../GroupRateMultipliersModal'
import { buttonByText, buttonContaining, flushPromises } from './groupModalHarness'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getGroupRateMultipliers: vi.fn(),
  batchSetGroupRateMultipliers: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn()
}))
vi.mock('@/api/admin', () => ({ adminAPI: { users: { list: mocks.list }, groups: mocks } }))
vi.mock('@/stores/app', async () =>
  (await import('./groupModalHarness')).appStoreModule({ showSuccess: mocks.showSuccess, showError: mocks.showError })
)
vi.mock('@/i18n/useI18n', async () => (await import('./groupModalHarness')).i18nModule())
vi.mock('@/components/common/BaseDialog', async () => (await import('./groupModalHarness')).baseDialogModule())
vi.mock('@/components/common/Pagination', async () => (await import('./groupModalHarness')).nullModule())

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.getGroupRateMultipliers.mockResolvedValue([])
  mocks.list.mockResolvedValue({ items: [{ id: 7, email: 'user@example.com', status: 'active' }] })
  mocks.batchSetGroupRateMultipliers.mockResolvedValue(undefined)
})

async function selectUser() {
  const group = { id: 1, name: 'Group', platform: 'openai' } as AdminGroup
  const view = render(<GroupRateMultipliersModal show={false} group={group} onClose={vi.fn()} onSuccess={vi.fn()} />)
  view.rerender(<GroupRateMultipliersModal show group={group} onClose={vi.fn()} onSuccess={vi.fn()} />)
  await flushPromises()
  fireEvent.change(document.querySelector('input[type="text"]')!, { target: { value: 'user' } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  await flushPromises()
  fireEvent.click(buttonContaining('user@example.com')!)
  return view
}

const amountInput = () => document.querySelector('input[placeholder="1.0"]')!

describe('GroupRateMultipliersModal new override validation', () => {
  it.each(['', '0', '-1'])('does not add invalid rate %j', async (value) => {
    await selectUser()
    fireEvent.change(amountInput(), { target: { value: '100' } })
    fireEvent.change(amountInput(), { target: { value } })
    const add = buttonByText('common.add')!
    expect(add.hasAttribute('disabled')).toBe(true)
    fireEvent.click(add)
    expect(document.querySelector('tbody tr')).toBeNull()
    expect(mocks.batchSetGroupRateMultipliers).not.toHaveBeenCalled()
  })

  it.each([0.25, 1])('saves positive rate %s', async (value) => {
    await selectUser()
    fireEvent.change(amountInput(), { target: { value: String(value) } })
    fireEvent.click(buttonByText('common.add')!)
    fireEvent.click(buttonByText('common.save')!)
    await flushPromises()
    expect(mocks.batchSetGroupRateMultipliers).toHaveBeenCalledWith(1, [{ user_id: 7, rate_multiplier: value }])
  })
})
