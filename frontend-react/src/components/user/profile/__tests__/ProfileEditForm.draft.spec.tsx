import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProfileEditForm from '@/components/user/profile/ProfileEditForm'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types'

const mocks = vi.hoisted(() => ({ updateProfile: vi.fn() }))
vi.mock('@/api', () => ({ userAPI: { updateProfile: mocks.updateProfile } }))
vi.mock('@/i18n/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, te: () => true, locale: 'en' }) }))

function Harness() {
  const username = useAuthStore((s) => s.user?.username ?? '')
  return <ProfileEditForm initialUsername={username} />
}

beforeEach(() => {
  mocks.updateProfile.mockReset()
  useAppStore.setState({ showError: vi.fn(), showSuccess: vi.fn() })
  useAuthStore.setState({ user: { username: 'alice' } as User })
})

const usernameInput = (container: HTMLElement) => container.querySelector('#username') as HTMLInputElement

describe('profile username draft', () => {
  it.each(['next-draft', 'alice'])('preserves %s typed while the previous username is being saved', async (draft) => {
    let finish!: (value: unknown) => void
    mocks.updateProfile.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { container } = render(<Harness />)
    fireEvent.change(usernameInput(container), { target: { value: 'submitted' } })
    fireEvent.submit(container.querySelector('form')!)
    expect(mocks.updateProfile).toHaveBeenCalledWith({ username: 'submitted' })
    fireEvent.change(usernameInput(container), { target: { value: draft } })
    await act(async () => {
      finish({ username: 'submitted' })
    })
    expect(useAuthStore.getState().user?.username).toBe('submitted')
    expect(usernameInput(container).value).toBe(draft)
  })

  it('still synchronizes a pristine input with profile updates', () => {
    const { container } = render(<Harness />)
    act(() => {
      useAuthStore.setState({ user: { username: 'updated' } as User })
    })
    expect(usernameInput(container).value).toBe('updated')
  })

  it('shows the server username after saving without further edits', async () => {
    mocks.updateProfile.mockResolvedValue({ username: 'saved-name' })
    const { container } = render(<Harness />)
    fireEvent.change(usernameInput(container), { target: { value: ' saved-name ' } })
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!)
    })
    expect(usernameInput(container).value).toBe('saved-name')
  })
})
