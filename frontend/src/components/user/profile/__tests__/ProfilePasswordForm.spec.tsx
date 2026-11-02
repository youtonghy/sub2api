import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProfilePasswordForm from '@/components/user/profile/ProfilePasswordForm'
import { useAppStore } from '@/stores/app'

const mocks = vi.hoisted(() => ({ changePassword: vi.fn(), showSuccess: vi.fn(), showError: vi.fn() }))

vi.mock('@/api', () => ({ userAPI: { changePassword: mocks.changePassword } }))

const translations: Record<string, string> = {
  'profile.changePassword': 'Change Password',
  'profile.currentPassword': 'Current Password',
  'profile.newPassword': 'New Password',
  'profile.confirmNewPassword': 'Confirm New Password',
  'profile.passwordHint': 'Password must be at least 8 characters long',
  'profile.changingPassword': 'Changing...',
  'profile.changePasswordButton': 'Change Password',
  'profile.passwordsNotMatch': 'New passwords do not match',
  'profile.passwordTooShort': 'Password must be at least 8 characters long',
  'profile.passwordChangeSuccess': 'Password changed successfully',
  'profile.passwordChangeFailed': 'Failed to change password'
}
vi.mock('@/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => translations[key] ?? key, te: () => true, locale: 'en' })
}))

function fill(container: HTMLElement, oldPassword: string, newPassword: string, confirm: string) {
  fireEvent.change(container.querySelector('#old_password')!, { target: { value: oldPassword } })
  fireEvent.change(container.querySelector('#new_password')!, { target: { value: newPassword } })
  fireEvent.change(container.querySelector('#confirm_password')!, { target: { value: confirm } })
}

describe('ProfilePasswordForm', () => {
  beforeEach(() => {
    mocks.changePassword.mockReset()
    mocks.showError.mockReset()
    useAppStore.setState({ showSuccess: mocks.showSuccess, showError: mocks.showError })
  })

  it('shows validation failures as toast messages instead of inline errors', async () => {
    const { container } = render(<ProfilePasswordForm />)

    fill(container, 'old-password', 'new-password', 'different-password')
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!)
    })

    expect(mocks.changePassword).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalledWith('New passwords do not match')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it.each([
    [{ status: 400, code: 'PASSWORD_INCORRECT', message: 'current password is incorrect' }, 'current password is incorrect'],
    [{ response: { data: { detail: 'backend failure' } } }, 'backend failure'],
    [{}, 'Failed to change password']
  ])('shows API failure %j as a toast', async (error, expectedMessage) => {
    mocks.changePassword.mockRejectedValue(error)
    const { container } = render(<ProfilePasswordForm />)

    fill(container, 'old-password', 'new-password', 'new-password')
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!)
    })

    expect(mocks.changePassword).toHaveBeenCalledWith('old-password', 'new-password')
    expect(mocks.showError).toHaveBeenLastCalledWith(expectedMessage)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
