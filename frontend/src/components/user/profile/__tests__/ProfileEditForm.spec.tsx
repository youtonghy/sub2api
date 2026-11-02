import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProfileEditForm from '@/components/user/profile/ProfileEditForm'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types'

const mocks = vi.hoisted(() => ({ updateProfile: vi.fn(), showError: vi.fn() }))

vi.mock('@/api', () => ({ userAPI: { updateProfile: mocks.updateProfile } }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

describe('ProfileEditForm', () => {
  beforeEach(() => {
    mocks.updateProfile.mockReset()
    mocks.showError.mockReset()
    useAppStore.setState({ showError: mocks.showError })
    useAuthStore.setState({ user: { username: 'alice' } as User })
  })

  it.each([
    [{ status: 400, code: 'VALIDATION_ERROR', message: 'username is too long' }, 'username is too long'],
    [{ response: { data: { detail: 'backend failure' } } }, 'backend failure'],
    [{}, 'profile.updateFailed']
  ])('shows API failure %j without changing the saved profile', async (error, expectedMessage) => {
    mocks.updateProfile.mockRejectedValue(error)
    const { container } = render(<ProfileEditForm initialUsername="alice" />)

    fireEvent.change(container.querySelector('#username')!, { target: { value: 'new-name' } })
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!)
    })

    expect(mocks.updateProfile).toHaveBeenCalledWith({ username: 'new-name' })
    expect(mocks.showError).toHaveBeenLastCalledWith(expectedMessage)
    expect(useAuthStore.getState().user?.username).toBe('alice')
    expect(screen.getByRole('button', { name: 'profile.updateProfile' })).not.toBeDisabled()
  })
})
