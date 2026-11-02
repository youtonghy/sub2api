import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpenAIFastPolicyUserSelector from '../OpenAIFastPolicyUserSelector'

const messages: Record<string, string> = {
  'admin.settings.openaiFastPolicy.userDeleted': '(deleted)',
  'admin.settings.openaiFastPolicy.userIdFallback': 'User #{id}',
  'admin.settings.openaiFastPolicy.removeUser': 'Remove user',
  'admin.settings.openaiFastPolicy.userSearchPlaceholder': 'Search users',
  'admin.settings.openaiFastPolicy.userSearchEmpty': 'No users found',
  'common.loading': 'Loading'
}

vi.mock('@/i18n/useI18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => {
    const message = messages[key] ?? key
    return params
      ? Object.entries(params).reduce((value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)), message)
      : message
  }
  return { useI18n: () => ({ t, te: () => true, locale: 'en', setLocale: vi.fn() }) }
})

const mockSearchUsers = vi.fn()
const mockGetUserById = vi.fn()

vi.mock('@/api/admin', () => ({
  adminAPI: {
    usage: { searchUsers: (...args: unknown[]) => mockSearchUsers(...args) },
    users: { getById: (...args: unknown[]) => mockGetUserById(...args) }
  }
}))

const flushPromises = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })

describe('OpenAIFastPolicyUserSelector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSearchUsers.mockReset()
    mockGetUserById.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hydrates existing IDs to email labels without changing the saved IDs', async () => {
    mockGetUserById.mockResolvedValue({ id: 7, email: 'existing@example.com', deleted_at: null })
    const onChange = vi.fn()

    const { container } = render(<OpenAIFastPolicyUserSelector value={[7]} onChange={onChange} />)
    await flushPromises()

    expect(mockGetUserById).toHaveBeenCalledWith(7, true)
    expect(container.textContent).toContain('existing@example.com')
    expect(container.textContent).toContain('#7')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('searches after one character and adds the selected user ID', async () => {
    mockSearchUsers.mockResolvedValue([{ id: 9, email: 'alice@example.com', deleted: false }])
    const onChange = vi.fn()

    render(<OpenAIFastPolicyUserSelector value={[]} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'a' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await flushPromises()

    expect(mockSearchUsers).toHaveBeenCalledWith('a')
    const result = screen.getAllByRole('button').find((button) => button.textContent?.includes('alice@example.com'))
    expect(result).toBeDefined()
    fireEvent.click(result!)

    expect(onChange.mock.calls).toEqual([[[9]]])
  })

  it('keeps an unresolved saved ID visible and removable', async () => {
    mockGetUserById.mockRejectedValue(new Error('not found'))
    const onChange = vi.fn()

    const { container } = render(<OpenAIFastPolicyUserSelector value={[42]} onChange={onChange} />)
    await flushPromises()

    expect(container.textContent).toContain('User #42')
    fireEvent.click(screen.getByRole('button', { name: 'Remove user' }))
    expect(onChange.mock.calls).toEqual([[[]]])
  })
})
