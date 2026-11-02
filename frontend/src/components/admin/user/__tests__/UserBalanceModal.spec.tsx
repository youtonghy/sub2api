import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminUser } from '@/types'
import UserBalanceModal from '../UserBalanceModal'

const mocks = vi.hoisted(() => ({ updateBalance: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@/api/admin', () => ({ adminAPI: { users: mocks } }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => mocks } }))
const i18n = vi.hoisted(() => ({ t: (key: string) => key, te: () => true, locale: 'en' }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => i18n }))

const flushPromises = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

describe('balance operation error feedback', () => {
  it.each([
    [{ message: 'User balance changed; retry' }, 'User balance changed; retry'],
    [{ response: { data: { detail: 'Legacy detail' } } }, 'Legacy detail'],
    [{}, 'common.error']
  ])('shows the available API error and keeps the dialog open', async (error, message) => {
    mocks.updateBalance.mockRejectedValueOnce(error)
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    render(
      <UserBalanceModal
        show
        operation="add"
        user={{ id: 1, email: 'a@example.com', balance: 5 } as AdminUser}
        onSuccess={onSuccess}
        onClose={onClose}
      />
    )
    fireEvent.change(document.body.querySelector('input[type="number"]')!, { target: { value: '1' } })
    fireEvent.submit(document.getElementById('balance-form')!)
    await flushPromises()
    expect(mocks.showError).toHaveBeenCalledWith(message)
    expect(onSuccess).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('balance-submit')).not.toBeDisabled()
  })
})
